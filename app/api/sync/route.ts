import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { batchSyncSchema } from '@/lib/client/validation';

// POST /api/sync — batch push of Category-1 offline actions.
// Each action carries a permanent clientUuid (stamped at queue time).
// Idempotent: replays return the original row. Server-wins on conflicts.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const parsed = batchSyncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const cashierId = Number(session.user.id);
  const results: { clientUuid: string; ok: boolean; serverId?: number; conflict?: boolean; error?: string }[] = [];

  for (const action of parsed.data.actions) {
    const p = action.payload;
    try {
      if (action.type === 'pos_sale') {
        const items = p.items ?? [];
        if (!items.length) throw new Error('Empty sale');
        const existing = await prisma.transaction.findUnique({ where: { clientUuid: action.clientUuid } });
        if (existing) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
          continue;
        }
        const paymentMethod = p.paymentMethod ?? 'cash';
        let tendered = Number(p.tendered ?? 0);
        const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        if (paymentMethod === 'gcash' && tendered < subtotal) tendered = subtotal;
        if (tendered < subtotal) throw new Error('Insufficient tendered');

        const created = await prisma.$transaction(async (tx) => {
          const ids = items.map((i) => i.productId);
          const products = await tx.product.findMany({ where: { id: { in: ids } } });
          const map = new Map(products.map((x) => [x.id, x]));
          for (const item of items) {
            const prod = map.get(item.productId);
            if (!prod) throw new Error(`Product #${item.productId} not found`);
            if (prod.stock < item.quantity) throw new Error(`Insufficient stock for ${prod.name}`);
          }
          const txn = await tx.transaction.create({
            data: {
              clientUuid: action.clientUuid, cashierId,
              customerId: p.customerId ?? null,
              paymentMethod, subtotal, vat: 0, total: subtotal,
              tendered, change: Number((tendered - subtotal).toFixed(2)), status: 'complete',
            },
          });
          for (const item of items) {
            await tx.transactionItem.create({
              data: { transactionId: txn.id, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: Number((item.quantity * item.unitPrice).toFixed(2)) },
            });
            await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
            await tx.itemLog.create({ data: { productId: item.productId, action: 'sold', quantity: item.quantity, performedBy: cashierId } });
          }
          return txn;
        });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
      } else if (action.type === 'add_utang') {
        if (!p.customerName || !p.items?.length) throw new Error('customerName and items required');
        const existing = await prisma.utangEntry.findUnique({ where: { clientUuid: action.clientUuid } });
        if (existing) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
          continue;
        }
        const customerName = p.customerName.trim();
        const created = await prisma.$transaction(async (tx) => {
          let customer = await tx.customer.findFirst({
            where: { name: { equals: customerName, mode: 'insensitive' } },
          });
          if (!customer) customer = await tx.customer.create({ data: { name: customerName } });
          for (const item of p.items!) {
            const prod = await tx.product.findUnique({ where: { id: item.productId } });
            if (!prod) throw new Error(`Product #${item.productId} not found`);
            if (prod.stock < item.quantity) throw new Error(`Insufficient stock for ${prod.name}`);
          }
          const totalAmount = p.items!.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
          const entry = await tx.utangEntry.create({
            data: {
              clientUuid: action.clientUuid, customerId: customer.id,
              totalAmount, amountPaid: 0, remainingBalance: totalAmount,
              note: p.note ?? null, status: 'unpaid',
            },
          });
          for (const item of p.items!) {
            await tx.utangEntryItem.create({
              data: { utangEntryId: entry.id, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.quantity * item.unitPrice },
            });
            await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
            await tx.itemLog.create({ data: { productId: item.productId, action: 'sold', quantity: item.quantity, performedBy: cashierId } });
          }
          return entry;
        });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
      } else if (action.type === 'record_payment') {
        if (!p.customerName || !p.amount || p.amount <= 0) throw new Error('customerName and positive amount required');
        const existing = await prisma.payment.findUnique({ where: { clientUuid: action.clientUuid } });
        if (existing) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
          continue;
        }
        const customerName = p.customerName.trim();
        const customer = await prisma.customer.findFirst({
          where: { name: { equals: customerName, mode: 'insensitive' } },
          include: { utangEntries: { where: { status: { in: ['unpaid', 'partial'] } } } },
        });
        if (!customer) throw new Error('Customer not found');
        const serverBalance = customer.utangEntries.reduce((s, e) => s + e.remainingBalance, 0);
        if (serverBalance <= 0) throw new Error('Customer has no outstanding utang');
        // Server-wins conflict: balance moved while offline — still apply FIFO
        // to current server state, but flag it for review.
        const conflict = p.expectedBalance !== undefined && Math.abs(p.expectedBalance - serverBalance) > 0.009;
        const created = await prisma.$transaction(async (tx) => {
          const outstanding = await tx.utangEntry.findMany({
            where: { customerId: customer.id, status: { in: ['unpaid', 'partial'] } },
            orderBy: { createdAt: 'asc' },
          });
          const payment = await tx.payment.create({
            data: { clientUuid: action.clientUuid, amount: p.amount!, note: p.note ?? null },
          });
          let remaining = p.amount!;
          for (const entry of outstanding) {
            if (remaining <= 0) break;
            const apply = Math.min(remaining, entry.remainingBalance);
            await tx.utangEntry.update({
              where: { id: entry.id },
              data: {
                amountPaid: entry.amountPaid + apply,
                remainingBalance: entry.remainingBalance - apply,
                status: entry.remainingBalance - apply <= 0 ? 'paid' : 'partial',
              },
            });
            await tx.paymentAllocation.create({
              data: { paymentId: payment.id, utangEntryId: entry.id, amountApplied: apply },
            });
            remaining -= apply;
          }
          return payment;
        });
        results.push({
          clientUuid: action.clientUuid, ok: true, serverId: created.id,
          conflict: conflict || undefined,
          error: conflict ? 'Balance changed while offline — applied to current server state (server-wins)' : undefined,
        });
      } else if (action.type === 'open_shift') {
        const existing = await prisma.shift.findUnique({ where: { clientUuid: action.clientUuid } });
        if (existing) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
          continue;
        }
        const alreadyOpen = await prisma.shift.findFirst({
          where: { cashierId, status: 'open' }, orderBy: { openedAt: 'desc' },
        });
        if (alreadyOpen) {
          // Server-wins: an open shift already exists — keep it, absorb the offline one.
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: alreadyOpen.id, conflict: true, error: 'Shift already open on server (server-wins)' });
          continue;
        }
        const created = await prisma.shift.create({
          data: {
            clientUuid: action.clientUuid, cashierId,
            openingFloat: Number(p.openingFloat ?? 0),
            status: 'open', notes: p.notes ?? null,
          },
        });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
      } else if (action.type === 'close_shift') {
        const existing = await prisma.shift.findUnique({ where: { clientUuid: action.clientUuid } });
        if (existing) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
          continue;
        }
        const activeShift = await prisma.shift.findFirst({
          where: { cashierId, status: 'open' }, orderBy: { openedAt: 'desc' },
        });
        if (!activeShift) throw new Error('No active open shift to close');
        const txns = await prisma.transaction.findMany({
          where: { cashierId, createdAt: { gte: activeShift.openedAt }, status: 'complete' },
          select: { paymentMethod: true, total: true },
        });
        let cashSales = 0, gcashSales = 0;
        for (const t of txns) {
          if (t.paymentMethod === 'cash') cashSales += t.total;
          else if (t.paymentMethod === 'gcash') gcashSales += t.total;
        }
        const countCash = Number(p.closingCash ?? 0);
        const expectedCash = activeShift.openingFloat + cashSales;
        const closed = await prisma.shift.update({
          where: { id: activeShift.id },
          data: {
            clientUuid: action.clientUuid, closingCash: countCash, expectedCash,
            cashSales, gcashSales, overageShortage: countCash - expectedCash,
            status: 'closed', closedAt: new Date(), notes: p.notes ?? activeShift.notes,
          },
        });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: closed.id });
      }
    } catch (e) {
      results.push({ clientUuid: action.clientUuid, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ results });
}
