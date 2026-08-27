import { queueCloseShift, queueOpenShift } from '@/lib/offlineQueue';

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
    const data = (await res.json().catch(() => ({}))) as { activeShift?: ShiftDetails };
    const shift = (data.activeShift ?? null) as ShiftDetails | null;
    cacheActiveShift(shift);
    return shift;
  } catch {
    return getCachedActiveShift();
  }
}

export async function openShift(
  openingFloat: number,
  notes?: string
): Promise<{ success: boolean; shift?: ShiftDetails; error?: string }> {
  const offlineShift: ShiftDetails = {
    id: -Date.now(),
    cashierId: 1,
    openingFloat,
    closingCash: null,
    expectedCash: openingFloat,
    cashSales: 0,
    gcashSales: 0,
    overageShortage: 0,
    status: 'open',
    notes: notes || 'Offline shift',
    openedAt: new Date().toISOString(),
    closedAt: null,
    totalSales: 0,
    transactionCount: 0,
  };

  if (canUseStorage() && !navigator.onLine) {
    await queueOpenShift({ openingFloat, notes });
    cacheActiveShift(offlineShift);
    return { success: true, shift: offlineShift };
  }

  try {
    const res = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', openingFloat, notes }),
    });

    if (!res.ok) {
      await queueOpenShift({ openingFloat, notes });
      cacheActiveShift(offlineShift);
      return { success: true, shift: offlineShift };
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string; shift?: ShiftDetails };
    if (data.shift) {
      cacheActiveShift(data.shift);
      return { success: true, shift: data.shift };
    }

    await queueOpenShift({ openingFloat, notes });
    cacheActiveShift(offlineShift);
    return { success: true, shift: offlineShift };
  } catch (error) {
    console.error('Network/DB error opening shift, fallback to offline:', error);
    await queueOpenShift({ openingFloat, notes });
    cacheActiveShift(offlineShift);
    return { success: true, shift: offlineShift };
  }
}

export async function closeShift(
  closingCash: number,
  notes?: string
): Promise<{ success: boolean; shift?: ShiftDetails; summary?: ZReadSummary; error?: string }> {
  const currentShift = getCachedActiveShift();
  const openedAt = currentShift?.openedAt || new Date().toISOString();
  const openingFloat = currentShift?.openingFloat || 0;
  const cashSales = currentShift?.cashSales || 0;
  const gcashSales = currentShift?.gcashSales || 0;
  const totalSales = currentShift?.totalSales || cashSales + gcashSales;
  const transactionCount = currentShift?.transactionCount || 0;
  const expectedCash = openingFloat + cashSales;
  const overageShortage = closingCash - expectedCash;

  const fallbackSummary: ZReadSummary = {
    openedAt,
    closedAt: new Date().toISOString(),
    openingFloat,
    cashSales,
    gcashSales,
    totalSales,
    transactionCount,
    expectedCash,
    closingCash,
    overageShortage,
  };

  if (canUseStorage() && !navigator.onLine) {
    await queueCloseShift({ closingCash, notes });
    cacheActiveShift(null);
    return { success: true, summary: fallbackSummary };
  }

  try {
    const res = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', closingCash, notes }),
    });

    if (!res.ok) {
      await queueCloseShift({ closingCash, notes });
      cacheActiveShift(null);
      return { success: true, summary: fallbackSummary };
    }

    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      shift?: ShiftDetails;
      summary?: ZReadSummary;
    };

    cacheActiveShift(null);
    return { success: true, shift: data.shift, summary: data.summary || fallbackSummary };
  } catch (error) {
    console.error('Network/DB error closing shift, fallback to offline:', error);
    await queueCloseShift({ closingCash, notes });
    cacheActiveShift(null);
    return { success: true, summary: fallbackSummary };
  }
}

export async function fetchShiftHistory(): Promise<ShiftDetails[]> {
  try {
    const res = await fetch('/api/shift/history');
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as { shifts?: ShiftDetails[] };
    return data.shifts ?? [];
  } catch (error) {
    console.error('Error fetching shift history:', error);
    return [];
  }
}
