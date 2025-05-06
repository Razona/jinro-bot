require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');

// Discord.jsのインポートと設定 (ここから追加)
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, // カテゴリ・チャンネル作成、メッセージ送信に必要
  ]
});

client.once('ready', () => {
  console.log(`Discord Bot Logged in as ${client.user.tag}!`); // Bot起動確認用ログ
});

// DISCORD_TOKENが設定されていればログイン試行
if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN)
    .catch(err => {
      console.error("Failed to log in to Discord:", err); // ログイン失敗時のエラーログ
    });
} else {
  console.warn("DISCORD_TOKEN is not set. Discord functionalities will be unavailable."); // トークン未設定時の警告
}
// (ここまで追加)


// JSONリクエストボディをパースするためのミドルウェア
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // publicフォルダ内の静的ファイルを提供

server.listen(80, () => {
  console.log('サーバーがポート80で起動しました。');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // index.htmlを返す
});

let gameSession = {
  serverId: null,
  gameTitle: null,
  // Discord連携で追加される情報をここに定義 (ここから変更)
  categoryId: null,
  channels: { // 各チャンネルのIDを保持するオブジェクト
    gm: null,
    vote: null,
    announce: null,
  },
  playerListMessageId: null,
  // (ここまで変更)
  roles: [], // ここにプレイヤーの役職と screenName が入る
  voteResult: null,
  fortuneResults: [],
  mediumResults: [],
  winningFaction: null,
};

// ダミーのプレイヤーリスト (初期の参加者候補リストとして)
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

// playerNumber から screenName を取得するヘルパー関数
function getPlayerScreenName(playerNumber) {
  if (!gameSession.roles || gameSession.roles.length === 0) {
    // /role/list/add が呼ばれる前など、roles が未設定の場合
    const playerFromInitialList = playerList.find(p => p.playerNumber === playerNumber);
    if (playerFromInitialList) {
      return `${playerFromInitialList.screenName} (初期リストより)`;
    }
    return `P${playerNumber} (情報なし)`;
  }
  const player = gameSession.roles.find(p => p.playerNumber === playerNumber);
  return player ? player.screenName : `P${playerNumber} (不明)`;
}


// 2.1. ゲーム準備 (タイトル設定とカテゴリ作成)
app.post('/game/setup', async (req, res) => { // async に変更
  const { serverId, gameTitle } = req.body;
  if (!serverId || !gameTitle) {
    return res.status(400).json({ message: "serverId and gameTitle are required" });
  }

  // Discordクライアントの準備状態を確認 (機能追加に必須)
  if (!client.isReady()) {
    console.error("/game/setup: Discord client is not ready."); // 必要なログ
    return res.status(503).json({ message: "Discord bot is not ready yet. Please try again in a moment." });
  }

  try {
    const guild = client.guilds.cache.get(serverId);
    if (!guild) {
      console.error(`/game/setup: Guild with ID ${serverId} not found.`); // 必要なログ
      return res.status(404).json({ message: `Server with ID ${serverId} not found. Ensure the bot is a member of this server.` });
    }

    // カテゴリ作成
    const newCategory = await guild.channels.create({
      name: gameTitle,
      type: ChannelType.GuildCategory,
    });

    // チャンネル作成 (GM, 投票, お知らせ)
    const gmChannel = await guild.channels.create({ name: 'GM', type: ChannelType.GuildText, parent: newCategory.id });
    const voteChannel = await guild.channels.create({ name: '投票', type: ChannelType.GuildText, parent: newCategory.id });
    const announceChannel = await guild.channels.create({ name: 'お知らせ', type: ChannelType.GuildText, parent: newCategory.id });

    // プレイヤーリスト作成用メッセージ投稿
    const listCreationMessageContent = `プレイヤーリストを作成します。「${gameTitle}」に参加するプレイヤーの方はスタンプを押してください`;
    const postedMessage = await announceChannel.send(listCreationMessageContent);

    // gameSession を初期化/更新 (Discord関連IDを含むよう変更)
    gameSession = {
      serverId: serverId,
      gameTitle: gameTitle,
      categoryId: newCategory.id, // 追加
      channels: { // 追加
        gm: gmChannel.id,
        vote: voteChannel.id,
        announce: announceChannel.id,
      },
      playerListMessageId: postedMessage.id, // 追加
      roles: [], // rolesはリセット
      voteResult: null,
      fortuneResults: [],
      mediumResults: [],
      winningFaction: null,
    };
    // 元のログメッセージを維持しつつ、セッションの初期化を示す
    console.log('Received /game/setup request:', req.body);
    console.log(`サーバーID: ${serverId}, ゲームタイトルを設定: ${gameTitle}. セッションを初期化しDiscordエンティティを作成しました。`);
    console.log(`  Category ID: ${newCategory.id}, Announce Ch ID: ${announceChannel.id}, Player List Msg ID: ${postedMessage.id}`);


    res.status(200).json({
      message: `Game "${gameTitle}" setup successful on server "${guild.name}". Discord entities created.`, // レスポンスメッセージを調整
      categoryId: newCategory.id,
      channels: gameSession.channels,
      playerListMessageId: postedMessage.id,
    });

  } catch (error) {
    console.error('/game/setup: Error during Discord operations:', error); // 必要なエラーログ
    // Discord APIエラーに関する基本的なハンドリング (機能追加に必須)
    let errorMessage = 'Failed to setup game on Discord due to an internal error.';
    if (error.code === 50013) { // Missing Permissions
      errorMessage = 'Discord API Error: Bot is missing permissions to perform an action.';
    } else if (error.name === 'DiscordAPIError' && error.message.includes('Unknown Channel')) {
      errorMessage = 'Discord API Error: An unknown channel was encountered.';
    }
    return res.status(500).json({ message: errorMessage, details: error.message });
  }
});

