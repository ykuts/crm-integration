import { keyCrmOrderService } from '../services/keyCrmOrderService.js';
import { DatabaseService } from '../services/databaseService.js';
import logger from '../utils/logger.js';

const dbService = new DatabaseService();

export const emailOrderController = {
  async createFromEmail(req, res) {
    try {
      const emailOrderData = req.body;
      const { messageId, products, customer, orderNumber } = emailOrderData;

      if (!products?.length) {
        return res.status(400).json({ error: 'No products in order' });
      }
      if (!customer?.phone) {
        return res.status(400).json({ error: 'No customer phone' });
      }

      // Check if this email was already processed (deduplication)
      if (messageId) {
        const existing = await dbService.crmDb.botOrder.findUnique({
          where: { botOrderId: messageId }
        });
        if (existing) {
          logger.info('Email order already processed, skipping', { messageId, orderNumber });
          return res.status(200).json({
            success: true,
            skipped: true,
            message: 'Order already processed'
          });
        }
      }

      logger.info('Received Hostinger email order from n8n', {
        orderNumber,
        productCount: products.length,
        phone: customer.phone,
      });

      // Create order in KeyCRM
      const result = await keyCrmOrderService.createOrderFromEmail(emailOrderData);

      // Save to BotOrder for deduplication and tracking
      await dbService.crmDb.botOrder.create({
        data: {
          botOrderId: messageId || `email_${orderNumber}_${Date.now()}`,
          source: 'hostinger_email',
          chatId: 'email',
          customerPhone: customer.phone,
          customerName: customer.name || '',
          customerEmail: customer.email || null,
          totalAmount: emailOrderData.total || 0,
          paymentMethod: emailOrderData.paymentMethod || '',
          deliveryInfo: emailOrderData.deliveryMethod || '',
          products: JSON.stringify(products),
          status: 'CREATED',
          metadata: JSON.stringify({
            hostingerOrderNumber: orderNumber,
            keycrmOrderId: result.keycrmOrderId,
            keycrmOrderNumber: result.orderNumber,
            date: emailOrderData.date,
          }),
        }
      });

      logger.info('Email order saved to BotOrder table', {
        messageId,
        keycrmOrderId: result.keycrmOrderId,
      });

      return res.status(201).json({
        success: true,
        keycrmOrderId: result.keycrmOrderId,
        orderNumber: result.orderNumber,
      });

    } catch (error) {
      logger.error('Failed to create KeyCRM order from Hostinger email', {
        error: error.message,
      });
      return res.status(500).json({ error: error.message });
    }
  }
};