import type { Store } from './store.js';
import type {
  CancelMissionOrderInput, InitializeMissionOrdersInput, MissionOrder, MissionOrderConfiguration,
  MissionOrderMutation, MissionOrderProductInput, MissionOrdersControlMutation, MissionOrdersErrorCode,
  MissionOrdersSnapshot, MissionOrdersStatus, MissionPickupSlotInput, PlaceMissionOrderInput,
  ResetMissionOrdersInput,
} from './order-types.js';

interface Receipt { requestId: string; fingerprint: string; order?: MissionOrder }
interface State extends MissionOrderConfiguration {
  version: 1;
  missionId: string;
  revision: number;
  status: MissionOrdersStatus;
  orders: MissionOrder[];
  nextPickupNumber: number;
  receipts: Receipt[];
}

export class MissionOrdersError extends Error {
  constructor(readonly code: MissionOrdersErrorCode, message: string, readonly status = 409) {
    super(message); this.name = 'MissionOrdersError';
  }
}

function invalid(message: string): never { throw new MissionOrdersError('invalid_input', message, 400); }
function text(value: unknown, label: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${label}を確認してください。`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = text(value, label, 160);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) invalid(`${label}の形式を確認してください。`);
  return result;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(`${label}は${min}以上${max}以下の整数で指定してください。`);
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('入力はオブジェクトで指定してください。');
  return value as Record<string, unknown>;
}
function instant(value: unknown, label: string): string {
  const result = text(value, label, 40);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(result);
  if (!parts || !Number.isFinite(Date.parse(result))) invalid(`${label}はタイムゾーン付き日時で指定してください。`);
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) invalid(`${label}の実在する日付と時刻を指定してください。`);
  return new Date(result).toISOString();
}
function configuration(input: MissionOrderConfiguration): MissionOrderConfiguration {
  const raw = object(input);
  if (!Array.isArray(raw.products) || raw.products.length < 1 || raw.products.length > 50 || !Array.isArray(raw.slots) || raw.slots.length < 1 || raw.slots.length > 100) invalid('商品と受取枠を指定してください。');
  const products: MissionOrderProductInput[] = raw.products.map(value => {
    const item = object(value);
    return { id: identifier(item.id, '商品ID'), name: text(item.name, '商品名'), unitPriceYen: integer(item.unitPriceYen, '価格', 1, 1_000_000), stock: integer(item.stock, '在庫', 0, 100_000) };
  });
  const slots: MissionPickupSlotInput[] = raw.slots.map(value => {
    const item = object(value);
    const startsAt = instant(item.startsAt, '受取時刻'), orderCutoffAt = instant(item.orderCutoffAt, '注文締切');
    if (Date.parse(orderCutoffAt) > Date.parse(startsAt)) invalid('注文締切は受取時刻以前にしてください。');
    return { id: identifier(item.id, '受取枠ID'), label: text(item.label, '受取枠名'), startsAt, orderCutoffAt, capacity: integer(item.capacity, '受取枠の件数', 1, 10_000) };
  });
  if (new Set(products.map(item => item.id)).size !== products.length || new Set(slots.map(item => item.id)).size !== slots.length) invalid('商品IDと受取枠IDは重複できません。');
  return { products, slots };
}

/** Pure fixture builder. It never initializes or resets persistent orders. */
export function createKoharuOrderConfiguration(now = new Date()): MissionOrderConfiguration {
  if (!Number.isFinite(now.getTime())) invalid('基準日時を確認してください。');
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const first = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1, 1);
  return {
    products: [
      { id: 'coffee', name: 'こはるブレンド', unitPriceYen: 450, stock: 40 },
      { id: 'latte', name: 'カフェラテ', unitPriceYen: 550, stock: 30 },
      { id: 'baked-sweets', name: '季節の焼菓子', unitPriceYen: 320, stock: 25 },
    ],
    slots: [0, 1, 2].map(index => {
      const starts = first + index * 30 * 60 * 1000;
      return { id: `pickup-${index + 1}`, label: index === 0 ? '10:00–10:30' : index === 1 ? '10:30–11:00' : '11:00–11:30', startsAt: new Date(starts).toISOString(), orderCutoffAt: new Date(starts - 30 * 60 * 1000).toISOString(), capacity: 8 };
    }),
  };
}

export class MissionOrders {
  private readonly key: string;
  constructor(private readonly store: Store, private readonly missionId: string) {
    identifier(missionId, '案件ID'); this.key = `mission-orders:${missionId}`;
  }
  private empty(): State { return { version: 1, missionId: this.missionId, revision: 0, status: 'unconfigured', products: [], slots: [], orders: [], nextPickupNumber: 1, receipts: [] }; }
  private view(state: State): MissionOrdersSnapshot {
    const confirmed = state.orders.filter(order => order.status === 'confirmed');
    return {
      missionId: this.missionId, revision: state.revision, status: state.status,
      products: state.products.map(product => ({ ...product, availableStock: product.stock - confirmed.reduce((total, order) => total + order.items.filter(item => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0), 0) })),
      slots: state.slots.map(slot => { const reservedOrders = confirmed.filter(order => order.slotId === slot.id).length; return { ...slot, reservedOrders, remainingCapacity: slot.capacity - reservedOrders, acceptingOrders: state.status === 'open' && Date.now() < Date.parse(slot.orderCutoffAt) && reservedOrders < slot.capacity }; }),
      orders: structuredClone(state.orders), confirmedOrderCount: confirmed.length,
      confirmedTotalYen: confirmed.reduce((total, order) => total + order.totalYen, 0),
    };
  }
  async snapshot(): Promise<MissionOrdersSnapshot> { return this.view(await this.store.get<State>(this.key) ?? this.empty()); }

  private async change(requestId: string, fingerprint: string, update: (state: State) => MissionOrder | undefined): Promise<{ receipt: Receipt; replayed: boolean; snapshot: MissionOrdersSnapshot }> {
    for (let attempt = 0; attempt < 64; attempt++) {
      const current = await this.store.get<State>(this.key), state = current ?? this.empty();
      const previous = state.receipts.find(receipt => receipt.requestId === requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new MissionOrdersError('idempotency_conflict', '同じリクエストIDを異なる操作には使えません。');
        return { receipt: structuredClone(previous), replayed: true, snapshot: this.view(state) };
      }
      if (state.receipts.length >= 10_000) throw new MissionOrdersError('storage_limit', 'この案件の操作記録の上限に達しました。');
      const next = structuredClone(state), order = update(next);
      const receipt: Receipt = { requestId, fingerprint, ...(order ? { order: structuredClone(order) } : {}) };
      next.receipts.push(receipt); next.revision++;
      const saved = current ? await this.store.compareSet(this.key, current, next) : await this.store.insert(this.key, next);
      if (saved) return { receipt, replayed: false, snapshot: this.view(next) };
    }
    throw new MissionOrdersError('orders_busy', '注文が集中しています。同じリクエストIDで再試行してください。', 503);
  }
  async initialize(input: InitializeMissionOrdersInput): Promise<MissionOrdersControlMutation> {
    const raw = object(input), requestId = identifier(raw.requestId, 'リクエストID'), config = configuration(input);
    const result = await this.change(requestId, JSON.stringify(['initialize', config]), state => {
      if (state.status !== 'unconfigured') throw new MissionOrdersError('already_configured', '注文受付は既に設定済みです。');
      state.products = config.products; state.slots = config.slots; state.status = 'open'; return undefined;
    });
    return { replayed: result.replayed, snapshot: result.snapshot };
  }
  async place(input: PlaceMissionOrderInput): Promise<MissionOrderMutation> {
    const raw = object(input), requestId = identifier(raw.requestId, 'リクエストID'), slotId = identifier(raw.slotId, '受取枠ID');
    if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 20) invalid('注文商品を1種類以上20種類以下で指定してください。');
    const quantities = new Map<string, number>();
    for (const value of raw.items) { const item = object(value), productId = identifier(item.productId, '商品ID'), quantity = integer(item.quantity, '個数', 1, 100); quantities.set(productId, (quantities.get(productId) ?? 0) + quantity); }
    if ([...quantities.values()].reduce((sum, count) => sum + count, 0) > 100) invalid('1注文の合計個数は100以下にしてください。');
    const items = [...quantities].sort(([left], [right]) => left.localeCompare(right)).map(([productId, quantity]) => ({ productId, quantity }));
    const result = await this.change(requestId, JSON.stringify(['place', slotId, items]), state => {
      if (state.status === 'unconfigured') throw new MissionOrdersError('not_configured', '注文受付がまだ設定されていません。');
      if (state.status !== 'open') throw new MissionOrdersError('orders_stopped', '注文受付は停止中です。');
      const snapshot = this.view(state), slot = state.slots.find(item => item.id === slotId);
      if (!slot) throw new MissionOrdersError('slot_not_found', '受取枠が見つかりません。', 404);
      if (Date.now() >= Date.parse(slot.orderCutoffAt)) throw new MissionOrdersError('order_cutoff_passed', 'この受取枠の注文締切を過ぎています。');
      if (snapshot.slots.find(item => item.id === slotId)!.remainingCapacity < 1) throw new MissionOrdersError('slot_full', 'この受取枠は満席です。');
      if (state.orders.length >= 2_000) throw new MissionOrdersError('storage_limit', 'この案件の注文記録の上限に達しました。');
      const lines = items.map(item => {
        const product = snapshot.products.find(product => product.id === item.productId);
        if (!product) throw new MissionOrdersError('product_not_found', '商品が見つかりません。', 404);
        if (product.availableStock < item.quantity) throw new MissionOrdersError('insufficient_stock', `${product.name}の在庫が不足しています。`);
        return { ...item, name: product.name, unitPriceYen: product.unitPriceYen, lineTotalYen: product.unitPriceYen * item.quantity };
      });
      const order: MissionOrder = { id: `order_${crypto.randomUUID()}`, pickupNumber: `K${String(state.nextPickupNumber).padStart(3, '0')}`, slotId, items: lines, totalYen: lines.reduce((sum, item) => sum + item.lineTotalYen, 0), status: 'confirmed', createdAt: new Date().toISOString() };
      state.nextPickupNumber++; state.orders.push(order); return order;
    });
    return { order: result.receipt.order!, replayed: result.replayed, snapshot: result.snapshot };
  }
  async cancel(input: CancelMissionOrderInput): Promise<MissionOrderMutation> {
    const raw = object(input), requestId = identifier(raw.requestId, 'リクエストID'), orderId = identifier(raw.orderId, '注文ID');
    const result = await this.change(requestId, JSON.stringify(['cancel', orderId]), state => {
      const order = state.orders.find(order => order.id === orderId);
      if (!order) throw new MissionOrdersError('order_not_found', '注文が見つかりません。', 404);
      if (order.status !== 'cancelled') { order.status = 'cancelled'; order.cancelledAt = new Date().toISOString(); }
      return order;
    });
    return { order: result.receipt.order!, replayed: result.replayed, snapshot: result.snapshot };
  }
  async stop(input: { requestId: string }): Promise<MissionOrdersControlMutation> {
    const requestId = identifier(object(input).requestId, 'リクエストID');
    const result = await this.change(requestId, JSON.stringify(['stop']), state => {
      if (state.status === 'unconfigured') throw new MissionOrdersError('not_configured', '注文受付がまだ設定されていません。');
      state.status = 'stopped'; return undefined;
    });
    return { replayed: result.replayed, snapshot: result.snapshot };
  }
  async resetDemo(input: ResetMissionOrdersInput): Promise<MissionOrdersControlMutation> {
    const raw = object(input), requestId = identifier(raw.requestId, 'リクエストID'), expectedRevision = integer(raw.expectedRevision, '現在の版', 0, Number.MAX_SAFE_INTEGER);
    const result = await this.change(requestId, JSON.stringify(['resetDemo', expectedRevision]), state => {
      if (state.revision !== expectedRevision) throw new MissionOrdersError('stale_revision', '注文状態が更新されています。最新状態を確認してから初期化してください。');
      const config = createKoharuOrderConfiguration();
      state.products = config.products; state.slots = config.slots; state.orders = []; state.status = 'open';
      // Receipt history and the pickup sequence survive reset, preventing old
      // requests from creating another order or reusing a visible pickup number.
      return undefined;
    });
    return { replayed: result.replayed, snapshot: result.snapshot };
  }
}
