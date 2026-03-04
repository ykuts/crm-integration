/**
 * n8nHelper.js - Database-driven Google Sheets Integration
 * 
 * Uses product_mappings table to map products to Google Sheets columns
 * Features: Database caching (5 min), fallback handling, detailed logging
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * CACHE: Store product mappings in memory to avoid repeated DB queries
 * Refreshes every 5 minutes or on demand
 */
let productMappingCache = null;
let cacheLastUpdated = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get product mappings from database with caching
 * @returns {Promise<Array>} Array of product mappings
 */
export async function getProductMappings() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (productMappingCache && cacheLastUpdated && (now - cacheLastUpdated < CACHE_TTL)) {
    console.log('[n8nHelper] Using cached product mappings');
    return productMappingCache;
  }

  // Fetch from database
  console.log('[n8nHelper] Fetching product mappings from database');
  
  try {
    const mappings = await prisma.productMapping.findMany({
      where: {
        syncStatus: 'ACTIVE',
        googleSheetsColumn: { not: null }
      },
      select: {
        ecommerceId: true,
        name: true,
        googleSheetsColumn: true
      }
    });

    // Update cache
    productMappingCache = mappings;
    cacheLastUpdated = now;

    console.log(`[n8nHelper] Loaded ${mappings.length} product mappings from database`);
    
    return mappings;
  } catch (error) {
    console.error('[n8nHelper] Error fetching product mappings:', error.message);
    
    // Return cached data if available, even if expired
    if (productMappingCache) {
      console.warn('[n8nHelper] Using stale cache due to DB error');
      return productMappingCache;
    }
    
    throw error;
  }
}

/**
 * Clear cache (call this when you update mappings)
 */
export function clearMappingCache() {
  productMappingCache = null;
  cacheLastUpdated = null;
  console.log('[n8nHelper] Product mapping cache cleared');
}

/**
 * Get Google Sheets column for a product
 * @param {Object} product - Product object with id or nameUa
 * @returns {Promise<string|null>} Column identifier or null
 */
export async function getProductColumn(product) {
  try {
    const mappings = await getProductMappings();
    
    // Try to match by ecommerce ID first (most reliable)
    if (product.id) {
      const mapping = mappings.find(m => m.ecommerceId === product.id);
      if (mapping && mapping.googleSheetsColumn) {
        return mapping.googleSheetsColumn;
      }
    }

    // Try to match by name (fallback)
    if (product.nameUa || product.nameEn) {
      const productName = (product.nameUa || product.nameEn || '').toLowerCase();
      
      // Exact match
      let mapping = mappings.find(m => 
        m.name && m.name.toLowerCase() === productName
      );
      
      // Partial match if exact not found
      if (!mapping) {
        mapping = mappings.find(m =>
          m.name && (
            m.name.toLowerCase().includes(productName) ||
            productName.includes(m.name.toLowerCase())
          )
        );
      }
      
      if (mapping && mapping.googleSheetsColumn) {
        return mapping.googleSheetsColumn;
      }
    }

    console.warn('[n8nHelper] Product not mapped to Google Sheets column:', {
      productId: product.id,
      productName: product.nameUa || product.nameEn
    });
    
    return null;

  } catch (error) {
    console.error('[n8nHelper] Error getting product column:', error.message);
    return null;
  }
}

/**
 * Calculate product quantities for each column
 * @param {Array} items - Order items from database
 * @returns {Promise<Object>} Product quantities by column
 */
export async function calculateProductQuantities(items) {
  // Initialize all columns to 0
  const quantities = {
    cheese_300g: 0,
    cheese_packet_kg: 0,
    cheese_kg: 0,
    cottage_cheese_choc: 0,
    cheese_mass_300g: 0,
    syrnyky: 0,
    pelmeni: 0,
    holubtsi: 0,
    var_cherry: 0,
    var_cabbage: 0,
    var_potato_mushroom: 0,
    var_potato: 0,
    var_cheese: 0,
    var_meat: 0,
    nuts: 0
  };

  if (!items || !Array.isArray(items) || items.length === 0) {
    return quantities;
  }

  for (const item of items) {
    if (!item.product) {
      console.warn('[n8nHelper] Item without product:', item);
      continue;
    }
    
    const columnId = await getProductColumn(item.product);
    
    if (columnId && quantities.hasOwnProperty(columnId)) {
      // Add quantity (supports decimal quantities like 0.5 kg)
      quantities[columnId] += parseFloat(item.quantity) || 0;
    } else if (columnId) {
      // Column exists in DB but not in our quantities object
      console.warn('[n8nHelper] Unknown column ID from database:', columnId);
    }
  }

  return quantities;
}

