// jinro.js
// 人狼ゲームロジックライブラリ
// 通信層に依存せず、様々なアプリケーションに組み込むことを前提とした実装

// ========================================================
// 1. Regulation クラス
// ゲーム開始前のルール設定を保持し、自動／手動役職割り当ての選択なども管理する
class Regulation {
  /**
   * @param {object} config
   * @param {number} config.minPlayers - 必要最低プレイヤー数
   * @param {object} config.roleDistribution - 自動割り当て時の役職人数（例: { "占い師": 1, "村人": 2, "人狼": 1, ... }）
   * @param {boolean} config.allowConsecutiveGuard - 連続護衛の許可
   * @param {TieResolutionStrategy} config.tieResolutionStrategy - 投票同数時の処理戦略
   * @param {number} config.tieRepeatThreshold - 同数連続時の閾値
   * @param {boolean} config.finalVoteRequired - 決戦投票の必須実施の有無
   * @param {boolean} config.manualRoleAssignment - true の場合、管理者が手動で役職を設定可能
   */
  constructor({
    minPlayers = 5,
    roleDistribution = null,
    allowConsecutiveGuard = false,
    tieResolutionStrategy = new RandomExecutionStrategy(),
    tieRepeatThreshold = 3,
    finalVoteRequired = true,
    manualRoleAssignment = false
  } = {}) {
    this.minPlayers = minPlayers;
    this.roleDistribution = roleDistribution;
    this.allowConsecutiveGuard = allowConsecutiveGuard;
    this.tieResolutionStrategy = tieResolutionStrategy;
    this.tieRepeatThreshold = tieRepeatThreshold;
    this.finalVoteRequired = finalVoteRequired;
    this.manualRoleAssignment = manualRoleAssignment;
  }
}

// ========================================================
// 2. TieResolutionStrategy インターフェースと実装
class TieResolutionStrategy {
  /**
   * 投票同数時の処理を実施する
   * @param {Array<number>} tiedPlayerIds - 同数票を得たプレイヤーのIDリスト
   * @param {number} tieCount - これまでの同数回数
   * @param {number} threshold - 引き分けとする閾値
   * @returns {number | null | "draw"}
   */
  resolve(tiedPlayerIds, tieCount, threshold) {
    throw new Error("resolve() must be implemented by subclass");
  }
}

// ランダムに1人を決定する戦略
class RandomExecutionStrategy extends TieResolutionStrategy {
  resolve(tiedPlayerIds, tieCount, threshold) {
    const randomIndex = Math.floor(Math.random() * tiedPlayerIds.length);
    return tiedPlayerIds[randomIndex];
  }
}

// 投票同数時に処刑を行わない戦略
class NoExecutionStrategy extends TieResolutionStrategy {
  resolve(tiedPlayerIds, tieCount, threshold) {
    return null;
  }
}

// 同数が一定回数以上続いた場合に引き分けとする戦略
class DrawAfterMultipleTiesStrategy extends TieResolutionStrategy {
  resolve(tiedPlayerIds, tieCount, threshold) {
    if (tieCount >= threshold) {
      return "draw";
    }
    const randomIndex = Math.floor(Math.random() * tiedPlayerIds.length);
    return tiedPlayerIds[randomIndex];
  }
}

// ========================================================
// 3. Ability インターフェースと実装例
class Ability {
  /**
   * 能力を実行する
   * @param {JinroGame} game - ゲーム全体のインスタンス
   * @param {Players} actingPlayer - 能力を使用するプレイヤー
   * @param {Players} [targetPlayer] - 対象プレイヤー（必要に応じて）
   */
  execute(game, actingPlayer, targetPlayer) {
    throw new Error("execute() must be implemented by subclass");
  }
}

// 占い師の能力（SeerAbility）
class SeerAbility extends Ability {
  execute(game, actingPlayer, targetPlayer) {
    if (!targetPlayer || !targetPlayer.role) {
      console.log(`${actingPlayer.name} : 占い対象が無効です。`);
      return;
    }
    const result = targetPlayer.role.team === "人狼" ? "人狼" : "村人";
    console.log(`${actingPlayer.name}（占い師）は ${targetPlayer.name} を占い、結果は ${result} でした。`);
    return result;
  }
}

// 狩人／騎士の護衛能力（KnightAbility）
class KnightAbility extends Ability {
  execute(game, actingPlayer, targetPlayer) {
    if (!targetPlayer) {
      console.log(`${actingPlayer.name} : 護衛対象が無効です。`);
      return;
    }
    targetPlayer.guarded = true;
    console.log(`${actingPlayer.name}（狩人／騎士）は ${targetPlayer.name} を護衛しました。`);
  }
}

