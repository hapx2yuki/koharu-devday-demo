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
  <p>問い合わせを閲覧するのはYuki Urata本人だけです。対応が完了した問い合わせは、完了後90日を目安に削除します。</p>
</section>
<section class="public-section" aria-labelledby="policies-title">
  <h2 id="policies-title">利用条件とデータの扱い</h2>
  <p><a href="/privacy">プライバシーポリシー</a>と<a href="/terms">利用条件</a>を確認できます。機能・運用・条件の変更は、このサポートページでお知らせします。</p>
  <p>両方の条件は、それぞれのページの初回公開日から適用します。問い合わせは上記のメールで受け付けます。</p>
</section>`;

const privacy = `
<header class="public-hero">
  <p class="eyebrow">KOHARU COFFEE / PRIVACY</p>
  <h1>プライバシーポリシー</h1>
  <p>こはる珈琲 注文サービスのデモで扱う情報と、その用途を説明します。</p>
  <p class="note">運営者 Yuki Urata · 提供対象 日本 · 適用開始 本ページの初回公開日</p>
</header>
<section class="public-section" aria-labelledby="privacy-purpose">
  <h2 id="privacy-purpose">1. 架空データを扱う学習用のデモ</h2>
  <p>架空の珈琲店の商品・在庫・受取枠・注文CSVを使い、AIと業務画面を組み合わせる方法を体験できます。用意した例と同じ架空形式のデータを使用してください。</p>
  <p>氏名、連絡先、住所、カード情報、APIキーなどの秘密情報を入力しないでください。形式の検査で拒否される内容も、会話や集計の入力に使った場合は、検査前にChatGPTや配信基盤へ到達することがあります。</p>
</section>
<section class="public-section" aria-labelledby="privacy-information">
  <h2 id="privacy-information">2. 情報を処理する場所と目的</h2>
  <div class="table-scroll"><table>
    <thead><tr><th scope="col">情報</th><th scope="col">用途と処理する場所</th></tr></thead>
    <tbody>
      <tr><th scope="row">質問と集計用CSV</th><td>ChatGPTが質問を処理し、必要な道具を呼び出します。会話からCSVの集計を依頼すると、CSV本文が公開MCPへ渡り、形式検査と集計に使われます。デモの道具は会話全文やプロフィールを引数として要求しません。</td></tr>
      <tr><th scope="row">画面内の試し注文</th><td>注文・取消による変化を表示するため、開いている画面のメモリー内で扱います。公開MCPの共有注文として保存しません。</td></tr>
      <tr><th scope="row">画面で選んだCSV</th><td>ファイル名と本文を専用画面で読み、検査結果を表示します。この操作で本文を公開MCPへアップロードする処理はありません。</td></tr>
      <tr><th scope="row">ChatGPTの添付CSV</th><td>対応するファイル表示を使う場合、ファイル名とホストの参照情報が公開MCPへ渡ります。本文はホストのファイル読取機能から専用画面へ渡り、画面内で検査します。</td></tr>
      <tr><th scope="row">接続・通信の情報</th><td>OpenAIのChatGPT・Sitesとその提供基盤が、認証、接続、サービス提供に必要な処理を行います。本デモはパスワードやカード情報の入力を求めません。</td></tr>
      <tr><th scope="row">問い合わせメール</th><td>送信者のメールアドレス、本文、添付を、問い合わせへの回答と解決のために扱います。閲覧するのは運営者のYuki Urata本人だけです。</td></tr>
    </tbody>
  </table></div>
</section>
<section class="public-section" aria-labelledby="privacy-retention">
  <h2 id="privacy-retention">3. 保存と削除</h2>
  <p>デモの独自コードには、集計用CSV、添付ファイルの名前や参照情報を永続データベースへ保存する処理がありません。画面内の試し注文は、画面の終了や再読込みで失われる場合があり、復元する機能はありません。</p>
  <p>運営者が管理する問い合わせは、対応完了後90日を目安に削除します。削除の相談は下記の窓口で受け付けます。</p>
  <p>ChatGPTの会話・添付ファイル、配信・認証基盤、メールサービスが管理する記録には、それぞれのサービスの規約と設定が適用されます。それらのログ項目や保存期間を、本デモの独自コードだけで確認・変更することはできません。問い合わせの削除目安は、それらの基盤の記録すべてに適用する期間ではありません。</p>
</section>
<section class="public-section" aria-labelledby="privacy-services">
  <h2 id="privacy-services">4. 外部サービスと情報の利用</h2>
  <p>会話とデモの提供にはOpenAIのChatGPT・Sitesを利用します。公開MCPの独自コードは、入力内容を別のAI API、広告サービス、顧客データベースへ転送しません。独自の広告配信、行動分析、入力情報の販売は行いません。</p>
  <p>問い合わせメールは${contact}へ送られます。問い合わせの回答のために利用し、他の担当者へ閲覧を広げる運用は行いません。</p>
</section>
<section class="public-section" aria-labelledby="privacy-contact">
  <h2 id="privacy-contact">5. 問い合わせと変更</h2>
  <p>デモでの情報の扱い、運営者へ送った情報の確認・削除については、${contact}へ連絡してください。認証情報や実在顧客の情報を追加せず、相談の対象をお知らせください。</p>
  <p>ChatGPTの会話履歴やOpenAIアカウントの情報は、該当サービスの機能・窓口で管理してください。</p>
  <p>この方針の変更は<a href="/support">サポートページ</a>でお知らせします。</p>
</section>`;

const terms = `
<header class="public-hero">
  <p class="eyebrow">KOHARU COFFEE / TERMS</p>
  <h1>利用条件</h1>
  <p>こはる珈琲 注文サービスのデモを利用する際の条件です。</p>
  <p class="note">提供者 Yuki Urata · 提供対象 日本 · 適用開始 本ページの初回公開日</p>
