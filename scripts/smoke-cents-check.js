const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const prods = await p.product.findMany({ take: 3, select: { id: true, name: true, price: true, cost: true, stock: true } });
  console.log('products:', JSON.stringify(prods));
  const admin = await p.user.findFirst({ where: { username: 'admin' }, select: { id: true, role: true } });
  console.log('admin role:', admin && admin.role);
  const idx = await p.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname NOT LIKE '%_pkey' ORDER BY indexname");
  console.log('indexes:', idx.map((r) => r.indexname).join(', '));
  const batch = await p.stockBatch.findFirst({ select: { costPerUnit: true, quantityRemaining: true } });
  console.log('sample batch costPerUnit:', batch && batch.costPerUnit);
  await p.$disconnect();
})();
