import { prisma } from '@/lib/server/prisma';

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
    if (transaction.status === 'voided') return transaction;

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

    for (const item of transaction.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });

      await tx.itemLog.create({
        data: {
          productId: item.productId,
          action: 'voided',
          quantity: item.quantity,
          performedBy: voidedByUserId,
        },
      });
    }

    return tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'voided',
        voidReason: reason,
        voidedBy: voidedByUserId,
        voidedAt: new Date(),
      },
    });
  }, {
    maxWait: 15000,
    timeout: 25000,
  });
}
