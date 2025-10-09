// Database Service - Fixed version with proper type conversion
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
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

    // Ecommerce API configuration
    this.ecommerceApiUrl = process.env.ECOMMERCE_API_URL || 'http://localhost:5000';
    this.ecommerceApiToken = process.env.ECOMMERCE_API_TOKEN;

    // Create axios instance with authentication
    this.ecommerceClient = axios.create({
      baseURL: this.ecommerceApiUrl,
      headers: {
        'X-Internal-API-Token': this.ecommerceApiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    logger.info('DatabaseService initialized', {
      ecommerceApiUrl: this.ecommerceApiUrl,
      hasApiToken: !!this.ecommerceApiToken
    });

  }

  // === ECOMMERCE DATABASE OPERATIONS (Using raw SQL) ===

  /**
   * Get single product by ID from ecommerce database
   * FIXED: Properly convert productId to integer to avoid type mismatch
   */
  async getEcommerceProduct(productId, language = 'uk') {
    try {
      const id = parseInt(productId);

      if (isNaN(id)) {
        throw new Error(`Invalid product ID: ${productId}. Must be a number.`);
      }

      logger.info('Fetching product from Ecommerce API', {
        productId: id,
        language: language
      });

      // Make API request with language parameter
      const response = await this.ecommerceClient.get(`/api/products/${id}`, {
        params: { lang: language }
      });

      const product = response.data;

      logger.info('Product retrieved from Ecommerce API', {
        productId: id,
        name: product.name,
        language: language,
        price: product.price
      });

      return product;

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('Product not found in Ecommerce API', {
          productId,
          language
        });
        throw new Error(`Product with ID ${productId} not found`);
      }

      logger.error('Failed to get product from Ecommerce API', {
        error: error.message,
        productId,
        language,
        status: error.response?.status
      });
      throw error;
    }
  }

  async getAllEcommerceProducts(language = 'uk') {
    try {
      logger.info('Fetching all products from Ecommerce API', {
        language: language
      });

      const response = await this.ecommerceClient.get('/api/products', {
        params: { lang: language }
      });

      const products = response.data;

      logger.info('All products retrieved from Ecommerce API', {
        count: products.length,
        language: language
      });

      return products;

    } catch (error) {
      logger.error('Failed to get all products from Ecommerce API', {
        error: error.message,
        language
      });
      throw error;
    }
  }

  // Get ecommerce products by IDs
  async getEcommerceProductsByIds(productIds, language = 'uk') {
    try {
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return [];
      }

      // Convert all IDs to integers
      const convertedIds = productIds.map(id => {
        const convertedId = parseInt(id);
        if (isNaN(convertedId)) {
          throw new Error(`Invalid product ID: ${id}. Must be a number.`);
        }
        return convertedId;
      });

      logger.info('Fetching products by IDs from Ecommerce API', {
        productIds: convertedIds,
        language: language
      });

      // Fetch products individually
      const productPromises = convertedIds.map(id =>
        this.getEcommerceProduct(id, language)
      );

      const products = await Promise.all(productPromises);

      logger.info('Products by IDs retrieved from Ecommerce API', {
        count: products.length,
        language: language
      });

      return products;

    } catch (error) {
      logger.error('Failed to get products by IDs from Ecommerce API', {
        error: error.message,
        productIds,
        language
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
      ecommerceApi: { status: 'unknown' }  // ← новое название
    };

    try {
      await this.crmDb.$queryRaw`SELECT 1`;
      results.crm = { status: 'connected' };
    } catch (error) {
      results.crm = { status: 'disconnected', error: error.message };
    }

    // Check Ecommerce API instead of DB
    try {
      await this.ecommerceClient.get('/api/products', {
        params: { limit: 1 }
      });
      results.ecommerceApi = {
        status: 'connected',
        url: this.ecommerceApiUrl
      };
    } catch (error) {
      results.ecommerceApi = {
        status: 'disconnected',
        error: error.message,
        url: this.ecommerceApiUrl
      };
    }

    logger.info('Health check completed', results);
    return results;
  }


  async disconnect() {
    try {
      await this.crmDb.$disconnect();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error closing database connections', {
        error: error.message
      });
    }
  }

  // === CART OPERATIONS ===

  async addToCart(contactId, telegramId, productData) {
    try {
      const { productId, productName, quantity, price, weightKg } = productData;

      // Check if item already exists in cart
      const existingItem = await this.crmDb.botCartItem.findFirst({
        where: {
          contactId: contactId,
          productId: parseInt(productId)
        }
      });

      if (existingItem) {
        // Update existing item
        const newQuantity = existingItem.quantity + parseInt(quantity);
        const newTotal = newQuantity * parseFloat(price);

        const updatedItem = await this.crmDb.botCartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: newQuantity,
            total: newTotal,
            weightKg: parseFloat(weightKg) || 0
          }
        });

        logger.info('Cart item updated', { contactId, productId, newQuantity });
        return updatedItem;
      } else {
        // Create new item
        const cartItem = await this.crmDb.botCartItem.create({
          data: {
            telegramId: telegramId,
            contactId: contactId,
            productId: parseInt(productId),
            productName: productName,
            quantity: parseInt(quantity),
            price: parseFloat(price),
            weightKg: parseFloat(weightKg) || 0,
            total: parseInt(quantity) * parseFloat(price)
          }
        });

        logger.info('Cart item added', { contactId, productId, quantity });
        return cartItem;
      }
    } catch (error) {
      logger.error('Failed to add to cart', {
        error: error.message,
        contactId,
        productData
      });
      throw error;
    }
  }

  async getCart(contactId) {
    try {
      const cartItems = await this.crmDb.botCartItem.findMany({
        where: { contactId: contactId },
        orderBy: { createdAt: 'asc' }
      });

      const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
      const totalAmount = cartItems.reduce((sum, item) => sum + parseFloat(item.total), 0);
      const totalWeight = cartItems.reduce((sum, item) => sum + parseFloat(item.weightKg), 0);

      logger.info('Cart retrieved', { contactId, totalItems, totalAmount });

      return {
        items: cartItems,
        totalItems,
        totalAmount,
        totalWeight,
        isEmpty: cartItems.length === 0
      };
    } catch (error) {
      logger.error('Failed to get cart', {
        error: error.message,
        contactId
      });
      throw error;
    }
  }

  async clearCart(contactId) {
    try {
      const deletedCount = await this.crmDb.botCartItem.deleteMany({
        where: { contactId: contactId }
      });

      logger.info('Cart cleared', { contactId, deletedCount: deletedCount.count });
      return deletedCount;
    } catch (error) {
      logger.error('Failed to clear cart', {
        error: error.message,
        contactId
      });
      throw error;
    }
  }

  async updateCartItem(itemId, newQuantity) {
    try {
      // Get the item first to calculate new total
      const item = await this.crmDb.botCartItem.findUnique({
        where: { id: parseInt(itemId) }
      });

      if (!item) {
        throw new Error('Cart item not found');
      }

      // Calculate new total
      const newTotal = parseInt(newQuantity) * parseFloat(item.price);

      // Update the item
      const updatedItem = await this.crmDb.botCartItem.update({
        where: { id: parseInt(itemId) },
        data: {
          quantity: parseInt(newQuantity),
          total: newTotal
        }
      });

      logger.info('Cart item updated', {
        itemId,
        oldQuantity: item.quantity,
        newQuantity: parseInt(newQuantity),
        newTotal
      });

      return updatedItem;
    } catch (error) {
      logger.error('Failed to update cart item', {
        error: error.message,
        itemId,
        newQuantity
      });
      throw error;
    }
  }

}

