/**
 * MCP Service Discovery
 * 
 * Auto-discovers service capabilities from /service.capabilities endpoint.
 * Validates service compatibility and registers services automatically.
 */

const fetch = require('node-fetch');

class MCPServiceDiscovery {
  constructor(configManager) {
    this.configManager = configManager;
  }

  /**
   * Discover service capabilities from endpoint
   * @param {string} endpoint - Service endpoint URL
   * @returns {Promise<object>} Service capabilities
   */
  async discoverService(endpoint) {
    console.log(`🔍 Discovering service at ${endpoint}...`);

    try {
      // 1. Fetch capabilities
      const response = await fetch(`${endpoint}/service.capabilities`, {
        method: 'GET',
        timeout: 10000 // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch capabilities: ${response.statusText}`);
      }

      const capabilities = await response.json();

      // 2. Validate capabilities schema
      this.validateCapabilities(capabilities);

      console.log(`✅ Discovered service: ${capabilities.name} v${capabilities.version}`);

      return capabilities;

    } catch (error) {
      console.error(`❌ Service discovery failed for ${endpoint}:`, error.message);
      throw new Error(`Service discovery failed: ${error.message}`);
    }
  }

  /**
   * Validate service capabilities schema
   * @param {object} capabilities - Service capabilities object
   */
  validateCapabilities(capabilities) {
    const required = ['name', 'displayName', 'version', 'actions'];
    const missing = required.filter(field => !capabilities[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // Validate actions array
    if (!Array.isArray(capabilities.actions) || capabilities.actions.length === 0) {
      throw new Error('Actions must be a non-empty array');
    }

    // Validate action format (should be 'category.action')
    const invalidActions = capabilities.actions.filter(action => !action.includes('.'));
    if (invalidActions.length > 0) {
      throw new Error(`Invalid action format: ${invalidActions.join(', ')}. Expected format: 'category.action'`);
    }

    // Validate version format (semver)
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(capabilities.version)) {
      throw new Error(`Invalid version format: ${capabilities.version}. Expected semver (e.g., 1.0.0)`);
    }

    console.log(`✅ Capabilities validated for ${capabilities.name}`);
  }

  /**
   * Check service health
   * @param {string} endpoint - Service endpoint URL
   * @param {string} healthPath - Health check path (default: /health)
   * @returns {Promise<object>} Health status
   */
  async checkHealth(endpoint, healthPath = '/health') {
    console.log(`🏥 Checking health of ${endpoint}...`);

    try {
      const startTime = Date.now();
      const response = await fetch(`${endpoint}${healthPath}`, {
        method: 'GET',
        timeout: 5000 // 5 second timeout
      });

      const duration = Date.now() - startTime;

      const health = {
        status: response.ok ? 'healthy' : 'degraded',
        statusCode: response.status,
        responseTime: duration,
        timestamp: new Date().toISOString()
      };

      // Try to parse health response body
      try {
        const body = await response.json();
        health.details = body;
      } catch (e) {
        // Health endpoint might not return JSON
      }

      console.log(`✅ Health check: ${health.status} (${duration}ms)`);

      return health;

    } catch (error) {
      console.error(`❌ Health check failed for ${endpoint}:`, error.message);
      return {
        status: 'down',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Auto-register discovered service
   * @param {string} endpoint - Service endpoint URL
   * @param {string} apiKey - API key for authentication
   * @param {object} options - Additional options (trusted, trustLevel, etc.)
   * @returns {Promise<object>} Registered service
   */
  async registerService(endpoint, apiKey, options = {}) {
    console.log(`📝 Registering service at ${endpoint}...`);

    try {
      // 1. Discover capabilities
      const capabilities = await this.discoverService(endpoint);

      // 2. Check health
      const health = await this.checkHealth(endpoint, capabilities.healthEndpoint);

      if (health.status === 'down') {
        throw new Error('Service is not healthy, cannot register');
      }

      // 3. Build service config
      const serviceConfig = {
        name: capabilities.name,
        displayName: capabilities.displayName,
        description: capabilities.description || `${capabilities.displayName} service`,
        endpoint: endpoint,
        apiKey: apiKey,
        version: capabilities.version,
        capabilities: capabilities.capabilities || {},
        actions: capabilities.actions,
        trusted: options.trusted || false,
        trustLevel: options.trustLevel || 'ask_always',
        allowedActions: options.allowedActions || null,
        rateLimit: options.rateLimit || 100,
        enabled: options.enabled !== false // Default to enabled
      };

      // 4. Register in database
      await this.configManager.addService(serviceConfig);

      console.log(`✅ Service registered: ${capabilities.name}`);

      return {
        service: serviceConfig,
        health: health,
        discovered: true
      };

    } catch (error) {
      console.error(`❌ Service registration failed:`, error.message);
      throw error;
    }
  }

  /**
   * Update service capabilities (re-discover)
   * @param {string} serviceName - Service name
   * @returns {Promise<object>} Updated service
   */
  async updateServiceCapabilities(serviceName) {
    console.log(`🔄 Updating capabilities for ${serviceName}...`);

    try {
      // 1. Get existing service
      const service = this.configManager.getService(serviceName);
      if (!service) {
        throw new Error(`Service not found: ${serviceName}`);
      }

      // 2. Re-discover capabilities
      const capabilities = await this.discoverService(service.endpoint);

      // 3. Update service
      const updates = {
        version: capabilities.version,
        capabilities: capabilities.capabilities || {},
        actions: capabilities.actions,
        displayName: capabilities.displayName,
        description: capabilities.description || service.description
      };

      await this.configManager.updateService(serviceName, updates);

      console.log(`✅ Capabilities updated for ${serviceName}`);

      return {
        service: serviceName,
        updates: updates,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Failed to update capabilities for ${serviceName}:`, error.message);
      throw error;
    }
  }

  /**
   * Discover and validate multiple services
   * @param {Array<object>} services - Array of {endpoint, apiKey, options}
   * @returns {Promise<Array<object>>} Discovery results
   */
  async discoverMultiple(services) {
    console.log(`🔍 Discovering ${services.length} services...`);

    const results = await Promise.allSettled(
      services.map(({ endpoint, apiKey, options }) => 
        this.registerService(endpoint, apiKey, options)
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`✅ Discovery complete: ${successful} successful, ${failed} failed`);

    return results.map((result, index) => ({
      endpoint: services[index].endpoint,
      status: result.status,
      ...(result.status === 'fulfilled' 
        ? { service: result.value } 
        : { error: result.reason.message })
    }));
  }

  /**
   * Validate service compatibility
   * @param {object} capabilities - Service capabilities
   * @returns {object} Compatibility report
   */
  validateCompatibility(capabilities) {
    const report = {
      compatible: true,
      warnings: [],
      errors: []
    };

    // Check minimum version requirements
    const minVersion = '1.0.0';
    if (this.compareVersions(capabilities.version, minVersion) < 0) {
      report.warnings.push(`Service version ${capabilities.version} is below minimum ${minVersion}`);
    }

    // Check for required capabilities
    const requiredCapabilities = ['storage', 'retrieval']; // Example
    if (capabilities.capabilities) {
      const missing = requiredCapabilities.filter(
        cap => !capabilities.capabilities[cap]
      );
      if (missing.length > 0) {
        report.warnings.push(`Missing capabilities: ${missing.join(', ')}`);
      }
    }

    // Check action naming conventions
    const invalidActions = capabilities.actions.filter(
      action => !/^[a-z]+\.[a-z]+$/.test(action)
    );
    if (invalidActions.length > 0) {
      report.errors.push(`Invalid action names: ${invalidActions.join(', ')}`);
      report.compatible = false;
    }

    return report;
  }

  /**
   * Compare semantic versions
   * @param {string} v1 - Version 1
   * @param {string} v2 - Version 2
   * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }

    return 0;
  }

  /**
   * Schedule periodic health checks
   * @param {number} intervalMs - Check interval in milliseconds
   */
  startHealthMonitoring(intervalMs = 300000) { // 5 minutes default
    console.log(`🏥 Starting health monitoring (interval: ${intervalMs}ms)...`);

    this.healthCheckInterval = setInterval(async () => {
      const services = this.configManager.getEnabledServices();
      
      for (const service of services) {
        try {
          const health = await this.checkHealth(service.endpoint);
          
          // Update service health status
          await this.configManager.updateService(service.name, {
            healthStatus: health.status,
            lastHealthCheck: health.timestamp
          });

          // Increment consecutive failures if down
          if (health.status === 'down') {
            const current = service.consecutiveFailures || 0;
            await this.configManager.updateService(service.name, {
              consecutiveFailures: current + 1
            });

            // Disable service after 3 consecutive failures
            if (current + 1 >= 3) {
              console.warn(`⚠️ Disabling ${service.name} after 3 consecutive failures`);
              await this.configManager.disableService(service.name);
            }
          } else {
            // Reset consecutive failures on success
            await this.configManager.updateService(service.name, {
              consecutiveFailures: 0
            });
          }

        } catch (error) {
          console.error(`❌ Health check failed for ${service.name}:`, error.message);
        }
      }
    }, intervalMs);

    console.log('✅ Health monitoring started');
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('🛑 Health monitoring stopped');
    }
  }
}

module.exports = MCPServiceDiscovery;
