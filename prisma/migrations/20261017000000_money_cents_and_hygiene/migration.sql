-- Phase 1 migration: money to integer centavos + schema hygiene.
--
-- MONEY: every money column was DOUBLE PRECISION (pesos, e.g. 25.50).
-- Converted to INTEGER centavos (2550) with ROUND() so any accumulated
-- binary-float drift is baked in once, half away from zero.
-- Settings.taxRate is a percentage and stays DOUBLE PRECISION.
--
-- HYGIENE: Role enum, real FK relations for voidedBy/requestedBy/
-- reviewedBy/verifiedBy (were bare INTEGERs), cascade rules for
-- dependent children, and the hot query indexes that a previous
-- migration dropped.

-- 1) Role enum ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('admin', 'cashier');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";

-- 2) Money columns to INTEGER centavos ------------------------------------
ALTER TABLE "Product" ALTER COLUMN "price" TYPE INTEGER USING ROUND("price" * 100)::INTEGER;
ALTER TABLE "Product" ALTER COLUMN "cost" TYPE INTEGER USING ROUND("cost" * 100)::INTEGER;

ALTER TABLE "Transaction" ALTER COLUMN "subtotal" TYPE INTEGER USING ROUND("subtotal" * 100)::INTEGER;
ALTER TABLE "Transaction" ALTER COLUMN "vat" TYPE INTEGER USING ROUND("vat" * 100)::INTEGER;
ALTER TABLE "Transaction" ALTER COLUMN "total" TYPE INTEGER USING ROUND("total" * 100)::INTEGER;
ALTER TABLE "Transaction" ALTER COLUMN "tendered" TYPE INTEGER USING ROUND("tendered" * 100)::INTEGER;
ALTER TABLE "Transaction" ALTER COLUMN "change" TYPE INTEGER USING ROUND("change" * 100)::INTEGER;

ALTER TABLE "TransactionItem" ALTER COLUMN "unitPrice" TYPE INTEGER USING ROUND("unitPrice" * 100)::INTEGER;
ALTER TABLE "TransactionItem" ALTER COLUMN "lineTotal" TYPE INTEGER USING ROUND("lineTotal" * 100)::INTEGER;

ALTER TABLE "StockBatch" ALTER COLUMN "costPerUnit" TYPE INTEGER USING ROUND("costPerUnit" * 100)::INTEGER;

ALTER TABLE "UtangEntry" ALTER COLUMN "totalAmount" TYPE INTEGER USING ROUND("totalAmount" * 100)::INTEGER;
ALTER TABLE "UtangEntry" ALTER COLUMN "amountPaid" TYPE INTEGER USING ROUND("amountPaid" * 100)::INTEGER;
ALTER TABLE "UtangEntry" ALTER COLUMN "remainingBalance" TYPE INTEGER USING ROUND("remainingBalance" * 100)::INTEGER;

ALTER TABLE "UtangEntryItem" ALTER COLUMN "unitPrice" TYPE INTEGER USING ROUND("unitPrice" * 100)::INTEGER;
ALTER TABLE "UtangEntryItem" ALTER COLUMN "lineTotal" TYPE INTEGER USING ROUND("lineTotal" * 100)::INTEGER;

ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100)::INTEGER;
ALTER TABLE "PaymentAllocation" ALTER COLUMN "amountApplied" TYPE INTEGER USING ROUND("amountApplied" * 100)::INTEGER;
ALTER TABLE "Expense" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100)::INTEGER;

ALTER TABLE "Shift" ALTER COLUMN "openingFloat" TYPE INTEGER USING ROUND("openingFloat" * 100)::INTEGER;
ALTER TABLE "Shift" ALTER COLUMN "closingCash" TYPE INTEGER USING ROUND("closingCash" * 100)::INTEGER;
ALTER TABLE "Shift" ALTER COLUMN "expectedCash" TYPE INTEGER USING ROUND("expectedCash" * 100)::INTEGER;
ALTER TABLE "Shift" ALTER COLUMN "cashSales" TYPE INTEGER USING ROUND("cashSales" * 100)::INTEGER;
ALTER TABLE "Shift" ALTER COLUMN "gcashSales" TYPE INTEGER USING ROUND("gcashSales" * 100)::INTEGER;
ALTER TABLE "Shift" ALTER COLUMN "overageShortage" TYPE INTEGER USING ROUND("overageShortage" * 100)::INTEGER;

