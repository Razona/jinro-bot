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
    GatewayIntentBits.GuildMessageReactions, // リアクション取得のため追加
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

let gameSession = {
  serverId: null,
  gameTitle: null,
  categoryId: null,
  channels: {
    gm: null,
    vote: null,
    announce: null,
  },
  playerListMessageId: null,
  playerListMessageChannelId: null, // player/list のために追加
  roles: [],
  voteResult: null,
  fortuneResults: [],
  mediumResults: [],
  winningFaction: null,
};

let playerList = [
  { "discordId": "123456789012345678", "screenName": "ユーザーA", "playerNumber": 1 },
  { "discordId": "987654321098765432", "screenName": "ユーザーB", "playerNumber": 2 },
  { "discordId": "112233445566778899", "screenName": "ユーザーC", "playerNumber": 3 },
  { "discordId": "998877665544332211", "screenName": "ユーザーD", "playerNumber": 4 },
  { "discordId": "223344556677889900", "screenName": "ユーザーE", "playerNumber": 5 },
  { "discordId": "334455667788990011", "screenName": "ユーザーF", "playerNumber": 6 },
  { "discordId": "445566778899001122", "screenName": "ユーザーG", "playerNumber": 7 },
  { "discordId": "556677889900112233", "screenName": "ユーザーH", "playerNumber": 8 },
  { "discordId": "667788990011223344", "screenName": "ユーザーI", "playerNumber": 9 },
  { "discordId": "778899001122334455", "screenName": "ユーザーJ", "playerNumber": 10 },
  { "discordId": "889900112233445566", "screenName": "ユーザーK", "playerNumber": 11 },
  { "discordId": "990011223344556677", "screenName": "ユーザーL", "playerNumber": 12 },
  { "discordId": "101112131415161718", "screenName": "ユーザーM", "playerNumber": 13 },
];

function getPlayerScreenName(playerNumber) {
  if (!gameSession.roles || gameSession.roles.length === 0) {
    const playerFromInitialList = playerList.find(p => p.playerNumber === playerNumber);
    if (playerFromInitialList) {
      return `${playerFromInitialList.screenName} (初期リストより)`;
    }
    return `P${playerNumber} (情報なし)`;
  }
  const player = gameSession.roles.find(p => p.playerNumber === playerNumber);
  return player ? player.screenName : `P${playerNumber} (不明)`;
}

app.post('/game/setup', async (req, res) => {
  const { serverId, gameTitle } = req.body; // gameTitle は受け取るが、メッセージ内では固定文字列を使用
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

    const newCategory = await guild.channels.create({
      name: gameTitle, // カテゴリ名はリクエストのgameTitleを使用
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });

    const gmChannel = await guild.channels.create({ name: 'GM', type: ChannelType.GuildText, parent: newCategory.id });
    const voteChannel = await guild.channels.create({ name: '投票', type: ChannelType.GuildText, parent: newCategory.id });
    const announceChannel = await guild.channels.create({ name: 'お知らせ', type: ChannelType.GuildText, parent: newCategory.id });

    const playerListTargetChannelName = 'botテスト';
    const targetChannelForPlayerList = guild.channels.cache.find(
      ch => ch.name === playerListTargetChannelName && ch.type === ChannelType.GuildText
    );

    if (!targetChannelForPlayerList) {
      console.error(`/game/setup: Target channel "${playerListTargetChannelName}" for player list message not found in guild ${guild.name}. Basic category and channels were created.`);
      return res.status(404).json({
        message: `Setup partially failed: Target channel "${playerListTargetChannelName}" for player list message not found. Basic category and channels were created.`,
        createdCategoryId: newCategory.id,
        createdChannels: { gm: gmChannel.id, vote: voteChannel.id, announce: announceChannel.id }
      });
    }

    // メッセージ文面を変更 (ここから変更)
    const listCreationMessageContent = `プレイヤーリストを作成します。「テスト 5-6」に参加するプレイヤーの方は 🖐️ スタンプを押してください`;
    // (ここまで変更)
    const postedMessage = await targetChannelForPlayerList.send(listCreationMessageContent);

    // 投稿したメッセージにBotがリアクションを追加 (ここから追加)
    try {
      await postedMessage.react('🖐️'); // U+1F91A raised_hand
      console.log(`  Bot reacted to message ${postedMessage.id} in #${targetChannelForPlayerList.name} with 🖐️.`);
    } catch (reactionError) {
      console.error(`  Failed to react to message ${postedMessage.id}:`, reactionError);
    }
    // (ここまで追加)

    gameSession = {
      serverId: serverId,
      gameTitle: gameTitle,
      categoryId: newCategory.id,
      channels: {
        gm: gmChannel.id,
        vote: voteChannel.id,
        announce: announceChannel.id,
      },
      playerListMessageId: postedMessage.id,
      playerListMessageChannelId: targetChannelForPlayerList.id, // player/list のためにチャンネルIDを保存
      roles: [],
      voteResult: null,
      fortuneResults: [],
      mediumResults: [],
      winningFaction: null,
    };
    console.log('Received /game/setup request:', req.body);
    console.log(`サーバーID: ${serverId}, ゲームタイトルを設定: ${gameTitle}. セッションを初期化しDiscordエンティティを作成しました。`);
    console.log(`  Category ID: ${newCategory.id} (Private), Announce Ch ID: ${announceChannel.id}. Player List Msg (ID: ${postedMessage.id}) posted to #${targetChannelForPlayerList.name} (ID: ${targetChannelForPlayerList.id})`);

    res.status(200).json({
      message: `Game "${gameTitle}" setup successful on server "${guild.name}". Private category and channels created. Player list message posted to #${targetChannelForPlayerList.name}.`,
      categoryId: newCategory.id,
      channels: gameSession.channels,
      playerListMessageId: postedMessage.id,
      playerListMessageChannelId: targetChannelForPlayerList.id
    });

  } catch (error) {
    console.error('/game/setup: Error during Discord operations:', error);
    res.status(500).json({ message: 'Failed to setup game on Discord due to an internal error.', details: error.message });
  }
});

