import Dexie from 'dexie';

export interface OfflineQueuedRequest {
  id?: number;
  url: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body: unknown;
  action: string;
  createdAt: number;
  status: 'pending' | 'synced' | 'failed';
}

export interface OfflineCacheEntry {
  key: string;
  value: unknown;
}

class SariSariPOSOfflineDB extends Dexie {
  products!: Dexie.Table<Record<string, unknown>, number>;
  categories!: Dexie.Table<Record<string, unknown>, number>;
  expenses!: Dexie.Table<Record<string, unknown>, number>;
  transactions!: Dexie.Table<Record<string, unknown>, number>;
  utang!: Dexie.Table<Record<string, unknown>, number>;
  itemlog!: Dexie.Table<Record<string, unknown>, number>;
  users!: Dexie.Table<Record<string, unknown>, number>;
  settings!: Dexie.Table<OfflineCacheEntry, string>;
  reportCache!: Dexie.Table<OfflineCacheEntry, string>;
  queue!: Dexie.Table<OfflineQueuedRequest, number>;

  constructor() {
    super('SariSariPOSOffline');
    this.version(1).stores({
      products: 'id',
      categories: 'id',
      expenses: 'id',
      transactions: 'id',
      utang: 'id',
      itemlog: 'id',
      users: 'id',
      settings: 'key',
      reportCache: 'key',
      queue: '++id, status, action, createdAt',
    });
  }
}

export const db = new SariSariPOSOfflineDB();

export const canUseWindow = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';
export const isOnline = () => (canUseWindow() ? navigator.onLine : true);

export async function registerServiceWorker() {
  if (!canUseWindow() || !('serviceWorker' in navigator)) return;
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return;
  }

  try {
    await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered');
  } catch (error) {
    console.warn('Service Worker register failed:', error);
  }
}

export async function queueRequest(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  action: string
) {
  return db.queue.add({
    url,
    method,
    body,
    action,
    createdAt: Date.now(),
    status: 'pending',
  });
}

export async function syncOfflineQueue() {
  if (!canUseWindow() || !navigator.onLine) return;

  const pending = await db.queue.where('status').equals('pending').toArray();
  for (const request of pending) {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body: request.body ? JSON.stringify(request.body) : undefined,
      });

      if (response.ok) {
        await db.queue.update(request.id!, { status: 'synced' });
      } else {
        await db.queue.update(request.id!, { status: 'failed' });
      }
    } catch {
      await db.queue.update(request.id!, { status: 'failed' });
    }
  }
}

export function installOfflineSync() {
  if (!canUseWindow()) return;
  window.addEventListener('online', syncOfflineQueue);
}

export async function saveProducts(products: Record<string, unknown>[]) {
  if (!products?.length) return;
  return db.products.bulkPut(products);
}

export async function getCachedProducts<T = Record<string, unknown>>() {
  return db.products.toArray() as Promise<T[]>;
}

export async function saveCategories(categories: Record<string, unknown>[]) {
  if (!categories?.length) return;
  return db.categories.bulkPut(categories);
}

export async function getCachedCategories<T = Record<string, unknown>>() {
  return db.categories.toArray() as Promise<T[]>;
}

export async function saveSettings(settings: Record<string, unknown>): Promise<void> {
  await db.settings.put({ key: 'settings', value: settings });
}

export async function getCachedSettings<T = Record<string, unknown>>() {
  const entry = await db.settings.get('settings');
  return (entry?.value as T) ?? (null as T);
}

export async function saveReport<T = unknown>(range: string, value: T) {
  return db.reportCache.put({ key: range, value });
}

export async function getCachedReport<T = unknown>(range: string): Promise<T> {
  const entry = await db.reportCache.get(range);
  return (entry?.value as T) ?? (null as T);
}

export async function saveExpenses(expenses: Record<string, unknown>[]) {
  if (!expenses?.length) return;
  return db.expenses.bulkPut(expenses);
}

export async function getCachedExpenses<T = Record<string, unknown>>() {
  return db.expenses.toArray() as Promise<T[]>;
}

export async function saveItemLog(itemLog: Record<string, unknown>[]) {
  if (!itemLog?.length) return;
  return db.itemlog.bulkPut(itemLog);
}

export async function getCachedItemLog<T = Record<string, unknown>>() {
  return db.itemlog.toArray() as Promise<T[]>;
}

export async function saveTransactions(transactions: Record<string, unknown>[]) {
  if (!transactions?.length) return;
  return db.transactions.bulkPut(transactions);
}

export async function getCachedTransactions<T = Record<string, unknown>>() {
  return db.transactions.toArray() as Promise<T[]>;
}

export async function saveUtangEntries(entries: Record<string, unknown>[]) {
  if (!entries?.length) return;
  return db.utang.bulkPut(entries);
}

export async function getCachedUtangEntries<T = Record<string, unknown>>() {
  return db.utang.toArray() as Promise<T[]>;
}

export async function saveUsers(users: Record<string, unknown>[]) {
  if (!users?.length) return;
  return db.users.bulkPut(users);
}

export async function getCachedUsers<T = Record<string, unknown>>() {
  return db.users.toArray() as Promise<T[]>;
}

export async function updateCachedProductStock(items: Array<{ productId: number; quantity: number }>) {
  for (const item of items) {
    const product = await db.products.get(item.productId);
    if (product) {
      const currentStock = typeof product.stock === 'number' ? product.stock : 0;
      await db.products.put({
        ...product,
        stock: Math.max(0, currentStock - item.quantity),
      });
    }
  }
}

export async function queueOrFetch<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  action: string
): Promise<{ offlineQueued?: boolean; data?: T }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(
        `Request failed with status ${res.status}: ${errorBody || res.statusText}`
      );
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    return { data: data as T };
  } catch (error: unknown) {
    if (canUseWindow() && !navigator.onLine) {
      await queueRequest(url, method, body, action);
      return { offlineQueued: true };
    }

    const isNetworkError =
      error instanceof TypeError ||
      (error instanceof Error && /failed to fetch|network|offline/i.test(error.message));

    if (canUseWindow() && isNetworkError) {
      await queueRequest(url, method, body, action);
      return { offlineQueued: true };
    }

    throw error;
  }
}

export async function queueAndCache<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  action: string,
  fallbackData?: T,
  cacheFn?: (value: T) => Promise<void>
): Promise<{ offlineQueued?: boolean; data?: T }> {
  const result = await queueOrFetch<T>(url, method, body, action);
  if (result.offlineQueued) {
    if (fallbackData !== undefined && cacheFn) {
      try {
        await cacheFn(fallbackData);
      } catch (cacheError) {
        console.warn('Failed to cache fallback data:', cacheError);
      }
    }
    return { offlineQueued: true, data: fallbackData };
  }
  return result;
}
