import Dexie, { Table } from 'dexie';
import { triggerQueueUpdate } from '@/lib/client/hooks/useOfflineSync';

export type Category1ActionType =
  | 'pos_sale'
  | 'add_utang'
  | 'record_payment'
  | 'open_shift'
  | 'close_shift'
  | 'cash_movement';

export type Category2ActionType =
  | 'product_upsert'
  | 'product_delete'
  | 'category_upsert'
  | 'category_delete'
  | 'expense_add'
  | 'settings_update'
  | 'customer_add'
  | 'void_sale'
  | 'void_request'
  | 'void_request_cancel'
  | 'void_review'
  | 'utang_update_deadline'
  | 'restock'
  | 'stock_adjust';

export type QueuedActionType = Category1ActionType | Category2ActionType;

export interface QueuedSaleItem {
  productId: number;
  quantity: number;
  unitPrice: number; // centavos
}

export interface QueuedActionPayload {
  clientUuid?: string;
  // POS Sale & Add Utang items
  items?: QueuedSaleItem[];
  dueDate?: string;
  utangEntryId?: number;
  paymentMethod?: 'cash' | 'gcash' | string;
  tendered?: number; // centavos
  // GCash reference number (manual, typed from customer receipt)
  gcashRef?: string;
  customerId?: number | null;
  customerName?: string;
  note?: string;
  amount?: number; // centavos
  expectedBalance?: number; // centavos
  expectedSubtotal?: number; // centavos

  // Shift items
  openingFloat?: number; // centavos
  closingCash?: number; // centavos
  notes?: string;
  openedAt?: string;
  closedAt?: string;
  // Cash movement against the open shift (cash_in | cash_out | expense).
  // amount is always POSITIVE centavos; the type carries the direction.
  movementType?: 'cash_in' | 'cash_out' | 'expense';

  // Category-2 entity mutations (server-wins)
  entityId?: number;
  data?: Record<string, unknown>;
  transactionId?: number;
  productId?: number;
  quantity?: number;
  supplier?: string | null;
  costPerUnit?: number | null;
  reason?: string;
  // Stock adjustment (stock_adjust): direction + ABSOLUTE target stock.
  // expectedStock is the client-cached stock at queue time (conflict check).
  type?: string;
  mode?: 'increase' | 'decrease' | 'recount';
  target?: number; // absolute stock after adjustment
  expectedStock?: number;
  supervisorUsername?: string;
  supervisorVerifiedAt?: string;
  cashierUsername?: string;
  requestedBy?: number;
  voidRequestId?: number;
  approved?: boolean;
  reviewNote?: string;
  // Optimistic temp-row bookkeeping: negative Dexie id + table to delete
  // once the server row arrives via pull.
  tempId?: number;
  table?: 'products' | 'categories' | 'expenses' | 'customers';
}

