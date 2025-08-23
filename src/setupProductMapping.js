// Setup Product Mapping - Map your 15 products to SendPulse
import { DatabaseService } from './services/databaseService.js';
import { SendPulseCRMService } from './services/sendPulseCrmService.js';
import dotenv from 'dotenv';

dotenv.config();

class ProductMappingSetup {
  constructor() {
    this.dbService = new DatabaseService();
    this.sendPulseService = new SendPulseCRMService();
  }

  async run() {
    console.log('🔗 Setting up Product Mapping');
    console.log('============================\n');

    try {
      // Step 1: Get your ecommerce products
      console.log('📦 Step 1: Getting products from your ecommerce database...');
      const ecommerceProducts = await this.dbService.getAllEcommerceProducts();
      console.log(`✅ Found ${ecommerceProducts.length} products in your ecommerce database\n`);

      if (ecommerceProducts.length === 0) {
        console.log('❌ No products found in ecommerce database');
        return;
      }

      // Show your products
      console.log('Your ecommerce products:');
      ecommerceProducts.forEach((product, index) => {
        console.log(`${index + 1}. ID: ${product.id}, Name: ${product.name || 'No name'}, Price: ${product.price} CHF`);
      });

      // Step 2: Get SendPulse products
      console.log('\n📦 Step 2: Getting products from SendPulse CRM...');
      const sendPulseProducts = await this.sendPulseService.getAllProducts({ limit: 100 });
      console.log(`✅ Found ${sendPulseProducts.length} products in SendPulse CRM\n`);

      if (sendPulseProducts.length === 0) {
        console.log('❌ No products found in SendPulse CRM');
        console.log('💡 You need to create products in SendPulse first');
        return;
      }

      // Show SendPulse products
      console.log('SendPulse CRM products:');
      sendPulseProducts.slice(0, 10).forEach((product, index) => {
        console.log(`${index + 1}. ID: ${product.id}, Name: ${product.name || 'No name'}, Price: ${product.price || 'No price'}`);
      });

      if (sendPulseProducts.length > 10) {
        console.log(`... and ${sendPulseProducts.length - 10} more`);
      }

      // Step 3: Check existing mappings
      console.log('\n🔍 Step 3: Checking existing mappings...');
      const existingMappings = await this.dbService.getAllProductMappings();
      console.log(`Found ${existingMappings.length} existing mappings\n`);

      if (existingMappings.length > 0) {
        console.log('Existing mappings:');
        existingMappings.forEach(mapping => {
          const ecomProduct = ecommerceProducts.find(p => p.id === mapping.ecommerceId);
          const spProduct = sendPulseProducts.find(p => p.id === mapping.sendpulseId);
          
          console.log(`  ${mapping.ecommerceId} (${ecomProduct?.name || 'Unknown'}) → ${mapping.sendpulseId} (${spProduct?.name || 'Unknown'})`);
        });
      }

      // Step 4: Interactive mapping setup
      console.log('\n🎯 Step 4: Setting up mappings...');
      await this.setupMappings(ecommerceProducts, sendPulseProducts, existingMappings);

    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      throw error;
    } finally {
      await this.dbService.disconnect();
    }
  }

