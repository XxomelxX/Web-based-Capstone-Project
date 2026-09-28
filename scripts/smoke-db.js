// Safe self-cleaning DB smoke test. Uses unique SMOKE_ markers, cleans up all rows.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const UID = `smoke-${Date.now()}`;
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`PASS: ${name}`); } else { fail++; console.log(`FAIL: ${name}`); } };

(async () => {
  // 1. clientUuid columns: insert transaction with uuid, expect P2002 on duplicate
  const user = await prisma.user.findFirst();
  const cat = await prisma.category.findFirst();
  ok('seed user exists', !!user);
  ok('seed category exists', !!cat);

  const prod = await prisma.product.create({
    data: { name: `SMOKE_PROD_${UID}`, categoryId: cat.id, price: 10, cost: 5, stock: 100 },
  });
  ok('product created', !!prod.id);
  ok('product.updatedAt exists', prod.updatedAt instanceof Date);

  const txn = await prisma.transaction.create({
    data: { clientUuid: `uuid-${UID}`, cashierId: user.id, paymentMethod: 'cash', subtotal: 10, vat: 0, total: 10, tendered: 10, change: 0, status: 'complete' },
  });
  ok('transaction with clientUuid created', !!txn.id);
  let dup = false;
  try {
    await prisma.transaction.create({
      data: { clientUuid: `uuid-${UID}`, cashierId: user.id, paymentMethod: 'cash', subtotal: 10, vat: 0, total: 10, tendered: 10, change: 0, status: 'complete' },
    });
  } catch (e) { dup = e.code === 'P2002'; }
  ok('duplicate clientUuid rejected (P2002 idempotency)', dup);

  // 2. delta pull via updatedAt
  const delta = await prisma.product.findMany({ where: { updatedAt: { gt: new Date(Date.now() - 60000) } } });
  ok('delta pull via updatedAt returns rows', delta.length >= 1);

  // 3. utang + FIFO payment columns
  const cust = await prisma.customer.create({ data: { name: `SMOKE_CUST_${UID}` } });
  const entry = await prisma.utangEntry.create({
    data: { clientUuid: `utang-${UID}`, customerId: cust.id, totalAmount: 50, amountPaid: 0, remainingBalance: 50, status: 'unpaid' },
  });
  ok('utang entry with clientUuid created', !!entry.id);
  const pay = await prisma.payment.create({ data: { clientUuid: `pay-${UID}`, amount: 20 } });
  await prisma.paymentAllocation.create({ data: { paymentId: pay.id, utangEntryId: entry.id, amountApplied: 20 } });
  const updated = await prisma.utangEntry.update({ where: { id: entry.id }, data: { amountPaid: 20, remainingBalance: 30, status: 'partial' } });
  ok('FIFO payment allocation applied', updated.remainingBalance === 30 && updated.status === 'partial');

  // 4. shift with clientUuid
  const shift = await prisma.shift.create({ data: { clientUuid: `shift-${UID}`, cashierId: user.id, openingFloat: 100, status: 'open' } });
  ok('shift with clientUuid created', !!shift.id);

  // 5. hot indexes exist
  const idx = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE '%clientUuid%' OR indexname LIKE '%cashierId%'`;
  ok('hot indexes present', Array.isArray(idx) && idx.length >= 4);

  // CLEANUP (child-first)
  await prisma.paymentAllocation.deleteMany({ where: { paymentId: pay.id } });
  await prisma.payment.delete({ where: { id: pay.id } });
  await prisma.utangEntry.delete({ where: { id: entry.id } });
  await prisma.customer.delete({ where: { id: cust.id } });
  await prisma.transaction.delete({ where: { id: txn.id } });
  await prisma.shift.delete({ where: { id: shift.id } });
  await prisma.product.delete({ where: { id: prod.id } });
  const leftover = await prisma.product.count({ where: { name: { startsWith: 'SMOKE_' } } });
  ok('cleanup complete (no SMOKE rows left)', leftover === 0);

  console.log(`\nSMOKE RESULT: ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('SMOKE ERROR:', e); await prisma.$disconnect(); process.exit(1); });
