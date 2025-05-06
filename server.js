// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// ライブラリの各クラスを jinro-master.js から読み込み
const {
  Regulation,
  RandomExecutionStrategy,
  JinroGame,
  Players,
  Roles,
  defaultRoles,
  Phase,
  Vote,
  VoteManager,
  GameProgress,
  WinCondition,
  NightPhaseManager
} = require('./jinroliv.js');

// Express アプリケーション作成
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 静的ファイルの提供 (public フォルダ内に index.html, client.js, style.css を配置)
app.use(express.static(path.join(__dirname, 'public')));

// Regulation の設定（例：最低プレイヤー数 5、手動割り当ては false で自動割り当て、ランダム処刑を採用）
const regulation = new Regulation({
  minPlayers: 5,
  // roleDistribution: { "占い師": 1, "村人": 2, "人狼": 1, "狂人": 1 }, // 自動割り当ての場合の例
  manualRoleAssignment: false,
  tieResolutionStrategy: new RandomExecutionStrategy(),
  tieRepeatThreshold: 3,
  finalVoteRequired: true
});

// JinroGame インスタンスの生成
const game = new JinroGame(regulation);

// 補助関数：最新のゲーム状態を全クライアントにブロードキャスト
function broadcastGameStatus() {
  io.emit("game_status", {
    players: game.players,
    phase: game.phase.getPhase(),
    day: game.gameProgress.dayCount,
    votes: game.voteManager.tallyVotes()
  });
}

// Socket.IO の接続処理
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // クライアント接続時、現在のゲーム状態を送信
  socket.emit("game_status", {
    players: game.players,
    phase: game.phase.getPhase(),
    day: game.gameProgress.dayCount,
    votes: game.voteManager.tallyVotes()
  });

  // プレイヤー追加要求
  socket.on("add_player", (data) => {
    const { name } = data;
    game.addPlayer(name);
    io.emit("player_added", game.players[game.players.length - 1]);
    broadcastGameStatus();
  });

  // ゲーム開始要求
  socket.on("game_start", () => {
    game.startGame();
    io.emit("game_started", { message: "ゲーム開始！", players: game.players });
    broadcastGameStatus();
  });

  // 手動役職割り当て要求（manualRoleAssignment が true の場合に利用）
  socket.on("set_player_role", (data) => {
    const { playerId, roleName } = data;
    // defaultRoles から該当する役職情報を探す
    const roleObj = defaultRoles.find(r => r.name === roleName);
    if (roleObj) {
      const newRole = new Roles(roleObj.name, roleObj.team, roleObj.result, roleObj.curse, roleObj.kill, roleObj.abilities);
      game.setPlayerRole(playerId, newRole);
      io.emit("game_status", { players: game.players });
    } else {
      socket.emit("error", { message: "無効な役職名です。" });
    }
    broadcastGameStatus();
  });

  // 投票要求
  socket.on("vote", (data) => {
    const { voterId, targetId } = data;
    game.vote(voterId, targetId);
    io.emit("vote_results", { results: game.getVoteResults() });
    broadcastGameStatus();
  });

  // 夜フェーズ処理要求
  socket.on("process_night", () => {
    game.processNightPhase();
    io.emit("night_processed", {
      phase: game.phase.getPhase(),
      day: game.gameProgress.dayCount
    });
    broadcastGameStatus();
  });

  // 勝敗判定要求
  socket.on("win_condition", () => {
    const result = game.checkWinCondition();
    socket.emit("win_condition", { result: result });
  });

  // ゲーム終了要求
  socket.on("game_end", () => {
    game.endGame();
    io.emit("game_ended", { message: "ゲーム終了！", result: game.checkWinCondition() });
    broadcastGameStatus();
  });

  // クライアント切断時の処理
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// サーバー起動
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