// ========================================================
// 4. Players クラス
class Players {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.role = null; // 後で割り当て
    this.alive = true;
    this.vote = 0;
    this.guarded = false; // 護衛状態
  }
  resetVote() {
    this.vote = 0;
  }
}

// ========================================================
// 5. Roles クラス
class Roles {
  constructor(name, team, result = null, curse = false, kill = false, abilities = []) {
    this.name = name;
    this.team = team;
    this.result = result;
    this.curse = curse;
    this.kill = kill;
    this.abilities = abilities;
  }
}

// ========================================================
// 6. Phase クラス
class Phase {
  constructor() {
    this.phase = 0; // 0: 夜, 1: 昼
  }
  togglePhase() {
    this.phase = this.phase === 0 ? 1 : 0;
  }
  getPhase() {
    return this.phase;
  }
}

// ========================================================
// 7. Vote クラス
class Vote {
  constructor(voterId, targetId) {
    this.voterId = voterId;
    this.targetId = targetId;
  }
}

// ========================================================
// 8. VoteManager クラス
class VoteManager {
  constructor() {
    this.votes = [];
  }
  addVote(voterId, targetId) {
    this.votes.push(new Vote(voterId, targetId));
  }
  tallyVotes() {
    const results = {};
    this.votes.forEach(vote => {
      results[vote.targetId] = (results[vote.targetId] || 0) + 1;
    });
    return results;
  }
  clearVotes() {
    this.votes = [];
  }
}

// ========================================================
// 9. GameProgress クラス
class GameProgress {
  constructor() {
    this.currentPhase = 0;
    this.dayCount = 1;
    this.time = "00:00";
  }
  updatePhase(newPhase) {
    this.currentPhase = newPhase;
  }
  nextDay() {
    this.dayCount++;
  }
  updateTime(newTime) {
    this.time = newTime;
  }
}

// ========================================================
// 10. WinCondition クラス
class WinCondition {
  /**
   * プレイヤーの状態に基づいて勝敗を判定する
   * @param {Array<Players>} players
   * @returns {string|null} 勝利陣営の名前または null（ゲーム続行中）
   */
  static check(players) {
    let villagers = 0, werewolves = 0, foxes = 0;
    players.forEach(player => {
      if (player.alive && player.role && player.role.team) {
        if (player.role.team === "村人") villagers++;
        else if (player.role.team === "人狼") werewolves++;
        else if (player.role.team === "狐") foxes++;
      }
    });
    if (werewolves === 0) return "村人陣営勝利";
    if (werewolves >= villagers) return "人狼陣営勝利";
    return null;
  }
}

// ========================================================
// 11. NightPhaseManager クラス
class NightPhaseManager {
  /**
   * @param {JinroGame} game - JinroGame のインスタンス
   */
  constructor(game) {
    this.game = game;
  }
  executeAbilities() {
    // 各生存プレイヤーが持つ各能力を実行
    this.game.players.forEach(player => {
      if (player.alive && player.role && Array.isArray(player.role.abilities)) {
        player.role.abilities.forEach(ability => {
          // 実際の対象選択はアプリケーション側で行うため、ここではシンプルに実行するか、
          // もしくは能力実行のタイミングのみ通知する形にする
          ability.execute(this.game, player);
        });
      }
    });
  }
  resetAfterNight() {
    this.game.resetVotes();
    this.game.phase.togglePhase();
    this.game.gameProgress.updatePhase(this.game.phase.getPhase());
    if (this.game.phase.getPhase() === 1) {
      this.game.gameProgress.nextDay();
    }
  }
  processNight() {
    console.log("夜フェーズ処理開始");
    this.executeAbilities();
    this.resetAfterNight();
  }
}

// ========================================================
// 12. Default Roles 配列（自動割り当て用例）
// 例として、8人用のデフォルト役職リスト
const defaultRoles = [
  new Roles("占い師", "村人", null, false, false, [new SeerAbility()]),
  new Roles("村人", "村人", null, false, false, []),
  new Roles("人狼", "人狼", null, false, true, []),
  new Roles("狐", "狐", null, false, false, []),
  new Roles("霊能者", "村人", null, false, false, []),
  new Roles("狩人", "村人", null, false, false, [new KnightAbility()]),
  new Roles("共有者", "村人", null, false, false, []),
  new Roles("狂人", "人狼", null, false, false, [])
];

