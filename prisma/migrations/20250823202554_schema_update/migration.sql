/*
  Warnings:

  - You are about to drop the column `currency` on the `bot_orders` table. All the data in the column will be lost.
  - You are about to drop the column `error_message` on the `bot_orders` table. All the data in the column will be lost.
  - You are about to drop the column `source` on the `customer_mappings` table. All the data in the column will be lost.
  - You are about to drop the column `syncStatus` on the `product_mappings` table. All the data in the column will be lost.
  - You are about to drop the `bot_order_products` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `service_config` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sync_logs` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[phone]` on the table `customer_mappings` will be added. If there are existing duplicate values, this will fail.
  - Made the column `customer_name` on table `bot_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `payment_method` on table `bot_orders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `delivery_info` on table `bot_orders` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `first_name` to the `customer_mappings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `last_name` to the `customer_mappings` table without a default value. This is not possible if the table is not empty.
  - Made the column `phone` on table `customer_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `name` on table `product_mappings` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "bot_order_products" DROP CONSTRAINT "bot_order_products_bot_order_id_fkey";

-- AlterTable
ALTER TABLE "bot_orders" DROP COLUMN "currency",
DROP COLUMN "error_message",
ADD COLUMN     "customer_email" TEXT,
ADD COLUMN     "metadata" TEXT NOT NULL DEFAULT '{}',
ALTER COLUMN "sendpulse_deal_id" SET DATA TYPE TEXT,
ALTER COLUMN "sendpulse_contact_id" SET DATA TYPE TEXT,
ALTER COLUMN "customer_name" SET NOT NULL,
ALTER COLUMN "payment_method" SET NOT NULL,
ALTER COLUMN "delivery_info" SET NOT NULL;

-- AlterTable
ALTER TABLE "customer_mappings" DROP COLUMN "source",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "first_name" TEXT NOT NULL,
ADD COLUMN     "last_name" TEXT NOT NULL,
ADD COLUMN     "last_sync_at" TIMESTAMP(3),
ADD COLUMN     "sync_status" TEXT NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "sendpulse_id" SET DATA TYPE TEXT,
ALTER COLUMN "phone" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_mappings" DROP COLUMN "syncStatus",
ADD COLUMN     "sync_status" TEXT NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "name" SET NOT NULL;

-- DropTable
DROP TABLE "bot_order_products";

-- DropTable
DROP TABLE "service_config";

-- DropTable
DROP TABLE "sync_logs";

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_success" INTEGER NOT NULL DEFAULT 0,
    "items_error" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "error_details" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT,
    "headers" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_logs" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "user_type" TEXT,
    "user_id" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "response_time" INTEGER,
    "context" TEXT NOT NULL DEFAULT '{}',
    "error_message" TEXT,

    CONSTRAINT "api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_jobs_job_type_idx" ON "sync_jobs"("job_type");

-- CreateIndex
CREATE INDEX "sync_jobs_status_idx" ON "sync_jobs"("status");

-- CreateIndex
CREATE INDEX "sync_jobs_created_at_idx" ON "sync_jobs"("created_at");

-- CreateIndex
CREATE INDEX "webhook_events_source_idx" ON "webhook_events"("source");

-- CreateIndex
CREATE INDEX "webhook_events_event_type_idx" ON "webhook_events"("event_type");

-- CreateIndex
CREATE INDEX "webhook_events_processed_idx" ON "webhook_events"("processed");

-- CreateIndex
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- CreateIndex
CREATE INDEX "api_logs_endpoint_idx" ON "api_logs"("endpoint");

-- CreateIndex
CREATE INDEX "api_logs_status_code_idx" ON "api_logs"("status_code");

-- CreateIndex
CREATE INDEX "api_logs_user_type_idx" ON "api_logs"("user_type");

-- CreateIndex
CREATE INDEX "api_logs_created_at_idx" ON "api_logs"("created_at");

-- CreateIndex
CREATE INDEX "bot_orders_bot_order_id_idx" ON "bot_orders"("bot_order_id");

-- CreateIndex
CREATE INDEX "bot_orders_source_idx" ON "bot_orders"("source");

-- CreateIndex
CREATE INDEX "bot_orders_customer_phone_idx" ON "bot_orders"("customer_phone");

-- CreateIndex
CREATE INDEX "bot_orders_status_idx" ON "bot_orders"("status");

-- CreateIndex
CREATE INDEX "bot_orders_created_at_idx" ON "bot_orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_mappings_phone_key" ON "customer_mappings"("phone");

-- CreateIndex
CREATE INDEX "customer_mappings_phone_idx" ON "customer_mappings"("phone");

-- CreateIndex
CREATE INDEX "customer_mappings_email_idx" ON "customer_mappings"("email");

-- CreateIndex
CREATE INDEX "customer_mappings_sendpulse_id_idx" ON "customer_mappings"("sendpulse_id");

-- CreateIndex
CREATE INDEX "product_mappings_ecommerce_id_idx" ON "product_mappings"("ecommerce_id");

-- CreateIndex
CREATE INDEX "product_mappings_sendpulse_id_idx" ON "product_mappings"("sendpulse_id");
