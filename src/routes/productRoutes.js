// Product routes — public, no auth required (called directly by bots)
import { Router } from 'express';
import { getProductByEcommerceId } from '../controllers/productController.js';

const router = Router();

// GET /api/products/:ecommerceId?lang=ru
router.get('/products/:ecommerceId', getProductByEcommerceId);

export default router;
