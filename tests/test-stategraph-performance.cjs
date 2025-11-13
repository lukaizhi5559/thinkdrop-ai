/**
 * StateGraph Performance Test
 * 
 * Tests the AgentOrchestrator StateGraph to measure execution time of each node
 * from end to end. Provides detailed timing breakdown for performance analysis.
 * 
 * Usage:
 *   node tests/test-stategraph-performance.cjs
 * 
 * Environment Variables:
 *   DEBUG_STATEGRAPH=true - Enable detailed StateGraph logging
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const AgentOrchestrator = require('../src/main/services/mcp/AgentOrchestrator.cjs');
const { initializeMCP } = require('../src/main/services/mcp/initialize.cjs');

// Test scenarios with different intents
const TEST_SCENARIOS = [
  {
    name: 'Simple Question (General Query)',
    message: 'What is the capital of France?',
    context: { sessionId: 'test_session_1', userId: 'test_user' },
    expectedIntent: 'general_query'
  },
  {
    name: 'Memory Retrieval',
    message: 'What did I say about pizza last week?',
    context: { sessionId: 'test_session_2', userId: 'test_user' },
    expectedIntent: 'memory_retrieve'
  },
  {
    name: 'Web Search Query',
    message: 'What is the latest news about AI?',
    context: { sessionId: 'test_session_3', userId: 'test_user', useOnlineMode: true },
    expectedIntent: 'web_search'
  },
  {
    name: 'Memory Storage',
    message: 'Remember that I have a dentist appointment tomorrow at 3pm',
    context: { sessionId: 'test_session_4', userId: 'test_user' },
    expectedIntent: 'memory_store'
  },
  {
    name: 'Conversational Query',
    message: 'What was the first thing I asked you?',
    context: { 
      sessionId: 'test_session_5', 
      userId: 'test_user',
      conversationHistory: [
        { role: 'user', content: 'Hello, how are you?', timestamp: new Date(Date.now() - 60000).toISOString() },
        { role: 'assistant', content: 'I am doing well, thank you!', timestamp: new Date(Date.now() - 59000).toISOString() }
      ]
    },
    expectedIntent: 'memory_retrieve'
  }
];

/**
 * Format milliseconds to human-readable string
 */
