// src/controllers/botController.js - FINAL CLEAN VERSION
import { EnhancedCrmService } from '../services/enhancedCrmService.js';
import { DatabaseService } from '../services/databaseService.js';
import logger from '../utils/logger.js';

export class BotController {
  constructor() {
    this.dbService = new DatabaseService();
    this.crmService = new EnhancedCrmService(); // ✅ Use the enhanced service
  }

  /**
   * Main method - use EnhancedCrmService for everything
   * Creates order in BOTH ecommerce DB and SendPulse CRM
   */
  async createOrder(orderData) {
    try {
      logger.info('Creating telegram order via EnhancedCrmService', {
        contact_id: orderData.contact_id,
        productCount: orderData.products?.length,
        source: orderData.source
      });

      // ✅ SIMPLE: Just use the enhanced service that does everything
      const result = await this.crmService.createTelegramOrderComplete(orderData);

      logger.info('Enhanced order creation successful', {
        botOrderId: result.botOrderId,
        ecommerceOrderId: result.ecommerceOrderId,
        crmOrderId: result.crmOrderId,
        orderNumber: result.orderNumber
      });

      return result;

    } catch (error) {
      logger.error('Enhanced order creation failed', {
        error: error.message,
        stack: error.stack,
        orderData: {
          contact_id: orderData.contact_id,
          source: orderData.source,
          productCount: orderData.products?.length
        }
      });
      throw error;
    }
  }

  /**
   * LEGACY: Backward compatibility method - redirect to enhanced
   */
  async createOrderEnhanced(orderData) {
    logger.info('Using deprecated createOrderEnhanced - redirecting to enhanced service');
    return this.createOrder(orderData);
  }

  /**
   * Get order status - check both systems
   */
  async getOrderStatus(botOrderId) {
    try {
      // Check if we have this order in CRM database
      const crmOrder = await this.dbService.getBotOrder(botOrderId);
      
      if (!crmOrder) {
        return {
          success: false,
          error: 'Order not found',
          botOrderId
        };
      }

      // Get additional status from ecommerce DB if we have the ID
      let ecommerceStatus = null;
      if (crmOrder.ecommerceOrderId) {
        try {
          ecommerceStatus = await this.dbService.getEcommerceOrderStatus(crmOrder.ecommerceOrderId);
        } catch (error) {
          logger.warn('Could not fetch ecommerce status', {
            ecommerceOrderId: crmOrder.ecommerceOrderId,
            error: error.message
          });
        }
      }

      return {
        success: true,
        botOrderId,
        order: {
          // CRM data
          status: crmOrder.status,
          totalAmount: crmOrder.totalAmount,
          createdAt: crmOrder.createdAt,
          customerName: crmOrder.customerName,
          customerPhone: crmOrder.customerPhone,
          // Link IDs
          ecommerceOrderId: crmOrder.ecommerceOrderId,
          crmOrderId: crmOrder.sendpulseDealId,
          // Ecommerce status if available
          ecommerceStatus: ecommerceStatus?.status,
          paymentStatus: ecommerceStatus?.paymentStatus,
          shippingStatus: ecommerceStatus?.shippingStatus
        }
      };

    } catch (error) {
      logger.error('Get order status failed', {
        error: error.message,
        botOrderId
      });
      throw error;
    }
  }

  /**
   * Update order - delegate to services
   */
  async updateOrder(botOrderId, updateData) {
    try {
      logger.info('Updating bot order', { botOrderId });

      const botOrder = await this.dbService.getBotOrder(botOrderId);
      if (!botOrder) {
        throw new Error('Order not found');
      }

      // Update status in CRM database
      await this.dbService.updateBotOrder(
        botOrderId,
        updateData.status,
        updateData.notes
      );

      // If we need to update the SendPulse deal, delegate to service
      if (updateData.crmUpdate && botOrder.sendpulseDealId) {
        try {
          await this.crmService.updateDeal(botOrder.sendpulseDealId, updateData);
        } catch (error) {
          logger.warn('Failed to update CRM deal', {
            error: error.message,
            dealId: botOrder.sendpulseDealId
          });
        }
      }

      logger.info('Bot order updated successfully', { 
        botOrderId, 
        status: updateData.status 
      });

      return {
        success: true,
        botOrderId,
        status: updateData.status,
        message: 'Order updated successfully'
      };

    } catch (error) {
      logger.error('Bot order update failed', {
        error: error.message,
        botOrderId
      });
      throw error;
    }
  }

  /**
   * Get available products - delegate to database service
   */
  async getAvailableProducts() {
    try {
      const productsWithMappings = await this.dbService.getProductsWithMappings();

      const availableProducts = productsWithMappings
        .filter(product => product.isActive && product.isSyncedToSendPulse)
        .map(product => ({
          id: product.id,
          name: product.name,
          description: product.description,
          price: parseFloat(product.price),
          image: product.image,
          isAvailable: product.stock > 0
        }));

      logger.info('Available products retrieved', { count: availableProducts.length });

      return {
        success: true,
        products: availableProducts,
        count: availableProducts.length
      };

    } catch (error) {
      logger.error('Get available products failed', {
        error: error.message
      });
      throw error;
    }
  }

  // ========================================
  // DELEGATE METHODS TO SERVICES
  // ========================================

  /**
   * Delegate token management to CrmService
   */
  async ensureValidToken() {
    return await this.crmService.ensureValidToken();
  }

  /**
   * Delegate contact finding to CrmService
   */
  async findContactByMessengerExternalId(externalId) {
    return await this.crmService.findContactByMessengerExternalId(externalId);
  }
}