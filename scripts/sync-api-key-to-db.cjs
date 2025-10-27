#!/usr/bin/env node

/**
 * Sync API Keys from .env to Database
 * 
 * Updates the mcp_services table with API keys from .env file
 */

const path = require('path');
const fs = require('fs');
const duckdb = require('duckdb');

// Paths
const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const dbPath = path.join(projectRoot, 'data/agent_memory.duckdb');

console.log('🔑 Syncing API Keys from .env to Database\n');

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found:', dbPath);
  console.error('   Please run the app first to create the database');
  process.exit(1);
}

// Check if .env exists
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found:', envPath);
  process.exit(1);
}

// Read .env file
const env = {};
const content = fs.readFileSync(envPath, 'utf8');
content.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    env[key.trim()] = valueParts.join('=').trim();
  }
});

console.log('📋 API Keys from .env:');
console.log('   MCP_USER_MEMORY_API_KEY:', env.MCP_USER_MEMORY_API_KEY || '(not set)');
console.log('   MCP_PHI4_API_KEY:', env.MCP_PHI4_API_KEY || '(not set)');
console.log('   MCP_WEB_SEARCH_API_KEY:', env.MCP_WEB_SEARCH_API_KEY || '(not set)');
console.log('');

// Connect to DuckDB
const db = new duckdb.Database(dbPath);

// Update API keys
const updates = [
  { service: 'user-memory', key: env.MCP_USER_MEMORY_API_KEY },
  { service: 'phi4', key: env.MCP_PHI4_API_KEY },
  { service: 'web-search', key: env.MCP_WEB_SEARCH_API_KEY }
];

let updatedCount = 0;

console.log('🔄 Updating database...\n');

// Process updates sequentially
(async () => {
  for (const update of updates) {
    if (!update.key) {
      console.log(`⏭️  Skipping ${update.service} (no key in .env)`);
      continue;
    }

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE mcp_services SET api_key = ? WHERE name = ?`,
          [update.key, update.service],
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`✅ Updated ${update.service}: ${update.key.substring(0, 10)}...`);
              updatedCount++;
              resolve();
            }
          }
        );
      });
    } catch (err) {
      console.error(`❌ Failed to update ${update.service}:`, err.message);
    }
  }

  // Verify updates
  console.log('\n🔍 Verifying updates...\n');
  
  db.all('SELECT name, api_key FROM mcp_services', [], (err, rows) => {
    if (err) {
      console.error('❌ Failed to verify:', err.message);
      db.close();
      process.exit(1);
    }

    rows.forEach(row => {
      console.log(`   ${row.name}: ${row.api_key.substring(0, 10)}...`);
    });

    console.log(`\n✅ Updated ${updatedCount} service(s)`);
    console.log('\n⚠️  IMPORTANT: Restart the app for changes to take effect');
    
    db.close();
  });
})();
