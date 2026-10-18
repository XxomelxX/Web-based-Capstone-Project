// READ-ONLY: recent shifts + direct-commit vs replay forensics.
// createdAt ~= server wall time; openedAt is queue-time for replays, so a
// large gap identifies replay-created rows.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const cuts = await prisma.shift.findMany({
  where: { openedAt: { gte: new Date(Date.now() - 4 * 3600e3) } },
  orderBy: { openedAt: 'desc' },
  select: {
    id: true, cashierId: true, status: true, openingFloat: true,
    openedAt: true, clientUuid: true, closedAt: true,
  },
});
console.log(JSON.stringify(cuts, null, 1));
const openCount = cuts.filter((s) => s.status === 'open').length;
console.log(`open shifts (last 4h shown): ${openCount}`);
await prisma.$disconnect();