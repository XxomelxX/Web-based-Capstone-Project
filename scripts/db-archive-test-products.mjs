// Archives (soft-deletes) the leftover test products. Reversible: flipping
// archived back to false restores them. Backs up the before-state to reports/.
// Usage: node --env-file=.env scripts/db-archive-test-products.mjs
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';

const TARGETS = ['ddad', 'buwad', 'shin'];
const prisma = new PrismaClient();

const before = await prisma.product.findMany({
  where: { name: { in: TARGETS } },
  select: { id: true, name: true, stock: true, archived: true },
});

mkdirSync('reports', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = `reports/archive-test-products-${stamp}.json`;
writeFileSync(path, JSON.stringify({ before, archivedAt: new Date().toISOString() }, null, 2));

const result = await prisma.product.updateMany({
  where: { name: { in: TARGETS }, archived: false },
  data: { archived: true },
});

const after = await prisma.product.findMany({
  where: { name: { in: TARGETS } },
  select: { id: true, name: true, archived: true },
});

console.log(`backed up before-state -> ${path}`);
console.log(`updated: ${result.count} of ${before.length} products`);
console.log(JSON.stringify(after));
await prisma.$disconnect();