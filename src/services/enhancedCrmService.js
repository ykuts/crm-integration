import { SendPulseCRMService } from './sendPulseCrmService.js';
import { DatabaseService } from './databaseService.js';
import axios from 'axios';
import logger from '../utils/logger.js';

export class EnhancedCrmService extends SendPulseCRMService {
  constructor() {
    super();
    this.dbService = new DatabaseService();
    this.ecommerceApiUrl = process.env.ECOMMERCE_API_URL || 'http://localhost:3001';
    this.ecommerceApiToken = process.env.ECOMMERCE_API_TOKEN;
  }

  /**
   * Create order in both ecommerce DB and SendPulse CRM
   * @param {Object} telegramOrderData - Order data from Telegram bot
   * @returns {Object} Combined result with both DB and CRM IDs
   */
  async createTelegramOrderComplete(telegramOrderData) {
    const botOrderId = `TG_${Date.now()}_${telegramOrderData.chatId || telegramOrderData.contact_id}`;
    
    try {
      logger.info('Starting complete Telegram order creation', { 
        botOrderId, 
        chatId: telegramOrderData.chatId || telegramOrderData.contact_id
      });

      // Step 1: Create order in ecommerce database
      const ecommerceOrder = await this.createOrderInEcommerceDB(telegramOrderData, botOrderId);
      
      // Step 2: Create deal in SendPulse CRM
      const crmResult = await this.createOrderInCRM(telegramOrderData);
      
      // Step 3: Update ecommerce order with CRM IDs
      await this.updateEcommerceOrderWithCrmIds(ecommerceOrder.id, crmResult);
      
      // Step 4: Store bot order mapping for tracking
      await this.storeBotOrderMapping(telegramOrderData, botOrderId, ecommerceOrder.id, crmResult);
      
      // Step 5: Log successful sync
      await this.logOrderSync(ecommerceOrder.id, crmResult.dealId, 'CREATE', 'SUCCESS');

      const result = {
        success: true,
        botOrderId,
        ecommerceOrderId: ecommerceOrder.id,
        crmOrderId: crmResult.dealId,
        contactId: crmResult.contactId,
        orderNumber: `ORDER-${ecommerceOrder.id}`,
        totalAmount: telegramOrderData.sum || telegramOrderData.totalAmount,
        status: 'created',
        message: 'Order created successfully in all systems'
      };

      logger.info('Complete Telegram order creation successful', result);
      return result;

    } catch (error) {
      logger.error('Complete Telegram order creation failed', {
        error: error.message,
        stack: error.stack,
        botOrderId,
        telegramOrderData
      });

      // Try to log failed sync if we have some order data
      try {
        await this.logOrderSync(null, null, 'CREATE', 'FAILED', error.message);
      } catch (logError) {
        logger.error('Failed to log sync failure', { error: logError.message });
      }

      throw new Error(`Complete order creation failed: ${error.message}`);
    }
  }

