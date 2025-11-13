/**
 * Quick StateGraph Performance Test
 * 
 * Minimal test for rapid performance analysis of a single query.
 * 
 * Usage:
 *   node tests/quick-performance-test.cjs "your question here"
 *   
 * Examples:
 *   node tests/quick-performance-test.cjs "What is the capital of France?"
 *   node tests/quick-performance-test.cjs "Remember I have a meeting tomorrow"
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const AgentOrchestrator = require('../src/main/services/mcp/AgentOrchestrator.cjs');
const { initializeMCP } = require('../src/main/services/mcp/initialize.cjs');

// Get message from command line args
const message = process.argv[2] || 'What is the capital of France?';

function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printNodeTiming(trace) {
  console.log('\n📊 Node Timings:');
  console.log('─'.repeat(70));
  
  if (!trace || trace.length === 0) {
    console.log('No trace data available');
    console.log('─'.repeat(70));
    return;
  }
  
  const totalMs = trace.reduce((sum, t) => sum + (t.duration || 0), 0);
  
  trace.forEach((entry, idx) => {
    const duration = entry.duration || 0;
    const percentage = totalMs > 0 ? ((duration / totalMs) * 100).toFixed(1) : '0.0';
    const bar = '█'.repeat(Math.min(Math.floor(duration / 50), 40));
    const status = entry.error ? '❌' : '✅';
    const cache = entry.fromCache ? ' 💾' : '';
    
    console.log(
      `${status} ${entry.node.padEnd(25)} ${formatMs(duration).padEnd(8)} ${percentage.padStart(5)}% ${bar}${cache}`
    );
  });
  
  console.log('─'.repeat(70));
  console.log(`TOTAL: ${formatMs(totalMs)}`);
  
  // Find slowest node
  if (trace.length > 0) {
    const slowest = trace.reduce((max, t) => (t.duration || 0) > (max.duration || 0) ? t : max, trace[0]);
    console.log(`\n🐌 Slowest: ${slowest.node} (${formatMs(slowest.duration || 0)})`);
  }
}

async function main() {
  console.log('🚀 Quick Performance Test');
  console.log(`📝 Message: "${message}"\n`);

  // Initialize database (required for MCPConfigManager)
  console.log('⚙️  Initializing database...');
  const dataDir = path.join(os.homedir(), '.thinkdrop');
  const dbPath = path.join(dataDir, 'thinkdrop.duckdb');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Suppress database logs during tests
  process.env.DB_QUIET_MODE = 'true';
  
  // Import and initialize DatabaseManager (ES module)
  const { default: databaseManager } = await import('../src/main/services/utils/DatabaseManager.js');
  await databaseManager.initialize(dbPath);
  console.log('✅ Database initialized');

  // Initialize MCP system (creates MCPConfigManager and runs migrations)
  console.log('⚙️  Initializing MCP system...');
  await initializeMCP(databaseManager);
  console.log('✅ MCP system initialized');

  // Create orchestrator (MCPConfigManager is now initialized)
  console.log('⚙️  Creating AgentOrchestrator...');
  const orchestrator = new AgentOrchestrator();
  console.log('✅ AgentOrchestrator ready\n');

  const startTime = Date.now();
  
  try {
    const result = await orchestrator.processMessageWithGraph(
      message,
      { sessionId: 'quick_test', userId: 'test_user' },
      null,
      null
    );

    const totalMs = Date.now() - startTime;

    console.log(`✅ Success in ${formatMs(totalMs)}`);
    console.log(`🎯 Intent: ${result.action}`);
    console.log(`💬 Response: ${result.response?.substring(0, 150)}...`);

    if (result.trace && result.trace.length > 0) {
      printNodeTiming(result.trace);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  process.exit(0);
}

main();
