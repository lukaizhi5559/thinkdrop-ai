/**
 * MCP Orchestrator
 * 
 * High-level orchestration layer that integrates MCP client, registry, 
 * circuit breaker, and metrics. Provides simple API for routing requests
 * to MCP services with automatic fallback.
 */

const { getClient } = require('./MCPClient.js');
const { getRegistry } = require('./MCPRegistry.js');
const { getCircuitBreakerManager } = require('./MCPCircuitBreaker.js');
const { getMetrics } = require('./MCPMetrics.js');
const { MCPConfig, isIntentRoutedToMCP, getServiceForIntent } = require('./config.cjs');
const { getServiceForIntent: getServiceFromIntent, getActionForIntent, determineOperation } = require('./schemas/intents.cjs');

class MCPOrchestrator {
  constructor(config = MCPConfig) {
    this.config = config;
    this.client = getClient(config);
    this.registry = getRegistry(config);
    this.circuitBreaker = getCircuitBreakerManager(config);
    this.metrics = getMetrics(config);
    this.isInitialized = false;
  }

  /**
   * Initialize MCP orchestrator
   */
  async initialize() {
    if (this.isInitialized) return;

    console.log('🚀 Initializing MCP Orchestrator...');

    // Initialize registry (registers services and starts health checks)
    await this.registry.initialize();

    // Set up circuit breaker callbacks
    this.setupCircuitBreakerCallbacks();

    this.isInitialized = true;
    console.log('✅ MCP Orchestrator initialized');
  }

  /**
   * Set up circuit breaker state change callbacks
   */
  setupCircuitBreakerCallbacks() {
    // Log circuit breaker state changes to metrics
    const breakers = this.circuitBreaker.getAllBreakers();
    breakers.forEach((breaker, serviceName) => {
      breaker.setStateChangeCallback((oldState, newState, service) => {
        this.metrics.recordCircuitBreakerStateChange(service, oldState, newState);
      });
    });
  }

  /**
   * Route request to MCP service or fallback to local
   * @param {object} options - Request options
   * @returns {Promise<object>} Response data or null if should use local
   */
  async routeRequest(options) {
    const {
      intent,
      action = null,
      payload = {},
      context = {},
      fallbackFn = null
    } = options;

    // Check if MCP is enabled globally
    if (!this.config.features.enabled) {
      return null; // Use local
    }

    // Check if this intent should be routed to MCP
    if (!isIntentRoutedToMCP(intent, this.config)) {
      return null; // Use local
    }

    // Determine service and action
    const serviceName = getServiceFromIntent(intent);
    if (!serviceName) {
      return null; // No MCP service for this intent
    }

    // Check if service is registered and healthy
    const service = this.registry.getService(serviceName);
    if (!service) {
      console.warn(`⚠️ Service not registered: ${serviceName}`);
      return null; // Use local
    }

    if (!service.healthy) {
      console.warn(`⚠️ Service unhealthy: ${serviceName}`);
      return null; // Use local
    }

    // Determine action if not provided
    const operation = determineOperation(intent, payload);
    const mcpAction = action || getActionForIntent(intent, operation);
    if (!mcpAction) {
      console.warn(`⚠️ No action mapping for intent: ${intent}`);
      return null; // Use local
    }

    // Execute request with circuit breaker
    try {
      const startTime = Date.now();
      
      const result = await this.circuitBreaker.execute(serviceName, async () => {
        return await this.client.request({
          service: serviceName,
          action: mcpAction,
          payload,
          context
        });
      });

      const elapsedMs = Date.now() - startTime;

      // Record metrics
      this.metrics.recordRequest({
        service: serviceName,
        action: mcpAction,
        requestId: result.requestId,
        traceId: result.meta?.traceId,
        status: result.status,
        elapsedMs,
        error: result.error,
        userId: context.userId,
        sessionId: context.sessionId
      });

      // Record success in registry
      this.registry.recordRequest(serviceName, true);

      return result.data;
    } catch (error) {
      console.warn(`⚠️ MCP request failed for ${serviceName}.${mcpAction}:`, error.message);

      // Record failure in registry
      this.registry.recordRequest(serviceName, false);

      // Record metrics
      this.metrics.recordRequest({
        service: serviceName,
        action: mcpAction,
        requestId: 'unknown',
        traceId: context.traceId,
        status: 'error',
        elapsedMs: 0,
        error: error,
        userId: context.userId,
        sessionId: context.sessionId
      });

      // Try fallback if provided
      if (fallbackFn && typeof fallbackFn === 'function') {
        console.log(`🔄 Using fallback for ${serviceName}.${mcpAction}`);
        return await fallbackFn();
      }

      // Return null to signal caller to use local agent
      return null;
    }
  }

