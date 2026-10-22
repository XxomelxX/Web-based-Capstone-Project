// Shared FIFO stock accounting. Every stock movement (POS sale, utang sale,
// restock, recount adjustment, void restore) must funnel through these helpers
// so Product.stock always equals the sum of StockBatch.quantityRemaining.
//
// Conventions:
// - Sales consume the OLDEST batches first (true FIFO).
// - Voids restore stock to the NEWEST batch (exact reverse of FIFO consumption,
//   so "sell + immediately void" nets to zero per layer).
// - Products with no batches (legacy/seeded stock) get a synthetic opening
//   batch created on first consumption, so batch totals self-heal.
import type { PrismaClient } from '@prisma/client';

// A bare transaction client covers both PrismaClient and the `$transaction`
// callback client without pulling the generated tx type.
type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

interface BatchRow {
  id: number;
  quantityRemaining: number;
  costPerUnit: number | null;
  pricePerUnit: number | null;
}

/** One priced slice of a FIFO consumption. */
export interface ConsumeSlice {
  /** Source batch; null for the drift-clamp slice (units charged with no batch row). */
  batchId: number | null;
  quantity: number;
  /** Effective selling price charged for this slice's units, centavos. */
  unitPrice: number;
  costPerUnit: number | null;
}

/** ACTIVE (oldest non-empty) FIFO layer info for a product. */
export interface ActiveLayerInfo {
  costPerUnit: number | null;
  /** Raw batch pricePerUnit; null means "fall back to product.price". */
  pricePerUnit: number | null;
}

interface ProductForFifo {
  id: number;
  stock: number;
  cost: number;
  price: number;
}

async function getBatchesOldestFirst(tx: Tx, productId: number): Promise<BatchRow[]> {
  return tx.stockBatch.findMany({
    where: { productId },
    select: { id: true, quantityRemaining: true, costPerUnit: true, pricePerUnit: true },
    orderBy: [{ dateReceived: 'asc' }, { id: 'asc' }],
  });
}

async function ensureOpeningBatch(tx: Tx, product: ProductForFifo): Promise<void> {
  const count = await tx.stockBatch.count({ where: { productId: product.id } });
  if (count > 0 || product.stock <= 0) return;
  await tx.stockBatch.create({
    data: {
      productId: product.id,
      quantityReceived: product.stock,
      quantityRemaining: product.stock,
      supplier: 'Opening stock',
      costPerUnit: product.cost,
      pricePerUnit: product.price,
    },
  });
}

/**
 * Active-layer info for each product — the oldest batch still holding stock,
 * i.e. the layer current sales consume, in ONE query. Missing key means "no
 * active layer" (stock fully depleted). pricePerUnit is the RAW batch field
 * (null = sell at product.price); costPerUnit follows the existing contract.
 */
export async function getActiveLayerInfo(
  tx: Tx,
  productIds: number[]
): Promise<Map<number, ActiveLayerInfo>> {
  const map = new Map<number, ActiveLayerInfo>();
  if (productIds.length === 0) return map;
  // Non-empty layers only — naturally small (a depleted product has none,
  // so no take-limit needed and ordering makes the first hit per product
  // the oldest remaining batch).
  const batches = await tx.stockBatch.findMany({
    where: { productId: { in: productIds }, quantityRemaining: { gt: 0 } },
    select: { productId: true, costPerUnit: true, pricePerUnit: true },
    orderBy: [{ dateReceived: 'asc' }, { id: 'asc' }],
  });
  for (const batch of batches) {
    if (map.has(batch.productId)) continue;
    map.set(batch.productId, { costPerUnit: batch.costPerUnit, pricePerUnit: batch.pricePerUnit });
  }
  return map;
}

/**
 * Cost-per-unit of each product's ACTIVE FIFO layer. Kept as the legacy
 * Contract-1 payload helper; delegates to the shared active-layer query.
 * Missing key or costPerUnit means "no active layer"; callers hide it.
 */
