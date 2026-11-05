import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions, OpenAIFileEntrypointInputSchema } from '@openai/mcp-extensions/app';
import { MissionOrders, MissionOrdersError } from './orders.js';
import { MemoryStore } from './store.js';
import { summarizeDemoCsv } from './csv.js';
import type { MissionOrdersSnapshot } from './order-types.js';

const app = new App({ name: 'こはる珈琲 デモ', version: '0.1.0' });
const extensions = new OpenAIExtensions(app);
const root = document.getElementById('app')!;
let mode = 'local-demo', connected = false;
let snapshot: MissionOrdersSnapshot | undefined;
let fileInput: { file: { name: string; resourceUri: string } } | undefined;
let preview: MissionOrders | undefined;
let pending: { requestId: string; slotId: string; items: { productId: string; quantity: number }[] } | undefined;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klass?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (klass) n.className = klass; return n;
}
function message(text: string): void { const p = document.getElementById('message'); if (p) p.textContent = text; }
class ConfirmedInputError extends Error {}
async function call(name: string, args: Record<string, unknown> = {}): Promise<void> {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new ConfirmedInputError(result.content?.filter(c => c.type === 'text').map(c => c.text).join(' ') || '処理を確認できませんでした。');
  await accept(result.structuredContent);
}
async function accept(content: unknown): Promise<void> {
  if (!content || typeof content !== 'object') return;
  const data = content as { mode?: string; snapshot?: MissionOrdersSnapshot };
  if (!data.snapshot) return; mode = data.mode ?? mode;
  if (mode === 'public-readonly' && !preview) {
    preview = new MissionOrders(new MemoryStore(), 'koharu_browser_demo');
    await preview.initialize({ requestId: 'initialize_browser', products: data.snapshot.products, slots: data.snapshot.slots });
  }
  snapshot = preview ? await preview.snapshot() : data.snapshot; render();
}
function render(): void {
  if (!snapshot) return; root.replaceChildren();
  const header = node('header'); header.append(node('p', 'KOHARU COFFEE / DEMO', 'eyebrow'), node('h1', '注文から、受取まで。'));
  header.append(node('p', mode === 'public-readonly' ? '公開サーバーは読取専用です。下の試し注文は、この画面のメモリー内だけで動きます。' : '架空の店舗を使ったローカルデモです。実決済・顧客への連絡はありません。', 'note')); root.append(header);
  const stats = node('div', undefined, 'stats');
  for (const [label, value] of [['受付中', snapshot.confirmedOrderCount + '件'], ['注文合計', '¥' + snapshot.confirmedTotalYen.toLocaleString('ja-JP')], ['在庫合計', snapshot.products.reduce((n,p) => n + p.availableStock, 0) + '点']]) {
    const card = node('section'); card.append(node('span', label), node('strong', value)); stats.append(card);
  } root.append(stats);
  const layout = node('div', undefined, 'layout'), inventory = node('section'); inventory.append(node('h2', '商品と在庫'));
  for (const p of snapshot.products) { const row = node('div', undefined, 'row'), label = node('div'); label.append(node('strong', p.name), node('small', '¥' + p.unitPriceYen + ' / 残り' + p.availableStock + '点')); row.append(label); inventory.append(row); }
  inventory.append(node('h2', '受取枠'));
  for (const s of snapshot.slots) { const row = node('div', undefined, 'row'); row.append(node('span', s.label), node('strong', '残り' + s.remainingCapacity + '件')); inventory.append(row); } layout.append(inventory);
  const ordering = node('section'); ordering.append(node('h2', '試し注文')); const form = node('form');
  const product = node('select'); product.id = 'product'; product.required = true;
  for (const p of snapshot.products) { const o = node('option', p.name); o.value = p.id; o.disabled = p.availableStock < 1; product.append(o); }
  const amount = node('input'); amount.id = 'amount'; amount.type = 'number'; amount.min = '1'; amount.max = '100'; amount.value = '1'; amount.required = true;
  const slot = node('select'); slot.id = 'slot'; slot.required = true;
  for (const s of snapshot.slots) { const o = node('option', s.label + '（残り' + s.remainingCapacity + '件）'); o.value = s.id; o.disabled = !s.acceptingOrders; slot.append(o); }
  for (const [text, el] of [['商品', product], ['個数', amount], ['受取枠', slot]] as const) { const label = node('label', text); label.htmlFor = el.id; form.append(label, el); }
  const submit = node('button', pending ? '同じ注文を再確認' : '試し注文を確定'); submit.type = 'submit'; form.append(submit);
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    pending ??= { requestId: 'ui_' + crypto.randomUUID().replaceAll('-', ''), slotId: slot.value, items: [{ productId: product.value, quantity: Number(amount.value) }] };
    [product, amount, slot].forEach(el => { el.disabled = true; });
    try {
      if (preview) { snapshot = (await preview.place(pending)).snapshot; pending = undefined; render(); }
      else { await call('koharu_place_order', pending); pending = undefined; render(); }
      message('注文を確定し、在庫と受取枠を更新しました。');
    } catch (e) {
      if (e instanceof ConfirmedInputError || e instanceof MissionOrdersError) { pending = undefined; render(); }
      else { submit.disabled = false; submit.textContent = '同じ注文を再確認'; }
      message(e instanceof Error ? e.message : '結果を確認できませんでした。');
    }
  };
  ordering.append(form); const feedback = node('p', '', 'message'); feedback.id = 'message'; feedback.setAttribute('role', 'status'); ordering.append(feedback); layout.append(ordering); root.append(layout);
  const orders = node('section', undefined, 'orders'); orders.append(node('h2', '試し注文の結果')); if (!snapshot.orders.length) orders.append(node('p', 'まだ試し注文はありません。', 'note'));
  for (const order of [...snapshot.orders].reverse()) {
    const row = node('div', undefined, 'row'), info = node('div'); info.append(node('strong', order.pickupNumber + ' ・ ¥' + order.totalYen), node('small', order.items.map(i => i.name + ' ' + i.quantity + '点').join('、') + ' / ' + (order.status === 'cancelled' ? '取消済み' : '受付済み'))); row.append(info);
    if (order.status === 'confirmed') {
      const cancel = node('button', '取り消す', 'secondary'); cancel.type = 'button'; const requestId = 'cancel_' + order.id.replaceAll('-', '');
      cancel.onclick = async () => { cancel.disabled = true; try { if (preview) { snapshot = (await preview.cancel({ requestId, orderId: order.id })).snapshot; render(); } else await call('koharu_cancel_order', { requestId, orderId: order.id }); message('取り消し、在庫と受取枠を戻しました。'); } catch(e) { message(e instanceof Error ? e.message : '結果を確認できませんでした。'); cancel.disabled = false; } }; row.append(cancel);
    } orders.append(row);
  } root.append(orders);
  const csv = node('section', undefined, 'csv'); csv.append(node('h2', '架空注文CSVを確認'));
  const input = node('input'); input.type = 'file'; input.accept = '.csv,text/csv'; input.setAttribute('aria-label', 'こはる珈琲の架空注文CSV');
  const output = node('pre', '選んだCSVはこの画面で検査します。サーバーへのアップロードや保存はしません。'); output.id = 'csv-result'; output.setAttribute('role', 'status');
  input.onchange = async () => { const file = input.files?.[0]; if (!file) return; if (file.size > 100_000) { output.textContent = 'CSVは100KB以内にしてください。'; return; } inspectCsv(await file.text(), file.name); }; csv.append(input, output); root.append(csv);
}
function inspectCsv(text: string, name: string): void {
  const out = document.getElementById('csv-result'); if (!out) return;
  try { const s = summarizeDemoCsv(text); out.textContent = name + '\n' + s.rows + '行を確認\n受付済み ' + s.confirmedUnits + '点 / ¥' + s.confirmedTotalYen.toLocaleString('ja-JP') + '\n取消済み ' + s.cancelledRows + '行'; }
  catch(e) { out.textContent = e instanceof Error ? e.message : 'CSVを確認できませんでした。'; }
}
async function readOpenedFile(): Promise<void> {
  if (!fileInput || !connected) return;
  if (!extensions.resources) { message('この実行画面は正式なファイル読取に対応していません。CSV選択から確認できます。'); return; }
  const { file } = fileInput; fileInput = undefined;
  try {
    const result = await extensions.resources.read({ uri: file.resourceUri }); const value = result.contents[0];
    if (value && ('text' in value ? value.text.length > 100_000 : 'blob' in value && value.blob.length > 140_000)) throw new Error('size');
    const text = value && 'text' in value ? value.text : value && 'blob' in value ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.blob), c => c.charCodeAt(0))) : '';
    inspectCsv(text, file.name);
  } catch { message('正式ファイルの読取結果を取得できませんでした。'); }
}
app.addEventListener('toolinput', async ({ arguments: args }) => { const parsed = OpenAIFileEntrypointInputSchema.safeParse(args); if (parsed.success) { fileInput = parsed.data; await readOpenedFile(); } });
app.ontoolresult = async result => { await accept(result.structuredContent); await readOpenedFile(); };
app.addEventListener('hostcontextchanged', context => { if (context.theme) applyDocumentTheme(context.theme); if (context.styles?.variables) applyHostStyleVariables(context.styles.variables); });
try { await app.connect(); connected = true; const context = app.getHostContext(); if (context?.theme) applyDocumentTheme(context.theme); if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables); await readOpenedFile(); if (!snapshot) await call('koharu_snapshot'); }
catch { root.replaceChildren(node('h1', '接続を確認できませんでした'), node('p', 'この画面はChatGPTのMCP Appとして開いてください。架空注文のサーバーは起動していません。')); }
