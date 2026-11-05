# こはる珈琲 DevDay デモ用パッケージ

架空のイベント事前注文サービスを題材に、プラグインの操作画面と、ローカル補助アプリのChatGPT認証を確認するための公開ソースです。本人限定の工房、アカウント情報、実行履歴は含みません。

- [注文サービスのプラグイン](./koharu-demo-plugin/README.md)：架空商品・在庫・受取枠とCSVを扱います。公開MCPは読取専用、試し注文は画面内だけです。
- [ローカル認証補助アプリ](./koharu-local-assistant/README.md)：公式Sign in with ChatGPTで接続します。認証情報はMacキーチェーンに保存します。

ソース公開は、公式Plugin Creatorの利用、ディレクトリ掲載、審査通過を意味しません。初回ログインやChatGPT上での画面表示など、各パッケージに記した未検証項目があります。

## 検査

各ディレクトリで `npm ci`、`npm run typecheck`、`npm test` を実行してください。プラグインは `npm run build` と `npm run audit:package` も実行します。

実決済、実在顧客への送信、外部サイトの認証情報の取得は行いません。
