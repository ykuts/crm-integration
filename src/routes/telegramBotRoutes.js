// Fixed Telegram Bot Routes - Properly convert product IDs
import express from 'express';
import { BotController } from '../controllers/botController.js';
import { validateApiKey } from '../middleware/validation.js';
import logger from '../utils/logger.js';

const router = express.Router();
const botController = new BotController();

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

export default router;