// 2.2. プレイヤーリスト取得
app.get('/player/list', (req, res) => {
  console.log('Received /player/list request');
  if (!gameSession.serverId) {
    console.warn('/player/list called before /game/setup or without a valid serverId in session.');
  }
  res.status(200).json(playerList);
});

// 2.3. 配役リスト送信
app.post('/role/list/add', (req, res) => {
  const rolesData = req.body; // API仕様書に基づき、これがプレイヤー情報の配列
  if (!Array.isArray(rolesData)) {
    return res.status(400).json({ message: "Role list must be an array" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle) {
    console.warn('/role/list/add called before /game/setup.');
    // return res.status(400).json({ message: "Game not set up. Please call /game/setup first." });
  }
  // gameSession.roles に配役情報を格納。ここには screenName も含まれる想定
  gameSession.roles = rolesData.map(roleInfo => ({
    discordId: roleInfo.discordId,
    screenName: roleInfo.screenName, // ゲーム内表示名
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

// 2.4. 投票結果送信
app.post('/vote/result', (req, res) => {
  const voteData = req.body;
  if (!voteData || typeof voteData.executedPlayerNumber === 'undefined') {
    return res.status(400).json({ message: "executedPlayerNumber is required" });
  }
  if (!gameSession.serverId || !gameSession.gameTitle) {
    console.warn('/vote/result called before /game/setup.');
  }
  gameSession.voteResult = voteData;
  const executedPlayerName = getPlayerScreenName(voteData.executedPlayerNumber); // 処刑者のscreenNameを取得
  console.log('Received /vote/result request for serverId:', gameSession.serverId, ' gameTitle:', gameSession.gameTitle);
  console.log('Request body:', req.body);
  console.log(`投票結果を受信。処刑者: ${executedPlayerName} (P${voteData.executedPlayerNumber})`);
  res.status(200).json({ message: 'Vote result received successfully' });
});

// 2.5. 占い結果送信
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

// 2.6. 霊媒結果送信
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

// 2.7. ゲーム終了通知
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
  gameSession = { // セッション情報をリセット
    serverId: null,
    gameTitle: null,
    // Discord関連IDもリセット (変更)
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

// 存在しないパスへのフォールバック
app.use((req, res) => {
  res.status(404).send('Sorry, cant find that!');
});