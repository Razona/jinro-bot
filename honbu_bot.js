require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');

const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

client.once('ready', () => {
  console.log(`Discord Bot Logged in as ${client.user.tag}!`);
});

if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN)
    .catch(err => {
      console.error("Failed to log in to Discord:", err);
    });
} else {
  console.warn("DISCORD_TOKEN is not set. Discord functionalities will be unavailable.");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

server.listen(80, () => {
  console.log('サーバーがポート80で起動しました。');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// gameSessionの初期状態を定義する関数
function getInitialGameSession() {
  return {
    serverId: null,
    gameTitle: null,
    categoryId: null,
    channels: { // ここにはGM、投票、お知らせなど基本的なチャンネルIDのみを保持する想定
      gm: null,
      vote: null,
      announce: null,
    },
    playerListMessageId: null,
    playerListMessageChannelId: null,
    roles: [], // プレイヤーの基本情報と配役情報を含むリスト
    manualPlayerList: null, // 手動登録されたプレイヤーリストの元データ
    voteResult: null,
    fortuneResults: [],
    mediumResults: [],
    winningFaction: null,
  };
}

let gameSession = getInitialGameSession(); // サーバー起動時に初期状態を設定


// 初期サンプルプレイヤーリスト (デバッグ用、実際はAPI経由で設定)
let playerList_sample_debug = [
  { "discordId": "123456789012345678", "screenName": "ユーザーA", "playerNumber": 1 },
  { "discordId": "987654321098765432", "screenName": "ユーザーB", "playerNumber": 2 },
];

function getPlayerScreenName(playerNumber) {
  if (!gameSession.roles || gameSession.roles.length === 0) {
    // rolesが空の場合のフォールバック (本番ではrolesが設定される前提)
    // const playerFromInitialList = playerList_sample_debug.find(p => p.playerNumber === playerNumber);
    // if (playerFromInitialList) {
    //   return `${playerFromInitialList.screenName} (初期リストより)`;
    // }
    return `P${playerNumber} (情報なし)`;
  }
  const player = gameSession.roles.find(p => p.playerNumber === playerNumber);
  return player ? player.screenName : `P${playerNumber} (不明)`;
}

app.post('/game/setup', async (req, res) => {
  const { serverId, gameTitle } = req.body;
  if (!serverId || !gameTitle) {
    return res.status(400).json({ message: "serverId and gameTitle are required" });
  }

  if (!client.isReady()) {
    console.error("/game/setup: Discord client is not ready.");
    return res.status(503).json({ message: "Discord bot is not ready yet. Please try again in a moment." });
  }

  try {
    const guild = client.guilds.cache.get(serverId);
    if (!guild) {
      console.error(`/game/setup: Guild with ID ${serverId} not found.`);
      return res.status(404).json({ message: `Server with ID ${serverId} not found. Ensure the bot is a member of this server.` });
    }

    gameSession = {
      serverId: serverId,
      gameTitle: gameTitle,
      categoryId: null,
      channels: { gm: null, vote: null, announce: null },
      playerListMessageId: null,
      playerListMessageChannelId: null,
      roles: [],
      manualPlayerList: null, // 手動リストもクリア
      voteResult: null,
      fortuneResults: [],
      mediumResults: [],
      winningFaction: null,
    };
    console.log('Received /game/setup request, initializing new game session:', req.body);

    const newCategory = await guild.channels.create({
      name: gameTitle,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });
    gameSession.categoryId = newCategory.id;

    const gmChannel = await guild.channels.create({ name: 'GM', type: ChannelType.GuildText, parent: newCategory.id });
    const voteChannel = await guild.channels.create({ name: '投票', type: ChannelType.GuildText, parent: newCategory.id });
    const announceChannel = await guild.channels.create({ name: 'お知らせ', type: ChannelType.GuildText, parent: newCategory.id });

    gameSession.channels = {
      gm: gmChannel.id,
      vote: voteChannel.id,
      announce: announceChannel.id,
    };

    const playerListTargetChannelName = 'botテスト'; // 元のコードに合わせて固定、または設定可能にする
    const targetChannelForPlayerList = guild.channels.cache.find(
      ch => ch.name === playerListTargetChannelName && ch.type === ChannelType.GuildText
    );

    if (!targetChannelForPlayerList) {
      console.error(`/game/setup: Target channel "${playerListTargetChannelName}" for player list message not found in guild ${guild.name}.`);
      // 以前は一部成功としていたが、プレイヤーリスト作成メッセージを投稿できないのは致命的なためエラーとする
      return res.status(404).json({
        message: `Setup failed: Target channel "${playerListTargetChannelName}" for player list message not found. Category and basic channels might have been created.`,
        createdCategoryId: newCategory.id,
        createdChannels: gameSession.channels
      });
    }

    // メッセージ内容を元に戻す (手動登録に関する言及を削除)
    const listCreationMessageContent = `プレイヤーリストを作成します。${gameTitle}に参加するプレイヤーの方は 🖐️ スタンプを押してください。`;
    const postedMessage = await targetChannelForPlayerList.send(listCreationMessageContent);
    gameSession.playerListMessageId = postedMessage.id;
    gameSession.playerListMessageChannelId = targetChannelForPlayerList.id;

    try {
      await postedMessage.react('🖐️');
      console.log(`  Bot reacted to message ${postedMessage.id} in #${targetChannelForPlayerList.name} with 🖐️.`);
    } catch (reactionError) {
      console.error(`  Failed to react to message ${postedMessage.id}:`, reactionError);
    }

    console.log(`サーバーID: ${serverId}, ゲームタイトルを設定: ${gameTitle}. Discordエンティティを作成しました。`);
    res.status(200).json({
      message: `Game "${gameTitle}" setup successful on server "${guild.name}". Player list message posted to #${targetChannelForPlayerList.name}.`,
      categoryId: newCategory.id,
      channels: gameSession.channels,
      playerListMessageId: postedMessage.id,
      playerListMessageChannelId: targetChannelForPlayerList.id
    });

  } catch (error) {
    console.error('/game/setup: Error during Discord operations:', error);
    gameSession = { serverId: null, gameTitle: null, categoryId: null, channels: {}, playerListMessageId: null, playerListMessageChannelId: null, roles: [], manualPlayerList: null, voteResult: null, fortuneResults: [], mediumResults: [], winningFaction: null };
    res.status(500).json({ message: 'Failed to setup game on Discord due to an internal error.', details: error.message });
  }
});

app.post('/player/list/manual', async (req, res) => {
  console.log('Received /player/list/manual request');
  const manualPlayerListData = req.body;

  if (!gameSession.serverId || !gameSession.gameTitle) {
    console.warn('/player/list/manual called before /game/setup or session is missing required IDs.');
    return res.status(400).json({ message: "Game setup is not complete. Please run /game/setup first." });
  }

  if (!Array.isArray(manualPlayerListData)) {
    return res.status(400).json({ message: "Invalid request body: Expected an array of players." });
  }

  const validationErrors = [];
  const playerNumbers = new Set();
  const discordIds = new Set();

  for (let i = 0; i < manualPlayerListData.length; i++) {
    const player = manualPlayerListData[i];
    if (!player.discordId || typeof player.discordId !== 'string') {
      validationErrors.push(`Player at index ${i}: discordId is missing or not a string.`);
    } else {
      if (discordIds.has(player.discordId)) {
        validationErrors.push(`Player at index ${i}: discordId ${player.discordId} is duplicated.`);
      }
      discordIds.add(player.discordId);
    }
    if (!player.screenName || typeof player.screenName !== 'string') {
      validationErrors.push(`Player at index ${i}: screenName is missing or not a string.`);
    }
    if (typeof player.playerNumber !== 'number' || !Number.isInteger(player.playerNumber) || player.playerNumber < 1) {
      validationErrors.push(`Player at index ${i}: playerNumber is missing, not an integer, or less than 1.`);
    } else {
      if (playerNumbers.has(player.playerNumber)) {
        validationErrors.push(`Player at index ${i}: playerNumber ${player.playerNumber} is duplicated.`);
      }
      playerNumbers.add(player.playerNumber);
    }
  }

  if (validationErrors.length > 0) {
    console.error('/player/list/manual: Validation failed.', validationErrors);
    return res.status(400).json({ message: "Validation failed for player list.", errors: validationErrors });
  }

  gameSession.manualPlayerList = manualPlayerListData.map(p => ({
    discordId: p.discordId,
    screenName: p.screenName,
    playerNumber: p.playerNumber,
  }));

  gameSession.roles = gameSession.manualPlayerList.map(p => ({
    discordId: p.discordId,
    screenName: p.screenName,
    playerNumber: p.playerNumber,
    role: null,
    initialFortuneTargetPlayerNumber: null
  }));

  console.log(`/player/list/manual: Successfully registered ${gameSession.manualPlayerList.length} players manually.`);
  res.status(200).json({
    message: `Player list manually registered successfully. ${gameSession.manualPlayerList.length} players.`,
    registeredPlayerCount: gameSession.manualPlayerList.length,
    players: gameSession.manualPlayerList
  });
});

app.get('/player/list', async (req, res) => {
  console.log('Received /player/list request');

  if (!client.isReady()) {
    console.warn('/player/list: Discord client is not ready.');
    return res.status(503).json({ message: "Discord bot is not ready yet. Please try again in a moment." });
  }

  if (gameSession.manualPlayerList && gameSession.manualPlayerList.length > 0) {
    console.log('/player/list: Returning manually registered player list.');
    return res.status(200).json(gameSession.manualPlayerList);
  }

  const { serverId, playerListMessageId, playerListMessageChannelId } = gameSession;

  if (!serverId || !playerListMessageId || !playerListMessageChannelId) {
    console.warn('/player/list called before /game/setup or reaction message info is missing.');
    return res.status(400).json({ message: "Game setup is not complete or player list message/channel ID is missing. Run /game/setup or use /player/list/manual." });
  }

  try {
    const guild = client.guilds.cache.get(serverId);
    if (!guild) {
      console.error(`/player/list: Guild with ID ${serverId} not found.`);
      return res.status(404).json({ message: `Server with ID ${serverId} not found.` });
    }

    const channel = guild.channels.cache.get(playerListMessageChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.error(`/player/list: Text channel with ID ${playerListMessageChannelId} not found.`);
      return res.status(404).json({ message: `Player list channel not found or is not a text channel.` });
    }

    const message = await channel.messages.fetch(playerListMessageId);
    if (!message) {
      console.error(`/player/list: Message with ID ${playerListMessageId} not found.`);
      return res.status(404).json({ message: `Player list message not found.` });
    }

    const reactionEmoji = '🖐️';
    const reaction = message.reactions.cache.get(reactionEmoji);

    let playersFromReaction = [];
    if (reaction) {
      const usersWhoReacted = await reaction.users.fetch();
      const actualUserReactions = usersWhoReacted.filter(user => !user.bot);

      for (const user of actualUserReactions.values()) {
        const member = await guild.members.fetch(user.id).catch(() => null);
        playersFromReaction.push({
          discordId: user.id,
          screenName: member ? member.displayName : user.username,
        });
      }
    } else {
      console.log(`/player/list: No reactions found for emoji ${reactionEmoji}.`);
    }

    const playerListWithNumbers = playersFromReaction.map((player, index) => ({
      ...player,
      playerNumber: index + 1,
    }));

    if (!gameSession.manualPlayerList || gameSession.manualPlayerList.length === 0) {
      gameSession.roles = playerListWithNumbers.map(p => ({
        discordId: p.discordId,
        screenName: p.screenName,
        playerNumber: p.playerNumber,
        role: null,
        initialFortuneTargetPlayerNumber: null
      }));
      console.log('/player/list: Updated gameSession.roles with reaction-based player list.');
    }

    console.log(`/player/list: Responding with ${playerListWithNumbers.length} players from reactions.`);
    res.status(200).json(playerListWithNumbers);

  } catch (error) {
    console.error('/player/list: Error fetching player list from Discord reactions:', error);
    res.status(500).json({ message: 'Failed to fetch player list from Discord reactions due to an internal error.' });
  }
});

app.post('/role/list/add', async (req, res) => {
  const rolesDataFromRequest = req.body;
  if (!Array.isArray(rolesDataFromRequest)) {
    return res.status(400).json({ message: "Role list must be an array" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle || !gameSession.categoryId) {
    console.warn('/role/list/add called before /game/setup.');
    return res.status(400).json({ message: "Game setup is not complete. Please run /game/setup first." });
  }
  if (gameSession.roles.length === 0) {
    console.warn('/role/list/add called before player list is established.');
    return res.status(400).json({ message: "Player list is not established. Run /player/list or /player/list/manual first." });
  }

  if (!client.isReady()) {
    console.error("/role/list/add: Discord client is not ready.");
    return res.status(503).json({ message: "Discord bot is not ready yet." });
  }

  const updatedRoles = gameSession.roles.map(existingPlayer => {
    const roleInfoFromRequest = rolesDataFromRequest.find(r => r.playerNumber === existingPlayer.playerNumber);
    if (roleInfoFromRequest) {
      return {
        ...existingPlayer,
        role: roleInfoFromRequest.role,
        initialFortuneTargetPlayerNumber: roleInfoFromRequest.initialFortuneTargetPlayerNumber,
        // screenNameはプレイヤーリスト作成時のものを正とする
      };
    }
    return existingPlayer;
  });
  gameSession.roles = updatedRoles;

  console.log('Received /role/list/add. Updated gameSession.roles:', gameSession.roles);

  try {
    const guild = client.guilds.cache.get(gameSession.serverId);
    if (!guild) {
      console.error(`/role/list/add: Guild ${gameSession.serverId} not found.`);
      return res.status(404).json({ message: `Server ${gameSession.serverId} not found.` });
    }

    const category = guild.channels.cache.get(gameSession.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      console.error(`/role/list/add: Category ${gameSession.categoryId} not found.`);
      return res.status(404).json({ message: `Category ${gameSession.categoryId} not found.` });
    }

    const createdChannelsInfo = [];
    const werewolfChannelName = "人狼"; // 固定
    let werewolfChannel = guild.channels.cache.find(ch => ch.name === werewolfChannelName && ch.parentId === category.id);

    const werewolves = gameSession.roles.filter(player => player.role === "人狼");
    if (werewolves.length > 0) {
      const wolfPermissionOverwrites = [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        ...werewolves.map(wolf => ({
          id: wolf.discordId,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        }))
      ];
      // GMロールの自動付与は削除

      if (!werewolfChannel) {
        werewolfChannel = await guild.channels.create({
          name: werewolfChannelName, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: wolfPermissionOverwrites,
        });
        createdChannelsInfo.push({ name: werewolfChannel.name, id: werewolfChannel.id, type: "人狼共通" });
      } else {
        await werewolfChannel.edit({ permissionOverwrites: wolfPermissionOverwrites });
        createdChannelsInfo.push({ name: werewolfChannel.name, id: werewolfChannel.id, type: "人狼共通 (既存更新)" });
      }

      if (werewolfChannel) {
        // gameSession.channels には基本チャンネルのみ保持するため、役職チャンネルIDはここでは保存しない
        const wolfMentions = werewolves.map(wolf => `<@${wolf.discordId}>`).join(' ');
        await werewolfChannel.send(`${wolfMentions} あなたたちは人狼です。このチャンネルで作戦を練ってください。`);
      }
    }

    const otherAssignedRoles = gameSession.roles.filter(player => player.role && player.role !== "村人" && player.role !== "人狼");
    for (const player of otherAssignedRoles) {
      const roleChannelName = player.role;
      let roleChannel = guild.channels.cache.find(ch => ch.name === roleChannelName && ch.parentId === category.id);
      const playerPermissionOverwrites = [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: player.discordId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ];
      // GMロールの自動付与は削除

      if (!roleChannel) {
        roleChannel = await guild.channels.create({
          name: roleChannelName, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: playerPermissionOverwrites,
        });
        createdChannelsInfo.push({ name: roleChannel.name, id: roleChannel.id, type: "役職別", player: player.screenName });
      } else {
        await roleChannel.edit({ permissionOverwrites: playerPermissionOverwrites });
        createdChannelsInfo.push({ name: roleChannel.name, id: roleChannel.id, type: "役職別 (既存更新)", player: player.screenName });
      }

      if (roleChannel) {
        let roleMessage = `<@${player.discordId}> あなたの役職は ${player.role} です。`;
        if (player.role === "占い師" && player.initialFortuneTargetPlayerNumber != null) {
          const targetPlayer = gameSession.roles.find(p => p.playerNumber === player.initialFortuneTargetPlayerNumber);
          roleMessage += `\n初日の占い先は ${targetPlayer ? targetPlayer.screenName : `P${player.initialFortuneTargetPlayerNumber}(不明)`} です。結果は 【人間】 でした。`;
        }
        await roleChannel.send(roleMessage);
      }
    }
    console.log('Role channels processed.');
    res.status(200).json({
      message: 'Role list processed. Channels created/updated and players invited.',
      createdChannels: createdChannelsInfo,
      assignedRolesCount: gameSession.roles.filter(r => r.role).length
    });

  } catch (error) {
    console.error('/role/list/add: Error during Discord operations:', error);
    res.status(500).json({ message: 'Failed to process role list on Discord.', details: error.message });
  }
});

app.post('/vote/result', (req, res) => {
  const voteData = req.body;
  if (!voteData || typeof voteData.executedPlayerNumber === 'undefined') {
    return res.status(400).json({ message: "executedPlayerNumber is required" });
  }
  gameSession.voteResult = voteData;
  const executedPlayerName = getPlayerScreenName(voteData.executedPlayerNumber);
  console.log(`投票結果を受信。処刑者: ${executedPlayerName} (P${voteData.executedPlayerNumber})`);
  res.status(200).json({ message: 'Vote result received successfully' });
});

app.post('/night/fortuner', async (req, res) => {
  const fortuneData = req.body;
  if (!fortuneData || typeof fortuneData.fortuneTellerPlayerNumber === 'undefined' || typeof fortuneData.targetPlayerNumber === 'undefined' || typeof fortuneData.result === 'undefined') {
    return res.status(400).json({ message: "fortuneTellerPlayerNumber, targetPlayerNumber, and result are required" });
  }
  gameSession.fortuneResults.push(fortuneData);

  const fortuneTellerName = getPlayerScreenName(fortuneData.fortuneTellerPlayerNumber);
  const targetPlayerName = getPlayerScreenName(fortuneData.targetPlayerNumber);
  const resultText = fortuneData.result ? '人狼' : '人間';
  console.log(`占い結果: P${fortuneData.fortuneTellerPlayerNumber}(${fortuneTellerName}) -> P${fortuneData.targetPlayerNumber}(${targetPlayerName}) = ${resultText}`);

  if (gameSession.serverId && gameSession.categoryId && gameSession.roles.length > 0) {
    try {
      const guild = client.guilds.cache.get(gameSession.serverId);
      if (!guild) throw new Error(`Guild ${gameSession.serverId} not found`);

      const fortuneTeller = gameSession.roles.find(p => p.playerNumber === fortuneData.fortuneTellerPlayerNumber && p.role === '占い師');
      if (!fortuneTeller) throw new Error(`Fortune teller P${fortuneData.fortuneTellerPlayerNumber} not found or not a 占い師`);

      // 元のコードと同様にチャンネルを検索
      const channel = guild.channels.cache.find(ch =>
        ch.name === fortuneTeller.role && // '占い師'
        ch.parentId === gameSession.categoryId &&
        ch.type === ChannelType.GuildText
      );
      if (!channel) throw new Error(`Channel for ${fortuneTeller.role} not found in category ${gameSession.categoryId}`);

      await channel.send(`P${fortuneData.targetPlayerNumber} ${targetPlayerName} の占い結果は【${resultText}】でした。`);
      console.log(`Sent fortune result to ${fortuneTeller.role} channel.`);
    } catch (error) {
      console.error('/night/fortuner: Error sending message to Discord:', error.message);
      // メッセージ送信失敗でもデータは記録済みなので200 OKを返す (元のコードの挙動に近い)
      return res.status(200).json({ message: 'Fortune result received, but failed to send to Discord. Check logs.' });
    }
  } else {
    console.warn('/night/fortuner: Not enough session info to send Discord message. Data was recorded.');
  }
  res.status(200).json({ message: 'Fortune result received and processed' });
});

app.post('/night/medium', async (req, res) => {
  const mediumData = req.body;
  if (!mediumData || typeof mediumData.mediumPlayerNumber === 'undefined' || typeof mediumData.deceasedPlayerNumber === 'undefined' || typeof mediumData.result === 'undefined') {
    return res.status(400).json({ message: "mediumPlayerNumber, deceasedPlayerNumber, and result are required" });
  }
  gameSession.mediumResults.push(mediumData);
  const mediumName = getPlayerScreenName(mediumData.mediumPlayerNumber);
  const deceasedName = getPlayerScreenName(mediumData.deceasedPlayerNumber);
  const resultText = mediumData.result ? '人狼' : '人間';
  console.log(`霊媒結果: P${mediumData.mediumPlayerNumber}(${mediumName}) -> P${mediumData.deceasedPlayerNumber}(${deceasedName}) = ${resultText}`);

  if (gameSession.serverId && gameSession.categoryId && gameSession.roles.length > 0) {
    try {
      const guild = client.guilds.cache.get(gameSession.serverId);
      if (!guild) throw new Error(`Guild ${gameSession.serverId} not found`);

      const medium = gameSession.roles.find(p => p.playerNumber === mediumData.mediumPlayerNumber && p.role === '霊媒師');
      if (!medium) throw new Error(`Medium P${mediumData.mediumPlayerNumber} not found or not a 霊媒師`);

      const channel = guild.channels.cache.find(ch =>
        ch.name === medium.role && // '霊媒師'
        ch.parentId === gameSession.categoryId &&
        ch.type === ChannelType.GuildText
      );
      if (!channel) throw new Error(`Channel for ${medium.role} not found in category ${gameSession.categoryId}`);

      await channel.send(`P${mediumData.deceasedPlayerNumber} ${deceasedName} の霊媒結果は【${resultText}】でした。`);
      console.log(`Sent medium result to ${medium.role} channel.`);
    } catch (error) {
      console.error('/night/medium: Error sending message to Discord:', error.message);
      return res.status(200).json({ message: 'Medium result received, but failed to send to Discord. Check logs.' });
    }
  } else {
    console.warn('/night/medium: Not enough session info to send Discord message. Data was recorded.');
  }
  res.status(200).json({ message: 'Medium result received and processed' });
});

app.post('/game/end', async (req, res) => {
  const { winningFaction } = req.body;
  console.log(`ゲーム終了通知。勝利陣営: ${winningFaction || '情報なし'}`);

  const endedServerId = gameSession.serverId;
  const endedGameTitle = gameSession.gameTitle;
  const endedCategoryId = gameSession.categoryId;
  const endedRoles = [...gameSession.roles]; // コピーして使用

  if (endedServerId && endedCategoryId && endedRoles.length > 0 && client.isReady()) {
    try {
      const guild = client.guilds.cache.get(endedServerId);
      if (guild) {
        const category = guild.channels.cache.get(endedCategoryId);
        if (category) {
          console.log(`Attempting to make role channels in category "${category.name}" visible.`);
          const playerDiscordIds = endedRoles.map(p => p.discordId);
          const gmRole = guild.roles.cache.find(role => role.name === 'GM'); // 元のコードのGMロール処理

          // カテゴリ内の全テキストチャンネルを取得して処理（元のコードの挙動に近い形）
          const channelsInCategory = guild.channels.cache.filter(ch => ch.parentId === endedCategoryId && ch.type === ChannelType.GuildText);

          for (const channel of channelsInCategory.values()) {
            // GM、投票、お知らせチャンネルは除外 (元のコードにはこの除外は明示的になかったが、役職チャンネルのみを対象とする意図と解釈)
            if (channel.id === gameSession.channels.gm || channel.id === gameSession.channels.vote || channel.id === gameSession.channels.announce) {
              continue;
            }
            console.log(`  Updating permissions for channel: ${channel.name} (ID: ${channel.id})`);
            try {
              const permissionOverwrites = [];
              // まず参加者に閲覧権限を与える
              for (const playerId of playerDiscordIds) {
                permissionOverwrites.push({
                  id: playerId,
                  allow: [PermissionsBitField.Flags.ViewChannel],
                  // deny: [PermissionsBitField.Flags.SendMessages] // 書き込みはさせないなど
                });
              }
              // GMロールがいれば、GMにも権限付与 (元のコードの挙動)
              if (gmRole) {
                permissionOverwrites.push({
                  id: gmRole.id,
                  allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                });
              }
              // @everyone からは引き続き見えないようにする (カテゴリ設定依存) か、明示的に deny するか
              // 元のコードでは @everyone への明示的な deny はなかったので、ここでは追加しない
              // ただし、チャンネル作成時に @everyone deny ViewChannel しているので、上記だけだと参加者とGMしか見れない
              // ゲーム終了後は全員に見せるなら、以下のような設定が必要だった
              // permissionOverwrites.push({ id: guild.roles.everyone, allow: [PermissionsBitField.Flags.ViewChannel] });

              await channel.permissionOverwrites.set(permissionOverwrites);
              console.log(`    Permissions updated for ${channel.name}.`);
            } catch (permError) {
              console.error(`    Failed to update permissions for channel ${channel.name}:`, permError);
            }
          }
        } else {
          console.warn(`/game/end: Category ${endedCategoryId} not found.`);
        }
      } else {
        console.warn(`/game/end: Guild ${endedServerId} not found.`);
      }
    } catch (error) {
      console.error('/game/end: Error during Discord operations for opening channels:', error);
    }
  } else {
    if (!client.isReady()) console.warn("/game/end: Discord client not ready.");
    else console.warn("/game/end: Not enough session info to update channel permissions.");
  }

  const oldGameTitle = gameSession.gameTitle;
  const oldServerId = gameSession.serverId;
  gameSession = {
    serverId: null, gameTitle: null, categoryId: null,
    channels: { gm: null, vote: null, announce: null },
    playerListMessageId: null, playerListMessageChannelId: null,
    roles: [], manualPlayerList: null,
    voteResult: null, fortuneResults: [], mediumResults: [], winningFaction: null,
  };
  console.log(`ゲームセッション情報をリセットしました。(旧ServerID: ${oldServerId}, 旧GameTitle: ${oldGameTitle})`);
  res.status(200).json({
    message: `Game ended. Winning faction: ${winningFaction || 'N/A'}. Session reset.`,
  });
});

app.use((req, res) => {
  console.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).send('Sorry, cant find that!');
});


// ★★★ 新規APIエンドポイント: /reset ★★★
app.post('/reset', (req, res) => {
  console.log('Received /reset request. Resetting game session to initial state.');
  const oldGameTitle = gameSession.gameTitle; // リセット前の情報をログ用に保持
  const oldServerId = gameSession.serverId;

  gameSession = getInitialGameSession(); // gameSessionを初期状態に戻す

  console.log(`Game session has been reset. (Old serverId: ${oldServerId}, Old gameTitle: ${oldGameTitle})`);
  res.status(200).json({ message: 'Game session has been reset successfully.' });
});