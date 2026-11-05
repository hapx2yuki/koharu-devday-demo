import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDemoServer, UI_URI } from '../src/server.js';
import { handlePublicMcp } from '../src/public-worker.js';
import { summarizeDemoCsv } from '../src/csv.js';
import type { MissionOrdersSnapshot } from '../src/order-types.js';

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
