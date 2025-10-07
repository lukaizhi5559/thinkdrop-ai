/**
 * MCP Configuration (Backend)
 * 
 * Central configuration for MCP microservices integration.
 * Loaded from environment variables with sensible defaults.
 */

const path = require('path');
const fs = require('fs');

// Load .env file if exists
try {
  require('dotenv').config();
} catch (e) {
  console.warn('⚠️ dotenv not available, using process.env directly');
}

/**
 * MCP Configuration Object
 */
const MCPConfig = {
  // Feature flags
  features: {
    enabled: process.env.MCP_ENABLED === 'true' || false,
    routeMemoryToMCP: process.env.MCP_ROUTE_MEMORY === 'true' || false,
    routeWebSearchToMCP: process.env.MCP_ROUTE_WEB_SEARCH === 'true' || false,
    routePhi4ToMCP: process.env.MCP_ROUTE_PHI4 === 'true' || false,
  },

  // Service endpoints
  services: {
    userMemory: {
      name: 'user-memory',
      endpoint: process.env.MCP_USER_MEMORY_ENDPOINT || 'http://localhost:3001',
      apiKey: process.env.MCP_USER_MEMORY_API_KEY || '',
      timeout: parseInt(process.env.MCP_USER_MEMORY_TIMEOUT || '5000'),
      retries: parseInt(process.env.MCP_USER_MEMORY_RETRIES || '3'),
      enabled: true
    },
    webSearch: {
      name: 'web-search',
      endpoint: process.env.MCP_WEB_SEARCH_ENDPOINT || 'http://localhost:3002',
      apiKey: process.env.MCP_WEB_SEARCH_API_KEY || '',
      timeout: parseInt(process.env.MCP_WEB_SEARCH_TIMEOUT || '3000'),
      retries: parseInt(process.env.MCP_WEB_SEARCH_RETRIES || '3'),
      enabled: true
    },
    phi4: {
      name: 'phi4',
      endpoint: process.env.MCP_PHI4_ENDPOINT || 'http://localhost:3003',
      apiKey: process.env.MCP_PHI4_API_KEY || '',
      timeout: parseInt(process.env.MCP_PHI4_TIMEOUT || '10000'),
      retries: parseInt(process.env.MCP_PHI4_RETRIES || '2'),
      enabled: true
    }
  },

  // Database configuration (shared database)
  database: {
    path: process.env.MCP_DATABASE_PATH || path.join(__dirname, '../../../data/agent_memory.duckdb'),
    shared: true, // Single database shared by UserMemory and future services
    poolSize: parseInt(process.env.MCP_DATABASE_POOL_SIZE || '5')
  },

  // Circuit breaker settings
  circuitBreaker: {
    enabled: true,
    failureThreshold: parseInt(process.env.MCP_CB_FAILURE_THRESHOLD || '5'),
    successThreshold: parseInt(process.env.MCP_CB_SUCCESS_THRESHOLD || '3'),
    timeout: parseInt(process.env.MCP_CB_TIMEOUT || '30000'), // 30 seconds
    halfOpenRequests: parseInt(process.env.MCP_CB_HALF_OPEN_REQUESTS || '1')
  },

  // Health check settings
  healthCheck: {
    enabled: true,
    interval: parseInt(process.env.MCP_HEALTH_CHECK_INTERVAL || '30000'), // 30 seconds
    timeout: parseInt(process.env.MCP_HEALTH_CHECK_TIMEOUT || '5000'),
    cacheTTL: parseInt(process.env.MCP_HEALTH_CACHE_TTL || '15000') // 15 seconds
  },

  // Metrics settings
  metrics: {
    enabled: true,
    logLevel: process.env.MCP_METRICS_LOG_LEVEL || 'info',
    logFormat: process.env.MCP_METRICS_LOG_FORMAT || 'json',
    collectInterval: parseInt(process.env.MCP_METRICS_COLLECT_INTERVAL || '60000') // 1 minute
  },

  // Retry settings
  retry: {
    enabled: true,
    maxRetries: parseInt(process.env.MCP_RETRY_MAX || '3'),
    initialDelay: parseInt(process.env.MCP_RETRY_INITIAL_DELAY || '100'),
    maxDelay: parseInt(process.env.MCP_RETRY_MAX_DELAY || '5000'),
    backoffMultiplier: parseFloat(process.env.MCP_RETRY_BACKOFF_MULTIPLIER || '2'),
    jitter: true
  },

  // Cache settings
  cache: {
    enabled: true,
    maxSize: parseInt(process.env.MCP_CACHE_MAX_SIZE || '1000'),
    ttl: parseInt(process.env.MCP_CACHE_TTL || '300000') // 5 minutes
  },

  // Security settings
  security: {
    validateApiKeys: true,
    allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(','),
    maxPayloadSize: parseInt(process.env.MCP_MAX_PAYLOAD_SIZE || '10485760'), // 10MB
    rateLimitPerMinute: parseInt(process.env.MCP_RATE_LIMIT_PER_MINUTE || '100')
  }
};

