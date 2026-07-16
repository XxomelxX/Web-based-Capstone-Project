import {
  getCachedProducts,
  saveProducts,
  getCachedCategories,
  saveCategories,
  getCachedSettings,
  saveSettings,
  getCachedReport,
  saveReport,
  getCachedExpenses,
  saveExpenses,
  getCachedItemLog,
  saveItemLog,
  getCachedTransactions,
  saveTransactions,
  getCachedUtangEntries,
  saveUtangEntries,
  updateCachedProductStock,
  queueOrFetch,
  isOnline,
} from '@/lib/offline';

export { getCachedUsers, saveUsers, queueOrFetch } from '@/lib/offline';

export interface CheckoutResult {
  id: number;
  subtotal: number;
  vat: number;
  total: number;
  tendered: number;
  change: number;
  paymentMethod: 'cash' | 'gcash';
  createdAt: string;
}

export async function cachedGet<T>(
  cacheFn: () => Promise<T>,
  fetchFn: () => Promise<T>,
  saveFn?: (value: T) => Promise<unknown>
): Promise<T> {
  if (isOnline()) {
    try {
      const value = await fetchFn();
      if (saveFn) await saveFn(value);
      return value;
    } catch (error) {
      const cached = await cacheFn();
      if (cached !== null && cached !== undefined) return cached;
      throw error;
    }
  }
  const cached = await cacheFn();
  if (cached !== null && cached !== undefined) return cached;
  throw new Error('Offline and no cached data available');
}

export async function getProductsOffline<T = Record<string, unknown>>(): Promise<T[]> {
  return cachedGet<T[]>(
    () => getCachedProducts<T>(),
    async () => {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('Failed to load products');
      const data = (await res.json()) as T[];
      await saveProducts(data as Record<string, unknown>[]);
      return data;
    },
    saveProducts as (value: T[]) => Promise<void>
  );
}

export async function getArchivedProductsOffline<T = Record<string, unknown>>(): Promise<T[]> {
  return cachedGet<T[]>(
    async () =>
      (await getCachedProducts<T>()).filter(
        (p) => (p as { archived?: boolean }).archived === true
      ),
    async () => {
      const res = await fetch('/api/products?archived=true');
      if (!res.ok) throw new Error('Failed to load archived products');
      const data = (await res.json()) as T[];
      await saveProducts(data as Record<string, unknown>[]);
      return data;
    },
    saveProducts as (value: T[]) => Promise<void>
  );
}

export async function getCategoriesOffline<T = Record<string, unknown>>(): Promise<T[]> {
  return cachedGet<T[]>(
    () => getCachedCategories<T>(),
    async () => {
      const res = await fetch('/api/categories');
      if (!res.ok) throw new Error('Failed to load categories');
      const data = (await res.json()) as T[];
      await saveCategories(data as Record<string, unknown>[]);
      return data;
    },
    saveCategories as (value: T[]) => Promise<void>
  );
}

export async function getSettingsOffline<T = Record<string, unknown>>(): Promise<T> {
  return cachedGet<T>(
    () => getCachedSettings<T>(),
    async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = (await res.json()) as T;
      await saveSettings(data as Record<string, unknown>);
      return data;
    },
    saveSettings as (value: T) => Promise<void>
  );
}

export async function getExpensesOffline<T = Record<string, unknown>>(): Promise<T[]> {
  return cachedGet<T[]>(
    () => getCachedExpenses<T>(),
    async () => {
      const res = await fetch('/api/expenses');
      if (!res.ok) throw new Error('Failed to load expenses');
      const data = (await res.json()) as T[];
      await saveExpenses(data as Record<string, unknown>[]);
      return data;
    },
    saveExpenses as (value: T[]) => Promise<void>
  );
}

export async function getItemLogOffline<T = Record<string, unknown>>(): Promise<T[]> {
  return cachedGet<T[]>(
    () => getCachedItemLog<T>(),
    async () => {
      const res = await fetch('/api/itemlog');
      if (!res.ok) throw new Error('Failed to load item log');
      const data = (await res.json()) as T[];
      await saveItemLog(data as Record<string, unknown>[]);
      return data;
    },
    saveItemLog as (value: T[]) => Promise<void>
  );
}

export async function getTransactionsOffline<T = Record<string, unknown>>(): Promise<T[]> {
  return cachedGet<T[]>(
    () => getCachedTransactions<T>(),
    async () => {
      const res = await fetch('/api/transactions');
      if (!res.ok) throw new Error('Failed to load transactions');
      const data = (await res.json()) as T[];
      await saveTransactions(data as Record<string, unknown>[]);
      return data;
    },
    saveTransactions as (value: T[]) => Promise<void>
  );
}

export async function getUtangEntriesOffline<T = Record<string, unknown>>(): Promise<T[]> {
  return cachedGet<T[]>(
    () => getCachedUtangEntries<T>(),
    async () => {
      const res = await fetch('/api/utang');
      if (!res.ok) throw new Error('Failed to load utang entries');
      const data = (await res.json()) as T[];
      await saveUtangEntries(data as Record<string, unknown>[]);
      return data;
    },
    saveUtangEntries as (value: T[]) => Promise<void>
  );
}

export async function getReportsOffline<T = Record<string, unknown>>(range: 'week' | 'month' | 'all' = 'all'): Promise<T> {
  return cachedGet(
    () => getCachedReport<T>(range),
    async () => {
      const res = await fetch(`/api/reports?range=${range}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to load reports (${res.status}): ${body || res.statusText}`);
      }
      const data = (await res.json()) as T;
      await saveReport(range, data);
      return data;
    },
    (data) => saveReport(range, data)
  );
}

export async function getLowStockOffline() {
  return cachedGet(
    async () => {
      const settings = await getCachedSettings<{ lowStockThreshold?: number }>();
      const products = await getCachedProducts<{ archived: boolean; stock: number }>();
      const threshold = settings?.lowStockThreshold ?? 20;
      return {
        threshold,
        products: products.filter((p) => p.archived === false && p.stock < threshold),
      };
    },
    async () => {
      const res = await fetch('/api/lowstock');
      if (!res.ok) throw new Error('Failed to load low stock');
      const data = await res.json();
      await saveProducts(data.products);
      if (data.threshold !== undefined) {
        await saveSettings({ ...((await getCachedSettings()) ?? {}), lowStockThreshold: data.threshold });
      }
      return data;
    },
    async (data) => {
      await saveProducts(data.products);
    }
  );
}

export async function checkoutOffline(
  items: Array<{ productId: number; quantity: number; unitPrice: number }>,
  paymentMethod: 'cash' | 'gcash',
  tendered: number
) {
  const fallbackReceipt = {
    id: Date.now(),
    subtotal: items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    vat: 0,
    total: items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    tendered,
    change: tendered - items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    paymentMethod,
    createdAt: new Date().toISOString(),
  };

  const result = await queueOrFetch<CheckoutResult>('/api/pos/checkout', 'POST', { items, paymentMethod, tendered }, 'checkout');

  if (result.offlineQueued) {
    await updateCachedProductStock(items);
    return fallbackReceipt;
  }

  return result.data!;
}

export async function queueProductMutation<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  fallbackData: T
): Promise<T> {
  const result = await queueOrFetch<T>(url, method, body, 'product-mutation');
  if (result.offlineQueued) {
    return fallbackData;
  }
  return result.data!;
}

export async function queueInventoryMutation<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  fallbackData: T
): Promise<T> {
  const result = await queueOrFetch<T>(url, method, body, 'inventory-mutation');
  if (result.offlineQueued) {
    return fallbackData;
  }
  return result.data!;
}
