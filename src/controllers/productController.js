// Product controller — exposes KeyCRM product data via the integration service API
import { DatabaseService } from '../services/databaseService.js';
import { keyCrmApiService } from '../services/keyCrmApiService.js';
import logger from '../utils/logger.js';

const dbService = new DatabaseService();

// GET /api/products/:ecommerceId?lang=ru
//
// Returns product info for the given ecommerce product ID.
// `lang` query param selects the chatbot display name language (ua | ru | fr, default: ru).
// Falls back to UA name if the requested language has no value.
export async function getProductByEcommerceId(req, res) {
  const { ecommerceId } = req.params;
  const lang = req.query.lang || 'ru';

  // Validate ecommerceId is a positive integer
  const numericId = parseInt(ecommerceId, 10);
  if (isNaN(numericId) || numericId <= 0) {
    return res.status(400).json({ error: 'ecommerceId must be a positive integer' });
  }

  // Look up the product mapping stored in our DB
  const mapping = await dbService.crmDb.productMapping.findUnique({
    where: { ecommerceId: numericId },
  });

  if (!mapping) {
    logger.debug('Product mapping not found', { ecommerceId: numericId });
    return res.status(404).json({ error: `Product with ecommerceId ${numericId} not found` });
  }

  if (!mapping.keycrmId) {
    logger.warn('Product mapping has no keycrmId', { ecommerceId: numericId, mappingId: mapping.id });
    return res.status(404).json({ error: `Product ${numericId} is not yet synced with KeyCRM` });
  }

  // Fetch live product data from KeyCRM (includes custom_fields / chatbotNames)
  const keycrmProduct = await keyCrmApiService.getProductById(mapping.keycrmId);

  // Pick the display name for the requested language, fall back to UA
  const name =
    keycrmProduct.chatbotNames[lang] ||
    keycrmProduct.chatbotNames.ua ||
    keycrmProduct.name;

  logger.debug('Product fetched', { ecommerceId: numericId, keycrmId: mapping.keycrmId, lang });

  return res.json({
    id: numericId,
    name,
    price: keycrmProduct.price,
    sku: keycrmProduct.sku,
    keycrm_id: mapping.keycrmId,
  });
}
