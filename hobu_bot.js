require('dotenv').config();

//expressにてapiサーバーも立てる
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');


app.use(express.static(path.join(__dirname, 'public'))); // publicフォルダ内の静的ファイルを提供

server.listen(80, () => {
  console.log('サーバーがポート80で起動しました。');
}
);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // index.htmlを返す
}
);

let userList = [
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

app.get('user-list/pull ', (req, res) => {
  //json形式で返す
  res.json(userList);
}
);