import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface SeedProduct {
  name: string;
  price: number;
  cost: number;
  stock: number;
  goodsType: 'perishable' | 'non-perishable' | 'durable';
  vatType: 'exempt' | 'regular' | 'zero-rated';
  expiryMonthsFromNow: number | null;
}

const productsByCategory: Record<string, SeedProduct[]> = {
  Beverages: [
    { name: 'Coca-Cola 500ml', price: 25, cost: 18, stock: 60, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
    { name: 'Sprite 500ml', price: 25, cost: 18, stock: 55, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
    { name: 'Royal 500ml', price: 25, cost: 18, stock: 40, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
    { name: 'Mountain Dew 500ml', price: 25, cost: 18, stock: 35, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
    { name: 'Nescafe 3in1 Original', price: 10, cost: 7, stock: 200, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Kopiko 3in1', price: 10, cost: 7, stock: 150, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Great Taste White', price: 10, cost: 7, stock: 140, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Milo 3in1', price: 12, cost: 8, stock: 130, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'C2 Green Tea 500ml', price: 20, cost: 14, stock: 45, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 6 },
    { name: 'Zesto Orange Juice', price: 12, cost: 8, stock: 90, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 6 },
    { name: 'Tang Orange 25g', price: 8, cost: 5, stock: 100, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 18 },
    { name: 'Nature Spring Water 500ml', price: 10, cost: 6, stock: 120, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Wilkins Distilled Water 1L', price: 20, cost: 14, stock: 60, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Pop Cola 1.5L', price: 35, cost: 26, stock: 25, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
    { name: 'Gatorade Blue 500ml', price: 30, cost: 22, stock: 30, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
  ],
  Noodles: [
    { name: 'Lucky Me Pancit Canton Original', price: 15, cost: 10, stock: 150, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Lucky Me Pancit Canton Chilimansi', price: 15, cost: 10, stock: 140, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Lucky Me Beef na Beef', price: 12, cost: 8, stock: 130, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Lucky Me Chicken', price: 12, cost: 8, stock: 130, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Payless Sotanghon', price: 8, cost: 5, stock: 90, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Nissin Cup Noodles Seafood', price: 22, cost: 16, stock: 60, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 10 },
    { name: 'Quickchow Chicken Noodle Soup', price: 10, cost: 7, stock: 100, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Ho-Mi Instant Noodles', price: 9, cost: 6, stock: 85, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
  ],
  Snacks: [
    { name: 'Piattos Cheese 40g', price: 25, cost: 18, stock: 70, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 8 },
    { name: 'Nova Multigrain Chips', price: 20, cost: 14, stock: 65, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 8 },
    { name: 'Chippy BBQ', price: 15, cost: 10, stock: 90, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 8 },
    { name: 'Clover Chips Barbecue', price: 12, cost: 8, stock: 80, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 8 },
    { name: 'Boy Bawang Cornick', price: 10, cost: 6, stock: 100, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 10 },
    { name: 'Rebisco Crackers', price: 8, cost: 5, stock: 120, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 10 },
    { name: 'Skyflakes Crackers', price: 12, cost: 8, stock: 110, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 10 },
    { name: 'Oreo Original', price: 20, cost: 14, stock: 75, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
    { name: 'Fita Crackers', price: 15, cost: 10, stock: 60, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 10 },
    { name: 'Cloud 9 Chocolate Bar', price: 12, cost: 8, stock: 90, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 8 },
    { name: 'Nips Candy Chocolate', price: 5, cost: 3, stock: 200, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 10 },
    { name: 'Mentos Mint Roll', price: 15, cost: 10, stock: 70, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Yakult 5s', price: 40, cost: 30, stock: 35, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 1 },
    { name: 'Mister Popcorn Cheese', price: 10, cost: 6, stock: 80, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 8 },
    { name: 'Ding Dong Mixed Nuts', price: 12, cost: 8, stock: 65, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 8 },
  ],
  'Canned Goods': [
    { name: '555 Sardines Hot Chili', price: 26, cost: 19, stock: 100, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: '555 Sardines Original', price: 24, cost: 17, stock: 100, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Century Tuna Flakes in Oil', price: 35, cost: 26, stock: 80, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Argentina Corned Beef', price: 45, cost: 34, stock: 70, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'CDO Corned Beef', price: 40, cost: 30, stock: 65, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Purefoods Luncheon Meat', price: 55, cost: 42, stock: 50, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Ligo Sardines in Tomato Sauce', price: 22, cost: 16, stock: 90, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Mega Sardines', price: 20, cost: 14, stock: 95, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Alaska Evaporated Milk', price: 28, cost: 20, stock: 85, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 18 },
    { name: 'Angel Condensed Milk', price: 32, cost: 24, stock: 75, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 18 },
  ],
  Household: [
    { name: 'Tide Powder 70g', price: 22, cost: 16, stock: 100, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Surf Powder 70g', price: 20, cost: 14, stock: 95, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Ariel Powder 65g', price: 21, cost: 15, stock: 90, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Joy Dishwashing Liquid 250ml', price: 35, cost: 25, stock: 60, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Downy Fabric Conditioner 27ml', price: 8, cost: 5, stock: 150, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Zonrox Bleach 250ml', price: 25, cost: 18, stock: 50, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Domex Toilet Bowl Cleaner', price: 40, cost: 30, stock: 30, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Baygon Insect Spray', price: 120, cost: 90, stock: 20, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Champion Detergent Bar', price: 15, cost: 10, stock: 80, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Trash Bag Roll (Medium)', price: 10, cost: 6, stock: 100, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
  ],
  'Personal Care': [
    { name: 'Safeguard Soap 130g', price: 45, cost: 32, stock: 70, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Palmolive Naturals Soap', price: 30, cost: 21, stock: 65, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Head & Shoulders Shampoo 12ml', price: 8, cost: 5, stock: 150, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Sunsilk Shampoo Sachet', price: 7, cost: 4, stock: 160, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Colgate Total Toothpaste 20g', price: 18, cost: 12, stock: 100, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Close Up Toothpaste', price: 16, cost: 11, stock: 90, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Rexona Deodorant Roll-On', price: 55, cost: 40, stock: 40, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Johnson Baby Powder 50g', price: 25, cost: 18, stock: 55, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Modess Sanitary Napkin', price: 20, cost: 14, stock: 70, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Nice n Fluffy Fabric Softener', price: 8, cost: 5, stock: 100, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
  ],
  Dairy: [
    { name: 'Bear Brand Milk 33g', price: 18, cost: 13, stock: 85, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Alaska Fresh Milk 200ml', price: 30, cost: 22, stock: 50, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 1 },
    { name: 'Anchor Butter 25g', price: 15, cost: 10, stock: 60, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 3 },
    { name: 'Eden Cheese 165g', price: 65, cost: 50, stock: 35, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 6 },
    { name: 'Magnolia Ice Cream Cup', price: 25, cost: 18, stock: 40, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 6 },
    { name: 'Yakult Original', price: 10, cost: 7, stock: 100, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 1 },
  ],
  Condiments: [
    { name: 'Datu Puti Vinegar 350ml', price: 40, cost: 28, stock: 60, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Datu Puti Soy Sauce 350ml', price: 38, cost: 26, stock: 60, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Silver Swan Soy Sauce', price: 35, cost: 24, stock: 55, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
    { name: 'Golden Fiesta Cooking Oil 250ml', price: 45, cost: 34, stock: 50, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Minola Cooking Oil 250ml', price: 40, cost: 30, stock: 55, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Maggi Magic Sarap 8g', price: 8, cost: 5, stock: 150, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 18 },
    { name: 'Knorr Sinigang Mix', price: 15, cost: 10, stock: 80, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 18 },
    { name: 'UFC Banana Ketchup', price: 25, cost: 18, stock: 65, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 18 },
    { name: 'Del Monte Tomato Sauce', price: 20, cost: 14, stock: 70, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 18 },
    { name: 'Lorins Vetsin (MSG) 10g', price: 5, cost: 3, stock: 200, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 24 },
  ],
  'Rice & Grains': [
    { name: 'Sinandomeng Rice (1kg)', price: 55, cost: 45, stock: 100, goodsType: 'non-perishable', vatType: 'exempt', expiryMonthsFromNow: 12 },
    { name: 'Dinorado Rice (1kg)', price: 65, cost: 53, stock: 80, goodsType: 'non-perishable', vatType: 'exempt', expiryMonthsFromNow: 12 },
    { name: 'Jasmine Rice (1kg)', price: 70, cost: 58, stock: 60, goodsType: 'non-perishable', vatType: 'exempt', expiryMonthsFromNow: 12 },
    { name: 'Mongo Beans (500g)', price: 60, cost: 48, stock: 40, goodsType: 'non-perishable', vatType: 'exempt', expiryMonthsFromNow: 12 },
  ],
  'Bread & Bakery': [
    { name: 'Gardenia Classic White Bread', price: 75, cost: 58, stock: 30, goodsType: 'perishable', vatType: 'regular', expiryMonthsFromNow: 0 },
    { name: 'Pan de Sal (piece)', price: 5, cost: 3, stock: 200, goodsType: 'perishable', vatType: 'exempt', expiryMonthsFromNow: 0 },
    { name: 'Rebisco Sandwich Cracker', price: 8, cost: 5, stock: 100, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 9 },
  ],
  'Baby Care': [
    { name: 'Pampers Diaper (Medium, single)', price: 15, cost: 10, stock: 80, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
    { name: 'Bonakid Milk Powder Sachet', price: 25, cost: 18, stock: 50, goodsType: 'non-perishable', vatType: 'regular', expiryMonthsFromNow: 12 },
    { name: 'Baby Cologne Small Bottle', price: 30, cost: 22, stock: 40, goodsType: 'durable', vatType: 'regular', expiryMonthsFromNow: null },
  ],
};

async function wipeExistingData() {
  await prisma.paymentAllocation.deleteMany({});
  await prisma.utangEntryItem.deleteMany({});
  await prisma.transactionItem.deleteMany({});
  await prisma.stockBatch.deleteMany({});
  await prisma.itemLog.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.utangEntry.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  console.log('Wiped all products, categories, customers, and transaction history.');
}

async function seedProductsAndCategories() {
  await wipeExistingData();

  const categoriesData = [
    { name: 'Beverages', description: 'Beverages products' },
    { name: 'Noodles', description: 'Noodles products' },
    { name: 'Snacks', description: 'Snacks products' },
    { name: 'Canned Goods', description: 'Canned Goods products' },
    { name: 'Household', description: 'Household products' },
    { name: 'Personal Care', description: 'Personal Care products' },
    { name: 'Dairy', description: 'Dairy products' },
    { name: 'Condiments', description: 'Condiments products' },
    { name: 'Rice & Grains', description: 'Rice and Grains products' },
    { name: 'Bread & Bakery', description: 'Bread and Bakery products' },
    { name: 'Baby Care', description: 'Baby Care products' },
  ];

  const categories = await Promise.all(
    categoriesData.map((c) => prisma.category.create({ data: c }))
  );

  let totalInserted = 0;

  for (const [categoryName, items] of Object.entries(productsByCategory)) {
    const category = categories.find((c) => c.name === categoryName);
    if (!category) continue;

    await prisma.product.createMany({
      data: items.map((item) => ({
        name: item.name,
        categoryId: category.id,
        price: item.price,
        cost: item.cost,
        stock: item.stock,
        goodsType: item.goodsType,
        vatType: item.vatType,
        expiryDate: item.expiryMonthsFromNow !== null
          ? new Date(Date.now() + item.expiryMonthsFromNow * 30 * 24 * 60 * 60 * 1000)
          : null,
      })),
    });
    totalInserted += items.length;
  }

  console.log(`Seeded ${totalInserted} products across ${categories.length} categories.`);
}

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

  // Always wipe and reseed products/categories/customers
  await seedProductsAndCategories();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
