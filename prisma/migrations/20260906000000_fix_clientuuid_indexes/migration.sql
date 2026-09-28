-- Fix migration: clientUuid idempotency columns, Product.updatedAt, hot indexes

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Transaction_clientUuid_key') THEN
    CREATE UNIQUE INDEX "Transaction_clientUuid_key" ON "Transaction"("clientUuid");
  END IF;
END $$;

ALTER TABLE "UtangEntry" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'UtangEntry_clientUuid_key') THEN
    CREATE UNIQUE INDEX "UtangEntry_clientUuid_key" ON "UtangEntry"("clientUuid");
  END IF;
END $$;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Payment_clientUuid_key') THEN
    CREATE UNIQUE INDEX "Payment_clientUuid_key" ON "Payment"("clientUuid");
  END IF;
END $$;

ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "clientUuid" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Shift_clientUuid_key') THEN
    CREATE UNIQUE INDEX "Shift_clientUuid_key" ON "Shift"("clientUuid");
  END IF;
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Hot-path indexes
CREATE INDEX IF NOT EXISTS "Product_categoryId_archived_idx" ON "Product"("categoryId", "archived");
CREATE INDEX IF NOT EXISTS "Transaction_cashierId_createdAt_idx" ON "Transaction"("cashierId", "createdAt");
CREATE INDEX IF NOT EXISTS "Transaction_status_idx" ON "Transaction"("status");
CREATE INDEX IF NOT EXISTS "TransactionItem_transactionId_idx" ON "TransactionItem"("transactionId");
CREATE INDEX IF NOT EXISTS "UtangEntry_customerId_status_idx" ON "UtangEntry"("customerId", "status");
CREATE INDEX IF NOT EXISTS "ItemLog_productId_createdAt_idx" ON "ItemLog"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "Shift_cashierId_status_idx" ON "Shift"("cashierId", "status");
