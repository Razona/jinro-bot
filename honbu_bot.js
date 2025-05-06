require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');

// Discord.jsのインポートと設定 (PermissionsBitField を追加)
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js'); // PermissionsBitField を追加
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
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

    // カテゴリ作成時にpermissionOverwritesを追加 (ここから変更)
    const newCategory = await guild.channels.create({
      name: gameTitle,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone, // @everyoneロールのID
          deny: [PermissionsBitField.Flags.ViewChannel], // 「チャンネルを見る」権限を拒否
        },
        // 必要であれば、ここに特定のロール（GMロールなど）やBot自身に
        // ViewChannel権限を許可する設定を追加できます。例:
        // {
        //   id: 'YOUR_GM_ROLE_ID',
        //   allow: [PermissionsBitField.Flags.ViewChannel],
        // },
      ],
    });
    // (ここまで変更)

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

    const listCreationMessageContent = `プレイヤーリストを作成します。「${gameTitle}」に参加するプレイヤーの方はスタンプを押してください`;
    const postedMessage = await targetChannelForPlayerList.send(listCreationMessageContent);

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
    let errorMessage = 'Failed to setup game on Discord due to an internal error.';
    if (error.code === 50013) {
      errorMessage = 'Discord API Error: Bot is missing permissions to perform an action.';
    } else if (error.name === 'DiscordAPIError' && error.message.includes('Unknown Channel')) {
      errorMessage = 'Discord API Error: An unknown channel was encountered.';
    }
    return res.status(500).json({ message: errorMessage, details: error.message });
  }
});

app.get('/player/list', (req, res) => {
  console.log('Received /player/list request');
  if (!gameSession.serverId) {
    console.warn('/player/list called before /game/setup or without a valid serverId in session.');
  }
  res.status(200).json(playerList);
});

app.post('/role/list/add', (req, res) => {
  const rolesData = req.body;
  if (!Array.isArray(rolesData)) {
    return res.status(400).json({ message: "Role list must be an array" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle) {
    console.warn('/role/list/add called before /game/setup.');
  }
  gameSession.roles = rolesData.map(roleInfo => ({
    discordId: roleInfo.discordId,
    screenName: roleInfo.screenName,
    playerNumber: roleInfo.playerNumber,
    role: roleInfo.role,
    initialFortuneTargetPlayerNumber: roleInfo.initialFortuneTargetPlayerNumber
  }));

  console.log('Received /role/list/add request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log('Request body:', req.body);
  console.log(`配役リストをgameSession.rolesに格納。${gameSession.roles.length}人のプレイヤー情報。`);
  gameSession.roles.forEach(player => {
    console.log(`  Player ${player.playerNumber} (${player.screenName}): ${player.role}`);
  });
  res.status(200).json({ message: 'Role list added and processed successfully', receivedRoles: gameSession.roles.length });
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

app.post('/night/fortuner', (req, res) => {
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
  res.status(200).json({ message: 'Fortune result received and processed' });
});

app.post('/night/medium', (req, res) => {
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
  res.status(200).json({ message: 'Medium result received and processed' });
});

app.post('/game/end', (req, res) => {
  const { winningFaction } = req.body;
  if (!winningFaction) {
    console.warn('Received /game/end request without winningFaction.');
  }
  console.log('Received /game/end request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log('Request body:', req.body);
  console.log(`ゲーム終了通知を受信。勝利陣営: ${winningFaction || '情報なし'}`);

  const endedServerId = gameSession.serverId;
  const endedGameTitle = gameSession.gameTitle;
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
    roles: [],
    voteResult: null,
    fortuneResults: [],
    mediumResults: [],
    winningFaction: null,
  };
  console.log(`ゲームセッション情報をリセットしました。 (旧ServerID: ${endedServerId}, 旧GameTitle: ${endedGameTitle})`);
  res.status(200).json({ message: `Game ended. Winning faction: ${winningFaction || 'N/A'}. Session reset.` });
});

app.use((req, res) => {
  res.status(404).send('Sorry, cant find that!');
});