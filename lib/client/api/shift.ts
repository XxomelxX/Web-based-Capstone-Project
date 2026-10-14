import { queueCloseShift, queueOpenShift } from '@/lib/client/offlineQueue';
import { saveCategory2Cache, getCategory2Cache } from '@/lib/client/localStorageCache';
import { readIdentity } from '@/lib/client/identity';

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
// Legacy per-tab key � read as a migration fallback, never written.
const LEGACY_ACTIVE_SHIFT_KEY = 'sari-sari-active-shift';

interface CachedShiftEnvelope {
  owner: string;
  shift: ShiftDetails;
}

function canUseStorage() {
  return typeof window !== 'undefined';
}

/**
 * Owner of the cached shift = the signed-in username (or id as a fallback).
 * The drawer is SHARED, but an open shift belongs to the cashier who opened it,
 * so a different user on this device must not inherit someone else's shift.
 */
function currentOwner(): string {
  if (!canUseStorage()) return '';
  try {
    const identity = readIdentity();
    if (identity) return identity.username || String(identity.id);
  } catch { /* fall through to legacy record */ }
  try {
    const raw = sessionStorage.getItem('offlineSession');
    if (raw) {
      const parsed = JSON.parse(raw) as { username?: string; id?: number | string };
      return parsed.username || String(parsed.id ?? '');
    }
  } catch { /* no owner available */ }
  return '';
}

/**
 * The active shift is cached in **localStorage** and scoped to its owner.
 *
 * It used to live in sessionStorage, which is per-tab: an offline refresh in a
 * new tab (or after a browser restart) lost the shift and the POS came back up
 * showing "No Open Shift".
 */
export function getCachedActiveShift(): ShiftDetails | null {
  if (!canUseStorage()) return null;
  const owner = currentOwner();
  try {
    const raw = localStorage.getItem(ACTIVE_SHIFT_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CachedShiftEnvelope | ShiftDetails;
      if (parsed && typeof parsed === 'object' && 'shift' in parsed && 'owner' in parsed) {
        const envelope = parsed as CachedShiftEnvelope;
        // Owner mismatch ? not this user's shift. Do not show (and do not delete
        // the file: the POS reloads the shift from the server when back online).
        if (envelope.owner && owner && envelope.owner !== owner) return null;
        return envelope.shift ?? null;
      }
      // Pre-owner cache format (older build): treat as the current owner's and
      // let the next write upgrade it.
      return parsed as ShiftDetails;
    }
  } catch { /* fall through to legacy */ }
  try {
    const legacy = sessionStorage.getItem(LEGACY_ACTIVE_SHIFT_KEY);
    return legacy ? (JSON.parse(legacy) as ShiftDetails) : null;
  } catch {
    return null;
  }
}

export function cacheActiveShift(shift: ShiftDetails | null) {
  if (!canUseStorage()) return;
  try {
    if (shift) {
      const envelope: CachedShiftEnvelope = { owner: currentOwner(), shift };
      localStorage.setItem(ACTIVE_SHIFT_CACHE_KEY, JSON.stringify(envelope));
    } else {
      localStorage.removeItem(ACTIVE_SHIFT_CACHE_KEY);
    }
    // Keep the legacy per-tab key in step while other readers may still use it.
    if (shift) sessionStorage.setItem(LEGACY_ACTIVE_SHIFT_KEY, JSON.stringify(shift));
    else sessionStorage.removeItem(LEGACY_ACTIVE_SHIFT_KEY);
  } catch { /* storage unavailable � in-memory state still works */ }
}

/**
 * Structural equality for the fields the shift bar displays.
 * fetchActiveShift() always builds a fresh object (new fetch JSON online, new
 * JSON.parse from cache offline), so a naive setState re-rendered on every
 * poll even when nothing changed. Comparing first turns identical payloads
 * into zero renders.
 */
export function sameShift(a: ShiftDetails | null, b: ShiftDetails | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.openingFloat === b.openingFloat &&
    a.cashSales === b.cashSales &&
    a.gcashSales === b.gcashSales &&
    (a.expectedCash ?? null) === (b.expectedCash ?? null) &&
    (a.totalSales ?? null) === (b.totalSales ?? null) &&
    (a.transactionCount ?? null) === (b.transactionCount ?? null)
  );
}

export type VarianceTone = 'balanced' | 'over' | 'short';

export interface VarianceDisplay {
  /** signed difference: counted − expected (round to cent precision) */
  signed: number;
  /** 'BALANCED' | 'OVER' | 'SHORT' */
  label: 'BALANCED' | 'OVER' | 'SHORT';
  /** absolute money, e.g. "₱100.00" */
  text: string;
  /** signed money for the live preview, e.g. "+₱100.00" / "-₱100.00" / "₱0.00" */
  signedText: string;
  tone: VarianceTone;
}

/**
 * Format an over/short variance from a signed difference.
 * SINGLE SOURCE OF TRUTH for the live End-of-Day preview AND the printed
 * Z-Read receipt, so the number the admin sees before closing can never
 * disagree with the number on the receipt. The server computes the same
 * `overageShortage = counted − expected` when the shift closes.
 */
export function formatVarianceDelta(diff: number): VarianceDisplay {
  // Money maths: snap float error to cent precision (1000.05-1000 etc).
  const signed = Math.round(diff * 100) / 100;
  const abs = Math.abs(signed);
  const tone: VarianceTone = signed === 0 ? 'balanced' : signed > 0 ? 'over' : 'short';
  const label = tone === 'balanced' ? 'BALANCED' : tone === 'over' ? 'OVER' : 'SHORT';
  const text = `₱${abs.toFixed(2)}`;
  const signedText = signed === 0 ? '₱0.00' : `${signed > 0 ? '+' : '-'}${text}`;
  return { signed, label, text, signedText, tone };
}

/** Live preview: variance for a physical cash count against expected cash. */
export function formatVariance(expected: number, counted: number): VarianceDisplay {
  const safeExpected = Number.isFinite(expected) ? expected : 0;
  const safeCounted = Number.isFinite(counted) ? counted : 0;
  return formatVarianceDelta(safeCounted - safeExpected);
}

/**
 * Parse the physical cash-count input. Returns null when blank or invalid —
 * callers can then distinguish "not entered" (close without a count) from a
 * real 0.00 count.
 */
export function parseCashCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
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
