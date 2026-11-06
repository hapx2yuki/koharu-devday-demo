import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('dist', { recursive: true });
const ui = await build({ entryPoints: ['src/app.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2023', write: false, minify: true });
const script = ui.outputFiles[0].text.replaceAll('</script', '<\\/script');
const css = await readFile('src/ui.css', 'utf8');
const html = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>こはる珈琲 デモ</title><style>' + css + '</style><main id="app"><h1>こはる珈琲 デモ</h1><p>接続を確認しています。</p></main><script type="module">' + script + '</script></html>';
await writeFile('dist/ui.html', html);
await build({ entryPoints: ['src/stdio.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile: 'dist/server.mjs', packages: 'bundle' });
const fontLicense = await readFile('assets/fonts/OFL.txt', 'utf8');
let publicCss = css + '\n/*\n' + fontLicense + '\n*/\n';
for (const [family, weight, file] of [
  ['M PLUS 2', 400, 'mplus2-regular-public.ttf'],
  ['M PLUS 2', 700, 'mplus2-bold-public.ttf'],
  ['M PLUS 1 Code', 400, 'mplus1code-public.ttf'],
]) {
  const encoded = (await readFile('assets/fonts/' + file)).toString('base64');
  publicCss += `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/ttf;base64,${encoded})format("truetype")}\n`;
}
const browserHtml = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>試し注文 | こはる珈琲</title><style>' + publicCss + ':root{font-family:"M PLUS 2",sans-serif;font-synthesis:none}pre{font-family:"M PLUS 1 Code",monospace}a{color:inherit;text-underline-offset:4px}</style></head><body><main id="app" data-surface="browser"><h1>こはる珈琲の試し注文</h1><p>画面を準備しています。</p></main><noscript>試し注文にはJavaScriptを有効にしてください。</noscript><script type="module">' + script + '</script></body></html>';
const browserPage = {html: browserHtml, scriptHash: createHash('sha256').update(script).digest('base64')};
await writeFile('dist/order.html', browserHtml);
let recording = null;
try {
  const bytes = await readFile('assets/demo/koharu-plugin-demo.mp4');
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') {
    throw new Error('審査用録画はMP4形式のファイルを指定してください。');
  }
  recording = bytes.toString('base64');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await build({ entryPoints: ['src/public-worker.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2023', outfile: 'dist/worker.js', define: { KOHARU_UI_HTML: JSON.stringify(html), KOHARU_PUBLIC_CSS: JSON.stringify(publicCss), KOHARU_BROWSER_PAGE: JSON.stringify(browserPage), KOHARU_DEMO_RECORDING: JSON.stringify(recording) } });
console.log('MCPサーバー、公式MCP App、公開読取専用Workerを生成しました。');
