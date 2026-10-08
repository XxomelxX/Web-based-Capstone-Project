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
import { saveUtangEntries, saveCachedCustomers, getCachedCustomers, saveExpenses, getCachedExpenses, saveSettings, getCachedSettings, updateCachedProductStock, db, mergeVoidRequests, getCachedVoidRequests, removeCachedVoidRequest, type VoidRequestRow } from '@/lib/client/offline';
import { queueAddUtang, queueUtangPayment, queueExpenseAdd, queueSettingsUpdate, queueCustomerAdd, queueVoidSale, queueVoidRequest, queueVoidRequestCancel, queueVoidReview, queueRestock } from '@/lib/client/offlineQueue';
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

// Direct void — admin only (online). Cashiers use requestVoid() → admin review.
// Offline direct voids are not allowed: use the void-request flow so an admin
// always presses approve, even on a shared offline device.
export async function voidTransaction(id: number, reason: string, adminUsername?: string, adminPassword?: string) {
  if (isOffline()) {
    throw new Error('You are offline — submit a void request instead. An admin will approve it.');
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

export interface VoidRequest {
  id: number;
  clientUuid?: string;
  transactionId: number;
  reason: string;
  requestedBy: number;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  cashierName?: string;
  orderTotal?: number;
  pendingSync?: boolean;
  transaction?: {
    id: number;
    total: number;
    cashier?: { fullName: string };
  };
}

function readSessionUser(): { id: number; username?: string; role?: string; name?: string } | null {
  try {
    const raw = sessionStorage.getItem('offlineSession');
    if (!raw) return null;
    const s = JSON.parse(raw) as { id?: unknown; username?: string; role?: string; name?: string };
    const id = Number(s.id);
    return { id: Number.isInteger(id) ? id : 0, username: s.username, role: s.role, name: s.name };
  } catch {
    return null;
  }
}

function toRow(r: VoidRequest, pendingSync = false): VoidRequestRow {
  return {
    id: r.id,
    clientUuid: r.clientUuid,
    transactionId: r.transactionId,
    reason: r.reason,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt,
    status: r.status,
    cashierName: r.cashierName ?? r.transaction?.cashier?.fullName,
    orderTotal: r.orderTotal ?? r.transaction?.total,
    pendingSync,
  };
}

// Cashier (or admin) requests a void. Works online AND offline: offline it is
// mirrored locally + queued, then synced when connectivity returns.
export async function requestVoid(transactionId: number, reason: string): Promise<VoidRequest> {
  const me = readSessionUser();
  const clientUuid = crypto.randomUUID();
  if (isOffline()) {
    await queueVoidRequest(transactionId, reason, me?.id ?? 0, clientUuid);
    const temp: VoidRequestRow = {
      id: -Date.now(),
      clientUuid,
      transactionId,
      reason,
      requestedBy: me?.id ?? 0,
      requestedAt: new Date().toISOString(),
      status: 'pending',
      cashierName: me?.name,
      pendingSync: true,
    };
    await mergeVoidRequests([temp]);
    return { ...temp, status: 'pending' } as VoidRequest;
  }
  try {
    const res = await fetch('/api/void-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, reason, clientUuid }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to submit void request');
    }
    const created = (await res.json()) as VoidRequest;
    await mergeVoidRequests([toRow(created)]);
    return created;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      error instanceof TypeError || /failed to fetch|network|offline/i.test(message);
    if (isNetworkError) {
      await queueVoidRequest(transactionId, reason, me?.id ?? 0, clientUuid);
      const temp: VoidRequestRow = {
        id: -Date.now(),
        clientUuid,
        transactionId,
        reason,
        requestedBy: me?.id ?? 0,
        requestedAt: new Date().toISOString(),
        status: 'pending',
        cashierName: me?.name,
        pendingSync: true,
      };
      await mergeVoidRequests([temp]);
      return { ...temp, status: 'pending' } as VoidRequest;
    }
    throw error;
  }
}

// Pending approve queue. Admin online: server list (merged to mirror).
// Anyone offline: local mirror (survives the shared-device user-switch wipe).
export async function getVoidRequests(): Promise<VoidRequest[]> {
  if (isOffline()) {
    const rows = await getCachedVoidRequests();
    return rows
      .filter((r) => r.status === 'pending')
      .map((r) => ({ ...r }) as VoidRequest);
  }
  try {
    const res = await fetch('/api/void-requests?status=pending');
    if (!res.ok) throw new Error('Failed to load void requests');
    const data = (await res.json()) as (VoidRequest & {
      transaction?: { id: number; total: number; cashier?: { fullName: string } };
    })[];
    await mergeVoidRequests(data.map((r) => toRow(r)));
    return data;
  } catch {
    const rows = await getCachedVoidRequests();
    return rows
      .filter((r) => r.status === 'pending')
      .map((r) => ({ ...r }) as VoidRequest);
  }
}

// Requester (or admin) cancels a pending request. Works offline via queue.
export async function cancelVoidRequest(id: number): Promise<void> {
  const me = readSessionUser();
  if (isOffline()) {
    await queueVoidRequestCancel(id, me?.id ?? 0);
    await removeCachedVoidRequest(id);
    return;
  }
  try {
    const res = await fetch(`/api/void-requests/${id}/cancel`, { method: 'POST' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to cancel void request');
    }
    await removeCachedVoidRequest(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TypeError || /failed to fetch|network|offline/i.test(message)) {
      await queueVoidRequestCancel(id, me?.id ?? 0);
      await removeCachedVoidRequest(id);
      return;
    }
    throw error;
  }
}

// Admin review. Offline approvals queue as void_review and finalize on sync
// (sync requires an admin session to execute).
export async function reviewVoidRequest(id: number, approved: boolean, note?: string): Promise<void> {
  if (isOffline()) {
    await queueVoidReview(id, approved, note);
    if (approved) {
      const rows = await getCachedVoidRequests();
      const row = rows.find((r) => r.id === id);
      if (row) await mergeVoidRequests([{ ...row, pendingSync: true }]);
    } else {
      await removeCachedVoidRequest(id);
    }
    return;
  }
  try {
    const res = await fetch(`/api/void-requests/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, note }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to review void request');
    }
    await removeCachedVoidRequest(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TypeError || /failed to fetch|network|offline/i.test(message)) {
      await queueVoidReview(id, approved, note);
      if (!approved) await removeCachedVoidRequest(id);
      return;
    }
    throw error;
  }
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
  dueDate?: string | null;
}) {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    await queueAddUtang({ ...data, dueDate: data.dueDate ?? undefined });
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
      dueDate: data.dueDate ?? null,
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
      await queueAddUtang({ ...data, clientUuid, dueDate: data.dueDate ?? undefined });
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
        dueDate: data.dueDate ?? null,
        createdAt: new Date().toISOString(),
        offline: true,
      };
    }
    throw error;
  }
}

// Set/change/clear a debt's deadline. Works online AND offline (queued sync).
export async function updateUtangDeadline(utangEntryId: number, dueDate: string | null): Promise<void> {
  const { queueUtangDeadlineUpdate } = await import('@/lib/client/offlineQueue');
  if (typeof window !== 'undefined' && !navigator.onLine) {
    await queueUtangDeadlineUpdate(utangEntryId, dueDate);
    try {
      await db.utang.update(utangEntryId, { dueDate } as unknown as Record<string, unknown>);
    } catch { /* mirror best-effort */ }
    return;
  }
  try {
    const res = await fetch(`/api/utang/${utangEntryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update deadline');
    }
    try {
      const updated = await res.json() as Record<string, unknown>;
      await db.utang.update(utangEntryId, { dueDate: (updated.dueDate ?? dueDate) as unknown } as Record<string, unknown>);
    } catch { /* mirror best-effort */ }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TypeError || /failed to fetch|network|offline/i.test(message)) {
      await queueUtangDeadlineUpdate(utangEntryId, dueDate);
      try {
        await db.utang.update(utangEntryId, { dueDate } as unknown as Record<string, unknown>);
      } catch { /* mirror best-effort */ }
      return;
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
