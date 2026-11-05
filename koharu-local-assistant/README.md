# こはる珈琲 ローカル補助アプリ

架空のイベント事前注文サービスで、**Sign in with ChatGPTによる本人認証と、許可されたChatGPTプラン利用を別々に確かめる**ためのmacOS用補助アプリです。実在顧客への連絡、決済、工房への認証情報送信は行いません。

現時点では接続コードと模擬応答による安全性テストを実装した段階です。実際のChatGPT登録、Macキーチェーン保存、プラン利用の成功は、初回接続後に別途確認します。このパッケージを置いただけで、該当機能を「実使用済み」と数えないでください。

## 動作条件

- macOS、Node.js 22以上。
- このアプリをローカルで動かすこと。本人限定Sitesのサーバーへ認証情報を渡す用途には使いません。
- 初回は、利用者本人によるChatGPTの公式認証画面での操作が必要です。
- 会社や別のアプリのAPIキーは不要です。このプロジェクトの `.env.local` も読みません。

```sh
npm ci
npm run typecheck
npm test
npm start -- signin
```

ローカルの認証案内ページがブラウザーで開きます。**Continue with ChatGPT** を押し、公式画面でアカウントと許可を確認してください。ブラウザーに認証完了が出ると、このMacのキーチェーンへ保存します。初回はmacOS側のキーチェーン確認が表示される場合があります。

`signin`だけでは本人認証のみを求め、推論は実行しません。プラン利用も確かめる場合は、次のように起動します。

```sh
npm start -- signin --plan
npm start -- status
npm start -- models
```

`models`は、そのアカウントで選べるモデル名を正式な一覧から取得します。推論は開始しません。`status`にあるプラン許可は、認証で返されたscopeの確認結果です。実行成功や残り利用枠を表すものではありません。

## 架空の相談を1回実行する

先に [ChatGPT設定 → 使用状況](https://chatgpt.com/settings/usage) で、このアプリの利用上限と、追加クレジットを使う設定が無効であることを確認してください。新しい契約やクレジット購入は行いません。

`models`が返したモデルIDを選び、上限を確認した場合だけ実行します。

```sh
npm start -- plan --model <modelsで確認したID> --confirmed-plan-limit --credits-disabled
```

このコマンドは「在庫12杯のコーヒーと6杯のラテから、コーヒー2杯とラテ1杯の注文を受けられるか」という固定の架空相談を1回だけ送ります。結果には正式な応答ID・本文・取得できた利用量が表示されます。`response.completed`まで取得できなければ成功にしません。失敗・切断時に自動で作り直しません。

**上限の確認は利用者の申告です。** 現在このアプリから設定値を読み取る正式なAPIは確認できていません。2つの確認用引数がない場合、通信前に停止します。引数自体がサービス側に新たな金額上限を設定するものではありません。確認できない場合は、このコマンドを実行しないでください。受信時間の上限も課金上限の代わりにはしません。

この経路はPlatform APIキー課金とは別です。また、現在の正式仕様上、ChatGPTプラン経路はAgents API、hosted Computer use、hosted tool search等の代替には使えません。

## アカウントの切替と終了

```sh
npm start -- accounts
npm start -- signin --plan --add-account
npm start -- select --client-id <保存済みの登録ID>
npm start -- signout
```

- 登録IDと検証済み本人IDを組にして管理し、別アカウントのtokenを混ぜません。
- 再認証とサインアウト後の再接続では、発行されたclient IDと同じホストIDを再使用します。
- `signout`は更新セッションの失効を試み、キーチェーンのtokenを削除します。遠隔失効を確認できない場合は、その旨を表示します。
- 再接続用の登録ID・本人ID・ホストIDは、本人だけが読める `~/.config/koharu-local-assistant/host.json` に残ります。access token、refresh token、ID tokenはこのファイルに保存しません。
- 設定と認証の削除は別です。host.jsonを消してもサーバー側の登録や許可が削除されるわけではありません。まず `signout`を行い、必要ならChatGPT設定でアプリの接続を解除してください。

処理中の排他ファイルが、強制終了のため残る場合があります。その場合は他のこの補助アプリが動いていないことを確認してから `~/.config/koharu-local-assistant/session.lock` のみを削除し、再試行してください。自動的に別プロセスのロックを破壊することはありません。

## 保存するものと保存しないもの

| 場所 | 内容 |
|---|---|
| macOSキーチェーン | access/refresh/ID token、発行済みclient ID、検証済み本人ID、許可scope、期限 |
| 本人限定のローカル設定 | 不透明なホストID、登録IDと本人IDの対応、選択中の登録 |
| 標準出力 | 非秘密の接続状態、モデル一覧、明示実行の可視結果 |
| ブラウザー | 公式認証への移動と完了案内のみ。tokenを保存・表示しない |
| 工房・GitHub・公開パッケージ | 認証情報を送らない |

認証コード交換と更新は公開されたOpenAIの正式なendpointだけを使用します。未知のAPI、ChatGPTの内部API、保存済みブラウザーcookieを使う処理はありません。

## 検証と公開の条件

```sh
npm run typecheck
npm test
```

テストでは生成したRSA鍵と架空のtokenを使い、実アカウント、ネットワーク推論、OSキーチェーンを使用しません。公開前は [SECURITY.md](./SECURITY.md) の確認範囲と未確認事項を確認してください。`package.json`は誤ったnpm公開を防ぐため`private: true`です。公開ソースとして配布する場合も、`.env`、利用者設定、キーチェーン、実行履歴を含めません。

## 正式仕様

2026年11月5日に以下を確認しました。

- [Sign in with ChatGPT：公開ソース・ローカル実行向け](https://developers.openai.com/siwc/token-sharing-open-source)
- [動的登録とサインイン](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [アカウント・更新・失効](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [モデル一覧とResponses API](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [現在の制約](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
