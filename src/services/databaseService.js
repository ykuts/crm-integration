// Database Service - Fixed version using raw queries for ecommerce DB
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger.js';

export class DatabaseService {
  constructor() {
    // CRM database (our new database with full schema)
    this.crmDb = new PrismaClient({
      datasources: {
        db: {
          url: process.env.CRM_DATABASE_URL
        }
      }
    });

    // For ecommerce DB, we'll use raw queries since we don't have the schema
    // We'll create a separate client just for raw queries
    this.ecommerceDb = new PrismaClient({
      datasources: {
        db: {
          url: process.env.ECOMMERCE_DATABASE_URL
        }
      }
    });
  }

  // === ECOMMERCE DATABASE OPERATIONS (Using raw SQL) ===

  async getEcommerceProduct(productId) {
    try {
      // Use raw query to get product from ecommerce DB
      const products = await this.ecommerceDb.$queryRaw`
        SELECT 
          id,
          name,
          description,
          price,
          images,
          "isActive",
          "createdAt",
          "updatedAt"
        FROM "Product" 
        WHERE id = ${productId}
      `;

      if (products.length === 0) {
        throw new Error(`Product ${productId} not found in ecommerce database`);
      }

      const product = products[0];
      logger.info('Ecommerce product retrieved', { productId, name: product.name });
      return product;
    } catch (error) {
      logger.error('Failed to get ecommerce product', {
        error: error.message,
        productId
      });
      throw error;
    }
  }

  async getAllEcommerceProducts() {
    try {
      // Use raw query to get all products from ecommerce DB
      const products = await this.ecommerceDb.$queryRaw`
        SELECT 
          id,
          name,
          description,
          price,
          images,
          "isActive",
          "createdAt",
          "updatedAt"
        FROM "Product" 
        ORDER BY id ASC
      `;

      logger.info('All ecommerce products retrieved', { count: products.length });
      return products;
    } catch (error) {
      logger.error('Failed to get all ecommerce products', {
        error: error.message
      });
      throw error;
    }
  }

  // Get ecommerce products by IDs
  async getEcommerceProductsByIds(productIds) {
    try {
      if (productIds.length === 0) return [];

      // Create placeholders for IN clause
      const placeholders = productIds.map(() => '?').join(',');
      
      const products = await this.ecommerceDb.$queryRawUnsafe(`
        SELECT 
          id,
          name,
          description,
          price,
          images,
          "isActive",
          "createdAt",
          "updatedAt"
        FROM "Product" 
        WHERE id IN (${placeholders})
        ORDER BY id ASC
      `, ...productIds);

      logger.info('Ecommerce products by IDs retrieved', { 
        requestedCount: productIds.length,
        foundCount: products.length 
      });
      
      return products;
    } catch (error) {
      logger.error('Failed to get ecommerce products by IDs', {
        error: error.message,
        productIds
      });
      throw error;
    }
  }

  // === PRODUCT MAPPING OPERATIONS ===

  async saveProductMapping(ecommerceId, sendpulseId, name = null) {
    try {
      const mapping = await this.crmDb.productMapping.upsert({
        where: { ecommerceId },
        update: {
          sendpulseId,
          name,
          lastSyncAt: new Date(),
          syncStatus: 'SYNCED'
        },
        create: {
          ecommerceId,
          sendpulseId,
          name,
          lastSyncAt: new Date(),
          syncStatus: 'SYNCED'
        }
      });

      logger.info('Product mapping saved', {
        ecommerceId,
        sendpulseId,
        mappingId: mapping.id
      });

      return mapping;
    } catch (error) {
      logger.error('Failed to save product mapping', {
        error: error.message,
        ecommerceId,
        sendpulseId
      });
      throw error;
    }
  }

  async getProductMapping(ecommerceId) {
    try {
      const mapping = await this.crmDb.productMapping.findUnique({
        where: { ecommerceId }
      });

      return mapping;
    } catch (error) {
      logger.error('Failed to get product mapping', {
        error: error.message,
        ecommerceId
      });
      throw error;
    }
  }

  async getAllProductMappings() {
    try {
      const mappings = await this.crmDb.productMapping.findMany({
        orderBy: {
          ecommerceId: 'asc'
        }
      });

      logger.info('All product mappings retrieved', { count: mappings.length });
      return mappings;
    } catch (error) {
      logger.error('Failed to get all product mappings', {
        error: error.message
      });
      throw error;
    }
  }

  // Get products with their SendPulse mappings
  async getProductsWithMappings() {
    try {
      const ecommerceProducts = await this.getAllEcommerceProducts();
      const mappings = await this.getAllProductMappings();

      // Create mapping lookup
      const mappingMap = new Map(
        mappings.map(m => [m.ecommerceId, m])
      );

      // Enrich products with mapping data
      const enrichedProducts = ecommerceProducts.map(product => ({
        ...product,
        mapping: mappingMap.get(product.id) || null,
        isSyncedToSendPulse: mappingMap.has(product.id),
        sendpulseId: mappingMap.get(product.id)?.sendpulseId || null
      }));

      logger.info('Products with mappings retrieved', { 
        totalProducts: ecommerceProducts.length,
        mappedProducts: mappings.length 
      });

      return enrichedProducts;
    } catch (error) {
      logger.error('Failed to get products with mappings', {
        error: error.message
      });
      throw error;
    }
  }

  // === CUSTOMER MAPPING OPERATIONS ===