// ========================================================
// 13. JinroGame クラス（全体のファサード）
class JinroGame {
  constructor(regulation) {
    this.regulation = regulation || new Regulation();
    this.players = [];
    this.phase = new Phase();
    this.voteManager = new VoteManager();
    this.gameProgress = new GameProgress();
    this.gameStarted = false;
    this.gameEnded = false;
    this.tieCount = 0;
    this.nightPhaseManager = new NightPhaseManager(this);
  }
  addPlayer(name) {
    const id = this.players.length;
    this.players.push(new Players(name, id));
  }
  checkGameStartCondition() {
    return this.players.length >= this.regulation.minPlayers;
  }
  startGame() {
    if (!this.checkGameStartCondition()) {
      console.log("ゲーム開始条件を満たしていません。");
      return;
    }
    this.gameStarted = true;
    console.log("ゲーム開始！");
    if (!this.regulation.manualRoleAssignment) {
      this.assignRoles();
    }
  }
  assignRoles() {
    if (this.regulation.roleDistribution) {
      const totalRoles = Object.values(this.regulation.roleDistribution).reduce((sum, count) => sum + count, 0);
      if (totalRoles !== this.players.length) {
        console.log("プレイヤー数と役職割り当て数が一致しません。");
        return;
      }
      const assignedRoles = [];
      for (const [roleName, count] of Object.entries(this.regulation.roleDistribution)) {
        for (let i = 0; i < count; i++) {
          const roleObj = defaultRoles.find(r => r.name === roleName);
          if (roleObj) {
            assignedRoles.push(new Roles(roleObj.name, roleObj.team, roleObj.result, roleObj.curse, roleObj.kill, roleObj.abilities));
          }
        }
      }
      // シャッフル
      for (let i = assignedRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [assignedRoles[i], assignedRoles[j]] = [assignedRoles[j], assignedRoles[i]];
      }
      this.players.forEach((player, index) => {
        player.role = assignedRoles[index];
      });
    } else {
      if (this.players.length !== defaultRoles.length) {
        console.log("プレイヤー数とデフォルト役職数が一致しません。");
        return;
      }
      const shuffledRoles = defaultRoles.slice();
      for (let i = shuffledRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledRoles[i], shuffledRoles[j]] = [shuffledRoles[j], shuffledRoles[i]];
      }
      this.players.forEach((player, index) => {
        player.role = shuffledRoles[index];
      });
    }
  }
  setPlayerRole(playerId, role) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.role = role;
    } else {
      console.log("指定されたプレイヤーが見つかりません。");
    }
  }
  vote(voterId, targetId) {
    const voter = this.players.find(p => p.id === voterId && p.alive);
    if (!voter) {
      console.log("投票者が見つからないか、死亡しています。");
      return;
    }
    const target = this.players.find(p => p.id === targetId && p.alive);
    if (!target) {
      console.log("投票先が見つからないか、死亡しています。");
      return;
    }
    this.voteManager.addVote(voterId, targetId);
    target.vote++;
  }
  getVoteResults() {
    return this.voteManager.tallyVotes();
  }
  finalVote() {
    console.log("決戦投票を実施します。");
    return this.getVoteResults();
  }
  resolveVoteTie(tiedPlayerIds) {
    if (this.regulation.finalVoteRequired) {
      console.log("最終決戦投票を実施します。");
      const finalResults = this.finalVote();
      const maxVotes = Math.max(...Object.values(finalResults));
      const tiedIdsAfterFinal = Object.keys(finalResults)
        .filter(id => finalResults[id] === maxVotes)
        .map(Number);
      if (tiedIdsAfterFinal.length === 1) {
        return tiedIdsAfterFinal[0];
      } else {
        tiedPlayerIds = tiedIdsAfterFinal;
      }
    }
    const resolved = this.regulation.tieResolutionStrategy.resolve(tiedPlayerIds, this.tieCount, this.regulation.tieRepeatThreshold);
    if (resolved === "draw") {
      console.log("同数が連続し、引き分けと判断します。");
      return "draw";
    }
    return resolved;
  }
  processNightPhase() {
    this.nightPhaseManager.processNight();
  }
  resetVotes() {
    this.players.forEach(player => player.resetVote());
    this.voteManager.clearVotes();
  }
  checkWinCondition() {
    const result = WinCondition.check(this.players);
    if (result) {
      console.log("勝敗判定:", result);
      this.gameEnded = true;
    } else {
      console.log("ゲーム続行中...");
    }
    return result;
  }
  endGame() {
    this.gameEnded = true;
    console.log("ゲーム終了！");
  }
  updateGameProgress(newTime) {
    this.gameProgress.updateTime(newTime);
  }
}

// ========================================================
// エクスポート（CommonJS形式）
module.exports = {
  Regulation,
  RandomExecutionStrategy,
  NoExecutionStrategy,
  DrawAfterMultipleTiesStrategy,
  Ability,
  SeerAbility,
  KnightAbility,
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
};
