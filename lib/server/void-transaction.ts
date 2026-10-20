import { prisma } from '@/lib/server/prisma';
import { restoreFifoStock } from '@/lib/server/fifo';

// Shared implementation for executing a void: online void API, approval API,
// and sync engine all funnel through here so stock-restore/audit can't drift.
export async function executeVoidTransaction(
  transactionId: number,
  reason: string,
  voidedByUserId: number
) {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { items: true },
    });

    if (!transaction) throw new Error('Transaction not found');
    // Sequential replay shortcut; the guarded update below is the race gate.
    if (transaction.status === 'voided') return transaction;

    // Status gate FIRST: the guarded update is the sole writer of
    // status='voided', so a direct void racing an approval (or two approvers)
    // can never both restore stock. Gate before the credit guard so a losing
    // void holds no row locks while it waits.
    const gate = await tx.transaction.updateMany({
      where: { id: transactionId, status: 'complete' },
      data: {
        status: 'voided',
        voidReason: reason,
        voidedBy: voidedByUserId,
        voidedAt: new Date(),
      },
    });
    if (gate.count !== 1) throw new Error('Transaction already voided');

    // Credit-sale void: reverse the linked utang entry to keep the ledger consistent.
    if (transaction.paymentMethod === 'credit' && transaction.clientUuid?.startsWith('utang-')) {
      const entryUuid = transaction.clientUuid.slice('utang-'.length);
      const linked = await tx.utangEntry.findUnique({
        where: { clientUuid: entryUuid },
        include: { paymentAllocations: true, items: true },
      });
      if (linked) {
        if (linked.paymentAllocations.length > 0 || linked.amountPaid > 0) {
          throw new Error('Cannot void: payments have been recorded against this credit sale. Reverse the payments first.');
        }
        await tx.utangEntryItem.deleteMany({ where: { utangEntryId: linked.id } });
        await tx.utangEntry.delete({ where: { id: linked.id } });
      }
    }

    // Batch-priced sales may carry several item rows for the SAME product (one
    // per consumed FIFO layer). Restore per PRODUCT so the stock increment and
    // newest-first restore match voiding the same units as a single row, and
    // the audit log stays one line per product.
    const quantitiesByProduct = new Map<number, number>();
    for (const item of transaction.items) {
      quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity);
    }

    for (const [productId, quantity] of quantitiesByProduct) {
      await tx.product.update({
        where: { id: productId },
        data: { stock: { increment: quantity } },
      });

      // Reverse of FIFO consumption: restore the newest layers first.
      await restoreFifoStock(tx, productId, quantity);

      await tx.itemLog.create({
        data: {
          productId,
          action: 'voided',
          quantity,
          performedBy: voidedByUserId,
        },
      });
    }

    // Reflect the gated write (status/reason/voidedBy/voidedAt) with the
    // restored stock already applied in this same transaction.
    return tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  }, {
    maxWait: 15000,
    timeout: 25000,
  });
}