  async saveCustomerMapping(sendpulseId, phone, source, ecommerceId = null) {
    try {
      const mapping = await this.crmDb.customerMapping.create({
        data: {
          ecommerceId,
          sendpulseId,
          phone,
          source
        }
      });

      logger.info('Customer mapping saved', {
        sendpulseId,
        phone,
        source,
        mappingId: mapping.id
      });

      return mapping;
    } catch (error) {
      logger.error('Failed to save customer mapping', {
        error: error.message,
        sendpulseId,
        phone
      });
      throw error;
    }
  }

  async findCustomerMappingByPhone(phone) {
    try {
      const mapping = await this.crmDb.customerMapping.findFirst({
        where: { phone }
      });

      return mapping;
    } catch (error) {
      logger.error('Failed to find customer mapping by phone', {
        error: error.message,
        phone
      });
      throw error;
    }
  }

  // === BOT ORDER OPERATIONS ===

  async saveBotOrder(orderData) {
    try {
      const {
        botOrderId,
        source,
        chatId,
        sendpulseDealId,
        sendpulseContactId,
        customerPhone,
        customerName,
        totalAmount,
        paymentMethod,
        deliveryInfo,
        notes,
        products
      } = orderData;

      const botOrder = await this.crmDb.botOrder.create({
        data: {
          botOrderId,
          source,
          chatId,
          sendpulseDealId,
          sendpulseContactId,
          customerPhone,
          customerName,
          totalAmount,
          paymentMethod,
          deliveryInfo: deliveryInfo ? JSON.stringify(deliveryInfo) : null,
          notes,
          products: JSON.stringify(products),
          status: 'CREATED'
        }
      });

      // Save order products details
      if (products && products.length > 0) {
        await this.saveBotOrderProducts(botOrder.id, products);
      }

      logger.info('Bot order saved', {
        botOrderId,
        orderId: botOrder.id,
        sendpulseDealId
      });

      return botOrder;
    } catch (error) {
      logger.error('Failed to save bot order', {
        error: error.message,
        botOrderId: orderData.botOrderId
      });
      throw error;
    }
  }

  async saveBotOrderProducts(botOrderId, products) {
    try {
      const orderProducts = [];

      for (const product of products) {
        const mapping = await this.getProductMapping(product.id);
        
        orderProducts.push({
          botOrderId,
          ecommerceProductId: product.id,
          sendpulseProductId: mapping?.sendpulseId || null,
          quantity: product.quantity,
          unitPrice: product.unitPrice,
          totalPrice: product.totalPrice
        });
      }

      if (orderProducts.length > 0) {
        await this.crmDb.botOrderProduct.createMany({
          data: orderProducts
        });
      }

      logger.info('Bot order products saved', {
        botOrderId,
        productCount: orderProducts.length
      });

      return orderProducts;
    } catch (error) {
      logger.error('Failed to save bot order products', {
        error: error.message,
        botOrderId
      });
      throw error;
    }
  }

  async getBotOrder(botOrderId) {
    try {
      const botOrder = await this.crmDb.botOrder.findUnique({
        where: { botOrderId },
        include: {
          orderProducts: true
        }
      });

      return botOrder;
    } catch (error) {
      logger.error('Failed to get bot order', {
        error: error.message,
        botOrderId
      });
      throw error;
    }
  }

  async updateBotOrderStatus(botOrderId, status, errorMessage = null) {
    try {
      const updatedOrder = await this.crmDb.botOrder.update({
        where: { botOrderId },
        data: {
          status,
          errorMessage
        }
      });

      logger.info('Bot order status updated', {
        botOrderId,
        status
      });

      return updatedOrder;
    } catch (error) {
      logger.error('Failed to update bot order status', {
        error: error.message,
        botOrderId,
        status
      });
      throw error;
    }
  }

  // === SYNC LOG OPERATIONS ===

  async logSyncOperation(operation, entityType, entityId, status, message, details = null, duration = null) {
    try {
      const log = await this.crmDb.syncLog.create({
        data: {
          operation,
          entityType,
          entityId,
          status,
          message,
          details: details ? JSON.stringify(details) : null,
          duration
        }
      });

      return log;
    } catch (error) {
      logger.error('Failed to log sync operation', {
        error: error.message,
        operation
      });
      // Don't throw error for logging failures
    }
  }

  // === UTILITY METHODS ===

  async healthCheck() {
    const results = {
      crm: { status: 'unknown' },
      ecommerce: { status: 'unknown' }
    };

    try {
      await this.crmDb.$queryRaw`SELECT 1`;
      results.crm = { status: 'connected' };
    } catch (error) {
      results.crm = { status: 'disconnected', error: error.message };
    }

    try {
      await this.ecommerceDb.$queryRaw`SELECT 1`;
      results.ecommerce = { status: 'connected' };
    } catch (error) {
      results.ecommerce = { status: 'disconnected', error: error.message };
    }

    logger.info('Database health check completed', results);
    return results;
  }

  // Test ecommerce database structure
  async testEcommerceSchema() {
    try {
      // Try to get table information
      const tables = await this.ecommerceDb.$queryRaw`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;

      logger.info('Ecommerce database tables', { tables });

      // Try to get Product table columns
      const productColumns = await this.ecommerceDb.$queryRaw`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'Product' 
        AND table_schema = 'public'
        ORDER BY ordinal_position
      `;

      logger.info('Product table columns', { productColumns });

      return { tables, productColumns };
    } catch (error) {
      logger.error('Failed to test ecommerce schema', { error: error.message });
      throw error;
    }
  }

  async disconnect() {
    try {
      await this.crmDb.$disconnect();
      await this.ecommerceDb.$disconnect();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error closing database connections', {
        error: error.message
      });
    }
  }
}