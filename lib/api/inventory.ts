import {
  getLowStockOffline,
  getTransactionsOffline,
  getUtangEntriesOffline,
  getExpensesOffline,
  getItemLogOffline,
  getReportsOffline,
  getSettingsOffline,
  getCachedUsers,
  saveUsers,
  cachedGet,
} from '@/lib/api/offline';
import { queueAddUtang, queueUtangPayment } from '@/lib/offlineQueue';
import { updateCachedProductStock } from '@/lib/offline';

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

function checkOnlineOrThrow() {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    throw new Error('This action requires an internet connection');
  }
}

// Low Stock (Category 2)
export async function getLowStock() {
  return getLowStockOffline();
}

// Restock (Category 3 - Blocked offline)
export async function restockProduct(data: {
  productId: number;
  quantity: number;
  supplier?: string;
  costPerUnit?: number;
}) {
  checkOnlineOrThrow();
  const res = await fetch('/api/restock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to restock product');
  }
  return res.json();
}

// Orders / Transactions (Category 2 Read-Only, Category 3 Void)
export async function getTransactions<T = Record<string, unknown>>(): Promise<T[]> {
  return getTransactionsOffline<T>();
}

export async function getCustomers<T = Record<string, unknown>>(): Promise<T[]> {
  const res = await fetch('/api/customers');
  if (!res.ok) throw new Error('Failed to load customers');
  return res.json() as Promise<T[]>;
}

export async function addCustomer(data: {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  checkOnlineOrThrow();
  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to add customer');
  }
  return res.json();
}

export async function updateCustomer(id: number, data: {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  checkOnlineOrThrow();
  const res = await fetch(`/api/customers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to update customer');
  }
  return res.json();
}

// Void Order (Category 3 - Blocked offline)
export async function voidTransaction(id: number, reason: string, adminUsername?: string, adminPassword?: string) {
  checkOnlineOrThrow();
  const res = await fetch(`/api/transactions/${id}/void`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, adminUsername, adminPassword }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to void transaction');
  }
  return res.json();
}

// Utang / Credit (Category 1 Full Offline Queue for Add & Pay)
export async function getUtangEntries<T = Record<string, unknown>>(): Promise<T[]> {
  return getUtangEntriesOffline<T>();
}

export async function addUtang(data: {
  customerName: string;
  items: Array<{ productId: number; quantity: number; unitPrice: number }>;
  note?: string;
}) {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    await queueAddUtang(data);
    await updateCachedProductStock(data.items);
    const totalAmount = data.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    return {
      id: Date.now(),
      customer: { name: data.customerName },
      totalAmount,
      amountPaid: 0,
      remainingBalance: totalAmount,
      note: data.note ?? null,
      status: 'unpaid',
      createdAt: new Date().toISOString(),
      offline: true,
    };
  }

  const res = await fetch('/api/utang', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to add utang');
  }
  return res.json();
}

export async function recordUtangPayment(data: { customerName: string; amount: number; note?: string; expectedBalance?: number }) {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    await queueUtangPayment(data);
    return {
      id: Date.now(),
      amount: data.amount,
      note: data.note ?? null,
      createdAt: new Date().toISOString(),
      offline: true,
    };
  }

  const res = await fetch('/api/utang/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerName: data.customerName, amount: data.amount, note: data.note }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to record payment');
  }
  return res.json();
}

// Users (Category 3 - Blocked offline)
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
  checkOnlineOrThrow();
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to add user');
  }
  return res.json();
}

export async function updateUser(id: number, data: {
  fullName?: string;
  email?: string;
  role?: 'admin' | 'cashier';
  status?: string;
  newPassword?: string;
}): Promise<InventoryUser> {
  checkOnlineOrThrow();
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to update user');
  }
  return res.json();
}

export async function deleteUser(id: number): Promise<void> {
  checkOnlineOrThrow();
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete user');
  }
}

export async function deactivateUser(id: number): Promise<void> {
  return updateUser(id, { status: 'inactive' }).then(() => undefined);
}

// Settings (Category 3 - Blocked offline)
export async function getSettings<T = Record<string, unknown>>(): Promise<T> {
  return getSettingsOffline<T>();
}

export async function updateSettings(data: object) {
  checkOnlineOrThrow();
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to update settings');
  }
  return res.json();
}

// Expenses (Category 3 - Blocked offline)
export async function getExpenses(): Promise<Expense[]> {
  return getExpensesOffline<Expense>();
}

export async function addExpense(data: { type: string; amount: number; period: string; note?: string }) {
  checkOnlineOrThrow();
  const res = await fetch('/api/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to add expense');
  }
  return res.json();
}

// Item Log
export async function getItemLog<T = Record<string, unknown>>(): Promise<T[]> {
  return getItemLogOffline<T>();
}

// Reports
export async function getReports<T = Record<string, unknown>>(range: 'week' | 'month' | 'all' = 'all'): Promise<T> {
  return getReportsOffline<T>(range);
}
