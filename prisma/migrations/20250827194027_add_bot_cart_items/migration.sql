/*
  Warnings:

  - You are about to drop the `sync_jobs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `webhook_events` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "sync_jobs";

-- DropTable
DROP TABLE "webhook_events";

-- CreateTable
CREATE TABLE "bot_cart_items" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "weight_kg" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "bot_cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_cart_items_telegram_id_idx" ON "bot_cart_items"("telegram_id");

-- CreateIndex
CREATE INDEX "bot_cart_items_contact_id_idx" ON "bot_cart_items"("contact_id");

-- CreateIndex
CREATE INDEX "bot_cart_items_product_id_idx" ON "bot_cart_items"("product_id");
