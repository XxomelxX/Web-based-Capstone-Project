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

// The store runs on UTC+8 all year (no DST), so the business day is a FIXED
// offset from UTC. Deriving it from the server's local timezone would break
// on a host that runs in UTC (hosted prod): payments taken between 00:00 and
// 08:00 store time would fall outside "today".
const STORE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Start of the store's business day (UTC+8) as an absolute instant. */
export function startOfStoreDay(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + STORE_UTC_OFFSET_MS);
  const dayStartUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  return new Date(dayStartUtc - STORE_UTC_OFFSET_MS);
}

/**
 * NET cash from customer-debt (utang) payments recorded by `cashierId` since
 * `since` — the money that actually settled a debt.
 *
 * NET, not gross: `Payment.amount` is what the customer handed over; the part
 * that could not be applied to a debt went back to the customer as change
 * (see the "200 kwarta sukli 170" notes), so only the applied amount stayed
 * in the drawer. The allocations are therefore the drawer amount.
 *
 * Legacy payments recorded before cashier attribution existed have no
 * `recordedBy` and are not attributed to any shift.
 */
export async function sumDebtPayments(
  tx: Tx,
  cashierId: number,
  since: Date,
  until?: Date
): Promise<number> {
  const agg = await tx.paymentAllocation.aggregate({
    _sum: { amountApplied: true },
    where: {
      payment: {
        recordedBy: cashierId,
        createdAt: until ? { gte: since, lte: until } : { gte: since },
      },
    },
  });
  return agg._sum.amountApplied ?? 0;
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

/**
 * Expected drawer cash = float + cash sales + debt payments collected + cash
 * in − cash out − expenses.
 *
 * Debt payments count: a customer settling a debt in cash puts that cash in
 * the drawer, so leaving it out would report a false shortage at close.
 */
export function computeExpectedCash(
  drawerFloat: number,
  cashSales: number,
  sums: ShiftCashSums,
  debtPayments = 0
): number {
  return drawerFloat + cashSales + debtPayments + sums.cashIn - sums.cashOut - sums.expenses;
}
