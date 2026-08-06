/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');

const prisma = new PrismaClient();

const accounts = [
  { username: 'admin', password: 'admin123' },
  { username: 'cashier', password: 'cashier123' },
];

async function resetAccount({ username, password }) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.log(`Skipping ${username}: user not found.`);
    return;
  }

  const passwordHash = await hash(password, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  console.log(`Reset password for ${username}.`);
}

(async () => {
  try {
    for (const account of accounts) {
      await resetAccount(account);
    }
    console.log('Password reset complete.');
  } catch (error) {
    console.error('Error resetting passwords:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
