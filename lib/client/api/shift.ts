import { queueCashMovement, queueCloseShift, queueOpenShift } from '@/lib/client/offlineQueue';
import { saveCategory2Cache, getCategory2Cache } from '@/lib/client/localStorageCache';
import { readIdentity } from '@/lib/client/identity';
import { peso, parsePesosToCents } from '@/lib/money';

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
  // Cash movement totals (centavos) — live from CashMovement rows while the
  // shift is open, persisted snapshots after close.
  cashIn?: number;
  cashOut?: number;
  totalExpenses?: number;
  // Net cash from customer-debt (utang) payments collected by this cashier:
  // `debtPayments` covers the whole shift (and is part of the drawer math —
  // already included in `expectedCash`); `debtPaymentsToday` is the business
  // day so far (a memo, not part of the math).
  debtPayments?: number;
  debtPaymentsToday?: number;
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
  cashIn: number;
  cashOut: number;
  expenses: number;
  /** Net cash from customer-debt payments collected during the shift. */
  debtPayments: number;
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
    (a.transactionCount ?? null) === (b.transactionCount ?? null) &&
    (a.cashIn ?? null) === (b.cashIn ?? null) &&
    (a.cashOut ?? null) === (b.cashOut ?? null) &&
    (a.totalExpenses ?? null) === (b.totalExpenses ?? null) &&
    (a.debtPayments ?? null) === (b.debtPayments ?? null) &&
    (a.debtPaymentsToday ?? null) === (b.debtPaymentsToday ?? null)
  );
}

export type VarianceTone = 'balanced' | 'over' | 'short';

export interface VarianceDisplay {
  /** signed difference: counted − expected (integer centavos) */
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
 * Format an over/short variance from a signed difference in CENTAVOS.
 * SINGLE SOURCE OF TRUTH for the live End-of-Day preview AND the printed
 * Z-Read receipt, so the number the admin sees before closing can never
 * disagree with the number on the receipt. The server computes the same
 * `overageShortage = counted − expected` when the shift closes.
 */
export function formatVarianceDelta(diffCents: number): VarianceDisplay {
  // diffCents is already integer centavos (counted − expected).
  const signed = Math.round(diffCents);
  const abs = Math.abs(signed);
  const tone: VarianceTone = signed === 0 ? 'balanced' : signed > 0 ? 'over' : 'short';
  const label = tone === 'balanced' ? 'BALANCED' : tone === 'over' ? 'OVER' : 'SHORT';
  const text = peso(abs);
  const signedText = signed === 0 ? peso(0) : `${signed > 0 ? '+' : '-'}${text}`;
  return { signed, label, text, signedText, tone };
}

/** Live preview: variance for a physical cash count against expected cash. */
export function formatVariance(expectedCents: number, countedCents: number): VarianceDisplay {
  const safeExpected = Number.isFinite(expectedCents) ? expectedCents : 0;
  const safeCounted = Number.isFinite(countedCents) ? countedCents : 0;
  return formatVarianceDelta(safeCounted - safeExpected);
}

/**
 * Parse the physical cash-count input (user types pesos e.g. "1500.50").
 * Returns integer CENTAVOS, or null when blank or invalid — callers can then
 * distinguish "not entered" (close without a count) from a real 0.00 count.
 */
export function parseCashCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return parsePesosToCents(value);
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
  const cashIn = shift.cashIn ?? 0;
  const cashOut = shift.cashOut ?? 0;
  const expenses = shift.totalExpenses ?? 0;
  const debtPayments = shift.debtPayments ?? 0;
  return {
    ...shift,
    totalSales: (shift.totalSales ?? 0) + saleTotal,
    transactionCount: (shift.transactionCount ?? 0) + 1,
    cashSales: nextCashSales,
    gcashSales:
      paymentMethod === 'gcash'
        ? (shift.gcashSales ?? 0) + saleTotal
        : shift.gcashSales,
    cashIn,
    cashOut,
    totalExpenses: expenses,
    debtPayments,
    // Cached openingFloat is the drawer float the server returned, so
    // expected cash stays correct for the shared drawer while offline.
    // Formula matches lib/server/shiftCash.ts:
    // float + cash + debt payments + in − out − expenses.
    expectedCash: (shift.openingFloat ?? 0) + nextCashSales + debtPayments + cashIn - cashOut - expenses,
  };
}

/**
 * Optimistically apply a queued cash movement to the cached active shift so
 * the shift bar / Reading modal totals move immediately while offline. The
 * server is the source of truth — the next fetchActiveShift() reconciles.
 */
