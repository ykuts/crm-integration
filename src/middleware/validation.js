// Validation Middleware - Bot Order Validation
import Joi from 'joi';
import logger from '../utils/logger.js';

/**
 * Validate API key for bot requests
 */
export const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const expectedApiKey = process.env.BOT_API_KEY;

  if (!expectedApiKey) {
    logger.error('BOT_API_KEY not configured in environment variables');
    return res.status(500).json({
      success: false,
      error: 'Server configuration error',
      code: 'API_KEY_NOT_CONFIGURED'
    });
  }

  if (!apiKey) {
    logger.warn('API request without API key', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.path
    });

    return res.status(401).json({
      success: false,
      error: 'API key required',
      code: 'API_KEY_MISSING'
    });
  }

  if (apiKey !== expectedApiKey) {
    logger.warn('Invalid API key attempt', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.path,
      providedKey: apiKey.substring(0, 8) + '...' // Log only first 8 chars for security
    });

    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      code: 'API_KEY_INVALID'
    });
  }

  logger.info('API key validated successfully', {
    endpoint: req.path,
    ip: req.ip
  });

  next();
};

/**
 * Validate bot order data
 */
export const validateBotOrder = (req, res, next) => {
  const schema = Joi.object({
    // Source information
    source: Joi.string().valid('telegram', 'whatsapp', 'messenger', 'instagram', 'viber').required(),
    chatId: Joi.string().required(),
    botOrderId: Joi.string().required(),

    // Customer information
    customerInfo: Joi.object({
      phone: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).optional(),
      firstName: Joi.string().min(1).max(100).optional(),
      lastName: Joi.string().min(1).max(100).optional(),
      email: Joi.string().email().optional()
    }).required(),

    // Products array
    products: Joi.array().items(
      Joi.object({
        id: Joi.number().integer().positive().required(),
        quantity: Joi.number().integer().min(1).max(100).required(),
        notes: Joi.string().max(500).optional()
      })
    ).min(1).max(50).required(),

    // Delivery information
    deliveryInfo: Joi.object({
      type: Joi.string().valid('railway_station', 'pickup_point', 'home_delivery', 'office').optional(),
      city: Joi.string().min(2).max(100).optional(),
      canton: Joi.string().length(2).optional(), // Swiss cantons: ZH, VD, etc.
      station: Joi.string().max(200).optional(),
      address: Joi.string().max(500).optional(),
      postalCode: Joi.string().max(20).optional(),
      notes: Joi.string().max(1000).optional()
    }).required(),

    // Payment information
    paymentMethod: Joi.string().valid('CASH', 'CARD', 'BANK_TRANSFER', 'TWINT').optional(),

    // Additional information
    notes: Joi.string().max(2000).optional(),
    
    // Optional metadata
    metadata: Joi.object({
      userLanguage: Joi.string().valid('en', 'de', 'fr', 'it', 'uk', 'ru').optional(),
      orderTimestamp: Joi.date().iso().optional(),
      customerTimezone: Joi.string().optional()
    }).optional()
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });

  if (error) {
    const validationErrors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    logger.warn('Bot order validation failed', {
      botOrderId: req.body.botOrderId,
      source: req.body.source,
      errors: validationErrors,
      customerPhone: req.body.customerInfo?.phone
    });

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: validationErrors
    });
  }

  // Add validated data to request
  req.body = value;

  logger.info('Bot order validation passed', {
    botOrderId: value.botOrderId,
    source: value.source,
    customerPhone: value.customerInfo.phone,
    productsCount: value.products.length
  });

  next();
};

/**
 * Validate bot order status update
 */
export const validateOrderUpdate = (req, res, next) => {
  const schema = Joi.object({
    status: Joi.string().valid(
      'PENDING', 
      'CONFIRMED', 
      'PREPARING', 
      'READY', 
      'DELIVERED', 
      'CANCELLED', 
      'REFUNDED'
    ).required(),
    notes: Joi.string().max(2000).optional(),
    crmUpdate: Joi.boolean().default(false)
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const validationErrors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: validationErrors
    });
  }

  req.body = value;
  next();
};

/**
 * Validate webhook signature (for incoming webhooks from SendPulse)
 */
export const validateWebhookSignature = (req, res, next) => {
  const signature = req.headers['x-sendpulse-signature'];
  const webhookSecret = process.env.SENDPULSE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.warn('Webhook secret not configured');
    return res.status(500).json({
      success: false,
      error: 'Webhook not configured'
    });
  }

  if (!signature) {
    logger.warn('Webhook request without signature', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.status(401).json({
      success: false,
      error: 'Signature required'
    });
  }

  // Here you would implement signature verification
  // This is a simplified version - in production, use proper HMAC verification
  const isValidSignature = signature === webhookSecret;

  if (!isValidSignature) {
    logger.warn('Invalid webhook signature', {
      ip: req.ip,
      providedSignature: signature.substring(0, 8) + '...'
    });

    return res.status(401).json({
      success: false,
      error: 'Invalid signature'
    });
  }

  logger.info('Webhook signature validated');
  next();
};