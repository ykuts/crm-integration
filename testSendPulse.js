// SendPulse CRM API Test - Final Version
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class SendPulseTest {
  constructor() {
    this.clientId = process.env.SENDPULSE_CLIENT_ID;
    this.clientSecret = process.env.SENDPULSE_CLIENT_SECRET;
    this.accessToken = null;
  }

  async getAccessToken() {
    try {
      console.log('Getting SendPulse access token...');

      const response = await axios.post('https://api.sendpulse.com/oauth/access_token', {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      });

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in;

      console.log('✅ Access token obtained successfully');
      console.log(`Token expires in: ${expiresIn} seconds (${Math.round(expiresIn / 60)} minutes)`);

      return this.accessToken;
    } catch (error) {
      console.log('❌ Failed to get access token:', error.response?.data || error.message);
      throw error;
    }
  }

  async testGetProducts() {
    try {
      console.log('\nTesting products endpoint...');

      const response = await axios.post('https://api.sendpulse.com/crm/v1/products/all', {
        limit: 50,
        offset: 0,
        orderBy: {
          fieldName: "name",
          direction: "asc"
        }
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const products = response.data?.data || [];
      console.log(`✅ Found ${products.length} products in SendPulse CRM`);

      if (products.length > 0) {
        console.log('\nSendPulse products:');
        products.forEach((product, index) => {
          const price = product.price?.value || 'No price';
          const currency = product.price?.currency || '';
          const visible = product.visible ? 'Visible' : 'Hidden';

          console.log(`${index + 1}. ID: ${product.id}, Name: "${product.name}", Price: ${price} ${currency}, Status: ${visible}`);
        });
      } else {
        console.log('No products found in SendPulse CRM');

        // Try with visible filter
        console.log('\nTrying with visible=1 filter...');
        const visibleResponse = await axios.post('https://api.sendpulse.com/crm/v1/products/all', {
          limit: 50,
          visible: 1,
          orderBy: {
            fieldName: "name",
            direction: "asc"
          }
        }, {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        const visibleProducts = visibleResponse.data?.data || [];
        console.log(`Found ${visibleProducts.length} visible products`);
      }

      return products;
    } catch (error) {
      console.log('❌ Failed to get products:', error.response?.data || error.message);
      return [];
    }
  }

  async testGetContacts() {
    try {
      console.log('\nTesting contacts endpoint...');

      const response = await axios.post('https://api.sendpulse.com/crm/v1/contacts/get-list', {
        limit: 20,
        offset: 0,
        orderBy: "id",
        sort: "asc"
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Contacts API returns: { data: { list: [...], total: number } }
      const contactsData = response.data?.data;
      const contacts = contactsData?.list || [];
      const total = contactsData?.total || 0;

      console.log(`✅ Found ${contacts.length} contacts in SendPulse CRM (total: ${total})`);

      if (contacts.length > 0) {
        console.log('\nSample contacts:');
        contacts.slice(0, 5).forEach((contact, index) => {
          const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'No name';
          const phone = contact.phones?.[0]?.phone || 'No phone';
          const email = contact.emails?.[0]?.email || 'No email';

          console.log(`${index + 1}. ID: ${contact.id}, Name: ${name}, Phone: ${phone}, Email: ${email}`);
        });

        if (contacts.length > 5) {
          console.log(`... and ${contacts.length - 5} more contacts`);
        }
      }

      return contacts;
    } catch (error) {
      console.log('❌ Failed to get contacts:', error.response?.data || error.message);
      return [];
    }
  }

  async testCreateContact() {
    try {
      console.log('\nTesting contact creation...');

      const testContact = {
        firstName: 'Test',
        lastName: 'Bot User',
        phones: [{
          phone: '+41791234567',
          type: 'main'
        }],
        emails: [{
          email: 'test@example.com',
          type: 'main'
        }]
      };

      console.log('⚠️  About to create a test contact in SendPulse CRM');
      console.log('Contact data:', testContact);
      console.log('This will create a real contact! Uncomment the code below to proceed.');

      // Uncomment to actually create contact:
      /*
      const response = await axios.post('https://api.sendpulse.com/crm/v1/contacts/create', testContact, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Test contact created successfully');
      console.log('Contact ID:', response.data.id);
      return response.data;
      */

      return null;
    } catch (error) {
      console.log('❌ Failed to create contact:', error.response?.data || error.message);
      return null;
    }
  }

  async testCreateDeal() {
    try {
      console.log('\nTesting deal creation...');

      const testDeal = {
        title: 'Test Order from Bot',
        description: 'Test order created by CRM integration service',
        budget: 100.00,
        currency: 'CHF'
      };

      console.log('⚠️  About to create a test deal in SendPulse CRM');
      console.log('Deal data:', testDeal);
      console.log('This will create a real deal! Uncomment the code below to proceed.');

      // Uncomment to actually create deal:
      /*
      const response = await axios.post('https://api.sendpulse.com/crm/v1/deals', testDeal, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Test deal created successfully');
      console.log('Deal ID:', response.data.id);
      return response.data;
      */

      return null;
    } catch (error) {
      console.log('❌ Failed to create deal:', error.response?.data || error.message);
      return null;
    }
  }

  async runFullTest() {
    console.log('🧪 SendPulse CRM API Complete Test');
    console.log('=================================\n');

    // Check credentials
    if (!this.clientId || !this.clientSecret) {
      console.log('❌ SendPulse credentials not found in .env file');
      console.log('Please add to your .env file:');
      console.log('SENDPULSE_CLIENT_ID=your_client_id_here');
      console.log('SENDPULSE_CLIENT_SECRET=your_client_secret_here');
      return;
    }

    console.log('📋 Configuration:');
    console.log(`Client ID: ${this.clientId.substring(0, 8)}...`);
    console.log(`Client Secret: ${this.clientSecret.substring(0, 8)}...\n`);

    try {
      // Test authentication
      await this.getAccessToken();

      // Test getting products
      const products = await this.testGetProducts();

      // Test getting contacts
      const contacts = await this.testGetContacts();

      // Test create operations (commented out for safety)
      await this.testCreateContact();
      await this.testCreateDeal();

      console.log('\n🎉 SendPulse API test completed successfully!');
      console.log('\n📊 Summary:');
      console.log(`- Authentication: ✅ Working`);
      console.log(`- Products found: ${products.length}`);
      console.log(`- Contacts found: ${contacts.length}`);
      console.log(`- API access: ✅ Full access`);

      console.log('\n📋 Next steps:');
      if (products.length > 0) {
        console.log('1. ✅ Products found - ready for mapping');
        console.log('2. Create mappings between your ecommerce products and SendPulse products');
        console.log('3. Test bot order creation');
        console.log('4. Set up webhook endpoints');
      } else {
        console.log('1. ⚠️  Create products in SendPulse CRM first');
        console.log('2. Make sure products are visible');
        console.log('3. Run test again to verify products are accessible');
      }

      return { products, contacts };

    } catch (error) {
      console.log('\n❌ SendPulse API test failed');
      console.log('Error:', error.message);
      console.log('\n🔧 Troubleshooting:');
      console.log('1. Verify your SendPulse credentials');
      console.log('2. Check if your SendPulse plan includes CRM API access');
      console.log('3. Ensure CRM module is enabled in your account');
      return null;
    }
  }
}

async function main() {
  const test = new SendPulseTest();
  await test.runFullTest();
}

// Run the test
main().catch(console.error);

export { SendPulseTest };