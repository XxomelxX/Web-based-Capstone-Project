// RECONCILE StockBatch layers to Product.stock (stock = source of truth):
//   legacy (0 layers, stock > 0) -> synthetic opening batch
//   drift delta > 0  -> labeled correction batch (+)
//   drift delta < 0  -> decrement newest layers, never below 0
//   stock < 0        -> corrected to layer_sum (shelf counts cannot be negative)
// Convention mirrors lib/server/fifo.ts (ensureOpeningBatch + drift clamp).
// Production-safe: full before-state backup JSON -> chunked transactions
// (10 products each; each tx re-derives drift FRESH so concurrent sales
// between chunks never corrupt the plan) -> per-tx re-verify -> retry on
// transaction expiry -> no deletions, no history rewrites (only
// quantityRemaining moves; existing quantityReceived/cost stay untouched).
// Idempotent by construction: re-running only picks up the remaining drift.
// Usage: node --env-file=.env scripts/db-reconcile-stock.mjs [--dry-run]
const DRY = process.argv.includes('--dry-run');

import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'node:fs';

const prisma = new PrismaClient({ log: ['error'] });
const CHUNK = 10;
const LABEL_LEGACY = 'Opening stock (backfill 2026-10-18)';
const LABEL_CORRECT = 'Correction (reconcile 2026-10-18';

function jsonSafe(v) { return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? Number(x) : x))); }

// Drift rows for a specific set of ids (fresh data, safe inside tx).
async function driftFor(tx, ids) {
  return tx.$queryRaw`
    SELECT p.id, p.name, p.stock, p.archived, p.cost, p.price,
           COALESCE(SUM(sb."quantityRemaining"), 0) AS batch_sum,
           COUNT(sb.id) AS batch_count
    FROM "Product" p
    LEFT JOIN "StockBatch" sb ON sb."productId" = p.id
    WHERE p.id IN (${Prisma.join(ids)})
    GROUP BY p.id
    HAVING p.stock <> COALESCE(SUM(sb."quantityRemaining"), 0) OR p.stock < 0
    ORDER BY p.id`;
}

// Apply one drifted row with FRESH values inside the given tx.
async function applyOne(tx, row, changes) {
  if (row.stock < 0) {
    await tx.product.update({ where: { id: row.id }, data: { stock: Number(row.batch_sum) } });
    changes.negativeStockFixed.push({ id: row.id, name: row.name, from: row.stock, to: Number(row.batch_sum) });
    return true;
  }
  if (Number(row.batch_count) === 0) {
    await tx.stockBatch.create({
      data: {
        productId: row.id, quantityReceived: row.stock, quantityRemaining: row.stock,
        supplier: LABEL_LEGACY, costPerUnit: row.cost, pricePerUnit: row.price,
      },
    });
    changes.openingBatchesCreated.push({ id: row.id, name: row.name, units: row.stock });
    return true;
  }
  const delta = Number(row.stock) - Number(row.batch_sum);
  if (delta === 0) return false;
  if (delta > 0) {
    await tx.stockBatch.create({
      data: {
        productId: row.id, quantityReceived: delta, quantityRemaining: delta,
        supplier: `${LABEL_CORRECT}, +${delta})`, costPerUnit: row.cost, pricePerUnit: row.price,
      },
    });
    changes.correctionBatchesCreated.push({ id: row.id, name: row.name, units: delta });
    return true;
  }
  // delta < 0: reduce newest positive layers first, capped at 0.
  let need = -delta;
  const batches = await tx.stockBatch.findMany({
    where: { productId: row.id, quantityRemaining: { gt: 0 } },
    select: { id: true, quantityRemaining: true },
    orderBy: [{ dateReceived: 'desc' }, { id: 'desc' }],
  });
  for (const b of batches) {
    if (need <= 0) break;
    const take = Math.min(b.quantityRemaining, need);
    await tx.stockBatch.update({ where: { id: b.id }, data: { quantityRemaining: { decrement: take } } });
    need -= take;
    changes.batchesReduced.push({ productId: row.id, batchId: b.id, reducedBy: take });
  }
  if (need > 0) throw new Error(`Reduce shortfall on product #${row.id} (${row.name}) — aborting chunk`);
  return true;
}

