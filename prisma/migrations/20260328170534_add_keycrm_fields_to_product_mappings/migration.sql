-- AlterTable
ALTER TABLE "product_mappings" ADD COLUMN     "keycrm_id" INTEGER,
ADD COLUMN     "keycrm_sku" TEXT;

-- CreateIndex
CREATE INDEX "product_mappings_keycrm_sku_idx" ON "product_mappings"("keycrm_sku");
