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
} from '@/lib/client/api/offline';
import { saveUtangEntries, saveCachedCustomers, getCachedCustomers, saveExpenses, getCachedExpenses, saveSettings, getCachedSettings, updateCachedProductStock, db } from '@/lib/client/offline';
import { queueAddUtang, queueUtangPayment, queueExpenseAdd, queueSettingsUpdate, queueCustomerAdd, queueVoidSale, queueRestock } from '@/lib/client/offlineQueue';
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

function isOffline() {
  return typeof window !== 'undefined' && !navigator.onLine;
}

// Low Stock (Category 2)
export async function getLowStock() {
  return getLowStockOffline();
}

// Restock (Category 2 — queued offline, admin only enforced at sync)
export async function restockProduct(data: {
  productId: number;
  quantity: number;
  supplier?: string;
  costPerUnit?: number;
}) {
  if (isOffline()) {
    const product = await db.products.get(data.productId);
    if (product) {
      const stock = typeof product.stock === 'number' ? product.stock : 0;
      await db.products.put({ ...product, stock: stock + data.quantity });
    }
    await queueRestock(data.productId, data.quantity, data.supplier ?? null, data.costPerUnit ?? null);
    return { offline: true, productId: data.productId, quantity: data.quantity };
  }
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

export async function getCustomersLight(): Promise<Array<{ id: number; name: string }>> {
  return cachedGet<Array<{ id: number; name: string }>>(
    () => getCachedCustomers<{ id: number; name: string }>(),
    async () => {
      const res = await fetch('/api/customers?light=true');
      if (!res.ok) throw new Error('Failed to load customers');
      const data = await res.json() as Array<{ id: number; name: string }>;
      await saveCachedCustomers(data as Record<string, unknown>[]);
      return data;
    },
    saveCachedCustomers as (value: Array<{ id: number; name: string }>) => Promise<void>
  );
}

export async function addCustomer(data: {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const offlineCustomer = {
      id: -Date.now(),
      name: data.name,
      phone: data.phone,
      email: data.email,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      offline: true,
    };
    const cached = await getCachedCustomers<Record<string, unknown>>();
    await saveCachedCustomers([...cached, offlineCustomer]);
    await queueCustomerAdd(data as unknown as Record<string, unknown>, offlineCustomer.id);
    return offlineCustomer;
  }
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
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const cached = await getCachedCustomers<Record<string, unknown>>();
    const existing = cached.findIndex((c) => (c as { id: number }).id === id);
    if (existing >= 0) {
      await db.customers.put({ ...cached[existing], ...data } as unknown as Record<string, unknown>);
    } else {
      const offlineCustomer = {
        id,
        name: data.name ?? '',
        phone: data.phone,
        email: data.email,
        notes: data.notes,
        createdAt: new Date().toISOString(),
        offline: true,
      };
      const cached = await getCachedCustomers<Record<string, unknown>>();
      await saveCachedCustomers([...cached, offlineCustomer] as unknown as Record<string, unknown>[]);
    }
    await queueCustomerAdd(data as unknown as Record<string, unknown>, id);
    return { offline: true, id };
  }
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

export async function deleteCustomer(id: number, adminUsername: string, adminPassword: string, force?: boolean) {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    await queueVoidSale(id, 'Deleted offline');
    return { offline: true, id, status: 'voided' };
  }
  const res = await fetch(`/api/customers/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminUsername, adminPassword, force }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete customer');
  }
  return res.json();
}

// Void Order — online: supervisor check server-side. Offline: supervisor is
// verified against the locally cached credential hash, then the void is queued
// and synced when connectivity returns.
export async function voidTransaction(id: number, reason: string, adminUsername?: string, adminPassword?: string) {
  if (isOffline()) {
    let role: string | null = null;
    let cashierUsername: string | undefined;
    try {
      const raw = sessionStorage.getItem('offlineSession');
      const sess = raw ? (JSON.parse(raw) as { role?: string; username?: string }) : null;
      role = sess?.role ?? null;
      cashierUsername = sess?.username;
    } catch { role = null; }

    // Admin offline session: self-approved.
    if (role === 'admin') {
      await db.transactions.update(id, { status: 'voided', voidReason: reason, pendingSync: true } as unknown as Record<string, unknown>);
      await queueVoidSale(id, reason, { supervisorUsername: cashierUsername, supervisorVerifiedAt: new Date().toISOString(), cashierUsername });
      return { offline: true, id, status: 'voided' };
    }

    // Cashier offline: require supervisor credentials, verified locally.
    if (!adminUsername || !adminPassword) {
      throw new Error('Supervisor approval required — enter an admin username and password to void offline.');
    }
    const cleanSupervisor = adminUsername.trim().toLowerCase();
    const cached = await db.cachedCredentials.get(cleanSupervisor);
    if (!cached || (cached.role !== 'admin' && cached.role !== 'supervisor')) {
      throw new Error('Supervisor not recognized on this device. The supervisor must log in online on this device at least once.');
    }
    const { compare } = await import('bcryptjs');
    const ok = await compare(adminPassword, cached.passwordHash);
    if (!ok) {
      throw new Error('Invalid supervisor password.');
    }
    await db.transactions.update(id, { status: 'voided', voidReason: reason, pendingSync: true } as unknown as Record<string, unknown>);
    await queueVoidSale(id, reason, {
      supervisorUsername: cached.username,
      supervisorVerifiedAt: new Date().toISOString(),
      cashierUsername,
    });
    return { offline: true, id, status: 'voided' };
  }
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

// Direct fetch â€” bypasses cachedGet, always hits API, then updates cache.
// Use after mutations (addUtang / recordPayment) to guarantee fresh data.
export async function refetchUtangEntries<T = Record<string, unknown>>(): Promise<T[]> {
  const res = await fetch('/api/utang');
  if (!res.ok) throw new Error('Failed to load utang entries');
  const data = (await res.json()) as T[];
  await saveUtangEntries(data as Record<string, unknown>[]);
  return data;
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

  const clientUuid = crypto.randomUUID();
  try {
    const res = await fetch('/api/utang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, clientUuid }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to add utang');
    }
    return res.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      error instanceof TypeError || /failed to fetch|network|offline/i.test(message);
    if (typeof window !== 'undefined' && isNetworkError) {
      await queueAddUtang({ ...data, clientUuid });
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
    throw error;
  }
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

  const paymentUuid = crypto.randomUUID();
  try {
    const res = await fetch('/api/utang/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: data.customerName, amount: data.amount, note: data.note, clientUuid: paymentUuid }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to record payment');
    }
    return res.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      error instanceof TypeError || /failed to fetch|network|offline/i.test(message);
    if (typeof window !== 'undefined' && isNetworkError) {
      await queueUtangPayment({ ...data, clientUuid: paymentUuid });
      return {
        id: Date.now(),
        amount: data.amount,
        note: data.note ?? null,
        createdAt: new Date().toISOString(),
        offline: true,
      };
    }
    throw error;
  }
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
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const tempId = -Date.now();
    const offlineUser = {
      id: tempId,
      fullName: data.fullName,
      username: data.username,
      email: data.email,
      password: data.password,
      role: data.role,
      status: 'active',
      createdAt: new Date().toISOString(),
      offline: true,
    };
    const cached = await getCachedUsers<Record<string, unknown>>();
    await saveUsers([...cached, offlineUser] as unknown as Record<string, unknown>[]);
    await queueCustomerAdd(data as unknown as Record<string, unknown>, offlineUser.id);
    return { ...offlineUser, offline: true } as unknown as InventoryUser;
  }
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
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const cached = await getCachedUsers<Record<string, unknown>>();
    const existing = cached.findIndex((c) => (c as { id: number }).id === id);
    if (existing >= 0) {
      const updated = { ...cached[existing], ...data } as unknown as Record<string, unknown>;
      await db.users.put(updated);
      await queueCustomerAdd(data as unknown as Record<string, unknown>, id);
    }
    return { offline: true, id } as unknown as InventoryUser;
  }
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
  if (typeof window !== 'undefined' && !navigator.onLine) {
    await db.users.delete(id);
    return;
  }
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
  if (isOffline()) {
    const current = (await getCachedSettings<Record<string, unknown>>()) ?? {};
    const merged = { ...current, ...(data as Record<string, unknown>) };
    await saveSettings(merged);
    await queueSettingsUpdate(data as unknown as Record<string, unknown>);
    return { ...merged, offline: true };
  }
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
  if (isOffline()) {
    const tempId = -Date.now();
    const temp = { id: tempId, ...data, createdAt: new Date().toISOString(), offline: true };
    const cached = await getCachedExpenses<Record<string, unknown>>();
    await saveExpenses([...cached, temp as unknown as Record<string, unknown>]);
    await queueExpenseAdd(data as unknown as Record<string, unknown>, tempId);
    return temp;
  }
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
export async function getReports<T = Record<string, unknown>>(range: 'today' | 'week' | 'month' | 'year' | 'all' = 'all'): Promise<T> {
  return getReportsOffline<T>(range);
}
