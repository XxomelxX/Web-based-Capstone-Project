-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "goodsType" TEXT NOT NULL DEFAULT 'non-perishable';