export async function getActiveLayerCosts(
  tx: Tx,
  productIds: number[]
): Promise<Map<number, number | null>> {
  const info = await getActiveLayerInfo(tx, productIds);
  const map = new Map<number, number | null>();
  for (const [productId, layer] of info) map.set(productId, layer.costPerUnit);
  return map;
}

/**
 * Consume `quantity` units of a product, oldest batches first, and return the
 * priced slices that were consumed. Each unit is charged its own layer's
 * selling price (`batch.pricePerUnit ?? product.price`), so a sale spanning
 * two layers yields two slices with different unit prices.
 *
 * Assumes the caller already validated product.stock >= quantity inside the
 * same transaction. Any leftover drift (batches sum < quantity, e.g. legacy
 * data) is clamped instead of failing — the sale must never be blocked by
 * a bookkeeping mismatch. The clamped units are returned as a final slice
 * with batchId null, charged at product.price.
 *
 * Pass `knownProduct` when the caller already fetched the product and
 * guaranteed an opening batch exists (e.g. adjustFifoStock) — skips a
 * redundant findUnique + batch count round trip inside the transaction.
 */
export async function consumeFifoStock(
  tx: Tx,
  productId: number,
  quantity: number,
  knownProduct?: ProductForFifo
): Promise<ConsumeSlice[]> {
  if (!Number.isInteger(quantity) || quantity <= 0) return [];
  const product = knownProduct ?? (await tx.product.findUnique({ where: { id: productId } }));
  if (!product) throw new Error(`Product #${productId} not found`);
  if (!knownProduct) await ensureOpeningBatch(tx, product);
  const slices: ConsumeSlice[] = [];
  let remaining = quantity;
  const batches = await getBatchesOldestFirst(tx, productId);
  for (const batch of batches) {
    if (remaining <= 0) break;
    if (batch.quantityRemaining <= 0) continue;
    // Guarded take: the snapshot can be stale if another transaction consumed
    // or restored this layer between findMany and the write (two cashiers
    // selling the same product concurrently). The conditional update is
    // evaluated under the row lock, so quantityRemaining can never go
    // negative; on a lost race re-read the batch and retake from its true
    // remaining (restore increments can also make it larger — still capped
    // by `remaining`).
    let take = Math.min(batch.quantityRemaining, remaining);
    let applied = false;
    for (let attempt = 0; attempt < 3 && !applied; attempt++) {
      const res = await tx.stockBatch.updateMany({
        where: { id: batch.id, quantityRemaining: { gte: take } },
        data: { quantityRemaining: { decrement: take } },
      });
      if (res.count === 1) {
        applied = true;
        break;
      }
      const fresh = await tx.stockBatch.findUnique({
        where: { id: batch.id },
        select: { quantityRemaining: true },
      });
      if (!fresh || fresh.quantityRemaining <= 0) {
        take = 0;
        break;
      }
      take = Math.min(fresh.quantityRemaining, remaining);
    }
    // After 3 lost races treat the layer as unavailable; leftover units flow
    // to the next batch and, worst case, the drift slice below keeps the
    // books consistent (same policy as before — a sale is never blocked).
    if (!applied || take <= 0) continue;
    // NOTE: the guarded updateMany above ALREADY decremented this layer by
    // `take` (that IS the write - it is evaluated under the row lock, so
    // quantityRemaining can never go negative). Do not decrement again here:
    // a second unguarded update took the layer negative and Postgres rejected
    // the whole sale with
    // "new row for relation StockBatch violates check constraint
    //  stockbatch_remaining_non_negative" (e.g. a 34-unit layer selling 32
    // ended at 34 - 32 - 32 = -30).
    slices.push({
      batchId: batch.id,
      quantity: take,
      unitPrice: batch.pricePerUnit ?? product.price,
      costPerUnit: batch.costPerUnit,
    });
    remaining -= take;
  }
    // Drift slice: the layers could not cover the sale (legacy data, layers
    // missing, or a layer lost to a concurrent sale). The leftover units are
    // still charged - at the product's current price - and reported as a slice
    // without a source batch row.
    //
    // The layers are deliberately NOT zeroed here: whatever is left in them is
    // real stock, and zeroing it would destroy units (including a layer a
    // concurrent restock just topped up). Product.stock stays the source of
    // truth; scripts/db-reconcile-stock.mjs re-aligns the layers with it.
    if (remaining > 0) {
    slices.push({
      batchId: null,
      quantity: remaining,
      unitPrice: product.price,
      costPerUnit: product.cost,
    });
  }
  return slices;
}

