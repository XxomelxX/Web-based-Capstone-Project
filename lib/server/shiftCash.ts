// Shared drawer-cash math for shifts. The expected-cash formula used to be
// copy-pasted across GET /api/shift, the close action, the sync close_shift
// replay and the admin spot-check — every one of them now calls these helpers
// so a new cash movement type can never be forgotten in one of the copies.
import type { PrismaClient } from '@prisma/client';

// A bare transaction client covers both PrismaClient and the `$transaction`
// callback client without pulling the generated tx type.
type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface ShiftCashSums {
  cashIn: number; // centavos
  cashOut: number; // centavos
  expenses: number; // centavos
}

/** Sum a shift's cash movements grouped by type (all values in centavos). */
export async function sumShiftCash(tx: Tx, shiftId: number): Promise<ShiftCashSums> {
  const grouped = await tx.cashMovement.groupBy({
    by: ['type'],
    where: { shiftId },
    _sum: { amount: true },
  });
  const sums: ShiftCashSums = { cashIn: 0, cashOut: 0, expenses: 0 };
  for (const g of grouped) {
    const amount = g._sum.amount ?? 0;
    if (g.type === 'cash_in') sums.cashIn += amount;
    else if (g.type === 'cash_out') sums.cashOut += amount;
    else if (g.type === 'expense') sums.expenses += amount;
  }
  return sums;
}

/** Expected drawer cash = float + cash sales + cash in − cash out − expenses. */
export function computeExpectedCash(
  drawerFloat: number,
  cashSales: number,
  sums: ShiftCashSums
): number {
  return drawerFloat + cashSales + sums.cashIn - sums.cashOut - sums.expenses;
}
