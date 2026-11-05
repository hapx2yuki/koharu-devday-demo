import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
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
async function setupApp() {
  const root = new TestElement('main'); root.id = 'app';
  const connection = deferred<void>();
  const snapshotRequested = deferred<void>();
  const initialSnapshot = deferred<unknown>();
  const fileRequested = deferred<void>();
  const fileContents = deferred<unknown>();
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  let app!: TestApp;
  class TestApp {
    ontoolresult?: (result: { structuredContent: unknown }) => Promise<void>;
    constructor() { app = this; }
    addEventListener(type: string, handler: (event: unknown) => Promise<void>) { handlers.set(type, handler); }
    connect() { return connection.promise; }
    getHostContext() { return {}; }
    callServerTool() { snapshotRequested.resolve(); return initialSnapshot.promise; }
  }
  class TestExtensions {
    resources = { read: () => { fileRequested.resolve(); return fileContents.promise; } };
  }
  const snapshot = { mode: 'local-demo', snapshot: { products: [], slots: [], orders: [], confirmedOrderCount: 0, confirmedTotalYen: 0 } };
  const boot = runInNewContext(`(async () => { ${await appBundle} })()`, {
    testHost: { App: TestApp, OpenAIExtensions: TestExtensions, fileInputSchema: OpenAIFileEntrypointInputSchema },
    document: { createElement: (tag: string) => new TestElement(tag), getElementById: (id: string) => root.find(id) },
    TextDecoder, atob,
  }) as Promise<void>;
  return {
    root, connection, snapshotRequested, fileRequested, boot,
    openFile: () => handlers.get('toolinput')!({ arguments: { file: { name: 'example.csv', resourceUri: 'file://example.csv' } } }),
    finishFile: () => fileContents.resolve({ contents: [{ text: 'pickup_number,product_id,quantity,unit_price_yen,status\nK001,coffee,2,450,confirmed\n' }] }),
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
  assert.doesNotMatch(html, /24時間以内|翌営業日|privacyPolicyURL|termsOfServiceURL/);
});
test('公開CSVは既定の架空データと一致し、HEADも同じ種別で本文なしを返す', async () => {
  const response = await handlePublicMcp(new Request('https://demo.example/example.csv'), '');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="example.csv"');
  const csv = await response.text();
  assert.equal(csv, SAMPLE_CSV);
  assert.deepEqual(summarizeDemoCsv(csv), { rows: 3, confirmedUnits: 3, confirmedTotalYen: 1450, cancelledRows: 1 });
  for (const path of ['/', '/support', '/example.csv']) {
    const head = await handlePublicMcp(new Request('https://demo.example' + path, { method: 'HEAD' }), '');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
});
test('公開ページへの書込要求と未定義URLを受け付けず、MCPのOPTIONSは維持する', async () => {
  for (const path of ['/', '/support', '/example.csv']) {
    const response = await handlePublicMcp(new Request('https://demo.example' + path, { method: 'POST', body: 'test' }), '');
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
  const missing = await handlePublicMcp(new Request('https://demo.example/privacy'), '');
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
