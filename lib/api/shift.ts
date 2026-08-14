export interface ShiftDetails {
  id: number;
  cashierId: number;
  openingFloat: number;
  closingCash: number | null;
  expectedCash: number | null;
  cashSales: number | null;
  gcashSales: number | null;
  overageShortage: number | null;
  status: 'open' | 'closed';
  notes: string | null;
  openedAt: string;
  closedAt: string | null;
  totalSales?: number;
  transactionCount?: number;
  cashier?: {
    fullName: string;
    username: string;
  };
}

export interface ZReadSummary {
  openedAt: string;
  closedAt: string;
  openingFloat: number;
  cashSales: number;
  gcashSales: number;
  totalSales: number;
  transactionCount: number;
  expectedCash: number;
  closingCash: number;
  overageShortage: number;
}

const ACTIVE_SHIFT_CACHE_KEY = 'sari-sari-active-shift';

function canUseStorage() {
  return typeof window !== 'undefined';
}

export function getCachedActiveShift(): ShiftDetails | null {
  if (!canUseStorage()) return null;
  try {
    const raw = sessionStorage.getItem(ACTIVE_SHIFT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ShiftDetails) : null;
  } catch {
    return null;
  }
}

export function cacheActiveShift(shift: ShiftDetails | null) {
  if (!canUseStorage()) return;
  if (shift) {
    sessionStorage.setItem(ACTIVE_SHIFT_CACHE_KEY, JSON.stringify(shift));
  } else {
    sessionStorage.removeItem(ACTIVE_SHIFT_CACHE_KEY);
  }
}

export function applyOfflineSaleToShift(
  shift: ShiftDetails,
  saleTotal: number,
  paymentMethod: 'cash' | 'gcash'
): ShiftDetails {
  return {
    ...shift,
    totalSales: (shift.totalSales ?? 0) + saleTotal,
    transactionCount: (shift.transactionCount ?? 0) + 1,
    cashSales:
      paymentMethod === 'cash'
        ? (shift.cashSales ?? 0) + saleTotal
        : shift.cashSales,
    gcashSales:
      paymentMethod === 'gcash'
        ? (shift.gcashSales ?? 0) + saleTotal
        : shift.gcashSales,
  };
}

export async function fetchActiveShift(): Promise<ShiftDetails | null> {
  if (canUseStorage() && !navigator.onLine) {
    return getCachedActiveShift();
  }

  try {
    const res = await fetch('/api/shift');
    if (!res.ok) {
      return getCachedActiveShift();
    }
    const data = await res.json();
    const shift = (data.activeShift ?? null) as ShiftDetails | null;
    cacheActiveShift(shift);
    return shift;
  } catch {
    return getCachedActiveShift();
  }
}

export async function openShift(openingFloat: number, notes?: string): Promise<{ success: boolean; shift?: ShiftDetails; error?: string }> {
  try {
    const res = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', openingFloat, notes }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to open shift' };
    }
    cacheActiveShift(data.shift ?? null);
    return { success: true, shift: data.shift };
  } catch (error) {
    console.error('Error opening shift:', error);
    return { success: false, error: 'Network error opening shift' };
  }
}

export async function closeShift(
  closingCash: number,
  notes?: string
): Promise<{ success: boolean; shift?: ShiftDetails; summary?: ZReadSummary; error?: string }> {
  try {
    const res = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', closingCash, notes }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to close shift' };
    }
    cacheActiveShift(null);
    return { success: true, shift: data.shift, summary: data.summary };
  } catch (error) {
    console.error('Error closing shift:', error);
    return { success: false, error: 'Network error closing shift' };
  }
}

export async function fetchShiftHistory(): Promise<ShiftDetails[]> {
  try {
    const res = await fetch('/api/shift/history');
    if (!res.ok) return [];
    const data = await res.json();
    return data.shifts ?? [];
  } catch (error) {
    console.error('Error fetching shift history:', error);
    return [];
  }
}
