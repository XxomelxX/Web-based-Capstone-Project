-- Enforce non-negative stock at the database level (defense in depth behind the
-- guarded updateMany writes in checkout/utang/sync). App guards race at the
-- row level; CHECK constraints guarantee no path can persist negative stock.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_stock_non_negative'
  ) THEN
    ALTER TABLE "Product" ADD CONSTRAINT product_stock_non_negative CHECK (stock >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stockbatch_remaining_non_negative'
  ) THEN
    ALTER TABLE "StockBatch" ADD CONSTRAINT stockbatch_remaining_non_negative CHECK ("quantityRemaining" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'utang_remaining_non_negative'
  ) THEN
    ALTER TABLE "UtangEntry" ADD CONSTRAINT utang_remaining_non_negative CHECK ("remainingBalance" >= 0);
  END IF;
END
$$;

-- Payment cashier attribution (audit trail: who recorded each payment).
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "recordedBy" INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_recordedBy_fkey'
  ) THEN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedBy_fkey"
      FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- One open shift per cashier, enforced by the database (the API's
-- check-then-create raced across two devices / double-taps).
-- Partial unique index: only rows with status='open' participate, so each
-- cashier keeps unlimited closed history but at most one open shift.
CREATE UNIQUE INDEX IF NOT EXISTS "Shift_cashierId_open_unique"
  ON "Shift"("cashierId") WHERE status = 'open';
