import Dexie, { Table } from 'dexie';

export interface QueuedSaleItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

export interface QueuedSale {
  id?: number;
  items: QueuedSaleItem[];
  paymentMethod: 'cash' | 'gcash';
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
    this.version(1).stores({ queuedSales: '++id, synced, syncFailed, createdAt' });
  }
}

export const offlineQueueDb = new OfflineQueueDB();

export async function queueSale(sale: Omit<QueuedSale, 'id' | 'synced' | 'syncFailed'>) {
  return offlineQueueDb.queuedSales.add({ ...sale, synced: false, syncFailed: false });
}

export async function getPendingSales(): Promise<QueuedSale[]> {
  const sales = await offlineQueueDb.queuedSales.toArray();
  return sales
    .filter((sale) => !sale.synced)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPendingSalesCount(): Promise<number> {
  const sales = await offlineQueueDb.queuedSales.toArray();
  return sales.filter((sale) => !sale.synced).length;
}

export async function getSyncFailedCount(): Promise<number> {
  const sales = await offlineQueueDb.queuedSales.toArray();
  return sales.filter((sale) => sale.syncFailed).length;
}

export async function getSyncFailedSales(): Promise<QueuedSale[]> {
  const sales = await offlineQueueDb.queuedSales.toArray();
  return sales
    .filter((sale) => sale.syncFailed)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function markSaleSynced(id: number) {
  await offlineQueueDb.queuedSales.update(id, { synced: true, syncFailed: false });
}

export async function markSaleFailed(id: number) {
  await offlineQueueDb.queuedSales.update(id, { syncFailed: true });
}

export async function clearFailedSale(id: number) {
  await offlineQueueDb.queuedSales.delete(id);
}

export async function syncQueuedSales() {
  if (typeof window === 'undefined' || !navigator.onLine) return;

  const pendingSales = await getPendingSales();
  for (const sale of pendingSales) {
    try {
      const response = await fetch('/api/pos/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: sale.items,
          paymentMethod: sale.paymentMethod,
          tendered: sale.tendered,
          customerId: sale.customerId,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.warn('Offline sale sync failed:', response.status, text);
        await markSaleFailed(sale.id!);
        continue;
      }

      await markSaleSynced(sale.id!);
    } catch (error) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break;
      }
      console.warn('Offline sale sync error:', error);
    }
  }
}
