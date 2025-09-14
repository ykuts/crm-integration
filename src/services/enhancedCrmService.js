import { SendPulseCrmService } from './sendPulseCrmService.js';
import { DatabaseService } from './databaseService.js';
import axios from 'axios';
import logger from '../utils/logger.js';

export class EnhancedCrmService extends SendPulseCrmService {
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
   * Helper methods
   */
  
  mapStationNameToId(stationName) {
    // Map station name to ID - you'll need to implement this based on your stations
    const stationMapping = {
      'Zurich HB': 1,
      'Zürich HB': 1,
      'Geneva': 2,
      'Genève': 2,
      'Basel': 3,
      'Bern': 4,
      'Lausanne': 5,
      // Add more mappings based on your railway stations
    };
    
    return stationMapping[stationName] || 1; // Default to first station
  }

  getNextDeliveryDate() {
    // Get next available delivery date (e.g., tomorrow if before cutoff time)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0); // Set to 10:00 AM
    return tomorrow.toISOString();
  }
}