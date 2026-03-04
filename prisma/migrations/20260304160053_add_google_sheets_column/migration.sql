-- AlterTable
ALTER TABLE "product_mappings" ADD COLUMN     "google_sheets_column" TEXT;

-- CreateIndex
CREATE INDEX "product_mappings_google_sheets_column_idx" ON "product_mappings"("google_sheets_column");
