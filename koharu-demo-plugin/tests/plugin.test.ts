import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { OpenAIFileEntrypointInputSchema } from '@openai/mcp-extensions/app';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDemoServer, UI_URI, SAMPLE_CSV } from '../src/server.js';
import { handlePublicMcp } from '../src/public-worker.js';
import { summarizeDemoCsv } from '../src/csv.js';
import type { MissionOrdersSnapshot } from '../src/order-types.js';

class TestElement {
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  id = '';
  textContent: string | null = '';
  constructor(readonly tagName: string) {}
  append(...children: TestElement[]) { this.children.push(...children); }
  replaceChildren(...children: TestElement[]) { this.children = children; }
  setAttribute() {}
  find(id: string): TestElement | undefined {
    return this.id === id ? this : this.children.map(child => child.find(id)).find(Boolean);
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const appBundle = build({
  entryPoints: [fileURLToPath(new URL('../src/app.ts', import.meta.url))], bundle: true,
  format: 'esm', platform: 'browser', write: false,
  plugins: [{ name: 'test-host', setup(builder) {
    builder.onResolve({ filter: /^(@modelcontextprotocol\/ext-apps|@openai\/mcp-extensions\/app)$/ }, args => ({ path: args.path, namespace: 'test-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-host' }, args => ({ contents: args.path === '@modelcontextprotocol/ext-apps'
      ? 'export const App = testHost.App; export const applyDocumentTheme = () => {}; export const applyHostStyleVariables = () => {};'
      : 'export const OpenAIExtensions = testHost.OpenAIExtensions; export const OpenAIFileEntrypointInputSchema = testHost.fileInputSchema;' }));
  } }],
}).then(result => result.outputFiles[0]!.text);
async function setupApp(browser = false) {
  const root = new TestElement('main'); root.id = 'app';
  if (browser) root.dataset.surface = 'browser';
  const connection = deferred<void>();
  const snapshotRequested = deferred<void>();
  const initialSnapshot = deferred<unknown>();
  const fileRequested = deferred<void>();
  const fileReads: ReturnType<typeof deferred<unknown>>[] = [];
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  let app!: TestApp;
  let connectionCalls = 0, serverCalls = 0;
  class TestApp {
    ontoolresult?: (result: { structuredContent: unknown }) => Promise<void>;
    constructor() { app = this; }
    addEventListener(type: string, handler: (event: unknown) => Promise<void>) { handlers.set(type, handler); }
    connect() { connectionCalls++; return connection.promise; }
    getHostContext() { return {}; }
    callServerTool() { serverCalls++; snapshotRequested.resolve(); return initialSnapshot.promise; }
  }
  class TestExtensions {
    resources = { read: () => {
      const result = deferred<unknown>(); fileReads.push(result); fileRequested.resolve(); return result.promise;
    } };
  }
  const snapshot = { mode: 'local-demo', snapshot: { products: [], slots: [], orders: [], confirmedOrderCount: 0, confirmedTotalYen: 0 } };
  const boot = runInNewContext(`(async () => { ${await appBundle} })()`, {
    testHost: { App: TestApp, OpenAIExtensions: TestExtensions, fileInputSchema: OpenAIFileEntrypointInputSchema },
    document: { createElement: (tag: string) => new TestElement(tag), getElementById: (id: string) => root.find(id) },
    TextDecoder, atob, structuredClone, crypto: webcrypto,
  }) as Promise<void>;
  return {
    root, connection, snapshotRequested, fileRequested, boot,
    calls: () => ({connectionCalls, serverCalls}),
    openFile: (name = 'example.csv') => handlers.get('toolinput')!({ arguments: { file: { name, resourceUri: 'host-resource://' + name } } }),
    finishFile: (index = 0) => fileReads[index]!.resolve({ contents: [{ text: 'pickup_number,product_id,quantity,unit_price_yen,status\nK001,coffee,2,450,confirmed\n' }] }),
    finishSnapshot: () => initialSnapshot.resolve({ structuredContent: snapshot }),
    renderAgain: () => app.ontoolresult!({ structuredContent: snapshot }),
  };
}

test('ファイルが初期画面より先に読めても、集計結果を初期表示と再描画で保持する', async () => {
  const ui = await setupApp();
  await ui.openFile();
  ui.connection.resolve();
  await ui.fileRequested.promise;
  ui.finishFile();
  await ui.snapshotRequested.promise;
  ui.finishSnapshot(); await ui.boot;
  assert.match(ui.root.find('csv-result')!.textContent!, /example.csv\n1行を確認\n受付済み 2点 \/ ¥900/);
  await ui.renderAgain();
  assert.match(ui.root.find('csv-result')!.textContent!, /受付済み 2点 \/ ¥900/);
});

test('明示したブラウザー入口はMCP接続を始めず、同じ注文画面を表示する', async () => {
  const ui = await setupApp(true); await ui.boot;
  assert.deepEqual(ui.calls(), {connectionCalls: 0, serverCalls: 0});
  assert.ok(ui.root.find('product'));
  assert.ok(ui.root.find('amount'));
  assert.ok(ui.root.find('slot'));
  const text = (element: TestElement): string => [element.textContent, ...element.children.map(text)].join('\n');
  assert.match(text(ui.root), /ブラウザー内で試す架空の注文サービス/);
  assert.match(text(ui.root), /まだ試し注文はありません/);
});

test('公開の注文画面は同梱スクリプトだけを許可し、外部通信を許可しない', async () => {
  const {default: worker} = await import(new URL('../dist/worker.js', import.meta.url).href);
  const response = await worker.fetch(new Request('https://demo.example/order'));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-surface="browser"/);
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  const expected = createHash('sha256').update(script).digest('base64');
  assert.ok(response.headers.get('Content-Security-Policy')!.includes(`script-src 'sha256-${expected}'`));
  assert.match(response.headers.get('Content-Security-Policy')!, /connect-src 'none'/);
  const head = await worker.fetch(new Request('https://demo.example/order', {method: 'HEAD'}));
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const post = await worker.fetch(new Request('https://demo.example/order', {method: 'POST'}));
  assert.equal(post.status, 405);
});
test('初期画面の後にファイル読取が完了しても、集計結果を再描画で保持する', async () => {
  const ui = await setupApp();
  ui.connection.resolve(); await ui.snapshotRequested.promise;
  const opening = ui.openFile(); await ui.fileRequested.promise;
  ui.finishSnapshot(); await ui.boot;
  ui.finishFile(); await opening;
  assert.match(ui.root.find('csv-result')!.textContent!, /受付済み 2点 \/ ¥900/);
  await ui.renderAgain();
  assert.match(ui.root.find('csv-result')!.textContent!, /example.csv\n1行を確認\n受付済み 2点 \/ ¥900/);
});

test('前に開いたファイルの遅い読取で最新ファイルの結果を上書きしない', async () => {
  const ui = await setupApp();
  ui.connection.resolve(); await ui.snapshotRequested.promise;
  ui.finishSnapshot(); await ui.boot;
  const first = ui.openFile('first.csv');
  const second = ui.openFile('latest.csv');
  ui.finishFile(1); await second;
  assert.match(ui.root.find('csv-result')!.textContent!, /^latest\.csv\n/);
  ui.finishFile(0); await first;
  assert.match(ui.root.find('csv-result')!.textContent!, /^latest\.csv\n/);
});

test('公開ホームは共通スタイルと正式な操作・サポート・ソースの導線を返す', async () => {
  const css = await readFile(new URL('../src/ui.css', import.meta.url), 'utf8');
  const response = await handlePublicMcp(new Request('https://demo.example/'), '', css);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Security-Policy')!, /default-src 'none'/);
  const html = await response.text();
  assert.ok(html.includes(css));
  assert.match(html, /架空データ専用・実決済なし/);
  assert.match(html, /公開ディレクトリへの掲載は準備中です。接続権限がある方はChatGPTで開けます。/);
  assert.match(html, /https:\/\/chatgpt\.com\/plugins\/plugin_asdk_app_sites_1db06e9428108191bb778557411728a5/);
  assert.match(html, /href="\/support"/);
  assert.match(html, /href="\/example.csv" download="example.csv"/);
  assert.match(html, /https:\/\/github\.com\/hapx2yuki\/koharu-devday-demo/);
  assert.match(html, /Yuki Urata/);
  assert.doesNotMatch(html, /<script|<iframe|<form/);
});
test('公開ページの3書体を同梱し、MCP AppのHTMLへは追加しない', async () => {
  const { default: worker } = await import(new URL('../dist/worker.js', import.meta.url).href);
  const response = await worker.fetch(new Request('https://demo.example/'));
  assert.match(response.headers.get('Content-Security-Policy')!, /font-src data:/);
  const html = await response.text();
  const embedded = [...html.matchAll(/data:font\/ttf;base64,([A-Za-z0-9+/=]+)/g)];
  const files = ['mplus2-regular-public.ttf', 'mplus2-bold-public.ttf', 'mplus1code-public.ttf'];
  assert.equal(embedded.length, files.length);
  for (let index = 0; index < files.length; index++) {
    const data = Buffer.from(embedded[index]![1]!, 'base64');
    assert.equal(data.readUInt32BE(0), 0x00010000);
    assert.deepEqual(data, await readFile(new URL('../assets/fonts/' + files[index], import.meta.url)));
  }
  assert.match(html, /font-family:"M PLUS 2"/);
  assert.match(html, /font-family:"M PLUS 1 Code"/);
  assert.match(html, /SIL OPEN FONT LICENSE Version 1.1/);
  assert.doesNotMatch(html, /url\(https?:/);
  const appHtml = await readFile(new URL('../dist/ui.html', import.meta.url), 'utf8');
  assert.doesNotMatch(appHtml, /data:font\/ttf/);
});
test('サポートは実際の操作・CSV条件・公開窓口を案内する', async () => {
  const response = await handlePublicMcp(new Request('https://demo.example/support'), '');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /aria-current="page"/);
  for (const text of ['試し注文を確定', '取り消す', '100KB', '2000行', 'pickup_number', 'product_id', 'quantity', 'unit_price_yen', 'status', 'confirmed', 'cancelled', '発生日時', 'エラー文']) assert.ok(html.includes(text), text);
  assert.match(html, /mailto:hapx2yuki@gmail.com/);
  assert.match(html, /問い合わせを閲覧するのはYuki Urata本人だけ/);
  assert.match(html, /完了後90日を目安に削除/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.doesNotMatch(html, /24時間以内|翌営業日|privacyPolicyURL|termsOfServiceURL/);
});
test('公開の方針と利用条件は承認済み運営条件と実際の処理範囲を返す', async () => {
  const privacy = await handlePublicMcp(new Request('https://demo.example/privacy'), '');
  const terms = await handlePublicMcp(new Request('https://demo.example/terms'), '');
  assert.equal(privacy.status, 200);
  assert.equal(terms.status, 200);
  const privacyHtml = await privacy.text();
  const termsHtml = await terms.text();
  for (const html of [privacyHtml, termsHtml]) {
    assert.match(html, /Yuki Urata/);
    assert.match(html, /本ページの初回公開日/);
    assert.match(html, /提供対象 日本/);
    assert.match(html, /href="\/support"/);
    assert.match(html, /aria-current="page"/);
    assert.doesNotMatch(html, /未公開の草案|公開前に確定|<script|<iframe|<form/);
  }
  assert.match(privacyHtml, /閲覧するのは運営者のYuki Urata本人だけ/);
  assert.match(privacyHtml, /対応完了後90日を目安に削除/);
  assert.match(privacyHtml, /CSV本文が公開MCPへ渡り/);
  assert.match(privacyHtml, /ログ項目や保存期間を、本デモの独自コードだけで確認・変更することはできません/);
  assert.match(termsHtml, /画面の終了や再読込みで失われる場合/);
  assert.match(termsHtml, /実店舗への予約、商品購入、決済、顧客への通知は行いません/);
});
test('審査用録画がない場合は動画と再生ページを公開しない', async () => {
  for (const path of ['/demo-recording', '/demo-recording.mp4']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await handlePublicMcp(new Request('https://demo.example' + path, { method }), '');
      assert.equal(response.status, 404);
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
  }
});
test('録画ページは標準の動画操作と同一サイトのMP4だけを許可する', async () => {
  const recording = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  const send = (method: string) => handlePublicMcp(new Request('https://demo.example/demo-recording', { method }), '', 'shared-style', undefined, recording);
  const response = await send('GET');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.match(response.headers.get('Content-Security-Policy')!, /media-src 'self'/);
  const html = await response.text();
  assert.match(html, /<video controls playsinline preload="metadata"/);
  assert.match(html, /src="\/demo-recording.mp4"/);
  assert.match(html, /shared-style/);
  assert.doesNotMatch(html, /autoplay|<iframe|<script/);
  const head = await send('HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await send('POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
});
test('録画のGETとHEADは実バイト数を返し、範囲要求で既知のバイトだけを返す', async () => {
  const recording = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  const send = (headers: Record<string, string> = {}, method = 'GET') => handlePublicMcp(new Request('https://demo.example/demo-recording.mp4', { method, headers }), '', '', undefined, recording);
  const full = await send();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Content-Type'), 'video/mp4');
  assert.equal(full.headers.get('Content-Length'), '10');
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(full.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(full.headers.get('Cache-Control')!, /no-transform/);
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), recording);
  const head = await send({ Range: 'bytes=2-4' }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '10');
  assert.equal(head.headers.get('Content-Range'), null);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const [range, contentRange, expected] of [
    ['bytes=2-4', 'bytes 2-4/10', [2, 3, 4]],
    ['bytes=7-', 'bytes 7-9/10', [7, 8, 9]],
    ['bytes=-3', 'bytes 7-9/10', [7, 8, 9]],
    ['bytes=8-100', 'bytes 8-9/10', [8, 9]],
    ['bytes=-100', 'bytes 0-9/10', [...recording]],
  ] as const) {
    const response = await send({ Range: range });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('Content-Range'), contentRange, range);
    assert.equal(response.headers.get('Content-Length'), String(expected.length), range);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected, range);
  }
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'items=0-1', 'bytes=9007199254740992-']) {
    const response = await send({ Range: range });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('Content-Range'), 'bytes */10', range);
    assert.equal(response.headers.get('Content-Length'), '0', range);
    assert.equal((await response.arrayBuffer()).byteLength, 0, range);
  }
  const ifRange = await send({ Range: 'bytes=2-4', 'If-Range': '"unverified-version"' });
  assert.equal(ifRange.status, 200);
  assert.deepEqual(new Uint8Array(await ifRange.arrayBuffer()), recording);
  assert.equal((await send({}, 'POST')).status, 405);
});
test('公開CSVは既定の架空データと一致し、HEADも同じ種別で本文なしを返す', async () => {
  const response = await handlePublicMcp(new Request('https://demo.example/example.csv'), '');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="example.csv"');
  const csv = await response.text();
  assert.equal(csv, SAMPLE_CSV);
  assert.deepEqual(summarizeDemoCsv(csv), { rows: 3, confirmedUnits: 3, confirmedTotalYen: 1450, cancelledRows: 1 });
  for (const path of ['/', '/support', '/privacy', '/terms', '/example.csv']) {
    const head = await handlePublicMcp(new Request('https://demo.example' + path, { method: 'HEAD' }), '');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
});
test('公開ページへの書込要求と未定義URLを受け付けず、MCPのOPTIONSは維持する', async () => {
  for (const path of ['/', '/support', '/privacy', '/terms', '/example.csv']) {
    const response = await handlePublicMcp(new Request('https://demo.example' + path, { method: 'POST', body: 'test' }), '');
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
  const missing = await handlePublicMcp(new Request('https://demo.example/unknown-page'), '');
  assert.equal(missing.status, 404);
  const options = await handlePublicMcp(new Request('https://demo.example/mcp', { method: 'OPTIONS' }), '');
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET,POST,OPTIONS');
});

async function setup(mode: 'local-demo' | 'public-readonly' = 'local-demo') {
  const server = createDemoServer('<!doctype html><p>架空データ</p>', mode);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
function view(result: unknown): MissionOrdersSnapshot {
  return (result as { structuredContent: { snapshot: MissionOrdersSnapshot } }).structuredContent.snapshot;
}
test('公式MCPのtools/listがglobal/thread/file UIメタデータを返す', async () => {
  const { client, close } = await setup();
  try {
    const tools = (await client.listTools()).tools;
    const open = tools.find(t => t.name === 'koharu_open')!;
    assert.deepEqual((open._meta?.['openai/ui'] as { entrypoints: unknown }).entrypoints, [{ type: 'global' }, { type: 'thread' }]);
    const viewer = tools.find(t => t.name === 'koharu_csv_viewer')!;
    assert.deepEqual((viewer._meta?.['openai/ui'] as { entrypoints: unknown }).entrypoints, [{ type: 'file', extensions: ['.csv'] }]);
    const resource = await client.readResource({ uri: UI_URI });
    assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app');
    assert.ok('text' in resource.contents[0]!);
  } finally { await close(); }
});
test('MCP注文は在庫と枠を変更し、同じ依頼を再送しても二重注文しない', async () => {
  const { client, close } = await setup();
  try {
    const before = view(await client.callTool({ name: 'koharu_snapshot', arguments: {} }));
    const args = { requestId: 'order_test_1', slotId: 'pickup-1', items: [{ productId: 'coffee', quantity: 2 }] };
    const first = await client.callTool({ name: 'koharu_place_order', arguments: args });
    const again = await client.callTool({ name: 'koharu_place_order', arguments: args });
    const after = view(again);
    assert.equal(after.orders.length, 1); assert.equal(after.confirmedTotalYen, 900);
    assert.equal(after.products.find(p => p.id === 'coffee')!.availableStock, before.products.find(p => p.id === 'coffee')!.availableStock - 2);
    assert.equal(after.slots[0]!.remainingCapacity, before.slots[0]!.remainingCapacity - 1);
    const id = view(first).orders[0]!.id;
    const cancelled = view(await client.callTool({ name: 'koharu_cancel_order', arguments: { requestId: 'cancel_test', orderId: id } }));
    assert.equal(cancelled.confirmedOrderCount, 0); assert.equal(cancelled.products[0]!.availableStock, before.products[0]!.availableStock);
  } finally { await close(); }
});
test('同時注文でも在庫を超えない・メモリーはサーバー間で共有しない', async () => {
  const a = await setup(), b = await setup();
  try {
    const result = await Promise.all([1, 2].map(n => a.client.callTool({ name: 'koharu_place_order', arguments: { requestId: 'parallel_' + n, slotId: 'pickup-1', items: [{ productId: 'coffee', quantity: 40 }] } })));
    assert.equal(result.filter(r => r.isError).length, 1);
    assert.equal(view(await b.client.callTool({ name: 'koharu_snapshot', arguments: {} })).orders.length, 0);
  } finally { await a.close(); await b.close(); }
});
test('公開MCPは読取のみで注文変更ツールを一切公開しない', async () => {
  const { client, close } = await setup('public-readonly');
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(!names.includes('koharu_place_order')); assert.ok(!names.includes('koharu_cancel_order')); assert.ok(!names.includes('koharu_export_csv'));
    assert.equal(view(await client.callTool({ name: 'koharu_snapshot', arguments: {} })).orders.length, 0);
  } finally { await close(); }
});
test('公開Workerは公式Streamable HTTPでinitialize・tools/listに応答する', async () => {
  const send = (body: object) => handlePublicMcp(new Request('https://demo.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) }), '<html>demo</html>');
  const decode = async (response: Response) => { const raw = await response.text(); return JSON.parse(raw.startsWith('event:') ? raw.split('data: ')[1]!.trim() : raw); };
  const initial = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(initial.status, 200); assert.ok((await decode(initial)).result.serverInfo);
  const list = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = (await decode(list)).result.tools.map((t: {name:string}) => t.name);
  assert.ok(names.includes('koharu_open')); assert.ok(!names.includes('koharu_place_order'));
  const large = await handlePublicMcp(new Request('https://demo.example/mcp', { method: 'POST', headers: {'Content-Type':'application/json'}, body: 'x'.repeat(150_001) }), '');
  assert.equal(large.status, 413);
});
test('公開Workerは正式MCP2のdiscoveryとreadonly呼出しを処理する', async () => {
  const send = (method: string, params: Record<string, unknown> = {}) => handlePublicMcp(new Request('https://demo.example/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json,text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {name:'test',version:'1'}, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
  }), '<html>demo</html>');
  const discovered = await send('server/discover'); assert.equal(discovered.status, 200);
  assert.deepEqual((await discovered.json()).result.supportedVersions, ['2026-07-28']);
  const response = await send('tools/call', {name:'koharu_snapshot',arguments:{}});
  assert.equal(response.status,200); const body = await response.json();
  assert.equal(body.result.structuredContent.mode, 'public-readonly');
});
test('Sitesの最小discovery要求だけを互換処理し、実行はSDKへ渡す', async () => {
  const probe = await handlePublicMcp(new Request('https://demo.example/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} }) }), '');
  assert.equal(probe.status, 200);
  assert.deepEqual(await probe.json(), { jsonrpc: '2.0', id: 1, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {}, resources: {} } } });
  assert.equal(probe.headers.get('Cache-Control'), 'no-store');
  const nonProbe = await handlePublicMcp(new Request('https://demo.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json,text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'server/discover', params: { unexpected: true } }) }), '');
  assert.ok(!(await nonProbe.text()).includes('supportedVersions'));
});
test('CSVは架空形式のみを集計し、数式・未知価格・異常行を拒否する', () => {
  const header = 'pickup_number,product_id,quantity,unit_price_yen,status\n';
  assert.deepEqual(summarizeDemoCsv(header + 'K001,coffee,2,450,confirmed\nK002,latte,1,550,cancelled\n'), { rows: 2, confirmedUnits: 2, confirmedTotalYen: 900, cancelledRows: 1 });
  for (const row of ['=cmd,coffee,2,450,confirmed','K001,coffee,2,1,confirmed','K001,<script>,2,450,confirmed','K001,coffee,-2,450,confirmed','K001,coffee,2,450,unknown']) assert.throws(() => summarizeDemoCsv(header + row));
});
test('同梱stdio配布物を実際に起動してMCP要求を処理できる', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/server.mjs'], stderr: 'pipe' });
  const client = new Client({ name: 'stdio-smoke', version: '1' });
  try { await client.connect(transport); assert.ok((await client.listTools()).tools.some(t => t.name === 'koharu_snapshot')); }
  finally { await client.close(); }
});