-- 3) Real FKs for bare-integer user columns -------------------------------
DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_voidedBy_fkey"
    FOREIGN KEY ("voidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "VoidRequest" ADD CONSTRAINT "VoidRequest_requestedBy_fkey"
    FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "VoidRequest" ADD CONSTRAINT "VoidRequest_reviewedBy_fkey"
    FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Shift" ADD CONSTRAINT "Shift_verifiedBy_fkey"
    FOREIGN KEY ("verifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4) Cascade rules for dependent children ---------------------------------
ALTER TABLE "TransactionItem" DROP CONSTRAINT IF EXISTS "TransactionItem_transactionId_fkey";
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockBatch" DROP CONSTRAINT IF EXISTS "StockBatch_productId_fkey";
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UtangEntryItem" DROP CONSTRAINT IF EXISTS "UtangEntryItem_utangEntryId_fkey";
ALTER TABLE "UtangEntryItem" ADD CONSTRAINT "UtangEntryItem_utangEntryId_fkey"
  FOREIGN KEY ("utangEntryId") REFERENCES "UtangEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" DROP CONSTRAINT IF EXISTS "PaymentAllocation_paymentId_fkey";
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" DROP CONSTRAINT IF EXISTS "PaymentAllocation_utangEntryId_fkey";
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_utangEntryId_fkey"
  FOREIGN KEY ("utangEntryId") REFERENCES "UtangEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoidRequest" DROP CONSTRAINT IF EXISTS "VoidRequest_transactionId_fkey";
ALTER TABLE "VoidRequest" ADD CONSTRAINT "VoidRequest_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ItemLog stays RESTRICT on product/user (audit trail must not orphan).

-- 5) Hot query indexes (IF NOT EXISTS: safe to re-run) ---------------------
CREATE INDEX IF NOT EXISTS "Transaction_createdAt_idx" ON "Transaction"("createdAt");
CREATE INDEX IF NOT EXISTS "Transaction_cashierId_createdAt_idx" ON "Transaction"("cashierId", "createdAt");
CREATE INDEX IF NOT EXISTS "Transaction_status_createdAt_idx" ON "Transaction"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Transaction_customerId_idx" ON "Transaction"("customerId");

CREATE INDEX IF NOT EXISTS "TransactionItem_transactionId_idx" ON "TransactionItem"("transactionId");
CREATE INDEX IF NOT EXISTS "TransactionItem_productId_idx" ON "TransactionItem"("productId");

CREATE INDEX IF NOT EXISTS "StockBatch_productId_dateReceived_idx" ON "StockBatch"("productId", "dateReceived");

CREATE INDEX IF NOT EXISTS "ItemLog_productId_createdAt_idx" ON "ItemLog"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "ItemLog_performedBy_idx" ON "ItemLog"("performedBy");

CREATE INDEX IF NOT EXISTS "UtangEntry_customerId_status_idx" ON "UtangEntry"("customerId", "status");
CREATE INDEX IF NOT EXISTS "UtangEntry_dueDate_idx" ON "UtangEntry"("dueDate");

CREATE INDEX IF NOT EXISTS "UtangEntryItem_utangEntryId_idx" ON "UtangEntryItem"("utangEntryId");
CREATE INDEX IF NOT EXISTS "UtangEntryItem_productId_idx" ON "UtangEntryItem"("productId");

CREATE INDEX IF NOT EXISTS "Payment_createdAt_idx" ON "Payment"("createdAt");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_utangEntryId_idx" ON "PaymentAllocation"("utangEntryId");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

CREATE INDEX IF NOT EXISTS "Expense_createdAt_idx" ON "Expense"("createdAt");

CREATE INDEX IF NOT EXISTS "Shift_cashierId_status_idx" ON "Shift"("cashierId", "status");
CREATE INDEX IF NOT EXISTS "Shift_status_idx" ON "Shift"("status");

CREATE INDEX IF NOT EXISTS "VoidRequest_transactionId_status_idx" ON "VoidRequest"("transactionId", "status");
CREATE INDEX IF NOT EXISTS "VoidRequest_status_idx" ON "VoidRequest"("status");

CREATE INDEX IF NOT EXISTS "Product_archived_idx" ON "Product"("archived");