  async setupMappings(ecommerceProducts, sendPulseProducts, existingMappings) {
    console.log('\n📝 Manual Mapping Setup');
    console.log('=====================');
    console.log('For each of your ecommerce products, we need to map it to a SendPulse product.\n');

    const existingMap = new Map(existingMappings.map(m => [m.ecommerceId, m.sendpulseId]));

    for (const ecomProduct of ecommerceProducts) {
      if (existingMap.has(ecomProduct.id)) {
        console.log(`✅ Product ${ecomProduct.id} (${ecomProduct.name}) already mapped to SendPulse ID ${existingMap.get(ecomProduct.id)}`);
        continue;
      }

      console.log(`\n🔗 Mapping product: ${ecomProduct.id} - "${ecomProduct.name}" (${ecomProduct.price} CHF)`);
      console.log('Available SendPulse products:');
      
      sendPulseProducts.forEach((spProduct, index) => {
        console.log(`  ${index + 1}. ID: ${spProduct.id} - "${spProduct.name || 'No name'}" (${spProduct.price || 'No price'})`);
      });

      // For now, we'll create a manual mapping helper
      // In a real setup, you'd either:
      // 1. Use interactive prompts (requires 'inquirer' package)
      // 2. Match by name similarity
      // 3. Create a mapping file

      console.log('\n💡 To create mapping, you have several options:');
      console.log('1. Auto-match by name similarity');
      console.log('2. Manual mapping via configuration');
      console.log('3. Interactive CLI (requires additional setup)');

      // Try auto-matching by name
      const autoMatch = this.findBestMatch(ecomProduct, sendPulseProducts);
      if (autoMatch) {
        console.log(`\n🤖 Auto-match suggestion: ${ecomProduct.name} → ${autoMatch.name} (SendPulse ID: ${autoMatch.id})`);
        console.log('   Similarity score:', autoMatch.score.toFixed(2));
        
        if (autoMatch.score > 0.7) {
          console.log('   ✅ High confidence - would auto-map');
          // Uncomment to actually create the mapping:
          // await this.createMapping(ecomProduct.id, autoMatch.id, ecomProduct.name);
        } else {
          console.log('   ⚠️  Low confidence - manual review needed');
        }
      } else {
        console.log('\n🤔 No good auto-match found');
      }
    }

    console.log('\n📋 Next Steps:');
    console.log('1. Review the auto-match suggestions above');
    console.log('2. Create mappings manually using the createMapping method');
    console.log('3. Or implement interactive mapping with inquirer package');
    console.log('\nExample manual mapping:');
    console.log('await this.createMapping(ecommerceId, sendpulseId, productName);');
  }

  // Simple name similarity matching
  findBestMatch(ecomProduct, sendPulseProducts) {
    let bestMatch = null;
    let bestScore = 0;

    const ecomName = (ecomProduct.name || '').toLowerCase();

    for (const spProduct of sendPulseProducts) {
      const spName = (spProduct.name || '').toLowerCase();
      
      if (!ecomName || !spName) continue;

      // Simple similarity score
      const score = this.calculateSimilarity(ecomName, spName);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ...spProduct, score };
      }
    }

    return bestMatch && bestScore > 0.3 ? bestMatch : null;
  }

  // Simple string similarity (Levenshtein-like)
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    // Check for exact match or substring
    if (str1 === str2) return 1.0;
    if (longer.includes(shorter)) return 0.8;
    
    // Simple word overlap
    const words1 = str1.split(' ');
    const words2 = str2.split(' ');
    const commonWords = words1.filter(word => words2.includes(word));
    
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  // Create a mapping
  async createMapping(ecommerceId, sendpulseId, name) {
    try {
      const mapping = await this.dbService.saveProductMapping(ecommerceId, sendpulseId, name);
      console.log(`✅ Created mapping: ${ecommerceId} → ${sendpulseId}`);
      return mapping;
    } catch (error) {
      console.log(`❌ Failed to create mapping: ${error.message}`);
      throw error;
    }
  }

  // Utility method to create mappings from a configuration object
  async createMappingsFromConfig(mappingConfig) {
    console.log('\n🔧 Creating mappings from configuration...');
    
    for (const [ecommerceId, sendpulseId] of Object.entries(mappingConfig)) {
      try {
        await this.createMapping(parseInt(ecommerceId), sendpulseId, `Product ${ecommerceId}`);
      } catch (error) {
        console.log(`Failed to create mapping for product ${ecommerceId}: ${error.message}`);
      }
    }
  }
}

// Example usage with manual configuration
async function createExampleMappings() {
  console.log('\n📝 Example: Creating mappings from configuration');
  console.log('==============================================');
  
  // Replace with your actual product IDs
  const mappingConfig = {
    // ecommerce_id: sendpulse_id
    1: 101,  // Your product ID 1 maps to SendPulse product ID 101
    2: 102,  // Your product ID 2 maps to SendPulse product ID 102
    3: 103,  // etc...
    // Add all 15 of your products here
  };

  const setup = new ProductMappingSetup();
  await setup.createMappingsFromConfig(mappingConfig);
}

// Run the setup
async function main() {
  try {
    const setup = new ProductMappingSetup();
    await setup.run();
    
    // Uncomment to create example mappings:
    // await createExampleMappings();
    
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  }
}

export { ProductMappingSetup };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}