/**
 * Format order data for Google Sheets (with product columns)
 * @param {Object} order - Order object from database
 * @returns {Promise<Object>} Formatted data for n8n webhook
 */
export async function formatOrderForSheet(order) {
  // Calculate product quantities from database
  const productQuantities = await calculateProductQuantities(order.items);

  // Format delivery address
  let deliveryAddress = '';
  if (order.deliveryType === 'RAILWAY_STATION') {
    deliveryAddress = order.deliveryStation || '';
  } else if (order.deliveryType === 'COURIER') {
    deliveryAddress = order.deliveryAddress || '';
  } else if (order.deliveryType === 'PICKUP') {
    deliveryAddress = 'Pickup - Nyon';
  }

  // Extract canton from delivery info
  const canton = order.canton || extractCanton(deliveryAddress) || '';

  return {
    // Customer info (columns A-F)
    clientName: order.customerName || order.guestInfo?.firstName + ' ' + order.guestInfo?.lastName || '',
    phone1: order.phone || order.guestInfo?.phone || '',
    phone2: order.phone2 || '',
    address: deliveryAddress,
    addressComments: order.deliveryNotes || order.notesClient || '',
    canton: canton,
    
    // Product quantities (columns J-W) - from database mapping!
    cheese300g: productQuantities.cheese_300g,
    cheesePacketKg: productQuantities.cheese_packet_kg,
    cheeseKg: productQuantities.cheese_kg,
    cottageCheesChoc: productQuantities.cottage_cheese_choc,
    cheeseMass300g: productQuantities.cheese_mass_300g,
    syrnyky: productQuantities.syrnyky,
    pelmeni: productQuantities.pelmeni,
    holubtsi: productQuantities.holubtsi,
    varCherry: productQuantities.var_cherry,
    varCabbage: productQuantities.var_cabbage,
    varPotatoMushroom: productQuantities.var_potato_mushroom,
    varPotato: productQuantities.var_potato,
    varCheese: productQuantities.var_cheese,
    varMeat: productQuantities.var_meat,
    nuts: productQuantities.nuts,
    
    // Metadata
    orderId: order.id,
    orderDate: new Date(order.createdAt).toLocaleDateString('uk-UA'),
    language: order.language || 'ua',
    activityLevel: 0
  };
}

/**
 * Extract canton from address string
 */
function extractCanton(address) {
  if (!address) return '';
  
  const addressLower = address.toLowerCase();
  
  const stationCantonMap = {
    'lausanne': 'VAUD',
    'morges': 'VAUD',
    'vevey': 'VAUD',
    'montreux': 'VAUD',
    'rolle': 'VAUD',
    'aigle': 'VAUD',
    'nyon': 'VAUD',
    'geneva': 'GE',
    'genève': 'GE',
    'geneve': 'GE'
  };
  
  for (const [station, canton] of Object.entries(stationCantonMap)) {
    if (addressLower.includes(station)) {
      return canton;
    }
  }
  
  return '';
}

/**
 * Send order to n8n webhook
 * @param {Object} order - Order object from database
 * @returns {Promise<boolean>} Success status
 */
export async function sendOrderToN8n(order) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('[n8nHelper] N8N_WEBHOOK_URL not configured, skipping Google Sheets sync');
    return false;
  }

  try {
    const formattedData = await formatOrderForSheet(order);
    
    console.log('[n8nHelper] Sending order to n8n:', { 
      orderId: order.id,
      clientName: formattedData.clientName,
      productsCount: order.items?.length || 0,
      totalProducts: Object.values(formattedData)
        .filter(v => typeof v === 'number' && v > 0)
        .reduce((sum, v) => sum + v, 0)
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sheetData: formattedData,
        rawOrder: {
          id: order.id,
          customerName: order.customerName,
          phone: order.phone,
          totalAmount: order.totalAmount,
          deliveryType: order.deliveryType,
          createdAt: order.createdAt
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n webhook responded with status ${response.status}: ${errorText}`);
    }

    console.log('[n8nHelper] ✅ Order successfully sent to n8n (Google Sheets)');
    
    return true;

  } catch (error) {
    console.error('[n8nHelper] ❌ Error sending order to n8n:', {
      orderId: order.id,
      error: error.message,
      stack: error.stack
    });
    
    // Don't throw - we don't want to fail order creation if Google Sheets sync fails
    return false;
  }
}

/**
 * Close Prisma connection (call on shutdown)
 */
export async function closeConnection() {
  await prisma.$disconnect();
  console.log('[n8nHelper] Prisma connection closed');
}