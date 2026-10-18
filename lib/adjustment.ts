// Shared vocabulary for stock adjustments — imported by the /api/inventory/adjust
// route (server) and the adjustment modal/history UI (client).

export const ADJUSTMENT_TYPES = ['increase', 'decrease'] as const;

export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  increase: 'Increase',
  decrease: 'Decrease',
};

// Rows created before the Increase/Decrease vocabulary stored a reason as the
// type. Display-only map so old history keeps its labels.
const LEGACY_ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  breakage: 'Breakage',
  expired: 'Expired',
  theft: 'Theft/Loss',
  found: 'Found Stock',
  correction: 'Correction',
  other: 'Other',
};

export function isAdjustmentType(value: unknown): value is AdjustmentType {
  return typeof value === 'string' && (ADJUSTMENT_TYPES as readonly string[]).includes(value);
}

export function adjustmentTypeLabel(value: string | null | undefined): string {
  if (value == null) return '';
  if (isAdjustmentType(value)) return ADJUSTMENT_TYPE_LABELS[value];
  return LEGACY_ADJUSTMENT_TYPE_LABELS[value] ?? value;
}

// recount stays in the API contract for back-compat — the adjustment modal
// only offers increase/decrease (direction IS the adjustment type now).
export type AdjustmentMode = 'increase' | 'decrease' | 'recount';
