# botサーバー API仕様書

## 1. 概要
本ドキュメントは、オンライン人狼ゲーム支援システムにおける「botサーバー」（本部botバックエンド）が提供するAPIの仕様を定義します。

### 1.1. システム構成
* **スプレッドシート:** GM（ゲームマスター）用UI、ゲームロジック（配役、夜行動/投票判定など）を担当するGoogleスプレッドシート。
* **botサーバー:** 本部botのバックエンドサーバー。スプレッドシートからのAPIリクエストを受け付け、Discord連携（ゲーム準備、プレイヤーリスト取得、役職/結果通知など）を実行します。
    * **APIサーバーのURL:** `https://jinro-api.razona.design`
        (DNS周りでトラブってる場合は `https://jinro-bot-r3rl.onrender.com`)
* **本部bot:** プレイヤー向けUIとして機能するDiscord Bot。botサーバーによって制御されます。

### 1.2. API連携の基本方針
* **呼び出し方向:** APIは基本的に「スプレッドシート → botサーバー」の方向に呼び出されます。
* **トリガー:** スプレッドシートに実装されたボタンが、GMの操作によってAPI呼び出しのトリガーとなります。
* **データ形式:** リクエストボディ、レスポンスボディ共に原則としてJSON形式を使用します。
* **botサーバーの役割:** APIリクエストを受け、Discord上でのカテゴリ/チャンネル作成、メッセージ送信、プレイヤー管理などの操作を実行します。

## 2. APIエンドポイント

### 2.1. ゲーム準備 (タイトル設定とカテゴリ作成)
* **HTTPメソッド:** `POST`
* **パス:** `/game/setup`
* **説明:** ゲームのタイトルを設定し、そのタイトルをカテゴリ名としてDiscord上にゲーム用のカテゴリと基本的なチャンネル（GM用、投票用など、役職チャンネルを除く）を作成します。 通常、ゲーム開始前に最初に呼び出されるAPIです。 discordにてサーバーidの取得が必要。(開発者モードをONにする必要あり) コマンド打つのとどっちが簡素かちょっと要審議かも。
* **トリガー:** スプレッドシートの [ゲーム準備開始] ボタン。
* **スプレッドシート処理:** GMが入力したゲームタイトルをJSON化して送信します。
* **botサーバー処理:**
    1.  受け取ったゲームタイトルを現在のゲームセッション情報として保存します。
    2.  指定されたタイトルでDiscord上に新しいカテゴリを作成します。
    3.  作成したカテゴリ内に、基本的なチャンネル（例: `GMチャンネル`, `投票チャンネル`）を作成します。 役職チャンネルは `/role/list/add` 受信時に作成されます。
    4.  プレイヤーリスト作成用の投稿。 参加するプレイヤーはここにスタンプをつける。
* **リクエストbody (JSON):**
    ```json
    {
       "serverId": "123456789012345678", // DiscordサーバーID,
      "gameTitle": "13ア式-5月5日" // Discordカテゴリ名として使用
    }
    ```

### 2.2. プレイヤーリスト手動登録
* **HTTPメソッド:** `POST`
* **パス:** `/player/list/manual`
* **説明:** JSON形式でプレイヤーリストを直接botサーバーに送信し、現在のゲームセッションのプレイヤーリストとして設定します。Discordのリアクション機能を使用せずにプレイヤーを登録したい場合や、テスト時に使用します。このAPIでリストが登録された場合、`/player/list` (リアクション経由) APIはこの手動登録リストを優先して返却します。`/game/setup` の後に呼び出します。
* **トリガー:** スプレッドシートの [プレイヤーリスト手動登録] ボタン (新設)。
* **スプレッドシート処理:** GMが入力またはシート上で管理しているプレイヤー情報（Discord ID, 表示名, プレイヤー番号）をJSON化して送信します。
* **botサーバー処理:**
    1.  受け取ったプレイヤーリストを現在のゲームセッションのプレイヤー情報として保存します（既存のプレイヤー情報がある場合は上書きされます）。
    2.  以降、`/player/list` APIはこの手動登録された情報を返すようになります。
    3.  `gameSession.roles` の基本的なプレイヤー情報（Discord ID, 表示名, プレイヤー番号）もこのリストに基づいて更新されます。
* **リクエストbody (JSON):**
    ```json
    [
      {
        "discordId": "123456789012345678",
        "screenName": "手動登録ユーザーA",
        "playerNumber": 1
      },
      {
        "discordId": "987654321098765432",
        "screenName": "手動登録ユーザーB",
        "playerNumber": 2
      }
      // ... 他のプレイヤー
    ]
    ```
