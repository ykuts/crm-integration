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

  async createDeal(dealData) {
    try {
      logger.info('Creating deal with attributes', {
        title: dealData.title,
        price: dealData.price,
        contactId: dealData.contact.id
      });

      // Build attributes from order data
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
      logger.error('Create deal failed', {
        error: error.message,
        response: error.response?.data,
        dealTitle: dealData.title
      });
      throw error;
    }
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
        notes,
        contact_id,
        telegram_id,
        orderAttributes // New field with bot variables
      } = orderData;

      logger.info('Processing telegram bot order with attributes', {
        botOrderId,
        source,
        chatId,
        contact_id,
        telegram_id,
        hasOrderAttributes: !!orderAttributes
      });

      // Step 1: Validate and enrich products
      const enrichedProducts = await this.enrichProductsWithPricing(products);
      const totalAmount = enrichedProducts.reduce((sum, p) => sum + p.totalPrice, 0);

      logger.info('Products enriched', {
        productCount: enrichedProducts.length,
        totalAmount,
        productNames: enrichedProducts.map(p => p.name)
      });

      // Step 2: Find contact using messenger external ID
      let contact = null;
      if (contact_id) {
        contact = await this.findContactByMessengerExternalId(contact_id);
      }

      if (!contact) {
        throw new Error(`Contact with ID ${contact_id} not found in SendPulse`);
      }

      logger.info('Contact found', {
        contactId: contact.id,
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
      });

      // Step 3: Create deal in SendPulse with attributes
      const deal = await this.createDeal({
        title: orderAttributes?.order_text || `Telegram Order - ${enrichedProducts.map(p => p.name).join(', ')}`, // ✅ ИСПРАВЛЕНО
        price: parseFloat(orderAttributes?.sum) || totalAmount,
        currency: 'CHF',
        contact: contact,
        products: enrichedProducts,
        delivery: deliveryInfo || {},
        source: 'telegram',
        orderAttributes: orderAttributes || {} // Pass bot variables to deal creation
      });

      logger.info('Deal created with attributes', {
        dealId: deal.id,
        dealName: deal.name
      });

      // Step 4: Add products to deal (optional)
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
            productId: product.id
          });
        }
      }

      logger.info('Telegram order completed successfully with attributes', {
        botOrderId,
        dealId: deal.id,
        contactId: contact.id,
        externalContactId: contact_id,
        totalAmount: parseFloat(orderAttributes?.sum) || totalAmount
      });

      try {
  // Step 5: Create order in ecommerce database
  logger.info('Creating order in ecommerce database', {
    dealId: deal.id,
    contactId: contact.id
  });

  const ecommerceOrderData = {
    orderSource: 'TELEGRAM_BOT',
    externalOrderId: botOrderId,
    syncStatus: 'PENDING',
    
    guestInfo: {
      firstName: orderAttributes?.fullname?.split(' ')[0] || contact.firstName || 'Telegram',
      lastName: orderAttributes?.fullname?.split(' ').slice(1).join(' ') || contact.lastName || 'User',
      phone: customerInfo?.phone || '',
      email: customerInfo?.email || ''
    },
    
    deliveryType: 'RAILWAY_STATION',
    deliveryStationId: this.mapStationNameToId(deliveryInfo?.station),
    deliveryDate: this.getNextDeliveryDate(),
    deliveryTimeSlot: 'morning',
    
    totalAmount: totalAmount,
    paymentMethod: 'CASH',
    paymentStatus: 'PENDING',
    status: 'PENDING',
    
    notesClient: notes || '',
    notesAdmin: `Created from Telegram bot. Deal ID: ${deal.id}`,
    
    items: enrichedProducts.map(product => ({
      productId: product.id,
      quantity: product.quantity,
      unitPrice: product.unitPrice
    }))
  };

  const ecommerceResponse = await axios.post(
    `${this.ecommerceApiUrl}/api/orders/enhanced`,
    ecommerceOrderData,
    {
      headers: {
        'X-Internal-API-Token': this.ecommerceApiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );

  const ecommerceOrder = ecommerceResponse.data.order;
  
  logger.info('Order created in ecommerce database', {
    ecommerceOrderId: ecommerceOrder.id,
    dealId: deal.id
  });

  // Update ecommerce order with SendPulse IDs
  await axios.patch(
    `${this.ecommerceApiUrl}/api/orders/${ecommerceOrder.id}/sync-data`,
    {
      sendpulseDealId: deal.id.toString(),
      sendpulseContactId: contact.id.toString(),
      syncStatus: 'SYNCED',
      lastSyncAt: new Date().toISOString()
    },
    {
      headers: {
        'X-Internal-API-Token': this.ecommerceApiToken,
        'Content-Type': 'application/json'
      }
    }
  );

  logger.info('Order synced between both systems', {
    ecommerceOrderId: ecommerceOrder.id,
    dealId: deal.id
  });

} catch (ecommerceError) {
  logger.warn('Failed to create order in ecommerce DB, but SendPulse order successful', {
    error: ecommerceError.message,
    dealId: deal.id
  });
  // Не бросаем ошибку - главное что заказ в SendPulse создан
}

      return {
        success: true,
        botOrderId,
        crmOrderId: deal.id,
        orderNumber: `SP-${deal.id}`,
        status: 'created',
        totalAmount: parseFloat(orderAttributes?.sum) || totalAmount,
        contactId: contact.id,
        externalContactId: contact_id,
        attributesApplied: true,
        message: 'Telegram order successfully created in SendPulse CRM with attributes'
      };

    } catch (error) {
      logger.error('Enhanced telegram bot order creation failed', {
        error: error.message,
        stack: error.stack,
        botOrderId: orderData.botOrderId,
        contact_id: orderData.contact_id,
        telegram_id: orderData.telegram_id
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
      await this.dbService.updateBotOrder(
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

  mapStationNameToId(stationName) {
  const stationMapping = {
    'Zurich HB': 1, 'Zürich HB': 1,
    'Geneva': 2, 'Genève': 2,
    'Basel': 3, 'Bern': 4, 'Lausanne': 5
  };
  return stationMapping[stationName] || 1;
}

getNextDeliveryDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  return tomorrow.toISOString();
}

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

  /**
 * Find contact by messenger external ID (telegram contact_id)
 */
  async findContactByMessengerExternalId(externalContactId) {
    try {
      logger.info('Looking up contact by messenger external ID', { externalContactId });

      const response = await axios.get(`https://api.sendpulse.com/crm/v1/contacts/messenger-external/${externalContactId}`, {
        headers: {
          'Authorization': `Bearer ${await this.ensureValidToken()}`
        }
      });

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