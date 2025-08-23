// Simple Test Setup - Check connections and show products
// File: testSetup.js (in root folder)

import { DatabaseService } from './src/services/databaseService.js';
import dotenv from 'dotenv';

dotenv.config();

async function testSetup() {
  console.log('🧪 Testing CRM Integration Setup');
  console.log('===============================\n');

  const dbService = new DatabaseService();

  try {
    // Test 1: Database health check
    console.log('1️⃣  Testing database connections...');
    const health = await dbService.healthCheck();
    
    console.log(`CRM Database: ${health.crm.status}`);
    console.log(`Ecommerce Database: ${health.ecommerce.status}\n`);

    if (health.crm.status !== 'connected') {
      console.log('❌ CRM database connection failed');
      console.log('Check your CRM_DATABASE_URL in .env file\n');
      return;
    }

    if (health.ecommerce.status !== 'connected') {
      console.log('❌ Ecommerce database connection failed');
      console.log('Check your ECOMMERCE_DATABASE_URL in .env file\n');
      return;
    }

    // Test 1.5: Check ecommerce database structure
    console.log('1️⃣.5 Checking ecommerce database structure...');
    try {
      const schema = await dbService.testEcommerceSchema();
      console.log(`✅ Found ${schema.tables.length} tables in ecommerce database`);
      console.log(`✅ Product table has ${schema.productColumns.length} columns\n`);
      
      if (schema.productColumns.length === 0) {
        console.log('❌ Product table not found or has no columns');
        console.log('Available tables:');
        schema.tables.forEach(table => {
          console.log(`  - ${table.table_name}`);
        });
        console.log('');
        return;
      }
    } catch (error) {
      console.log('❌ Failed to check ecommerce database structure:', error.message);
      return;
    }

    // Test 2: Get products from ecommerce
    console.log('2️⃣  Getting products from ecommerce database...');
    const ecommerceProducts = await dbService.getAllEcommerceProducts();
    console.log(`✅ Found ${ecommerceProducts.length} products\n`);

    if (ecommerceProducts.length > 0) {
      console.log('Your products:');
      ecommerceProducts.forEach((product, index) => {
        console.log(`${index + 1}. ID: ${product.id}, Name: "${product.name}", Price: ${product.price} CHF, Stock: ${product.stock}, Active: ${product.isActive}`);
        if (product.description) {
          console.log(`    Description: ${product.description.substring(0, 100)}${product.description.length > 100 ? '...' : ''}`);
        }
      });
      console.log('');
    } else {
      console.log('No active products found in ecommerce database');
      console.log('Make sure you have active products in your Product table\n');
    }

    // Test 3: Check existing mappings
    console.log('3️⃣  Checking existing product mappings...');
    const mappings = await dbService.getAllProductMappings();
    console.log(`✅ Found ${mappings.length} existing mappings\n`);

    if (mappings.length > 0) {
      console.log('Existing mappings:');
      mappings.forEach(mapping => {
        const product = ecommerceProducts.find(p => p.id === mapping.ecommerceId);
        console.log(`  Ecommerce ID ${mapping.ecommerceId} (${product?.name || 'Unknown'}) → SendPulse ID ${mapping.sendpulseId}`);
      });
      console.log('');
    }

    // Test 4: Show products that need mapping
    console.log('4️⃣  Products that need mapping...');
    const mappedIds = new Set(mappings.map(m => m.ecommerceId));
    const unmappedProducts = ecommerceProducts.filter(p => !mappedIds.has(p.id));
    
    if (unmappedProducts.length > 0) {
      console.log('Products without SendPulse mapping:');
      unmappedProducts.forEach(product => {
        console.log(`  ID: ${product.id}, Name: "${product.name}", Price: ${product.price} CHF`);
      });
      console.log('');
    } else {
      console.log('✅ All products are mapped to SendPulse!\n');
    }

    console.log('🎉 Setup test completed successfully!');
    console.log('\nNext steps:');
    if (unmappedProducts.length > 0) {
      console.log('1. Get your SendPulse API credentials');
      console.log('2. Test SendPulse connection');
      console.log('3. Create product mappings for unmapped products');
      console.log('\nTo create a test mapping, run:');
      console.log('node testSetup.js --test-mapping');
    } else {
      console.log('1. Test SendPulse connection');
      console.log('2. Test bot order creation');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\nFull error:');
    console.error(error);
  } finally {
    await dbService.disconnect();
  }
}

// Function to create a test mapping
async function createTestMapping() {
  console.log('🔗 Creating test mapping...');
  
  const dbService = new DatabaseService();
  
  try {
    // Get first unmapped product
    const ecommerceProducts = await dbService.getAllEcommerceProducts();
    const mappings = await dbService.getAllProductMappings();
    const mappedIds = new Set(mappings.map(m => m.ecommerceId));
    const unmappedProduct = ecommerceProducts.find(p => !mappedIds.has(p.id));
    
    if (!unmappedProduct) {
      console.log('✅ All products are already mapped!');
      return;
    }

    console.log(`Creating test mapping for product: ${unmappedProduct.id} - "${unmappedProduct.name}"`);
    
    // Create mapping with a test SendPulse ID (you should replace with real ID)
    const testSendPulseId = 100 + unmappedProduct.id; // Just for testing
    
    const mapping = await dbService.saveProductMapping(
      unmappedProduct.id, 
      testSendPulseId, 
      unmappedProduct.name
    );
    
    console.log('✅ Test mapping created:', {
      ecommerceId: mapping.ecommerceId,
      sendpulseId: mapping.sendpulseId,
      name: mapping.name
    });
    
    console.log('\n⚠️  Note: This used a test SendPulse ID. Replace with real SendPulse product ID!');
    
  } catch (error) {
    console.error('❌ Failed to create test mapping:', error.message);
  } finally {
    await dbService.disconnect();
  }
}

// Function to show database info
async function showDatabaseInfo() {
  console.log('📊 Database Information');
  console.log('=====================\n');
  
  const dbService = new DatabaseService();
  
  try {
    const schema = await dbService.testEcommerceSchema();
    
    console.log('📁 Ecommerce Database Tables:');
    schema.tables.forEach(table => {
      console.log(`  - ${table.table_name}`);
    });
    
    console.log('\n📦 Product Table Columns:');
    schema.productColumns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
  } catch (error) {
    console.error('❌ Failed to get database info:', error.message);
  } finally {
    await dbService.disconnect();
  }
}

// Run based on command line arguments
if (process.argv.includes('--test-mapping')) {
  createTestMapping().catch(console.error);
} else if (process.argv.includes('--db-info')) {
  showDatabaseInfo().catch(console.error);
} else {
  testSetup().catch(console.error);
}