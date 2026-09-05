-- AlterTable: Add missing fields to Product
ALTER TABLE "Product" ADD COLUMN "vatType" TEXT NOT NULL DEFAULT 'exempt';
ALTER TABLE "Product" ADD COLUMN "expiryDate" TIMESTAMP(3);

-- AlterTable: Add missing fields to User
ALTER TABLE "User" ADD COLUMN "resetToken" TEXT;
ALTER TABLE "User" ADD COLUMN "resetTokenExpiry" TIMESTAMP(3);

-- CreateTable: PasswordResetCode
CREATE TABLE "PasswordResetCode" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetCode_email_code_idx" ON "PasswordResetCode"("email", "code");

-- CreateTable: Shift
CREATE TABLE "Shift" (
    "id" SERIAL NOT NULL,
    "cashierId" INTEGER NOT NULL,
    "openingFloat" DOUBLE PRECISION NOT NULL,
    "closingCash" DOUBLE PRECISION,
    "expectedCash" DOUBLE PRECISION,
    "cashSales" DOUBLE PRECISION,
    "gcashSales" DOUBLE PRECISION,
    "overageShortage" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "verifiedBy" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "verificationNotes" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
