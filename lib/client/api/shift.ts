import { queueCloseShift, queueOpenShift } from '@/lib/client/offlineQueue';
import { saveCategory2Cache, getCategory2Cache } from '@/lib/client/localStorageCache';

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
  closingCash: number | null;
  overageShortage: number | null;
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
  const nextCashSales =
    paymentMethod === 'cash'
      ? (shift.cashSales ?? 0) + saleTotal
      : (shift.cashSales ?? 0);
  return {
    ...shift,
    totalSales: (shift.totalSales ?? 0) + saleTotal,
    transactionCount: (shift.transactionCount ?? 0) + 1,
    cashSales: nextCashSales,
    gcashSales:
      paymentMethod === 'gcash'
        ? (shift.gcashSales ?? 0) + saleTotal
        : shift.gcashSales,
    // Cached openingFloat is the drawer float the server returned, so
    // expected cash stays correct for the shared drawer while offline.
    expectedCash: (shift.openingFloat ?? 0) + nextCashSales,
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

  // Idempotency key generated once: reused by the live request and any
  // offline fallback, so open-then-fail-then-queue never creates 2 shifts.
  const clientUuid = crypto.randomUUID();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 750);
  let response: Response;
  let data: { error?: string; shift?: ShiftDetails };
  try {
    response = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ action: 'open', openingFloat, notes, clientUuid }),
    });
    const responseText = await response.text();
    try {
      data = responseText ? JSON.parse(responseText) as { error?: string; shift?: ShiftDetails } : {};
    } catch {
      if (response.ok) throw new Error('Shift API returned an invalid response.');
      data = {};
    }
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    await queueOpenShift({ openingFloat, notes, clientUuid });
    cacheActiveShift(offlineShift);
    return { success: true, shift: offlineShift };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 409 && data.shift) {
      cacheActiveShift(data.shift);
      return { success: true, shift: data.shift };
    }
    throw new Error(data.error || `Failed to open shift (${response.status})`);
  }

  if (!data.shift) {
    throw new Error(data.error || 'Shift API returned a successful response without a shift.');
  }
  cacheActiveShift(data.shift);
  return { success: true, shift: data.shift };
}

export async function closeShift(
  closingCash?: number,
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
  const hasCountedCash = typeof closingCash === 'number' && Number.isFinite(closingCash);
  const countedCash = hasCountedCash ? closingCash! : null;
  const overageShortage = hasCountedCash ? closingCash! - expectedCash : null;

  const fallbackSummary: ZReadSummary = {
    openedAt,
    closedAt: new Date().toISOString(),
    openingFloat,
    cashSales,
    gcashSales,
    totalSales,
    transactionCount,
    expectedCash,
    closingCash: countedCash,
    overageShortage,
  };

  if (canUseStorage() && !navigator.onLine) {
    await queueCloseShift({ closingCash, notes });
    cacheActiveShift(null);
    return { success: true, summary: fallbackSummary };
  }

  const closeUuid = crypto.randomUUID();
  try {
    const res = await fetch('/api/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', closingCash, notes, clientUuid: closeUuid }),
    });

    if (!res.ok) {
      await queueCloseShift({ closingCash, notes, clientUuid: closeUuid });
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
    await queueCloseShift({ closingCash, notes, clientUuid: closeUuid });
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

export async function fetchShiftHistoryCached(): Promise<ShiftDetails[]> {
  const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
  if (offlineNow) {
    return getCategory2Cache<ShiftDetails[]>('shift_history').data ?? [];
  }
  try {
    const data = await fetchShiftHistory();
    if (data.length > 0) saveCategory2Cache('shift_history', data);
    return data;
  } catch {
    return getCategory2Cache<ShiftDetails[]>('shift_history').data ?? [];
  }
}

export interface ActiveShiftSpotCheck {
  shift: ShiftDetails;
  lastTransactionAt?: string;
}

export async function fetchActiveShiftsSpotCheck(): Promise<ActiveShiftSpotCheck[]> {
  const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
  if (offlineNow) {
    return getCategory2Cache<ActiveShiftSpotCheck[]>('active_shifts_spot_check').data ?? [];
  }
  try {
    const res = await fetch('/api/shift/active-shifts');
    if (!res.ok) return getCategory2Cache<ActiveShiftSpotCheck[]>('active_shifts_spot_check').data ?? [];
    const data = (await res.json().catch(() => ({}))) as { activeShifts?: ActiveShiftSpotCheck[] };
    const result = data.activeShifts ?? [];
    if (result.length > 0) saveCategory2Cache('active_shifts_spot_check', result);
    return result;
  } catch {
    return getCategory2Cache<ActiveShiftSpotCheck[]>('active_shifts_spot_check').data ?? [];
  }
}