async function processChunk(ids, changes) {
  await prisma.$transaction(async (tx) => {
    const rows = await driftFor(tx, ids);
    for (const row of rows) await applyOne(tx, row, changes);
    const still = await driftFor(tx, ids);
    if (still.length > 0) throw new Error(`Post-verify failed for ids ${JSON.stringify(still)}`);
  }, { maxWait: 15000, timeout: 30000 });
}

async function main() {
  const flaggedAll = jsonSafe(await driftFor(prisma, (await prisma.product.findMany({ select: { id: true } }).then(ps => ps.map(p => p.id)))));
  const dir = { createOpeningBatch: 0, addCorrectionLayer: 0, reduceNewestLayers: 0, correctNegativeStock: 0 };
  for (const r of flaggedAll) {
    if (r.stock < 0) dir.correctNegativeStock++;
    else if (Number(r.batch_count) === 0) dir.createOpeningBatch++;
    else if (Number(r.stock) - Number(r.batch_sum) > 0) dir.addCorrectionLayer++;
    else dir.reduceNewestLayers++;
  }
  console.log(`flagged=${flaggedAll.length}`, JSON.stringify(dir));
  if (DRY) { flaggedAll.forEach(r => console.log(JSON.stringify(r))); return; }
  if (flaggedAll.length === 0) { console.log('Nothing to do.'); return; }

  // ---- BACKUP: full before-state of affected products + batch rows
  const ids = flaggedAll.map(p => p.id);
  const beforeProducts = await prisma.product.findMany({ where: { id: { in: ids } } });
  const beforeBatches = await prisma.stockBatch.findMany({ where: { productId: { in: ids } }, orderBy: [{ dateReceived: 'desc' }, { id: 'desc' }] });
  const backupPath = `reports/db-backup-stock-reconcile-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(jsonSafe({ ranAt: new Date().toISOString(), plan: flaggedAll, beforeProducts, beforeBatches }), null, 2));
  console.log('BACKUP ' + backupPath);

  const changes = { openingBatchesCreated: [], correctionBatchesCreated: [], batchesReduced: [], negativeStockFixed: [] };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunkIds = ids.slice(i, i + CHUNK);
    let attempt = 0;
    for (;;) {
      try { await processChunk(chunkIds, changes); break; }
      catch (e) {
        attempt++;
        const expired = typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2028';
        if (attempt > 2 || !expired) throw e;
        console.log(`chunk ${chunkIds[0]}..#${chunkIds[chunkIds.length - 1]} expired, retry ${attempt}/2 (fresh state re-derived)`);
      }
    }
    console.log(`chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(ids.length / CHUNK)} ok`);
  }

  // ---- final full verification (chunks are atomic; remaining rows report only)
  const remaining = jsonSafe(await driftFor(prisma, ids));
  const logPath = `reports/db-reconcile-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  fs.writeFileSync(logPath, JSON.stringify(jsonSafe({ changes, remaining }), null, 2));
  console.log('DONE ' +
    `openingBatches=${changes.openingBatchesCreated.length} ` +
    `correctionLayers=${changes.correctionBatchesCreated.length} ` +
    `batchesReduced=${changes.batchesReduced.length} ` +
    `negativeStockFixed=${changes.negativeStockFixed.length} ` +
    `remainingDrift=${remaining.length}`);
  console.log('LOG ' + logPath);
  if (changes.negativeStockFixed.length) console.log('NOTE negative stocks fixed:', JSON.stringify(changes.negativeStockFixed));
}

main().catch((e) => { console.error('RECONCILE_FAILED (failed chunk rolled back, re-run safe):', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
