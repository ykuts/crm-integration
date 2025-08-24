// Clean Telegram Order Test - No local DB save
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'https://crm-integration-production.up.railway.app';
const API_KEY = process.env.BOT_API_KEY;

async function testCleanTelegramOrder() {
  console.log('Testing Clean Telegram Order Creation');
  console.log('====================================\n');

  try {
    // Minimal telegram order data
    const telegramOrderData = {
      source: 'telegram',
      contact_id: '68aa34e085b07ce3d604bd4d', // This works!
      telegram_id: '5955533219',
      
      customerInfo: {
        firstName: 'Yulia',
        username: 'julia_kuts_1'
      },
      
      products: [
        {
          id: 3,
          quantity: 2
        }
      ],
      
      notes: 'Clean telegram order test'
    };

    console.log('Telegram order data:');
    console.log(JSON.stringify(telegramOrderData, null, 2));

    console.log('\nCreating clean telegram order...');
    
    const response = await axios.post(`${API_BASE_URL}/api/bot/telegram-order`, telegramOrderData, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('SUCCESS! Clean telegram order created');
    console.log('Response:');
    console.log(JSON.stringify(response.data, null, 2));

    const orderDetails = response.data;
    console.log('\nOrder Summary:');
    console.log(`- Bot Order ID: ${orderDetails.botOrderId}`);
    console.log(`- SendPulse Deal ID: ${orderDetails.crmOrderId}`);
    console.log(`- Order Number: ${orderDetails.orderNumber}`);
    console.log(`- Total Amount: ${orderDetails.totalAmount} CHF`);
    console.log(`- Contact ID: ${orderDetails.contactId}`);
    console.log(`- Status: ${orderDetails.status}`);

    return {
      success: true,
      order: orderDetails
    };

  } catch (error) {
    console.log('FAILED - Clean telegram order creation failed');
    console.log('Status:', error.response?.status);
    console.log('Error details:');
    console.log(JSON.stringify(error.response?.data, null, 2));
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

async function testTelegramHealth() {
  console.log('Testing Telegram Health Check');
  console.log('=============================\n');

  try {
    const response = await axios.get(`${API_BASE_URL}/api/bot/telegram-health`, {
      headers: {
        'x-api-key': API_KEY
      }
    });

    console.log('Health check response:');
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;

  } catch (error) {
    console.log('Health check failed');
    console.log('Status:', error.response?.status);
    console.log('Error:', JSON.stringify(error.response?.data, null, 2));
    
    return {
      status: 'failed',
      error: error.response?.data || error.message
    };
  }
}

// Run clean tests
async function runCleanTests() {
  try {
    console.log('RUNNING CLEAN TELEGRAM TESTS');
    console.log('============================');
    
    // Test 1: Health check
    console.log('\nTest 1: Health Check');
    const healthResult = await testTelegramHealth();
    
    if (healthResult.status === 'healthy') {
      console.log('Health check passed, proceeding with order test...');
      
      // Test 2: Create order
      console.log('\nTest 2: Order Creation');
      const orderResult = await testCleanTelegramOrder();
      
      if (orderResult.success) {
        console.log('\nSUCCESS! Clean telegram integration is working');
        console.log('The order was created directly in SendPulse CRM');
        console.log('No local database issues');
      } else {
        console.log('\nOrder creation failed');
      }
    } else {
      console.log('Health check failed, skipping order test');
    }
    
  } catch (error) {
    console.log('\nAll tests failed');
    console.log('Final error:', error.message);
  }
}

// Execute clean tests
runCleanTests();