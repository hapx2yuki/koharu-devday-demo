import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { OpenAIUiToolMetadataSchema } from '@openai/mcp-extensions';
import { MissionOrders, MissionOrdersError, createKoharuOrderConfiguration } from './orders.js';
import { MemoryStore } from './store.js';
import { exportOrdersCsv, summarizeDemoCsv } from './csv.js';

export const UI_URI = 'ui://koharu/orders.html';
export const CSV_URI = 'koharu://orders/example.csv';
export const SAMPLE_CSV = 'pickup_number,product_id,quantity,unit_price_yen,status\nK001,coffee,2,450,confirmed\nK001,latte,1,550,confirmed\nK002,baked-sweets,1,320,cancelled\n';
export type ServerMode = 'local-demo' | 'public-readonly';
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mutate = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);

export function createDemoServer(appHtml: string, mode: ServerMode = 'local-demo'): McpServer {
  const server = new McpServer({ name: 'koharu-demo', version: '0.1.0' }, { instructions: 'すべて架空データの体験用です。実店舗の注文・決済・顧客連絡ではありません。注文操作前に商品・数量・受取枠を利用者と確認し、同じ依頼の再送は同じrequestIdを使ってください。public-readonlyではサーバーの注文を変更できません。' });
  registerDemoTools(server, appHtml, mode);
  return server;
}

/** Same schema and handlers back the legacy stdio and modern HTTP SDKs. */
export function registerDemoTools(server: { registerTool: (...args: any[]) => unknown; registerResource: (...args: any[]) => unknown }, appHtml: string, mode: ServerMode): void {
  const orders = new MissionOrders(new MemoryStore(), 'koharu_demo');
  const ready = orders.initialize({ requestId: 'initialize_demo', ...createKoharuOrderConfiguration() });
  const snapshot = async () => { await ready; return { mode, synthetic: true, snapshot: await orders.snapshot() }; };
  const result = (data: Record<string, unknown>): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
  const wrap = (handler: () => Promise<Record<string, unknown>>) => handler().then(result).catch(error => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof MissionOrdersError || error instanceof Error && error.message.startsWith('CSV') ? error.message : '架空デモの処理を完了できませんでした。' }] }));
  const uiMeta = (entrypoints: { type: 'global' | 'thread' }[] | { type: 'file'; extensions: string[] }[]) => ({
    ui: { resourceUri: UI_URI },
    'openai/ui': OpenAIUiToolMetadataSchema.parse({ entrypoints }),
  });
  server.registerResource('koharu-order-panel', UI_URI, { title: 'こはる珈琲 注文・在庫', mimeType: 'text/html;profile=mcp-app' }, async () => ({ contents: [{ uri: UI_URI, mimeType: 'text/html;profile=mcp-app', text: appHtml, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } }, 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'fullscreen' } } }] }));
  server.registerResource('koharu-example-csv', CSV_URI, { title: 'こはる珈琲 架空注文CSV', mimeType: 'text/csv' }, async () => ({ contents: [{ uri: CSV_URI, mimeType: 'text/csv', text: SAMPLE_CSV }] }));
  server.registerTool('koharu_open', { title: 'こはる珈琲を開く', description: '架空の注文・在庫・受取枠を、専用画面または会話の横で確認します。', inputSchema: z.object({}).strict(), annotations: readOnly, _meta: uiMeta([{ type: 'global' }, { type: 'thread' }]) }, () => wrap(snapshot));
  server.registerTool('koharu_snapshot', { title: '商品・在庫・受取枠を確認', description: 'デモの商品価格、残数、受取枠、試し注文の現在状態を読みます。', inputSchema: z.object({}).strict(), annotations: readOnly }, () => wrap(snapshot));
  server.registerTool('koharu_csv_viewer', { title: '架空注文CSVを開く', description: '利用者が選択したCSVを専用ビューアーで表示します。こはる珈琲の既定の架空データ形式だけを検査します。', inputSchema: z.object({ file: z.object({ name: z.string().max(250), resourceUri: z.string().max(2000) }) }), annotations: readOnly, _meta: uiMeta([{ type: 'file', extensions: ['.csv'] }]) }, () => wrap(async () => ({ ...(await snapshot()), fileViewer: true })));
  server.registerTool('koharu_example_csv', { title: '架空注文CSVの例', description: '既定の架空CSVと照合済み集計を読みます。実在顧客の情報は含みません。', inputSchema: z.object({}).strict(), annotations: readOnly }, () => wrap(async () => ({ synthetic: true, csv: SAMPLE_CSV, summary: summarizeDemoCsv(SAMPLE_CSV) })));
  server.registerTool('koharu_summarize_csv', { title: '架空注文CSVを集計', description: '既定の架空の商品ID・価格・受取番号だけのCSVを集計します。保存や外部送信はしません。', inputSchema: z.object({ csv: z.string().max(100_000) }).strict(), annotations: readOnly }, ({ csv }: { csv: string }) => wrap(async () => ({ synthetic: true, summary: summarizeDemoCsv(csv) })));
  if (mode === 'local-demo') {
    server.registerTool('koharu_place_order', { title: '試し注文を作成', description: 'このローカルデモのメモリー内に注文を1件作成します。商品・数量・受取枠を確認してから実行します。再送は同じrequestIdを使用してください。', inputSchema: z.object({ requestId, slotId: z.string().max(160), items: z.array(z.object({ productId: z.enum(['coffee', 'latte', 'baked-sweets']), quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(20) }).strict(), annotations: mutate }, ({ requestId, slotId, items }: { requestId: string; slotId: string; items: {productId: string;quantity: number}[] }) => wrap(async () => { await ready; return { synthetic: true, mode, ...(await orders.place({ requestId, slotId, items })) }; }));
    server.registerTool('koharu_cancel_order', { title: '試し注文を取り消す', description: 'このローカルデモの注文を取消し、在庫と受取枠を戻します。対象の受取番号を確認してから実行します。', inputSchema: z.object({ requestId, orderId: z.string().max(160) }).strict(), annotations: mutate }, ({ requestId, orderId }: { requestId: string; orderId: string }) => wrap(async () => { await ready; return { synthetic: true, mode, ...(await orders.cancel({ requestId, orderId })) }; }));
    server.registerTool('koharu_export_csv', { title: '試し注文をCSVにする', description: 'このローカルデモで作成した注文だけをCSVにします。保存や送信は行いません。', inputSchema: z.object({}).strict(), annotations: readOnly }, () => wrap(async () => { await ready; const csv = exportOrdersCsv(await orders.snapshot()); return { synthetic: true, csv, summary: summarizeDemoCsv(csv) }; }));
  }
}
