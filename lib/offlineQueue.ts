import Dexie, { Table } from 'dexie';

export interface QueuedSaleItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

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
  queuedSales!: Table<QueuedSale, number>;

  constructor() {
    super('SariSariOfflineQueue');
    this.version(1).stores({ queuedSales: '++id, createdAt, synced, syncFailed' });
  }
}

const db = new OfflineQueueDB();

export const offlineDb = db;

export async function queueSale(sale: Omit<QueuedSale, 'id' | 'synced' | 'syncFailed'>) {
  return db.queuedSales.add({ ...sale, synced: false, syncFailed: false });
}

export async function getPendingSales(): Promise<QueuedSale[]> {
  const sales = await db.queuedSales.toArray();
  return sales.filter((s) => !s.synced).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPendingCount(): Promise<number> {
  const sales = await db.queuedSales.toArray();
  return sales.filter((s) => !s.synced).length;
}

export async function getSyncFailedSales(): Promise<QueuedSale[]> {
  const sales = await db.queuedSales.toArray();
  return sales.filter((s) => s.syncFailed).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getFailedCount(): Promise<number> {
  const sales = await db.queuedSales.toArray();
  return sales.filter((s) => s.syncFailed).length;
}

export async function markSaleSynced(id: number) {
  await db.queuedSales.update(id, { synced: true, syncFailed: false });
}

export async function markSaleFailed(id: number) {
  await db.queuedSales.update(id, { syncFailed: true });
}

export async function clearFailedSale(id: number) {
  await db.queuedSales.delete(id);
}

export async function syncQueuedSales() {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  const pending = await getPendingSales();
  for (const sale of pending) {
    try {
      const res = await fetch('/api/pos/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: sale.items, paymentMethod: sale.paymentMethod, tendered: sale.tendered, customerId: sale.customerId }),
      });
      if (res.ok) {
        await markSaleSynced(sale.id!);
      } else {
        await markSaleFailed(sale.id!);
      }
    } catch (err) {
      // network blip — leave for next retry
    }
  }
}

export default db;