/**
 * Return `quantity` units to a product: newest batch first (reverse of FIFO),
 * with leftover spillover appended to the newest batch (or a correction batch
 * when none exists).
 */
export async function restoreFifoStock(tx: Tx, productId: number, quantity: number): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) return;
  let remaining = quantity;
  const batches = await tx.stockBatch.findMany({
    where: { productId },
    select: { id: true, quantityRemaining: true, quantityReceived: true },
    orderBy: [{ dateReceived: 'desc' }, { id: 'desc' }],
  });
  for (const batch of batches) {
    if (remaining <= 0) break;
    const headroom = batch.quantityReceived - batch.quantityRemaining;
    if (headroom <= 0) continue;
    const give = Math.min(headroom, remaining);
    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { quantityRemaining: { increment: give } },
    });
    remaining -= give;
  }
  if (remaining > 0) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    await tx.stockBatch.create({
      data: {
        productId,
        quantityReceived: remaining,
        quantityRemaining: remaining,
        supplier: 'Correction (void restore overflow)',
        costPerUnit: product?.cost ?? null,
        pricePerUnit: product?.price ?? null,
      },
    });
  }
}

/**
 * Set a product's stock to an exact counted value (stock recount / adjustment).
 * Positive deltas add an "Adjustment" layer; negative deltas consume FIFO.
 * Returns the signed delta applied (newStock - oldStock).
 * `label` becomes the FIFO layer's supplier, e.g. "Adjustment (breakage)".
 */
export async function adjustFifoStock(
  tx: Tx,
  product: ProductForFifo,
  newStock: number,
  label = 'Adjustment (recount)'
): Promise<number> {
  // The caller's `product` snapshot can be stale by the time this runs (a
  // concurrent sale/restock may have moved stock between the route's read and
  // this transaction): recompute the delta against the committed value INSIDE
  // the transaction — otherwise the recount silently clobbers that movement
  // and Product.stock drifts from the batch sums.
  const current = await tx.product.findUnique({
    where: { id: product.id },
    select: { id: true, stock: true, cost: true, price: true },
  });
  if (!current) throw new Error(`Product #${product.id} not found`);
  const delta = newStock - current.stock;
  if (delta === 0) return 0;
  if (delta > 0) {
    await tx.stockBatch.create({
      data: {
        productId: product.id,
        quantityReceived: delta,
        quantityRemaining: delta,
        supplier: label,
        costPerUnit: current.cost,
        pricePerUnit: current.price,
      },
    });
  } else {
    await ensureOpeningBatch(tx, current);
    // Product is known and the opening batch was just ensured — skip the
    // redundant re-fetch inside consume (keeps the tx short; see #timeout).
    await consumeFifoStock(tx, product.id, -delta, current);
  }
  // Guarded stock write: only lands if stock is still exactly what the batch
  // ops above were reconciled against. A concurrent movement that slipped in
  // writes 0 rows here → throw so the WHOLE transaction (batch ops included)
  // rolls back instead of committing Product.stock out of sync with batches.
  const setStock = await tx.product.updateMany({
    where: { id: product.id, stock: current.stock },
    data: { stock: newStock },
  });
  if (setStock.count !== 1) {
    throw new Error(
      `Stock changed during the adjustment for #${product.id} (${current.stock} at read time) — please retry`
    );
  }
  return delta;
}
