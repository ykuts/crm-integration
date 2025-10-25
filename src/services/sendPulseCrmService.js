// SendPulse CRM Service - Specific implementation for SendPulse API
import axios from 'axios';
import logger from '../utils/logger.js';

export class SendPulseCRMService {
  constructor() {
    this.apiUrl = 'https://api.sendpulse.com/crm/v1';
    this.clientId = process.env.SENDPULSE_CLIENT_ID;
    this.clientSecret = process.env.SENDPULSE_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;

    // Create axios instance
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    // Add request interceptor to handle authentication
    this.client.interceptors.request.use(
      async (config) => {
        // Ensure we have a valid token
        await this.ensureValidToken();

        config.headers['Authorization'] = `Bearer ${this.accessToken}`;

        logger.debug('SendPulse API Request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          hasAuth: !!this.accessToken
        });

        return config;
      },
      (error) => {
        logger.error('SendPulse API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('SendPulse API Response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      async (error) => {
        // Handle token expiry
        if (error.response?.status === 401) {
          logger.warn('Token expired, refreshing...');
          this.accessToken = null;
          this.tokenExpiry = null;

          // Retry the request once with new token
          if (!error.config._retried) {
            error.config._retried = true;
            await this.ensureValidToken();
            error.config.headers['Authorization'] = `Bearer ${this.accessToken}`;
            return this.client.request(error.config);
          }
        }

        logger.error('SendPulse API Response Error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          data: error.response?.data
        });

        return Promise.reject(error);
      }
    );
  }

  // Authentication with SendPulse
  async ensureValidToken() {
    // Check if current token is still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      logger.debug('Using cached SendPulse token');
      return; // Token is still valid
    }

    try {
      logger.info('Getting SendPulse access token...');

      // Check if credentials are configured
      if (!this.clientId || !this.clientSecret) {
        logger.error('SendPulse credentials not configured', {
          hasClientId: !!this.clientId,
          hasClientSecret: !!this.clientSecret
        });
        throw new Error('SendPulse CLIENT_ID and CLIENT_SECRET must be configured');
      }

      logger.debug('Sending auth request to SendPulse', {
        clientId: this.clientId.substring(0, 8) + '...',
        hasSecret: !!this.clientSecret
      });

      const authResponse = await axios.post('https://api.sendpulse.com/oauth/access_token', {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      }, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      logger.debug('SendPulse auth response received', {
        status: authResponse.status,
        hasData: !!authResponse.data,
        hasAccessToken: !!authResponse.data?.access_token,
        dataKeys: authResponse.data ? Object.keys(authResponse.data) : []
      });

      if (!authResponse.data || !authResponse.data.access_token) {
        logger.error('Invalid SendPulse auth response', {
          responseData: authResponse.data
        });
        throw new Error('No access token received from SendPulse');
      }

      this.accessToken = authResponse.data.access_token;

      // Parse expires_in safely - default to 1 hour if not provided
      const expiresIn = parseInt(authResponse.data.expires_in) || 3600;

      // Set expiry time with 60 second buffer
      this.tokenExpiry = Date.now() + ((expiresIn - 60) * 1000);

      logger.info('SendPulse token obtained successfully', {
        expiresIn: expiresIn,
        expiresAt: new Date(this.tokenExpiry).toISOString(),
        tokenPreview: this.accessToken.substring(0, 10) + '...'
      });

    } catch (error) {
      logger.error('Failed to get SendPulse access token', {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        hasClientId: !!this.clientId,
        hasClientSecret: !!this.clientSecret
      });
      throw new Error(`SendPulse authentication failed: ${error.message}`);
    }
  }

