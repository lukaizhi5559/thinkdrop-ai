/**
 * MCP Service Registry
 * 
 * Manages service discovery, health checks, and availability tracking.
 * Caches health status to avoid excessive health check requests.
 */

const { getClient } = require('./MCPClient.js');
const { MCPConfig } = require('./config.cjs');

const logger = require('./../../logger.cjs');
class MCPRegistry {
  constructor(config = MCPConfig) {
    this.config = config;
    this.services = new Map();
    this.healthCache = new Map();
    this.healthCheckInterval = null;
    this.isInitialized = false;
  }

  /**
   * Initialize registry and start health checks
   */
  async initialize() {
    if (this.isInitialized) return;

    logger.debug('🔧 Initializing MCP Service Registry...');

    // Register all configured services
    this.registerConfiguredServices();

    // Start periodic health checks if enabled
    if (this.config.healthCheck.enabled) {
      this.startHealthChecks();
    }

    this.isInitialized = true;
    logger.debug('✅ MCP Service Registry initialized');
  }

  /**
   * Register all services from config
   */
  registerConfiguredServices() {
    Object.entries(this.config.services).forEach(([key, serviceConfig]) => {
      if (serviceConfig.enabled) {
        this.registerService({
          name: serviceConfig.name,
          endpoint: serviceConfig.endpoint,
          apiKey: serviceConfig.apiKey,
          timeout: serviceConfig.timeout,
          retries: serviceConfig.retries
        });
      }
    });

    logger.debug(`📋 Registered ${this.services.size} services`);
  }

  /**
   * Register a service
   * @param {object} serviceInfo - Service information
   */
  registerService(serviceInfo) {
    const { name, endpoint, apiKey, timeout, retries } = serviceInfo;

    if (!name || !endpoint) {
      throw new Error('Service name and endpoint are required');
    }

    this.services.set(name, {
      name,
      endpoint,
      apiKey,
      timeout: timeout || 5000,
      retries: retries || 3,
      status: 'unknown',
      healthy: false,
      lastHealthCheck: null,
      lastHealthCheckDuration: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalRequests: 0,
      totalFailures: 0,
      capabilities: null,
      metadata: {}
    });

    logger.debug(`✅ Registered service: ${name} (${endpoint})`);
  }

  /**
   * Unregister a service
   * @param {string} serviceName - Service name
   */
  unregisterService(serviceName) {
    if (this.services.has(serviceName)) {
      this.services.delete(serviceName);
      this.healthCache.delete(serviceName);
      logger.debug(`🗑️ Unregistered service: ${serviceName}`);
    }
  }

  /**
   * Get service by name
   * @param {string} serviceName - Service name
   * @returns {object|null} Service info or null
   */
  getService(serviceName) {
    return this.services.get(serviceName) || null;
  }

  /**
   * Get all registered services
   * @returns {array} Array of service objects
   */
  getAllServices() {
    return Array.from(this.services.values());
  }

  /**
   * Get healthy services only
   * @returns {array} Array of healthy service objects
   */
  getHealthyServices() {
    return this.getAllServices().filter(service => service.healthy);
  }

  /**
   * Check if service is registered
   * @param {string} serviceName - Service name
   * @returns {boolean}
   */
  hasService(serviceName) {
    return this.services.has(serviceName);
  }

  /**
   * Check if service is healthy
   * @param {string} serviceName - Service name
   * @returns {boolean}
   */
  isServiceHealthy(serviceName) {
    const service = this.getService(serviceName);
    return service ? service.healthy : false;
  }

