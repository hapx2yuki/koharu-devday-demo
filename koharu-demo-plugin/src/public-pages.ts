const pluginUrl = 'https://chatgpt.com/plugins/plugin_asdk_app_sites_1db06e9428108191bb778557411728a5';
const sourceUrl = 'https://github.com/hapx2yuki/koharu-devday-demo';
const contact = '<a href="mailto:hapx2yuki@gmail.com">hapx2yuki@gmail.com</a>';

const pageStyles = `
.public-page{max-width:1040px;padding-top:24px;font-family:"M PLUS 2",sans-serif;font-synthesis:none}
.public-nav,.public-footer,.public-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.public-nav{padding-bottom:24px;border-bottom:1px solid #57534e}
.public-page a{color:inherit;text-underline-offset:4px}
.public-nav a{font-size:14px}.public-hero{padding:56px 0 32px;max-width:800px}
.public-hero h1{font-size:clamp(30px,5vw,46px);line-height:1.35;letter-spacing:.02em}
.public-hero p{max-width:680px}.public-hero .note{font-size:15px}
.public-actions{justify-content:flex-start;margin:28px 0}
.public-page .primary-link{display:inline-flex;align-items:center;min-height:44px;padding:11px 18px;background:#e7e5e4;color:#1c1917;border-radius:6px;text-decoration:none;font-weight:650}
.public-section{padding:28px 0;border-top:1px solid #57534e}
.public-section h2{font-size:23px}.public-section h3{font-size:17px}
.public-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
.public-page p,.public-page li{overflow-wrap:anywhere}.public-page li+li{margin-top:10px}
.public-page code{font:14px/1.7 "M PLUS 1 Code",monospace;overflow-wrap:anywhere}
.table-scroll{overflow-x:auto}.public-page table{width:100%;border-collapse:collapse;text-align:left}
.public-page th,.public-page td{padding:12px 10px;border-bottom:1px solid #57534e;vertical-align:top}
.public-page th{font-size:14px;color:#d6d3d1}.public-footer{margin-top:24px;padding-top:24px;border-top:1px solid #57534e;font-size:14px;color:#d6d3d1}
@media(max-width:620px){.public-hero{padding:36px 0 20px}.public-grid{grid-template-columns:1fr;gap:12px}.public-page th,.public-page td{padding:10px 6px}}
`;

const home = `
<header class="public-hero">
  <p class="eyebrow">KOHARU COFFEE / DEMO</p>
  <h1>注文と在庫を、<br>会話のそばで確かめる。</h1>
  <p>架空の「こはる珈琲」を使って、AIと業務画面を組み合わせる方法を体験するデモです。商品・在庫・受取枠を調べ、試し注文の変化や注文CSVの集計を確認できます。</p>
  <p class="note">架空データ専用・実決済なし。試し注文は開いている画面のメモリー内で動きます。</p>
  <p class="note">公開ディレクトリへの掲載は準備中です。接続権限がある方はChatGPTで開けます。</p>
  <div class="public-actions">
    <a class="primary-link" href="/order">ブラウザーで試し注文</a>
    <a href="${pluginUrl}">ChatGPTでプラグインを開く</a>
    <a href="/example.csv" download="example.csv">架空の注文CSVをダウンロード</a>
  </div>
</header>
<section class="public-section" aria-labelledby="features-title">
  <h2 id="features-title">このデモで確かめられること</h2>
  <div class="public-grid">
    <section><h3>商品と受取枠を調べる</h3><p>価格、在庫、時間帯ごとの空きを会話から確認できます。表示する値は、このデモ用に用意した架空の値です。</p></section>
    <section><h3>注文と取消を試す</h3><p>専用画面で試し注文を作り、在庫と受取枠が減る様子を確認します。取り消すと数が戻り、画面に結果が残ります。</p></section>
    <section><h3>注文CSVを照合する</h3><p>用意したCSVは全3行です。取消分を除くと受付済み3点、合計1450円になります。値と元の行を見比べられます。</p></section>
  </div>
</section>
<section class="public-section" aria-labelledby="start-title">
  <h2 id="start-title">最初の操作</h2>
  <ol>
    <li>上のリンクからプラグインを開き、ChatGPTに表示される接続の案内を確認します。</li>
    <li>「商品の価格と在庫、受取枠の空きを教えてください」と依頼します。</li>
    <li>「試し注文と取消を体験できる画面を開いてください」と依頼して、専用画面を操作します。</li>
  </ol>
  <p>CSVの列や操作方法は<a href="/support">サポート案内</a>にまとめています。</p>
</section>
<section class="public-section" aria-labelledby="source-title">
  <h2 id="source-title">仕組みを確認する</h2>
  <p>公開MCPは架空データの読取・集計を行います。専用画面の試し注文は、その画面を閉じると失われます。</p>
  <p><a href="${sourceUrl}">GitHubで公開ソースを見る</a></p>
</section>`;

