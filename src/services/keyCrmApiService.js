// KeyCRM API Service - Wrapper around KeyCRM REST API v1
// Base URL: https://openapi.keycrm.app/v1
// Auth: Bearer token (static, from env KEYCRM_API_KEY)
// Rate limit: 60 requests/minute

import axios from 'axios';
import logger from '../utils/logger.js';

const BASE_URL = 'https://openapi.keycrm.app/v1';

// Custom field IDs for chatbot product names (set in KeyCRM admin panel)
// Override via env vars if IDs differ between environments
const CUSTOM_FIELD_NAME_UA = process.env.KEYCRM_CF_NAME_UA || 'CT_1064';
const CUSTOM_FIELD_NAME_RU = process.env.KEYCRM_CF_NAME_RU || 'CT_1065';
const CUSTOM_FIELD_NAME_FR = process.env.KEYCRM_CF_NAME_FR || 'CT_1066';

export class KeyCrmApiService {
  constructor() {
    // Read lazily via getter so dotenv can load before first use
    // (ES module singletons are instantiated before top-level dotenv.config() runs)

    // Simple in-memory rate limiter: track timestamps of recent requests
    // KeyCRM allows 60 req/min → enforce with a sliding window
    this._requestTimestamps = [];

    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    });

    // Attach Bearer token to every request
    this.client.interceptors.request.use(
      async (config) => {
        const apiKey = process.env.KEYCRM_API_KEY;
        if (!apiKey) {
          throw new Error('KEYCRM_API_KEY environment variable is not set');
        }

        // Enforce rate limit before sending
        await this._throttle();

        config.headers['Authorization'] = `Bearer ${apiKey}`;

        logger.debug('KeyCRM API Request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          params: config.params,
        });

        return config;
      },
      (error) => {
        logger.error('KeyCRM API Request interceptor error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Log responses; handle 429 with automatic retry
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('KeyCRM API Response', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      async (error) => {
        const status = error.response?.status;

        // Rate limited — wait for the Retry-After header (or 10 s) then retry once
        if (status === 429 && !error.config._retried) {
          const retryAfter = parseInt(error.response.headers['retry-after'] || '10', 10);
          logger.warn('KeyCRM rate limit hit, retrying after delay', { retryAfterSec: retryAfter });
          await _sleep(retryAfter * 1000);
          error.config._retried = true;
          return this.client.request(error.config);
        }

        logger.error('KeyCRM API Response Error', {
          status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          data: error.response?.data,
        });

        return Promise.reject(error);
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Rate limiter: sliding-window, max 60 requests per 60 seconds
  // ---------------------------------------------------------------------------
  async _throttle() {
    const now = Date.now();
    const windowMs = 60_000;
    const maxRequests = 58; // leave 2-request safety margin

    // Drop timestamps older than the window
    this._requestTimestamps = this._requestTimestamps.filter(
      (ts) => now - ts < windowMs
    );

    if (this._requestTimestamps.length >= maxRequests) {
      // Wait until the oldest request in the window expires
      const oldest = this._requestTimestamps[0];
      const waitMs = windowMs - (now - oldest) + 50; // +50 ms buffer
      logger.debug('KeyCRM rate limiter: waiting before next request', { waitMs });
      await _sleep(waitMs);
    }

    this._requestTimestamps.push(Date.now());
  }

  // ---------------------------------------------------------------------------
  // Get products with their custom fields.
  //
  // KeyCRM endpoint: GET /products?include=custom_fields
  // Supports pagination via `page` and `limit` query params (max limit: 50).
  //
  // Returns an array of all products across all pages.
  // Each product includes a `chatbotNames` helper object extracted from
  // custom_fields: { ua, ru, fr }.
  // ---------------------------------------------------------------------------
  async getProducts({ page = 1, limit = 50, fetchAll = true } = {}) {
    try {
      logger.info('Fetching products from KeyCRM', { page, limit, fetchAll });

      const firstPage = await this._fetchProductsPage(page, limit);

      let products = firstPage.data || [];
      const meta = firstPage.meta || {};

      // Optionally fetch all remaining pages automatically
      if (fetchAll && meta.last_page && meta.last_page > page) {
        const pageRequests = [];
        for (let p = page + 1; p <= meta.last_page; p++) {
          pageRequests.push(this._fetchProductsPage(p, limit));
        }
        const remainingPages = await Promise.all(pageRequests);
        for (const pageResult of remainingPages) {
          products = products.concat(pageResult.data || []);
        }
      }

      // Attach a convenience `chatbotNames` field to each product
      products = products.map(this._attachChatbotNames);

      logger.info('KeyCRM products fetched successfully', { count: products.length });
      return products;
    } catch (error) {
      throw new Error(`KeyCRM getProducts failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Fetch a single page of products including custom fields
  async _fetchProductsPage(page, limit) {
    const response = await this.client.get('/products', {
      params: {
        include: 'custom_fields',
        page,
        limit,
      },
    });
    return response.data;
  }

  // ---------------------------------------------------------------------------
  // Get a single product by its KeyCRM ID with custom fields
  //
  // KeyCRM endpoint: GET /products/{id}?include=custom_fields
  // ---------------------------------------------------------------------------
  async getProductById(keycrmId) {
    try {
      logger.debug('Fetching product by id from KeyCRM', { keycrmId });

      const response = await this.client.get(`/products/${keycrmId}`, {
        params: { include: 'custom_fields' },
      });

      return this._attachChatbotNames(response.data);
    } catch (error) {
      throw new Error(
        `KeyCRM getProductById(${keycrmId}) failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  // Extract chatbot name custom fields and attach as `chatbotNames: { ua, ru, fr }`
  _attachChatbotNames(product) {
    const fields = product.custom_fields || [];

    const find = (key) => {
      const field = fields.find((f) => f.name === key || f.uuid === key);
      return field?.value || null;
    };

    return {
      ...product,
      chatbotNames: {
        ua: find(CUSTOM_FIELD_NAME_UA),
        ru: find(CUSTOM_FIELD_NAME_RU),
        fr: find(CUSTOM_FIELD_NAME_FR),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Create an order in KeyCRM
  //
  // KeyCRM endpoint: POST /order
  //
  // Expected orderData shape:
  // {
  //   source_id: number,           // KeyCRM order source ID (required)
  //   manager_id: number,          // assigned manager (optional)
  //   buyer_comment: string,       // notes / delivery info
  //   buyer: {
  //     full_name: string,
  //     email: string,
  //     phone: string,
  //   },
  //   shipping: {                  // optional shipping details
  //     delivery_service_id: number,
  //     tracking_code: string,
  //     address: {
  //       full_name: string,
  //       country_code: string,    // e.g. "UA"
  //       region: string,
  //       city: string,
  //       address: string,
  //       zip_code: string,
  //     },
  //   },
  //   products: [                  // ordered items (required)
  //     {
  //       product_id: number,      // KeyCRM product ID (use when has_offers: false)
  //       price: number,
  //       quantity: number,
  //       discount: number,        // optional, absolute value
  //       currency_code: string,   // optional, e.g. "UAH"
  //     },
  //   ],
  //   payment: {                   // optional payment info
  //     payment_method_id: number,
  //     payment_status_id: number,
  //     amount: number,
  //     currency_code: string,
  //     description: string,
  //   },
  // }
  //
  // Returns the created order object from KeyCRM.
  // ---------------------------------------------------------------------------
  async createOrder(orderData) {
    try {
      logger.info('Creating order in KeyCRM', {
        buyerPhone: orderData.buyer?.phone,
        productsCount: orderData.products?.length,
      });

      if (!orderData.products || orderData.products.length === 0) {
        throw new Error('Order must contain at least one product');
      }

      const response = await this.client.post('/order', orderData);

      const createdOrder = response.data;

      logger.info('KeyCRM order created successfully', {
        orderId: createdOrder.id,
        orderNumber: createdOrder.order_number,
      });

      logger.info('KeyCRM full create response', {
        data: JSON.stringify(response.data)
      });

      return createdOrder;
    } catch (error) {
      logger.error('KeyCRM createOrder failed', {
        error: error.message,
        response: error.response?.data,
        buyer: orderData.buyer?.phone,
      });
      throw new Error(`KeyCRM createOrder failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
// Update buyer (contact) data in KeyCRM
// Used to fill in name for newly created contacts (phone-only)
//
// KeyCRM endpoint: PUT /buyers/{id}
// ---------------------------------------------------------------------------
async updateBuyer(buyerId, data) {
  try {
    logger.info('Updating buyer in KeyCRM', { buyerId, data });

    const response = await this.client.put(`/buyers/${buyerId}`, data);

    logger.info('KeyCRM buyer updated successfully', { buyerId });
    return response.data;
  } catch (error) {
    // Non-critical — log but don't throw, order is already created
    logger.warn('KeyCRM updateBuyer failed (non-critical)', {
      buyerId,
      error: error.message,
      response: error.response?.data,
    });
  }
}

  // ---------------------------------------------------------------------------
  // Health check — fetches the first product page to verify connectivity
  // ---------------------------------------------------------------------------
  async healthCheck() {
    try {
      const response = await this.client.get('/products', {
        params: { limit: 1, page: 1 },
      });
      return {
        status: 'connected',
        apiKeyConfigured: !!process.env.KEYCRM_API_KEY,
        totalProducts: response.data?.meta?.total ?? null,
      };
    } catch (error) {
      return {
        status: 'disconnected',
        error: error.message,
        lastChecked: new Date().toISOString(),
      };
    }
  }
}

// Shared singleton instance
export const keyCrmApiService = new KeyCrmApiService();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
