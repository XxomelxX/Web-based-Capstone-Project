import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { queuedActionSchema } from '@/lib/client/validation';
import { broadcastRealtime } from '@/lib/server/realtime';
import { getDrawerFloat } from '@/lib/server/shiftDrawer';
import { sumShiftCash, computeExpectedCash } from '@/lib/server/shiftCash';
import { consumeFifoStock, restoreFifoStock, adjustFifoStock } from '@/lib/server/fifo';

// Accepts at most 100 actions per push (matches the client-side queue cap).
const MAX_ACTIONS = 100;

// POST /api/sync — batch push of Category-1 offline actions.
// Each action carries a permanent clientUuid (stamped at queue time).
// Idempotent: replays return the original row. Server-wins on conflicts.
//
// Actions are validated ONE BY ONE. Validating the batch as a whole meant a
// single malformed action (e.g. an unknown field, or a sale referencing a
// product created offline) 400'd the entire push — so every queued sale
// stayed stuck, the client burned its 5 retries and then paused syncing.
// Now a bad action reports its own error and its siblings still reach the
// server.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json().catch(() => null) as { actions?: unknown } | null;
  if (!body || !Array.isArray(body.actions)) {
    return NextResponse.json({ error: 'actions array required' }, { status: 400 });
  }
  const rawActions = body.actions;
  if (rawActions.length > MAX_ACTIONS) {
    return NextResponse.json({ error: `Too many actions (max ${MAX_ACTIONS})` }, { status: 400 });
  }

  const cashierId = Number(session.user.id);
  const role = (session.user as { role?: string }).role ?? 'cashier';
  const requireAdmin = (clientUuid: string) => {
    if (role !== 'admin') {
      results.push({ clientUuid, ok: false, error: 'Admin only — queued offline action needs an admin to sync' });
      return true;
    }
    return false;
  };
  const results: { clientUuid: string; ok: boolean; serverId?: number; conflict?: boolean; error?: string }[] = [];

  for (const raw of rawActions) {
    const rawRecord = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const rawUuid = typeof rawRecord.clientUuid === 'string' ? rawRecord.clientUuid : '';

    const parsedAction = queuedActionSchema.safeParse(raw);
    if (!parsedAction.success) {
      results.push({
        clientUuid: rawUuid,
        ok: false,
        error: `Invalid queued action: ${parsedAction.error.issues[0]?.message ?? 'schema validation failed'}`,
      });
      continue;
    }

    const action = parsedAction.data;
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
          const priced = items.map((item) => {
            const prod = map.get(item.productId);
            if (!prod) throw new Error(`Product #${item.productId} not found`);
            if (prod.stock < item.quantity) throw new Error(`Insufficient stock for ${prod.name}`);
            return { ...item, unitPrice: prod.price };
          });
          const subtotal = priced.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
          const isGcash = paymentMethod === 'gcash';
          const txn = await tx.transaction.create({
            data: {
              clientUuid: action.clientUuid, cashierId,
              customerId: p.customerId ?? null,
              paymentMethod, subtotal, vat: 0, total: subtotal,
              tendered, change: Number((tendered - subtotal).toFixed(2)), status: 'complete',
              gcashRef: isGcash && typeof p.gcashRef === 'string' ? p.gcashRef.slice(0, 50) : null,
            },
          });
          for (const item of priced) {
            await tx.transactionItem.create({
              data: { transactionId: txn.id, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: Number((item.quantity * item.unitPrice).toFixed(2)) },
            });
            await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
            await consumeFifoStock(tx, item.productId, item.quantity);
            await tx.itemLog.create({ data: { productId: item.productId, action: 'sold', quantity: item.quantity, performedBy: cashierId } });
          }
          return txn;
        }, { maxWait: 15000, timeout: 25000 });
        // Offline prices may be stale: compare client-expected vs server total
        // (exact integer centavo compare — no float epsilon).
        const priceConflict = p.expectedSubtotal !== undefined
          && Number(p.expectedSubtotal) !== created.total;
        broadcastRealtime('transactions', { action: 'created' });
        broadcastRealtime('products', { action: 'stock-updated' });
        broadcastRealtime('itemlog', { action: 'created' });
        results.push({
          clientUuid: action.clientUuid, ok: true, serverId: created.id,
          conflict: priceConflict || undefined,
          error: priceConflict ? 'Prices changed while offline — server prices applied (server-wins)' : undefined,
        });
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
          const dbProducts = await tx.product.findMany({ where: { id: { in: p.items!.map((i) => i.productId) } } });
          const dbMap = new Map(dbProducts.map((x) => [x.id, x]));
          const pricedUtang = p.items!.map((item) => {
            const prod = dbMap.get(item.productId);
            if (!prod) throw new Error(`Product #${item.productId} not found`);
            if (prod.stock < item.quantity) throw new Error(`Insufficient stock for ${prod.name}`);
            return { ...item, unitPrice: prod.price };
          });
          const totalAmount = pricedUtang.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
          let syncDueDate: Date | null = null;
          if (typeof p.dueDate === 'string' && p.dueDate !== '') {
            const parsed = new Date(p.dueDate);
            if (!Number.isNaN(parsed.getTime())) syncDueDate = parsed;
          }
          const entry = await tx.utangEntry.create({
            data: {
              clientUuid: action.clientUuid, customerId: customer.id,
              totalAmount, amountPaid: 0, remainingBalance: totalAmount,
              note: p.note ?? null, status: 'unpaid',
              dueDate: syncDueDate,
            },
          });
          for (const item of pricedUtang) {
            await tx.utangEntryItem.create({
              data: { utangEntryId: entry.id, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.quantity * item.unitPrice },
            });
            await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
            await consumeFifoStock(tx, item.productId, item.quantity);
            await tx.itemLog.create({ data: { productId: item.productId, action: 'sold', quantity: item.quantity, performedBy: cashierId } });
          }

          const txn = await tx.transaction.create({
            data: {
              clientUuid: `utang-${action.clientUuid}`,
              cashierId,
              customerId: customer.id,
              paymentMethod: 'credit',
              subtotal: totalAmount,
              vat: 0,
              total: totalAmount,
              tendered: 0,
              change: 0,
              status: 'complete',
            },
          });

          for (const item of pricedUtang) {
            await tx.transactionItem.create({
              data: {
                transactionId: txn.id,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.quantity * item.unitPrice,
              },
            });
          }

          return entry;
        }, { maxWait: 15000, timeout: 25000 });
        const utangPriceConflict = p.expectedSubtotal !== undefined
          && Number(p.expectedSubtotal) !== created.totalAmount;
        broadcastRealtime('utang', { action: 'created' });
        broadcastRealtime('transactions', { action: 'created' });
        broadcastRealtime('products', { action: 'stock-updated' });
        broadcastRealtime('itemlog', { action: 'created' });
        results.push({
          clientUuid: action.clientUuid, ok: true, serverId: created.id,
          conflict: utangPriceConflict || undefined,
          error: utangPriceConflict ? 'Prices changed while offline — server prices applied (server-wins)' : undefined,
        });
      } else if (action.type === 'record_payment') {
        if (!p.customerName || !p.amount || !Number.isInteger(p.amount) || p.amount <= 0) {
          throw new Error('customerName and positive integer amount (centavos) required');
        }
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
        const conflict = p.expectedBalance !== undefined && Number(p.expectedBalance) !== serverBalance;
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
        }, { maxWait: 15000, timeout: 25000 });
        broadcastRealtime('utang', { action: 'payment' });
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
        // Replay safety net: a close applied in an earlier batch overwrites the
        // row's clientUuid with the close uuid, so the open-uuid lookup above can
        // miss on retry and would resurrect a duplicate shift. The queue stamps
        // openedAt at queue time — match that exact timestamp instead. Creating
        // with the queue-time openedAt keeps this check stable across replays.
        const queuedOpenedAt = typeof p.openedAt === 'string' ? new Date(p.openedAt) : null;
        const hasQueuedOpenedAt = queuedOpenedAt !== null && !Number.isNaN(queuedOpenedAt.getTime());
        if (hasQueuedOpenedAt) {
          const prior = await prisma.shift.findFirst({
            where: { cashierId, openedAt: queuedOpenedAt },
          });
          if (prior) {
            results.push({ clientUuid: action.clientUuid, ok: true, serverId: prior.id, conflict: true });
            continue;
          }
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
            openingFloat: Number.isInteger(p.openingFloat) ? p.openingFloat! : 0,
            status: 'open', notes: p.notes ?? null,
            ...(hasQueuedOpenedAt ? { openedAt: queuedOpenedAt } : {}),
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
        // closingCash is optional: when omitted (no physical drawer count at
        // close time), store null so overage/shortage stays null (not a fake 0).
        const hasCounted = p.closingCash !== undefined && p.closingCash !== null
          && Number.isInteger(p.closingCash);
        const countCash = hasCounted ? p.closingCash! : null;
        // Shared drawer: reconcile against the admin's drawer float (fallback:
        // the shift's own float) and persist it so history matches the Z-Read.
        // Cash movements recorded offline replay first (FIFO), so their sums
        // are already on the server by the time close replays.
        const drawerFloat = await getDrawerFloat(role, activeShift.openingFloat);
        const cashSums = await sumShiftCash(prisma, activeShift.id);
        const expectedCash = computeExpectedCash(drawerFloat, cashSales, cashSums);
        const closed = await prisma.shift.update({
          where: { id: activeShift.id },
          data: {
            clientUuid: action.clientUuid, openingFloat: drawerFloat,
            closingCash: countCash, expectedCash,
            cashSales, gcashSales,
            cashIn: cashSums.cashIn, cashOut: cashSums.cashOut, totalExpenses: cashSums.expenses,
            overageShortage: countCash !== null ? countCash - expectedCash : null,
            status: 'closed', closedAt: new Date(), notes: p.notes ?? activeShift.notes,
          },
        });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: closed.id });
      } else if (action.type === 'cash_movement') {
        const existing = await prisma.cashMovement.findUnique({ where: { clientUuid: action.clientUuid } });
        if (existing) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
          continue;
        }
        const movementType = p.movementType;
        if (movementType !== 'cash_in' && movementType !== 'cash_out' && movementType !== 'expense') {
          throw new Error('movementType must be "cash_in", "cash_out" or "expense"');
        }
        const amount = Number(p.amount);
        if (!Number.isInteger(amount) || amount <= 0) {
          throw new Error('amount must be a positive integer in centavos');
        }
        // Resolve the shift server-side from the syncing session's open shift
        // (same pattern as close_shift) — the offline client only knew a temp
        // id, and FIFO replay guarantees open_shift ran before this action.
        const activeShift = await prisma.shift.findFirst({
          where: { cashierId, status: 'open' }, orderBy: { openedAt: 'desc' },
        });
        if (!activeShift) throw new Error('No active open shift for cash movement');
        const created = await prisma.$transaction(async (tx) => {
          const movement = await tx.cashMovement.create({
            data: {
              clientUuid: action.clientUuid, shiftId: activeShift.id,
              type: movementType, amount, note: p.note ?? null, performedBy: cashierId,
            },
          });
          if (movementType === 'expense') {
            // Dual-write Expense so store reports include shift spending.
            const expense = await tx.expense.create({
              data: {
                type: 'Shift Expense', amount,
                period: new Date().toISOString().slice(0, 10), note: p.note ?? null,
              },
            });
            return tx.cashMovement.update({ where: { id: movement.id }, data: { expenseId: expense.id } });
          }
          return movement;
        }, { maxWait: 15000, timeout: 25000 });
        broadcastRealtime('shift', { action: 'cash-movement', shiftId: activeShift.id });
        if (movementType === 'expense') broadcastRealtime('expenses', { action: 'created' });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
      } else if (action.type === 'product_upsert') {
        if (requireAdmin(action.clientUuid)) continue;
        const d = (p.data ?? {}) as Record<string, unknown>;
        if (d.stock !== undefined && (!Number.isInteger(d.stock) || (d.stock as number) < 0)) {
          throw new Error('stock must be a non-negative integer');
        }
        if (p.entityId) {
          // Server-wins field update. A stock edit reconciles the FIFO layers
          // (same rule as online PATCH /api/products/:id) — a bare absolute
          // write used to desync Product.stock from the layer sum.
          const updated = await prisma.$transaction(async (tx) => {
            const current = await tx.product.findUnique({
              where: { id: p.entityId },
            });
            if (!current) throw new Error('Product not found');
            const row = await tx.product.update({ where: { id: p.entityId }, data: {
              ...(typeof d.name === 'string' ? { name: d.name } : {}),
              ...(Number.isInteger(d.price) ? { price: d.price as number } : {}),
              ...(Number.isInteger(d.cost) ? { cost: d.cost as number } : {}),
              ...(typeof d.categoryId === 'number' ? { categoryId: d.categoryId } : {}),
              ...(typeof d.barcode === 'string' || d.barcode === null ? { barcode: d.barcode as string | null } : {}),
              ...(typeof d.archived === 'boolean' ? { archived: d.archived } : {}),
              ...(typeof d.goodsType === 'string' ? { goodsType: d.goodsType } : {}),
              ...(typeof d.vatType === 'string' ? { vatType: d.vatType } : {}),
            } });
            if (typeof d.stock === 'number' && d.stock !== row.stock) {
              await adjustFifoStock(tx, row, d.stock, 'Correction (offline edit)');
              return tx.product.findUnique({ where: { id: p.entityId } });
            }
            return row;
          }, { maxWait: 15000, timeout: 25000 });
          broadcastRealtime('products', { action: 'updated' });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: updated!.id, conflict: true, error: 'Applied over current server state (server-wins)' });
        } else {
          if (typeof d.name !== 'string' || !Number.isInteger(d.price)) throw new Error('name and integer price (centavos) required');
          const stock = typeof d.stock === 'number' ? d.stock : 0;
          // Product + opening batch atomic: Product.stock must always equal
          // the sum of StockBatch layers (mirrors POST /api/products).
          const created = await prisma.$transaction(async (tx) => {
            const row = await tx.product.create({ data: {
              name: d.name as string, price: d.price as number,
              cost: Number.isInteger(d.cost) ? d.cost as number : 0,
              stock,
              categoryId: typeof d.categoryId === 'number' ? d.categoryId : (await prisma.category.findFirst())!.id,
              barcode: typeof d.barcode === 'string' ? d.barcode : null,
              archived: false,
              goodsType: typeof d.goodsType === 'string' ? d.goodsType : 'non-perishable',
              vatType: typeof d.vatType === 'string' ? d.vatType : 'exempt',
            } });
            if (stock > 0) {
              await tx.stockBatch.create({ data: {
                productId: row.id, quantityReceived: stock, quantityRemaining: stock,
                supplier: 'Opening stock', costPerUnit: Number.isInteger(d.cost) ? d.cost as number : 0,
              } });
            }
            return row;
          }, { maxWait: 15000, timeout: 25000 });
          broadcastRealtime('products', { action: 'created' });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
        }
      } else if (action.type === 'product_delete') {
        if (requireAdmin(action.clientUuid)) continue;
        if (!p.entityId) throw new Error('entityId required');
        await prisma.product.delete({ where: { id: p.entityId } }).catch(async () => {
          await prisma.product.update({ where: { id: p.entityId! }, data: { archived: true } });
        });
        broadcastRealtime('products', { action: 'deleted' });
        results.push({ clientUuid: action.clientUuid, ok: true });
      } else if (action.type === 'category_upsert') {
        if (requireAdmin(action.clientUuid)) continue;
        const d = (p.data ?? {}) as Record<string, unknown>;
        if (p.entityId) {
          const updated = await prisma.category.update({ where: { id: p.entityId }, data: {
            ...(typeof d.name === 'string' ? { name: d.name } : {}),
            ...(typeof d.description === 'string' || d.description === null ? { description: d.description as string | null } : {}),
            ...(typeof d.archived === 'boolean' ? { archived: d.archived } : {}),
          } });
          broadcastRealtime('categories', { action: 'updated' });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: updated.id, conflict: true, error: 'Applied over current server state (server-wins)' });
        } else {
          if (typeof d.name !== 'string') throw new Error('name required');
          const created = await prisma.category.create({ data: { name: d.name, description: typeof d.description === 'string' ? d.description : null, archived: typeof d.archived === 'boolean' ? d.archived : false } });
          broadcastRealtime('categories', { action: 'created' });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
        }
      } else if (action.type === 'category_delete') {
        if (requireAdmin(action.clientUuid)) continue;
        if (!p.entityId) throw new Error('entityId required');
        const linkedProducts = await prisma.product.count({ where: { categoryId: p.entityId } });
        if (linkedProducts > 0) {
          throw new Error("Can't delete — reassign or remove its products first.");
        }
        await prisma.category.delete({ where: { id: p.entityId } });
        broadcastRealtime('categories', { action: 'deleted' });
        results.push({ clientUuid: action.clientUuid, ok: true });
      } else if (action.type === 'expense_add') {
        const d = (p.data ?? {}) as Record<string, unknown>;
        if (typeof d.type !== 'string' || !Number.isInteger(d.amount) || typeof d.period !== 'string') {
          throw new Error('type, integer amount (centavos), period required');
        }
        const created = await prisma.expense.create({ data: {
          type: d.type, amount: d.amount as number, period: d.period,
          note: typeof d.note === 'string' ? d.note : null,
        } });
        broadcastRealtime('expenses', { action: 'created' });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
      } else if (action.type === 'settings_update') {
        if (requireAdmin(action.clientUuid)) continue;
        const d = (p.data ?? {}) as Record<string, unknown>;
        const existing = await prisma.settings.findFirst();
        const data = {
          ...(typeof d.storeName === 'string' ? { storeName: d.storeName } : {}),
          ...(typeof d.address === 'string' ? { address: d.address } : {}),
          ...(typeof d.taxRate === 'number' ? { taxRate: d.taxRate } : {}),
          ...(typeof d.lowStockThreshold === 'number' ? { lowStockThreshold: d.lowStockThreshold } : {}),
          ...(typeof d.currency === 'string' ? { currency: d.currency } : {}),
        };
        const saved = existing
          ? await prisma.settings.update({ where: { id: existing.id }, data })
          : await prisma.settings.create({ data });
        broadcastRealtime('settings', { action: 'updated' });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: saved.id, conflict: true, error: 'Applied over current server state (server-wins)' });
      } else if (action.type === 'customer_add') {
        const d = (p.data ?? {}) as Record<string, unknown>;
        if (typeof d.name !== 'string' || !d.name.trim()) throw new Error('name required');
        const dupe = await prisma.customer.findFirst({ where: { name: { equals: d.name.trim(), mode: 'insensitive' } } });
        if (dupe) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: dupe.id, conflict: true, error: 'Customer already exists — linked to existing record' });
        } else {
          const created = await prisma.customer.create({ data: {
            name: d.name.trim(),
            phone: typeof d.phone === 'string' ? d.phone : null,
            email: typeof d.email === 'string' ? d.email : null,
            notes: typeof d.notes === 'string' ? d.notes : null,
          } });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
        }
      } else if (action.type === 'void_sale') {
        if (requireAdmin(action.clientUuid)) continue;
        if (!p.transactionId || !p.reason) throw new Error('transactionId and reason required');
        const txn = await prisma.transaction.findUnique({ where: { id: p.transactionId }, include: { items: true } });
        if (!txn) throw new Error('Transaction not found');
        if (txn.status === 'voided') {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: txn.id });
        } else {
          // Offline supervisor approval audit: resolve the approving supervisor
          // to a real user id when possible; fall back to the syncing user.
          let voidedBy = cashierId;
          const supName = typeof p.supervisorUsername === 'string' ? p.supervisorUsername : null;
          if (supName) {
            const sup = await prisma.user.findUnique({ where: { username: supName.toLowerCase() } }).catch(() => null);
            if (sup && sup.role === 'admin') voidedBy = sup.id;
          }
          const auditReason = supName
            ? `${p.reason} (offline supervisor approval: ${supName}${typeof p.supervisorVerifiedAt === 'string' ? ` @ ${p.supervisorVerifiedAt}` : ''})`
            : (p.reason as string);
          const updated = await prisma.$transaction(async (tx) => {
            for (const item of txn.items) {
              await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
              await restoreFifoStock(tx, item.productId, item.quantity);
              await tx.itemLog.create({ data: { productId: item.productId, action: 'voided', quantity: item.quantity, performedBy: voidedBy } });
            }
            return tx.transaction.update({ where: { id: txn.id }, data: { status: 'voided', voidReason: auditReason, voidedBy, voidedAt: new Date() } });
          }, { maxWait: 15000, timeout: 25000 });
          broadcastRealtime('transactions', { action: 'voided' });
          broadcastRealtime('products', { action: 'stock-updated' });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: updated.id });
        }
      } else if (action.type === 'void_request') {
        // Cashier (or admin) queued a void request offline. Any role may push;
        // the request itself grants no void — only an admin review executes it.
        if (!p.transactionId || !p.reason) throw new Error('transactionId and reason required');
        const replayed = await prisma.voidRequest.findUnique({ where: { clientUuid: action.clientUuid } });
        if (replayed) {
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: replayed.id });
        } else {
          const txn = await prisma.transaction.findUnique({ where: { id: p.transactionId } });
          if (!txn) throw new Error('Transaction not found');
          if (txn.status === 'voided') {
            results.push({ clientUuid: action.clientUuid, ok: true, conflict: true, error: 'Transaction already voided' });
          } else {
            const pending = await prisma.voidRequest.findFirst({
              where: { transactionId: p.transactionId, status: 'pending' },
            });
            if (pending) {
              results.push({ clientUuid: action.clientUuid, ok: true, serverId: pending.id, conflict: true, error: 'Void already requested — linked to existing request' });
            } else {
              // requestedBy arrives in payload (captured at queue time on the
              // cashier's session); fall back to the syncing user.
              const requestedBy = typeof p.requestedBy === 'number' && p.requestedBy > 0 ? p.requestedBy : cashierId;
              const created = await prisma.voidRequest.create({
                data: {
                  clientUuid: action.clientUuid,
                  transactionId: p.transactionId,
                  reason: p.reason as string,
                  requestedBy,
                },
              });
              broadcastRealtime('transactions', { action: 'void-requested' });
              results.push({ clientUuid: action.clientUuid, ok: true, serverId: created.id });
            }
          }
        }
      } else if (action.type === 'void_request_cancel') {
        if (typeof p.voidRequestId !== 'number') throw new Error('voidRequestId required');
        const existing = await prisma.voidRequest.findUnique({ where: { id: p.voidRequestId } });
        if (!existing) throw new Error('Void request not found');
        if (existing.status !== 'pending') {
          results.push({ clientUuid: action.clientUuid, ok: true, conflict: true, error: `Request already ${existing.status}` });
        } else {
          const isOwner = typeof p.requestedBy === 'number' && existing.requestedBy === p.requestedBy;
          if (!isOwner && role !== 'admin') {
            results.push({ clientUuid: action.clientUuid, ok: false, error: 'Only the requester or an admin can cancel' });
          } else {
            await prisma.voidRequest.update({ where: { id: existing.id }, data: { status: 'cancelled', reviewedAt: new Date() } });
            results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
          }
        }
      } else if (action.type === 'void_review') {
        // Admin approval queued offline. The SYNCING user must be admin —
        // cashiers can never finalize a void at sync time.
        if (requireAdmin(action.clientUuid)) continue;
        if (typeof p.voidRequestId !== 'number' || typeof p.approved !== 'boolean') {
          throw new Error('voidRequestId and approved required');
        }
        const existing = await prisma.voidRequest.findUnique({ where: { id: p.voidRequestId } });
        if (!existing) throw new Error('Void request not found');
        if (existing.status !== 'pending') {
          results.push({ clientUuid: action.clientUuid, ok: true, conflict: true, error: `Request already ${existing.status}` });
        } else if (!p.approved) {
          await prisma.voidRequest.update({
            where: { id: existing.id },
            data: { status: 'rejected', reviewedBy: cashierId, reviewedAt: new Date(), reviewNote: typeof p.reviewNote === 'string' ? p.reviewNote : null },
          });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
        } else {
          const { executeVoidTransaction } = await import('@/lib/server/void-transaction');
          await executeVoidTransaction(existing.transactionId, existing.reason, cashierId);
          await prisma.voidRequest.update({
            where: { id: existing.id },
            data: { status: 'approved', reviewedBy: cashierId, reviewedAt: new Date(), reviewNote: typeof p.reviewNote === 'string' ? p.reviewNote : null },
          });
          broadcastRealtime('transactions', { action: 'voided' });
          broadcastRealtime('products', { action: 'stock-updated' });
          results.push({ clientUuid: action.clientUuid, ok: true, serverId: existing.id });
        }
      } else if (action.type === 'utang_update_deadline') {
        // Deadline edit queued offline (any role). Last-write-wins.
        if (typeof p.utangEntryId !== 'number') throw new Error('utangEntryId required');
        let editDue: Date | null = null;
        if (typeof p.dueDate === 'string' && p.dueDate !== '') {
          const parsed = new Date(p.dueDate);
          if (Number.isNaN(parsed.getTime())) throw new Error('Invalid dueDate');
          editDue = parsed;
        }
        const target = await prisma.utangEntry.findUnique({ where: { id: p.utangEntryId } });
        if (!target) throw new Error('Utang entry not found');
        await prisma.utangEntry.update({ where: { id: target.id }, data: { dueDate: editDue } });
        broadcastRealtime('utang', { action: 'deadline-updated' });
        results.push({ clientUuid: action.clientUuid, ok: true, serverId: target.id });
      } else if (action.type === 'restock') {
        if (requireAdmin(action.clientUuid)) continue;
        if (!p.productId || !p.quantity || p.quantity <= 0) throw new Error('productId and positive quantity required');
        if (p.costPerUnit != null && !Number.isInteger(p.costPerUnit)) {
          throw new Error('costPerUnit must be an integer amount in centavos');
        }
        await prisma.$transaction(async (tx) => {
          await tx.stockBatch.create({ data: {
            productId: p.productId!, quantityReceived: p.quantity!, quantityRemaining: p.quantity!,
            supplier: p.supplier ?? null, costPerUnit: p.costPerUnit ?? null,
          } });
          await tx.product.update({ where: { id: p.productId! }, data: { stock: { increment: p.quantity! } } });
          await tx.itemLog.create({ data: { productId: p.productId!, action: 'restocked', quantity: p.quantity!, performedBy: cashierId } });
        }, { maxWait: 15000, timeout: 25000 });
        broadcastRealtime('restock', { action: 'created' });
        broadcastRealtime('products', { action: 'updated' });
        results.push({ clientUuid: action.clientUuid, ok: true });
      }
    } catch (e) {
      // P2002 race on clientUuid: return the winner's row.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002') {
        results.push({ clientUuid: action.clientUuid, ok: true, conflict: true, error: 'Duplicate replay absorbed (idempotent)' });
        continue;
      }
      results.push({ clientUuid: action.clientUuid, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ results });
}
