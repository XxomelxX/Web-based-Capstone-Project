-- Replay idempotency keys for the Category-2 sync actions that CREATE rows
-- (restock → StockBatch, product_upsert create → Product, category_upsert
-- create → Category, expense_add → Expense). Without these, a queued action
-- replayed after a timeout/network retry double-applies (phantom stock,
-- duplicate products/categories/expenses). Nullable: rows created online (or
-- before this migration) have NULL, and Postgres unique indexes allow any
-- number of NULLs. Index names follow Prisma's {table}_{column}_key
-- convention so `prisma migrate dev` does not regenerate them.
ALTER TABLE "StockBatch" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "StockBatch_clientUuid_key" ON "StockBatch"("clientUuid");

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Product_clientUuid_key" ON "Product"("clientUuid");

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Category_clientUuid_key" ON "Category"("clientUuid");

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_clientUuid_key" ON "Expense"("clientUuid");
