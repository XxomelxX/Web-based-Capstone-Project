-- DropIndex
DROP INDEX "ItemLog_productId_createdAt_idx";

-- DropIndex
DROP INDEX "Product_categoryId_archived_idx";

-- DropIndex
DROP INDEX "Shift_cashierId_status_idx";

-- DropIndex
DROP INDEX "Transaction_cashierId_createdAt_idx";

-- DropIndex
DROP INDEX "Transaction_status_idx";

-- DropIndex
DROP INDEX "TransactionItem_transactionId_idx";

-- DropIndex
DROP INDEX "UtangEntry_customerId_status_idx";

-- CreateTable
CREATE TABLE "VoidRequest" (
    "id" SERIAL NOT NULL,
    "clientUuid" TEXT,
    "transactionId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "VoidRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoidRequest_clientUuid_key" ON "VoidRequest"("clientUuid");

-- AddForeignKey
ALTER TABLE "VoidRequest" ADD CONSTRAINT "VoidRequest_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
