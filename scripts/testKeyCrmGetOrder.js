import 'dotenv/config';
import axios from 'axios';

const ORDER_ID = 763;

let response;
try {
  response = await axios.get(
    `https://openapi.keycrm.app/v1/order/${ORDER_ID}`,
    {
      params: { include: 'custom_fields' },
      headers: {
        Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
        Accept: 'application/json',
      },
    }
  );
} catch (error) {
  console.error('Request failed:', error.response?.status, error.response?.statusText);
  console.error('Response body:', JSON.stringify(error.response?.data, null, 2));
  console.error('Message:', error.message);
  process.exit(1);
}

const order = response.data;

console.log('\n=== Order ===');
console.log(`id:            ${order.id}`);
console.log(`order_number:  ${order.order_number}`);
console.log(`status:        ${order.status}`);
console.log(`source_id:     ${order.source_id}`);
console.log(`buyer_comment: ${order.buyer_comment}`);

console.log('\n=== Buyer ===');
console.log(JSON.stringify(order.buyer, null, 2));

console.log('\n=== Products ===');
console.log(JSON.stringify(order.products, null, 2));

console.log('\n=== custom_fields (raw) ===');
console.log(JSON.stringify(order.custom_fields, null, 2));

// Print full order data without circular references
console.log('\n=== Full order (all fields) ===');
const safeFields = Object.fromEntries(
  Object.entries(order).filter(([, v]) => typeof v !== 'function')
);
console.log(JSON.stringify(safeFields, null, 2));
