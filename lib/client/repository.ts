// Write-through repository (blog §8 adapted for Int PKs + idempotency keys).
// UI writes here → Dexie first → sync engine pushes later.
import { offlineDb, queueCategory1Action, type QueuedActionPayload } from '@/lib/client/offlineQueue';
import { updateCachedProductStock, db as cacheDb } from '@/lib/client/offline';

function uuid(): string {
  return crypto.randomUUID();
}

async function writeThrough(
  type: 'pos_sale' | 'add_utang' | 'record_payment' | 'open_shift' | 'close_shift',
  payload: QueuedActionPayload,
  optimistic?: () => Promise<void>
) {
  const clientUuid = uuid();
  const id = await queueCategory1Action(type, { ...payload, clientUuid } as QueuedActionPayload);
  // Mirror into unified cache DB for pending-count queries
  try {
    await cacheDb.table('queuedActions').put({
      id, type, payload: { ...payload, clientUuid }, createdAt: new Date().toISOString(),
      synced: 0, syncFailed: 0, clientUuid,
    });
  } catch { /* mirror best-effort */ }
  if (optimistic) {
    try { await optimistic(); } catch { /* optimistic cache best-effort */ }
  }
  return { id, clientUuid };
}

export async function repoCheckoutSale(items: { productId: number; quantity: number; unitPrice: number }[], paymentMethod: string, tendered: number, customerId?: number | null) {
  return writeThrough('pos_sale', { items, paymentMethod, tendered, customerId: customerId ?? null }, () =>
    updateCachedProductStock(items)
  );
}

export async function repoAddUtang(customerName: string, items: { productId: number; quantity: number; unitPrice: number }[], note?: string) {
  return writeThrough('add_utang', { customerName, items, note }, () =>
    updateCachedProductStock(items)
  );
}

export async function repoRecordPayment(customerName: string, amount: number, note?: string, expectedBalance?: number) {
  return writeThrough('record_payment', { customerName, amount, note, expectedBalance });
}

export async function repoOpenShift(openingFloat: number, notes?: string) {
  return writeThrough('open_shift', { openingFloat, notes, openedAt: new Date().toISOString() });
}

export async function repoCloseShift(closingCash: number, notes?: string) {
  return writeThrough('close_shift', { closingCash, notes, closedAt: new Date().toISOString() });
}

export { offlineDb };
