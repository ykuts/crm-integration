// Bot Routes - Production API endpoints for bot integration
import express from 'express';
import { BotController } from '../controllers/botController.js';
import { validateBotOrder, validateApiKey } from '../middleware/validation.js';
import logger from '../utils/logger.js';
import { validateBotOrderOptional } from '../middleware/validation.js';

const router = express.Router();
const botController = new BotController();

// Middleware to validate API key for all bot routes
router.use(validateApiKey);

// Test route with completely optional validation
router.post('/test-order', validateBotOrderOptional, async (req, res) => {
  const startTime = Date.now();
  
  try {
    logger.info('TEST: Bot order creation request', {
      source: req.body.source,
      chatId: req.body.chatId,
      botOrderId: req.body.botOrderId,
      contact_id: req.body.contact_id,
      telegram_id: req.body.telegram_id,
      productCount: req.body.products?.length || 0,
      customerPhone: req.body.customerInfo?.phone
    });

    const result = await botController.createOrder(req.body);
    
    const duration = Date.now() - startTime;
    logger.info('TEST: Bot order creation completed', {
      botOrderId: req.body.botOrderId,
      crmOrderId: result.crmOrderId,
      duration: `${duration}ms`,
      success: true
    });

    res.status(201).json({
      ...result,
      testMode: true,
      message: 'TEST ORDER: ' + result.message
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('TEST: Bot order creation failed', {
      error: error.message,
      stack: error.stack,
      botOrderId: req.body.botOrderId,
      contact_id: req.body.contact_id,
      duration: `${duration}ms`
    });

    res.status(500).json({
      success: false,
      error: 'Test order creation failed',
      details: error.message,
      code: 'TEST_ORDER_CREATION_FAILED',
      testMode: true
    });
  }
});

// Create order from bot
router.post('/create-order', validateBotOrder, async (req, res) => {
  const startTime = Date.now();
  
  try {
    logger.info('Bot order creation request received', {
      source: req.body.source,
      chatId: req.body.chatId,
      botOrderId: req.body.botOrderId,
      productCount: req.body.products?.length || 0,
      customerPhone: req.body.customerInfo?.phone
    });

    const result = await botController.createOrder(req.body);
    
    const duration = Date.now() - startTime;
    logger.info('Bot order creation completed', {
      botOrderId: req.body.botOrderId,
      crmOrderId: result.crmOrderId,
      duration: `${duration}ms`,
      success: true
    });

    res.status(201).json(result);

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Bot order creation failed', {
      error: error.message,
      stack: error.stack,
      botOrderId: req.body.botOrderId,
      customerPhone: req.body.customerInfo?.phone,
      duration: `${duration}ms`
    });

    // Return user-friendly error message
    let errorMessage = 'Order creation failed';
    let statusCode = 500;

    if (error.message.includes('not found in CRM')) {
      errorMessage = 'Customer not found in system';
      statusCode = 404;
    } else if (error.message.includes('not mapped')) {
      errorMessage = 'Product not available';
      statusCode = 400;
    } else if (error.message.includes('validation')) {
      errorMessage = 'Invalid order data';
      statusCode = 400;
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'ORDER_CREATION_FAILED'
    });
  }
});

// Update order status
router.put('/update-order/:botOrderId', async (req, res) => {
  try {
    const { botOrderId } = req.params;
    const { status, notes, crmUpdate } = req.body;

    logger.info('Bot order update request', {
      botOrderId,
      newStatus: status
    });

    const result = await botController.updateOrder(botOrderId, {
      status,
      notes,
      crmUpdate
    });

    logger.info('Bot order updated successfully', {
      botOrderId,
      status
    });

    res.json(result);

  } catch (error) {
    logger.error('Bot order update failed', {
      error: error.message,
      botOrderId: req.params.botOrderId
    });

    const statusCode = error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
});

// Get order status
router.get('/order-status/:botOrderId', async (req, res) => {
  try {
    const { botOrderId } = req.params;
    
    const result = await botController.getOrderStatus(botOrderId);
    
    res.json(result);

  } catch (error) {
    logger.error('Get order status failed', {
      error: error.message,
      botOrderId: req.params.botOrderId
    });

    const statusCode = error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
});

// Cancel order
router.delete('/cancel-order/:botOrderId', async (req, res) => {
  try {
    const { botOrderId } = req.params;
    const { reason } = req.body;

    logger.info('Bot order cancellation request', {
      botOrderId,
      reason
    });

    const result = await botController.updateOrder(botOrderId, {
      status: 'CANCELLED',
      notes: `Cancelled: ${reason || 'No reason provided'}`,
      crmUpdate: true
    });

    logger.info('Bot order cancelled successfully', {
      botOrderId
    });

    res.json({
      ...result,
      message: 'Order cancelled successfully'
    });

  } catch (error) {
    logger.error('Bot order cancellation failed', {
      error: error.message,
      botOrderId: req.params.botOrderId
    });

    const statusCode = error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
});

// Get available products for bot
router.get('/products', async (req, res) => {
  try {
    const { source } = req.query;
    
    logger.info('Get available products request', { source });
    
    const result = await botController.getAvailableProducts();
    
    // Filter products based on source if needed
    let products = result.products;
    if (source) {
      // Add source-specific filtering logic here if needed
      logger.debug('Filtering products by source', { source });
    }

    res.json({
      success: true,
      products: products,
      count: products.length,
      source: source
    });

  } catch (error) {
    logger.error('Get available products failed', {
      error: error.message,
      source: req.query.source
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve products'
    });
  }
});

// Test connection endpoint for bots
router.post('/test-connection', (req, res) => {
  const { source, chatId } = req.body;
  
  logger.info('Bot connection test', { source, chatId });
  
  res.json({
    success: true,
    message: `Connection successful for ${source}`,
    timestamp: new Date().toISOString(),
    chatId: chatId,
    serverStatus: 'healthy'
  });
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    // Basic health check
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development'
    };

    // Check database connectivity
    try {
      const dbHealth = await botController.dbService.healthCheck();
      health.database = {
        crm: dbHealth.crm.status,
        ecommerce: dbHealth.ecommerce.status
      };
    } catch (error) {
      health.database = { error: error.message };
      health.status = 'degraded';
    }

    // Check SendPulse connectivity
    try {
      await botController.ensureValidToken();
      health.sendpulse = 'connected';
    } catch (error) {
      health.sendpulse = 'disconnected';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Get order history for a chat
router.get('/orders/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { source, limit = 10 } = req.query;

    logger.info('Get order history request', { chatId, source });

    // Get orders for this chat from database
    const orders = await botController.dbService.crmDb.botOrder.findMany({
      where: {
        chatId: chatId,
        ...(source && { source: source })
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });

    const formattedOrders = orders.map(order => ({
      botOrderId: order.botOrderId,
      status: order.status,
      totalAmount: parseFloat(order.totalAmount),
      currency: order.currency,
      createdAt: order.createdAt,
      products: JSON.parse(order.products)
    }));

    res.json({
      success: true,
      orders: formattedOrders,
      count: formattedOrders.length,
      chatId: chatId
    });

  } catch (error) {
    logger.error('Get order history failed', {
      error: error.message,
      chatId: req.params.chatId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve order history'
    });
  }
});

export default router;