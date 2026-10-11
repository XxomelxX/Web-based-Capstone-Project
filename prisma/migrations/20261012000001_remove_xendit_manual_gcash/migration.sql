-- Remove Xendit online verification, keep manual GCash (gcashRef only).
-- Existing GCash rows become Paid: verification flags cleared before columns are dropped.
UPDATE "Transaction" SET "needsVerification" = false WHERE "paymentMethod" = 'gcash';
UPDATE "Transaction" SET "xenditStatus" = NULL WHERE "paymentMethod" = 'gcash';

DROP INDEX IF EXISTS "Transaction_xenditPaymentId_key";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "xenditPaymentId";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "xenditReferenceId";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "xenditStatus";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "needsVerification";
