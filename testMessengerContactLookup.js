// Test Contact Lookup via Messenger External ID
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

async function testMessengerContactLookup() {
  console.log('🔍 Testing Messenger Contact Lookup');
  console.log('===================================\n');

  try {
    // Get access token
    console.log('Getting access token...');
    const token = await getAccessToken();
    console.log('✅ Access token obtained');

    // Test with your external contact ID from telegram
    const externalContactId = '68aa34e085b07ce3d604bd4d';
    
    console.log(`\n👤 Looking up messenger contact: ${externalContactId}`);

    // Try the messenger-external endpoint
    const response = await axios.get(`https://api.sendpulse.com/crm/v1/contacts/messenger-external/${externalContactId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const contactData = response.data?.data?.data || response.data?.data;
    
    if (contactData) {
      console.log('✅ Contact found via messenger external ID!');
      console.log('Contact details:');
      console.log(`- SendPulse ID: ${contactData.id}`);
      console.log(`- Name: ${contactData.firstName || ''} ${contactData.lastName || ''}`.trim());
      console.log(`- Phone: ${contactData.phones?.[0]?.phone || 'Not provided'}`);
      console.log(`- Email: ${contactData.emails?.[0]?.email || 'Not provided'}`);
      console.log(`- External ID: ${contactData.externalContactId || 'Not provided'}`);
      console.log(`- Source: ${contactData.sourceType || 'Unknown'}`);
      console.log(`- Created: ${contactData.createdAt}`);
      
      // Check messengers array
      if (contactData.messengers && contactData.messengers.length > 0) {
        console.log('\n📱 Messenger connections:');
        contactData.messengers.forEach((messenger, index) => {
          console.log(`  ${index + 1}. Type ID: ${messenger.typeId}, Login: ${messenger.login}, Contact ID: ${messenger.contactId}`);
        });
      }
      
      return {
        success: true,
        contact: contactData,
        sendpulseId: contactData.id // Real SendPulse ID we need!
      };
    } else {
      console.log('❌ Contact not found via messenger external ID');
      return {
        success: false,
        error: 'Contact not found'
      };
    }

  } catch (error) {
    console.log('❌ Error looking up messenger contact:');
    console.log('Status:', error.response?.status);
    console.log('Error:', JSON.stringify(error.response?.data, null, 2));
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Test searching by telegram ID in contact list
 */
async function testSearchByTelegramId() {
  console.log('\n🔍 Testing Search by Telegram ID');
  console.log('================================\n');

  try {
    const token = await getAccessToken();
    const telegramId = '5955533219';
    
    console.log(`Searching for telegram ID: ${telegramId}`);

    // Search in contact attributes for telegram_id
    const response = await axios.post('https://api.sendpulse.com/crm/v1/contacts/get-list', {
      limit: 50,
      offset: 0,
      // Try searching by firstName (might have telegram data)
      firstName: 'Yulia'
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const contactsData = response.data?.data;
    const contacts = contactsData?.list || [];
    
    console.log(`Found ${contacts.length} contacts with firstName 'Yulia'`);

    if (contacts.length > 0) {
      console.log('\n📋 Matching contacts:');
      contacts.forEach((contact, index) => {
        const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
        const phone = contact.phones?.[0]?.phone || 'No phone';
        const email = contact.emails?.[0]?.email || 'No email';
        const externalId = contact.externalContactId || 'No external ID';
        
        console.log(`${index + 1}. ID: ${contact.id}, Name: ${name}, Phone: ${phone}, Email: ${email}, External: ${externalId}`);
        
        // Check if this contact has telegram messenger
        if (contact.messengers && contact.messengers.length > 0) {
          console.log(`   Messengers: ${contact.messengers.map(m => `Type:${m.typeId} Login:${m.login} ContactID:${m.contactId}`).join(', ')}`);
        }
      });

      // Check if any contact has our external ID or telegram data
      const matchingContact = contacts.find(contact => 
        contact.externalContactId === '68aa34e085b07ce3d604bd4d' ||
        contact.messengers?.some(m => m.contactId === '68aa34e085b07ce3d604bd4d') ||
        contact.messengers?.some(m => m.login === telegramId)
      );

      if (matchingContact) {
        console.log(`\n🎯 Found matching contact! SendPulse ID: ${matchingContact.id}`);
        return {
          success: true,
          contact: matchingContact,
          sendpulseId: matchingContact.id
        };
      }
    }

    return {
      success: false,
      contacts: contacts,
      message: 'No exact match found'
    };

  } catch (error) {
    console.log('❌ Search failed:');
    console.log('Status:', error.response?.status);
    console.log('Error:', JSON.stringify(error.response?.data, null, 2));
    
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

// Run both tests
async function runContactDiscoveryTests() {
  try {
    console.log('🚀 Running Contact Discovery Tests');
    console.log('==================================');
    
    // Test 1: Try messenger external ID endpoint
    const messengerResult = await testMessengerContactLookup();
    
    if (messengerResult.success) {
      console.log('\n🎉 SUCCESS: Found contact via messenger external ID!');
      console.log(`Use SendPulse ID: ${messengerResult.sendpulseId} for orders`);
      return messengerResult;
    }
    
    console.log('\n⚠️ Messenger external lookup failed, trying search...');
    
    // Test 2: Search by telegram data
    const searchResult = await testSearchByTelegramId();
    
    if (searchResult.success) {
      console.log('\n🎉 SUCCESS: Found contact via search!');
      console.log(`Use SendPulse ID: ${searchResult.sendpulseId} for orders`);
      return searchResult;
    }
    
    console.log('\n❌ No contact found with current approaches');
    console.log('Suggestions:');
    console.log('1. Check how your telegram bot creates contacts');
    console.log('2. Verify the contact_id format');
    console.log('3. Check if contact was created in different pipeline/source');
    
    return searchResult;
    
  } catch (error) {
    console.log('\n💥 Discovery tests failed');
    console.log('Error:', error.message);
  }
}

// Execute discovery tests
runContactDiscoveryTests();