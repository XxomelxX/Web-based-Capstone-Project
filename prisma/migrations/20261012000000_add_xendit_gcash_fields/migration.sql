-- Add Xendit GCash hybrid offline-queue fields to Transaction
ALTER TABLE "Transaction" ADD COLUMN "gcashRef" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "xenditPaymentId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "xenditReferenceId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "xenditStatus" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "needsVerification" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Transaction_xenditPaymentId_key" ON "Transaction"("xenditPaymentId");
