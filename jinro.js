//人狼ゲームのゲームマスターとしての処理を行うためのスクリプト
//最低限16A環境に対応できれば良いが、できれば様々なレギュレーションに対応することを目指したい
//まずは人狼ゲームの基本的な機能を実装することを目指す

function jinro_master(msg) {
  console.log(msg);
}

//人狼ゲームのゲーム状況を管理するクラス
//プレイヤー情報,役職情報,フェーズ情報を持つ
//プレイヤー情報はプレイヤー名,ユニークid,役職,生死,投票数を持つ
//役職情報は役職名,陣営,占い結果,呪殺,キル能力の有無を持つ
//フェーズ情報は昼夜のフェーズを管理する
//他に管理すべき情報はなんでしょうか?
//A: 投票情報,投票結果,勝敗判定,ゲーム終了判定,ゲーム開始判定,ゲーム進行状況
//投票情報は投票者,投票先,投票数を持つ
//投票結果は投票先,投票数を持つ
//勝敗判定は村人陣営勝利,人狼陣営勝利,狐陣営勝利,引き分けを持つ
//ゲーム終了判定はゲーム終了条件を満たしたかを判定する
//ゲーム開始判定はゲーム開始条件を満たしたかを判定する
//ゲーム進行状況は現在のフェーズ,日数,時間を持つ
//これらの情報を持つクラスを作成する
//クラス名はJinroGameとする
//JinroGameはプレイヤー情報,役職情報,フェーズ情報を持つ
//プレイヤー情報はPlayersクラスを持つ
//役職情報はRolesクラスを持つ
//フェーズ情報はPhaseクラスを持つ
//Q:JinroGameクラスはどのようなメソッドを持たせるべきか?
//A: ゲーム開始,ゲーム終了,投票,投票結果,勝敗判定,ゲーム終了判定,ゲーム開始判定,ゲーム進行状況の更新を行うメソッドを持たせるべき
//Q:JinroGameクラスが肥大化しすぎているのではないかという懸念があります。問題がないと判断する場合はその根拠を教えてください。
//A: JinroGameクラスは人狼ゲームのゲーム状況を管理するクラスであり、それに必要な情報を持たせているため問題ないと判断する。
//今回のゲームで必要な役職者の種類と数をJinroGameにて管理する
//役職者の名前と能力のリストをJinroGmaeクラスの外側で記述する必要がある
//Q:役職者の名前と能力のリストはどのような形で記述すべきでしょうか
//A: 役職者の名前と能力のリストは役職名と能力のリストを持つオブジェクトを作成し、それを配列に格納する
//Q:それは変数という形で宣言すれば良い？
//A: それは変数として宣言することで、JinroGameクラスの外側で定義された変数を参照することができる
//Q：変数の名前は?
//A: rolesとする
//Q:役職者の能力実行はどこに記述すべきでしょうか.ちなみに能力実行は基本的に夜時間に行われるものとします
//A: 能力実行は夜時間に行われるものであるため、夜時間の処理を行うメソッドに記述すべき
//Q:夜時間の処理はどこに記述すべきでしょうか
//A: JinroGameクラスに夜時間の処理を行うメソッドを記述すべき
//Q:夜時間の処理を別のクラスに切り出すのはどうでしょうか。デメリットがある場合はそのデメリットを教えてください
//A: 夜時間の処理を別のクラスに切り出すことで、JinroGameクラスの肥大化を防ぐことができるが、夜時間の処理がJinroGameクラスに依存するため、夜時間の処理を変更する際にJinroGameクラスも変更する必要がある

class JinroGame {
  //JinroGameクラスの内容を記述
  constructor() {
    this.players = [];
    this.roles = [];
    this.phase = new Phase();
  }
  //プレイヤー情報を追加するメソッド
  //プレイヤー名を引数に取り、プレイヤー情報を追加する
  addPlayer(name) {
    let id = this.players.length;
    this.players.push(new Players(name, id));
  }
}

//プレイヤー名(strings),ユニークid(int),役職(Strings),生死(bool),票数(int)
//事前に入力が必要なのはプレイヤー名、ユニークidはゲームごとに0から順に自動生成,生死はデフォルトでtrue死亡するとfalt
// 票数はデフォルトは0で投票されるたびにカウントされて、夜時間が来ると0にリセット
//役職は役職配布コマンドを実行するタイミングで割り振る、その前はnull(もしくは"割り当て前"を役職名にしてしまう)
class Players {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.role = 0;
    this.alive = true;
    this.vote = 0;
  }
}

//役職に関するクラス
//役職名,陣営(村人,人狼,狐 等々),占い結果(黒or白),呪殺(占われて死ぬ場合はtrue,それ以外はfalse),キル能力の有無(boolean)
class Roles {
  constructor(name, team, result, curse, kill) {
    this.name = name;
    this.team = team;
    this.result = result;
    this.curse = curse;
    this.kill = kill;
  }
}

//役職者の名前と能力のリストを記述
//16Aにて使用する役職のみを記述
//役職名,陣営,占い結果,呪殺,キル能力の有無
//占い師,村人,人狼,狐,霊能者,狩人,共有者,狂人
//狂人は人狼と同じ陣営だが、村人として振る舞う
//狐は人狼に襲撃されても死なない
//霊能者は死んだプレイヤーの役職を知ることができる
//共有者は他の共有者を知ることができる
//狩人は夜に他のプレイヤーを守ることができる
//村人は特殊能力を持たない
//占い師は他のプレイヤーの役職を知ることができる
//人狼は夜に他のプレイヤーを襲撃することができる
const roles = [
  new Roles("占い師", "村人", null, false, false),
  new Roles("村人", "村人", null, false, false),
  new Roles("人狼", "人狼", null, false, true),
  new Roles("狐", "狐", null, false, false),
  new Roles("霊能者", "村人", null, false, false),
  new Roles("狩人", "村人", null, false, false),
  new Roles("共有者", "村人", null, false, false),
  new Roles("狂人", "人狼", null, false, false)
]

//昼夜のフェーズ状態を管理するクラス
//0は夜,1は昼.夜は人狼や役職者の行動、昼は議論と投票,初期値は0
class Phase {
  constructor() {
    this.phase = 0;
  }
}


//投票クラス
class Vote {
  constructor(voterId, targetId) {
    this.voterId = voterId;
    this.targetId = targetId;
  }
}

class VoteManeger {
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
// ゲーム進行状況を管理するクラス
class GameProgress {
  constructor() {
    this.currentPhase = 0; // 0:夜, 1:昼
    this.dayCount = 1;
    this.time = "00:00";//議論時間を管理。現時点では未実装
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
// 勝敗判定を行うクラス
class WinCondition {
  /**
   * プレイヤーの状態から勝敗を判定する
   * 例: 人狼が全滅→村人陣営勝利, 人狼の数が村人の数以上→人狼陣営勝利
   * ※狐や引き分けの条件は必要に応じて追加可能
   */

  static check(players) {
    let villagers = 0, werewolves = 0, foxes = 0;
    players.forEach(players => {
      if (players.alive && players.role == 1) {
        villagers++;
      }
    })
  }
}

module.exports = { jinro_master, JinroGame, Players, Roles };