app.get('/player/list', async (req, res) => {
  console.log('Received /player/list request');

  if (!client.isReady()) {
    console.warn('/player/list: Discord client is not ready.');
    return res.status(503).json({ message: "Discord bot is not ready yet. Please try again in a moment." });
  }

  const { serverId, playerListMessageId, playerListMessageChannelId } = gameSession;

  if (!serverId || !playerListMessageId || !playerListMessageChannelId) {
    console.warn('/player/list called before /game/setup has completed or session is missing required IDs.');
    return res.status(400).json({ message: "Game setup is not complete or player list message/channel ID is missing from session. Please run /game/setup first." });
  }

  try {
    const guild = client.guilds.cache.get(serverId);
    if (!guild) {
      console.error(`/player/list: Guild with ID ${serverId} not found.`);
      return res.status(404).json({ message: `Server with ID ${serverId} not found.` });
    }

    const channel = guild.channels.cache.get(playerListMessageChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.error(`/player/list: Text channel with ID ${playerListMessageChannelId} not found in guild ${guild.name} or it's not a text channel.`);
      return res.status(404).json({ message: `Player list channel not found or is not a text channel.` });
    }

    const message = await channel.messages.fetch(playerListMessageId);
    if (!message) {
      console.error(`/player/list: Message with ID ${playerListMessageId} not found in channel #${channel.name}.`);
      return res.status(404).json({ message: `Player list message not found.` });
    }

    const reactionEmoji = '🖐️';
    const reaction = message.reactions.cache.get(reactionEmoji);

    let players = [];
    if (reaction) {
      const usersWhoReacted = await reaction.users.fetch();
      const actualUserReactions = usersWhoReacted.filter(user => !user.bot);

      for (const user of actualUserReactions.values()) {
        const member = await guild.members.fetch(user.id).catch(() => null);
        players.push({
          discordId: user.id,
          screenName: member ? member.displayName : user.username,
        });
      }
    } else {
      console.log(`/player/list: No reactions found for emoji ${reactionEmoji} on message ${message.id} in channel #${channel.name}. An empty list will be returned.`);
    }

    const playerListWithNumbers = players.map((player, index) => ({
      ...player,
      playerNumber: index + 1,
    }));

    console.log(`/player/list: Responding with ${playerListWithNumbers.length} players.`);
    res.status(200).json(playerListWithNumbers);

  } catch (error) {
    console.error('/player/list: Error fetching player list from Discord:', error);
    res.status(500).json({ message: 'Failed to fetch player list from Discord due to an internal error.' });
  }
});

