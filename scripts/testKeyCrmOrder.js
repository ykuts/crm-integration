import 'dotenv/config';
import { keyCrmOrderService } from '../src/services/keyCrmOrderService.js';

const result = await keyCrmOrderService.createOrderFromBot({
  source: 'whatsapp',   // или 'whatsapp' / 'instagram' /'telegram'
  products: [{ id: 3, quantity: 1 }],
  customerInfo: { firstName: 'Test', lastName: 'User', phone: '41793883071' },
  deliveryInfo: { city: 'Geneva', station: 'Cornavin', canton: 'GE' },
  notes: 'TEST ORDER - please delete'
});
console.log('Result:', JSON.stringify(result, null, 2));
