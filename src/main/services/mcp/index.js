/**
 * MCP Module - Main Entry Point
 * 
 * Exports all MCP components for easy importing.
 */

// Core components
const { MCPClient, getClient, resetClient } = require('./MCPClient.js');
const { MCPRegistry, getRegistry, resetRegistry } = require('./MCPRegistry.js');
const { MCPCircuitBreaker, CircuitBreakerManager, CircuitState, getCircuitBreakerManager, resetCircuitBreakerManager } = require('./MCPCircuitBreaker.js');
const { MCPMetrics, getMetrics, resetMetrics } = require('./MCPMetrics.js');
const { MCPOrchestrator, getMCPOrchestrator, resetMCPOrchestrator } = require('./MCPOrchestrator.js');

const logger = require('./../../logger.cjs');
// Configuration
const { 
  MCPConfig, 
  getServiceConfig, 
  isMCPEnabled, 
  isIntentRoutedToMCP, 
  getServiceForIntent,
  validateConfig,
  logConfig 
} = require('./config.cjs');

// Schemas
const { 
  MCPRequestEnvelope,
  MCPResponseEnvelope,
  MCPError,
  ErrorCodes,
  RetryableErrorCodes,
  createRequest,
  createResponse,
  createError,
  validateRequest,
  validateResponse,
  generateRequestId,
  generateTraceId,
  isRetryableError
} = require('./schemas/envelope.cjs');

const {
  IntentTypes,
  IntentServiceMapping,
  IntentActionMapping,
  ServiceCapabilities,
  getServiceForIntent: getServiceFromIntentSchema,
  getActionForIntent,
  shouldRouteToMCP,
  getServiceCapabilities,
  serviceSupportsAction,
  parseAction,
  determineOperation
} = require('./schemas/intents.cjs');

// Utilities
const {
  generateApiKey,
  generateAllApiKeys,
  initializeApiKeys,
  rotateApiKey,
  validateApiKey,
  getApiKeyForService,
  apiKeysExist
} = require('./utils/apiKeyGenerator.cjs');

/**
 * Initialize MCP system
 * @param {object} config - Optional config override
 * @returns {Promise<object>} Initialized components
 */
async function initializeMCP(config = MCPConfig) {
  logger.debug('🚀 Initializing MCP System...');

  // Initialize API keys if not exist
  if (!apiKeysExist()) {
    logger.debug('🔑 Generating MCP API keys...');
    initializeApiKeys();
  }

  // Validate configuration
  const validation = validateConfig();
  if (!validation.valid) {
    logger.warn('⚠️ MCP Configuration validation failed:', validation.errors);
  }

  // Log configuration (with masked keys)
  logConfig();

  // Initialize orchestrator (which initializes registry)
  const orchestrator = getMCPOrchestrator(config);
  await orchestrator.initialize();

  logger.debug('✅ MCP System initialized');

  return {
    orchestrator,
    client: getClient(config),
    registry: getRegistry(config),
    circuitBreaker: getCircuitBreakerManager(config),
    metrics: getMetrics(config)
  };
}

/**
 * Shutdown MCP system
 */
function shutdownMCP() {
  logger.debug('🛑 Shutting down MCP System...');
  
  const orchestrator = getMCPOrchestrator();
  orchestrator.shutdown();
  
  resetMCPOrchestrator();
  resetRegistry();
  resetCircuitBreakerManager();
  resetMetrics();
  resetClient();
  
  logger.debug('✅ MCP System shut down');
}

/**
 * Get MCP system status
 * @returns {object} System status
 */
function getMCPStatus() {
  if (!isMCPEnabled()) {
    return {
      enabled: false,
      status: 'disabled'
    };
  }

  const orchestrator = getMCPOrchestrator();
  
  return {
    enabled: true,
    status: 'active',
    degradationMode: orchestrator.getDegradationMode(),
    registry: orchestrator.getRegistrySummary(),
    metrics: orchestrator.getMetricsSummary(),
    circuitBreakers: orchestrator.getCircuitBreakerStats()
  };
}

// Export everything
module.exports = {
  // Core components
  MCPClient,
  MCPRegistry,
  MCPCircuitBreaker,
  CircuitBreakerManager,
  MCPMetrics,
  MCPOrchestrator,
  
  // Singleton getters
  getClient,
  getRegistry,
  getCircuitBreakerManager,
  getMetrics,
  getMCPOrchestrator,
  
  // Reset functions
  resetClient,
  resetRegistry,
  resetCircuitBreakerManager,
  resetMetrics,
  resetMCPOrchestrator,
  
  // Configuration
  MCPConfig,
  getServiceConfig,
  isMCPEnabled,
  isIntentRoutedToMCP,
  getServiceForIntent,
  validateConfig,
  logConfig,
  
  // Schemas
  MCPRequestEnvelope,
  MCPResponseEnvelope,
  MCPError,
  ErrorCodes,
  RetryableErrorCodes,
  createRequest,
  createResponse,
  createError,
  validateRequest,
  validateResponse,
  generateRequestId,
  generateTraceId,
  isRetryableError,
  
  // Intent schemas
  IntentTypes,
  IntentServiceMapping,
  IntentActionMapping,
  ServiceCapabilities,
  getActionForIntent,
  shouldRouteToMCP,
  getServiceCapabilities,
  serviceSupportsAction,
  parseAction,
  determineOperation,
  
  // Utilities
  generateApiKey,
  generateAllApiKeys,
  initializeApiKeys,
  rotateApiKey,
  validateApiKey,
  getApiKeyForService,
  apiKeysExist,
  
  // System functions
  initializeMCP,
  shutdownMCP,
  getMCPStatus,
  
  // Constants
  CircuitState
};
