// scripts/testKeyCrmProducts.js
// Fetch one product from KeyCRM and print its raw custom_fields
// to discover real field names / UUIDs for chatbot name mapping.
//
// Usage:
//   node scripts/testKeyCrmProducts.js

import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config();

import { keyCrmApiService } from '../src/services/keyCrmApiService.js';

const products = await keyCrmApiService.getProducts({ fetchAll: false, limit: 1 });

if (!products.length) {
  console.log('No products returned from KeyCRM.');
  process.exit(0);
}

const product = products[0];

console.log('\n=== Product ===');
console.log(`id:   ${product.id}`);
console.log(`name: ${product.name}`);
console.log(`sku:  ${product.sku}`);

console.log('\n=== custom_fields (raw) ===');
console.log(JSON.stringify(product.custom_fields, null, 2));

console.log('\n=== chatbotNames (extracted by service) ===');
console.log(JSON.stringify(product.chatbotNames, null, 2));

console.log('\n=== has_offers / price / quantity ===');
console.log(`has_offers: ${product.has_offers}`);
console.log(`price:      ${product.price}`);
console.log(`quantity:   ${product.quantity}`);
