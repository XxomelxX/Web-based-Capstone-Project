// Low Stock
export async function getLowStock() {
  const res = await fetch('/api/lowstock');
  if (!res.ok) throw new Error('Failed to load low stock');
  return res.json() as Promise<{ threshold: number; products: Array<Record<string, unknown>> }>;
}

export async function restockProduct(data: {
  productId: number;
  quantity: number;
  supplier?: string;
  costPerUnit?: number;
}) {
  const res = await fetch('/api/restock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Restock failed');
  return res.json();
}

// Orders / Transactions
export async function getTransactions() {
  const res = await fetch('/api/transactions');
  if (!res.ok) throw new Error('Failed to load transactions');
  return res.json();
}

export async function voidTransaction(id: number, reason: string) {
  const res = await fetch(`/api/transactions/${id}/void`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Void failed');
  return res.json();
}

// Utang / Credit
export async function getUtangEntries() {
  const res = await fetch('/api/utang');
  if (!res.ok) throw new Error('Failed to load utang entries');
  return res.json();
}

export async function addUtang(data: {
  customerName: string;
  items: Array<{ productId: number; quantity: number; unitPrice: number }>;
  note?: string;
}) {
  const res = await fetch('/api/utang', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add utang');
  return res.json();
}

export async function recordUtangPayment(data: { customerName: string; amount: number; note?: string }) {
  const res = await fetch('/api/utang/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Payment failed');
  return res.json();
}

// Users (Admin only)
export async function getUsers() {
  const res = await fetch('/api/users');
  if (!res.ok) throw new Error('Failed to load users');
  return res.json();
}

export async function addUser(data: {
  fullName: string;
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'cashier';
}) {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add user');
  return res.json();
}

// Settings
export async function getSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

export async function updateSettings(data: object) {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update settings');
  return res.json();
}

// Expenses
export async function getExpenses() {
  const res = await fetch('/api/expenses');
  if (!res.ok) throw new Error('Failed to load expenses');
  return res.json();
}

export async function addExpense(data: { type: string; amount: number; period: string; note?: string }) {
  const res = await fetch('/api/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to add expense');
  return res.json();
}

// Item Log
export async function getItemLog() {
  const res = await fetch('/api/itemlog');
  if (!res.ok) throw new Error('Failed to load item log');
  return res.json();
}

// Reports
export async function getReports(range: 'week' | 'month' | 'all' = 'all') {
  const res = await fetch(`/api/reports?range=${range}`);
  if (!res.ok) throw new Error('Failed to load reports');
  return res.json();
}
