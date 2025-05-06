// jinro-master.js
// 人狼ゲームライブラリ (Manual Role Assignment 対応版)

// -----------------------------
// TieResolutionStrategy とその実装

// 基本の戦略インターフェース（抽象クラスとして実装）
class TieResolutionStrategy {
  /**
   * 投票同数時の処理を実施する
   * @param {Array<number>} tiedPlayerIds - 同数票のプレイヤーIDリスト
   * @param {number} tieCount - これまでの同数回数
   * @param {number} threshold - 引き分けとするための閾値
   * @returns {number|null|"draw"} - 決定したプレイヤーID、処刑なし（null）、または "draw"（引き分け）
   */
  resolve(tiedPlayerIds, tieCount, threshold) {
    throw new Error("resolve() must be implemented");
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
    // それ以外はランダム処刑（または別途戦略を実装可能）
    const randomIndex = Math.floor(Math.random() * tiedPlayerIds.length);
    return tiedPlayerIds[randomIndex];
  }
}

// -----------------------------
// Ability インターフェースと実装例

// Ability インターフェース（抽象クラス）
class Ability {
  /**
   * 能力を実行する
   * @param {JinroGame} game - ゲーム全体のインスタンス
   * @param {Players} actingPlayer - 能力を使用するプレイヤー
   * @param {Players} [targetPlayer] - 対象となるプレイヤー（必要に応じて）
   */
  execute(game, actingPlayer, targetPlayer) {
    throw new Error("execute() must be implemented");
  }
}

// 占い師の能力：対象プレイヤーの所属陣営を判定する例
class SeerAbility extends Ability {
  execute(game, actingPlayer, targetPlayer) {
    if (!targetPlayer || !targetPlayer.role) {
      console.log(`${actingPlayer.name}：占い対象が無効です。`);
      return;
    }
    console.log(`${actingPlayer.name}の占い結果: ${targetPlayer.name}は ${targetPlayer.role.team} 陣営です。`);
  }
}

// 狩人／騎士の護衛能力：対象プレイヤーに護衛状態を付与する例
class KnightAbility extends Ability {
  execute(game, actingPlayer, targetPlayer) {
    if (!targetPlayer) {
      console.log(`${actingPlayer.name}：護衛対象が無効です。`);
      return;
    }
    targetPlayer.guarded = true;
    console.log(`${actingPlayer.name}は ${targetPlayer.name} を護衛しました。`);
  }
}

// -----------------------------
// Players クラス
// プレイヤー情報：名前、ID、役職、生死、票数、その他必要な状態
class Players {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.role = null; // 初期状態は未割り当て
    this.alive = true;
    this.vote = 0;
    this.guarded = false; // 護衛状態（必要に応じて利用）
  }

  resetVote() {
    this.vote = 0;
  }
}

// -----------------------------
// Roles クラス
// 役職情報：名前、陣営、占い結果、呪殺、キル能力、固有能力（Ability のリスト）
class Roles {
  constructor(name, team, result, curse, kill, abilities = []) {
    this.name = name;
    this.team = team;
    this.result = result;
    this.curse = curse;
    this.kill = kill;
    this.abilities = abilities;
  }
}

// 外部変数 defaultRoles：自動割り当て用の初期役職リスト（例として16A環境向け）
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

// -----------------------------
// Phase クラス
// 昼夜のフェーズ管理：0 = 夜、1 = 昼
class Phase {
  constructor() {
    this.phase = 0;
  }

  togglePhase() {
    this.phase = this.phase === 0 ? 1 : 0;
  }

  getPhase() {
    return this.phase;
  }
}

// -----------------------------
// Vote クラス
// 単一の投票情報を保持（投票者と投票先）
class Vote {
  constructor(voterId, targetId) {
    this.voterId = voterId;
    this.targetId = targetId;
  }
}

// -----------------------------
// VoteManager クラス
// 投票情報の登録、集計、クリアを管理
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

// -----------------------------
// GameProgress クラス
// ゲーム進行状況：現在のフェーズ、日数、時刻
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

// -----------------------------
// WinCondition クラス
// プレイヤーの状態から勝敗を判定する（例：村人陣営勝利、人狼陣営勝利）
class WinCondition {
  static check(players) {
    let villagers = 0, werewolves = 0, foxes = 0;
    players.forEach(player => {
      if (player.alive && player.role && player.role.team) {
        if (player.role.team === "村人") villagers++;
        else if (player.role.team === "人狼") werewolves++;
        else if (player.role.team === "狐") foxes++;
      }
    });
    if (werewolves === 0) {
      return "村人陣営勝利";
    } else if (werewolves >= villagers) {
      return "人狼陣営勝利";
    }
    return null; // ゲーム続行中
  }
}

// -----------------------------
// NightPhaseManager クラス
// 夜フェーズにおける能力実行および状態更新の処理を管理
class NightPhaseManager {
  constructor(game) {
    this.game = game;
  }

  executeAbilities() {
    // 各プレイヤーの能力を順次実行（実装例として全員の能力を呼び出す）
    this.game.players.forEach(player => {
      if (player.alive && player.role && player.role.abilities) {
        player.role.abilities.forEach(ability => {
          // ※ 本来は対象プレイヤーを指定するなど、より複雑なロジックが必要
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
    console.log("夜の処理を開始します。");
    this.executeAbilities();
    this.resetAfterNight();
  }
}

// -----------------------------
// Regulation クラス
// ゲーム開始時に適用する各種ルール設定を管理する
class Regulation {
  /**
   * @param {object} config
   * @param {number} config.minPlayers - ゲーム開始に必要な最低プレイヤー数
   * @param {object} config.roleDistribution - 自動割り当て時の役職ごとの人数割り当て例
   * @param {boolean} config.allowConsecutiveGuard - 連続護衛の許可
   * @param {TieResolutionStrategy} config.tieResolutionStrategy - 投票同数時の処理戦略
   * @param {number} config.tieRepeatThreshold - 同数が連続した場合の閾値
   * @param {boolean} config.finalVoteRequired - 同数の場合、必ず決戦投票を実施するか
   * @param {boolean} config.manualRoleAssignment - true なら手動で役職を割り当てる
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

// -----------------------------
// JinroGame クラス
// ゲーム全体の状態管理および操作を統括するファサードクラス
class JinroGame {
  /**
   * @param {Regulation} regulation - ゲームのルール設定
   */
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

  // 自動割り当てモードの場合の役職割り当て
  assignRoles() {
    if (this.regulation.roleDistribution) {
      const totalRoles = Object.values(this.regulation.roleDistribution).reduce((sum, count) => sum + count, 0);
      if (totalRoles !== this.players.length) {
        console.log("プレイヤー数と役職の割り当て数が一致しません。");
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
        console.log("プレイヤー数と外部役職数が一致しません。");
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

  // 手動割り当てモード用：特定のプレイヤーに役職を設定
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
    // 簡略化のため、再度集計する例
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
    const resolved = this.regulation.tieResolutionStrategy.resolve(
      tiedPlayerIds,
      this.tieCount,
      this.regulation.tieRepeatThreshold
    );
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

// -----------------------------
// 製品としての公開用エクスポート
function jinro_master(msg) {
  console.log(msg);
}

module.exports = {
  jinro_master,
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