  /**
   * Create order in ecommerce database via API
   */
  async createOrderInEcommerceDB(telegramOrderData, botOrderId) {
    try {
      logger.info('Creating order in ecommerce database', { botOrderId });

      // Map telegram bot data to ecommerce order format
      const orderPayload = {
        // Order source and identification
        orderSource: 'TELEGRAM_BOT',
        externalOrderId: botOrderId,
        syncStatus: 'PENDING',
        
        // Customer information (as guest)
        guestInfo: {
          firstName: telegramOrderData.fullname?.split(' ')[0] || telegramOrderData.customer?.firstName || 'Telegram',
          lastName: telegramOrderData.fullname?.split(' ').slice(1).join(' ') || telegramOrderData.customer?.lastName || 'User',
          phone: telegramOrderData.phone || telegramOrderData.customer?.phone || '',
          email: telegramOrderData.email || telegramOrderData.customer?.email || ''
        },
        
        // Delivery information
        deliveryType: 'RAILWAY_STATION',
        deliveryStationId: this.mapStationNameToId(telegramOrderData.station || telegramOrderData.delivery?.station),
        deliveryDate: telegramOrderData.deliveryDate || this.getNextDeliveryDate(),
        deliveryTimeSlot: telegramOrderData.deliveryTimeSlot || 'morning',
        deliveryAddress: {
          city: telegramOrderData.city || telegramOrderData.delivery?.city || 'Unknown',
          station: telegramOrderData.station || telegramOrderData.delivery?.station || 'Unknown',
          canton: telegramOrderData.canton || telegramOrderData.delivery?.canton || 'Unknown'
        },
        
        // Order details
        totalAmount: parseFloat(telegramOrderData.sum || telegramOrderData.totalAmount || 0),
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        status: 'PENDING',
        
        // Notes
        notesClient: telegramOrderData.question || telegramOrderData.notes || '',
        notesAdmin: `Created from Telegram bot. Chat ID: ${telegramOrderData.contact_id || telegramOrderData.chatId}`,
        
        // Order items - convert from telegram format
        items: this.mapTelegramItemsToEcommerceFormat(telegramOrderData)
      };

      // Test connection first
      await this.testEcommerceConnection();

      // Create order using enhanced endpoint
      const response = await axios.post(
        `${this.ecommerceApiUrl}/api/orders/enhanced`,
        orderPayload,
        {
          headers: {
            'X-Internal-API-Token': this.ecommerceApiToken,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const order = response.data.order;
      logger.info('Order created in ecommerce database', {
        orderId: order.id,
        botOrderId,
        totalAmount: order.totalAmount
      });

      return order;

    } catch (error) {
      if (error.response) {
        logger.error('Ecommerce API error', {
          status: error.response.status,
          data: error.response.data,
          botOrderId
        });
        throw new Error(`Ecommerce API error: ${error.response.data.message || error.response.statusText}`);
      } else if (error.request) {
        logger.error('Ecommerce API timeout/network error', { 
          error: error.message, 
          botOrderId 
        });
        throw new Error('Failed to connect to ecommerce API');
      } else {
        logger.error('Order creation payload error', { 
          error: error.message, 
          botOrderId 
        });
        throw error;
      }
    }
  }

  /**
   * Map telegram order items to ecommerce format
   */
  mapTelegramItemsToEcommerceFormat(telegramOrderData) {
    const items = [];

    // Handle different telegram bot data formats
    if (telegramOrderData.product_name && telegramOrderData.quantity) {
      // Single product format
      items.push({
        productId: this.mapTelegramProductToEcommerceId(telegramOrderData.product_name),
        quantity: parseInt(telegramOrderData.quantity),
        unitPrice: parseFloat(telegramOrderData.product_price || telegramOrderData.sum || 0)
      });
    } else if (telegramOrderData.products && Array.isArray(telegramOrderData.products)) {
      // Multiple products format
      telegramOrderData.products.forEach(product => {
        items.push({
          productId: product.id || this.mapTelegramProductToEcommerceId(product.name),
          quantity: parseInt(product.quantity || 1),
          unitPrice: parseFloat(product.unitPrice || product.price || 0)
        });
      });
    } else if (telegramOrderData.order_text) {
      // Parse from order text (fallback)
      const parsedItems = this.parseOrderTextToItems(telegramOrderData.order_text, telegramOrderData.sum);
      items.push(...parsedItems);
    }

    if (items.length === 0) {
      // Default fallback
      items.push({
        productId: 1, // Default product ID
        quantity: 1,
        unitPrice: parseFloat(telegramOrderData.sum || telegramOrderData.totalAmount || 0)
      });
    }

    return items;
  }

  /**
   * Map telegram product name to ecommerce product ID
   */
  mapTelegramProductToEcommerceId(productName) {
    // Simple mapping - you can make this more sophisticated
    const productMapping = {
      'Сир Кисломолочний': 1,
      'Творог': 1,
      'Cottage Cheese': 1,
      'Tvorog': 1,
      // Add more mappings as needed
    };

    // Find partial match
    for (const [key, id] of Object.entries(productMapping)) {
      if (productName && productName.toLowerCase().includes(key.toLowerCase())) {
        return id;
      }
    }

    return 1; // Default product ID
  }

  /**
   * Parse order text to extract items
   */
  parseOrderTextToItems(orderText, totalSum) {
    // Basic parsing - can be enhanced
    const items = [];
    const sum = parseFloat(totalSum || 0);
    
    // Extract quantity if present (like "2кг", "1.5 кг")
    const quantityMatch = orderText.match(/(\d+(?:\.\d+)?)\s*кг/i);
    const quantity = quantityMatch ? parseFloat(quantityMatch[1]) : 1;
    
    items.push({
      productId: this.mapTelegramProductToEcommerceId(orderText),
      quantity: quantity,
      unitPrice: sum / quantity
    });

    return items;
  }

  /**
   * Update ecommerce order with CRM IDs after successful CRM creation
   */
  async updateEcommerceOrderWithCrmIds(orderId, crmResult) {
    try {
      logger.info('Updating ecommerce order with CRM IDs', {
        orderId,
        dealId: crmResult.dealId,
        contactId: crmResult.contactId
      });

      const updatePayload = {
        sendpulseDealId: crmResult.dealId.toString(),
        sendpulseContactId: crmResult.contactId.toString(),
        syncStatus: 'SYNCED',
        lastSyncAt: new Date().toISOString()
      };

      await axios.patch(
        `${this.ecommerceApiUrl}/api/orders/${orderId}/sync-data`,
        updatePayload,
        {
          headers: {
            'X-Internal-API-Token': this.ecommerceApiToken,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('Ecommerce order updated with CRM IDs successfully');

    } catch (error) {
      logger.error('Failed to update ecommerce order with CRM IDs', {
        error: error.message,
        orderId,
        crmResult
      });
      // Don't throw here - order creation was successful, this is just sync metadata
    }
  }

  /**
   * Store bot order mapping in CRM database for tracking
   */
  async storeBotOrderMapping(telegramOrderData, botOrderId, ecommerceOrderId, crmResult) {
    try {
      const botOrderData = {
        botOrderId,
        source: 'telegram',
        chatId: telegramOrderData.contact_id || telegramOrderData.chatId,
        customerPhone: telegramOrderData.phone || telegramOrderData.customer?.phone || '',
        customerName: telegramOrderData.fullname || `${telegramOrderData.customer?.firstName || ''} ${telegramOrderData.customer?.lastName || ''}`.trim(),
        customerEmail: telegramOrderData.email || telegramOrderData.customer?.email || '',
        products: JSON.stringify(telegramOrderData.products || [telegramOrderData]),
        deliveryInfo: JSON.stringify({
          city: telegramOrderData.city,
          station: telegramOrderData.station,
          canton: telegramOrderData.canton
        }),
        paymentMethod: 'CASH',
        totalAmount: parseFloat(telegramOrderData.sum || telegramOrderData.totalAmount || 0),
        status: 'PENDING',
        notes: telegramOrderData.question || telegramOrderData.notes || '',
        // Link to both ecommerce and CRM
        ecommerceOrderId: ecommerceOrderId,
        sendpulseDealId: crmResult.dealId.toString(),
        sendpulseContactId: crmResult.contactId.toString(),
        metadata: JSON.stringify({
          createdAt: new Date(),
          telegramContactId: telegramOrderData.contact_id,
          deliveryPreferences: {
            city: telegramOrderData.city,
            station: telegramOrderData.station,
            canton: telegramOrderData.canton
          }
        })
      };

      await this.dbService.createBotOrder(botOrderData);
      
      logger.info('Bot order mapping stored successfully', {
        botOrderId,
        ecommerceOrderId,
        crmDealId: crmResult.dealId
      });

    } catch (error) {
      logger.error('Failed to store bot order mapping', {
        error: error.message,
        botOrderId
      });
      // Don't throw - main order creation was successful
    }
  }

  /**
   * Test ecommerce API connection
   */
  async testEcommerceConnection() {
    try {
      const response = await axios.get(`${this.ecommerceApiUrl}/health`, {
        timeout: 5000
      });

      if (!response.data || response.status !== 200) {
        throw new Error('Ecommerce API is not healthy');
      }

      logger.debug('Ecommerce API connection test successful');

    } catch (error) {
      logger.error('Ecommerce API connection test failed', { error: error.message });
      throw new Error(`Cannot connect to ecommerce API: ${error.message}`);
    }
  }

  /**
   * Log order synchronization attempts
   */
  async logOrderSync(orderId, dealId, syncType, status, errorMessage = null) {
    try {
      const logData = {
        orderId: orderId || null,
        sendpulseDealId: dealId ? dealId.toString() : null,
        syncType, // 'CREATE', 'UPDATE', 'WEBHOOK'
        syncDirection: 'TO_CRM',
        syncStatus: status, // 'SUCCESS', 'FAILED', 'PENDING'
        syncData: {
          timestamp: new Date(),
          syncType,
          dealId,
          orderId
        },
        errorMessage
      };

      // Log to ecommerce database if we have order ID
      if (orderId) {
        try {
          await axios.post(
            `${this.ecommerceApiUrl}/api/orders/${orderId}/sync-log`,
            logData,
            {
              headers: {
                'X-Internal-API-Token': this.ecommerceApiToken,
                'Content-Type': 'application/json'
              }
            }
          );
        } catch (apiError) {
          logger.warn('Failed to log sync to ecommerce API', { error: apiError.message });
        }
      }

      logger.info('Order sync logged', { orderId, dealId, syncType, status });

    } catch (error) {
      logger.error('Failed to log order sync', { error: error.message });
    }
  }

/**
 * Delegate token management to parent class
 */
async ensureValidToken() {
  return await super.ensureValidToken();
}

/**
 * Find contact by messenger external ID (telegram contact_id)
 */
async findContactByMessengerExternalId(externalContactId) {
  try {
    logger.info('Looking up contact by messenger external ID', { externalContactId });

    const response = await axios.get(
      `https://api.sendpulse.com/crm/v1/contacts/messenger-external/${externalContactId}`, 
      {
        headers: {
          'Authorization': `Bearer ${await this.ensureValidToken()}`
        }
      }
    );

    const contact = response.data?.data?.data || response.data?.data;

    if (contact) {
      logger.info('Contact found via messenger external ID', {
        externalContactId,
        sendpulseId: contact.id,
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        hasPhone: !!contact.phones?.[0]?.phone,
        hasEmail: !!contact.emails?.[0]?.email
      });
      return contact;
    }

    return null;

  } catch (error) {
    if (error.response?.status === 404) {
      logger.info('Contact not found by messenger external ID', { externalContactId });
      return null;
    }

    logger.error('Failed to lookup contact by messenger external ID', {
      error: error.message,
      status: error.response?.status,
      externalContactId
    });
    throw error;
  }
}

/**
 * Create order in CRM only (for existing BotController compatibility)
 * This method creates deal in SendPulse CRM using the existing logic from BotController
 */
async createOrderInCRM(telegramOrderData) {
    try {
      logger.info('Creating order in CRM (SendPulse only)', {
        contact_id: telegramOrderData.contact_id,
        hasProducts: !!telegramOrderData.products
      });

      // Step 1: Find contact using messenger external ID with fallback
      let contact = null;
      if (telegramOrderData.contact_id) {
        contact = await this.findContactByMessengerExternalId(telegramOrderData.contact_id);
      }

      // IMPROVED: Try alternative contact finding methods if not found
      if (!contact) {
        logger.warn('Contact not found by messenger ID, trying alternative methods', {
          contact_id: telegramOrderData.contact_id
        });
        
        contact = await this.findOrCreateTelegramContact(telegramOrderData);
      }

      if (!contact) {
        throw new Error(`Failed to find or create contact for telegram order. Contact ID: ${telegramOrderData.contact_id}`);
      }

      // Step 2: Validate and enrich products
      let enrichedProducts = [];
      try {
        if (telegramOrderData.products && Array.isArray(telegramOrderData.products)) {
          enrichedProducts = await this.enrichProductsWithPricing(telegramOrderData.products);
        } else {
          // Fallback for simple order data
          enrichedProducts = [{
            id: 1,
            sendpulseId: 1,
            name: telegramOrderData.product_name || telegramOrderData.order_text || 'Telegram Order',
            quantity: parseInt(telegramOrderData.quantity) || 1,
            unitPrice: parseFloat(telegramOrderData.sum || telegramOrderData.totalAmount || 0),
            totalPrice: parseFloat(telegramOrderData.sum || telegramOrderData.totalAmount || 0)
          }];
        }
      } catch (productError) {
        logger.error('Product enrichment failed, using fallback', {
          error: productError.message,
          telegramProducts: telegramOrderData.products
        });
        
        // Create fallback product
        enrichedProducts = [{
          id: 1,
          sendpulseId: 1,
          name: 'Telegram Order (Product mapping failed)',
          quantity: 1,
          unitPrice: parseFloat(telegramOrderData.sum || telegramOrderData.totalAmount || 0),
          totalPrice: parseFloat(telegramOrderData.sum || telegramOrderData.totalAmount || 0)
        }];
      }

      const totalAmount = enrichedProducts.reduce((sum, p) => sum + p.totalPrice, 0);

      // Step 3: Create deal with attributes
      const deal = await this.createDealWithAttributes({
        title: telegramOrderData.orderAttributes?.order_text || 
               telegramOrderData.order_text || 
               `Telegram Order - ${enrichedProducts.map(p => p.name).join(', ')}`,
        price: parseFloat(telegramOrderData.orderAttributes?.sum || telegramOrderData.sum || totalAmount),
        currency: 'CHF',
        contact: contact,
        products: enrichedProducts,
        delivery: {
          city: telegramOrderData.city || telegramOrderData.deliveryInfo?.city,
          station: telegramOrderData.station || telegramOrderData.deliveryInfo?.station,
          canton: telegramOrderData.canton || telegramOrderData.deliveryInfo?.canton
        },
        source: 'telegram',
        orderAttributes: telegramOrderData.orderAttributes || {}
      });

      // Step 4: Add products to deal (with error handling)
      for (const product of enrichedProducts) {
        try {
          await this.addProductToDeal(deal.id, product);
          logger.debug('Product added to deal', {
            productId: product.sendpulseId,
            quantity: product.quantity
          });
        } catch (error) {
          logger.warn('Failed to add product to deal, continuing', {
            error: error.message,
            productId: product.id,
            productName: product.name
          });
          // Continue with order creation even if some products fail to add
        }
      }

      logger.info('CRM order creation completed', {
        dealId: deal.id,
        contactId: contact.id,
        totalAmount
      });

      return {
        dealId: deal.id,
        contactId: contact.id,
        orderNumber: `SP-${deal.id}`,
        totalAmount,
        status: 'created'
      };

    } catch (error) {
      logger.error('CRM order creation failed', {
        error: error.message,
        stack: error.stack,
        telegramOrderData: {
          contact_id: telegramOrderData.contact_id,
          hasProducts: !!telegramOrderData.products
        }
      });
      throw error;
    }
  }

/**
 * Create deal with attributes (from your BotController logic)
 */
async createDealWithAttributes(dealData) {
  try {
    logger.info('Creating deal with attributes', {
      title: dealData.title,
      price: dealData.price,
      contactId: dealData.contact.id
    });

    // Build attributes from order data (your existing logic)
    const attributes = [
      { attributeId: 922104, value: `${dealData.delivery?.city || 'Unknown'}, ${dealData.delivery?.station || 'Unknown'}` },
      { attributeId: 922108, value: dealData.orderAttributes?.order_text || dealData.products.map(p => `${p.name} x${p.quantity}`).join(', ') },
      { attributeId: 922119, value: dealData.orderAttributes?.question || "Не указано" },
      { attributeId: 922130, value: "Не оплачено" },
      { attributeId: 922253, value: dealData.delivery?.station || 'Unknown' },
      { attributeId: 922255, value: `${dealData.delivery?.city || 'Unknown'}, ${dealData.delivery?.canton || 'Unknown'}` },
      { attributeId: 922259, value: dealData.orderAttributes?.sum || dealData.price.toString() },
      { attributeId: 923272, value: dealData.orderAttributes?.order_text || dealData.products.map(p => `${p.name} x${p.quantity}`).join(', ') },
      { attributeId: 923273, value: dealData.orderAttributes?.language || "uk" },
      { attributeId: 923274, value: dealData.orderAttributes?.fullname || `${dealData.contact.firstName || ''} ${dealData.contact.lastName || ''}`.trim() },
      { attributeId: 923275, value: dealData.delivery?.canton || 'Unknown' },
      { attributeId: 923276, value: dealData.delivery?.city || 'Unknown' },
      { attributeId: 923277, value: dealData.delivery?.station || 'Unknown' },
      { attributeId: 923278, value: dealData.orderAttributes?.product_price_str || dealData.products.map(p => `${p.unitPrice} CHF`).join(', ') },
      { attributeId: 923279, value: dealData.orderAttributes?.quantity || dealData.products.reduce((sum, p) => sum + p.quantity, 0).toString() },
      { attributeId: 923428, value: dealData.orderAttributes?.question || "" },
      { attributeId: 923605, value: dealData.orderAttributes?.sum || dealData.price.toString() },
      { attributeId: 923606, value: dealData.orderAttributes?.product_price || dealData.products.map(p => p.unitPrice).join(', ') },
      { attributeId: 923613, value: dealData.orderAttributes?.product_name || dealData.products.map(p => p.name).join(', ') },
      { attributeId: 923614, value: dealData.orderAttributes?.tvorog_kg || "" }
    ];

    const dealRequest = {
      pipelineId: parseInt(process.env.SENDPULSE_PIPELINE_ID) || 153270,
      stepId: parseInt(process.env.SENDPULSE_STEP_ID) || 529997,
      name: dealData.title,
      price: dealData.price,
      currency: dealData.currency,
      contact: [dealData.contact.id],
      attributes: attributes
    };

    logger.info('Sending deal request to SendPulse', {
      pipelineId: dealRequest.pipelineId,
      stepId: dealRequest.stepId,
      contactId: dealData.contact.id,
      attributesCount: attributes.length
    });

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

    logger.info('Deal created successfully with attributes', {
      dealId: dealId,
      dealName: dealRequest.name,
      attributesApplied: attributes.length
    });

    return {
      ...response.data.data,
      id: dealId
    };

  } catch (error) {
    logger.error('Create deal with attributes failed', {
      error: error.message,
      response: error.response?.data,
      dealTitle: dealData.title
    });
    throw error;
  }
}

/**
 * Add product to deal
 */
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

/**
 * Enrich products with pricing (delegate to database service)
 */
async enrichProductsWithPricing(products) {
  const enrichedProducts = [];

  for (const product of products) {
    try {
      // Get product details from ecommerce database
      const ecommerceProduct = await this.dbService.getEcommerceProduct(product.id);
      
      if (!ecommerceProduct) {
        throw new Error(`Product with ID ${product.id} not found in ecommerce database`);
      }

      // Get SendPulse mapping
      const mapping = await this.dbService.getProductMapping(product.id);
      if (!mapping) {
        throw new Error(`Product ${product.id} is not mapped to SendPulse. Product: ${ecommerceProduct.name}`);
      }

      const quantity = parseInt(product.quantity) || 1;
      const unitPrice = parseFloat(ecommerceProduct.price) || 0;

      enrichedProducts.push({
        id: product.id,
        sendpulseId: mapping.sendpulseId,
        name: ecommerceProduct.name,
        sku: ecommerceProduct.sku,
        description: ecommerceProduct.description,
        quantity: quantity,
        unitPrice: unitPrice,
        totalPrice: unitPrice * quantity,
        category: ecommerceProduct.category,
        weight: ecommerceProduct.weight || 0
      });

    } catch (error) {
      logger.error('Product enrichment failed', {
        productId: product.id,
        error: error.message
      });
      throw new Error(`Failed to enrich product ${product.id}: ${error.message}`);
    }
  }

  return enrichedProducts;
}

/**
 * Update deal in SendPulse CRM
 */
async updateDeal(dealId, updateData) {
  try {
    logger.info('Updating deal in SendPulse', { dealId, updateData });

    const updatePayload = {};
    
    if (updateData.status) {
      // Map your status to SendPulse step IDs
      const statusMapping = {
        'PENDING': 529997,
        'CONFIRMED': 529998, 
        'SHIPPED': 529999,
        'DELIVERED': 530000,
        'CANCELLED': 530001
      };
      updatePayload.stepId = statusMapping[updateData.status];
    }

    if (updateData.notes) {
      updatePayload.attributes = [
        { attributeId: 922119, value: updateData.notes }
      ];
    }

    const response = await axios.patch(
      `https://api.sendpulse.com/crm/v1/deals/${dealId}`,
      updatePayload,
      {
        headers: {
          'Authorization': `Bearer ${await this.ensureValidToken()}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('Deal updated successfully', { dealId });
    return response.data;

  } catch (error) {
    logger.error('Update deal failed', {
      error: error.message,
      dealId,
      updateData
    });
    throw error;
  }
}

// Add these additional helper methods to src/services/enhancedCrmService.js

/**
 * Find contact by phone number
 */
async findContactByPhone(phone) {
  try {
    logger.info('Searching contact by phone', { phone });
    
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
    const contact = contacts.length > 0 ? contacts[0] : null;
    
    if (contact) {
      logger.info('Contact found by phone', { contactId: contact.id, phone });
    } else {
      logger.info('No contact found by phone', { phone });
    }

    return contact;

  } catch (error) {
    logger.error('Find contact by phone failed', {
      error: error.message,
      phone: phone
    });
    throw error;
  }
}

/**
 * Get deal details from SendPulse
 */
async getDealDetails(dealId) {
  try {
    logger.info('Getting deal details', { dealId });
    
    const response = await axios.get(`https://api.sendpulse.com/crm/v1/deals/${dealId}`, {
      headers: {
        'Authorization': `Bearer ${await this.ensureValidToken()}`
      }
    });

    const dealData = response.data?.data || response.data;
    
    logger.info('Deal details retrieved', { 
      dealId, 
      title: dealData.name || dealData.title,
      status: dealData.status 
    });

    return dealData;

  } catch (error) {
    logger.error('Get deal details failed', {
      error: error.message,
      dealId
    });
    throw error;
  }
}

/**
 * Enhanced helper methods - move these from BotController to here
 */

/**
 * Map station name to ID for delivery
 */
mapStationNameToId(stationName) {
  const stationMapping = {
    'Zurich HB': 1, 
    'Zürich HB': 1,
    'Geneva': 2, 
    'Genève': 2,
    'Basel': 3, 
    'Bern': 4, 
    'Lausanne': 5,
    'Nyon': 6,
    'Vevey': 7,
    'Montreux': 8,
    'Sion': 9,
    'Fribourg': 10
  };
  
  if (!stationName) {
    logger.warn('No station name provided, using default');
    return 1;
  }
  
  const stationId = stationMapping[stationName] || 1;
  logger.debug('Station mapped', { stationName, stationId });
  
  return stationId;
}

/**
 * Get next available delivery date
 */
getNextDeliveryDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0); // Set to 10:00 AM
  
  const deliveryDate = tomorrow.toISOString();
  logger.debug('Next delivery date calculated', { deliveryDate });
  
  return deliveryDate;
}

/**
   * FIXED: Create or find contact for telegram orders
   */
  async findOrCreateTelegramContact(telegramOrderData) {
    try {
      // First try to find by messenger external ID
      if (telegramOrderData.contact_id) {
        const existingContact = await this.findContactByMessengerExternalId(telegramOrderData.contact_id);
        if (existingContact) {
          logger.info('Found existing contact by messenger ID', { 
            contactId: existingContact.id,
            externalId: telegramOrderData.contact_id 
          });
          return existingContact;
        }
      }

      // Try to find by phone if available
      const phone = telegramOrderData.phone || telegramOrderData.customer?.phone;
      if (phone) {
        const contactByPhone = await this.findContactByPhone(phone);
        if (contactByPhone) {
          logger.info('Found existing contact by phone', { 
            contactId: contactByPhone.id,
            phone 
          });
          return contactByPhone;
        }
      }

      // If not found, create new contact using parent class method
      const newContactData = {
        firstName: telegramOrderData.fullname?.split(' ')[0] || 
                   telegramOrderData.customer?.firstName || 
                   'Telegram',
        lastName: telegramOrderData.fullname?.split(' ').slice(1).join(' ') || 
                  telegramOrderData.customer?.lastName || 
                  'User',
        phone: phone || '',
        email: telegramOrderData.email || telegramOrderData.customer?.email || '',
        source: 'telegram-bot'
      };

      logger.info('Creating new contact for telegram order', { 
        firstName: newContactData.firstName,
        lastName: newContactData.lastName,
        hasPhone: !!newContactData.phone
      });

      // FIXED: Use the correct parent method
      const newContact = await super.findOrCreateContact(newContactData);
      
      return newContact;

    } catch (error) {
      logger.error('Failed to find or create telegram contact', {
        error: error.message,
        contact_id: telegramOrderData.contact_id,
        phone: telegramOrderData.phone
      });
      throw error;
    }
  }

/**
 * Validate telegram order data before processing
 */
validateTelegramOrderData(orderData) {
  const errors = [];

  // Required fields
  if (!orderData.contact_id) {
    errors.push('contact_id is required');
  }

  if (!orderData.products || !Array.isArray(orderData.products) || orderData.products.length === 0) {
    // Check if we have alternative product data
    if (!orderData.product_name && !orderData.order_text) {
      errors.push('products array, product_name, or order_text is required');
    }
  }

  // Validate products if provided
  if (orderData.products && Array.isArray(orderData.products)) {
    orderData.products.forEach((product, index) => {
      if (!product.id) {
        errors.push(`Product ${index + 1}: id is required`);
      }
      if (!product.quantity || product.quantity <= 0) {
        errors.push(`Product ${index + 1}: quantity must be positive`);
      }
    });
  }

  // Check for minimum order amount
  const totalAmount = parseFloat(orderData.sum || orderData.totalAmount || 0);
  if (totalAmount <= 0) {
    errors.push('Order total amount must be greater than 0');
  }

  if (errors.length > 0) {
    const errorMessage = `Telegram order validation failed: ${errors.join(', ')}`;
    logger.error('Order validation failed', { 
      errors, 
      contact_id: orderData.contact_id 
    });
    throw new Error(errorMessage);
  }

  logger.info('Telegram order data validation passed', {
    contact_id: orderData.contact_id,
    productCount: orderData.products?.length || 0,
    totalAmount
  });

  return true;
}

}