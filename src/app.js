// CRM Integration Service - Main Application File
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Import routes
import telegramBotRoutes from './routes/telegramBotRoutes.js';
import syncRoutes from './routes/syncRoutes.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import logger from './utils/logger.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    process.env.ECOMMERCE_API_URL,
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:5000'
  ],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.API_RATE_LIMIT || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the headers
  legacyHeaders: false, // Disable the old headers
  skip: (req) => {
    // Skip rate limiting for health checks or if needed
    return req.path === '/health';
  },
  keyGenerator: (req) => {
    // Use x-forwarded-for header if available (Railway proxy), otherwise use req.ip
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  }
});
app.use(limiter);

// Logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'CRM Integration Service',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Routes
app.use('/api/bot', telegramBotRoutes);
app.use('/api/sync', authMiddleware, syncRoutes);



// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'CRM Integration Service API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      bot: '/api/bot',
      sync: '/api/sync'
    },
    availableEndpoints: {
      'POST /api/bot/telegram-order': 'Create telegram order',
      'GET /api/bot/telegram-health': 'Service health check',
      'POST /api/bot/test-product-conversion': 'Test product ID conversion',
      'POST /api/sync/update-deal-status': 'Update deal status in SendPulse (requires auth)',
      'POST /api/sync/create-deal': 'Create new deal from order (requires auth)',
      'GET /api/sync/status/:orderId': 'Get order sync status (requires auth)',
      'GET /api/sync/health': 'Sync service health check',
      'GET /health': 'Basic health check'
    },
    documentation: {
      authentication: 'Use X-Api-Key header with CRM_API_KEY or X-Internal-API-Token for sync endpoints'
    }
  });
});

// Temporary debug endpoint - NO AUTH
app.get('/debug-config', (req, res) => {
  const clientId = process.env.SENDPULSE_CLIENT_ID;
  const clientSecret = process.env.SENDPULSE_CLIENT_SECRET;
  
  res.json({
    timestamp: new Date().toISOString(),
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    clientIdLength: clientId?.length || 0,
    clientSecretLength: clientSecret?.length || 0,
    clientIdValue: clientId, // Покажем полностью для проверки
    clientSecretValue: clientSecret, // Покажем полностью для проверки
    clientIdFirstLast: clientId ? `${clientId[0]}...${clientId[clientId.length - 1]}` : 'NONE',
    hasQuotes: clientId?.startsWith('"') || clientId?.endsWith('"'),
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`CRM Integration Service started on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Port: ${PORT}`);
  logger.info(`Ecommerce API URL: ${process.env.ECOMMERCE_API_URL || 'NOT_CONFIGURED'}`);
  logger.info(`Available endpoints:`);
  logger.info(`- POST /api/bot/telegram-order`);
  logger.info(`- GET /api/bot/telegram-health`);
  logger.info(`- POST /api/bot/test-product-conversion`);
  logger.info(`- POST /api/sync/update-deal-status (requires auth)`);
  logger.info(`- POST /api/sync/create-deal (requires auth)`);
  logger.info(`- GET /api/sync/status/:orderId (requires auth)`);
  logger.info(`- GET /api/sync/health`);
  logger.info(`- GET /health`);

  // Log configuration warnings
  if (!process.env.SENDPULSE_CLIENT_ID || !process.env.SENDPULSE_CLIENT_SECRET) {
    logger.warn('⚠️  SendPulse credentials not configured!');
  }
  if (!process.env.ECOMMERCE_API_URL) {
    logger.warn('⚠️  Ecommerce API URL not configured!');
  }
  if (!process.env.CRM_API_KEY && !process.env.ECOMMERCE_API_TOKEN) {
    logger.warn('⚠️  No authentication tokens configured for sync endpoints!');
  }
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;