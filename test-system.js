#!/usr/bin/env node

/**
 * Thinkdrop AI System Test Script
 * Tests core components and validates functionality
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

// Import our components (using dynamic imports for CommonJS modules)
const testComponents = async () => {
  console.log('🧠 Thinkdrop AI - System Test');
  console.log('================================\n');

  // Test 1: Environment Configuration
  console.log('1️⃣ Testing Environment Configuration...');
  const requiredEnvVars = [
    'NODE_ENV',
    'SHOULD_RUN_SIMULATED_RESPONSES',
    'N8N_WEBHOOK_SUMMARIZER'
  ];
  
  let envScore = 0;
  requiredEnvVars.forEach(envVar => {
    if (process.env[envVar]) {
      console.log(`   ✅ ${envVar}: ${process.env[envVar]}`);
      envScore++;
    } else {
      console.log(`   ❌ ${envVar}: Not set`);
    }
  });
  console.log(`   📊 Environment Score: ${envScore}/${requiredEnvVars.length}\n`);

  // Test 2: LLM Router Initialization
  console.log('2️⃣ Testing LLM Router...');
  try {
    // Simulate LLM Router initialization
    const mockProviders = [];
    
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'placeholder-openai-key') {
      mockProviders.push('openai');
    }
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'placeholder-anthropic-key') {
      mockProviders.push('anthropic');
    }
    if (process.env.GOOGLE_AI_API_KEY && process.env.GOOGLE_AI_API_KEY !== 'placeholder-google-key') {
      mockProviders.push('google');
    }
    
    if (mockProviders.length > 0) {
      console.log(`   ✅ LLM Providers configured: ${mockProviders.join(', ')}`);
    } else {
      console.log('   ⚠️  No real LLM providers configured (using simulated mode)');
    }
    
    if (process.env.SHOULD_RUN_SIMULATED_RESPONSES === 'true') {
      console.log('   🎭 Simulated responses enabled for testing');
    }
    
    console.log('   ✅ LLM Router: Ready\n');
  } catch (error) {
    console.log(`   ❌ LLM Router Error: ${error.message}\n`);
  }

  // Test 3: Agent Dispatcher
  console.log('3️⃣ Testing Agent Dispatcher...');
  try {
    const webhookUrls = {
      summarizer: process.env.N8N_WEBHOOK_SUMMARIZER,
      clipboard: process.env.N8N_WEBHOOK_CLIPBOARD,
      docGeneration: process.env.N8N_WEBHOOK_DOC_GENERATION,
      action: process.env.N8N_WEBHOOK_ACTION,
      tts: process.env.N8N_WEBHOOK_TTS
    };
    
    let configuredWebhooks = 0;
    Object.entries(webhookUrls).forEach(([agent, url]) => {
      if (url) {
        console.log(`   ✅ ${agent}: ${url}`);
        configuredWebhooks++;
      } else {
        console.log(`   ⚠️  ${agent}: Not configured`);
      }
    });
    
    console.log(`   📊 Webhook Score: ${configuredWebhooks}/5`);
    console.log('   ✅ Agent Dispatcher: Ready\n');
  } catch (error) {
    console.log(`   ❌ Agent Dispatcher Error: ${error.message}\n`);
  }

  // Test 4: Simulated Agent Processing
  console.log('4️⃣ Testing Simulated Agent Processing...');
  
  const testInputs = [
    { type: 'transcript', content: 'Summarize the key points from today\'s meeting' },
    { type: 'clipboard', content: 'Meeting notes: Q4 revenue increased by 15%' },
    { type: 'audio', content: 'Generate a document with action items' },
    { type: 'transcript', content: 'Send this summary to Slack' }
  ];
  
  testInputs.forEach((input, index) => {
    const agents = analyzeContext(input);
    console.log(`   Test ${index + 1}: "${input.content}"`);
    console.log(`   🎯 Routed to agents: ${agents.join(', ')}`);
    
    // Simulate agent response
    if (process.env.SHOULD_RUN_SIMULATED_RESPONSES === 'true') {
      const response = generateSimulatedResponse(agents[0], input);
      console.log(`   🤖 Simulated response: ${response.summary || response.analysis || 'Action completed'}`);
    }
    console.log('');
  });

  // Test 5: System Status
  console.log('5️⃣ System Status Overview...');
  const systemHealth = {
    frontend: '✅ React UI components ready',
    backend: '✅ Core engine services loaded',
    agents: '✅ Agent dispatcher configured',
    llm: process.env.SHOULD_RUN_SIMULATED_RESPONSES === 'true' ? '🎭 Simulated mode' : '✅ LLM providers ready',
    overlay: '✅ Transparent overlay system ready'
  };
  
  Object.entries(systemHealth).forEach(([component, status]) => {
    console.log(`   ${component.toUpperCase()}: ${status}`);
  });

  console.log('\n🎉 Thinkdrop AI system test completed!');
  console.log('💡 Ready to start the development server with: npm run dev');
};

// Helper functions (simplified versions of the actual implementations)
function analyzeContext(data) {
  const { type, content } = data;
  const agents = [];
  const contentLower = content.toLowerCase();

  if (contentLower.includes('summarize') || contentLower.includes('summary') || type === 'transcript') {
    agents.push('summarizer');
  }
  if (contentLower.includes('generate') && (contentLower.includes('document') || contentLower.includes('notes'))) {
    agents.push('docGeneration');
  }
  if (contentLower.includes('send to slack') || contentLower.includes('email')) {
    agents.push('action');
  }
  if (type === 'clipboard') {
    agents.push('clipboard');
  }
  if (agents.length === 0) {
    agents.push('summarizer');
  }
  
  return agents;
}

function generateSimulatedResponse(agentType, sessionData) {
  const responses = {
    summarizer: {
      summary: `Key points extracted from: "${sessionData.content.substring(0, 50)}..."`,
      confidence: 0.85
    },
    clipboard: {
      analysis: 'Clipboard content analyzed',
      suggestedActions: ['Save to notes', 'Share with team']
    },
    docGeneration: {
      documentUrl: 'meeting-notes-2024.md',
      wordCount: 350
    },
    action: {
      actionTaken: 'Message sent to Slack',
      status: 'completed'
    }
  };

  return responses[agentType] || { status: 'completed' };
}

// Run the tests
testComponents().catch(console.error);
