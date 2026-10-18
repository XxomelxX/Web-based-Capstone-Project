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
}

async function getBatchesOldestFirst(tx: Tx, productId: number): Promise<BatchRow[]> {
  return tx.stockBatch.findMany({
    where: { productId },
    select: { id: true, quantityRemaining: true },
    orderBy: [{ dateReceived: 'asc' }, { id: 'asc' }],
  });
}

async function ensureOpeningBatch(tx: Tx, product: { id: number; stock: number; cost: number }): Promise<void> {
  const count = await tx.stockBatch.count({ where: { productId: product.id } });
  if (count > 0 || product.stock <= 0) return;
  await tx.stockBatch.create({
    data: {
      productId: product.id,
      quantityReceived: product.stock,
      quantityRemaining: product.stock,
      supplier: 'Opening stock',
      costPerUnit: product.cost,
    },
  });
}

/**
 * Consume `quantity` units of a product, oldest batches first.
 * Assumes the caller already validated product.stock >= quantity inside the
 * same transaction. Any leftover drift (batches sum < quantity, e.g. legacy
 * data) is clamped instead of failing — the sale must never be blocked by
 * a bookkeeping mismatch.
 *
 * Pass `knownProduct` when the caller already fetched the product and
 * guaranteed an opening batch exists (e.g. adjustFifoStock) — skips a
 * redundant findUnique + batch count round trip inside the transaction.
 */
export async function consumeFifoStock(
  tx: Tx,
  productId: number,
  quantity: number,
  knownProduct?: { id: number; stock: number; cost: number }
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) return;
  const product = knownProduct ?? (await tx.product.findUnique({ where: { id: productId } }));
  if (!product) throw new Error(`Product #${productId} not found`);
  if (!knownProduct) await ensureOpeningBatch(tx, product);
  let remaining = quantity;
  const batches = await getBatchesOldestFirst(tx, productId);
  for (const batch of batches) {
    if (remaining <= 0) break;
    if (batch.quantityRemaining <= 0) continue;
    const take = Math.min(batch.quantityRemaining, remaining);
    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { quantityRemaining: { decrement: take } },
    });
    remaining -= take;
  }
  // Drift clamp: if batch totals fall short of the sale (legacy data), zero
  // every layer out instead of rolling back a completed sale.
  if (remaining > 0) {
    await tx.stockBatch.updateMany({
      where: { productId, quantityRemaining: { gt: 0 } },
      data: { quantityRemaining: 0 },
    });
  }
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
  product: { id: number; stock: number; cost: number },
  newStock: number,
  label = 'Adjustment (recount)'
): Promise<number> {
  const delta = newStock - product.stock;
  if (delta === 0) return 0;
  if (delta > 0) {
    await tx.stockBatch.create({
      data: {
        productId: product.id,
        quantityReceived: delta,
        quantityRemaining: delta,
        supplier: label,
        costPerUnit: product.cost,
      },
    });
  } else {
    await ensureOpeningBatch(tx, product);
    // Product is known and the opening batch was just ensured — skip the
    // redundant re-fetch inside consume (keeps the tx short; see #timeout).
    await consumeFifoStock(tx, product.id, -delta, product);
  }
  await tx.product.update({ where: { id: product.id }, data: { stock: newStock } });
  return delta;
}
