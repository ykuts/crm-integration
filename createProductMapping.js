// Create Product Mappings between Ecommerce and SendPulse
import { DatabaseService } from './src/services/databaseService.js';
import dotenv from 'dotenv';

dotenv.config();

async function createProductMappings() {
  console.log('🔗 Creating Product Mappings');
  console.log('============================\n');

  const dbService = new DatabaseService();

  try {
    // Маппинги основанные на анализе названий и цен
    const mappings = [
      {
        ecommerceId: 3,
        ecommerceName: "СИР КИСЛОМОЛОЧНИЙ (ТВОРОГ)",
        ecommercePrice: 10,
        sendpulseId: 6317,
        sendpulseName: "Сир кисломолочний 15,5% – 500 г – пластик",
        sendpulsePrice: 10,
        confidence: "high" // Точное совпадение названия и цены
      },
      {
        ecommerceId: 5,
        ecommerceName: "ПЕЛЬМЕНІ",
        ecommercePrice: 35,
        sendpulseId: 6319,
        sendpulseName: "Пельмені класичні (зі свининою та яловичиною) – 1000 г – зиплок",
        sendpulsePrice: 35,
        confidence: "high"
      },
      {
        ecommerceId: 7,
        ecommerceName: "ВАРЕНИКИ з вишнею",
        ecommercePrice: 35,
        sendpulseId: 6322,
        sendpulseName: "Вареники з вишнею – 1000 г – зиплок",
        sendpulsePrice: 35,
        confidence: "high"
      },
      {
        ecommerceId: 9,
        ecommerceName: "ГОЛУБЦІ",
        ecommercePrice: 35,
        sendpulseId: 6323,
        sendpulseName: "Голубці класичні (зі свининою та яловичиною) – 1000 г – зиплок",
        sendpulsePrice: 35,
        confidence: "high"
      },
      {
        ecommerceId: 11,
        ecommerceName: "СИРНА МАСА ванільна",
        ecommercePrice: 10,
        sendpulseId: 6321,
        sendpulseName: "Сиркова маса ванільна – 300 г – пластик",
        sendpulsePrice: 10,
        confidence: "high"
      },
      {
        ecommerceId: 12,
        ecommerceName: "СИРКИ у молочному шоколаді",
        ecommercePrice: 20,
        sendpulseId: 6320,
        sendpulseName: "Сирок ванільний – молочний шоколад – 4×90 г – пластик",
        sendpulsePrice: 20,
        confidence: "medium" // Похожие, но не точные названия
      },
      {
        ecommerceId: 4,
        ecommerceName: "СИРКИ у чорному шоколаді",
        ecommercePrice: 20,
        sendpulseId: 6316,
        sendpulseName: "Сир кисломолочний 15,5% – 1 кг – пластик",
        sendpulsePrice: 20,
        confidence: "low" // Цена совпадает, но названия разные - требует проверки
      }
    ];

    console.log('Предлагаемые маппинги:');
    console.log('=====================\n');

    mappings.forEach((mapping, index) => {
      const confidenceEmoji = mapping.confidence === 'high' ? '🟢' : 
                             mapping.confidence === 'medium' ? '🟡' : '🔴';
      
      console.log(`${index + 1}. ${confidenceEmoji} Confidence: ${mapping.confidence.toUpperCase()}`);
      console.log(`   Ecommerce: ID ${mapping.ecommerceId} - "${mapping.ecommerceName}" (${mapping.ecommercePrice} CHF)`);
      console.log(`   SendPulse: ID ${mapping.sendpulseId} - "${mapping.sendpulseName}" (${mapping.sendpulsePrice} CHF)`);
      console.log('');
    });

    console.log('Товары без маппинга:');
    console.log('===================');
    console.log('Ecommerce товары без соответствий:');
    console.log('- ID 6: "СИРНИКИ" (20 CHF)');
    console.log('- ID 15: "ВАРЕНИКИ з сиром (солодкі)" (35 CHF)');
    console.log('- ID 22: "ВАРЕНИКИ з капустою" (35 CHF)');
    console.log('');

    // Создание маппингов
    console.log('Создание маппингов в базе данных...');
    console.log('=================================\n');

    let successCount = 0;
    let skipCount = 0;

    for (const mapping of mappings) {
      try {
        // Проверяем, существует ли уже маппинг
        const existingMapping = await dbService.getProductMapping(mapping.ecommerceId);
        
        if (existingMapping) {
          console.log(`⚠️  Маппинг для товара ${mapping.ecommerceId} уже существует (SendPulse ID: ${existingMapping.sendpulseId})`);
          skipCount++;
          continue;
        }

        // Создаем новый маппинг
        const result = await dbService.saveProductMapping(
          mapping.ecommerceId,
          mapping.sendpulseId,
          mapping.ecommerceName
        );

        console.log(`✅ Создан маппинг: ${mapping.ecommerceId} → ${mapping.sendpulseId} (${mapping.confidence} confidence)`);
        successCount++;

      } catch (error) {
        console.log(`❌ Ошибка при создании маппинга для товара ${mapping.ecommerceId}: ${error.message}`);
      }
    }

    console.log(`\n📊 Результат:`);
    console.log(`✅ Создано: ${successCount} маппингов`);
    console.log(`⚠️  Пропущено: ${skipCount} (уже существуют)`);
    console.log(`❌ Ошибок: ${mappings.length - successCount - skipCount}`);

    // Показываем все маппинги
    console.log('\n🔍 Все маппинги в базе данных:');
    const allMappings = await dbService.getAllProductMappings();
    
    allMappings.forEach(mapping => {
      const originalMapping = mappings.find(m => m.ecommerceId === mapping.ecommerceId);
      const confidence = originalMapping ? originalMapping.confidence : 'unknown';
      const confidenceEmoji = confidence === 'high' ? '🟢' : 
                             confidence === 'medium' ? '🟡' : 
                             confidence === 'low' ? '🔴' : '⚪';
      
      console.log(`${confidenceEmoji} Ecommerce ID ${mapping.ecommerceId} → SendPulse ID ${mapping.sendpulseId}`);
      console.log(`   Name: "${mapping.name || 'Unknown'}"`);
      console.log(`   Status: ${mapping.syncStatus}, Last sync: ${mapping.lastSyncAt?.toISOString() || 'Never'}`);
    });

  } catch (error) {
    console.error('❌ Ошибка при создании маппингов:', error.message);
  } finally {
    await dbService.disconnect();
  }
}

