// Clean Telegram Bot Routes - Minimal working version
import express from 'express';
import { BotController } from '../controllers/botController.js';
import { validateApiKey } from '../middleware/validation.js';
import logger from '../utils/logger.js';

const router = express.Router();
const botController = new BotController();

// Middleware to validate API key for all bot routes
router.use(validateApiKey);

/**
 * Create telegram order - simplified version without local DB save
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
        phone: req.body.customerInfo?.phone || null
      },
      products: products,
      deliveryInfo: {
        type: 'pickup_point',
        city: 'Geneva',
        canton: 'GE',
        station: 'Geneva Central Station',
        ...req.body.deliveryInfo
      },
      paymentMethod: req.body.paymentMethod || 'CASH',
      notes: req.body.notes || `Telegram order from ${req.body.customerInfo?.username || req.body.telegram_id}`
    };

    logger.info('Telegram order creation request', {
      contact_id: processedOrder.contact_id,
      telegram_id: processedOrder.telegram_id,
      productCount: processedOrder.products.length,
      customerName: `${processedOrder.customerInfo.firstName} ${processedOrder.customerInfo.lastName}`
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
      duration: `${duration}ms`
    });

    // Return user-friendly error message
    let errorMessage = 'Telegram order creation failed';
    let statusCode = 500;

    if (error.message.includes('not found')) {
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

export default router;