export interface QueuedCategory1Action {
  id?: number;
  type: QueuedActionType;
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

// Server accepts max 100 actions per push — refuse to grow past that so the
// queue can always be flushed in a single sync (caller should prompt to sync).
export const MAX_QUEUED_ACTIONS = 100;

export async function queueCategory1Action(
  type: QueuedActionType,
  payload: QueuedActionPayload
): Promise<number> {
  // Same boolean-index pitfall as getPendingCount(): count in JS so the cap
  // actually triggers instead of letting the queue grow past what one
  // /api/sync push can carry (server rejects batches over 100).
  const pending = await getPendingCount();
  if (pending >= MAX_QUEUED_ACTIONS) {
    throw new Error('Offline queue is full (100 actions). Reconnect and sync before queuing more.');
  }
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
  gcashRef?: string;
}): Promise<number> {
  const res = await db.queuedActions.add({
    type: 'pos_sale',
    payload: stampUuid({
      items: sale.items,
      paymentMethod: sale.paymentMethod,
      tendered: sale.tendered,
      customerId: sale.customerId ?? null,
      expectedSubtotal: sale.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
      clientUuid: sale.clientUuid,
      ...(sale.gcashRef ? { gcashRef: sale.gcashRef.slice(0, 50) } : {}),
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
  dueDate?: string;
}): Promise<number> {
  return queueCategory1Action('add_utang', {
    customerName: utang.customerName,
    items: utang.items,
    note: utang.note,
    expectedSubtotal: utang.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
    clientUuid: utang.clientUuid,
    dueDate: utang.dueDate,
  });
}

export async function queueUtangDeadlineUpdate(utangEntryId: number, dueDate: string | null) {
  return queueCategory1Action('utang_update_deadline', {
    utangEntryId,
    ...(dueDate ? { dueDate } : {}),
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
  closingCash?: number;
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

export async function queueCashMovement(movement: {
  type: 'cash_in' | 'cash_out' | 'expense';
  amount: number; // centavos, positive
  note?: string;
  clientUuid?: string;
}): Promise<number> {
  return queueCategory1Action('cash_movement', {
    movementType: movement.type,
    amount: movement.amount,
    note: movement.note,
    clientUuid: movement.clientUuid,
  });
}

// Category 2 queue helpers — offline entity mutations (server-wins on sync).
// Every action is stamped with a permanent clientUuid for idempotent replay.
export async function queueProductUpsert(data: Record<string, unknown>, entityId?: number, tempId?: number) {
  return queueCategory1Action('product_upsert', { entityId, data, tempId, table: tempId ? 'products' : undefined });
}
export async function queueProductDelete(entityId: number) {
  return queueCategory1Action('product_delete', { entityId });
}
export async function queueCategoryUpsert(data: Record<string, unknown>, entityId?: number, tempId?: number) {
  return queueCategory1Action('category_upsert', { entityId, data, tempId, table: tempId ? 'categories' : undefined });
}
export async function queueCategoryDelete(entityId: number) {
  return queueCategory1Action('category_delete', { entityId });
}
export async function queueExpenseAdd(data: Record<string, unknown>, tempId?: number) {
  return queueCategory1Action('expense_add', { data, tempId, table: tempId ? 'expenses' : undefined });
}
export async function queueSettingsUpdate(data: Record<string, unknown>) {
  return queueCategory1Action('settings_update', { data });
}
export async function queueCustomerAdd(data: Record<string, unknown>, tempId?: number) {
  return queueCategory1Action('customer_add', { data, tempId, table: tempId ? 'customers' : undefined });
}
export async function queueVoidSale(
  transactionId: number,
  reason: string,
  approval?: { supervisorUsername?: string; supervisorVerifiedAt?: string; cashierUsername?: string }
) {
  return queueCategory1Action('void_sale', { transactionId, reason, ...approval });
}
// Cashier void-request flow: request (any role) → admin review (admin sync only).
// Requests live in this preserved queue DB so they survive the user-switch wipe.
export async function queueVoidRequest(transactionId: number, reason: string, requestedBy: number, clientUuid?: string) {
  return queueCategory1Action('void_request', { transactionId, reason, requestedBy, clientUuid });
}
export async function queueVoidRequestCancel(voidRequestId: number, requestedBy: number) {
  return queueCategory1Action('void_request_cancel', { voidRequestId, requestedBy });
}
export async function queueVoidReview(voidRequestId: number, approved: boolean, reviewNote?: string) {
  return queueCategory1Action('void_review', { voidRequestId, approved, reviewNote });
}
export async function queueRestock(productId: number, quantity: number, supplier?: string | null, costPerUnit?: number | null) {
  return queueCategory1Action('restock', { productId, quantity, supplier: supplier ?? null, costPerUnit: costPerUnit ?? null });
}
// Absolute target stock (not a delta) keeps replays idempotent: if the server
// already sits at `target`, the sync handler absorbs the action as a no-op.
export async function queueStockAdjust(input: {
  productId: number;
  mode: 'increase' | 'decrease' | 'recount';
  target: number;
  expectedStock: number;
  type: string;
  reason?: string;
  clientUuid?: string;
}) {
  return queueCategory1Action('stock_adjust', { ...input });
}

// Queries
export async function getPendingActions(): Promise<QueuedCategory1Action[]> {
  const actions = await db.queuedActions.toArray();
  return actions
    .filter((a) => !a.synced && !a.syncFailed)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Retry a single failed action: clear its failure flag so the next sync push
// picks it up again. Returns true when the row exists and was reset.
export async function retryQueuedAction(id: number): Promise<boolean> {
  const row = await db.queuedActions.get(id);
  if (!row || row.synced) return false;
  await db.queuedActions.update(id, { syncFailed: false, errorMessage: undefined });
  triggerQueueUpdate();
  return true;
}

// Discard a single failed action: permanently removes it from the queue.
// Money actions (sales/payments) should prefer Retry — Discard drops the record.
export async function discardQueuedAction(id: number): Promise<boolean> {
  const row = await db.queuedActions.get(id);
  if (!row || row.synced) return false;
  await db.queuedActions.delete(id);
  triggerQueueUpdate();
  return true;
}

export async function getAllQueuedCategory1Actions(): Promise<QueuedCategory1Action[]> {
  const actions = await db.queuedActions.toArray();
  return actions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function retryAdminBlockedActions(): Promise<number> {
  const failedActions = await db.queuedActions
    .filter((action) =>
      !action.synced
      && action.syncFailed === true
      && action.errorMessage?.startsWith('Admin only') === true
    )
    .toArray();

  for (const action of failedActions) {
    if (action.id !== undefined) {
      await db.queuedActions.update(action.id, { syncFailed: false, errorMessage: undefined });
    }
  }

  if (failedActions.length > 0) triggerQueueUpdate();
  return failedActions.length;
}

// NOTE: `synced` / `syncFailed` are BOOLEANS and IndexedDB cannot index
// booleans — where('synced').equals(0) never matches a row, so these counters
// (and the queue-full guard below) silently reported 0 while sales piled up.
// Filter in JS against the small, ≤MAX_QUEUED_ACTIONS table instead.
export async function getPendingCount(): Promise<number> {
  const actions = await db.queuedActions.toArray();
  return actions.filter((a) => !a.synced && !a.syncFailed).length;
}

export async function getFailedCount(): Promise<number> {
  const actions = await db.queuedActions.toArray();
  return actions.filter((a) => a.syncFailed && !a.synced).length;
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