</header>
<section class="public-section" aria-labelledby="terms-service">
  <h2 id="terms-service">1. 提供する機能</h2>
  <p>架空の商品・在庫・受取枠の確認、専用画面での試し注文と取消、既定形式の架空注文CSVの表示・集計を提供します。</p>
  <p>公開MCPは読取と集計を扱います。試し注文は専用画面のメモリー内で動作し、実店舗への予約、商品購入、決済、顧客への通知は行いません。表示する価格・在庫・受取枠は架空の例です。</p>
</section>
<section class="public-section" aria-labelledby="terms-environment">
  <h2 id="terms-environment">2. 利用環境</h2>
  <p>ChatGPTで使うには、対応する機能とプラグインへの正規の接続が必要です。利用できる画面や認証方法は、アカウント、設定、サービスの提供状況によって異なります。対応するブラウザーでは、試し注文の画面だけを開くこともできます。</p>
  <p>本デモ内では商品の決済や代金請求を行いません。ChatGPT等の契約や通信に伴う費用は、利用者が契約するサービスの条件を確認してください。</p>
</section>
<section class="public-section" aria-labelledby="terms-data">
  <h2 id="terms-data">3. 入力するデータと保存</h2>
  <p>用意された架空データ、または同じ既定形式で作った架空CSVを使用してください。実在顧客の個人情報、カード情報、APIキー、その他の秘密を入力しないでください。</p>
  <p>CSVの形式検査は、実在する個人の情報を検知して自動削除する機能ではありません。会話からのCSV集計では本文が公開MCPへ渡ります。専用画面のファイル選択と、ChatGPTの添付ファイル表示では処理する場所が異なります。詳しくは<a href="/privacy">プライバシーポリシー</a>を確認してください。</p>
  <p>画面内の試し注文は、画面の終了や再読込みで失われる場合があります。実際の受注、会計、顧客管理、納品記録の保存には使用しないでください。</p>
</section>
<section class="public-section" aria-labelledby="terms-limits">
  <h2 id="terms-limits">4. 利用上の制限</h2>
  <ul>
    <li>試し注文や集計結果を、実際の注文・支払い・顧客通知の証拠として扱わないでください。</li>
    <li>他の人の認証情報や秘密情報を送信しないでください。</li>
    <li>アクセス制御を迂回して、許可されていない情報を取得しないでください。</li>
    <li>大量の要求や不正なデータで、他の利用者や提供基盤の利用を妨げないでください。</li>
  </ul>
</section>
<section class="public-section" aria-labelledby="terms-output">
  <h2 id="terms-output">5. 出力の確認</h2>
  <p>AIの説明や集計結果は、入力した内容と返された根拠を確認して利用してください。このデモの確認結果は、実店舗や本番システム全体の品質・安全性を確認した結果としては扱えません。</p>
</section>
<section class="public-section" aria-labelledby="terms-contact">
  <h2 id="terms-contact">6. 変更と問い合わせ</h2>
  <p>機能、対応環境、データ形式、利用条件の変更や、提供の停止・終了に関する案内は<a href="/support">サポートページ</a>に掲載します。</p>
  <p>問い合わせは${contact}で受け付けます。運営者が内容を確認して対応します。</p>
</section>`;

const recording = `
<header class="public-hero">
  <p class="eyebrow">KOHARU COFFEE / DEMO RECORDING</p>
  <h1>専用画面の操作を見る</h1>
  <p>こはる珈琲の専用画面で、試し注文と取消を操作した記録です。架空データを使用しています。</p>
</header>
<section class="public-section" aria-label="デモの操作動画">
  <video controls playsinline preload="metadata" width="1280" height="720" style="display:block;width:100%;height:auto;background:#0c0a09" src="/demo-recording.mp4">
    <p>動画を再生できない場合は、<a href="/demo-recording.mp4">MP4ファイルを開いてください</a>。</p>
  </video>
  <p><a href="/demo-recording.mp4">動画ファイルを開く</a></p>
  <p>操作方法や対応するCSVの形式は、<a href="/support">サポート案内</a>で確認できます。</p>
</section>`;

const pages = {
  '/': { title: 'こはる珈琲 注文サービスのデモ', content: home },
  '/support': { title: '操作とお問い合わせ | こはる珈琲デモ', content: support },
  '/privacy': { title: 'プライバシーポリシー | こはる珈琲デモ', content: privacy },
  '/terms': { title: '利用条件 | こはる珈琲デモ', content: terms },
  '/demo-recording': { title: '操作動画 | こはる珈琲デモ', content: recording },
};
export type PublicPagePath = keyof typeof pages;

export function isPublicPagePath(path: string): path is PublicPagePath {
  return Object.hasOwn(pages, path);
}

export function publicPage(path: PublicPagePath, sharedCss: string): string {
  const { title, content } = pages[path];
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="架空のこはる珈琲を使い、商品・在庫・受取枠、試し注文、注文CSVの集計を確かめるデモです。"><style>${sharedCss}${pageStyles}</style></head>
<body><main class="public-page"><nav class="public-nav" aria-label="サイト内"><a href="/">こはる珈琲デモ</a><a href="/support"${path === '/support' ? ' aria-current="page"' : ''}>操作とお問い合わせ</a></nav>
${content}
<footer class="public-footer"><span>運営者 Yuki Urata</span><span>${contact}</span><a href="${sourceUrl}">公開ソース</a><a href="/privacy"${path === '/privacy' ? ' aria-current="page"' : ''}>プライバシーポリシー</a><a href="/terms"${path === '/terms' ? ' aria-current="page"' : ''}>利用条件</a></footer>
</main></body></html>`;
}
