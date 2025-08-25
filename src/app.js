// CRM Integration Service - Main Application File
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Import routes
import telegramBotRoutes from './routes/telegramBotRoutes.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
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
    'http://localhost:3002'
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
  // Fix for Railway proxy - use skip instead of trustProxy
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

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'CRM Integration Service API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      bot: '/api/bot'
    },
    availableEndpoints: {
      'POST /api/bot/telegram-order': 'Create telegram order',
      'GET /api/bot/telegram-health': 'Service health check',
      'POST /api/bot/test-product-conversion': 'Test product ID conversion',
      'GET /health': 'Basic health check'
    }
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`CRM Integration Service started on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`CRM API URL: ${process.env.CRM_API_URL}`);
  logger.info(`Available endpoints:`);
  logger.info(`- POST /api/bot/telegram-order`);
  logger.info(`- GET /api/bot/telegram-health`);
  logger.info(`- POST /api/bot/test-product-conversion`);
  logger.info(`- GET /health`);
});

export default app;