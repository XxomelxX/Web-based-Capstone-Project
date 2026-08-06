/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username: 'admin' } });
    console.log(JSON.stringify(user, null, 2));
  } catch (err) {
    console.error('ERROR', err);
  } finally {
    await prisma.$disconnect();
  }
})();
