// Production Bot Controller - Handle bot order processing
import { DatabaseService } from '../services/databaseService.js';
import axios from 'axios';
import logger from '../utils/logger.js';

export class BotController {
  constructor() {
    this.dbService = new DatabaseService();
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async ensureValidToken() {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post('https://api.sendpulse.com/oauth/access_token', {
      grant_type: 'client_credentials',
      client_id: process.env.SENDPULSE_CLIENT_ID,
      client_secret: process.env.SENDPULSE_CLIENT_SECRET
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 60) * 1000);
    
    return this.accessToken;
  }

  async createOrder(orderData) {
    try {
      const {
        source,
        chatId,
        botOrderId,
        customerInfo,
        products,
        deliveryInfo,
        paymentMethod,
        notes
      } = orderData;

      logger.info('Processing bot order', { botOrderId, source, customerPhone: customerInfo.phone });

      // Step 1: Validate and enrich products
      const enrichedProducts = await this.enrichProductsWithPricing(products);
      const totalAmount = enrichedProducts.reduce((sum, p) => sum + p.totalPrice, 0);

      logger.info('Products enriched', { 
        productCount: enrichedProducts.length, 
        totalAmount 
      });

      // Step 2: Find contact in SendPulse
      const contact = await this.findContactByPhone(customerInfo.phone);
      if (!contact) {
        throw new Error(`Contact with phone ${customerInfo.phone} not found in CRM`);
      }

      logger.info('Contact found', { 
        contactId: contact.id, 
        name: `${contact.firstName} ${contact.lastName}` 
      });

      // Step 3: Create deal in SendPulse
      const deal = await this.createDeal({
        title: `Bot Order - ${enrichedProducts.map(p => p.name).join(', ')}`,
        price: totalAmount,
        currency: 'CHF',
        contact: contact,
        products: enrichedProducts,
        delivery: deliveryInfo,
        source: source
      });

      logger.info('Deal created', { dealId: deal.id, dealName: deal.name });

      // Step 4: Add products to deal
      for (const product of enrichedProducts) {
        await this.addProductToDeal(deal.id, product);
        logger.debug('Product added to deal', { 
          productId: product.sendpulseId, 
          quantity: product.quantity 
        });
      }

      // Step 5: Save bot order mapping
      const botOrderMapping = await this.dbService.saveBotOrder({
        botOrderId,
        source,
        chatId,
        sendpulseDealId: deal.id,
        sendpulseContactId: contact.id,
        customerPhone: customerInfo.phone,
        customerName: `${customerInfo.firstName || ''} ${customerInfo.lastName || ''}`.trim(),
        totalAmount: totalAmount,
        paymentMethod: paymentMethod,
        deliveryInfo: deliveryInfo,
        notes: notes,
        products: enrichedProducts
      });

      logger.info('Bot order completed successfully', {
        botOrderId,
        dealId: deal.id,
        contactId: contact.id,
        totalAmount,
        mappingId: botOrderMapping.id
      });

      return {
        success: true,
        botOrderId,
        crmOrderId: deal.id,
        orderNumber: `SP-${deal.id}`,
        status: 'created',
        totalAmount: totalAmount,
        message: 'Order successfully created in SendPulse CRM'
      };

    } catch (error) {
      logger.error('Bot order creation failed', {
        error: error.message,
        stack: error.stack,
        botOrderId: orderData.botOrderId,
        customerPhone: orderData.customerInfo?.phone
      });

      throw new Error(`Order creation failed: ${error.message}`);
    }
  }

  async updateOrder(botOrderId, updateData) {
    try {
      logger.info('Updating bot order', { botOrderId });

      const botOrder = await this.dbService.getBotOrder(botOrderId);
      if (!botOrder) {
        throw new Error('Order not found');
      }

      // Update status in database
      await this.dbService.updateBotOrderStatus(
        botOrderId, 
        updateData.status, 
        updateData.notes
      );

      // If needed, update deal in SendPulse
      if (updateData.crmUpdate) {
        // Add logic to update deal in SendPulse if needed
      }

      logger.info('Bot order updated successfully', { botOrderId, status: updateData.status });

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

  async getOrderStatus(botOrderId) {
    try {
      const botOrder = await this.dbService.getBotOrder(botOrderId);
      if (!botOrder) {
        throw new Error('Order not found');
      }

      // Optionally get current status from SendPulse
      let crmStatus = null;
      try {
        const dealDetails = await this.getDealDetails(botOrder.sendpulseDealId);
        crmStatus = dealDetails.status;
      } catch (error) {
        logger.warn('Failed to get CRM status', { 
          error: error.message, 
          dealId: botOrder.sendpulseDealId 
        });
      }

      return {
        success: true,
        botOrderId,
        crmOrderId: botOrder.sendpulseDealId,
        status: botOrder.status,
        crmStatus: crmStatus,
        orderNumber: `SP-${botOrder.sendpulseDealId}`,
        totalAmount: parseFloat(botOrder.totalAmount),
        customerPhone: botOrder.customerPhone,
        createdAt: botOrder.createdAt,
        lastUpdated: botOrder.updatedAt
      };

    } catch (error) {
      logger.error('Get order status failed', {
        error: error.message,
        botOrderId
      });

      throw error;
    }
  }

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

  // Helper methods

  async enrichProductsWithPricing(products) {
    const enrichedProducts = [];

    for (const product of products) {
      const ecommerceProduct = await this.dbService.getEcommerceProduct(product.id);
      const mapping = await this.dbService.getProductMapping(product.id);
      
      if (!mapping) {
        throw new Error(`Product ${product.id} is not mapped to SendPulse. Product: ${ecommerceProduct.name}`);
      }

      enrichedProducts.push({
        id: product.id,
        sendpulseId: mapping.sendpulseId,
        name: ecommerceProduct.name,
        description: ecommerceProduct.description,
        quantity: product.quantity,
        unitPrice: parseFloat(ecommerceProduct.price),
        totalPrice: parseFloat(ecommerceProduct.price) * product.quantity
      });
    }

    return enrichedProducts;
  }

  async findContactByPhone(phone) {
    try {
      const response = await axios.post('https://api.sendpulse.com/crm/v1/contacts/get-list', {
        phone: phone,
        limit: 1
      }, {
        headers: {
          'Authorization': `Bearer ${await this.ensureValidToken()}`,
          'Content-Type': 'application/json'
        }
      });

      const contacts = response.data?.data?.list || [];
      return contacts.length > 0 ? contacts[0] : null;

    } catch (error) {
      logger.error('Find contact by phone failed', {
        error: error.message,
        phone: phone
      });
      throw error;
    }
  }

  async createDeal(dealData) {
    try {
      const dealRequest = {
        pipelineId: parseInt(process.env.SENDPULSE_PIPELINE_ID) || 153270,
        stepId: parseInt(process.env.SENDPULSE_STEP_ID) || 529997,
        name: dealData.title,
        price: dealData.price,
        currency: dealData.currency,
        contact: [dealData.contact.id],
        attributes: [
          { attributeId: 922104, value: `${dealData.delivery?.city || 'Unknown'}, ${dealData.delivery?.station || 'Unknown'}` },
          { attributeId: 922108, value: dealData.products.map(p => `${p.name} x${p.quantity}`).join(', ') },
          { attributeId: 922119, value: "Не указано" },
          { attributeId: 922130, value: "Не оплачено" },
          { attributeId: 922253, value: dealData.delivery?.station || 'Unknown' },
          { attributeId: 922255, value: `${dealData.delivery?.city || 'Unknown'}, ${dealData.delivery?.canton || 'Unknown'}` },
          { attributeId: 922259, value: dealData.price.toString() },
          { attributeId: 923272, value: dealData.products.map(p => `${p.name} x${p.quantity}`).join(', ') },
          { attributeId: 923273, value: "uk" },
          { attributeId: 923274, value: `${dealData.contact.firstName || ''} ${dealData.contact.lastName || ''}`.trim() },
          { attributeId: 923275, value: dealData.delivery?.canton || 'Unknown' },
          { attributeId: 923276, value: dealData.delivery?.city || 'Unknown' },
          { attributeId: 923277, value: dealData.delivery?.station || 'Unknown' },
          { attributeId: 923278, value: dealData.products.map(p => `${p.unitPrice} CHF`).join(', ') },
          { attributeId: 923279, value: dealData.products.reduce((sum, p) => sum + p.quantity, 0).toString() },
          { attributeId: 923605, value: dealData.price.toString() },
          { attributeId: 923606, value: dealData.products.map(p => p.unitPrice).join(', ') },
          { attributeId: 923613, value: dealData.products.map(p => p.name).join(', ') }
        ]
      };

      const response = await axios.post('https://api.sendpulse.com/crm/v1/deals', dealRequest, {
        headers: {
          'Authorization': `Bearer ${await this.ensureValidToken()}`,
          'Content-Type': 'application/json'
        }
      });

      const dealId = response.data?.data?.id;
      if (!dealId) {
        throw new Error('Deal ID not found in response');
      }

      return {
        ...response.data.data,
        id: dealId
      };

    } catch (error) {
      logger.error('Create deal failed', {
        error: error.message,
        dealData: { ...dealData, contact: { id: dealData.contact.id } }
      });
      throw error;
    }
  }

  async addProductToDeal(dealId, product) {
    try {
      await axios.post('https://api.sendpulse.com/crm/v1/products/deals', {
        productId: product.sendpulseId,
        dealId: dealId,
        productPriceISO: 'CHF',
        productPriceValue: product.unitPrice,
        quantity: product.quantity
      }, {
        headers: {
          'Authorization': `Bearer ${await this.ensureValidToken()}`,
          'Content-Type': 'application/json'
        }
      });

    } catch (error) {
      logger.error('Add product to deal failed', {
        error: error.message,
        dealId,
        productId: product.sendpulseId,
        productName: product.name
      });
      throw error;
    }
  }

  async getDealDetails(dealId) {
    try {
      const response = await axios.get(`https://api.sendpulse.com/crm/v1/deals/${dealId}`, {
        headers: {
          'Authorization': `Bearer ${await this.ensureValidToken()}`
        }
      });

      return response.data?.data || response.data;

    } catch (error) {
      logger.error('Get deal details failed', {
        error: error.message,
        dealId
      });
      throw error;
    }
  }
}