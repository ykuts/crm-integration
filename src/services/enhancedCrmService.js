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

      // ========================================
      // NEW: Step 6: Set bot variable has_active_order = 1
      // ========================================
      setImmediate(async () => {
        try {
          const contactId = telegramOrderData.contact_id || telegramOrderData.chatId;
          const source = telegramOrderData.source || 'telegram';

          logger.info('Setting has_active_order variable', {
            botOrderId,
            contactId,
            source
          });

          await this.updateActiveOrderVariable({
            botType: source,
            contactId: contactId,
            hasActiveOrder: true
          });

          logger.info('Bot variable has_active_order set to 1', {
            botOrderId,
            contactId
          });

        } catch (varError) {
          // Don't fail the order if variable update fails
          logger.warn('Failed to set has_active_order variable (non-critical)', {
            error: varError.message,
            botOrderId,
            contactId: telegramOrderData.contact_id || telegramOrderData.chatId
          });
        }
      });
      // ========================================

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
   * Create order in ecommerce database via API - FIXED VERSION
   */
  async createOrderInEcommerceDB(telegramOrderData, botOrderId) {
    try {
      logger.info('Creating order in ecommerce database', { botOrderId });

      // Add await because mapTelegramItemsToEcommerceFormat is now async
      const items = await this.mapTelegramItemsToEcommerceFormat(telegramOrderData);

      // Check station mapping and determine delivery type
      const requestedStation = telegramOrderData.deliveryInfo?.station || telegramOrderData.station;
      const mappedStationId = this.mapStationNameToId(requestedStation);

      // Check if station was not found in mapping (returns default Vevey ID: 11)
      // If no station provided or not found in mapping, switch to pickup
      const isStationFound = requestedStation && this.isStationInMapping(requestedStation);

      let deliveryType, deliveryStationId, deliveryAddress;

      if (!isStationFound) {
        // Station not found - use pickup in Nyon
        logger.info('Station not found in mapping, switching to pickup', {
          requestedStation,
          botOrderId
        });

        deliveryType = 'PICKUP';
        deliveryStationId = null;
        deliveryAddress = {
          city: 'Nyon',
          street: 'chemin de Pré-Fleuri',
          house: '5',
          canton: 'VD',
          postalCode: '1260'
        };
      } else {
        // Station found - use railway delivery
        deliveryType = 'RAILWAY_STATION';
        deliveryStationId = mappedStationId;
        deliveryAddress = {
          city: telegramOrderData.deliveryInfo?.city ||
            telegramOrderData.city || 'Unknown',
          station: requestedStation,
          canton: telegramOrderData.deliveryInfo?.canton ||
            telegramOrderData.canton || 'Unknown'
        };
      }

      // Calculate total amount from cart data or fallback to items
      const totalAmount = telegramOrderData.orderAttributes?.cart_total ||
        telegramOrderData.sum ||
        telegramOrderData.totalAmount ||
        items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

      const orderPayload = {
        // Order source and identification
        orderSource: 'TELEGRAM_BOT',
        externalOrderId: botOrderId,
        syncStatus: 'PENDING',

        // Customer information (as guest)
        guestInfo: {
          firstName: telegramOrderData.orderAttributes?.fullname?.split(' ')[0] ||
            telegramOrderData.fullname?.split(' ')[0] ||
            telegramOrderData.customerInfo?.firstName ||
            'Telegram',
          lastName: telegramOrderData.orderAttributes?.fullname?.split(' ').slice(1).join(' ') ||
            telegramOrderData.fullname?.split(' ').slice(1).join(' ') ||
            telegramOrderData.customerInfo?.lastName ||
            'Користувач',
          phone: telegramOrderData.customerInfo?.phone ||
            telegramOrderData.phone || '',
          email: telegramOrderData.customerInfo?.email ||
            telegramOrderData.email || ''
        },

        // Delivery information - dynamic based on station availability
        deliveryType: deliveryType,
        deliveryStationId: deliveryStationId,
        deliveryDate: telegramOrderData.deliveryDate || this.getNextDeliveryDate(),
        deliveryTimeSlot: telegramOrderData.deliveryTimeSlot || 'ранок (8:00-12:00)',
        deliveryAddress: deliveryAddress,

        // Use calculated total amount
        totalAmount: parseFloat(totalAmount),
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        status: 'PENDING',

        // Notes with more info
        notesClient: telegramOrderData.question ||
          telegramOrderData.notes ||
          telegramOrderData.orderAttributes?.cart_products || '',
        notesAdmin: `Надійшло з Telegram bot. ${!isStationFound ?
          `Станцію "${requestedStation}" не знайдено, переключено на самовивіз у Ньоні. ` : ''}` +
          `Кошик: ${telegramOrderData.orderAttributes?.cart_products || ''}`,

        // Order items
        items: items
      };

      logger.info('Order payload for ecommerce DB', {
        totalAmount: orderPayload.totalAmount,
        itemsCount: items.length,
        customerName: `${orderPayload.guestInfo.firstName} ${orderPayload.guestInfo.lastName}`,
        deliveryType: deliveryType,
        deliveryStation: deliveryType === 'RAILWAY_STATION' ? orderPayload.deliveryAddress.station : 'N/A',
        deliveryCity: orderPayload.deliveryAddress.city,
        stationMappingFound: isStationFound,
        items: items // Log the actual items array for debugging
      });

      // Validate items array before sending
      if (!items || items.length === 0) {
        logger.error('No items found in order payload', {
          telegramProducts: telegramOrderData.products,
          orderAttributes: telegramOrderData.orderAttributes,
          hasCartProducts: !!telegramOrderData.orderAttributes?.cart_products
        });
        throw new Error('Order must contain at least one item');
      }

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
        totalAmount: order.totalAmount,
        itemsCount: order.items?.length || 0,
        customerName: `${orderPayload.guestInfo.firstName} ${orderPayload.guestInfo.lastName}`,
        finalDeliveryType: deliveryType,
        deliveryLocation: deliveryType === 'PICKUP' ? 'Nyon' : orderPayload.deliveryAddress.station
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
   * Uses database prices (source of truth) + SendPulse quantities
   */
  async mapTelegramItemsToEcommerceFormat(telegramOrderData) {
    const items = [];

    logger.info('Mapping telegram items to ecommerce format', {
      hasProducts: !!telegramOrderData.products,
      hasCartData: !!telegramOrderData.orderAttributes?.cart_products,
      cartTotal: telegramOrderData.orderAttributes?.cart_total
    });

    // Handle products array (preferred method)
    if (telegramOrderData.products && Array.isArray(telegramOrderData.products)) {
      for (const product of telegramOrderData.products) {
        try {
          // Get actual product data from database (source of truth for prices)
          const ecommerceProduct = await this.dbService.getEcommerceProduct(product.id);

          if (!ecommerceProduct) {
            logger.warn('Product not found in database, using fallback', { productId: product.id });
            // Fallback to calculated price if product not found
            const totalCartAmount = parseFloat(telegramOrderData.orderAttributes?.cart_total || telegramOrderData.sum || 0);
            const totalQuantity = telegramOrderData.products.reduce((sum, p) => sum + parseInt(p.quantity || 1), 0);
            const fallbackUnitPrice = totalQuantity > 0 ? totalCartAmount / totalQuantity : 0;

            items.push({
              productId: product.id,
              quantity: parseInt(product.quantity || 1),
              unitPrice: fallbackUnitPrice
            });
            continue;
          }

          // Use database price + SendPulse quantity
          const databasePrice = parseFloat(ecommerceProduct.price);
          const quantity = parseInt(product.quantity || 1);

          items.push({
            productId: product.id,
            quantity: quantity,
            unitPrice: databasePrice // Always use price from database
          });

          logger.debug('Product mapped with database price', {
            productId: product.id,
            productName: ecommerceProduct.name,
            databasePrice: databasePrice,
            quantity: quantity,
            totalPrice: databasePrice * quantity
          });

        } catch (error) {
          logger.error('Failed to get product from database', {
            productId: product.id,
            error: error.message
          });

          // Fallback: use calculated price
          const totalCartAmount = parseFloat(telegramOrderData.orderAttributes?.cart_total || telegramOrderData.sum || 0);
          const totalQuantity = telegramOrderData.products.reduce((sum, p) => sum + parseInt(p.quantity || 1), 0);
          const fallbackUnitPrice = totalQuantity > 0 ? totalCartAmount / totalQuantity : 0;

          items.push({
            productId: product.id,
            quantity: parseInt(product.quantity || 1),
            unitPrice: fallbackUnitPrice
          });
        }
      }
    }
    // Handle single product format
    else if (telegramOrderData.product_name && telegramOrderData.quantity) {
      try {
        const productId = await this.mapTelegramProductToEcommerceId(telegramOrderData.product_name);
        const ecommerceProduct = await this.dbService.getEcommerceProduct(productId);

        items.push({
          productId: productId,
          quantity: parseInt(telegramOrderData.quantity),
          unitPrice: parseFloat(ecommerceProduct.price) // Use database price
        });
      } catch (error) {
        logger.error('Failed to get single product from database', { error: error.message });
        // Fallback to calculation
        const unitPrice = parseFloat(telegramOrderData.product_price ||
          telegramOrderData.sum ||
          telegramOrderData.orderAttributes?.cart_total || 0) / parseInt(telegramOrderData.quantity);

        items.push({
          productId: await this.mapTelegramProductToEcommerceId(telegramOrderData.product_name),
          quantity: parseInt(telegramOrderData.quantity),
          unitPrice: unitPrice
        });
      }
    }
    // Parse from cart products string (fallback)
    else if (telegramOrderData.orderAttributes?.cart_products) {
      const parsedItems = await this.parseCartProductsString(
        telegramOrderData.orderAttributes.cart_products,
        telegramOrderData.orderAttributes.cart_total
      );
      items.push(...parsedItems);
    }

    // Final fallback
    if (items.length === 0) {
      const totalAmount = parseFloat(telegramOrderData.orderAttributes?.cart_total ||
        telegramOrderData.sum ||
        telegramOrderData.totalAmount || 0);

      items.push({
        productId: 1, // Default product ID
        quantity: 1,
        unitPrice: totalAmount
      });
    }

    // Calculate totals for verification
    const calculatedTotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const expectedTotal = parseFloat(telegramOrderData.orderAttributes?.cart_total ||
      telegramOrderData.sum ||
      telegramOrderData.totalAmount || 0);

    logger.info('Items mapped successfully with database prices', {
      itemsCount: items.length,
      calculatedTotal: calculatedTotal.toFixed(2),
      expectedTotal: expectedTotal.toFixed(2),
      difference: Math.abs(calculatedTotal - expectedTotal).toFixed(2),
      items: items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        totalPrice: (item.quantity * item.unitPrice).toFixed(2)
      }))
    });

    // Log warning if there's a significant price difference
    if (Math.abs(calculatedTotal - expectedTotal) > 0.01) {
      logger.warn('Price difference detected between database prices and cart total', {
        calculatedTotal: calculatedTotal.toFixed(2),
        expectedTotal: expectedTotal.toFixed(2),
        difference: (calculatedTotal - expectedTotal).toFixed(2)
      });
    }

    return items;
  }

  /**
   * UNIFIED: Parse cart products string with database prices (replaces both old methods)
   */
  async parseCartProductsString(cartProductsString, cartTotal) {
    const items = [];

    try {
      // Extract quantity from string like "СИР КИСЛОМОЛОЧНИЙ (ТВОРОГ) x6"
      const quantityMatch = cartProductsString.match(/x(\d+)/i);
      const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;

      // Extract product name (remove quantity part)
      const productName = cartProductsString.replace(/\s*x\d+$/i, '').trim();
      const productId = await this.mapTelegramProductToEcommerceId(productName);

      // Try to get price from database first
      try {
        const ecommerceProduct = await this.dbService.getEcommerceProduct(productId);

        items.push({
          productId: productId,
          quantity: quantity,
          unitPrice: parseFloat(ecommerceProduct.price) // Use database price
        });

        logger.info('Cart product parsed with database price', {
          productName,
          productId,
          quantity,
          databasePrice: ecommerceProduct.price
        });

      } catch (dbError) {
        logger.warn('Failed to get database price, using cart calculation', {
          productId,
          error: dbError.message
        });

        // Fallback to cart total calculation
        const totalAmount = parseFloat(cartTotal || 0);
        items.push({
          productId: productId,
          quantity: quantity,
          unitPrice: totalAmount / quantity
        });
      }

    } catch (error) {
      logger.error('Failed to parse cart products string', {
        error: error.message,
        cartProductsString
      });

      // Final fallback
      const totalAmount = parseFloat(cartTotal || 0);
      const quantityMatch = cartProductsString.match(/x(\d+)/i);
      const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
      const productName = cartProductsString.replace(/\s*x\d+$/i, '').trim();

      items.push({
        productId: await this.mapTelegramProductToEcommerceId(productName),
        quantity: quantity,
        unitPrice: totalAmount / quantity
      });
    }

    return items;
  }


  /**
 * Database-driven product mapping (using existing DatabaseService)
 */
  async mapTelegramProductToEcommerceId(productName) {
    try {
      // Use existing method from DatabaseService
      const productMappings = await this.dbService.getAllProductMappings();

      // First try exact name match
      let mapping = productMappings.find(p =>
        p.name && p.name.toLowerCase() === productName.toLowerCase()
      );

      // If no exact match, try partial match
      if (!mapping && productName) {
        mapping = productMappings.find(p =>
          p.name && (
            p.name.toLowerCase().includes(productName.toLowerCase()) ||
            productName.toLowerCase().includes(p.name.toLowerCase())
          )
        );
      }

      if (mapping) {
        logger.info('Product mapped from database', {
          inputName: productName,
          foundName: mapping.name,
          ecommerceId: mapping.ecommerceId, // Note: camelCase in code
          sendpulseId: mapping.sendpulseId
        });
        return mapping.ecommerceId;
      }

      // Fallback to СИР КИСЛОМОЛОЧНИЙ (ecommerce_id: 3)
      const fallbackMapping = productMappings.find(p =>
        p.name && p.name.includes('КИСЛОМОЛОЧНИЙ')
      );

      if (fallbackMapping) {
        logger.warn('Using fallback product mapping', {
          inputName: productName,
          fallbackName: fallbackMapping.name,
          ecommerceId: fallbackMapping.ecommerceId
        });
        return fallbackMapping.ecommerceId;
      }

      // Final fallback to default product (СИР КИСЛОМОЛОЧНИЙ has ecommerce_id: 3)
      logger.error('No product mapping found, using default (ecommerce_id: 3)', { productName });
      return 3;

    } catch (error) {
      logger.error('Failed to map product from database', {
        error: error.message,
        productName
      });
      return 3; // Fallback
    }
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
   * Find contact by messenger external ID (FIXED)
   */
  async findContactByMessengerExternalId(externalContactId) {
    try {
      logger.info('Looking up contact by messenger external ID', { externalContactId });

      const response = await this.client.get(`/contacts/messenger-external/${externalContactId}`);

      const contact = response.data?.data?.data || response.data?.data;

      if (contact) {
        logger.info('Contact found via messenger external ID', {
          externalContactId,
          sendpulseId: contact.id,
          name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
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

      // FIX: Sanitize orderAttributes to prevent CRM validation errors
      const sanitizedOrderAttributes = this.sanitizeOrderAttributes(
        telegramOrderData.orderAttributes || {}
      );

      // Step 3: Create deal with attributes
      const dealTitle = this.generateDealTitle(enrichedProducts, telegramOrderData);

      const deal = await this.createDealWithAttributes({
        title: dealTitle,
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
        orderAttributes: sanitizedOrderAttributes
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
 * Sanitize order attributes to prevent CRM validation errors
 * Replaces long product lists with concise summaries
 */
  sanitizeOrderAttributes(orderAttributes) {
    const sanitized = { ...orderAttributes };

    // Replace long cart_products list with a concise summary
    if (sanitized.cart_products && typeof sanitized.cart_products === 'string') {
      const productCount = (sanitized.cart_products.match(/x\d+/g) || []).length;
      const totalItems = sanitized.cart_items || 0;

      // Create a short, informative summary instead of the full list
      sanitized.cart_products = `${productCount} позицій на суму ${sanitized.cart_total || 0} CHF`;

      logger.debug('Replaced cart_products with summary', {
        productCount,
        totalItems,
        totalAmount: sanitized.cart_total
      });
    }

    // Ensure numeric fields are properly formatted
    if (sanitized.cart_items) {
      sanitized.cart_items = parseInt(sanitized.cart_items) || 0;
    }
    if (sanitized.cart_total) {
      sanitized.cart_total = parseFloat(sanitized.cart_total) || 0;
    }
    if (sanitized.cart_weight) {
      sanitized.cart_weight = parseFloat(sanitized.cart_weight) || 0;
    }

    // Truncate fullname if it's too long (just in case)
    if (sanitized.fullname && sanitized.fullname.length > 100) {
      sanitized.fullname = sanitized.fullname.substring(0, 97) + '...';
    }

    return sanitized;
  }

  /**
 * Generate a concise deal title that fits CRM limits (max 255 characters)
 * @param {Array} products - Array of enriched products
 * @param {Object} telegramOrderData - Original telegram order data
 * @returns {string} Deal title
 */
  generateDealTitle(products, telegramOrderData) {
    const MAX_TITLE_LENGTH = 255;

    // Create summary like "Telegram Order - 12 items, 1705 CHF"
    const productCount = products.length;
    const totalAmount = products.reduce((sum, p) => sum + (p.totalPrice || 0), 0);

    const customerName = telegramOrderData.orderAttributes?.fullname ||
      telegramOrderData.customerInfo?.firstName ||
      'Customer';

    const title = `Telegram Order - ${customerName} - ${productCount} позицій, ${totalAmount.toFixed(2)} CHF`;

    // Ensure title doesn't exceed max length
    if (title.length > MAX_TITLE_LENGTH) {
      return title.substring(0, MAX_TITLE_LENGTH - 3) + '...';
    }

    return title;
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
        { attributeId: 923428, value: dealData.orderAttributes?.question || "Unknown" },
        { attributeId: 923605, value: dealData.orderAttributes?.sum || dealData.price.toString() },
        { attributeId: 923606, value: dealData.orderAttributes?.product_price || dealData.products.map(p => p.unitPrice).join(', ') },
        { attributeId: 923613, value: dealData.orderAttributes?.product_name || dealData.products.map(p => p.name).join(', ') },
        { attributeId: 923614, value: dealData.orderAttributes?.tvorog_kg || "Unknown" }
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

      const response = await this.client.post('/deals', dealRequest);

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
      await this.client.post('/products/deals', {
        productId: product.sendpulseId,
        dealId: dealId,
        productPriceISO: 'CHF',
        productPriceValue: product.unitPrice,
        quantity: product.quantity
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

      const response = await this.client.patch(
        `/deals/${dealId}`,
        updatePayload
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

      const response = await this.client.post('/contacts/get-list', {
        phone: phone,
        limit: 1
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

      const response = await this.client.get(`/deals/${dealId}`);

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
   * Check if station exists in mapping (helper function for createOrderInEcommerceDB)
   */
  isStationInMapping(stationName) {
    if (!stationName) {
      return false;
    }

    const stationMapping = {
      // Based on your actual database stations
      'Montreux': 3,
      'Lausanne': 4,
      'Morges': 6,
      'Geneva': 7,
      'Genève': 7,     // Alternative spelling
      'Aigle': 10,
      'Vevey': 11,
      'Rolle': 12,

      // Common variations and fallbacks
      'Montreux 12:10': 3,
      'Lausanne 13:00': 4,
      'Morges 13:35': 6,
      'Geneva 18:20-18:30': 7,
      'Genève 18:20-18:30': 7,
      'Aigle по телефону': 10,
      'Vevey 11:40': 11,
      'Rolle 10:15-10:30': 12
    };

    // First try exact match
    if (stationMapping[stationName]) {
      return true;
    }

    // Try case-insensitive partial match
    const lowerStationName = stationName.toLowerCase();
    for (const key of Object.keys(stationMapping)) {
      if (key.toLowerCase().includes(lowerStationName) ||
        lowerStationName.includes(key.toLowerCase())) {
        return true;
      }
    }

    // Station not found in mapping
    return false;
  }

  /**
   * Updated mapStationNameToId function (for reference - no need to change existing)
   */
  mapStationNameToId(stationName) {
    const stationMapping = {
      // Based on your actual database stations
      'Montreux': 3,
      'Lausanne': 4,
      'Morges': 6,
      'Geneva': 7,
      'Genève': 7,     // Alternative spelling
      'Aigle': 10,
      'Vevey': 11,
      'Rolle': 12,

      // Common variations and fallbacks
      'Montreux 12:10': 3,
      'Lausanne 13:00': 4,
      'Morges 13:35': 6,
      'Geneva 18:20-18:30': 7,
      'Genève 18:20-18:30': 7,
      'Aigle по телефону': 10,
      'Vevey 11:40': 11,
      'Rolle 10:15-10:30': 12
    };

    if (!stationName) {
      logger.warn('No station name provided, station not found in mapping');
      return null; // Changed from default Vevey ID to null
    }

    // First try exact match
    let stationId = stationMapping[stationName];

    // If no exact match, try case-insensitive partial match
    if (!stationId) {
      const lowerStationName = stationName.toLowerCase();
      for (const [key, id] of Object.entries(stationMapping)) {
        if (key.toLowerCase().includes(lowerStationName) ||
          lowerStationName.includes(key.toLowerCase())) {
          stationId = id;
          logger.info('Station mapped by partial match', {
            input: stationName,
            matched: key,
            stationId
          });
          break;
        }
      }
    }

    if (!stationId) {
      logger.warn('Station not found in mapping', { stationName });
      return null; // Station not found - will trigger pickup mode
    }

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