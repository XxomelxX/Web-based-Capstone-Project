-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "cashIn" INTEGER,
ADD COLUMN     "cashOut" INTEGER,
ADD COLUMN     "totalExpenses" INTEGER;

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" SERIAL NOT NULL,
    "clientUuid" TEXT,
    "shiftId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "expenseId" INTEGER,
    "performedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_clientUuid_key" ON "CashMovement"("clientUuid");

-- CreateIndex
CREATE INDEX "CashMovement_shiftId_createdAt_idx" ON "CashMovement"("shiftId", "createdAt");

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
