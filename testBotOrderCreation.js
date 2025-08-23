// Test Bot Order Creation - Full workflow
import { DatabaseService } from './src/services/databaseService.js';
import { SendPulseCRMService } from './src/services/sendPulseCrmService.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class BotOrderTester {
  constructor() {
    this.dbService = new DatabaseService();
    this.crmService = new SendPulseCRMService();
  }

  async testFullOrderWorkflow() {
    console.log('🤖 Testing Bot Order Creation Workflow');
    console.log('=====================================\n');

    try {
      // Step 1: Create sample bot order
      const sampleBotOrder = {
        source: 'whatsapp',
        chatId: 'test_chat_' + Date.now(),
        botOrderId: 'wa_order_' + Date.now(),
        customerInfo: {
          phone: '41797158774',
          firstName: 'Test',
          lastName: 'Customer'
        },
        products: [
          { id: 3, quantity: 1 }, // СИР КИСЛОМОЛОЧНИЙ
          { id: 7, quantity: 2 }  // ВАРЕНИКИ з вишнею
        ],
        deliveryInfo: {
          type: 'railway_station',
          city: 'Lausanne',
          canton: 'VD',
          station: 'Lausanne Gare'
        },
        paymentMethod: 'CASH',
        notes: 'Test order from bot integration'
      };

      console.log('📋 Sample bot order:');
      console.log(JSON.stringify(sampleBotOrder, null, 2));

      // Step 2: Validate and enrich products
      console.log('\n📦 Step 1: Validating and enriching products...');
      const enrichedProducts = await this.enrichProductsWithPricing(sampleBotOrder.products);
      
      console.log('Enriched products:');
      enrichedProducts.forEach(product => {
        console.log(`- ${product.name}: ${product.quantity}x ${product.unitPrice} CHF = ${product.totalPrice} CHF (SendPulse ID: ${product.sendpulseId})`);
      });

      const totalAmount = enrichedProducts.reduce((sum, p) => sum + p.totalPrice, 0);
      console.log(`Total order amount: ${totalAmount} CHF`);

      // Step 3: Create contact in SendPulse
      console.log('\n👤 Step 2: Creating/finding contact in SendPulse...');
      const contact = await this.findOrCreateContact(sampleBotOrder.customerInfo);
      console.log(`Contact: ${contact.firstName} ${contact.lastName} (ID: ${contact.id})`);

      // Step 4: Create deal in SendPulse
      console.log('\n🏢 Step 3: Creating deal in SendPulse...');
      const deal = await this.createDeal({
        title: `Bot Order - ${enrichedProducts.map(p => p.name).join(', ')}`,
        price: totalAmount,
        currency: 'CHF',
        contact: contact,
        products: enrichedProducts,
        delivery: sampleBotOrder.deliveryInfo,
        source: sampleBotOrder.source
      });
      console.log(`Deal created: ${deal.name} (ID: ${deal.id})`);

      // Step 5: Add products to deal
      console.log('\n🛍️ Step 4: Adding products to deal...');
      for (const product of enrichedProducts) {
        await this.addProductToDeal(deal.id, product);
        console.log(`Added: ${product.name} x${product.quantity}`);
      }

      // Step 6: Save bot order mapping
      console.log('\n💾 Step 5: Saving bot order mapping...');
      const botOrderMapping = await this.dbService.saveBotOrder({
        botOrderId: sampleBotOrder.botOrderId,
        source: sampleBotOrder.source,
        chatId: sampleBotOrder.chatId,
        sendpulseDealId: deal.id,
        sendpulseContactId: contact.id,
        customerPhone: sampleBotOrder.customerInfo.phone,
        customerName: `${sampleBotOrder.customerInfo.firstName} ${sampleBotOrder.customerInfo.lastName}`,
        totalAmount: totalAmount,
        paymentMethod: sampleBotOrder.paymentMethod,
        deliveryInfo: sampleBotOrder.deliveryInfo,
        notes: sampleBotOrder.notes,
        products: enrichedProducts
      });

      console.log('✅ Bot order mapping saved successfully!');
      console.log(`Mapping ID: ${botOrderMapping.id}`);

      console.log('\n🎉 Order creation workflow completed successfully!');
      console.log('===============================================');
      console.log(`Bot Order ID: ${sampleBotOrder.botOrderId}`);
      console.log(`SendPulse Deal ID: ${deal.id}`);
      console.log(`SendPulse Contact ID: ${contact.id}`);
      console.log(`Total Amount: ${totalAmount} CHF`);

      return {
        success: true,
        botOrderId: sampleBotOrder.botOrderId,
        dealId: deal.id,
        contactId: contact.id,
        totalAmount: totalAmount
      };

    } catch (error) {
      console.log('\n❌ Order creation failed:', error.message);
      console.log('Error details:', error);
      throw error;
    } finally {
      await this.dbService.disconnect();
    }
  }

  async enrichProductsWithPricing(products) {
    const enrichedProducts = [];

    for (const product of products) {
      // Get product from ecommerce database
      const ecommerceProduct = await this.dbService.getEcommerceProduct(product.id);
      
      // Get SendPulse mapping
      const mapping = await this.dbService.getProductMapping(product.id);
      if (!mapping) {
        throw new Error(`Product ${product.id} is not mapped to SendPulse. Run product mapping first.`);
      }

      enrichedProducts.push({
        id: product.id,
        sendpulseId: mapping.sendpulseId,
        name: ecommerceProduct.name,
        description: ecommerceProduct.description,
        quantity: product.quantity,
        unitPrice: parseFloat(ecommerceProduct.price),
        totalPrice: parseFloat(ecommerceProduct.price) * product.quantity
      });
    }

    return enrichedProducts;
  }

  async findOrCreateContact(customerInfo) {
  try {
    // Search for existing contact by phone
    const existingContacts = await axios.post('https://api.sendpulse.com/crm/v1/contacts/get-list', {
      phone: customerInfo.phone,
      limit: 1
    }, {
      headers: {
        'Authorization': `Bearer ${await this.crmService.ensureValidToken()}`,
        'Content-Type': 'application/json'
      }
    });

    const contacts = existingContacts.data?.data?.list || [];
    
    if (contacts.length > 0) {
      console.log(`Found existing contact: ${contacts[0].firstName} ${contacts[0].lastName} (ID: ${contacts[0].id})`);
      return contacts[0];
    }

    throw new Error(`Contact with phone ${customerInfo.phone} not found in CRM`);

  } catch (error) {
    console.log('Error finding contact:', error.response?.data || error.message);
    throw error;
  }
}

  async createDeal(dealData) {
    try {
      // Use your specific pipeline structure
      const dealRequest = {
        pipelineId: 153270, // Your pipeline ID
        stepId: 529997,     // Your step ID
        name: `${dealData.title} - ${dealData.products.length} items`,
        price: dealData.price,
        currency: dealData.currency,
        contact: [dealData.contact.id],
        attributes: [
          { attributeId: 922104, value: `${dealData.delivery?.city || 'Unknown'}, ${dealData.delivery?.station || 'Unknown'}` },
          { attributeId: 922108, value: dealData.products.map(p => `${p.name} x${p.quantity}`).join(', ') },
          { attributeId: 922119, value: "Не указано" },
          { attributeId: 922130, value: "Не оплачено" },
          { attributeId: 922253, value: dealData.delivery?.station || 'Unknown' },
          { attributeId: 922255, value: `${dealData.delivery?.city || 'Unknown'}, ${dealData.delivery?.canton || 'Unknown'}` },
          { attributeId: 922259, value: dealData.price.toString() },
          { attributeId: 923272, value: dealData.products.map(p => `${p.name} x${p.quantity}`).join(', ') },
          { attributeId: 923273, value: "uk" },
          { attributeId: 923274, value: `${dealData.contact.firstName} ${dealData.contact.lastName}` },
          { attributeId: 923275, value: dealData.delivery?.canton || 'Unknown' },
          { attributeId: 923276, value: dealData.delivery?.city || 'Unknown' },
          { attributeId: 923277, value: dealData.delivery?.station || 'Unknown' },
          { attributeId: 923278, value: dealData.products.map(p => `${p.unitPrice} CHF`).join(', ') },
          { attributeId: 923279, value: dealData.products.reduce((sum, p) => sum + p.quantity, 0).toString() },
          { attributeId: 923605, value: dealData.price.toString() },
          { attributeId: 923606, value: dealData.products.map(p => p.unitPrice).join(', ') },
          { attributeId: 923613, value: dealData.products.map(p => p.name).join(', ') }
        ]
      };

      console.log('Creating deal with data:', JSON.stringify(dealRequest, null, 2));

      const response = await axios.post('https://api.sendpulse.com/crm/v1/deals', dealRequest, {
        headers: {
          'Authorization': `Bearer ${await this.crmService.ensureValidToken()}`,
          'Content-Type': 'application/json'
        }
      });

      const dealId = response.data?.data?.id;
      console.log('Deal created successfully with ID:', dealId);

      if (!dealId) {
      console.log('Full response:', JSON.stringify(response.data, null, 2));
      throw new Error('Deal ID not found in response');
    }

    return {
      ...response.data.data,
      id: dealId
    };

    } catch (error) {
      console.log('Error creating deal:', error.response?.data || error.message);
      throw error;
    }
  }

  async addProductToDeal(dealId, product) {
  try {
    console.log(`Adding product ${product.name} to deal ${dealId}`);
    
    const response = await axios.post('https://api.sendpulse.com/crm/v1/products/deals', {
      productId: product.sendpulseId,
      dealId: dealId,
      productPriceISO: 'CHF',
      productPriceValue: product.unitPrice,
      quantity: product.quantity
    }, {
      headers: {
        'Authorization': `Bearer ${await this.crmService.ensureValidToken()}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Product added successfully:', response.data);
    return response.data;

  } catch (error) {
    console.log(`Error adding product ${product.name} to deal ${dealId}:`, error.response?.data || error.message);
    console.log('Request data was:', {
      productId: product.sendpulseId,
      dealId: dealId,
      productPriceISO: 'CHF',
      productPriceValue: product.unitPrice,
      quantity: product.quantity
    });
    throw error;
  }
}
}

// Initialize SendPulse service
class SimpleSendPulseService {
  constructor() {
    this.clientId = process.env.SENDPULSE_CLIENT_ID;
    this.clientSecret = process.env.SENDPULSE_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async ensureValidToken() {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post('https://api.sendpulse.com/oauth/access_token', {
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 60) * 1000);
    
    return this.accessToken;
  }
}

async function main() {
  // Check if mappings exist first
  console.log('🔍 Checking product mappings...');
  const dbService = new DatabaseService();
  
  try {
    const mappings = await dbService.getAllProductMappings();
    if (mappings.length === 0) {
      console.log('❌ No product mappings found. Please run:');
      console.log('node createProductMapping.js --create');
      return;
    }
    console.log(`✅ Found ${mappings.length} product mappings`);
  } finally {
    await dbService.disconnect();
  }

  // Run the test
  const tester = new BotOrderTester();
  tester.crmService = new SimpleSendPulseService(); // Use simplified service
  
  console.log('\n⚠️  This will create a real order in SendPulse CRM!');
  console.log('Continue? The test order will be created with test data.');
  
  // Uncomment to actually run the test:
    await tester.testFullOrderWorkflow();
  
  console.log('\n💡 Uncomment the line above to actually create a test order');
}

main().catch(console.error);

export { BotOrderTester };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}