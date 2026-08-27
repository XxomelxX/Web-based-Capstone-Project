import Dexie, { Table } from 'dexie';
import { triggerQueueUpdate } from '@/lib/useOfflineSync';

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
export async function queueCategory1Action(
  type: Category1ActionType,
  payload: QueuedActionPayload
): Promise<number> {
  const res = await db.queuedActions.add({
    type,
    payload,
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
}): Promise<number> {
  const res = await db.queuedActions.add({
    type: 'pos_sale',
    payload: {
      items: sale.items,
      paymentMethod: sale.paymentMethod,
      tendered: sale.tendered,
      customerId: sale.customerId ?? null,
    },
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
}): Promise<number> {
  return queueCategory1Action('add_utang', {
    customerName: utang.customerName,
    items: utang.items,
    note: utang.note,
  });
}

export async function queueUtangPayment(payment: {
  customerName: string;
  amount: number;
  note?: string;
  expectedBalance?: number;
}): Promise<number> {
  return queueCategory1Action('record_payment', {
    customerName: payment.customerName,
    amount: payment.amount,
    note: payment.note,
    expectedBalance: payment.expectedBalance,
  });
}

export async function queueOpenShift(shift: {
  openingFloat: number;
  notes?: string;
  openedAt?: string;
}): Promise<number> {
  return queueCategory1Action('open_shift', {
    openingFloat: shift.openingFloat,
    notes: shift.notes,
    openedAt: shift.openedAt || new Date().toISOString(),
  });
}

export async function queueCloseShift(shift: {
  closingCash: number;
  notes?: string;
  closedAt?: string;
}): Promise<number> {
  return queueCategory1Action('close_shift', {
    closingCash: shift.closingCash,
    notes: shift.notes,
    closedAt: shift.closedAt || new Date().toISOString(),
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
  const actions = await db.queuedActions.toArray();
  return actions.filter((a) => !a.synced && !a.syncFailed).length;
}

export async function getFailedCount(): Promise<number> {
  const actions = await db.queuedActions.toArray();
  return actions.filter((a) => a.syncFailed).length;
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

// Category 1 Sync Executor
export async function syncQueuedSales() {
  if (typeof window === 'undefined' || !navigator.onLine) return;

  const pending = await db.queuedActions.toArray();
  const toSync = pending.filter((a) => !a.synced).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const action of toSync) {
    if (!action.id) continue;
    try {
      if (action.type === 'pos_sale') {
        const res = await fetch('/api/pos/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: action.payload.items,
            paymentMethod: action.payload.paymentMethod,
            tendered: action.payload.tendered,
            customerId: action.payload.customerId,
          }),
        });
        if (res.ok) {
          await markActionSynced(action.id);
        } else {
          const errData = await res.json().catch(() => ({}));
          await markActionFailed(action.id, errData.error || `HTTP ${res.status}`);
        }
      } else if (action.type === 'add_utang') {
        const res = await fetch('/api/utang', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName: action.payload.customerName,
            items: action.payload.items,
            note: action.payload.note,
          }),
        });
        if (res.ok) {
          await markActionSynced(action.id);
        } else {
          const errData = await res.json().catch(() => ({}));
          await markActionFailed(action.id, errData.error || `HTTP ${res.status}`);
        }
      } else if (action.type === 'record_payment') {
        const res = await fetch('/api/utang/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName: action.payload.customerName,
            amount: action.payload.amount,
            note: action.payload.note,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (
            action.payload.expectedBalance !== undefined &&
            data.result?.unallocatedRemainder &&
            data.result.unallocatedRemainder > 0
          ) {
            await markActionFailed(action.id, 'Balance changed unexpectedly while offline. Flagged for Admin review.');
          } else {
            await markActionSynced(action.id);
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          await markActionFailed(action.id, errData.error || `HTTP ${res.status}`);
        }
      } else if (action.type === 'open_shift') {
        const res = await fetch('/api/shift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'open',
            openingFloat: action.payload.openingFloat,
            notes: action.payload.notes,
          }),
        });
        if (res.ok) {
          await markActionSynced(action.id);
        } else {
          const errData = await res.json().catch(() => ({}));
          await markActionFailed(action.id, errData.error || `HTTP ${res.status}`);
        }
      } else if (action.type === 'close_shift') {
        const res = await fetch('/api/shift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'close',
            closingCash: action.payload.closingCash,
            notes: action.payload.notes,
          }),
        });
        if (res.ok) {
          await markActionSynced(action.id);
        } else {
          const errData = await res.json().catch(() => ({}));
          await markActionFailed(action.id, errData.error || `HTTP ${res.status}`);
        }
      }
    } catch (err) {
      // Network blip — leave for next retry round
    }
  }
}

export default db;
