// One-off: raw Prisma latency from Node (no Next server involved) against the
// same DATABASE_URL — separates network/Neon compute cost from Next overhead.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: ['error'] });
const t = async (label, fn) => {
  const t0 = performance.now();
  await fn();
  console.log(`${label.padEnd(22)} ${Math.round(performance.now() - t0)}ms`);
};
await t('connect (new PrismaClient!)', async () => { /* import has already connected lazily */ });
await t('SELECT 1  #1', () => prisma.$queryRaw`SELECT 1`);
await t('SELECT 1  #2', () => prisma.$queryRaw`SELECT 1`);
await t('settings.findFirst', () => prisma.settings.findFirst());
await t('settings.findFirst #2', () => prisma.settings.findFirst());
await t('products findMany', () => prisma.product.findMany({ include: { category: true }, orderBy: { name: 'asc' } }));
await t('products findMany #2', () => prisma.product.findMany({ include: { category: true }, orderBy: { name: 'asc' } }));
await t('transactions findMany ×200', () => prisma.transaction.findMany({ include: { items: { include: { product: true } }, cashier: true, customer: true }, orderBy: { createdAt: 'desc' }, take: 200 }));
await t('all-transaction count', () => prisma.transaction.count());
await prisma.$disconnect();
