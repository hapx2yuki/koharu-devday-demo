# こはる珈琲 デモPlugin

架空の珈琲店の商品・在庫・受取枠を読み、試し注文と取消、注文CSVの集計を体験するPluginです。実決済、実店舗の注文、顧客への連絡は行いません。

これは正式SDKと公開されたPlugin Extensions仕様に合わせて作成した配布候補です。**Plugin Creatorでの作成、審査提出、公開ディレクトリへの掲載、ChatGPT上での導入はまだ確認していません。** 手書きのmanifestやローカルのテスト成功を、これらの正式実績に数えないでください。

## 2つの実行方式

| 方式 | できること | 保存範囲 |
|---|---|---|
| ローカルstdio MCP | 商品・在庫・枠の確認、試し注文、取消、CSV集計、専用画面 | そのプロセスのメモリーだけ。再起動で初期化 |
| 公開HTTPS MCP | 架空データの確認・集計、専用画面の表示 | サーバーに利用者別データや注文を保存しない |

公開版の画面では、試し注文・取消は**その画面のブラウザーメモリーだけ**で処理します。共有在庫や別の人の注文に影響しません。これは正式なMCP App内の独自業務処理であり、AIの推論やサーバーの注文処理ではありません。ウィンドウを閉じると消えます。

## ブラウザーから試す

公開サイトの `/order` でも、同じ注文画面を操作できます。商品、個数、受取枠を選んで試し注文を作成し、金額・在庫・枠の変化と、取消後の復元を確認できます。

この入口はブラウザー内のメモリーを使用します。再読込で最初の状態に戻り、公開MCPへの変更要求は送りません。ChatGPTのPlugin画面とは独立した操作例です。Computer useの実演では、この公開画面を正式な操作機能で開き、操作前後の画像と結果を記録します。ブラウザーで操作できたことだけをComputer useの利用実績には数えません。

## 起動・検査

Node.js 22以上で、このフォルダーを作業場所にします。

    npm ci
    npm run typecheck
    npm run build
    npm test
    npm run audit:package

ローカルMCPは、mcp.jsonの正規stdio設定から node dist/server.mjs を起動します。起動時にshellコマンドや任意ファイルパスを受け付けません。標準出力はMCP通信用です。

dist/worker.jsは公開版の独立Workerです。/mcpに配置すると、正式SDK 2.3.0のHTTPハンドラーがMCP 2026-07-28と従来のstateless接続に応答します。所有者限定の工房や、そのAPIキー・履歴・アカウントとは接続しません。公開時は、実際に発行されたHTTPS URLを使う別の配布manifestを作成してください。仮のURLを本番manifestへ入れないでください。

## 会話で使う道具

- koharu_open：専用の画面を開く。
- koharu_snapshot：商品・在庫・受取枠を確認する。
- koharu_example_csv：同梱の架空注文CSVと集計結果を確認する。
- koharu_summarize_csv：こはる珈琲の既定形式だけを集計する。
- koharu_csv_viewer：正式なファイル入口からCSVを表示する。
- koharu_place_order、koharu_cancel_order、koharu_export_csv：ローカル版だけの試し注文操作。

正式仕様に従い、koharu_openへglobalとthreadの入口を、CSVビューアーへfile入口を宣言しています。画面は@modelcontextprotocol/ext-appsと@openai/mcp-extensions/appを使用します。ただし、**実際のChatGPTホストがこれらの入口を表示し、動かしたことは別の検証項目**です。未対応のホストではその旨を表示します。

## CSVの範囲

例は [fixtures/example.csv](./fixtures/example.csv) です。

    pickup_number,product_id,quantity,unit_price_yen,status
    K001,coffee,2,450,confirmed
    K001,latte,1,550,confirmed
    K002,baked-sweets,1,320,cancelled

列の順、商品IDと価格、受取番号、数量、状態を検査します。対応商品はcoffee（450円）、latte（550円）、baked-sweets（320円）です。任意の顧客名・メール・住所を扱う形式には対応しません。数式、HTML、不明な価格、100KBを超える入力を拒否します。画面で選んだファイルはその画面で検査し、外部送信しません。

## 公開・審査について

一般公開する際は、公開データだけを扱うHTTPS MCP版を使用してください。[現在の公式仕様](https://developers.openai.com/plugins/deploy/desktop-only)では、stdioを含むdesktop-only Pluginの公開提出には、承認済みパートナーとしての利用資格が必要です。ローカル版を配布候補として用意しただけでは、一般公開済みになりません。

公開の順序は、実URL設定、公開元と規約の準備、Plugin Creatorでの点検、公式ポータルの自動検査、審査提出、承認、公開、ディレクトリからの導入確認です。審査受付と公開は区別してください。公開先のアカウントや取得した受付IDをこのソースへ書き込まないでください。

## 安全性と権利

- 認証情報、APIキー、所有者の工房URL、実行履歴に依存しません。
- 外部API呼出し、任意コマンド、任意ファイル書込、外部送信機能はありません。
- 公開MCPに変更用ツールは登録していません。
- 同一requestIdの再送は、注文を重複作成しません。
- アプリ固有コードは [MIT](./LICENSE)。注文処理は同じプロジェクトで作成されたドメイン実装から、独立したメモリー版として移植しました。
- 正式SDKを含む依存の権利情報は [THIRD_PARTY_NOTICES.txt](./THIRD_PARTY_NOTICES.txt) に記載しています。
- zodは公表済み脆弱性への対処として4.6.7へ固定しています。SDKの動作はテストで確認しています。
- 詳細は [SECURITY.md](./SECURITY.md) を参照してください。

仕様確認日：2026年11月5日。
[Pluginの構成](https://developers.openai.com/plugins/build/plugins) /
[Plugin Extensions](https://developers.openai.com/plugins/build/extensions) /
[MCP Extensions SDK](https://github.com/openai/mcp-extensions/tree/main/typescript) /
[審査提出](https://developers.openai.com/plugins/deploy/submission)