* **レスポンスbody (JSON) (成功時例):**
    ```json
    {
      "message": "Player list manually registered successfully. X players.",
      "registeredPlayerCount": 2,
      "players": [
        { "discordId": "123456789012345678", "screenName": "手動登録ユーザーA", "playerNumber": 1 },
        { "discordId": "987654321098765432", "screenName": "手動登録ユーザーB", "playerNumber": 2 }
      ]
    }
    ```
* **レスポンスbody (JSON) (エラー時例):**
    ```json
    {
      "message": "Validation failed for player list.",
      "errors": [
        "Player at index 0: discordId is missing or not a string."
      ]
    }
    ```

### 2.3. プレイヤーリスト取得 (リアクション経由)
* **HTTPメソッド:** `GET`
* **パス:** `/player/list`
* **説明:** Discordの特定メッセージへのリアクション等に基づき、ゲーム参加者のDiscord ID、表示名、およびbotサーバー側で割り振られたプレイヤー番号のリストを取得します。 `/game/setup` の後に呼び出します。
    * **注記:** `/player/list/manual` APIによってプレイヤーリストが手動登録されている場合、このAPIはDiscordのリアクション情報を参照せず、手動登録されたリストを返却します。
* **トリガー:** スプレッドシートの [プレイヤーリスト取得] ボタン。
* **botサーバー処理:**
    1. 手動登録されたプレイヤーリストが存在する場合はそれを返却します。
    2. 手動登録リストがない場合、Discordから参加者情報を収集し、各プレイヤーに一意のplayerNumberを割り当て、JSON配列で返却します。
    3. 取得したプレイヤー情報は `gameSession.roles` の基本情報としても保存されます（手動リストがない場合）。
* **スプレッドシート処理:** 取得したリストを `メンバー` シートに反映させます。
* **レスポンスbody (JSON):**
    ```json
    [
      { "discordId": "123456789012345678", "screenName": "ユーザーA", "playerNumber": 1 },
      { "discordId": "987654321098765432", "screenName": "ユーザーB", "playerNumber": 2 }
      // ... 他のプレイヤー
    ]
    ```

### 2.4. 配役リスト送信
* **HTTPメソッド:** `POST`
* **パス:** `/role/list/add`
* **説明:** スプレッドシートで決定された配役情報をbotサーバーに送信し、Discord上での役職配布（役職チャンネル作成、招待、メンション）を依頼します。 `/player/list` または `/player/list/manual` の後に呼び出します。 botサーバー側では、このAPIから送られた役職情報を、既存のプレイヤーリスト（手動登録またはリアクション経由で`gameSession.roles`に基本情報が格納されている）にマージします。
* **トリガー:** スプレッドシートの [配役結果を送信] ボタン。
* **スプレッドシート処理:** 配役情報をJSON化して送信します。
* **botサーバー処理:** 受け取った情報に基づき、`/game/setup` で作成したカテゴリ内に役職チャンネル（村人を除く）を作成し、プレイヤーを招待、メンションで通知します。
* **リクエストbody (JSON):**
    ```json
    [
      {
        "discordId": "123456789012345678",
        "screenName": "プレイヤー1",
        "playerNumber": 1,
        "role": "人狼",
        "initialFortuneTargetPlayerNumber": null //初日占い結果 役職が占い師でない場合はnull 
      },
      {
        "discordId": "987654321098765432",
        "screenName": "プレイヤー2",
        "playerNumber": 2,
        "role": "占い師",
        "initialFortuneTargetPlayerNumber": 3//初日占い結果 役職が占い師の場合に狼でないプレイヤーの番号が入る
      },
      // ... 他のプレイヤー
      {
        "discordId": "112233445566778899",
        "screenName": "プレイヤー3",
        "playerNumber": 3,
        "role": "村人",
        "initialFortuneTargetPlayerNumber": null
      }
    ]
    ```
    > **注記:** リクエストJSON内の `discordId` と `screenName` は、botサーバーに既に登録されているプレイヤー情報（`/player/list` または `/player/list/manual` で取得・設定されたもの）と `playerNumber` をキーに照合されます。役職 (`role`) と初日占い対象 (`initialFortuneTargetPlayerNumber`) が主にこのAPIで設定・更新される情報となります。

