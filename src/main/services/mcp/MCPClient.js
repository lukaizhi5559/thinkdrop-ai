/**
 * MCP Client
 * 
 * HTTP client for communicating with MCP microservices.
 * Handles requests, retries, timeouts, and error handling.
 */

const axios = require('axios');
const { createRequest, createResponse, createError, ErrorCodes, isRetryableError } = require('./schemas/envelope.cjs');
const { MCPConfig } = require('./config.cjs');

class MCPClient {
  constructor(config = MCPConfig) {
    this.config = config;
    this.requestCache = new Map();
  }

  /**
   * Execute MCP request
   * @param {object} options - Request options
   * @returns {Promise<object>} Response data
   */
  async request(options) {
    const {
      service,
      action,
      payload = {},
      context = {},
      meta = {},
      sessionId = null,
      timeout = null,
      retries = null
    } = options;

    // Get service config
    const serviceConfig = this.config.services[this.getServiceKey(service)];
    if (!serviceConfig) {
      throw new Error(`Unknown service: ${service}`);
    }

    if (!serviceConfig.enabled) {
      throw new Error(`Service ${service} is disabled`);
    }

    // Create request envelope
    const requestEnvelope = createRequest({
      service,
      action,
      payload,
      context,
      meta,
      sessionId
    });

    // Execute with retries
    const maxRetries = retries !== null ? retries : serviceConfig.retries;
    const requestTimeout = timeout !== null ? timeout : serviceConfig.timeout;

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const response = await this.executeRequest(
          serviceConfig.endpoint,
          serviceConfig.apiKey,
          requestEnvelope,
          requestTimeout
        );
        const elapsedMs = Date.now() - startTime;

        // Add metrics
        response.metrics = response.metrics || {};
        response.metrics.elapsedMs = elapsedMs;

        return response;
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!isRetryableError(error) || attempt >= maxRetries) {
          throw error;
        }

        // Calculate retry delay with exponential backoff and jitter
        const delay = this.calculateRetryDelay(attempt);
        console.warn(`⚠️ MCP request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Execute HTTP request to service
   * @param {string} endpoint - Service endpoint
   * @param {string} apiKey - API key
   * @param {object} requestEnvelope - MCP request envelope
   * @param {number} timeout - Request timeout
   * @returns {Promise<object>} Response envelope
   */
  async executeRequest(endpoint, apiKey, requestEnvelope, timeout) {
    const url = `${endpoint}/${requestEnvelope.action}`;

    try {
      const response = await axios.post(url, requestEnvelope, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-Request-ID': requestEnvelope.requestId,
          'X-Trace-ID': requestEnvelope.meta.traceId
        },
        timeout,
        validateStatus: (status) => status < 600 // Don't throw on 4xx/5xx
      });

      // Handle non-200 responses
      if (response.status >= 400) {
        const errorData = response.data;
        throw createError({
          code: errorData.error?.code || ErrorCodes.INTERNAL_ERROR,
          message: errorData.error?.message || `HTTP ${response.status}`,
          retryable: response.status >= 500,
          details: { status: response.status, data: errorData }
        });
      }

      return response.data;
    } catch (error) {
      // Handle axios errors
      if (error.code === 'ECONNREFUSED') {
        throw createError({
          code: ErrorCodes.SERVICE_UNAVAILABLE,
          message: `Service unavailable: ${endpoint}`,
          retryable: true,
          details: { endpoint, originalError: error.message }
        });
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        throw createError({
          code: ErrorCodes.TIMEOUT,
          message: `Request timeout after ${timeout}ms`,
          retryable: true,
          details: { timeout, originalError: error.message }
        });
      }

      // Re-throw if already an MCP error
      if (error.code && error.message && error.retryable !== undefined) {
        throw error;
      }

      // Wrap unknown errors
      throw createError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: error.message || 'Unknown error',
        retryable: false,
        details: { originalError: error.toString() }
      });
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt - Attempt number (0-indexed)
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attempt) {
    const { initialDelay, maxDelay, backoffMultiplier, jitter } = this.config.retry;
    
    // Exponential backoff
    let delay = initialDelay * Math.pow(backoffMultiplier, attempt);
    delay = Math.min(delay, maxDelay);

    // Add jitter (±25%)
    if (jitter) {
      const jitterAmount = delay * 0.25;
      delay += (Math.random() * jitterAmount * 2) - jitterAmount;
    }

    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get service key from service name
   * @param {string} serviceName - Service name (user-memory, web-search, phi4)
   * @returns {string} Service key (userMemory, webSearch, phi4)
   */
  getServiceKey(serviceName) {
    const mapping = {
      'user-memory': 'userMemory',
      'web-search': 'webSearch',
      'phi4': 'phi4'
    };
    return mapping[serviceName] || serviceName;
  }

  /**
   * Check service health
   * @param {string} serviceName - Service name
   * @returns {Promise<object>} Health status
   */
  async checkHealth(serviceName) {
    const serviceConfig = this.config.services[this.getServiceKey(serviceName)];
    if (!serviceConfig) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    try {
      const response = await axios.get(`${serviceConfig.endpoint}/service.health`, {
        timeout: this.config.healthCheck.timeout,
        headers: {
          'Authorization': `Bearer ${serviceConfig.apiKey}`
        }
      });

      return response.data;
    } catch (error) {
      return {
        service: serviceName,
        status: 'down',
        error: error.message
      };
    }
  }

  /**
   * Get service capabilities
   * @param {string} serviceName - Service name
   * @returns {Promise<object>} Service capabilities
   */
  async getCapabilities(serviceName) {
    const serviceConfig = this.config.services[this.getServiceKey(serviceName)];
    if (!serviceConfig) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    try {
      const response = await axios.get(`${serviceConfig.endpoint}/service.capabilities`, {
        timeout: this.config.healthCheck.timeout,
        headers: {
          'Authorization': `Bearer ${serviceConfig.apiKey}`
        }
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get capabilities for ${serviceName}: ${error.message}`);
    }
  }

  /**
   * Batch request (execute multiple requests in parallel)
   * @param {array} requests - Array of request options
   * @returns {Promise<array>} Array of responses
   */
  async batchRequest(requests) {
    const promises = requests.map(req => this.request(req));
    return Promise.allSettled(promises);
  }
}

// Export singleton instance
let clientInstance = null;

function getClient(config = MCPConfig) {
  if (!clientInstance) {
    clientInstance = new MCPClient(config);
  }
  return clientInstance;
}

function resetClient() {
  clientInstance = null;
}

module.exports = {
  MCPClient,
  getClient,
  resetClient
};
