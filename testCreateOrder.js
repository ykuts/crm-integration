// Final Test - Create Telegram Order with Working Contact Lookup
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'https://crm-integration-production.up.railway.app';
const API_KEY = process.env.BOT_API_KEY;

async function testWorkingTelegramOrder() {
  console.log('🚀 Testing Working Telegram Order Creation');
  console.log('==========================================\n');

  try {
    // Use your real telegram data with correct structure
    const telegramOrderData = {
      // Required API fields
      source: 'telegram',
      chatId: '5955533219', // telegram_id
      botOrderId: '68949854e2fdd9cf5f06ef10', // bot_id from your logs
      
      // Telegram contact data
      contact_id: '68aa34e085b07ce3d604bd4d', // Messenger external ID
      telegram_id: '5955533219',
      
      // Customer info from telegram
      customerInfo: {
        firstName: 'Yulia',
        lastName: '', // Empty in your logs
        username: 'julia_kuts_1'
      },
      
      // Product data
      products: [
        {
          id: 3, // product_id_num from your logs
          quantity: 2 // quantity from your logs
        }
      ],
      
      // Use defaults for delivery (will be filled by fallbacks)
      deliveryInfo: {
        type: 'pickup_point',
        city: 'Geneva',
        canton: 'GE',
        station: 'Geneva Central Station'
      },
      
      // Payment method
      paymentMethod: 'CASH',
      
      // Notes
      notes: 'Telegram order from Syrnyk bot - User: @julia_kuts_1'
    };

    console.log('📱 Telegram order data:');
    console.log(JSON.stringify(telegramOrderData, null, 2));

    // Create the order
    console.log('\n📦 Creating telegram order...');
    
    const response = await axios.post(`${API_BASE_URL}/api/bot/test-order`, telegramOrderData, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ TELEGRAM ORDER CREATED SUCCESSFULLY! 🎉');
    console.log('Response:');
    console.log(JSON.stringify(response.data, null, 2));

    // Verify the order details
    const orderDetails = response.data;
    console.log('\n📋 Order Summary:');
    console.log(`- Bot Order ID: ${orderDetails.botOrderId}`);
    console.log(`- CRM Order ID: ${orderDetails.crmOrderId}`);
    console.log(`- Order Number: ${orderDetails.orderNumber}`);
    console.log(`- Total Amount: ${orderDetails.totalAmount} CHF`);
    console.log(`- Contact ID: ${orderDetails.contactId}`);
    console.log(`- External Contact ID: ${orderDetails.externalContactId}`);
    console.log(`- Status: ${orderDetails.status}`);

    return {
      success: true,
      order: orderDetails
    };

  } catch (error) {
    console.log('❌ TELEGRAM ORDER FAILED');
    console.log('Status:', error.response?.status);
    console.log('Error details:');
    console.log(JSON.stringify(error.response?.data, null, 2));
    
    // Analyze the error
    const errorData = error.response?.data;
    if (errorData?.code === 'VALIDATION_ERROR') {
      console.log('\n🔍 Validation errors:');
      errorData.details?.forEach(detail => {
        console.log(`- ${detail.field}: ${detail.message}`);
      });
    }
    
    return {
      success: false,
      error: errorData || error.message
    };
  }
}

async function testMinimalTelegramOrder() {
  console.log('\n🔧 Testing Minimal Telegram Order (Fallback)');
  console.log('==============================================\n');

  try {
    // Absolute minimum required fields
    const minimalData = {
      source: 'telegram',
      chatId: '5955533219',
      botOrderId: `minimal_${Date.now()}`,
      contact_id: '68aa34e085b07ce3d604bd4d', // This we know works!
      
      customerInfo: {
        firstName: 'Yulia'
      },
      
      products: [
        {
          id: 3,
          quantity: 2
        }
      ]
    };

    console.log('📱 Minimal data:');
    console.log(JSON.stringify(minimalData, null, 2));

    const response = await axios.post(`${API_BASE_URL}/api/bot/test-order`, minimalData, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ MINIMAL ORDER CREATED! 🎉');
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;

  } catch (error) {
    console.log('❌ Minimal order failed');
    console.log('Status:', error.response?.status);
    console.log('Error:', JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
}

// Run the working test
async function runWorkingTest() {
  try {
    console.log('🎯 RUNNING WORKING TELEGRAM ORDER TEST');
    console.log('=====================================');
    
    // Test with full data first
    const result = await testWorkingTelegramOrder();
    
    if (result.success) {
      console.log('\n🎉 SUCCESS! Your telegram bot integration is working!');
      console.log('The order has been created in SendPulse CRM.');
    } else {
      console.log('\n⚠️ Full test failed, trying minimal version...');
      await testMinimalTelegramOrder();
    }
    
  } catch (error) {
    console.log('\n💥 All tests failed');
    console.log('Final error:', error.message);
  }
}

// Execute the working test
runWorkingTest();