/**
 * Get service configuration by name
 * @param {string} serviceName - Service name (user-memory, web-search, phi4)
 * @returns {object|null} Service config or null if not found
 */
function getServiceConfig(serviceName) {
  const serviceKey = Object.keys(MCPConfig.services).find(
    key => MCPConfig.services[key].name === serviceName
  );
  return serviceKey ? MCPConfig.services[serviceKey] : null;
}

/**
 * Check if MCP is enabled globally
 * @returns {boolean}
 */
function isMCPEnabled() {
  return MCPConfig.features.enabled;
}

/**
 * Check if specific service routing is enabled
 * @param {string} intent - Intent type (MEMORY, GENERAL, COMMAND)
 * @returns {boolean}
 */
function isIntentRoutedToMCP(intent) {
  if (!MCPConfig.features.enabled) return false;
  
  switch (intent) {
    case 'MEMORY':
      return MCPConfig.features.routeMemoryToMCP;
    case 'GENERAL':
      return MCPConfig.features.routePhi4ToMCP;
    case 'COMMAND':
      // Check if specific command requires web search
      return MCPConfig.features.routeWebSearchToMCP;
    default:
      return false;
  }
}

/**
 * Get service name for intent
 * @param {string} intent - Intent type
 * @returns {string|null} Service name or null
 */
function getServiceForIntent(intent) {
  switch (intent) {
    case 'MEMORY':
      return 'user-memory';
    case 'GENERAL':
      return 'phi4';
    case 'COMMAND':
      return null; // Commands may use multiple services
    default:
      return null;
  }
}

/**
 * Validate configuration
 * @returns {object} Validation result { valid: boolean, errors: string[] }
 */
function validateConfig() {
  const errors = [];

  // Check if MCP is enabled but no services configured
  if (MCPConfig.features.enabled) {
    const enabledServices = Object.values(MCPConfig.services).filter(s => s.enabled);
    if (enabledServices.length === 0) {
      errors.push('MCP is enabled but no services are configured');
    }

    // Check for missing API keys
    enabledServices.forEach(service => {
      if (!service.apiKey) {
        errors.push(`Service ${service.name} is missing API key`);
      }
    });
  }

  // Validate timeouts
  Object.values(MCPConfig.services).forEach(service => {
    if (service.timeout < 1000) {
      errors.push(`Service ${service.name} timeout is too low (< 1000ms)`);
    }
  });

  // Validate database path
  if (MCPConfig.database.shared) {
    const dbDir = path.dirname(MCPConfig.database.path);
    if (!fs.existsSync(dbDir)) {
      errors.push(`Database directory does not exist: ${dbDir}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Log configuration (with sensitive data masked)
 */
function logConfig() {
  const maskedConfig = JSON.parse(JSON.stringify(MCPConfig));
  
  // Mask API keys
  Object.keys(maskedConfig.services).forEach(key => {
    if (maskedConfig.services[key].apiKey) {
      maskedConfig.services[key].apiKey = '***masked***';
    }
  });

  console.log('📋 MCP Configuration:', JSON.stringify(maskedConfig, null, 2));
}

module.exports = {
  MCPConfig,
  getServiceConfig,
  isMCPEnabled,
  isIntentRoutedToMCP,
  getServiceForIntent,
  validateConfig,
  logConfig
};