// Функция для создания одного маппинга вручную
async function createSingleMapping(ecommerceId, sendpulseId, name) {
  console.log(`🔗 Создание маппинга: ${ecommerceId} → ${sendpulseId}`);
  
  const dbService = new DatabaseService();
  
  try {
    const result = await dbService.saveProductMapping(ecommerceId, sendpulseId, name);
    console.log('✅ Маппинг создан успешно:', result);
    return result;
  } catch (error) {
    console.error('❌ Ошибка при создании маппинга:', error.message);
    throw error;
  } finally {
    await dbService.disconnect();
  }
}

// Функция для удаления маппинга
async function deleteMappingIfNeeded(ecommerceId) {
  console.log(`🗑️  Удаление маппинга для товара ${ecommerceId}`);
  
  const dbService = new DatabaseService();
  
  try {
    // Поскольку у нас нет метода удаления, просто показываем существующий
    const mapping = await dbService.getProductMapping(ecommerceId);
    if (mapping) {
      console.log('Существующий маппинг:', mapping);
      console.log('Для удаления выполните SQL: DELETE FROM product_mappings WHERE ecommerce_id = ' + ecommerceId);
    } else {
      console.log('Маппинг не найден');
    }
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  } finally {
    await dbService.disconnect();
  }
}

// Проверка маппингов
async function verifyMappings() {
  console.log('🔍 Проверка маппингов');
  console.log('====================\n');

  const dbService = new DatabaseService();
  
  try {
    const productsWithMappings = await dbService.getProductsWithMappings();
    
    console.log('Товары с маппингами:');
    productsWithMappings
      .filter(p => p.isSyncedToSendPulse)
      .forEach(product => {
        console.log(`✅ ID ${product.id}: "${product.name}" → SendPulse ID ${product.sendpulseId}`);
      });

    console.log('\nТовары без маппингов:');
    productsWithMappings
      .filter(p => !p.isSyncedToSendPulse)
      .forEach(product => {
        console.log(`❌ ID ${product.id}: "${product.name}" (${product.price} CHF) - НЕ ЗАМАПЛЕН`);
      });

  } catch (error) {
    console.error('❌ Ошибка при проверке:', error.message);
  } finally {
    await dbService.disconnect();
  }
}

// Команды
const command = process.argv[2];

switch (command) {
  case '--create':
    createProductMappings().catch(console.error);
    break;
  case '--verify':
    verifyMappings().catch(console.error);
    break;
  case '--delete':
    const ecommerceId = parseInt(process.argv[3]);
    if (ecommerceId) {
      deleteMappingIfNeeded(ecommerceId).catch(console.error);
    } else {
      console.log('Usage: node createProductMapping.js --delete <ecommerce_id>');
    }
    break;
  case '--single':
    const eId = parseInt(process.argv[3]);
    const sId = parseInt(process.argv[4]);
    const name = process.argv[5];
    if (eId && sId) {
      createSingleMapping(eId, sId, name).catch(console.error);
    } else {
      console.log('Usage: node createProductMapping.js --single <ecommerce_id> <sendpulse_id> <name>');
    }
    break;
  default:
    console.log('Product Mapping Commands:');
    console.log('========================');
    console.log('node createProductMapping.js --create   # Создать все предлагаемые маппинги');
    console.log('node createProductMapping.js --verify   # Проверить существующие маппинги');
    console.log('node createProductMapping.js --single 3 6317 "Product Name"  # Создать один маппинг');
    console.log('node createProductMapping.js --delete 3  # Показать как удалить маппинг');
}

export { createProductMappings, createSingleMapping, verifyMappings };