  /**
   * Route intent classification to Phi4 service
   * @param {string} message - Message to classify
   * @param {object} context - Context
   * @param {function} fallbackFn - Fallback function
   * @returns {Promise<object>} Intent classification result
   */
  async classifyIntent(message, context = {}, fallbackFn = null) {
    return await this.routeRequest({
      intent: 'GENERAL', // Phi4 handles intent parsing
      action: 'intent.parse',
      payload: {
        message,
        options: {
          parser: 'distilbert',
          includeEntities: true,
          includeConfidence: true,
          includeSuggestedResponse: true
        }
      },
      context,
      fallbackFn
    });
  }

  /**
   * Route memory operation to UserMemory service
   * @param {string} operation - Memory operation (store, search, retrieve, etc.)
   * @param {object} payload - Operation payload
   * @param {object} context - Context
   * @param {function} fallbackFn - Fallback function
   * @returns {Promise<object>} Operation result
   */
  async executeMemoryOperation(operation, payload, context = {}, fallbackFn = null) {
    return await this.routeRequest({
      intent: 'MEMORY',
      action: `memory.${operation}`,
      payload,
      context,
      fallbackFn
    });
  }

  /**
   * Route web search to WebSearch service
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @param {object} context - Context
   * @param {function} fallbackFn - Fallback function
   * @returns {Promise<object>} Search results
   */
  async executeWebSearch(query, options = {}, context = {}, fallbackFn = null) {
    return await this.routeRequest({
      intent: 'COMMAND',
      action: 'web.search',
      payload: { query, ...options },
      context,
      fallbackFn
    });
  }

  /**
   * Route general question to Phi4 service
   * @param {string} query - Question
   * @param {object} context - Context
   * @param {function} fallbackFn - Fallback function
   * @returns {Promise<object>} Answer
   */
  async answerQuestion(query, context = {}, fallbackFn = null) {
    return await this.routeRequest({
      intent: 'GENERAL',
      action: 'general.answer',
      payload: { query, context },
      context,
      fallbackFn
    });
  }

  /**
   * Get service health status
   * @param {string} serviceName - Service name (optional, gets all if not provided)
   * @returns {Promise<object>} Health status
   */
  async getServiceHealth(serviceName = null) {
    if (serviceName) {
      return await this.registry.getServiceHealth(serviceName);
    } else {
      return await this.registry.checkAllServices();
    }
  }

  /**
   * Get all metrics
   * @returns {object} Metrics
   */
  getMetrics() {
    return this.metrics.getMetrics();
  }

  /**
   * Get metrics summary
   * @returns {object} Metrics summary
   */
  getMetricsSummary() {
    return this.metrics.getSummary();
  }

  /**
   * Get registry summary
   * @returns {object} Registry summary
   */
  getRegistrySummary() {
    return this.registry.getSummary();
  }

  /**
   * Get circuit breaker statistics
   * @returns {object} Circuit breaker stats
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getAllStats();
  }

  /**
   * Get degradation mode
   * @returns {string} Degradation mode (full, degraded, local-only, offline)
   */
  getDegradationMode() {
    if (!this.config.features.enabled) {
      return 'local-only';
    }

    const services = this.registry.getAllServices();
    const healthyCount = services.filter(s => s.healthy).length;

    if (healthyCount === services.length) {
      return 'full';
    } else if (healthyCount > 0) {
      return 'degraded';
    } else {
      return 'local-only';
    }
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics.reset();
  }

  /**
   * Shutdown orchestrator
   */
  shutdown() {
    this.registry.shutdown();
    this.metrics.stopPeriodicCollection();
    console.log('🛑 MCP Orchestrator shut down');
  }
}

// Export singleton instance
let orchestratorInstance = null;

function getMCPOrchestrator(config = MCPConfig) {
  if (!orchestratorInstance) {
    orchestratorInstance = new MCPOrchestrator(config);
  }
  return orchestratorInstance;
}

function resetMCPOrchestrator() {
  if (orchestratorInstance) {
    orchestratorInstance.shutdown();
  }
  orchestratorInstance = null;
}

module.exports = {
  MCPOrchestrator,
  getMCPOrchestrator,
  resetMCPOrchestrator
};
