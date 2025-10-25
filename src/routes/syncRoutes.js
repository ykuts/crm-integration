// src/routes/syncRoutes.js
import express from 'express';
import SyncController from '../controllers/syncController.js';
import logger from '../utils/logger.js';

const router = express.Router();
const syncController = new SyncController();

// Middleware to log all sync requests
router.use((req, res, next) => {
  logger.info('Sync API request', {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: {
      'user-agent': req.get('User-Agent'),
      'x-internal-api-token': req.get('X-Internal-API-Token') ? '[PRESENT]' : '[MISSING]'
    }
  });
  next();
});

/**
 * POST /api/sync/update-deal-status
 * Update deal status in SendPulse when ecommerce order status changes
 * Body: { dealId, orderId, newStatus, previousStatus, orderData }
 */
router.post('/update-deal-status', async (req, res) => {
  await syncController.updateDealStatus(req, res);
});

/**
 * POST /api/sync/create-deal
 * Create new deal in SendPulse from ecommerce order
 * Body: { orderId, orderData }
 */
router.post('/create-deal', async (req, res) => {
  await syncController.createDeal(req, res);
});

/**
 * GET /api/sync/status/:orderId
 * Get sync status for an order
 */
router.get('/status/:orderId', async (req, res) => {
  await syncController.getSyncStatus(req, res);
});

/**
 * POST /api/sync/test-connection
 * Test SendPulse connection and configuration
 */
router.post('/test-connection', async (req, res) => {
  try {
    logger.info('Testing SendPulse connection via sync controller');
    
    const crmService = syncController.crmService;
    const healthCheck = await crmService.healthCheck();
    
    res.json({
      success: true,
      message: 'SendPulse connection test completed',
      data: healthCheck,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('SendPulse connection test failed', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: 'SendPulse connection test failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/sync/health
 * Health check for sync service
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'CRM Sync Service',
    status: 'operational',
    endpoints: {
      'POST /update-deal-status': 'Update deal status in SendPulse',
      'POST /create-deal': 'Create new deal from order',
      'GET /status/:orderId': 'Get order sync status',
      'POST /test-connection': 'Test SendPulse connection'
    },
    configuration: {
      ecommerceApiUrl: process.env.ECOMMERCE_API_URL || 'NOT_CONFIGURED',
      sendPulseConfigured: !!(process.env.SENDPULSE_CLIENT_ID && process.env.SENDPULSE_CLIENT_SECRET),
      internalAuthConfigured: !!process.env.ECOMMERCE_API_TOKEN
    },
    timestamp: new Date().toISOString()
  });
});

export default router;

// Don't forget to import this in your app.js:
// import syncRoutes from './routes/syncRoutes.js';