const support = `
<header class="public-hero">
  <p class="eyebrow">KOHARU COFFEE / SUPPORT</p>
  <h1>操作とお問い合わせ</h1>
  <p>こはる珈琲デモの基本操作と、注文CSVの形式を確認できます。</p>
  <p class="note">架空データ専用・実決済なし。公開サーバーは商品・在庫・受取枠の読取とCSV集計を扱います。</p>
</header>
<section class="public-section" aria-labelledby="operation-title">
  <h2 id="operation-title">基本操作</h2>
  <p>ブラウザーだけで試す場合は、<a href="/order">試し注文の画面</a>を開いてください。ChatGPTのPlugin画面とは別に動く、ブラウザー内の架空データです。</p>
  <ol>
    <li><a href="${pluginUrl}">ChatGPTのプラグイン</a>を開き、接続の案内を確認します。</li>
    <li>商品・在庫・受取枠を会話で確認し、専用画面を開きます。</li>
    <li>商品、個数、受取枠を選び「試し注文を確定」を押します。画面内の在庫・受取枠と注文結果が更新されます。</li>
    <li>注文結果の「取り消す」を押すと、画面内の在庫・受取枠が戻ります。</li>
  </ol>
  <p>試し注文は画面のメモリー内に保持されます。画面を閉じたり再読込したりした場合は、新しいデモ状態から始まります。</p>
</section>
<section class="public-section" aria-labelledby="csv-title">
  <h2 id="csv-title">CSVの形式</h2>
  <p><a href="/example.csv" download="example.csv">架空の注文CSVをダウンロード</a>して、専用画面のファイル選択で確認できます。対応するDesktopでは、添付CSVを専用のファイル表示から開く方法もあります。</p>
  <p>UTF-8のテキスト、100KB以内、見出しを除いて2000行以内にしてください。列名と順番は次の5列です。</p>
  <div class="table-scroll"><table>
    <thead><tr><th scope="col">列名</th><th scope="col">指定する値</th></tr></thead>
    <tbody>
      <tr><th scope="row"><code>pickup_number</code></th><td><code>K001</code>のように、Kと3桁以上の数字</td></tr>
      <tr><th scope="row"><code>product_id</code></th><td><code>coffee</code>、<code>latte</code>、<code>baked-sweets</code></td></tr>
      <tr><th scope="row"><code>quantity</code></th><td>1から100までの整数</td></tr>
      <tr><th scope="row"><code>unit_price_yen</code></th><td>coffeeは450、latteは550、baked-sweetsは320</td></tr>
      <tr><th scope="row"><code>status</code></th><td>受付済みは<code>confirmed</code>、取消済みは<code>cancelled</code></td></tr>
    </tbody>
  </table></div>
  <p>集計では<code>confirmed</code>の個数と金額を合計します。<code>cancelled</code>は取消行として数えます。用意した例の確認値は、全3行・受付済み3点・1450円・取消1行です。</p>
  <p>氏名、連絡先、実際の注文情報、認証情報を含めず、配布した例と同じ架空形式を使用してください。</p>
</section>
<section class="public-section" aria-labelledby="trouble-title">
  <h2 id="trouble-title">操作に困ったとき</h2>
  <ul>
    <li>専用画面が開かない場合は、ChatGPT側の接続状態と、使用している画面の対応状況を確認してください。</li>
    <li>CSVが受け付けられない場合は、列名の順番、商品ID、価格、個数、状態を確認してください。</li>
    <li>試し注文が消えた場合は、画面の終了や再読込が行われていないか確認してください。</li>
  </ul>
</section>
<section class="public-section" aria-labelledby="contact-title">
  <h2 id="contact-title">お問い合わせ</h2>
  <p>運営者 Yuki Urata<br>窓口 ${contact}</p>
  <p>起きたこと、期待していた動き、発生日時、使用したChatGPTの環境、操作手順、画面に出たエラー文をお知らせください。画像を添える場合は、関係のある箇所だけを含めてください。</p>
  <p>パスワード、APIキー、認証用の値、実在顧客の情報は記載しないでください。</p>
</section>`;

export function publicPage(path: '/' | '/support', sharedCss: string): string {
  const title = path === '/' ? 'こはる珈琲 注文サービスのデモ' : '操作とお問い合わせ | こはる珈琲デモ';
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="架空のこはる珈琲を使い、商品・在庫・受取枠、試し注文、注文CSVの集計を確かめるデモです。"><style>${sharedCss}${pageStyles}</style></head>
<body><main class="public-page"><nav class="public-nav" aria-label="サイト内"><a href="/">こはる珈琲デモ</a><a href="/support"${path === '/support' ? ' aria-current="page"' : ''}>操作とお問い合わせ</a></nav>
${path === '/' ? home : support}
<footer class="public-footer"><span>運営者 Yuki Urata</span><span>${contact}</span><a href="${sourceUrl}">公開ソース</a></footer>
</main></body></html>`;
}
