// Test if contact exists in SendPulse by ID
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function getAccessToken() {
  try {
    const response = await axios.post('https://api.sendpulse.com/oauth/access_token', {
      grant_type: 'client_credentials',
      client_id: process.env.SENDPULSE_CLIENT_ID,
      client_secret: process.env.SENDPULSE_CLIENT_SECRET
    });

    return response.data.access_token;
  } catch (error) {
    console.error('Failed to get access token:', error.response?.data || error.message);
    throw error;
  }
}

async function testContactLookup() {
  console.log('🔍 Testing Contact Lookup in SendPulse');
  console.log('====================================\n');

  try {
    // Get access token
    console.log('Getting access token...');
    const token = await getAccessToken();
    console.log('✅ Access token obtained');

    // Test with your real contact_id from telegram logs
    const contactId = '68aa34e085b07ce3d604bd4d';
    
    console.log(`\n👤 Looking up contact ID: ${contactId}`);

    const response = await axios.get(`https://api.sendpulse.com/crm/v1/contacts/${contactId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const contact = response.data?.data;
    
    if (contact) {
      console.log('✅ Contact found!');
      console.log('Contact details:');
      console.log(`- ID: ${contact.id}`);
      console.log(`- Name: ${contact.firstName || ''} ${contact.lastName || ''}`.trim());
      console.log(`- Phone: ${contact.phones?.[0]?.phone || 'Not provided'}`);
      console.log(`- Email: ${contact.emails?.[0]?.email || 'Not provided'}`);
      console.log(`- Created: ${contact.createdAt}`);
      console.log(`- Source: ${contact.sourceType || 'Unknown'}`);
      
      return {
        success: true,
        contact: contact
      };
    } else {
      console.log('❌ Contact not found');
      return {
        success: false,
        error: 'Contact not found'
      };
    }

  } catch (error) {
    console.log('❌ Error looking up contact:');
    console.log('Status:', error.response?.status);
    console.log('Error:', error.response?.data || error.message);
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Test order creation with minimal data and direct contact lookup
 */
async function testMinimalOrderWithContactId() {
  console.log('\n📦 Testing Minimal Order with Contact ID');
  console.log('========================================\n');

  try {
    // Minimal order data using your real values
    const orderData = {
      source: 'telegram',
      chatId: '5955533219', // telegram_id
      botOrderId: `test_${Date.now()}`, // Generate new ID for testing
      contact_id: '68aa34e085b07ce3d604bd4d', // Real contact_id from logs
      telegram_id: '5955533219',
      
      customerInfo: {
        firstName: 'Yulia',
        lastName: '', // Empty as in logs
        username: 'julia_kuts_1'
      },
      
      products: [
        {
          id: 3, // product_id_num
          quantity: 2 // quantity
        }
      ]
      // Everything else will use defaults
    };

    console.log('Sending order data:');
    console.log(JSON.stringify(orderData, null, 2));

    const response = await axios.post(`${process.env.API_BASE_URL}/api/bot/create-order`, orderData, {
      headers: {
        'x-api-key': process.env.BOT_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Order created successfully!');
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;

  } catch (error) {
    console.log('❌ Order creation failed');
    console.log('Status:', error.response?.status);
    console.log('Data:', JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
}

// Run tests
async function runContactTests() {
  try {
    // Test 1: Check if contact exists
    console.log('Test 1: Contact Lookup');
    const lookupResult = await testContactLookup();
    
    if (lookupResult.success) {
      console.log('\n✅ Contact exists! Proceeding to order test...');
      
      // Test 2: Create order if contact exists
      console.log('\nTest 2: Order Creation');
      await testMinimalOrderWithContactId();
      
    } else {
      console.log('\n❌ Contact not found. You need to:');
      console.log('1. Check if contact_id is correct');
      console.log('2. Verify the contact exists in your SendPulse CRM');
      console.log('3. Make sure the bot is properly creating contacts on first interaction');
    }
    
  } catch (error) {
    console.log('\n💥 Test failed');
    console.log('Error:', error.message);
  }
}

// Execute tests
runContactTests();