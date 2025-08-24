// Database Service - Fixed version with proper type conversion
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

  /**
   * Get single product by ID from ecommerce database
   * FIXED: Properly convert productId to integer to avoid type mismatch
   */
  async getEcommerceProduct(productId) {
    try {
      // Convert productId to integer to avoid type mismatch
      const id = parseInt(productId);
      
      if (isNaN(id)) {
        throw new Error(`Invalid product ID: ${productId}. Must be a number.`);
      }

      const products = await this.ecommerceDb.$queryRaw`
        SELECT 
          id,
          name,
          description,
          price,
          images,
          stock,
          "createdAt",
          "updatedAt",
          "categoryId"
        FROM "Product" 
        WHERE id = ${id}
      `;

      if (!products || products.length === 0) {
        throw new Error(`Product with ID ${productId} not found or not active`);
      }

      const foundProduct = products[0];
      
      logger.info('Single ecommerce product retrieved', { 
        productId: id, 
        name: foundProduct.name,
        price: foundProduct.price 
      });
      
      return foundProduct;
    } catch (error) {
      logger.error('Failed to get single ecommerce product', {
        error: error.message,
        productId,
        convertedId: parseInt(productId)
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

      // Convert all IDs to integers
      const convertedIds = productIds.map(id => {
        const convertedId = parseInt(id);
        if (isNaN(convertedId)) {
          throw new Error(`Invalid product ID: ${id}. Must be a number.`);
        }
        return convertedId;
      });

      // Create placeholders for IN clause
      const placeholders = convertedIds.map(() => '?').join(',');
      
      const products = await this.ecommerceDb.$queryRawUnsafe(`
        SELECT 
          id,
          name,
          description,
          price,
          images,
          "createdAt",
          "updatedAt"
        FROM "Product" 
        WHERE id IN (${placeholders})
        ORDER BY id ASC
      `, ...convertedIds);

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

  // === CRM DATABASE OPERATIONS ===

  async saveBotOrder(orderData) {
    try {
      const order = await this.crmDb.botOrder.create({
        data: {
          botOrderId: orderData.botOrderId,
          source: orderData.source,
          chatId: orderData.chatId,
          sendpulseDealId: orderData.sendpulseDealId,
          sendpulseContactId: orderData.sendpulseContactId,
          customerPhone: orderData.customerPhone,
          customerName: orderData.customerName,
          totalAmount: parseFloat(orderData.totalAmount),
          paymentMethod: orderData.paymentMethod,
          deliveryInfo: JSON.stringify(orderData.deliveryInfo),
          notes: orderData.notes,
          products: JSON.stringify(orderData.products),
          status: 'created'
        }
      });

      logger.info('Bot order saved', { 
        botOrderId: orderData.botOrderId,
        crmId: order.id 
      });

      return order;
    } catch (error) {
      logger.error('Failed to save bot order', {
        error: error.message,
        botOrderId: orderData.botOrderId
      });
      throw error;
    }
  }

  async getBotOrder(botOrderId) {
    try {
      const order = await this.crmDb.botOrder.findFirst({
        where: { botOrderId: botOrderId }
      });

      if (!order) {
        throw new Error(`Bot order ${botOrderId} not found`);
      }

      logger.info('Bot order retrieved', { botOrderId });
      return order;
    } catch (error) {
      logger.error('Failed to get bot order', {
        error: error.message,
        botOrderId
      });
      throw error;
    }
  }

  async updateBotOrder(botOrderId, updateData) {
    try {
      const updatedOrder = await this.crmDb.botOrder.update({
        where: { botOrderId: botOrderId },
        data: updateData
      });

      logger.info('Bot order updated', { botOrderId });
      return updatedOrder;
    } catch (error) {
      logger.error('Failed to update bot order', {
        error: error.message,
        botOrderId
      });
      throw error;
    }
  }

  // === PRODUCT MAPPING OPERATIONS ===

  async saveProductMapping(ecommerceId, sendpulseId, name) {
    try {
      // Convert IDs to proper types
      const ecomId = parseInt(ecommerceId);
      const spId = parseInt(sendpulseId);
      
      if (isNaN(ecomId) || isNaN(spId)) {
        throw new Error('Both ecommerceId and sendpulseId must be valid numbers');
      }

      const mapping = await this.crmDb.productMapping.create({
        data: {
          ecommerceId: ecomId,
          sendpulseId: spId,
          name: name
        }
      });

      logger.info('Product mapping saved', { 
        ecommerceId: ecomId, 
        sendpulseId: spId 
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
      const id = parseInt(ecommerceId);
      
      if (isNaN(id)) {
        throw new Error(`Invalid ecommerce ID: ${ecommerceId}. Must be a number.`);
      }

      const mapping = await this.crmDb.productMapping.findFirst({
        where: { 
          ecommerceId: id 
        }
      });

      if (!mapping) {
        logger.warn('Product mapping not found', { ecommerceId: id });
        return null;
      }

      logger.debug('Product mapping retrieved', { 
        ecommerceId: id, 
        sendpulseId: mapping.sendpulseId 
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
        
        orderBy: { ecommerceId: 'asc' }
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

  async getProductsWithMappings() {
    try {
      const mappings = await this.getAllProductMappings();
      const productsWithMappings = [];

      for (const mapping of mappings) {
        try {
          const ecommerceProduct = await this.getEcommerceProduct(mapping.ecommerceId);
          
          productsWithMappings.push({
            ...ecommerceProduct,
            sendpulseId: mapping.sendpulseId,
            isSyncedToSendPulse: true
          });
        } catch (error) {
          logger.warn('Failed to get ecommerce product for mapping', {
            mappingId: mapping.id,
            ecommerceId: mapping.ecommerceId,
            error: error.message
          });
        }
      }

      logger.info('Products with mappings retrieved', { count: productsWithMappings.length });
      return productsWithMappings;
    } catch (error) {
      logger.error('Failed to get products with mappings', {
        error: error.message
      });
      throw error;
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