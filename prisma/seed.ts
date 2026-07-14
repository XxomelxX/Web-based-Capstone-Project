import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Settings (only one row)
  const existingSettings = await prisma.settings.findFirst();
  if (!existingSettings) {
    await prisma.settings.create({
      data: { storeName: 'J & J Merchandise Store', currency: 'PHP', taxRate: 12, lowStockThreshold: 20 },
    });
  }

  // Admin account
  const existingAdmin = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: {
        fullName: 'Samuel Bioco',
        username: 'admin',
        email: 'admin@jjmerchandise.com',
        passwordHash,
        role: 'admin',
        status: 'active',
      },
    });
    console.log('Seeded admin account -> username: admin / password: admin123 (change this after first login)');
  }

  // Sample cashier
  const existingCashier = await prisma.user.findUnique({ where: { username: 'cashier' } });
  if (!existingCashier) {
    const passwordHash = await bcrypt.hash('cashier123', 10);
    await prisma.user.create({
      data: {
        fullName: 'Judy Ann Bioco',
        username: 'cashier',
        email: 'judyann@jjmerchandise.com',
        passwordHash,
        role: 'cashier',
        status: 'active',
      },
    });
    console.log('Seeded cashier account -> username: cashier / password: cashier123');
  }

  // Categories + Products (only if none exist yet)
  const categoryCount = await prisma.category.count();
  if (categoryCount === 0) {
    const categoriesData = [
      { name: 'Beverages', description: 'Beverages products' },
      { name: 'Snacks', description: 'Snacks products' },
      { name: 'Dairy', description: 'Dairy products' },
      { name: 'Household', description: 'Household products' },
      { name: 'Personal Care', description: 'Personal Care products' },
      { name: 'Canned Goods', description: 'Canned Goods products' },
      { name: 'Noodles', description: 'Noodles products' },
    ];
    const categories = await Promise.all(
      categoriesData.map((c) => prisma.category.create({ data: c }))
    );
    const byName = (name: string) => categories.find((c) => c.name === name)!.id;

    await prisma.product.createMany({
      data: [
        { name: 'Coca-Cola 500ml', categoryId: byName('Beverages'), price: 25, cost: 18, stock: 47, unit: 'ml', packSize: '500ml', barcode: '4801234567890' },
        { name: 'Nescafe 3in1 Original', categoryId: byName('Beverages'), price: 10, cost: 7, stock: 200, unit: 'g', packSize: '20g' },
        { name: 'Bear Brand Milk 33g', categoryId: byName('Dairy'), price: 18, cost: 13, stock: 65, unit: 'g', packSize: '33g' },
        { name: 'Safeguard Soap 130g', categoryId: byName('Personal Care'), price: 45, cost: 32, stock: 5, unit: 'g', packSize: '130g' },
        { name: 'Tide Powder 70g', categoryId: byName('Household'), price: 22, cost: 16, stock: 8, unit: 'g', packSize: '70g' },
        { name: 'Rebisco Crackers', categoryId: byName('Snacks'), price: 8, cost: 5, stock: 95 },
        { name: '555 Sardines Hot Chili', categoryId: byName('Canned Goods'), price: 26, cost: 19, stock: 100 },
        { name: 'Lucky Me Pancit Canton', categoryId: byName('Noodles'), price: 15, cost: 10, stock: 120 },
        { name: 'Skyflakes Crackers', categoryId: byName('Snacks'), price: 12, cost: 8, stock: 80 },
        { name: 'Datu Puti Vinegar', categoryId: byName('Canned Goods'), price: 40, cost: 28, stock: 30 },
      ],
    });
    console.log('Seeded categories and products.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
