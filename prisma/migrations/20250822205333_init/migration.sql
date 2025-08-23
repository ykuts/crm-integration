-- CreateTable
CREATE TABLE "product_mappings" (
    "id" SERIAL NOT NULL,
    "ecommerce_id" INTEGER NOT NULL,
    "sendpulse_id" INTEGER NOT NULL,
    "name" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_mappings" (
    "id" SERIAL NOT NULL,
    "ecommerce_id" INTEGER,
    "sendpulse_id" INTEGER NOT NULL,
    "phone" TEXT,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_orders" (
    "id" SERIAL NOT NULL,
    "bot_order_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "sendpulse_deal_id" INTEGER,
    "sendpulse_contact_id" INTEGER,
    "customer_phone" TEXT NOT NULL,
    "customer_name" TEXT,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "payment_method" TEXT,
    "delivery_info" TEXT,
    "notes" TEXT,
    "products" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_order_products" (
    "id" SERIAL NOT NULL,
    "bot_order_id" INTEGER NOT NULL,
    "ecommerce_product_id" INTEGER NOT NULL,
    "sendpulse_product_id" INTEGER,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total_price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "bot_order_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" SERIAL NOT NULL,
    "operation" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "details" TEXT,
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_config" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_mappings_ecommerce_id_key" ON "product_mappings"("ecommerce_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_orders_bot_order_id_key" ON "bot_orders"("bot_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_config_key_key" ON "service_config"("key");

-- AddForeignKey
ALTER TABLE "bot_order_products" ADD CONSTRAINT "bot_order_products_bot_order_id_fkey" FOREIGN KEY ("bot_order_id") REFERENCES "bot_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
