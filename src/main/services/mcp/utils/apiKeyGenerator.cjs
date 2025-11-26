/**
 * API Key Generator
 * 
 * Generates secure API keys for MCP services.
 * Keys are stored in .env file for persistence.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const logger = require('./../../../logger.cjs');
/**
 * Generate a secure API key
 * @param {number} length - Key length (default: 32)
 * @returns {string} Generated API key
 */
function generateApiKey(length = 32) {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

/**
 * Generate API keys for all MCP services
 * @returns {object} Object with service names as keys and API keys as values
 */
function generateAllApiKeys() {
  return {
    MCP_USER_MEMORY_API_KEY: generateApiKey(32),
    MCP_WEB_SEARCH_API_KEY: generateApiKey(32),
    MCP_PHI4_API_KEY: generateApiKey(32)
  };
}

/**
 * Get .env file path
 * @returns {string} Path to .env file
 */
function getEnvFilePath() {
  // Go up from src/main/services/mcp/utils to project root
  return path.join(__dirname, '../../../../../.env');
}

/**
 * Read .env file
 * @returns {object} Parsed .env content
 */
function readEnvFile() {
  const envPath = getEnvFilePath();
  
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, 'utf8');
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
 * @param {object} env - Environment variables object
 */
function writeEnvFile(env) {
  const envPath = getEnvFilePath();
  const lines = [];

  // Add header
  lines.push('# Thinkdrop AI - Environment Variables');
  lines.push('# Generated: ' + new Date().toISOString());
  lines.push('');

  // Add MCP section
  lines.push('# MCP Configuration');
  lines.push('MCP_ENABLED=false');
  lines.push('MCP_ROUTE_MEMORY=false');
  lines.push('MCP_ROUTE_WEB_SEARCH=false');
  lines.push('MCP_ROUTE_PHI4=false');
  lines.push('');

  // Add API keys
  lines.push('# MCP API Keys (DO NOT SHARE)');
  Object.keys(env).forEach(key => {
    if (key.includes('API_KEY')) {
      lines.push(`${key}=${env[key]}`);
    }
  });
  lines.push('');

  // Add service endpoints
  lines.push('# MCP Service Endpoints');
  lines.push('MCP_USER_MEMORY_ENDPOINT=http://localhost:3001');
  lines.push('MCP_WEB_SEARCH_ENDPOINT=http://localhost:3002');
  lines.push('MCP_PHI4_ENDPOINT=http://localhost:3003');
  lines.push('');

  // Add other existing env vars (preserve)
  Object.keys(env).forEach(key => {
    if (!key.startsWith('MCP_') && !lines.some(line => line.startsWith(key + '='))) {
      lines.push(`${key}=${env[key]}`);
    }
  });

  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
}

/**
 * Check if API keys exist in .env
 * @returns {boolean}
 */
function apiKeysExist() {
  const env = readEnvFile();
  return !!(
    env.MCP_USER_MEMORY_API_KEY &&
    env.MCP_WEB_SEARCH_API_KEY &&
    env.MCP_PHI4_API_KEY
  );
}

/**
 * Initialize API keys (generate if not exist)
 * @param {boolean} force - Force regeneration even if keys exist
 * @returns {object} API keys object
 */
function initializeApiKeys(force = false) {
  const env = readEnvFile();

  if (!force && apiKeysExist()) {
    logger.debug('✅ MCP API keys already exist in .env');
    return {
      MCP_USER_MEMORY_API_KEY: env.MCP_USER_MEMORY_API_KEY,
      MCP_WEB_SEARCH_API_KEY: env.MCP_WEB_SEARCH_API_KEY,
      MCP_PHI4_API_KEY: env.MCP_PHI4_API_KEY
    };
  }

  logger.debug('🔑 Generating MCP API keys...');
  const apiKeys = generateAllApiKeys();

  // Merge with existing env
  const updatedEnv = { ...env, ...apiKeys };
  writeEnvFile(updatedEnv);

  logger.debug('✅ MCP API keys generated and saved to .env');
  logger.debug('⚠️  IMPORTANT: Keep these keys secure and do not commit to version control');

  return apiKeys;
}

/**
 * Rotate API key for a specific service
 * @param {string} serviceName - Service name (user-memory, web-search, phi4)
 * @returns {string} New API key
 */
function rotateApiKey(serviceName) {
  const keyMapping = {
    'user-memory': 'MCP_USER_MEMORY_API_KEY',
    'web-search': 'MCP_WEB_SEARCH_API_KEY',
    'phi4': 'MCP_PHI4_API_KEY'
  };

  const envKey = keyMapping[serviceName];
  if (!envKey) {
    throw new Error(`Unknown service: ${serviceName}`);
  }

  const env = readEnvFile();
  const newKey = generateApiKey(32);
  env[envKey] = newKey;

  writeEnvFile(env);

  logger.debug(`✅ API key rotated for ${serviceName}`);
  logger.debug(`   New key: ${newKey.substring(0, 8)}...`);

  return newKey;
}

/**
 * Validate API key format
 * @param {string} apiKey - API key to validate
 * @returns {boolean}
 */
function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;
  if (apiKey.length < 16) return false; // Minimum 16 characters
  if (!/^[A-Za-z0-9_-]+$/.test(apiKey)) return false; // Base64url format
  return true;
}

/**
 * Get API key for service
 * @param {string} serviceName - Service name
 * @returns {string|null} API key or null
 */
function getApiKeyForService(serviceName) {
  const keyMapping = {
    'user-memory': 'MCP_USER_MEMORY_API_KEY',
    'web-search': 'MCP_WEB_SEARCH_API_KEY',
    'phi4': 'MCP_PHI4_API_KEY'
  };

  const envKey = keyMapping[serviceName];
  if (!envKey) return null;

  const env = readEnvFile();
  return env[envKey] || null;
}

module.exports = {
  generateApiKey,
  generateAllApiKeys,
  initializeApiKeys,
  rotateApiKey,
  validateApiKey,
  getApiKeyForService,
  apiKeysExist
};
