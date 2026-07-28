const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username: 'admin' } });
    console.log('user:', user ? { id: user.id, username: user.username, status: user.status, role: user.role } : null);
    if (user) {
      console.log('stored hash:', user.passwordHash);
      const isValid = await bcrypt.compare('admin123', user.passwordHash);
      console.log('password valid:', isValid);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
})();
