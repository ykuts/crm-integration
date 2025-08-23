// CRM Integration Service - Main Application File
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Import routes
import botRoutes from './routes/botRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import syncRoutes from './routes/syncRoutes.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import logger from './utils/logger.js';

// Import services
import { SyncManager } from './services/syncManager.js';

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
  message: 'Too many requests from this IP, please try again later.'
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
app.use('/api/bot', authMiddleware, botRoutes);
app.use('/api/webhook', webhookRoutes); // No auth for webhooks (signature validation instead)
app.use('/api/sync', authMiddleware, syncRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'CRM Integration Service API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      bot: '/api/bot',
      webhooks: '/api/webhook',
      sync: '/api/sync'
    }
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize sync manager if auto sync is enabled
let syncManager;
if (process.env.ENABLE_AUTO_SYNC === 'true') {
  syncManager = new SyncManager();
  syncManager.startSyncJobs();
  logger.info('Auto sync jobs started');
}

// Start server
app.listen(PORT, () => {
  logger.info(`CRM Integration Service started on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`CRM API URL: ${process.env.CRM_API_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (syncManager) {
    syncManager.stopSyncJobs();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  if (syncManager) {
    syncManager.stopSyncJobs();
  }
  process.exit(0);
});

export default app;