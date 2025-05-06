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