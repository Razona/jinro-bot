// client.js
document.addEventListener('DOMContentLoaded', () => {
  // Socket.IO クライアントでサーバーに接続
  const socket = io();

  // DOM 要素のキャッシュ
  const statusDisplay = document.getElementById('statusDisplay');
  const addPlayerBtn = document.getElementById('addPlayerBtn');
  const playerNameInput = document.getElementById('playerName');
  const startGameBtn = document.getElementById('startGameBtn');
  const manualRoleAssignmentDiv = document.getElementById('manualRoleAssignment');
  const rolePlayerIdInput = document.getElementById('rolePlayerId');
  const roleSelect = document.getElementById('roleSelect');
  const setRoleBtn = document.getElementById('setRoleBtn');
  const voterIdInput = document.getElementById('voterId');
  const targetIdInput = document.getElementById('targetId');
  const voteBtn = document.getElementById('voteBtn');
  const processNightBtn = document.getElementById('processNightBtn');
  const winConditionBtn = document.getElementById('winConditionBtn');
  const endGameBtn = document.getElementById('endGameBtn');

  // サーバーから受信した最新のゲーム状態を表示
  socket.on('game_status', (data) => {
    statusDisplay.textContent = JSON.stringify(data, null, 2);
  });

  // プレイヤー追加時の通知
  socket.on('player_added', (player) => {
    console.log('Player added:', player);
  });

  // ゲーム開始時の通知
  socket.on('game_started', (data) => {
    console.log('Game started:', data);
    // manualRoleAssignment の設定によって、手動割り当てモードの場合のみ表示
    if (data.manualRoleAssignment) {
      manualRoleAssignmentDiv.style.display = 'block';
    } else {
      manualRoleAssignmentDiv.style.display = 'none';
    }
  });

  // 投票結果の更新
  socket.on('vote_results', (data) => {
    console.log('Vote results:', data);
  });

  // 夜フェーズ処理完了通知
  socket.on('night_processed', (data) => {
    console.log('Night processed:', data);
  });

  // 勝敗判定結果の受信
  socket.on('win_condition', (data) => {
    alert('勝敗判定結果: ' + data.result);
  });

  // ゲーム終了通知
  socket.on('game_ended', (data) => {
    alert('ゲーム終了: ' + data.message + '\n結果: ' + data.result);
  });

  // エラーメッセージの受信
  socket.on('error', (data) => {
    alert('エラー: ' + data.message);
  });

  // イベントリスナーの設定

  // プレイヤー追加
  addPlayerBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) {
      socket.emit('add_player', { name });
      playerNameInput.value = '';
    }
  });

  // ゲーム開始
  startGameBtn.addEventListener('click', () => {
    socket.emit('game_start');
  });

  // 手動役職設定
  setRoleBtn.addEventListener('click', () => {
    const playerId = parseInt(rolePlayerIdInput.value, 10);
    const roleName = roleSelect.value;
    if (!isNaN(playerId) && roleName) {
      socket.emit('set_player_role', { playerId, roleName });
      rolePlayerIdInput.value = '';
    }
  });

  // 投票処理
  voteBtn.addEventListener('click', () => {
    const voterId = parseInt(voterIdInput.value, 10);
    const targetId = parseInt(targetIdInput.value, 10);
    if (!isNaN(voterId) && !isNaN(targetId)) {
      socket.emit('vote', { voterId, targetId });
      voterIdInput.value = '';
      targetIdInput.value = '';
    }
  });

  // 夜フェーズ処理
  processNightBtn.addEventListener('click', () => {
    socket.emit('process_night');
  });

  // 勝敗判定
  winConditionBtn.addEventListener('click', () => {
    socket.emit('win_condition');
  });

  // ゲーム終了
  endGameBtn.addEventListener('click', () => {
    socket.emit('game_end');
  });
});
