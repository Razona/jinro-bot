

スプレッドシート側に追加して欲しい機能


## ユーザーリスト取得機能
メンバータブにメンバーリスト取得ボタンを追加して欲しい
指定のAPIを叩いたらjson返すので、メンバータブにデータを追加して欲しい
入れて欲しい項目は
### discordID 
### discodのスクリーンネーム(名前に代入することを想定)
### プレイヤー番号
(json配列で)

## 配役リストの送信
配役タブに送信ボタンを追加
APIにjson形式のデータを送信して欲しい
入れて欲しい項目は
### discordID
### ゲーム内での表示名(基本はdiscordのスクリーンネームをそのまま入れればいいと思う)
### プレイヤー番号
### 役職
### 占い師の初日白先
(json配列で)

## 投票結果の送信
投票タブに送信ボタンを追加
送信して欲しい項目は
### 本日の処刑者のプレイヤー番号
### 投票元(投票順に)のプレイヤー番号
### 投票先(投票順に)のプレイヤー番号
### 決戦の有無
### 決戦での投票元のプレイヤー番号
### 決戦での投票先のプレイヤー番号

## 占い
役職実行タブに占い決定ボタンを追加して欲しい
送信する項目は
### 占いを行うプレイヤーの番号
### 占い先のプレイヤー番号
### 占い結果(bool)
戻り値はboolean

## 騎士
役職実行タブに護衛先決定ボタンを追加して欲しい
送信する項目は
### 護衛を行うプレイヤーの番号
### 護衛先のプレイヤー番号
戻り値はboolean

## 人狼
役職実行タブに襲撃先決定ボタンを追加して欲しい
送信する項目は
### 襲撃先のプレイヤー番号
戻り値はboolean

## 霊媒
役職実行タブに霊媒実行ボタンを追加して欲しい
送信する項目は
### 昨日処刑されたプレイヤーのプレイヤー番号
### 霊媒結果