export function applyOfflineMovementToShift(
  shift: ShiftDetails,
  movementType: 'cash_in' | 'cash_out' | 'expense',
  amount: number
): ShiftDetails {
  const cashIn = (shift.cashIn ?? 0) + (movementType === 'cash_in' ? amount : 0);
  const cashOut = (shift.cashOut ?? 0) + (movementType === 'cash_out' ? amount : 0);
  const totalExpenses = (shift.totalExpenses ?? 0) + (movementType === 'expense' ? amount : 0);
  const debtPayments = shift.debtPayments ?? 0;
  const expectedCash =
    (shift.openingFloat ?? 0) + (shift.cashSales ?? 0) + debtPayments + cashIn - cashOut - totalExpenses;
  return { ...shift, cashIn, cashOut, totalExpenses, debtPayments, expectedCash };
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
  // 8s (not 750ms): on this link a direct open costs several ~400ms DB round
  // trips. The old 750ms budget aborted most ONLINE opens mid-request and
  // pushed the client into the offline queue — the "Online (1 queued)" pill
  // users saw after every open. Fallback still exists for true offline/broken.
  const timeoutId = setTimeout(() => controller.abort(), 8000);
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
  const cashIn = currentShift?.cashIn || 0;
  const cashOut = currentShift?.cashOut || 0;
  const expenses = currentShift?.totalExpenses || 0;
  const debtPayments = currentShift?.debtPayments || 0;
  // Same formula as lib/server/shiftCash.ts — the offline Z-Read must match
  // the summary the server produces when the queued close replays.
  const expectedCash = openingFloat + cashSales + debtPayments + cashIn - cashOut - expenses;
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
    cashIn,
    cashOut,
    expenses,
    debtPayments,
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

export interface CashMovement {
  id: number;
  clientUuid?: string | null;
  type: 'cash_in' | 'cash_out' | 'expense';
  amount: number; // centavos, positive
  note: string | null;
  expenseId?: number | null;
  createdAt: string;
  user?: { fullName?: string | null };
}

/** Latest cash movements on the caller's open shift (empty when offline/no shift). */
export async function fetchCashMovements(): Promise<CashMovement[]> {
  if (canUseStorage() && !navigator.onLine) return [];
  try {
    const res = await fetch('/api/shift/cash-movement', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as { movements?: CashMovement[] };
    return data.movements ?? [];
  } catch {
    return [];
  }
}

/**
 * Record a cash_in / cash_out / expense against the caller's OPEN shift.
 * Offline (or on a network failure) it queues a cash_movement action and
 * optimistically updates the cached shift so the totals move immediately.
 * The server resolves the target shift — the caller never sends a shiftId
 * (an offline shift id is only a temp negative until open_shift replays).
 */
export async function recordCashMovement(
  type: 'cash_in' | 'cash_out' | 'expense',
  amount: number, // centavos, positive
  note?: string
): Promise<{ offline?: boolean; movement?: CashMovement }> {
  const queueIt = async (clientUuid?: string) => {
    await queueCashMovement({ type, amount, note, clientUuid });
    const cached = getCachedActiveShift();
    if (cached) cacheActiveShift(applyOfflineMovementToShift(cached, type, amount));
    return { offline: true as const };
  };

  if (canUseStorage() && !navigator.onLine) {
    return queueIt();
  }

  const clientUuid = crypto.randomUUID();
  try {
    const res = await fetch('/api/shift/cash-movement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, amount, note, clientUuid }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // No open shift / validation errors are real failures — don't queue.
      throw new Error(body.error || `Failed to record cash movement (${res.status})`);
    }
    const data = (await res.json().catch(() => ({}))) as { movement?: CashMovement };
    // Reconcile cached shift with the server's authoritative totals.
    await fetchActiveShift();
    return { movement: data.movement };
  } catch (error) {
    if (error instanceof TypeError) {
      // Network failure — queue for later sync (same clientUuid as the failed
      // request, so a lost response can't double-apply on retry).
      return queueIt(clientUuid);
    }
    throw error;
  }
}

/** Delete a cash movement (admin-only on the server). Also removes the dual-written Expense. */
export async function deleteCashMovement(id: number): Promise<void> {
  if (canUseStorage() && !navigator.onLine) {
    throw new Error('Cannot delete cash movements while offline');
  }
  const res = await fetch(`/api/shift/cash-movement?id=${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to delete cash movement (${res.status})`);
  }
  await fetchActiveShift();
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
