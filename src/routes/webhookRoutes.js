// src/routes/webhookRoutes.js
import express from 'express';
import logger from '../utils/logger.js';
import axios from 'axios';

const router = express.Router();

// Configuration
const ECOMMERCE_API_URL = process.env.ECOMMERCE_API_URL || 'http://localhost:5000';
const ECOMMERCE_API_TOKEN = process.env.ECOMMERCE_API_TOKEN;

/**
 * Map SendPulse step name to ecommerce order status
 */
const mapStepNameToOrderStatus = (stepName) => {
  const mapping = {
    'Нові замовлення': 'PENDING',
    'Треба домовитись': 'REQUIRES_AGREEMENT',
    'Підтверджено': 'CONFIRMED',
    'Виконано': 'DELIVERED',
    'Відмінено': 'CANCELLED'
  };
  
  return mapping[stepName] || null;
};

/**
 * POST /api/webhook/sendpulse
 * Receives notifications from SendPulse when deals change
 */
router.post('/sendpulse', async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Log everything SendPulse sends us
    logger.info('📥 Webhook received from SendPulse', {
      title: webhookData.title,
      deal_id: webhookData.variables?.deal_id,
      stepName: webhookData.variables?.stepName_deal,
      timestamp: new Date().toISOString()
    });

    // Extract data
    const dealId = webhookData.variables?.deal_id;
    const stepName = webhookData.variables?.stepName_deal;
    const dealNumber = webhookData.variables?.number;

    // Validate required fields
    if (!dealId) {
      logger.warn('⚠️  Webhook missing deal_id');
      return res.status(200).json({
        success: false,
        message: 'Missing deal_id'
      });
    }

    if (!stepName) {
      logger.warn('⚠️  Webhook missing stepName_deal');
      return res.status(200).json({
        success: false,
        message: 'Missing stepName_deal'
      });
    }

    // Map SendPulse status to ecommerce status
    const newOrderStatus = mapStepNameToOrderStatus(stepName);
    
    if (!newOrderStatus) {
      logger.warn('⚠️  Unknown step name from SendPulse', { stepName });
      return res.status(200).json({
        success: false,
        message: `Unknown step name: ${stepName}`
      });
    }

    logger.info('🔄 Mapped SendPulse status to order status', {
      sendpulseStep: stepName,
      orderStatus: newOrderStatus
    });

    // Find order by SendPulse deal ID
    try {
      // Call ecommerce API to find order by deal ID
      const findOrderResponse = await axios.get(
        `${ECOMMERCE_API_URL}/api/orders/by-deal/${dealId}`,
        {
          headers: {
            'X-Internal-API-Token': ECOMMERCE_API_TOKEN
          },
          timeout: 5000
        }
      );

      const order = findOrderResponse.data.order;
      
      if (!order) {
        logger.warn('⚠️  Order not found for deal', { dealId });
        return res.status(200).json({
          success: false,
          message: `Order not found for deal ${dealId}`
        });
      }

      logger.info('✅ Found order for deal', {
        orderId: order.id,
        dealId,
        currentStatus: order.status
      });

      // Update order status if it changed
      if (order.status !== newOrderStatus) {
        logger.info('📝 Updating order status', {
          orderId: order.id,
          oldStatus: order.status,
          newStatus: newOrderStatus
        });

        await axios.patch(
          `${ECOMMERCE_API_URL}/api/orders/${order.id}/status`,
          {
            status: newOrderStatus
          },
          {
            headers: {
              'X-Internal-API-Token': ECOMMERCE_API_TOKEN
            },
            timeout: 5000
          }
        );

        logger.info('✅ Order status updated successfully from SendPulse webhook', {
          orderId: order.id,
          dealId,
          newStatus: newOrderStatus
        });

        return res.status(200).json({
          success: true,
          message: 'Order status updated',
          orderId: order.id,
          newStatus: newOrderStatus
        });
      } else {
        logger.info('ℹ️  Order status already matches', {
          orderId: order.id,
          status: order.status
        });

        return res.status(200).json({
          success: true,
          message: 'Status already up to date',
          orderId: order.id,
          status: order.status
        });
      }

    } catch (apiError) {
      logger.error('❌ Failed to update order via ecommerce API', {
        error: apiError.message,
        dealId,
        status: apiError.response?.status
      });

      // Still return 200 so SendPulse doesn't retry
      return res.status(200).json({
        success: false,
        error: 'Failed to update order',
        message: apiError.message
      });
    }

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