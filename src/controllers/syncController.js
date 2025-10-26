// src/controllers/syncController.js
import logger from '../utils/logger.js';
import { SendPulseCRMService  } from '../services/sendPulseCrmService.js';
import axios from 'axios';

class SyncController {
  constructor() {
    this.crmService = new SendPulseCRMService();
    this.ecommerceApiUrl = process.env.ECOMMERCE_API_URL || 'http://localhost:5000';
    this.ecommerceApiToken = process.env.ECOMMERCE_API_TOKEN;
  }

  /**
   * Update deal status in SendPulse when ecommerce order status changes
   * POST /api/sync/update-deal-status
   */
  async updateDealStatus(req, res) {
    try {
      const {
        dealId,
        orderId,
        newStatus,
        previousStatus,
        orderData
      } = req.body;

      logger.info('Processing deal status update request', {
        dealId,
        orderId,
        newStatus,
        previousStatus
      });

      // Validate required fields
      if (!dealId || !orderId || !newStatus) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: dealId, orderId, newStatus'
        });
      }

      // Prepare update data for SendPulse
      const updateData = {
        status: newStatus,
        // Add comment about the status change
        notes: `Order status updated from ${previousStatus || 'unknown'} to ${newStatus} at ${new Date().toISOString()}`
      };

      // Add order details to the update if available
      if (orderData) {
        if (orderData.totalAmount) {
          updateData.totalAmount = parseFloat(orderData.totalAmount);
        }
        
        if (orderData.customer) {
          updateData.customerInfo = {
            name: `${orderData.customer.firstName || ''} ${orderData.customer.lastName || ''}`.trim(),
            email: orderData.customer.email,
            phone: orderData.customer.phone
          };
        }
      }

      // Update deal in SendPulse
      const updatedDeal = await this.crmService.updateDeal(dealId, updateData);

      // Log successful sync to ecommerce database
      await this.logSyncToEcommerce(orderId, dealId, 'UPDATE_STATUS', 'SUCCESS');

      logger.info('Deal status updated successfully', {
        dealId,
        orderId,
        newStatus
      });

      res.json({
        success: true,
        message: 'Deal status updated successfully',
        data: {
          dealId,
          orderId,
          oldStatus: previousStatus,
          newStatus,
          updatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to update deal status', {
        error: error.message,
        stack: error.stack,
        dealId: req.body?.dealId,
        orderId: req.body?.orderId
      });

      // Log failed sync to ecommerce database
      if (req.body?.orderId && req.body?.dealId) {
        await this.logSyncToEcommerce(
          req.body.orderId, 
          req.body.dealId, 
          'UPDATE_STATUS', 
          'FAILED', 
          error.message
        );
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update deal status',
        message: error.message,
        dealId: req.body?.dealId,
        orderId: req.body?.orderId
      });
    }
  }

  /**
   * Sync order from ecommerce to SendPulse (create new deal)
   * POST /api/sync/create-deal
   */
  async createDeal(req, res) {
    try {
      const { orderId, orderData } = req.body;

      logger.info('Creating deal in SendPulse', { orderId });

      if (!orderId || !orderData) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: orderId, orderData'
        });
      }

      // Transform ecommerce order data to CRM format
      const crmOrderData = this.transformOrderDataForCrm(orderData, orderId);

      // Create deal in SendPulse
      const deal = await this.crmService.createOrderInCRM(crmOrderData);

      // Update ecommerce order with SendPulse deal ID
      await this.updateEcommerceOrderSync(orderId, {
        sendpulseDealId: deal.id.toString(),
        sendpulseContactId: deal.customerId?.toString(),
        syncStatus: 'SYNCED',
        lastSyncAt: new Date().toISOString()
      });

      // Log successful sync
      await this.logSyncToEcommerce(orderId, deal.id, 'CREATE_DEAL', 'SUCCESS');

      logger.info('Deal created successfully', {
        orderId,
        dealId: deal.id
      });

      res.json({
        success: true,
        message: 'Deal created successfully',
        data: {
          orderId,
          dealId: deal.id,
          dealNumber: deal.number,
          contactId: deal.customerId,
          createdAt: deal.createdAt
        }
      });

    } catch (error) {
      logger.error('Failed to create deal', {
        error: error.message,
        orderId: req.body?.orderId
      });

      // Log failed sync
      if (req.body?.orderId) {
        await this.logSyncToEcommerce(
          req.body.orderId, 
          null, 
          'CREATE_DEAL', 
          'FAILED', 
          error.message
        );
      }

      res.status(500).json({
        success: false,
        error: 'Failed to create deal',
        message: error.message,
        orderId: req.body?.orderId
      });
    }
  }

  /**
   * Get sync status for an order
   * GET /api/sync/status/:orderId
   */
  async getSyncStatus(req, res) {
    try {
      const { orderId } = req.params;

      logger.info('Getting sync status', { orderId });

      // Call ecommerce API to get order with sync data
      const response = await axios.get(
        `${this.ecommerceApiUrl}/api/orders/${orderId}/sync`,
        {
          headers: {
            'X-Internal-API-Token': this.ecommerceApiToken
          }
        }
      );

      const { order } = response.data;

      res.json({
        success: true,
        data: {
          orderId: order.id,
          syncStatus: order.syncStatus,
          sendpulseDealId: order.sendpulseDealId,
          sendpulseContactId: order.sendpulseContactId,
          lastSyncAt: order.lastSyncAt,
          syncLogs: order.syncLogs || []
        }
      });

    } catch (error) {
      logger.error('Failed to get sync status', {
        error: error.message,
        orderId: req.params?.orderId
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get sync status',
        message: error.message
      });
    }
  }

  /**
   * Helper method to map order status to SendPulse status
   */
  mapOrderStatusToSendPulse(orderStatus) {
    const statusMapping = {
      'PENDING': 'new',
      'REQUIRES_AGREEMENT': 'requires_agreement',
      'CONFIRMED': 'in_progress',
      'DELIVERED': 'won',
      'CANCELLED': 'lost'
    };
    
    return statusMapping[orderStatus] || null;
  }

  /**
   * Helper method to transform ecommerce order data for CRM
   */
  transformOrderDataForCrm(orderData, orderId) {
    const customer = orderData.user || orderData.guestInfo || {};
    
    return {
      source: 'ECOMMERCE',
      chatId: `order_${orderId}`,
      customer: {
        firstName: customer.firstName || '',
        lastName: customer.lastName || '',
        email: customer.email || '',
        phone: customer.phone || ''
      },
      products: orderData.items?.map(item => ({
        id: item.productId || item.product?.id,
        name: item.product?.name || `Product ${item.productId}`,
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        totalPrice: parseFloat(item.price) * item.quantity
      })) || [],
      totalAmount: parseFloat(orderData.totalAmount),
      notes: orderData.notesClient || '',
      delivery: {
        type: orderData.deliveryType,
        date: orderData.deliveryDate,
        address: orderData.addressDelivery,
        station: orderData.stationDelivery,
        pickup: orderData.pickupDelivery
      }
    };
  }

  /**
   * Helper method to update ecommerce order with sync data
   */
  async updateEcommerceOrderSync(orderId, syncData) {
    try {
      await axios.patch(
        `${this.ecommerceApiUrl}/api/orders/${orderId}/sync-data`,
        syncData,
        {
          headers: {
            'X-Internal-API-Token': this.ecommerceApiToken,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      logger.warn('Failed to update ecommerce order sync data', {
        error: error.message,
        orderId
      });
    }
  }

  /**
   * Helper method to log sync operations to ecommerce database
   */
  async logSyncToEcommerce(orderId, dealId, syncType, syncStatus, errorMessage = null) {
    try {
      await axios.post(
        `${this.ecommerceApiUrl}/api/orders/${orderId}/sync-log`,
        {
          sendpulseDealId: dealId?.toString(),
          syncType,
          syncDirection: 'TO_CRM',
          syncStatus,
          errorMessage,
          syncData: {
            timestamp: new Date().toISOString(),
            service: 'CRM_INTEGRATION_SERVICE'
          }
        },
        {
          headers: {
            'X-Internal-API-Token': this.ecommerceApiToken,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      logger.warn('Failed to log sync to ecommerce', {
        error: error.message,
        orderId,
        dealId
      });
    }
  }
}

export default SyncController;