import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
await build({ entryPoints: ['src/public-worker.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2023', outfile: 'dist/worker.js', define: { KOHARU_UI_HTML: JSON.stringify(html), KOHARU_PUBLIC_CSS: JSON.stringify(publicCss) } });
console.log('MCPサーバー、公式MCP App、公開読取専用Workerを生成しました。');
