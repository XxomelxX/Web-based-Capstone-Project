-- Per-FIFO-batch selling price (centavos). Null keeps the legacy behavior:
-- the unit sells at Product.price. Sales consume oldest-batch-first and each
-- consumed slice is charged its own layer price, falling back to Product.price.
ALTER TABLE "StockBatch" ADD COLUMN IF NOT EXISTS "pricePerUnit" INTEGER;
