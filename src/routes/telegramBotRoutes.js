// Fixed Telegram Bot Routes - Properly convert product IDs
import express from 'express';
import { BotController } from '../controllers/botController.js';
import { validateApiKey } from '../middleware/validation.js';
import logger from '../utils/logger.js';
import axios from 'axios';

const router = express.Router();
const botController = new BotController();

// Health check БЕЗ аутентификации (ПЕРЕД validateApiKey)
router.get('/telegram-health', async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      service: 'Telegram Bot Service'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'UNHEALTHY',
      error: error.message
    });
  }
});

// DEBUG: Add logging middleware to see what's hitting the routes
router.use((req, res, next) => {
  logger.info('TELEGRAM ROUTE HIT', {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    headers: {
      'content-type': req.headers['content-type'],
      'x-api-key': req.headers['x-api-key'] ? 'present' : 'missing'
    },
    bodySize: JSON.stringify(req.body).length
  });
  next();
});

// Middleware to validate API key for all bot routes
router.use(validateApiKey);

/**
 * Create telegram order - fixed version with proper ID conversion
 */
router.post('/telegram-order', async (req, res) => {
  const startTime = Date.now();

  try {
    // Basic validation - only required fields
    const { source, products, contact_id } = req.body;

    if (!source || source !== 'telegram') {
      return res.status(400).json({
        success: false,
        error: 'Source must be telegram',
        code: 'INVALID_SOURCE'
      });
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Products array is required and must not be empty',
        code: 'MISSING_PRODUCTS'
      });
    }

    if (!contact_id) {
      return res.status(400).json({
        success: false,
        error: 'contact_id is required for telegram orders',
        code: 'MISSING_CONTACT_ID'
      });
    }



    // FIXED: Convert product IDs to integers and validate
    const processedProducts = products.map(product => {
      // Convert ID to integer - handle both string and number inputs
      let productId;
      if (typeof product.id === 'string') {
        productId = parseInt(product.id, 10);
      } else if (typeof product.id === 'number') {
        productId = product.id;
      } else {
        throw new Error(`Invalid product ID type: ${typeof product.id}. Expected string or number.`);
      }

      // Validate converted ID
      if (isNaN(productId) || productId <= 0) {
        throw new Error(`Invalid product ID: ${product.id}. Must be a positive integer.`);
      }

      // Convert quantity to integer
      let quantity;
      if (typeof product.quantity === 'string') {
        quantity = parseInt(product.quantity, 10);
      } else if (typeof product.quantity === 'number') {
        quantity = product.quantity;
      } else {
        throw new Error(`Invalid quantity type: ${typeof product.quantity}. Expected string or number.`);
      }

      // Validate quantity
      if (isNaN(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity: ${product.quantity}. Must be a positive integer.`);
      }

      return {
        id: productId,
        quantity: quantity,
        notes: product.notes || null
      };
    });

    logger.info('Products processed and validated', {
      originalProducts: products,
      processedProducts: processedProducts
    });

    // Add defaults for missing fields
    const processedOrder = {
      source: 'telegram',
      chatId: req.body.chatId || req.body.telegram_id || 'unknown',
      botOrderId: req.body.botOrderId || `tg_${Date.now()}`,
      contact_id: contact_id,
      telegram_id: req.body.telegram_id || req.body.chatId,
      language: req.body.language || 'uk',
      customerInfo: {
        firstName: req.body.customerInfo?.firstName || 'TelegramUser',
        lastName: req.body.customerInfo?.lastName || req.body.customerInfo?.username || 'Unknown',
        phone: req.body.customerInfo?.phone || null,
        username: req.body.customerInfo?.username || null
      },
      products: processedProducts, // Use processed products with proper types
      deliveryInfo: {
        type: req.body.deliveryInfo?.type || 'railway_station',
        city: req.body.deliveryInfo?.city || 'Nyon',
        canton: req.body.deliveryInfo?.canton || 'VD',
        station: req.body.deliveryInfo?.station || 'Nyon',
        ...req.body.deliveryInfo
      },
      paymentMethod: req.body.paymentMethod || 'CASH',
      notes: req.body.notes || `Telegram order from ${req.body.customerInfo?.username || req.body.telegram_id}`,
      // Pass through all the orderAttributes from SendPulse bot variables
      orderAttributes: {
        ...req.body.orderAttributes,
        language: req.body.language || 'uk'
      }
    };

    logger.info('Telegram order creation request', {
      contact_id: processedOrder.contact_id,
      telegram_id: processedOrder.telegram_id,
      language: processedOrder.language,
      productCount: processedOrder.products.length,
      customerName: `${processedOrder.customerInfo.firstName} ${processedOrder.customerInfo.lastName}`,
      productIds: processedOrder.products.map(p => p.id),
      hasOrderAttributes: Object.keys(processedOrder.orderAttributes).length > 0
    });

    const result = await botController.createOrder(processedOrder);

    const duration = Date.now() - startTime;
    logger.info('Telegram order creation completed', {
      botOrderId: result.botOrderId,
      crmOrderId: result.crmOrderId,
      duration: `${duration}ms`,
      success: true
    });

    res.status(201).json(result);

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Telegram order creation failed', {
      error: error.message,
      stack: error.stack,
      contact_id: req.body.contact_id,
      requestBody: JSON.stringify(req.body, null, 2),
      duration: `${duration}ms`
    });

    // Return user-friendly error message
    let errorMessage = 'Telegram order creation failed';
    let statusCode = 500;

    if (error.message.includes('Invalid product ID')) {
      errorMessage = 'Invalid product ID provided';
      statusCode = 400;
    } else if (error.message.includes('Invalid quantity')) {
      errorMessage = 'Invalid quantity provided';
      statusCode = 400;
    } else if (error.message.includes('not found')) {
      errorMessage = 'Contact or product not found';
      statusCode = 404;
    } else if (error.message.includes('not mapped')) {
      errorMessage = 'Product not available in CRM';
      statusCode = 400;
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'TELEGRAM_ORDER_CREATION_FAILED'
    });
  }
});

router.post('/telegram-order-enhanced', async (req, res) => {
  try {
    const result = await botController.createOrderEnhanced(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Health check for telegram bot
 */
router.get('/telegram-health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'Telegram Bot Integration'
    };

    // Check SendPulse connectivity
    try {
      await botController.ensureValidToken();
      health.sendpulse = 'connected';
    } catch (error) {
      health.sendpulse = 'disconnected';
      health.status = 'degraded';
    }

    res.json(health);

  } catch (error) {
    logger.error('Telegram health check failed', { error: error.message });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Test endpoint to validate product ID conversion
 */
router.post('/test-product-conversion', validateApiKey, async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({
        success: false,
        error: 'Products array is required'
      });
    }

    const processedProducts = products.map(product => {
      let productId;
      if (typeof product.id === 'string') {
        productId = parseInt(product.id, 10);
      } else if (typeof product.id === 'number') {
        productId = product.id;
      } else {
        throw new Error(`Invalid product ID type: ${typeof product.id}`);
      }

      if (isNaN(productId) || productId <= 0) {
        throw new Error(`Invalid product ID: ${product.id}`);
      }

      return {
        original: product,
        processed: {
          id: productId,
          quantity: parseInt(product.quantity) || 1
        }
      };
    });

    res.json({
      success: true,
      message: 'Product conversion test successful',
      results: processedProducts
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
      code: 'PRODUCT_CONVERSION_FAILED'
    });
  }
});



/**
 * Add item to cart - saves to database
 */
router.post('/cart-add', async (req, res) => {
  try {
    const {
      telegram_id,
      contact_id,
      product_id,
      product_name,
      price,
      quantity,
      weight_kg
    } = req.body;

    logger.info('Adding item to cart', {
      contact_id,
      product_id,
      product_name,
      quantity,
      weight_kg
    });

    // Validate input
    if (!contact_id || !product_id || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: contact_id, product_id, quantity'
      });
    }

    // Add to cart using database
    const cartItem = await botController.dbService.addToCart(contact_id, telegram_id, {
      productId: product_id,
      productName: product_name,
      quantity: quantity,
      price: price,
      weightKg: weight_kg
    });

    // Get updated cart
    const cart = await botController.dbService.getCart(contact_id);

    logger.info('Cart updated successfully', {
      contact_id,
      totalItems: cart.totalItems,
      totalAmount: cart.totalAmount
    });

    res.json({
      success: true,
      message: 'Item added to cart',
      cart: cart
    });

  } catch (error) {
    logger.error('Failed to add item to cart', {
      error: error.message,
      contact_id: req.body.contact_id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to add item to cart'
    });
  }
});

/**
 * Get cart contents from database with language support
 */
router.get('/cart/:contact_id', async (req, res) => {
  try {
    const { contact_id } = req.params;
    const language = req.query.language || req.query.lang || 'uk';

    logger.info('Getting cart contents', { contact_id, language });

    const cart = await botController.dbService.getCart(contact_id);

    // Translations for cart UI
    const translations = {
      uk: { emptyCart: 'Кошик порожній', total: 'Всього' },
      en: { emptyCart: 'Cart is empty', total: 'Total' },
      fr: { emptyCart: 'Panier vide', total: 'Total' },
      ru: { emptyCart: 'Корзина пуста', total: 'Всего' }
    };

    const t = translations[language] || translations.uk;

    // Format cart display
    let cartDisplay = '';
    if (cart.isEmpty) {
      cartDisplay = t.emptyCart;
    } else {
      // Option 1: Use stored productName (already translated when added)
      cartDisplay = cart.items.map(item => {
        // Special handling for weight-based products
        if (parseInt(item.productId) === 3 || parseInt(item.productId) === 6 || parseInt(item.productId) === 25) {
          const weightInKg = item.quantity / 2;
          return `${item.productName} ${weightInKg} кг = ${parseFloat(item.total).toFixed(2)} CHF`;
        } else if (parseInt(item.productId) === 4 || parseInt(item.productId) === 11 || parseInt(item.productId) === 12) {
          return `${item.productName} x ${item.quantity} = ${parseFloat(item.total).toFixed(2)} CHF`;
        } else {
          return `${item.productName} x ${weightInKg} кг = ${parseFloat(item.total).toFixed(2)} CHF`;
        }
      }).join('\n');
      
      cartDisplay += `\n\n${t.total}: ${cart.totalAmount.toFixed(2)} CHF`;
    }

    res.json({
      success: true,
      cart: {
        ...cart,
        display: cartDisplay,
        language: language
      }
    });

  } catch (error) {
    logger.error('Failed to get cart', {
      error: error.message,
      contact_id: req.params.contact_id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get cart'
    });
  }
});

/**
 * Checkout cart - create order from cart items in database
 */
router.post('/cart-checkout', async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      source = 'telegram',
      chatId,
      contact_id,
      telegram_id,
      customerInfo,
      deliveryInfo,
      paymentMethod = 'CASH',
      notes,
      orderAttributes = {}
    } = req.body;

    logger.info('Cart checkout request', {
      contact_id,
      telegram_id
    });

    // Validate required fields
    if (!contact_id) {
      return res.status(400).json({
        success: false,
        error: 'contact_id is required'
      });
    }

    // Get cart from database
    const cart = await botController.dbService.getCart(contact_id);

    if (cart.isEmpty) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty'
      });
    }

    // Convert cart items to products format for existing createOrder
    const products = cart.items.map(item => ({
      id: parseInt(item.productId),
      quantity: parseInt(item.quantity)
    }));

    // Create order data
    const orderData = {
      source,
      chatId: chatId || telegram_id || 'unknown',
      botOrderId: `cart_${Date.now()}`,
      contact_id,
      telegram_id: telegram_id || chatId,
      language: req.body.language || 'uk',
      customerInfo: customerInfo || {},
      products,
      deliveryInfo: deliveryInfo || {},
      paymentMethod,
      notes: notes || `Cart checkout - ${cart.totalItems} items`,
      orderAttributes: {
        ...orderAttributes,
        language: req.body.language || 'uk',
        cart_items: cart.totalItems,
        cart_total: cart.totalAmount,
        cart_weight: cart.totalWeight,
        cart_products: cart.items.map(item => `${item.productName} x${item.quantity}`).join(', ')
      }
    };

    logger.info('Creating order from cart', {
      productCount: products.length,
      cartTotal: cart.totalAmount,
      cartItems: cart.items.map(item => `${item.productName} x${item.quantity}`)
    });

    // Create order using existing logic
    const result = await botController.createOrder(orderData);

    // Clear cart after successful order
    await botController.dbService.clearCart(contact_id);

    const duration = Date.now() - startTime;
    logger.info('Cart checkout completed', {
      botOrderId: result.botOrderId,
      crmOrderId: result.crmOrderId,
      cartTotal: cart.totalAmount,
      duration: `${duration}ms`
    });

    res.status(201).json({
      ...result,
      cartTotal: cart.totalAmount,
      itemsOrdered: cart.totalItems,
      message: `Order created successfully with ${cart.totalItems} items`
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Cart checkout failed', {
      error: error.message,
      stack: error.stack,
      contact_id: req.body.contact_id,
      duration: `${duration}ms`
    });

    res.status(500).json({
      success: false,
      error: 'Cart checkout failed',
      details: error.message
    });
  }
});

/**
 * Update cart item quantity
 */
router.put('/cart-item/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;

    logger.info('Updating cart item quantity', { itemId, quantity });

    // Validate input
    if (!quantity || parseInt(quantity) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be greater than 0'
      });
    }

    // Update item in database
    const updatedItem = await botController.dbService.updateCartItem(itemId, quantity);

    res.json({
      success: true,
      message: 'Cart item updated successfully',
      item: {
        id: updatedItem.id,
        productName: updatedItem.productName,
        quantity: updatedItem.quantity,
        price: parseFloat(updatedItem.price),
        total: parseFloat(updatedItem.total)
      }
    });

  } catch (error) {
    logger.error('Failed to update cart item', {
      error: error.message,
      itemId: req.params.itemId
    });

    const statusCode = error.message === 'Cart item not found' ? 404 : 500;

    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Clear entire cart
 */
router.delete('/cart/:contact_id', async (req, res) => {
  try {
    const { contact_id } = req.params;

    logger.info('Clearing cart', { contact_id });

    // Clear cart using existing database method
    const result = await botController.dbService.clearCart(contact_id);

    res.json({
      success: true,
      message: 'Cart cleared successfully',
      deletedItems: result.count
    });

  } catch (error) {
    logger.error('Failed to clear cart', {
      error: error.message,
      contact_id: req.params.contact_id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to clear cart'
    });
  }
});

router.get('/order-status/:botOrderId', async (req, res) => {
  try {
    const result = await botController.getOrderStatus(req.params.botOrderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check БЕЗ аутентификации
/* router.get('/telegram-health', async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      service: 'Telegram Bot Service'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      status: 'UNHEALTHY',
      error: error.message 
    });
  }
}); */


export default router;