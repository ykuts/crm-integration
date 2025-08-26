// Fixed Telegram Bot Routes - Properly convert product IDs
import express from 'express';
import { BotController } from '../controllers/botController.js';
import { validateApiKey } from '../middleware/validation.js';
import logger from '../utils/logger.js';
import axios from 'axios';

const router = express.Router();
const botController = new BotController();

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
      orderAttributes: req.body.orderAttributes || {}
    };

    logger.info('Telegram order creation request', {
      contact_id: processedOrder.contact_id,
      telegram_id: processedOrder.telegram_id,
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
 * Add item to cart - updates cart variable via SendPulse API
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
      telegram_id,
        contact_id,
      product_id,
      product_name,
      quantity,
      weight_kg
    });

    // Validate input
    if (!telegram_id || !product_id || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: telegram_id, product_id, quantity'
      });
    }

    // Get contact by telegram_id to update cart variable
    const contact = await botController.findContactByMessengerExternalId(contact_id);
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    // Get current cart from contact variables
    let cartItems = [];
    if (contact.variables) {
      const cartVar = contact.variables.find(v => v.name === 'cart');
      if (cartVar && cartVar.value) {
        try {
          cartItems = JSON.parse(cartVar.value);
        } catch (error) {
          logger.warn('Failed to parse existing cart', { telegram_id });
          cartItems = [];
        }
      }
    }

    // Add/update item in cart
    const existingItemIndex = cartItems.findIndex(item => item.id == product_id);
    
    if (existingItemIndex >= 0) {
      // Update existing item
      cartItems[existingItemIndex].quantity += parseInt(quantity);
      cartItems[existingItemIndex].total = cartItems[existingItemIndex].quantity * cartItems[existingItemIndex].price;
    } else {
      // Add new item
      const newItem = {
        id: parseInt(product_id),
        name: product_name || `Product ${product_id}`,
        quantity: parseInt(quantity),
        price: parseFloat(price) || 0,
        weight_kg: parseFloat(weight_kg) || 0,
        total: parseInt(quantity) * (parseFloat(price) || 0)
      };
      cartItems.push(newItem);
    }

    // Update cart variable in SendPulse
    await axios.post('https://api.sendpulse.com/crm/v1/contacts/variables', {
      messenger_external_id: telegram_id,
      variables: {
        cart: JSON.stringify(cartItems)
      }
    }, {
      headers: {
        'Authorization': `Bearer ${await botController.ensureValidToken()}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info('Cart updated successfully', {
      telegram_id,
      totalItems: cartItems.length
    });

    res.json({
      success: true,
      message: 'Item added to cart',
      cart: cartItems
    });

  } catch (error) {
    logger.error('Failed to add item to cart', {
      error: error.message,
      telegram_id: req.body.telegram_id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to add item to cart'
    });
  }
});

/**
 * Get cart contents
 */
router.get('/cart/:contact_id', async (req, res) => {
  try {
    const { contact_id } = req.params;

    logger.info('Getting cart contents', { contact_id });

    // Get contact by contact_id
    const contact = await botController.findContactByMessengerExternalId(contact_id);
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    // Get cart from contact variables
    let cartItems = [];
    if (contact.variables) {
      const cartVar = contact.variables.find(v => v.name === 'cart');
      if (cartVar && cartVar.value) {
        try {
          cartItems = JSON.parse(cartVar.value);
        } catch (error) {
          logger.warn('Failed to parse cart data', { telegram_id });
          cartItems = [];
        }
      }
    }

    // Calculate totals
    const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = cartItems.reduce((sum, item) => sum + item.total, 0);
    const totalWeight = cartItems.reduce((sum, item) => sum + (item.weight_kg || 0), 0);

    // Format cart display
    let cartDisplay = '';
    if (cartItems.length === 0) {
      cartDisplay = 'Корзина пуста';
    } else {
      cartDisplay = cartItems.map(item => 
        `${item.name} x${item.quantity} = ${item.total} CHF`
      ).join('\n');
      cartDisplay += `\n\nИтого: ${totalAmount} CHF`;
      if (totalWeight > 0) {
        cartDisplay += `\nВес: ${totalWeight} кг`;
      }
    }

    res.json({
      success: true,
      cart: {
        items: cartItems,
        display: cartDisplay,
        totalItems,
        totalAmount,
        totalWeight,
        isEmpty: cartItems.length === 0
      }
    });

  } catch (error) {
    logger.error('Failed to get cart', {
      error: error.message,
      telegram_id: req.params.telegram_id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get cart'
    });
  }
});

/**
 * Checkout cart - create order from cart items
 */
router.post('/cart-checkout', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      source = 'telegram',
      chatId,
      contact_id,
      telegram_id,
      cart,
      customerInfo,
      deliveryInfo,
      paymentMethod = 'CASH',
      notes,
      orderAttributes = {}
    } = req.body;

    logger.info('Cart checkout request', {
      chatId,
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

    // Get contact and current cart
    const contact = await botController.findContactByMessengerExternalId(telegram_id || contact_id);
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    // Get cart from contact variables
    let cartItems = [];
    if (contact.variables) {
      const cartVar = contact.variables.find(v => v.name === 'cart');
      if (cartVar && cartVar.value) {
        try {
          cartItems = JSON.parse(cartVar.value);
        } catch (error) {
          logger.warn('Failed to parse cart for checkout', { telegram_id });
        }
      }
    }

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty'
      });
    }

    // Convert cart items to products format for existing createOrder
    const products = cartItems.map(item => ({
      id: parseInt(item.id),
      quantity: parseInt(item.quantity)
    }));

    // Calculate totals
    const cartTotal = cartItems.reduce((sum, item) => sum + item.total, 0);

    // Create order data for existing flow
    const orderData = {
      source,
      chatId: chatId || telegram_id || 'unknown',
      botOrderId: `cart_${Date.now()}`,
      contact_id,
      telegram_id: telegram_id || chatId,
      customerInfo: customerInfo || {},
      products,
      deliveryInfo: deliveryInfo || {},
      paymentMethod,
      notes: notes || `Cart checkout - ${cartItems.length} items`,
      orderAttributes: {
        ...orderAttributes,
        cart_items: cartItems.length,
        cart_total: cartTotal,
        cart_products: cartItems.map(item => `${item.name} x${item.quantity}`).join(', ')
      }
    };

    logger.info('Creating order from cart', {
      productCount: products.length,
      cartTotal,
      cartItems: cartItems.map(item => `${item.name} x${item.quantity}`)
    });

    // Use existing createOrder logic
    const result = await botController.createOrder(orderData);
    
    const duration = Date.now() - startTime;
    logger.info('Cart checkout completed', {
      botOrderId: result.botOrderId,
      crmOrderId: result.crmOrderId,
      cartTotal,
      duration: `${duration}ms`
    });

    res.status(201).json({
      ...result,
      cartTotal,
      itemsOrdered: cartItems.length,
      message: `Order created successfully with ${cartItems.length} items`
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



export default router;