function formatMs(ms) {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Calculate percentage of total time
 */
function calcPercentage(nodeMs, totalMs) {
  return ((nodeMs / totalMs) * 100).toFixed(1);
}

/**
 * Print node timing breakdown
 */
function printNodeBreakdown(trace, totalMs) {
  console.log('\n📊 Node Execution Breakdown:');
  console.log('─'.repeat(80));
  console.log(`${'Node'.padEnd(30)} ${'Duration'.padEnd(12)} ${'% of Total'.padEnd(12)} Status`);
  console.log('─'.repeat(80));

  // Group by node name and sum durations
  const nodeStats = {};
  trace.forEach(entry => {
    if (!nodeStats[entry.node]) {
      nodeStats[entry.node] = {
        totalMs: 0,
        count: 0,
        errors: 0
      };
    }
    nodeStats[entry.node].totalMs += (entry.duration || 0);
    nodeStats[entry.node].count += 1;
    if (entry.error) {
      nodeStats[entry.node].errors += 1;
    }
  });

  // Sort by duration (descending)
  const sortedNodes = Object.entries(nodeStats).sort((a, b) => b[1].totalMs - a[1].totalMs);

  sortedNodes.forEach(([nodeName, stats]) => {
    const avgMs = stats.totalMs / stats.count;
    const percentage = calcPercentage(stats.totalMs, totalMs);
    const status = stats.errors > 0 ? `❌ ${stats.errors} errors` : '✅';
    const callInfo = stats.count > 1 ? ` (${stats.count}x, avg ${formatMs(avgMs)})` : '';
    
    console.log(
      `${nodeName.padEnd(30)} ${formatMs(stats.totalMs).padEnd(12)} ${(percentage + '%').padEnd(12)} ${status}${callInfo}`
    );
  });

  console.log('─'.repeat(80));
}

/**
 * Print detailed trace timeline
 */
function printTraceTimeline(trace) {
  console.log('\n🕐 Execution Timeline:');
  console.log('─'.repeat(100));
  
  let cumulativeMs = 0;
  trace.forEach((entry, idx) => {
    const duration = entry.duration || 0;
    cumulativeMs += duration;
    const bar = '█'.repeat(Math.min(Math.floor(duration / 10), 50));
    const status = entry.error ? '❌' : '✅';
    const cacheInfo = entry.fromCache ? ' [CACHED]' : '';
    
    console.log(
      `${(idx + 1).toString().padStart(2)}. ${status} ${entry.node.padEnd(30)} ${formatMs(duration).padEnd(10)} ${bar}${cacheInfo}`
    );
    
    if (entry.error) {
      console.log(`    ⚠️  Error: ${entry.error}`);
    }
  });
  
  console.log('─'.repeat(100));
  console.log(`Total: ${formatMs(cumulativeMs)}`);
}

/**
 * Identify bottlenecks (nodes taking >20% of total time)
 */
function identifyBottlenecks(trace, totalMs) {
  const nodeStats = {};
  trace.forEach(entry => {
    if (!nodeStats[entry.node]) {
      nodeStats[entry.node] = 0;
    }
    nodeStats[entry.node] += (entry.duration || 0);
  });

  const bottlenecks = Object.entries(nodeStats)
    .filter(([_, ms]) => (ms / totalMs) > 0.2)
    .sort((a, b) => b[1] - a[1]);

  if (bottlenecks.length > 0) {
    console.log('\n⚠️  Performance Bottlenecks (>20% of total time):');
    bottlenecks.forEach(([node, ms]) => {
      console.log(`   • ${node}: ${formatMs(ms)} (${calcPercentage(ms, totalMs)}%)`);
    });
  }
}

/**
 * Run a single test scenario
 */
async function runScenario(orchestrator, scenario) {
  console.log('\n' + '═'.repeat(100));
  console.log(`🧪 Test: ${scenario.name}`);
  console.log(`📝 Message: "${scenario.message}"`);
  console.log(`🎯 Expected Intent: ${scenario.expectedIntent}`);
  console.log('═'.repeat(100));

  const startTime = Date.now();
  
  try {
    // Track progress
    const progressUpdates = [];
    const onProgress = (update) => {
      progressUpdates.push({
        timestamp: Date.now(),
        ...update
      });
    };

    // Execute the workflow
    const result = await orchestrator.processMessageWithGraph(
      scenario.message,
      scenario.context,
      onProgress,
      null // No streaming for tests
    );

    const endTime = Date.now();
    const totalMs = endTime - startTime;

    // Print results
    console.log('\n✅ Test Completed Successfully');
    console.log(`⏱️  Total Time: ${formatMs(totalMs)}`);
    console.log(`🎯 Detected Intent: ${result.action}`);
    console.log(`🔄 Iterations: ${result.debug?.iterations || 1}`);
    console.log(`💾 From Cache: ${result.trace?.some(t => t.fromCache) ? 'Yes' : 'No'}`);
    
    if (result.response) {
      console.log(`💬 Response: ${result.response.substring(0, 100)}${result.response.length > 100 ? '...' : ''}`);
    }

    // Print trace analysis
    if (result.trace && result.trace.length > 0) {
      printNodeBreakdown(result.trace, totalMs);
      printTraceTimeline(result.trace);
      identifyBottlenecks(result.trace, totalMs);
    } else {
      console.log('\n⚠️  No trace data available');
    }

    // Print progress updates
    if (progressUpdates.length > 0) {
      console.log('\n📡 Progress Updates:');
      progressUpdates.forEach((update, idx) => {
        console.log(`   ${idx + 1}. ${update.node || 'unknown'}: ${update.message || 'no message'}`);
      });
    }

    return {
      success: true,
      scenario: scenario.name,
      totalMs,
      trace: result.trace,
      intent: result.action
    };

  } catch (error) {
    const endTime = Date.now();
    const totalMs = endTime - startTime;

    console.log('\n❌ Test Failed');
    console.log(`⏱️  Time Before Failure: ${formatMs(totalMs)}`);
    console.log(`🚨 Error: ${error.message}`);
    console.error(error.stack);

    return {
      success: false,
      scenario: scenario.name,
      totalMs,
      error: error.message
    };
  }
}

/**
 * Print summary of all test results
 */
function printSummary(results) {
  console.log('\n\n' + '═'.repeat(100));
  console.log('📊 PERFORMANCE TEST SUMMARY');
  console.log('═'.repeat(100));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log('\n⏱️  Timing Summary:');
    console.log('─'.repeat(80));
    console.log(`${'Scenario'.padEnd(40)} ${'Total Time'.padEnd(15)} Intent`);
    console.log('─'.repeat(80));
    
    successful.forEach(result => {
      console.log(
        `${result.scenario.padEnd(40)} ${formatMs(result.totalMs).padEnd(15)} ${result.intent || 'N/A'}`
      );
    });
    console.log('─'.repeat(80));

    const avgTime = successful.reduce((sum, r) => sum + r.totalMs, 0) / successful.length;
    const minTime = Math.min(...successful.map(r => r.totalMs));
    const maxTime = Math.max(...successful.map(r => r.totalMs));

    console.log(`Average: ${formatMs(avgTime)}`);
    console.log(`Min: ${formatMs(minTime)}`);
    console.log(`Max: ${formatMs(maxTime)}`);
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed Tests:');
    failed.forEach(result => {
      console.log(`   • ${result.scenario}: ${result.error}`);
    });
  }

  console.log('\n' + '═'.repeat(100));
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Starting StateGraph Performance Test');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🔍 Debug Mode: ${process.env.DEBUG_STATEGRAPH === 'true' ? 'ENABLED' : 'DISABLED'}`);

  // Initialize database (required for MCPConfigManager)
  console.log('\n⚙️  Initializing database...');
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
  console.log('\n⚙️  Initializing MCP system...');
  await initializeMCP(databaseManager);
  console.log('✅ MCP system initialized');

  // Create orchestrator (MCPConfigManager is now initialized)
  console.log('\n⚙️  Creating AgentOrchestrator...');
  const orchestrator = new AgentOrchestrator();
  console.log('✅ AgentOrchestrator ready');

  // Run all test scenarios
  const results = [];
  for (const scenario of TEST_SCENARIOS) {
    const result = await runScenario(orchestrator, scenario);
    results.push(result);
    
    // Wait between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Print summary
  printSummary(results);

  console.log('\n✨ Performance test completed!');
  process.exit(0);
}

// Run tests
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
