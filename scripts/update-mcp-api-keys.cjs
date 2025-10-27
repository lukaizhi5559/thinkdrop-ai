#!/usr/bin/env node

/**
 * Update MCP API Keys in Database
 * 
 * This script updates the API keys in the MCP services database
 * to match what's configured in the actual services.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Get database path
const dbPath = path.join(__dirname, '../data/agent_memory.duckdb');

console.log('🔑 MCP API Key Update Tool\n');

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found:', dbPath);
  console.error('   Please run the app first to create the database');
  process.exit(1);
}

// Read .env file to get API keys
const envPath = path.join(__dirname, '../.env');
const env = {};

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

console.log('📋 API Keys from .env:');
console.log('   MCP_USER_MEMORY_API_KEY:', env.MCP_USER_MEMORY_API_KEY || '(not set)');
console.log('   MCP_PHI4_API_KEY:', env.MCP_PHI4_API_KEY || '(not set)');
console.log('   MCP_WEB_SEARCH_API_KEY:', env.MCP_WEB_SEARCH_API_KEY || '(not set)');
console.log('');

// For DuckDB, we need to use the CLI or a different approach
// Let's create SQL statements that can be run manually

console.log('📝 SQL Statements to Update API Keys:\n');
console.log('Run these in your DuckDB CLI or update the migration file:\n');

if (env.MCP_USER_MEMORY_API_KEY) {
  console.log(`UPDATE mcp_services SET api_key = '${env.MCP_USER_MEMORY_API_KEY}' WHERE name = 'user-memory';`);
}

if (env.MCP_PHI4_API_KEY) {
  console.log(`UPDATE mcp_services SET api_key = '${env.MCP_PHI4_API_KEY}' WHERE name = 'phi4';`);
}

if (env.MCP_WEB_SEARCH_API_KEY) {
  console.log(`UPDATE mcp_services SET api_key = '${env.MCP_WEB_SEARCH_API_KEY}' WHERE name = 'web-search';`);
}

console.log('\n💡 Or update the migration file:');
console.log('   src/main/services/mcp/migrations/001_initial_services.cjs');
console.log('\n⚠️  Restart the app after updating');
