// READ-ONLY audit of void/integrity invariants in the live database.
// Usage: node --env-file=.env scripts/db-audit-void.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// (a) pending void requests whose transaction is ALREADY voided (stale queue rows)
// (b) voided transactions with no actor/time recorded (voidedBy/voidedAt null)
// (c) more than one pending request for the same transaction
// (d) terminal-status requests missing review metadata (reviewedBy/reviewedAt)
const txs = await prisma.transaction.findMany({
  where: { OR: [{ status: 'voided' }, { voidRequests: { some: {} } }] },
  select: {
    id: true, status: true, total: true, createdAt: true,
    voidedBy: true, voidedAt: true, voidReason: true,
    voidRequests: {
      select: {
        id: true, status: true, reason: true, requestedBy: true, requestedAt: true,
        reviewedBy: true, reviewedAt: true, reviewNote: true,
      },
      orderBy: { id: 'asc' },
    },
  },
  orderBy: { id: 'desc' },
});

const stalePending = [];
const awaitingQueue = [];
const multiPending = [];
const missingReviewMeta = [];
const byTx = new Map();

for (const t of txs) {
  const pendings = t.voidRequests.filter((r) => r.status === 'pending');
  if (t.status === 'voided') {
    for (const r of pendings) stalePending.push({ tx: t.id, req: r.id, txVoided: true });
    for (const r of t.voidRequests) {
      if (r.status === 'approved' && (r.reviewedBy == null || r.reviewedAt == null)) {
        missingReviewMeta.push({ tx: t.id, req: r.id, status: r.status });
      }
    }
  } else if (pendings.length > 0) {
    awaitingQueue.push({ tx: t.id, status: t.status, total: t.total, requests: pendings.map((r) => r.id) });
  }
  if (pendings.length > 1) multiPending.push({ tx: t.id, count: pendings.length });

  if (t.status === 'voided' && (t.voidedBy == null || t.voidedAt == null)) {
    byTx.set(t.id, {
      id: t.id, total: t.total, createdAt: t.createdAt,
      voidedBy: t.voidedBy, voidedAt: t.voidedAt, reason: t.voidReason,
      requests: t.voidRequests,
    });
  }
}

const unverifiedVoid = [...byTx.values()];
const voidedCount = txs.filter((t) => t.status === 'voided').length;

console.log(`voided transactions          : ${voidedCount}`);
console.log(`(a) stale pending on voided txs : ${stalePending.length}`, stalePending.slice(0, 20));
console.log(`(b) unverified voids (no actor) : ${unverifiedVoid.length}`);
if (unverifiedVoid.length > 0) console.log(JSON.stringify(unverifiedVoid, null, 2));
console.log(`(c) duplicate pending per tx    : ${multiPending.length}`, multiPending.slice(0, 20));
console.log(`(d) approved w/o review meta    : ${missingReviewMeta.length}`, missingReviewMeta.slice(0, 20));
console.log(`live pending queue (open txs)   : ${awaitingQueue.length}`);

// Test products left over from the stock-reconciliation turn (condidates for
// archiving if still present).
const testProducts = await prisma.product.findMany({
  where: { name: { in: ['ddad', 'shin', 'buwad'] } },
  select: { id: true, name: true, stock: true, archived: true, updatedAt: true },
});
console.log(`test products present          : ${testProducts.length}`);
console.log(JSON.stringify(testProducts, null, 2));

await prisma.$disconnect();