// READ-ONLY database integrity diagnostics for sari-sari-pos.
// Safe on production: every query is a SELECT (aggregates, samples).
// Usage: node --env-file=.env scripts/db-diagnostic.mjs [report.json]
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient({ log: ['error'] });
const report = { ranAt: new Date().toISOString(), checks: {} };
const MAX_SAMPLE = 5;

function jsonSafe(v) { return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? Number(x) : x))); }function print(section, rows, { flag = true } = {}) {
  report.checks[section] = { count: rows.length, sample: flag ? rows.slice(0, MAX_SAMPLE) : undefined };
  // rows.length > 0 is reported as ISSUE only for checks that can never be
  // legitimate rows; non-problem counts (row counts, settings, info stats)
  // pass flag:false and print bare.
  console.log(`${flag && rows.length > 0 ? 'ISSUE' : 'OK   '} ${section}: ${rows.length}` +
    (rows.length && flag ? `\n     sample: ${JSON.stringify(rows.slice(0, MAX_SAMPLE))}` : ''));
}

async function main() {
  const meta = await prisma.$queryRaw`SELECT current_database() AS db, version() AS ver`;
  report.meta = jsonSafe(meta).map(m => ({ db: m.db, ver: String(m.ver).split(',').slice(0, 2).join(',') }));
  console.log('DB   ' + JSON.stringify(report.meta[0]));

  print('rowCounts', Object.fromEntries(await Promise.all([
    ['user', prisma.user.count()], ['category', prisma.category.count()], ['product', prisma.product.count()],
    ['stockBatch', prisma.stockBatch.count()], ['customer', prisma.customer.count()],
    ['transaction', prisma.transaction.count()], ['transactionItem', prisma.transactionItem.count()],
    ['voidRequest', prisma.voidRequest.count()], ['utangEntry', prisma.utangEntry.count()],
    ['utangEntryItem', prisma.utangEntryItem.count()], ['payment', prisma.payment.count()],
    ['paymentAllocation', prisma.paymentAllocation.count()], ['expense', prisma.expense.count()],
    ['itemLog', prisma.itemLog.count()], ['shift', prisma.shift.count()],
    ['cashMovement', prisma.cashMovement.count()], ['passwordResetCode', prisma.passwordResetCode.count()],
  ])), { flag: false });

  // --- Stock: FIFO invariant: Product.stock === SUM(batch.quantityRemaining)
  const fifo = await prisma.$queryRaw`
    SELECT p.id, p.name, p.stock, COALESCE(SUM(sb."quantityRemaining"),0) AS batch_sum, COUNT(sb.id) AS batches
    FROM "Product" p LEFT JOIN "StockBatch" sb ON sb."productId" = p.id
    GROUP BY p.id
    HAVING p.stock <> COALESCE(SUM(sb."quantityRemaining"),0) OR p.stock < 0
    ORDER BY p.id`;
  print('stock_fifoMismatches', jsonSafe(fifo));

  // --- Stock: impossible batch values
  const badBatches = await prisma.$queryRaw`
    SELECT id, "productId", "quantityReceived", "quantityRemaining",
           "quantityReceived" - "quantityRemaining" AS sold_from_batch
    FROM "StockBatch"
    WHERE "quantityRemaining" < 0 OR "quantityReceived" < 0 OR "quantityRemaining" > "quantityReceived"`;
  print('stock_impossibleBatches', jsonSafe(badBatches));

  // --- Stock: batches with future / absurd dates
  const oddDates = await prisma.$queryRaw`
    SELECT id, "productId", "dateReceived" FROM "StockBatch" WHERE "dateReceived" > now() + interval '1 day'`;
  print('stock_futureBatchDates', jsonSafe(oddDates));

  // --- Utang ledger: remaining === total - paid; amountPaid === SUM(allocations)
  const utangLedger = await prisma.$queryRaw`
    SELECT u.id, u."totalAmount", u."amountPaid", u."remainingBalance", u.status,
           COALESCE(a.paid, 0) AS alloc_sum,
           u."totalAmount" - u."amountPaid" AS expected_remaining
    FROM "UtangEntry" u
    LEFT JOIN (SELECT "utangEntryId", SUM("amountApplied") AS paid FROM "PaymentAllocation" GROUP BY "utangEntryId") a
           ON a."utangEntryId" = u.id
    WHERE u."remainingBalance" <> u."totalAmount" - u."amountPaid"
       OR u."amountPaid" <> COALESCE(a.paid, 0)`;
  print('utang_ledgerMismatches', jsonSafe(utangLedger));

  // --- Utang status vs balances
  const utangStatus = await prisma.$queryRaw`
    SELECT id, status, "totalAmount", "amountPaid", "remainingBalance" FROM "UtangEntry"
    WHERE ("status" = 'paid' AND "remainingBalance" <> 0)
       OR ("status" = 'unpaid' AND "amountPaid" <> 0)
       OR ("status" = 'partial' AND ("amountPaid" <= 0 OR "remainingBalance" <= 0))`;
  print('utang_statusMismatches', jsonSafe(utangStatus));

  // --- Utang totalAmount vs items lineTotal
  const utangItems = await prisma.$queryRaw`
    SELECT u.id, u."totalAmount", COALESCE(SUM(i."lineTotal"), 0) AS items_sum, COUNT(i.id) AS item_rows
    FROM "UtangEntry" u LEFT JOIN "UtangEntryItem" i ON i."utangEntryId" = u.id
    GROUP BY u.id
    HAVING COALESCE(SUM(i."lineTotal"), 0) <> u."totalAmount" OR COUNT(i.id) = 0
    ORDER BY u.id`;
  print('utang_itemsTotalMismatch', jsonSafe(utangItems));

  // --- Transaction item math: lineTotal === quantity * unitPrice
  const txItemMath = await prisma.$queryRaw`
    SELECT id, "transactionId", quantity, "unitPrice", "lineTotal"
    FROM "TransactionItem"
    WHERE "lineTotal" <> quantity * "unitPrice" OR quantity <= 0 OR "unitPrice" < 0`;
  print('tx_itemMathErrors', jsonSafe(txItemMath));

  // --- Transaction totals: subtotal === SUM(lineTotal)
  const txTotals = await prisma.$queryRaw`
    SELECT t.id, t.status, t.subtotal, COALESCE(SUM(i."lineTotal"), 0) AS items_sum, COUNT(i.id) AS item_rows
    FROM "Transaction" t LEFT JOIN "TransactionItem" i ON i."transactionId" = t.id
    GROUP BY t.id
    HAVING COALESCE(SUM(i."lineTotal"), 0) <> t.subtotal OR COUNT(i.id) = 0
    ORDER BY t.id`;
  print('tx_subtotalMismatch', jsonSafe(txTotals));

  // --- Transaction total vs subtotal + vat: currently NOT an error.
  //     VAT-inclusive pricing is intentional (app/api/pos/checkout/route.ts):
  //     total = subtotal and vat is the extracted breakdown for reports.

  // --- Voided sanity: voided rows missing audit fields / blocks
  const voidSanity = await prisma.$queryRaw`
    SELECT id, status, "voidedBy", "voidedAt", "voidReason",
      (SELECT COUNT(*) FROM "VoidRequest" vr WHERE vr."transactionId" = t.id) AS void_requests
    FROM "Transaction" t
    WHERE status IN ('voided','complete') AND (
      (status = 'voided' AND ("voidedBy" IS NULL OR "voidedAt" IS NULL OR "voidReason" IS NULL))
      OR (status = 'complete' AND "voidedAt" IS NOT NULL))`;
  print('tx_voidAuditGaps', jsonSafe(voidSanity));

  // --- Allocations overpaying / negative
  const badAlloc = await prisma.$queryRaw`
    SELECT id, "paymentId", "utangEntryId", "amountApplied" FROM "PaymentAllocation"
    WHERE "amountApplied" <= 0`;
  print('payment_allocNonPositive', jsonSafe(badAlloc));

  // --- Payment underallocation is legitimate (customer overpaying -> advance,
  //     route returns unallocatedRemainder); only over-allocation is a bug.
  const payAlloc = await prisma.$queryRaw`
    SELECT p.id, p."amount", COALESCE(SUM(a."amountApplied"), 0) AS applied, COUNT(a.id) AS alloc_rows
    FROM "Payment" p LEFT JOIN "PaymentAllocation" a ON a."paymentId" = p.id
    GROUP BY p.id
    HAVING COALESCE(SUM(a."amountApplied"), 0) > p."amount" OR (p."amount" > 0 AND COUNT(a.id) = 0)
    ORDER BY p.id`;
  print('payment_overallocation', jsonSafe(payAlloc));

  // --- Shifts: closed with missing timestamps / contradictory states /
  //     double-open per cashier. NOTE: closingCash IS NULL on closed shifts is
  //     valid by design (route/app/api/shift/route.ts:208) — closing without a
  //     physical drawer count intentionally stores null.
  const shiftOdd = await prisma.$queryRaw`
    SELECT s.id, s."cashierId", s.status, s."openedAt", s."closedAt"
    FROM "Shift" s
    WHERE (s.status = 'closed' AND (s."closedAt" IS NULL))
       OR (s.status = 'open' AND s."closedAt" IS NOT NULL)
       OR (s.status = 'open' AND EXISTS (
         SELECT 1 FROM "Shift" s2 WHERE s2."cashierId" = s."cashierId" AND s2.id <> s.id AND s2.status = 'open'))`;
  print('shift_anomalies', jsonSafe(shiftOdd));

  // --- Cash movements: bad types / amounts; expense rows missing Expense link
  const cmOdd = await prisma.$queryRaw`
    SELECT id, "shiftId", type, amount,
           CASE WHEN type = 'expense' AND "expenseId" IS NULL THEN 'no_expense_link' ELSE 'amount_or_type' END AS issue
    FROM "CashMovement"
    WHERE NOT (type IN ('cash_in','cash_out','expense')) OR amount <= 0
       OR (type = 'expense' AND "expenseId" IS NULL)`;
  print('cashMovement_anomalies', jsonSafe(cmOdd));

  // --- Settings: exactly one row expected
  const settings = await prisma.$queryRaw`SELECT id, "storeName", "taxRate", "lowStockThreshold" FROM "Settings"`;
  print('settings_rows', settings.map(jsonSafe), { flag: false });

  // --- Product quality: negative/absurd money, artwork of legacy peso-scale data
  const prodQuality = await prisma.$queryRaw`
    SELECT id, name, price, cost, stock, archived FROM "Product"
    WHERE price < 0 OR cost < 0 OR price > 50000000 OR cost > price * 10
    ORDER BY price DESC LIMIT 50`;
  print('product_priceAnomalies', jsonSafe(prodQuality));

  // --- Date anomalies in transactions
  const txDates = await prisma.$queryRaw`
    SELECT id, "createdAt" FROM "Transaction" WHERE "createdAt" > now() + interval '1 day' OR "createdAt" < '2020-01-01'`;
  print('tx_strangeDates', jsonSafe(txDates));

  // --- Duplicate utang names attempt + customers empty names
  const custOdd = await prisma.$queryRaw`
    SELECT id, name FROM "Customer" WHERE name IS NULL OR btrim(name) = ''`;
  print('customer_blankNames', jsonSafe(custOdd));

  // --- PasswordResetCode stale entries (cleanup candidates, report only)
  const staleCodes = await prisma.$queryRaw`
    SELECT COUNT(*) AS stale FROM "PasswordResetCode" WHERE "expiresAt" < now() - interval '7 days'`;
  print('passwordReset_staleCount', jsonSafe(staleCodes).map(x => ({ stale: x.stale })), { flag: false });

  const out = process.argv[2] || `reports/db-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('\\nREPORT ' + out);
}

main().catch((e) => { console.error('DIAGNOSTIC_FAILED', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
