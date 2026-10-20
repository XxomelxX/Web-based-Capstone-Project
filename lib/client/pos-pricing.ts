import type { Product } from '@/lib/client/api/products';
import type { FifoBatch } from '@/lib/client/api/inventory';

/**
 * `activeLayerPrice` is a server-computed contract field that may land after
 * this module (the parallel server lane). Declaring it here as an optional
 * intersection keeps the POS client compiling standalone; at runtime a missing
 * value simply falls back to `product.price`.
 */
export type PriceableProduct = Product & {
  activeLayerPrice?: number | null;
  activeLayerCost?: number | null;
};

/** A FIFO batch row plus the batch-pricing contract field. */
export type FifoBatchWithPrice = FifoBatch & {
  pricePerUnit?: number | null;
};

/** One segment of a line charged at a single unit price (integer centavos). */
export interface BatchSlice {
  quantity: number;
  unitPrice: number;
}

/**
 * What the shelf will charge for the next unit: the active layer's price when
 * the server reports one, otherwise the product's base price.
 */
export function effectivePrice(product: PriceableProduct): number {
  return product.activeLayerPrice ?? product.price;
}

/**
 * Split `quantity` units across FIFO batches, oldest first. The API already
 * returns batches ordered [{ dateReceived asc }, { id asc }] — never re-sort.
 *
 * - Missing/null `pricePerUnit` on a batch → `product.price` (stale cache
 *   rows predate the batch-pricing field; server charges the same fallback).
 * - Units beyond the supplied batches → one estimate slice at effectivePrice.
 * - `batches === null` → the caller has no layer data; a single estimate slice.
 *
 * All math is integer: quantities × centavos, never floats.
 */
export function sliceLine(
  quantity: number,
  batches: FifoBatchWithPrice[] | null,
  product: PriceableProduct
): BatchSlice[] {
  const wanted = Math.max(0, Math.trunc(quantity));
  if (wanted === 0) return [];

  if (batches === null) {
    return [{ quantity: wanted, unitPrice: effectivePrice(product) }];
  }

  const slices: BatchSlice[] = [];
  let remaining = wanted;

  for (const batch of batches) {
    if (remaining === 0) break;
    const available = Math.max(0, Math.trunc(batch.quantityRemaining ?? 0));
    if (available === 0) continue;

    const take = Math.min(remaining, available);
    slices.push({
      quantity: take,
      unitPrice:
        typeof batch.pricePerUnit === 'number'
          ? batch.pricePerUnit
          : product.price,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    slices.push({ quantity: remaining, unitPrice: effectivePrice(product) });
  }

  return slices;
}

/**
 * Coalesce CONSECUTIVE slices that share a unit price so the cart shows one
 * compact segment per contiguous price run. Copies its input.
 */
export function mergeSlices(slices: BatchSlice[]): BatchSlice[] {
  const merged: BatchSlice[] = [];
  for (const slice of slices) {
    if (slice.quantity <= 0) continue;
    const last = merged[merged.length - 1];
    if (last && last.unitPrice === slice.unitPrice) {
      last.quantity += slice.quantity;
    } else {
      merged.push({ ...slice });
    }
  }
  return merged;
}

/** The minimal cart-line shape needed for a price preview. */
export interface CartLinePricingInput {
  product: PriceableProduct;
  quantity: number;
  /** Effective unit price snapshotted on the line's first add (centavos). */
  lockedPrice?: number | null;
}

/** productId → freshly fetched batches (missing entry = estimate mode). */
export type CartBatchMap = ReadonlyMap<number, FifoBatchWithPrice[]>;

/**
 * Slices used for BOTH the rendered line and the cart total.
 *
 * With fresh batch data: exact per-unit FIFO split (merged by price run).
 * Without it: a single estimate at the current active layer, then the price
 * locked at first add, then the base price.
 */
export function previewSlices(
  line: CartLinePricingInput,
  batchMap: CartBatchMap
): BatchSlice[] {
  const batches = batchMap.get(line.product.id);
  if (batches) {
    return mergeSlices(sliceLine(line.quantity, batches, line.product));
  }

  const quantity = Math.max(0, Math.trunc(line.quantity));
  if (quantity === 0) return [];
  return [
    {
      quantity,
      unitPrice:
        line.product.activeLayerPrice ??
        line.lockedPrice ??
        line.product.price,
    },
  ];
}

/**
 * Exact-ish line charge (integer centavos). Single source of truth for the
 * cart row total, the cart grand total, and the payment parity notice.
 */
export function lineTotalOf(
  line: CartLinePricingInput,
  batchMap: CartBatchMap
): number {
  return previewSlices(line, batchMap).reduce(
    (sum, slice) => sum + slice.quantity * slice.unitPrice,
    0
  );
}