app.post('/role/list/add', async (req, res) => {
  const rolesData = req.body;
  if (!Array.isArray(rolesData)) {
    return res.status(400).json({ message: "Role list must be an array" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle || !gameSession.categoryId) {
    console.warn('/role/list/add called before /game/setup or session is missing required IDs.');
    return res.status(400).json({ message: "Game setup is not complete or serverId/gameTitle/categoryId is missing. Please run /game/setup first." });
  }

  if (!client.isReady()) {
    console.error("/role/list/add: Discord client is not ready.");
    return res.status(503).json({ message: "Discord bot is not ready yet. Please try again in a moment." });
  }

  gameSession.roles = rolesData.map(roleInfo => ({
    discordId: roleInfo.discordId,
    screenName: roleInfo.screenName,
    playerNumber: roleInfo.playerNumber,
    role: roleInfo.role,
    initialFortuneTargetPlayerNumber: roleInfo.initialFortuneTargetPlayerNumber
  }));

  console.log('Received /role/list/add request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log(`配役リストをgameSession.rolesに格納。${gameSession.roles.length}人のプレイヤー情報。`);

  try {
    const guild = client.guilds.cache.get(gameSession.serverId);
    if (!guild) {
      console.error(`/role/list/add: Guild with ID ${gameSession.serverId} not found.`);
      return res.status(404).json({ message: `Server with ID ${gameSession.serverId} not found.` });
    }

    const category = guild.channels.cache.get(gameSession.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      console.error(`/role/list/add: Category with ID ${gameSession.categoryId} not found or is not a category.`);
      return res.status(404).json({ message: `Category with ID ${gameSession.categoryId} not found or is not a category.` });
    }

    const gmRole = guild.roles.cache.find(role => role.name === 'GM');
    if (!gmRole) {
      console.warn(`GM role named "GM" not found in server ${guild.name}. GM will not have automatic access to role channels.`);
    }

    const createdChannelsInfo = [];
    const werewolfChannelName = "人狼";
    let werewolfChannel = guild.channels.cache.find(ch => ch.name === werewolfChannelName && ch.parentId === category.id);

    const werewolves = gameSession.roles.filter(player => player.role === "人狼");
    if (werewolves.length > 0) {
      const wolfPermissionOverwrites = [
        {
          id: guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        ...werewolves.map(wolf => ({
          id: wolf.discordId,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        }))
      ];
      if (gmRole) {
        wolfPermissionOverwrites.push({
          id: gmRole.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        });
      }

      if (!werewolfChannel) {
        try {
          werewolfChannel = await guild.channels.create({
            name: werewolfChannelName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: wolfPermissionOverwrites,
          });
          console.log(`Created channel: ${werewolfChannel.name} (ID: ${werewolfChannel.id})`);
          createdChannelsInfo.push({ name: werewolfChannel.name, id: werewolfChannel.id, type: "人狼共通" });
        } catch (error) {
          console.error(`Error creating werewolf channel "${werewolfChannelName}":`, error);
        }
      } else {
        try {
          await werewolfChannel.edit({ permissionOverwrites: wolfPermissionOverwrites });
          console.log(`Used and updated permissions for existing channel: ${werewolfChannel.name} (ID: ${werewolfChannel.id})`);
          if (!createdChannelsInfo.find(c => c.id === werewolfChannel.id)) {
            createdChannelsInfo.push({ name: werewolfChannel.name, id: werewolfChannel.id, type: "人狼共通 (既存)" });
          }
        } catch (error) {
          console.error(`Error updating permissions for existing werewolf channel "${werewolfChannelName}":`, error);
        }
      }

      if (werewolfChannel) {
        gameSession.channels[werewolfChannelName] = werewolfChannel.id;
        const wolfMentions = werewolves.map(wolf => `<@${wolf.discordId}>`).join(' ');
        const wolfMessage = `${wolfMentions} あなたたちは人狼です。このチャンネルで作戦を練ってください。`;
        try {
          await werewolfChannel.send(wolfMessage);
          console.log(`Sent welcome message to ${werewolfChannel.name}`);
        } catch (error) {
          console.error(`Error sending message to werewolf channel: ${error}`);
        }
      }
    }

    const otherRoles = gameSession.roles.filter(player => player.role !== "村人" && player.role !== "人狼");

    for (const player of otherRoles) {
      const roleChannelName = player.role;
      let roleChannel = guild.channels.cache.find(ch => ch.name === roleChannelName && ch.parentId === category.id);

      const playerPermissionOverwrites = [
        {
          id: guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: player.discordId,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        }
      ];
      if (gmRole) {
        playerPermissionOverwrites.push({
          id: gmRole.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        });
      }

      if (!roleChannel) {
        try {
          roleChannel = await guild.channels.create({
            name: roleChannelName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: playerPermissionOverwrites,
          });
          console.log(`Created channel: ${roleChannel.name} (ID: ${roleChannel.id}) for ${player.screenName}`);
          createdChannelsInfo.push({ name: roleChannel.name, id: roleChannel.id, type: "役職別", player: player.screenName });
        } catch (error) {
          console.error(`Error creating channel "${roleChannelName}" for ${player.screenName}:`, error);
          continue;
        }
      } else {
        try {
          await roleChannel.edit({ permissionOverwrites: playerPermissionOverwrites });
          console.log(`Used and updated permissions for existing channel: ${roleChannel.name} (ID: ${roleChannel.id}) for ${player.screenName}`);
          if (!createdChannelsInfo.find(c => c.id === roleChannel.id && c.player === player.screenName)) {
            createdChannelsInfo.push({ name: roleChannel.name, id: roleChannel.id, type: "役職別 (既存)", player: player.screenName });
          }
        } catch (error) {
          console.error(`Error updating permissions for existing role channel "${roleChannelName}" for ${player.screenName}:`, error);
        }
      }

      if (roleChannel) {
        gameSession.channels[roleChannelName] = roleChannel.id;
        let roleMessage = `<@${player.discordId}> あなたの役職は ${player.role} です。`;
        // ▼▼▼ここから修正▼▼▼
        if (player.role === "占い師" && player.initialFortuneTargetPlayerNumber !== null && player.initialFortuneTargetPlayerNumber !== undefined) {
          const targetPlayer = gameSession.roles.find(p => p.playerNumber === player.initialFortuneTargetPlayerNumber);
          if (targetPlayer) {
            // 初日占いは必ず「人間」と表示
            roleMessage += `\n初日の占い先は ${targetPlayer.screenName} (P${targetPlayer.playerNumber}) です。結果は 【人間】 でした。`;
          } else {
            roleMessage += `\n初日の占い対象 (P${player.initialFortuneTargetPlayerNumber}) の情報が見つかりませんでした。`;
          }
        }
        // ▲▲▲ここまで修正▲▲▲
        try {
          await roleChannel.send(roleMessage);
          console.log(`Sent role assignment message to ${player.screenName} in ${roleChannel.name}`);
        } catch (error) {
          console.error(`Error sending message to role channel ${roleChannel.name}: ${error}`);
        }
      }
    }

    console.log('gameSession.channels updated:', gameSession.channels);

    res.status(200).json({
      message: 'Role list processed. Channels created/updated, players invited, and GM role granted access. Channels saved to session.',
      createdChannels: createdChannelsInfo,
      sessionChannels: gameSession.channels,
      receivedRoles: gameSession.roles.length
    });

  } catch (error) {
    console.error('/role/list/add: Error during Discord operations:', error);
    res.status(500).json({ message: 'Failed to process role list on Discord due to an internal error.', details: error.message });
  }
});

app.post('/vote/result', (req, res) => {
  const voteData = req.body;
  if (!voteData || typeof voteData.executedPlayerNumber === 'undefined') {
    return res.status(400).json({ message: "executedPlayerNumber is required" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle) {
    console.warn('/vote/result called before /game/setup.');
  }
  gameSession.voteResult = voteData;
  const executedPlayerName = getPlayerScreenName(voteData.executedPlayerNumber);
  console.log('Received /vote/result request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log('Request body:', req.body);
  console.log(`投票結果を受信。処刑者: ${executedPlayerName} (P${voteData.executedPlayerNumber})`);
  res.status(200).json({ message: 'Vote result received successfully' });
});

app.post('/night/fortuner', async (req, res) => {
  const fortuneData = req.body;
  if (!fortuneData || typeof fortuneData.fortuneTellerPlayerNumber === 'undefined' || typeof fortuneData.targetPlayerNumber === 'undefined' || typeof fortuneData.result === 'undefined') {
    return res.status(400).json({ message: "fortuneTellerPlayerNumber, targetPlayerNumber, and result are required" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle) {
    console.warn('/night/fortuner called before /game/setup.');
  }
  gameSession.fortuneResults.push(fortuneData);

  const fortuneTellerName = getPlayerScreenName(fortuneData.fortuneTellerPlayerNumber);
  const targetPlayerName = getPlayerScreenName(fortuneData.targetPlayerNumber);
  const resultText = fortuneData.result ? '人狼' : '人間';

  console.log('Received /night/fortuner request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log('Request body:', req.body);
  console.log(`占い結果を受信: 占い師 ${fortuneTellerName} (P${fortuneData.fortuneTellerPlayerNumber}) -> 対象 ${targetPlayerName} (P${fortuneData.targetPlayerNumber}) = ${resultText}`);

  // 占い師のチャンネルに結果を通知
  try {
    const guild = client.guilds.cache.get(gameSession.serverId);
    if (!guild) {
      console.error(`/night/fortuner: Guild with ID ${gameSession.serverId} not found.`);
      return res.status(404).json({ message: `Server with ID ${gameSession.serverId} not found.` });
    }

    const fortuneTeller = gameSession.roles.find(player => player.playerNumber === fortuneData.fortuneTellerPlayerNumber);
    if (!fortuneTeller) {
      console.error(`/night/fortuner: Fortune teller with PlayerNumber ${fortuneData.fortuneTellerPlayerNumber} not found in gameSession.`);
      return res.status(400).json({ message: `Fortune teller with PlayerNumber ${fortuneData.fortuneTellerPlayerNumber} not found.` });
    }

    const channel = guild.channels.cache.find(ch => ch.name === fortuneTeller.role && ch.parent === guild.channels.cache.get(gameSession.categoryId));
    if (!channel) {
      console.error(`/night/fortuner: Channel for ${fortuneTeller.role} not found in category.`);
      return res.status(404).json({ message: `Channel for ${fortuneTeller.role} not found.` });
    }

    await channel.send(`${targetPlayerName} (P${fortuneData.targetPlayerNumber}) の占い結果は${resultText}です。`);

  } catch (error) {
    console.error('/night/fortuner: Error sending fortune result to Discord:', error);
    return res.status(500).json({ message: 'Failed to send fortune result to Discord due to an internal error.', details: error.message });
  }

  res.status(200).json({ message: 'Fortune result received and processed' });
});

app.post('/night/medium', async (req, res) => {
  const mediumData = req.body;
  if (!mediumData || typeof mediumData.mediumPlayerNumber === 'undefined' || typeof mediumData.deceasedPlayerNumber === 'undefined' || typeof mediumData.result === 'undefined') {
    return res.status(400).json({ message: "mediumPlayerNumber, deceasedPlayerNumber, and result are required" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle) {
    console.warn('/night/medium called before /game/setup.');
  }
  gameSession.mediumResults.push(mediumData);

  const mediumName = getPlayerScreenName(mediumData.mediumPlayerNumber);
  const deceasedName = getPlayerScreenName(mediumData.deceasedPlayerNumber);
  const resultText = mediumData.result ? '人狼' : '人間';

  console.log('Received /night/medium request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log('Request body:', req.body);
  console.log(`霊媒結果を受信: 霊媒師 ${mediumName} (P${mediumData.mediumPlayerNumber}) -> 処刑者 ${deceasedName} (P${mediumData.deceasedPlayerNumber}) = ${resultText}`);

  // 霊媒師のチャンネルに結果を通知
  try {
    const guild = client.guilds.cache.get(gameSession.serverId);
    if (!guild) {
      console.error(`/night/medium: Guild with ID ${gameSession.serverId} not found.`);
      return res.status(404).json({ message: `Server with ID ${gameSession.serverId} not found.` });
    }

    const medium = gameSession.roles.find(player => player.playerNumber === mediumData.mediumPlayerNumber);
    if (!medium) {
      console.error(`/night/medium: Medium with PlayerNumber ${mediumData.mediumPlayerNumber} not found in gameSession.`);
      return res.status(400).json({ message: `Medium with PlayerNumber ${mediumData.mediumPlayerNumber} not found.` });
    }

    const channel = guild.channels.cache.find(ch => ch.name === medium.role && ch.parent === guild.channels.cache.get(gameSession.categoryId));
    if (!channel) {
      console.error(`/night/medium: Channel for ${medium.role} not found in category.`);
      return res.status(404).json({ message: `Channel for ${medium.role} not found.` });
    }

    await channel.send(`${deceasedName} (P${mediumData.deceasedPlayerNumber}) の霊媒結果は${resultText}です。`);

  } catch (error) {
    console.error('/night/medium: Error sending medium result to Discord:', error);
    return res.status(500).json({ message: 'Failed to send medium result to Discord due to an internal error.', details: error.message });
  }

  res.status(200).json({ message: 'Medium result received and processed' });
});


app.post('/game/end', async (req, res) => {
  const { winningFaction } = req.body;
  console.log('Received /game/end request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log('Request body:', req.body);
  console.log(`ゲーム終了通知を受信。勝利陣営: ${winningFaction || '情報なし'}`);

  const endedServerId = gameSession.serverId;
  const endedGameTitle = gameSession.gameTitle;
  const endedCategoryId = gameSession.categoryId;
  const endedRoles = [...gameSession.roles]; // プレイヤー情報をコピー
  const endedChannels = { ...gameSession.channels }; // チャンネル情報をコピー

  if (endedServerId && endedCategoryId && endedRoles.length > 0) {
    if (!client.isReady()) {
      console.error("/game/end: Discord client is not ready. Cannot update channel permissions.");
    } else {
      try {
        const guild = client.guilds.cache.get(endedServerId);
        if (!guild) {
          console.error(`/game/end: Guild with ID ${endedServerId} not found. Cannot update channel permissions.`);
        } else {
          const category = guild.channels.cache.get(endedCategoryId);
          if (!category || category.type !== ChannelType.GuildCategory) {
            console.error(`/game/end: Category with ID ${endedCategoryId} not found or is not a category. Cannot update channel permissions reliably.`);
          }

          const gmRole = guild.roles.cache.find(role => role.name === 'GM');

          console.log(`Attempting to make role channels in category "${category ? category.name : endedCategoryId}" visible to ${endedRoles.length} players.`);

          const playerDiscordIds = endedRoles.map(p => p.discordId);

          for (const channelName in endedChannels) {
            if (channelName === 'gm' || channelName === 'vote' || channelName === 'announce' || !endedChannels[channelName]) {
              continue; // Skip basic channels or null channel IDs
            }

            const channelId = endedChannels[channelName];
            const channel = guild.channels.cache.get(channelId);

            if (channel && channel.parentId === endedCategoryId) {
              console.log(`  Updating permissions for channel: ${channel.name} (ID: ${channel.id})`);
              try {
                const permissionOverwrites = [
                  // Everyone in the server can view (if category allows)
                  {
                    id: guild.roles.everyone,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                  },
                  // Explicitly allow all game participants
                  ...playerDiscordIds.map(playerId => ({
                    id: playerId,
                    allow: [PermissionsBitField.Flags.ViewChannel],
                  }))
                ];

                if (gmRole) {
                  permissionOverwrites.push({
                    id: gmRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], // GM can still send messages
                  });
                }

                // Make channel readable by players, but not necessarily writable by default after game.
                // Players will inherit category permissions for sending messages unless explicitly set here.
                // For simplicity, we only ensure ViewChannel for players.
                // If channels should become read-only for players (except GM), add deny: [PermissionsBitField.Flags.SendMessages] for players.
                // However, the request was about *accessing* (viewing).

                await channel.edit({ permissionOverwrites });
                console.log(`    Permissions updated for ${channel.name}.`);

                // Optionally, send a message to the channel indicating it's now open
                // await channel.send(`ゲームが終了しました。このチャンネルは全ての参加者に公開されました。`);

              } catch (permError) {
                console.error(`    Failed to update permissions for channel ${channel.name} (ID: ${channel.id}):`, permError);
              }
            } else if (channel && channel.parentId !== endedCategoryId) {
              console.warn(`  Channel ${channelName} (ID: ${channelId}) is not in the expected game category. Skipping permission update.`);
            } else if (!channel) {
              console.warn(`  Channel ${channelName} (ID: ${channelId}) not found in cache. Skipping permission update.`);
            }
          }
          console.log("Finished attempting to update channel permissions for game end.");
        }
      } catch (error) {
        console.error('/game/end: Error during Discord operations for opening channels:', error);
      }
    }
  } else {
    console.warn("/game/end: Not enough session information (serverId, categoryId, or roles) to update channel permissions.");
  }

  // Reset game session
  gameSession = {
    serverId: null,
    gameTitle: null,
    categoryId: null,
    channels: {
      gm: null,
      vote: null,
      announce: null,
    },
    playerListMessageId: null,
    playerListMessageChannelId: null,
    roles: [],
    voteResult: null,
    fortuneResults: [],
    mediumResults: [],
    winningFaction: null,
  };
  console.log(`ゲームセッション情報をリセットしました。 (旧ServerID: ${endedServerId}, 旧GameTitle: ${endedGameTitle})`);
  res.status(200).json({
    message: `Game ended. Winning faction: ${winningFaction || 'N/A'}. Channel permissions updated (if possible) and session reset.`,
    details: `Permissions for channels in category ${endedGameTitle} on server ${endedServerId} were processed for all players.`
  });
});

app.use((req, res) => {
  res.status(404).send('Sorry, cant find that!');
});