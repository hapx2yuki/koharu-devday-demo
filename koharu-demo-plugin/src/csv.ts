import type { MissionOrdersSnapshot } from './order-types.js';
export const CSV_HEADER = 'pickup_number,product_id,quantity,unit_price_yen,status';
const products = new Map([['coffee', 450], ['latte', 550], ['baked-sweets', 320]]);
export function summarizeDemoCsv(text: string): { rows: number; confirmedUnits: number; confirmedTotalYen: number; cancelledRows: number } {
  if (typeof text !== 'string' || text.length > 100_000 || text.includes('\0')) throw new Error('CSVは100KB以内のテキストにしてください。');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines[0] !== CSV_HEADER || lines.length > 2001) throw new Error('こはる珈琲の架空注文CSV形式だけを読み取れます。');
  let confirmedUnits = 0, confirmedTotalYen = 0, cancelledRows = 0;
  for (const row of lines.slice(1)) {
    const c = row.split(',');
    if (c.length !== 5 || !/^K\d{3,}$/.test(c[0]!) || !products.has(c[1]!) || !/^[1-9]\d{0,2}$/.test(c[2]!) || Number(c[2]) > 100 || Number(c[3]) !== products.get(c[1]!) || !['confirmed', 'cancelled'].includes(c[4]!)) throw new Error('CSVに、想定外の商品・価格・受取番号・数量・状態があります。');
    if (c[4] === 'confirmed') { confirmedUnits += Number(c[2]); confirmedTotalYen += Number(c[2]) * Number(c[3]); } else cancelledRows++;
  }
  return { rows: lines.length - 1, confirmedUnits, confirmedTotalYen, cancelledRows };
}
export function exportOrdersCsv(snapshot: MissionOrdersSnapshot): string {
  return [CSV_HEADER, ...snapshot.orders.flatMap(o => o.items.map(i => [o.pickupNumber, i.productId, i.quantity, i.unitPriceYen, o.status].join(',')))].join('\n') + '\n';
}