  // Get all products from CRM
  async getAllProducts(filters = {}) {
    try {
      logger.info('Fetching products from SendPulse CRM');

      const requestBody = {
        limit: filters.limit || 100,
        offset: filters.offset || 0,
        search: filters.search || '',
        visible: 1, // Only visible products
        orderBy: {
          fieldName: 'id',
          direction: 'asc'
        },
        ...filters
      };

      const response = await this.client.post('/products/all', requestBody);

      logger.info('Products fetched successfully', {
        count: response.data.length || 0
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get products: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get all contacts from CRM
  async getAllContacts(filters = {}) {
    try {
      logger.info('Fetching contacts from SendPulse CRM');

      const requestBody = {
        limit: filters.limit || 100,
        offset: filters.offset || 0,
        orderBy: 'id',
        sort: 'asc',
        ...filters
      };

      const response = await this.client.post('/contacts/get-list', requestBody);

      logger.info('Contacts fetched successfully', {
        count: response.data.length || 0
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get contacts: ${error.response?.data?.message || error.message}`);
    }
  }

  // Search contact by phone
  async findContactByPhone(phone) {
    try {
      logger.info('Searching contact by phone', { phone });

      const response = await this.client.post('/contacts/get-list', {
        phone: phone,
        limit: 1
      });

      const contacts = response.data;
      const contact = contacts.length > 0 ? contacts[0] : null;

      if (contact) {
        logger.info('Contact found by phone', { contactId: contact.id });
      } else {
        logger.info('No contact found by phone', { phone });
      }

      return contact;
    } catch (error) {
      throw new Error(`Failed to search contact by phone: ${error.response?.data?.message || error.message}`);
    }
  }

  // Create new contact
  async createContact(contactData) {
    try {
      logger.info('Creating new contact in SendPulse CRM');

      const requestBody = {
        firstName: contactData.firstName || '',
        lastName: contactData.lastName || '',
        phones: contactData.phone ? [{
          phone: contactData.phone,
          type: 'main'
        }] : [],
        emails: contactData.email ? [{
          email: contactData.email,
          type: 'main'
        }] : [],
        // Add source tracking
        sourceType: 7, // Custom source - adjust based on SendPulse source types
        attributes: [
          {
            name: 'source',
            value: contactData.source || 'bot-integration'
          }
        ]
      };

      const response = await this.client.post('/contacts/create', requestBody);

      logger.info('Contact created successfully', {
        contactId: response.data.id,
        phone: contactData.phone
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to create contact: ${error.response?.data?.message || error.message}`);
    }
  }

  // Find or create contact
  async findOrCreateContact(contactData) {
    try {
      // First try to find existing contact by phone
      const existingContact = await this.findContactByPhone(contactData.phone);

      if (existingContact) {
        logger.info('Using existing contact', { contactId: existingContact.id });
        return existingContact;
      }

      // Create new contact if not found
      const newContact = await this.createContact(contactData);
      return newContact;

    } catch (error) {
      throw new Error(`Failed to find or create contact: ${error.message}`);
    }
  }

  // Create new deal (order)
  async createDeal(dealData) {
    try {
      logger.info('Creating new deal in SendPulse CRM');

      const requestBody = {
        title: dealData.title || `Order from ${dealData.source}`,
        description: dealData.description || dealData.notes || '',
        budget: dealData.totalAmount || 0,
        currency: 'CHF',
        // You'll need to get pipeline ID from your SendPulse account
        pipelineId: dealData.pipelineId || process.env.SENDPULSE_DEFAULT_PIPELINE_ID,
        // Add source and external ID for tracking
        attributes: [
          {
            name: 'external_id',
            value: dealData.externalId || dealData.chatId
          },
          {
            name: 'source',
            value: dealData.source || 'bot-integration'
          },
          {
            name: 'chat_id',
            value: dealData.chatId
          }
        ]
      };

      const response = await this.client.post('/deals', requestBody);

      logger.info('Deal created successfully', {
        dealId: response.data.id,
        title: dealData.title
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to create deal: ${error.response?.data?.message || error.message}`);
    }
  }

  // Add contact to deal
  async addContactToDeal(dealId, contactId) {
    try {
      logger.info('Adding contact to deal', { dealId, contactId });

      const response = await this.client.post(`/deals/${dealId}/contacts/${contactId}`);

      logger.info('Contact added to deal successfully');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to add contact to deal: ${error.response?.data?.message || error.message}`);
    }
  }

  // Add products to deal
  async addProductsToDeal(dealId, products) {
    try {
      logger.info('Adding products to deal', { dealId, productCount: products.length });

      // SendPulse requires adding products one by one
      const results = [];

      for (const product of products) {
        const requestBody = {
          productId: product.crmId,
          dealId: dealId,
          productPriceISO: 'CHF',
          productPriceValue: product.unitPrice,
          quantity: product.quantity
        };

        const response = await this.client.post('/products/deals', requestBody);
        results.push(response.data);

        logger.debug('Product added to deal', {
          productId: product.crmId,
          quantity: product.quantity
        });
      }

      logger.info('All products added to deal successfully');
      return results;
    } catch (error) {
      throw new Error(`Failed to add products to deal: ${error.response?.data?.message || error.message}`);
    }
  }

  // Main method to create complete order in CRM
  async createOrderInCRM(orderData) {
    try {
      const {
        source,
        chatId,
        customer,
        products,
        totalAmount,
        notes,
        delivery
      } = orderData;

      logger.info('Starting SendPulse order creation process');

      // Step 1: Find or create customer
      logger.info('Step 1: Processing customer');
      const contact = await this.findOrCreateContact(customer);

      // Step 2: Create deal
      logger.info('Step 2: Creating deal');
      const deal = await this.createDeal({
        title: `Order #${Date.now()} from ${source}`,
        description: `Order from ${source} bot\nChat ID: ${chatId}\nNotes: ${notes || 'No notes'}`,
        totalAmount,
        source,
        chatId,
        externalId: chatId
      });

      // Step 3: Add contact to deal
      logger.info('Step 3: Adding contact to deal');
      await this.addContactToDeal(deal.id, contact.id);

      // Step 4: Add products to deal
      if (products && products.length > 0) {
        logger.info('Step 4: Adding products to deal');
        await this.addProductsToDeal(deal.id, products);
      }

      // Step 5: Add delivery information as note if provided
      if (delivery) {
        await this.addCommentToDeal(deal.id, `Delivery: ${JSON.stringify(delivery)}`);
      }

      // Step 6: Get complete deal info
      const completeDeal = await this.getDealDetails(deal.id);

      logger.info('SendPulse order creation completed successfully', {
        dealId: completeDeal.id,
        contactId: contact.id
      });

      return {
        id: completeDeal.id,
        number: `SP-${completeDeal.id}`,
        status: completeDeal.status || 'pending',
        totalAmount: totalAmount,
        customerId: contact.id,
        createdAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('SendPulse order creation failed', {
        error: error.message,
        stack: error.stack
      });

      throw new Error(`SendPulse integration failed: ${error.message}`);
    }
  }

  // Get deal details
  async getDealDetails(dealId) {
    try {
      const response = await this.client.get(`/deals/${dealId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get deal details: ${error.response?.data?.message || error.message}`);
    }
  }

  // Add comment to deal
  async addCommentToDeal(dealId, comment) {
    try {
      const response = await this.client.post(`/deals/${dealId}/comments`, {
        text: comment
      });
      return response.data;
    } catch (error) {
      logger.warn('Failed to add comment to deal', { error: error.message });
      // Don't throw error for comments, it's not critical
    }
  }

  /**
 * Update deal in SendPulse CRM
 * @param {string} dealId - Deal ID to update
 * @param {Object} updateData - Update data with status, notes, etc.
 * @returns {Promise<Object>}
 */
  async updateDeal(dealId, updateData) {
    try {
      logger.info('Updating deal in SendPulse', { dealId, updateData });

      // Map ecommerce status to SendPulse step IDs
      const statusToStepMapping = {
        'PENDING': parseInt(process.env.SENDPULSE_STEP_PENDING) || 529997,
        'CONFIRMED': parseInt(process.env.SENDPULSE_STEP_CONFIRMED) || 529998,
        'DELIVERED': parseInt(process.env.SENDPULSE_STEP_DELIVERED) || 530000,
        'CANCELLED': parseInt(process.env.SENDPULSE_STEP_CANCELLED) || 530001
      };

      const pipelineId = parseInt(process.env.SENDPULSE_PIPELINE_ID) || 153270;

      // First, get current deal details to preserve existing data
      const currentDeal = await this.getDealDetails(dealId);
      const dealData = currentDeal.data || currentDeal;

      // Determine step ID
      let stepId = dealData.stepId; // Keep current step by default
      if (updateData.status && statusToStepMapping[updateData.status]) {
        stepId = statusToStepMapping[updateData.status];
        logger.info('Mapping status to step', {
          status: updateData.status,
          stepId: stepId
        });
      }

      // Build update payload with ALL required fields
      const updatePayload = {
        pipelineId: pipelineId,
        stepId: stepId, // Required field
        status: dealData.status || 0, // Required field
        name: dealData.name || `Order #${dealId}`, // Preserve existing name
        price: updateData.totalAmount ? parseFloat(updateData.totalAmount) : (dealData.price || 0),
        currency: 'CHF'
      };

      // Add optional fields if they exist
      if (dealData.responsibleId) {
        updatePayload.responsibleId = dealData.responsibleId;
      }
      if (dealData.sourceId) {
        updatePayload.sourceId = dealData.sourceId;
      }

      // Add notes as comment (if provided)
      if (updateData.notes) {
        await this.addCommentToDeal(dealId, updateData.notes);
      }

      logger.info('Sending update to SendPulse', {
        dealId,
        updatePayload
      });

      // SendPulse requires PUT, not PATCH
      const response = await this.client.put(`/deals/${dealId}`, updatePayload);

      logger.info('Deal updated successfully', { dealId });
      return response.data;

    } catch (error) {
      logger.error('Update deal failed', {
        error: error.message,
        response: error.response?.data,
        dealId,
        updateData
      });
      throw new Error(`Failed to update deal: ${error.response?.data?.message || error.message}`);
    }
  }

  // Health check
  async healthCheck() {
    try {
      await this.ensureValidToken();

      // Try to get pipelines as a health check
      const response = await this.client.get('/pipelines');

      return {
        status: 'connected',
        tokenValid: !!this.accessToken,
        pipelinesCount: response.data.length || 0
      };
    } catch (error) {
      return {
        status: 'disconnected',
        error: error.message,
        lastChecked: new Date().toISOString()
      };
    }
  }

  // ============================================
  // BOT VARIABLE MANAGEMENT METHODS
  // Add these methods to your existing sendPulseCrmService.js
  // ============================================

  /**
   * Set variable for bot contact
   * @param {string} botType - Bot type: 'telegram', 'whatsapp', 'messenger'
   * @param {string} contactId - Bot contact ID (from webhook)
   * @param {Object} variables - Variables to set: { variable_name: value }
   * @returns {Promise<Object>}
   */
  async setBotVariable(botType, contactId, variables) {
    try {
      logger.info('Setting bot variable', {
        botType,
        contactId,
        variables
      });

      // Validate bot type
      const validBotTypes = ['telegram', 'whatsapp', 'messenger'];
      if (!validBotTypes.includes(botType)) {
        throw new Error(`Invalid bot type: ${botType}. Must be one of: ${validBotTypes.join(', ')}`);
      }

      // Bot API base URLs
      const botApiUrls = {
        telegram: 'https://api.sendpulse.com/telegram',
        whatsapp: 'https://api.sendpulse.com/whatsapp',
        messenger: 'https://api.sendpulse.com/fb'
      };

      const baseUrl = botApiUrls[botType];

      // Prepare variables array for API
      const variablesArray = Object.entries(variables).map(([name, value]) => ({
        variable_name: name,
        variable_value: String(value) // Convert to string for API
      }));

      // Make API request
      const response = await axios.post(
        `${baseUrl}/contacts/setVariable`,
        {
          contact_id: contactId,
          variables: variablesArray
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info('Bot variable set successfully', {
        contactId,
        variableCount: variablesArray.length
      });

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      logger.error('Failed to set bot variable', {
        error: error.message,
        response: error.response?.data,
        botType,
        contactId
      });

      // Don't throw - variable setting is not critical for order processing
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Delete variable from bot contact
   * @param {string} botType - Bot type: 'telegram', 'whatsapp', 'messenger'
   * @param {string} contactId - Bot contact ID
   * @param {string} variableName - Variable name to delete
   * @returns {Promise<Object>}
   */
  async deleteBotVariable(botType, contactId, variableName) {
    try {
      logger.info('Deleting bot variable', {
        botType,
        contactId,
        variableName
      });

      const validBotTypes = ['telegram', 'whatsapp', 'messenger'];
      if (!validBotTypes.includes(botType)) {
        throw new Error(`Invalid bot type: ${botType}`);
      }

      const botApiUrls = {
        telegram: 'https://api.sendpulse.com/telegram',
        whatsapp: 'https://api.sendpulse.com/whatsapp',
        messenger: 'https://api.sendpulse.com/fb'
      };

      const baseUrl = botApiUrls[botType];

      const response = await axios.post(
        `${baseUrl}/contacts/deleteVariable`,
        {
          contact_id: contactId,
          variable_name: variableName
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info('Bot variable deleted successfully', {
        contactId,
        variableName
      });

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      logger.error('Failed to delete bot variable', {
        error: error.message,
        response: error.response?.data,
        botType,
        contactId,
        variableName
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Update active order status variable for bot contact
   * Main method to call when order status changes
   * @param {Object} params
   * @param {string} params.botType - Bot type: 'telegram', 'whatsapp', 'messenger'
   * @param {string} params.contactId - Bot contact ID
   * @param {boolean} params.hasActiveOrder - Whether contact has active order
   * @returns {Promise<Object>}
   */
  async updateActiveOrderVariable({ botType, contactId, hasActiveOrder }) {
    try {
      logger.info('Updating has_active_order variable', {
        botType,
        contactId,
        hasActiveOrder
      });

      // Set variable value: '1' for true, '0' for false
      const variableValue = hasActiveOrder ? '1' : '0';

      const result = await this.setBotVariable(botType, contactId, {
        has_active_order: variableValue
      });

      if (result.success) {
        logger.info('Active order variable updated successfully', {
          contactId,
          value: variableValue
        });
      } else {
        logger.warn('Failed to update active order variable (non-critical)', {
          contactId,
          error: result.error
        });
      }

      return result;

    } catch (error) {
      logger.error('Error updating active order variable', {
        error: error.message,
        botType,
        contactId
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get bot variables for contact
   * Useful for debugging and testing
   * @param {string} botType - Bot type
   * @param {string} contactId - Bot contact ID
   * @returns {Promise<Object>}
   */
  async getBotContactVariables(botType, contactId) {
    try {
      logger.info('Getting bot contact variables', {
        botType,
        contactId
      });

      const validBotTypes = ['telegram', 'whatsapp', 'messenger'];
      if (!validBotTypes.includes(botType)) {
        throw new Error(`Invalid bot type: ${botType}`);
      }

      const botApiUrls = {
        telegram: 'https://api.sendpulse.com/telegram',
        whatsapp: 'https://api.sendpulse.com/whatsapp',
        messenger: 'https://api.sendpulse.com/fb'
      };

      const baseUrl = botApiUrls[botType];

      const response = await axios.get(
        `${baseUrl}/contacts/get`,
        {
          params: { id: contactId },
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const contactData = response.data?.data;

      logger.info('Bot contact variables retrieved', {
        contactId,
        hasVariables: !!contactData?.variables
      });

      return {
        success: true,
        contact: contactData,
        variables: contactData?.variables || {}
      };

    } catch (error) {
      logger.error('Failed to get bot contact variables', {
        error: error.message,
        response: error.response?.data,
        botType,
        contactId
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

}