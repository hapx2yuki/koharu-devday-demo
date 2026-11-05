export type MissionOrdersStatus = 'unconfigured' | 'open' | 'stopped';
export type MissionOrderStatus = 'confirmed' | 'cancelled';

export interface MissionOrderProductInput {
  id: string;
  name: string;
  unitPriceYen: number;
  stock: number;
}

export interface MissionPickupSlotInput {
  id: string;
  label: string;
  startsAt: string;
  orderCutoffAt: string;
  /** Number of confirmed orders, not the number of individual products. */
  capacity: number;
}

export interface MissionOrderProduct extends MissionOrderProductInput {
  availableStock: number;
}

export interface MissionPickupSlot extends MissionPickupSlotInput {
  reservedOrders: number;
  remainingCapacity: number;
  acceptingOrders: boolean;
}

export interface MissionOrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceYen: number;
  lineTotalYen: number;
}

export interface MissionOrder {
  id: string;
  pickupNumber: string;
  slotId: string;
  items: MissionOrderLine[];
  totalYen: number;
  status: MissionOrderStatus;
  createdAt: string;
  cancelledAt?: string;
}

export interface MissionOrdersSnapshot {
  missionId: string;
  revision: number;
  status: MissionOrdersStatus;
  products: MissionOrderProduct[];
  slots: MissionPickupSlot[];
  orders: MissionOrder[];
  confirmedOrderCount: number;
  confirmedTotalYen: number;
}

export interface PlaceMissionOrderInput {
  requestId: string;
  items: Array<{ productId: string; quantity: number }>;
  slotId: string;
}

export interface CancelMissionOrderInput {
  requestId: string;
  orderId: string;
}

export interface MissionOrderMutation {
  /** On replay this is the original operation's receipt; snapshot is current. */
  order: MissionOrder;
  replayed: boolean;
  snapshot: MissionOrdersSnapshot;
}

export interface MissionOrderConfiguration {
  products: MissionOrderProductInput[];
  slots: MissionPickupSlotInput[];
}

export interface InitializeMissionOrdersInput extends MissionOrderConfiguration {
  requestId: string;
}

export interface ResetMissionOrdersInput {
  requestId: string;
  expectedRevision: number;
}

export interface MissionOrdersControlMutation {
  replayed: boolean;
  snapshot: MissionOrdersSnapshot;
}

export type MissionOrdersErrorCode =
  | 'invalid_input' | 'not_configured' | 'already_configured' | 'orders_stopped'
  | 'product_not_found' | 'slot_not_found' | 'order_not_found' | 'insufficient_stock'
  | 'slot_full' | 'order_cutoff_passed' | 'idempotency_conflict' | 'stale_revision'
  | 'orders_busy' | 'storage_limit';
