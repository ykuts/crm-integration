// src/routes/webhookRoutes.js
import express from 'express';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/webhook/sendpulse
 * Receives notifications from SendPulse when deals change
 */
router.post('/sendpulse', async (req, res) => {
  try {
    // Log everything SendPulse sends us
    logger.info('📥 Webhook received from SendPulse', {
      body: req.body,
      headers: req.headers,
      timestamp: new Date().toISOString()
    });

    // For now, just acknowledge we received it
    res.status(200).json({
      success: true,
      message: 'Webhook received',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Webhook processing failed', {
      error: error.message,
      stack: error.stack
    });

    // Still return 200 so SendPulse doesn't retry
    res.status(200).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/webhook/test
 * Test endpoint to check webhook is accessible
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook endpoint is working!',
    timestamp: new Date().toISOString()
  });
});

export default router;