  /**
   * Get service health status (with caching)
   * @param {string} serviceName - Service name
   * @param {boolean} forceRefresh - Force refresh (skip cache)
   * @returns {Promise<object>} Health status
   */
  async getServiceHealth(serviceName, forceRefresh = false) {
    const service = this.getService(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    // Check cache first
    if (!forceRefresh) {
      const cached = this.getCachedHealth(serviceName);
      if (cached) {
        return cached;
      }
    }

    // Perform health check
    const health = await this.performHealthCheck(serviceName);

    // Cache result
    this.cacheHealth(serviceName, health);

    return health;
  }

  /**
   * Perform health check on service
   * @param {string} serviceName - Service name
   * @returns {Promise<object>} Health status
   */
  async performHealthCheck(serviceName) {
    const service = this.getService(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    const startTime = Date.now();

    try {
      const mcpClient = getClient(this.config);
      const health = await mcpClient.checkHealth(serviceName);

      const duration = Date.now() - startTime;

      // Update service status
      service.status = health.status || 'up';
      service.healthy = health.status === 'up';
      service.lastHealthCheck = new Date().toISOString();
      service.lastHealthCheckDuration = duration;
      service.consecutiveFailures = 0;
      service.consecutiveSuccesses += 1;

      logger.debug(`✅ Health check passed for ${serviceName} (${duration}ms)`);

      return {
        service: serviceName,
        status: 'up',
        healthy: true,
        duration,
        timestamp: service.lastHealthCheck,
        details: health
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Update service status
      service.status = 'down';
      service.healthy = false;
      service.lastHealthCheck = new Date().toISOString();
      service.lastHealthCheckDuration = duration;
      service.consecutiveFailures += 1;
      service.consecutiveSuccesses = 0;
      service.totalFailures += 1;

      logger.warn(`⚠️ Health check failed for ${serviceName}: ${error.message}`);

      return {
        service: serviceName,
        status: 'down',
        healthy: false,
        duration,
        timestamp: service.lastHealthCheck,
        error: error.message
      };
    }
  }

  /**
   * Get cached health status
   * @param {string} serviceName - Service name
   * @returns {object|null} Cached health or null
   */
  getCachedHealth(serviceName) {
    const cached = this.healthCache.get(serviceName);
    if (!cached) return null;

    const now = Date.now();
    const age = now - cached.timestamp;

    // Check if cache is still valid
    if (age < this.config.healthCheck.cacheTTL) {
      return cached.health;
    }

    // Cache expired
    this.healthCache.delete(serviceName);
    return null;
  }

  /**
   * Cache health status
   * @param {string} serviceName - Service name
   * @param {object} health - Health status
   */
  cacheHealth(serviceName, health) {
    this.healthCache.set(serviceName, {
      health,
      timestamp: Date.now()
    });
  }

  /**
   * Clear health cache for service
   * @param {string} serviceName - Service name (optional, clears all if not provided)
   */
  clearHealthCache(serviceName = null) {
    if (serviceName) {
      this.healthCache.delete(serviceName);
    } else {
      this.healthCache.clear();
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    if (this.healthCheckInterval) {
      return; // Already running
    }

    logger.debug(`🔄 Starting periodic health checks (interval: ${this.config.healthCheck.interval}ms)`);

    this.healthCheckInterval = setInterval(async () => {
      await this.checkAllServices();
    }, this.config.healthCheck.interval);

    // Perform initial health check
    this.checkAllServices().catch(err => {
      logger.warn('⚠️ Initial health check failed:', err.message);
    });
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.debug('🛑 Stopped periodic health checks');
    }
  }

  /**
   * Check health of all registered services
   * @returns {Promise<object>} Health check results
   */
  async checkAllServices() {
    const services = this.getAllServices();
    const results = {};

    for (const service of services) {
      try {
        const health = await this.performHealthCheck(service.name);
        results[service.name] = health;
      } catch (error) {
        results[service.name] = {
          service: service.name,
          status: 'error',
          healthy: false,
          error: error.message
        };
      }
    }

    return results;
  }

  /**
   * Get service capabilities
   * @param {string} serviceName - Service name
   * @param {boolean} forceRefresh - Force refresh (skip cache)
   * @returns {Promise<object>} Service capabilities
   */
  async getServiceCapabilities(serviceName, forceRefresh = false) {
    const service = this.getService(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    // Return cached capabilities if available
    if (!forceRefresh && service.capabilities) {
      return service.capabilities;
    }

    // Fetch capabilities
    try {
      const mcpClient = getClient(this.config);
      const capabilities = await mcpClient.getCapabilities(serviceName);

      // Cache capabilities
      service.capabilities = capabilities;

      return capabilities;
    } catch (error) {
      logger.warn(`⚠️ Failed to get capabilities for ${serviceName}:`, error.message);
      throw error;
    }
  }

  /**
   * Update service metadata
   * @param {string} serviceName - Service name
   * @param {object} metadata - Metadata to update
   */
  updateServiceMetadata(serviceName, metadata) {
    const service = this.getService(serviceName);
    if (service) {
      service.metadata = { ...service.metadata, ...metadata };
    }
  }

  /**
   * Record service request
   * @param {string} serviceName - Service name
   * @param {boolean} success - Whether request succeeded
   */
  recordRequest(serviceName, success) {
    const service = this.getService(serviceName);
    if (service) {
      service.totalRequests += 1;
      if (!success) {
        service.totalFailures += 1;
      }
    }
  }

  /**
   * Get service statistics
   * @param {string} serviceName - Service name
   * @returns {object} Service statistics
   */
  getServiceStats(serviceName) {
    const service = this.getService(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    return {
      name: service.name,
      endpoint: service.endpoint,
      status: service.status,
      healthy: service.healthy,
      lastHealthCheck: service.lastHealthCheck,
      lastHealthCheckDuration: service.lastHealthCheckDuration,
      consecutiveFailures: service.consecutiveFailures,
      consecutiveSuccesses: service.consecutiveSuccesses,
      totalRequests: service.totalRequests,
      totalFailures: service.totalFailures,
      successRate: service.totalRequests > 0 
        ? ((service.totalRequests - service.totalFailures) / service.totalRequests) 
        : 0,
      errorRate: service.totalRequests > 0 
        ? (service.totalFailures / service.totalRequests) 
        : 0
    };
  }

  /**
   * Get all service statistics
   * @returns {object} Statistics for all services
   */
  getAllServiceStats() {
    const stats = {};
    this.services.forEach((service, name) => {
      stats[name] = this.getServiceStats(name);
    });
    return stats;
  }

  /**
   * Get registry summary
   * @returns {object} Registry summary
   */
  getSummary() {
    const services = this.getAllServices();
    const healthyServices = this.getHealthyServices();

    return {
      totalServices: services.length,
      healthyServices: healthyServices.length,
      unhealthyServices: services.length - healthyServices.length,
      services: services.map(s => ({
        name: s.name,
        status: s.status,
        healthy: s.healthy,
        endpoint: s.endpoint
      }))
    };
  }

  /**
   * Reset service statistics
   * @param {string} serviceName - Service name (optional, resets all if not provided)
   */
  resetStats(serviceName = null) {
    if (serviceName) {
      const service = this.getService(serviceName);
      if (service) {
        service.totalRequests = 0;
        service.totalFailures = 0;
        service.consecutiveFailures = 0;
        service.consecutiveSuccesses = 0;
      }
    } else {
      this.services.forEach(service => {
        service.totalRequests = 0;
        service.totalFailures = 0;
        service.consecutiveFailures = 0;
        service.consecutiveSuccesses = 0;
      });
    }
  }

  /**
   * Shutdown registry
   */
  shutdown() {
    this.stopHealthChecks();
    this.services.clear();
    this.healthCache.clear();
    this.isInitialized = false;
    logger.debug('🛑 MCP Service Registry shut down');
  }
}

// Export singleton instance
let registryInstance = null;

function getRegistry(config = MCPConfig) {
  if (!registryInstance) {
    registryInstance = new MCPRegistry(config);
  }
  return registryInstance;
}

function resetRegistry() {
  if (registryInstance) {
    registryInstance.shutdown();
  }
  registryInstance = null;
}

module.exports = {
  MCPRegistry,
  getRegistry,
  resetRegistry
};
