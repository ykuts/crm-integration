// crm-integration-service/scripts/checkPipelineSteps.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script to check SendPulse CRM pipeline structure
 * This will help us map order statuses correctly
 */

async function getAccessToken() {
  try {
    const response = await axios.post('https://api.sendpulse.com/oauth/access_token', {
      grant_type: 'client_credentials',
      client_id: process.env.SENDPULSE_CLIENT_ID,
      client_secret: process.env.SENDPULSE_CLIENT_SECRET
    });
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Failed to get access token:', error.message);
    throw error;
  }
}

async function getPipelines(token) {
  try {
    const response = await axios.get('https://api.sendpulse.com/crm/v1/pipelines', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('❌ Failed to get pipelines:', error.message);
    throw error;
  }
}

async function getPipelineSteps(token, pipelineId) {
  try {
    const response = await axios.get(`https://api.sendpulse.com/crm/v1/pipelines/${pipelineId}/steps`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('❌ Failed to get pipeline steps:', error.message);
    return [];
  }
}

async function checkPipelineStructure() {
  console.log('🔍 Checking SendPulse CRM Pipeline Structure\n');
  console.log('='.repeat(60));
  
  try {
    // Get access token
    console.log('\n📡 Getting access token...');
    const token = await getAccessToken();
    console.log('✅ Access token obtained\n');

    // Get all pipelines
    console.log('📋 Getting pipelines...');
    const pipelines = await getPipelines(token);
    
    if (!pipelines || pipelines.length === 0) {
      console.log('⚠️  No pipelines found!');
      return;
    }

    console.log(`✅ Found ${pipelines.length} pipeline(s)\n`);

    // Display each pipeline and its steps
    for (const pipeline of pipelines) {
      console.log('='.repeat(60));
      console.log(`\n📦 Pipeline: "${pipeline.name}"`);
      console.log(`   ID: ${pipeline.id}`);
      console.log(`   Description: ${pipeline.description || 'No description'}`);
      
      // Get steps for this pipeline
      console.log('\n   📊 Steps (statuses):');
      const steps = await getPipelineSteps(token, pipeline.id);
      
      if (steps && steps.length > 0) {
        steps.forEach((step, index) => {
          console.log(`      ${index + 1}. "${step.name}"`);
          console.log(`         - ID: ${step.id}`);
          console.log(`         - Order: ${step.order}`);
          console.log(`         - Color: ${step.color || 'default'}`);
        });
      } else {
        console.log('      ⚠️  No steps found for this pipeline');
      }
      
      console.log('');
    }

    console.log('='.repeat(60));
    console.log('\n✅ Pipeline check completed!\n');

    // Generate mapping template
    console.log('📝 Suggested Status Mapping:\n');
    console.log('// Add this to your code:');
    console.log('const STATUS_MAPPING = {');
    console.log('  // Admin status -> CRM step ID');
    
    if (pipelines.length > 0 && pipelines[0]) {
      const mainPipeline = pipelines[0];
      const steps = await getPipelineSteps(token, mainPipeline.id);
      
      console.log(`  PENDING: '${steps[0]?.id || 'STEP_ID_HERE'}',  // "${steps[0]?.name || 'First step'}"`);
      console.log(`  CONFIRMED: '${steps[1]?.id || 'STEP_ID_HERE'}',  // "${steps[1]?.name || 'Second step'}"`);
      console.log(`  REQUIRES_AGREEMENT: '${steps[2]?.id || 'STEP_ID_HERE'}',  // "${steps[2]?.name || 'Third step'}"`);
      console.log(`  DELIVERED: '${steps[steps.length - 1]?.id || 'STEP_ID_HERE'}',  // "${steps[steps.length - 1]?.name || 'Final step'}"`);
      console.log(`  CANCELLED: null,  // Handle cancellation separately`);
    }
    
    console.log('};');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Script failed:', error.message);
    if (error.response) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run the script
checkPipelineStructure();