### 2.5. 投票結果送信
* **HTTPメソッド:** `POST`
* **パス:** `/vote/result`
* **説明:** スプレッドシートで集計・判定された投票結果（処刑者、投票詳細、決戦情報）をbotサーバーに送信します。
* **トリガー:** スプレッドシートの [投票結果を送信] ボタン。
* **スプレッドシート処理:** 投票結果情報をJSON化して送信します。
* **botサーバー処理:** 処刑者情報や投票ログを記録します。
* **リクエストbody (JSON):**
    ```json
    {
      "executedPlayerNumber": 2,
      "voterPlayerNumbers": [1, 2, 3, 4, 5],
      "votedPlayerNumbers": [2, 3, 2, 3, 2],
      "isRunoffVote": true,
      "runoffVoterPlayerNumbers": [1, 4, 5],
      "runoffVotedPlayerNumbers": [2, 2, 3]
    }
    ```
> **注記:** 決戦がない場合、`runoffVoterPlayerNumbers` と `runoffVotedPlayerNumbers` は空のリスト `[]` または `null` とします。

### 2.6. 占い結果送信
* **HTTPメソッド:** `POST`
* **パス:** `/night/fortuner`
* **説明:** スプレッドシートで判定された占い結果（対象プレイヤーが人間か人狼か）をbotサーバーに送信し、該当する占い師のDiscordチャンネルへの通知を依頼します。
* **トリガー:** スプレッドシートの [占い結果を送信] ボタン。
* **スプレッドシート処理:** 占い情報をJSON化して送信します。
* **botサーバー処理:** 受け取った結果に基づき、適切な通知メッセージを生成し、該当占い師のDiscordチャンネルへ本部botとして投稿します。
* **リクエストbody (JSON):**
    ```json
    {
      "fortuneTellerPlayerNumber": 2,
      "targetPlayerNumber": 3,
      "result": true
    }
    ```

### 2.7. 霊媒結果送信
* **HTTPメソッド:** `POST`
* **パス:** `/night/medium`
* **説明:** スプレッドシートで判定された霊媒結果（直前に処刑されたプレイヤーが人間か人狼か）をbotサーバーに送信し、該当する霊媒師のDiscordチャンネルへの通知を依頼します。
* **トリガー:** スプレッドシートの [霊媒結果を送信] ボタン。
* **スプレッドシート処理:** 霊媒情報をJSON化して送信します。
* **botサーバー処理:** 受け取った結果に基づき、適切な通知メッセージを生成し、該当霊媒師のDiscordチャンネルへ本部botとして投稿します。
* **リクエストbody (JSON):**
    ```json
    {
      "mediumPlayerNumber": 3,
      "deceasedPlayerNumber": 1,
      "result": false
    }
    ```

### 2.8. ゲーム終了通知
* **HTTPメソッド:** `POST`
* **パス:** `/game/end`
* **説明:** ゲームの勝敗が決定した際に、勝利陣営をbotサーバーに通知します。 その際に、ゲームの状態のリセットも行う。
* **リクエストbody (JSON):**
    ```json
    {
      "winningFaction": "人狼陣営"
    }
    ```

## 3. スプレッドシートに追加して欲しいボタンと機能の一覧
* **準備開始ボタン**
    * カテゴリ名とサーバーidを入力する欄も欲しい。
    * 関連API: `POST /game/setup`
* **プレイヤーリスト手動登録ボタン (新設)**
    * スプレッドシート上のプレイヤー情報（Discord ID, 表示名, プレイヤー番号）をJSON形式で送信し、プレイヤーリストを確定させる。
    * リアクションでの参加が難しい場合やテスト用。
    * 関連API: `POST /player/list/manual`
* **プレイヤーリスト取得ボタン (リアクション経由)**
    * このボタンを押して取得した結果をメンバーリストに反映させて欲しい。
    * `/player/list/manual` で手動登録されていない場合にDiscordのリアクションを参照する。
    * 関連API: `GET /player/list`
* **配役決定ボタン**
    * 配役を最終決定した時に押すボタン。 これを押すとdiscordで配役が始まる。
    * 関連API: `POST /role/list/add`
* **各役職の行動決定ボタン**
    * 役職実行タブに霊媒結果の送信ボタンと占い結果の送信ボタンが欲しい。
        * 占い結果送信: 関連API `POST /night/fortuner`
        * 霊媒結果送信: 関連API `POST /night/medium`
* **ゲーム終了ボタン**
    * ゲームが終了した場合にそれを知らせるボタンが欲しい。 一応、今の仕様書には勝利陣営を送信する仕様にしているけど、bodyは空でも良い。
    * 関連API: `POST /game/end`