#!/usr/bin/env node

/**
 * Sync MCP API Keys
 * 
 * This script ensures that the API keys in .env match the keys
 * expected by the MCP services.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Get project root
const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');

/**
 * Generate a secure API key
 */
function generateApiKey(length = 32) {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

/**
 * Read .env file
 */
function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};

  content.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;

    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  });

  return env;
}

/**
 * Write .env file
 */
function writeEnvFile(filePath, env) {
  const lines = [];

  // Preserve comments and structure from .env.example if it exists
  if (fs.existsSync(envExamplePath)) {
    const exampleContent = fs.readFileSync(envExamplePath, 'utf8');
    const exampleLines = exampleContent.split('\n');

    exampleLines.forEach(line => {
      const trimmed = line.trim();
      
      // Keep comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        lines.push(line);
        return;
      }

      // Extract key
      const [key] = line.split('=');
      if (key) {
        const keyTrimmed = key.trim();
        // Use value from env if it exists, otherwise keep example
        if (env[keyTrimmed] !== undefined) {
          lines.push(`${keyTrimmed}=${env[keyTrimmed]}`);
        } else {
          lines.push(line);
        }
      }
    });
  } else {
    // No example file, just write key=value pairs
    Object.entries(env).forEach(([key, value]) => {
      lines.push(`${key}=${value}`);
    });
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

/**
 * Main function
 */
function main() {
  console.log('🔑 MCP API Key Sync Tool\n');

  // Check if .env exists
  if (!fs.existsSync(envPath)) {
    console.log('⚠️  .env file not found, creating from .env.example...');
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created .env from .env.example');
    } else {
      console.error('❌ .env.example not found. Cannot create .env');
      process.exit(1);
    }
  }

  // Read current .env
  const env = readEnvFile(envPath);

  // Check MCP API keys
  const apiKeys = {
    MCP_USER_MEMORY_API_KEY: env.MCP_USER_MEMORY_API_KEY,
    MCP_WEB_SEARCH_API_KEY: env.MCP_WEB_SEARCH_API_KEY,
    MCP_PHI4_API_KEY: env.MCP_PHI4_API_KEY
  };

  let needsUpdate = false;

  // Generate missing keys
  Object.keys(apiKeys).forEach(key => {
    if (!apiKeys[key] || apiKeys[key].trim() === '') {
      console.log(`🔧 Generating ${key}...`);
      apiKeys[key] = generateApiKey(32);
      needsUpdate = true;
    } else {
      console.log(`✅ ${key} already set`);
    }
  });

  if (needsUpdate) {
    // Update .env with new keys
    const updatedEnv = { ...env, ...apiKeys };
    writeEnvFile(envPath, updatedEnv);
    console.log('\n✅ API keys updated in .env');
    console.log('\n📋 Your API Keys:');
    Object.entries(apiKeys).forEach(([key, value]) => {
      console.log(`   ${key}=${value}`);
    });
    console.log('\n⚠️  IMPORTANT: Restart your app for changes to take effect');
    console.log('⚠️  IMPORTANT: Make sure these keys match your MCP services');
  } else {
    console.log('\n✅ All API keys are already set');
    console.log('\n📋 Current API Keys:');
    Object.entries(apiKeys).forEach(([key, value]) => {
      console.log(`   ${key}=${value}`);
    });
  }

  console.log('\n💡 To use these keys in your MCP services:');
  console.log('   1. Copy the keys above');
  console.log('   2. Set them in your service configuration');
  console.log('   3. Or disable API key validation in development');
}

// Run
main();
