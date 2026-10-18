// Money is stored as INTEGER CENTAVOS (₱25.50 === 2550). Never Float.
// Server and client both import from here so display/parse stay consistent.

/** ₱25.50 — default display form. Handles negatives as -₱5.00. */
export function peso(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}₱${(abs / 100).toFixed(2)}`;
}

/** "25.50" — no currency symbol (tables/charts that supply their own ₱). */
export function toPesos(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Parse user-entered pesos ("25", "25.5", "₱25.50") into integer centavos.
 * Rounds half-up via Math.round. Returns NaN for unparseable input —
 * callers must validate before persisting.
 */
export function parsePesosToCents(input: string | number): number {
  if (typeof input === 'number') return Math.round(input * 100);
  const cleaned = input.replace(/[₱,\s]/g, '');
  if (cleaned === '') return NaN;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** True when n is a safe non-negative integer centavo amount. */
export function isCents(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && Number.isSafeInteger(n);
}
