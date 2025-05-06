require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');

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
  gameTitle: null,
  roles: [],
  voteResult: null,
  fortuneResults: [],
  mediumResults: [],
  winningFaction: null,
  // プレイヤーリストは既存のものを利用
};

// ダミーのプレイヤーリスト
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
  { "discordId": "101112131415161718", "screenName": "ユーザーM", "playerNumber": 13 }
];

// 2.1. ゲーム準備 (タイトル設定とカテゴリ作成)
app.post('/game/setup', (req, res) => {
  const { gameTitle } = req.body;
  if (!gameTitle) {
    return res.status(400).json({ message: "gameTitle is required" });
  }
  gameSession.gameTitle = gameTitle;
  // 実際のDiscord連携は省略
  console.log('Received /game/setup request:', req.body);
  console.log(`ゲームタイトルを設定: ${gameTitle}`);
  res.status(200).json({ message: `Game setup successful. Title: ${gameTitle}` });
});

// 2.2. プレイヤーリスト取得
app.get('/player/list', (req, res) => {
  console.log('Received /player/list request');
  // 実際にはDiscordから取得する処理が入るが、ここではダミーリストを返す
  res.status(200).json(playerList);
});

// 2.3. 配役リスト送信
app.post('/role/list/add', (req, res) => {
  const roles = req.body;
  if (!Array.isArray(roles)) {
    return res.status(400).json({ message: "Role list must be an array" });
  }
  gameSession.roles = roles;
  // 実際のDiscord連携は省略
  console.log('Received /role/list/add request:', req.body);
  console.log(`配役リストを受信。${roles.length}人のプレイヤー情報。`);
  roles.forEach(player => {
    console.log(`  Player ${player.playerNumber} (${player.screenName}): ${player.role}`);
  });
  res.status(200).json({ message: 'Role list added successfully', receivedRoles: roles.length });
});

// 2.4. 投票結果送信
app.post('/vote/result', (req, res) => {
  const voteData = req.body;
  if (!voteData || typeof voteData.executedPlayerNumber === 'undefined') {
    return res.status(400).json({ message: "executedPlayerNumber is required" });
  }
  gameSession.voteResult = voteData;
  // 実際の処理は省略
  console.log('Received /vote/result request:', req.body);
  console.log(`投票結果を受信。処刑者: Player ${voteData.executedPlayerNumber}`);
  res.status(200).json({ message: 'Vote result received successfully' });
});

// 2.5. 占い結果送信
app.post('/night/fortuner', (req, res) => {
  const fortuneData = req.body;
  if (!fortuneData || typeof fortuneData.fortuneTellerPlayerNumber === 'undefined' || typeof fortuneData.targetPlayerNumber === 'undefined' || typeof fortuneData.result === 'undefined') {
    return res.status(400).json({ message: "fortuneTellerPlayerNumber, targetPlayerNumber, and result are required" });
  }
  gameSession.fortuneResults.push(fortuneData);
  // 実際のDiscord通知は省略
  console.log('Received /night/fortuner request:', req.body);
  console.log(`占い結果を受信: 占い師 P${fortuneData.fortuneTellerPlayerNumber} -> 対象 P${fortuneData.targetPlayerNumber} = ${fortuneData.result ? '人狼' : '人間'}`);
  res.status(200).json({ message: 'Fortune result received and processed' });
});

// 2.6. 霊媒結果送信
app.post('/night/medium', (req, res) => {
  const mediumData = req.body;
  if (!mediumData || typeof mediumData.mediumPlayerNumber === 'undefined' || typeof mediumData.deceasedPlayerNumber === 'undefined' || typeof mediumData.result === 'undefined') {
    return res.status(400).json({ message: "mediumPlayerNumber, deceasedPlayerNumber, and result are required" });
  }
  gameSession.mediumResults.push(mediumData);
  // 実際のDiscord通知は省略
  console.log('Received /night/medium request:', req.body);
  console.log(`霊媒結果を受信: 霊媒師 P${mediumData.mediumPlayerNumber} -> 処刑者 P${mediumData.deceasedPlayerNumber} = ${mediumData.result ? '人狼' : '人間'}`);
  res.status(200).json({ message: 'Medium result received and processed' });
});

// 2.7. ゲーム終了通知
app.post('/game/end', (req, res) => {
  const { winningFaction } = req.body;
  if (!winningFaction) {
    // winningFactionがなくても受け付ける仕様の場合もあるため、ここでは警告のみに留める
    console.warn('Received /game/end request without winningFaction.');
  }
  gameSession.winningFaction = winningFaction;
  console.log('Received /game/end request:', req.body);
  console.log(`ゲーム終了通知を受信。勝利陣営: ${winningFaction || '情報なし'}`);
  // ゲームセッション情報をリセットするなどの処理
  gameSession = {
    gameTitle: null,
    roles: [],
    voteResult: null,
    fortuneResults: [],
    mediumResults: [],
    winningFaction: null,
  };
  console.log('ゲームセッション情報をリセットしました。');
  res.status(200).json({ message: `Game ended. Winning faction: ${winningFaction || 'N/A'}. Session reset.` });
});

// 存在しないパスへのフォールバック
app.use((req, res) => {
  res.status(404).send('Sorry, cant find that!');
});