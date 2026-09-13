import Dexie, { Table } from 'dexie';
import { triggerQueueUpdate } from '@/lib/client/hooks/useOfflineSync';

export type Category1ActionType =
  | 'pos_sale'
  | 'add_utang'
  | 'record_payment'
  | 'open_shift'
  | 'close_shift';

export interface QueuedSaleItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

export interface QueuedActionPayload {
  clientUuid?: string;
  // POS Sale & Add Utang items
  items?: QueuedSaleItem[];
  paymentMethod?: 'cash' | 'gcash' | string;
  tendered?: number;
  customerId?: number | null;
  customerName?: string;
  note?: string;
  amount?: number;
  expectedBalance?: number;

  // Shift items
  openingFloat?: number;
  closingCash?: number;
  notes?: string;
  openedAt?: string;
  closedAt?: string;
}

export interface QueuedCategory1Action {
  id?: number;
  type: Category1ActionType;
  payload: QueuedActionPayload;
  createdAt: string;
  synced: boolean;
  syncFailed?: boolean;
  errorMessage?: string;
}

// Back-compat interface for existing components reading queued sales
export interface QueuedSale {
  id?: number;
  items: QueuedSaleItem[];
  paymentMethod: 'cash' | 'gcash' | string;
  tendered: number;
  customerId?: number | null;
  createdAt: string;
  synced: boolean;
  syncFailed?: boolean;
}

class OfflineQueueDB extends Dexie {
  queuedActions!: Table<QueuedCategory1Action, number>;

  constructor() {
    super('SariSariOfflineQueueV2');
    this.version(1).stores({
      queuedActions: '++id, type, createdAt, synced, syncFailed',
    });
  }
}

const db = new OfflineQueueDB();
export const offlineDb = db;

// Category 1 Queueing Functions
// Every queued action gets a permanent clientUuid stamped ONCE at queue time.
// The sync engine reuses this key on every retry, so a lost response can
// never turn into a duplicate sale/payment/shift on the server (idempotency).
function stampUuid(payload: QueuedActionPayload): QueuedActionPayload {
  if (!payload.clientUuid) {
    return { ...payload, clientUuid: crypto.randomUUID() };
  }
  return payload;
}

export async function queueCategory1Action(
  type: Category1ActionType,
  payload: QueuedActionPayload
): Promise<number> {
  const res = await db.queuedActions.add({
    type,
    payload: stampUuid(payload),
    createdAt: new Date().toISOString(),
    synced: false,
    syncFailed: false,
  });
  triggerQueueUpdate();
  return res;
}

export async function queueSale(sale: {
  items: QueuedSaleItem[];
  paymentMethod: string;
  tendered: number;
  customerId?: number | null;
  createdAt?: string;
  clientUuid?: string;
}): Promise<number> {
  const res = await db.queuedActions.add({
    type: 'pos_sale',
    payload: stampUuid({
      items: sale.items,
      paymentMethod: sale.paymentMethod,
      tendered: sale.tendered,
      customerId: sale.customerId ?? null,
      clientUuid: sale.clientUuid,
    }),
    createdAt: sale.createdAt || new Date().toISOString(),
    synced: false,
    syncFailed: false,
  });
  triggerQueueUpdate();
  return res;
}

export async function queueAddUtang(utang: {
  customerName: string;
  items: QueuedSaleItem[];
  note?: string;
  clientUuid?: string;
}): Promise<number> {
  return queueCategory1Action('add_utang', {
    customerName: utang.customerName,
    items: utang.items,
    note: utang.note,
    clientUuid: utang.clientUuid,
  });
}

export async function queueUtangPayment(payment: {
  customerName: string;
  amount: number;
  note?: string;
  expectedBalance?: number;
  clientUuid?: string;
}): Promise<number> {
  return queueCategory1Action('record_payment', {
    customerName: payment.customerName,
    amount: payment.amount,
    note: payment.note,
    expectedBalance: payment.expectedBalance,
    clientUuid: payment.clientUuid,
  });
}

export async function queueOpenShift(shift: {
  openingFloat: number;
  notes?: string;
  openedAt?: string;
  clientUuid?: string;
}): Promise<number> {
  return queueCategory1Action('open_shift', {
    openingFloat: shift.openingFloat,
    notes: shift.notes,
    openedAt: shift.openedAt || new Date().toISOString(),
    clientUuid: shift.clientUuid,
  });
}

export async function queueCloseShift(shift: {
  closingCash: number;
  notes?: string;
  closedAt?: string;
  clientUuid?: string;
}): Promise<number> {
  return queueCategory1Action('close_shift', {
    closingCash: shift.closingCash,
    notes: shift.notes,
    closedAt: shift.closedAt || new Date().toISOString(),
    clientUuid: shift.clientUuid,
  });
}

// Queries
export async function getPendingActions(): Promise<QueuedCategory1Action[]> {
  const actions = await db.queuedActions.toArray();
  return actions
    .filter((a) => !a.synced && !a.syncFailed)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getAllQueuedCategory1Actions(): Promise<QueuedCategory1Action[]> {
  const actions = await db.queuedActions.toArray();
  return actions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPendingCount(): Promise<number> {
  const pending = await db.queuedActions.where('synced').equals(0).toArray();
  return pending.filter((a) => !a.syncFailed).length;
}

export async function getFailedCount(): Promise<number> {
  const failed = await db.queuedActions.where('syncFailed').equals(1).toArray();
  return failed.length;
}

export async function getPendingSales(): Promise<QueuedSale[]> {
  const actions = await db.queuedActions.toArray();
  return actions
    .filter((a) => a.type === 'pos_sale' && !a.synced)
    .map((a) => ({
      id: a.id,
      items: a.payload.items || [],
      paymentMethod: a.payload.paymentMethod || 'cash',
      tendered: a.payload.tendered || 0,
      customerId: a.payload.customerId,
      createdAt: a.createdAt,
      synced: a.synced,
      syncFailed: a.syncFailed,
    }));
}

export async function getSyncFailedSales(): Promise<QueuedSale[]> {
  const actions = await db.queuedActions.toArray();
  return actions
    .filter((a) => a.type === 'pos_sale' && a.syncFailed)
    .map((a) => ({
      id: a.id,
      items: a.payload.items || [],
      paymentMethod: a.payload.paymentMethod || 'cash',
      tendered: a.payload.tendered || 0,
      customerId: a.payload.customerId,
      createdAt: a.createdAt,
      synced: a.synced,
      syncFailed: a.syncFailed,
    }));
}

export async function markActionSynced(id: number) {
  await db.queuedActions.update(id, { synced: true, syncFailed: false, errorMessage: undefined });
  triggerQueueUpdate();
}

export async function markActionFailed(id: number, errorMsg?: string) {
  await db.queuedActions.update(id, { syncFailed: true, errorMessage: errorMsg || 'Sync failed' });
  triggerQueueUpdate();
}

export async function clearQueuedAction(id: number) {
  await db.queuedActions.delete(id);
  triggerQueueUpdate();
}

// Category 1 Sync Executor - SINGLE ENGINE (blog section 10).
// Delegates to performSync() in lib/client/sync-engine.ts: pushes all pending
// actions as one idempotent batch (POST /api/sync), then pulls server deltas.
// Kept under this name for back-compat callers (useOfflineSync).
export async function syncQueuedSales() {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  try {
    const { performSync } = await import('@/lib/client/sync-engine');
    await performSync();
  } catch {
    // Network blip - leave for next retry round
  }
}


export default db;
