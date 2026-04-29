// Routes for Hostinger email order processing (called by n8n)
import express from 'express';
import { emailOrderController } from '../controllers/emailOrderController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// POST /api/orders/from-email
router.post('/from-email', authMiddleware, emailOrderController.createFromEmail);

export default router;