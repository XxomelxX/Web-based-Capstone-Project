import { cachedGet, getLowStockOffline, getTransactionsOffline, getUtangEntriesOffline, getExpensesOffline, getItemLogOffline, getReportsOffline, getSettingsOffline, queueOrFetch, getCachedUsers, saveUsers } from '@/lib/api/offline';

interface Expense {
  id: number;
  type: string;
  amount: number;
  period: string;
  note?: string;
  createdAt: string;
}

interface InventoryUser {
  id: number;
  fullName: string;
  username: string;
  email: string;
  role: 'admin' | 'cashier';
  status?: string;
  deleted?: boolean;
}

// Low Stock
export async function getLowStock() {
  return getLowStockOffline();
}

export async function restockProduct(data: {
  productId: number;
  quantity: number;
  supplier?: string;
  costPerUnit?: number;
}) {
  const result = await queueOrFetch('/api/restock', 'POST', data, 'restock-product');
  return result.data;
}

// Orders / Transactions
export async function getTransactions<T = Record<string, unknown>>(): Promise<T[]> {
  return getTransactionsOffline<T>();
}

export async function voidTransaction(id: number, reason: string) {
  const result = await queueOrFetch(`/api/transactions/${id}/void`, 'POST', { reason }, 'void-transaction');
  if (result.offlineQueued) {
    return result.data;
  }
  return result.data;
}

// Utang / Credit
export async function getUtangEntries<T = Record<string, unknown>>(): Promise<T[]> {
  return getUtangEntriesOffline<T>();
}

export async function addUtang(data: {
  customerName: string;
  items: Array<{ productId: number; quantity: number; unitPrice: number }>;
  note?: string;
}) {
  const result = await queueOrFetch('/api/utang', 'POST', data, 'add-utang');
  if (result.offlineQueued) {
    return result.data;
  }
  return result.data;
}

export async function recordUtangPayment(data: { customerName: string; amount: number; note?: string }) {
  const result = await queueOrFetch('/api/utang/payment', 'POST', data, 'utang-payment');
  if (result.offlineQueued) {
    return result.data;
  }
  return result.data;
}

// Users (Admin only)
export async function getUsers<T = InventoryUser>(): Promise<T[]> {
  return cachedGet<T[]>(
    () => getCachedUsers<T>(),
    async () => {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed to load users');
      const data = (await res.json()) as T[];
      await saveUsers(data as Record<string, unknown>[]);
      return data;
    },
    saveUsers as (value: T[]) => Promise<void>
  );
}

export async function addUser(data: {
  fullName: string;
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'cashier';
}): Promise<InventoryUser> {
  const result = await queueOrFetch<InventoryUser>('/api/users', 'POST', data, 'add-user');
  if (result.offlineQueued) {
    return { id: Date.now(), ...data, status: 'pending' };
  }
  return result.data!;
}

export async function updateUser(id: number, data: { fullName?: string; role?: 'admin' | 'cashier'; status?: string; }): Promise<InventoryUser> {
  const result = await queueOrFetch<InventoryUser>(`/api/users/${id}`, 'PATCH', data, 'update-user');
  return result.data!;
}

export async function deleteUser(id: number): Promise<void> {
  await queueOrFetch<{ id: number; deleted: boolean }>(`/api/users/${id}`, 'DELETE', null, 'delete-user');
}

export async function deactivateUser(id: number): Promise<void> {
  await queueOrFetch<{ id: number; status: 'inactive' }>(`/api/users/${id}`, 'PATCH', { status: 'inactive' }, 'deactivate-user');
}

// Settings
export async function getSettings<T = Record<string, unknown>>(): Promise<T> {
  return getSettingsOffline<T>();
}

export async function updateSettings(data: object) {
  const result = await queueOrFetch('/api/settings', 'PATCH', data, 'update-settings');
  return result.data;
}

// Expenses
export async function getExpenses(): Promise<Expense[]> {
  return getExpensesOffline<Expense>();
}

export async function addExpense(data: { type: string; amount: number; period: string; note?: string }) {
  const result = await queueOrFetch('/api/expenses', 'POST', data, 'add-expense');
  return result.data;
}

// Item Log
export async function getItemLog<T = Record<string, unknown>>(): Promise<T[]> {
  return getItemLogOffline<T>();
}

// Reports
export async function getReports<T = Record<string, unknown>>(range: 'week' | 'month' | 'all' = 'all'): Promise<T> {
  return getReportsOffline<T>(range);
}
