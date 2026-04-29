// Controller for creating KeyCRM orders from parsed Hostinger email notifications
import { keyCrmOrderService } from '../services/keyCrmOrderService.js';
import logger from '../utils/logger.js';

export const emailOrderController = {
  async createFromEmail(req, res) {
    try {
      const emailOrderData = req.body;

      if (!emailOrderData.products?.length) {
        return res.status(400).json({ error: 'No products in order' });
      }
      if (!emailOrderData.customer?.phone) {
        return res.status(400).json({ error: 'No customer phone' });
      }

      logger.info('Received Hostinger email order from n8n', {
        orderNumber: emailOrderData.orderNumber,
        productCount: emailOrderData.products.length,
        phone: emailOrderData.customer.phone,
      });

      const result = await keyCrmOrderService.createOrderFromEmail(emailOrderData);

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