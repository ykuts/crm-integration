// KeyCRM Order Service — builds and submits orders to KeyCRM from Telegram bot data
import { DatabaseService } from './databaseService.js';
import { keyCrmApiService } from './keyCrmApiService.js';
import logger from '../utils/logger.js';

const dbService = new DatabaseService();

// Ensure phone always starts with + for consistent buyer deduplication in KeyCRM
const normalizePhone = (phone) => {
  if (!phone) return null;
  const digits = phone.replace(/\s+/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
};

export class KeyCrmOrderService {
  // ---------------------------------------------------------------------------
  // Create a KeyCRM order from Telegram bot order data.
  //
  // telegramOrderData shape (relevant fields):
  // {
  //   products: [{ id: number, quantity: number }],  // id = ecommerce product ID
  //   customerInfo: { firstName, lastName, phone },
  //   deliveryInfo: { city, station, canton },
  //   notes: string,
  // }
  //
  // Returns { keycrmOrderId: number, orderNumber: string }
  // ---------------------------------------------------------------------------
  async createOrderFromBot(telegramOrderData) {
    const { products, customerInfo, deliveryInfo, notes } = telegramOrderData;

    // Map channel name → KeyCRM source ID
    // whatsapp=1, telegram=2, instagram=3 (configure via env to override)
    const SOURCE_IDS = {
      whatsapp:  Number(process.env.KEYCRM_SOURCE_WHATSAPP_ID)  || 1,
      telegram:  Number(process.env.KEYCRM_SOURCE_TELEGRAM_ID)  || 2,
      instagram: Number(process.env.KEYCRM_SOURCE_INSTAGRAM_ID) || 3,
    };

    const sourceId =
      SOURCE_IDS[telegramOrderData.source?.toLowerCase()] ||
      Number(process.env.KEYCRM_SOURCE_TELEGRAM_ID) || 2;

    logger.info('Building KeyCRM order from bot data', {
      productCount: products?.length,
      buyerPhone: customerInfo?.phone,
      source: telegramOrderData.source,
      sourceId,
    });

    // Step 1: Resolve each product — fetch mapping + live price from KeyCRM
    const orderProducts = await this._resolveProducts(products);

    // Step 2: Build the KeyCRM order payload
    const payload = {
      source_id: sourceId,

      buyer_comment: [
        deliveryInfo?.city,
        deliveryInfo?.station,
        deliveryInfo?.canton,
      ]
        .filter(Boolean)
        .join(', ')
        .concat(notes ? `. ${notes}` : ''),

      buyer: {
        full_name: [customerInfo?.firstName, customerInfo?.lastName]
          .filter(Boolean)
          .join(' ') || 'Telegram User',
        phone: normalizePhone(customerInfo?.phone),
      },

      products: orderProducts,
    };

    // Step 3: Submit to KeyCRM
    const result = await keyCrmApiService.createOrder(payload);

    logger.info('KeyCRM order created from bot data', {
      keycrmOrderId: result.id,
      orderNumber: result.order_number,
    });

    return {
      keycrmOrderId: result.id,
      orderNumber: result.order_number,
    };
  }

  // ---------------------------------------------------------------------------
  // For each bot product item, look up the ProductMapping in our DB to get the
  // keycrmId, then fetch the current price from KeyCRM.
  // Returns the products array ready to embed in the KeyCRM order payload.
  // ---------------------------------------------------------------------------
  async _resolveProducts(products) {
    if (!products || products.length === 0) {
      throw new Error('Order must contain at least one product');
    }

    const resolved = [];

    for (const item of products) {
      // Find our DB mapping for this ecommerce product ID
      const mapping = await dbService.crmDb.productMapping.findUnique({
        where: { ecommerceId: Number(item.id) },
      });

      if (!mapping) {
        throw new Error(`No product mapping found for ecommerceId ${item.id}`);
      }

      if (!mapping.keycrmId) {
        throw new Error(
          `Product mapping for ecommerceId ${item.id} (${mapping.name}) has no keycrmId — sync it first`
        );
      }

      // Fetch live product data to get current price
      const keycrmProduct = await keyCrmApiService.getProductById(mapping.keycrmId);

      resolved.push({
        sku: mapping.keycrmSku,        // SKU to link to catalog product
        name: mapping.name,            // product name fallback
        price: keycrmProduct.price,    // price from KeyCRM
        quantity: Number(item.quantity) || 1,
        currency_code: 'CHF',
      });

      logger.debug('Product resolved for KeyCRM order', {
        ecommerceId: item.id,
        keycrmId: mapping.keycrmId,
        price: keycrmProduct.price,
        quantity: item.quantity,
      });
    }

    return resolved;
  }
}

// Shared singleton instance
export const keyCrmOrderService = new KeyCrmOrderService();
