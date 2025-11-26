/**
 * MCP Metrics
 * 
 * Collects and reports metrics for MCP service requests.
 * Provides structured logging and performance tracking.
 */

const { MCPConfig } = require('./config.cjs');

const logger = require('./../../logger.cjs');
class MCPMetrics {
  constructor(config = MCPConfig) {
    this.config = config.metrics;
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        error: 0,
        byService: {},
        byAction: {}
      },
      latency: {
        total: [],
        byService: {},
        byAction: {}
      },
      errors: {
        total: 0,
        byCode: {},
        byService: {}
      },
      circuitBreaker: {
        opens: 0,
        closes: 0,
        halfOpens: 0,
        byService: {}
      }
    };
    
    this.requestHistory = [];
    this.maxHistorySize = 1000;
    
    // Start periodic metrics collection if enabled
    if (this.config.enabled && this.config.collectInterval) {
      this.startPeriodicCollection();
    }
  }

  /**
   * Record a request
   * @param {object} requestInfo - Request information
   */
  recordRequest(requestInfo) {
    const {
      service,
      action,
      requestId,
      traceId,
      status,
      elapsedMs,
      error = null,
      userId = null,
      sessionId = null
    } = requestInfo;

    // Update total counts
    this.metrics.requests.total += 1;
    if (status === 'ok') {
      this.metrics.requests.success += 1;
    } else {
      this.metrics.requests.error += 1;
      this.metrics.errors.total += 1;
    }

    // Update by service
    if (!this.metrics.requests.byService[service]) {
      this.metrics.requests.byService[service] = { total: 0, success: 0, error: 0 };
    }
    this.metrics.requests.byService[service].total += 1;
    if (status === 'ok') {
      this.metrics.requests.byService[service].success += 1;
    } else {
      this.metrics.requests.byService[service].error += 1;
    }

    // Update by action
    const actionKey = `${service}.${action}`;
    if (!this.metrics.requests.byAction[actionKey]) {
      this.metrics.requests.byAction[actionKey] = { total: 0, success: 0, error: 0 };
    }
    this.metrics.requests.byAction[actionKey].total += 1;
    if (status === 'ok') {
      this.metrics.requests.byAction[actionKey].success += 1;
    } else {
      this.metrics.requests.byAction[actionKey].error += 1;
    }

    // Record latency
    if (elapsedMs !== undefined && elapsedMs !== null) {
      this.metrics.latency.total.push(elapsedMs);
      
      if (!this.metrics.latency.byService[service]) {
        this.metrics.latency.byService[service] = [];
      }
      this.metrics.latency.byService[service].push(elapsedMs);
      
      if (!this.metrics.latency.byAction[actionKey]) {
        this.metrics.latency.byAction[actionKey] = [];
      }
      this.metrics.latency.byAction[actionKey].push(elapsedMs);
    }

    // Record error details
    if (error) {
      const errorCode = error.code || 'UNKNOWN';
      this.metrics.errors.byCode[errorCode] = (this.metrics.errors.byCode[errorCode] || 0) + 1;
      
      if (!this.metrics.errors.byService[service]) {
        this.metrics.errors.byService[service] = 0;
      }
      this.metrics.errors.byService[service] += 1;
    }

    // Add to request history
    this.requestHistory.push({
      timestamp: new Date().toISOString(),
      service,
      action,
      requestId,
      traceId,
      status,
      elapsedMs,
      error: error ? { code: error.code, message: error.message } : null,
      userId,
      sessionId
    });

    // Trim history if too large
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory = this.requestHistory.slice(-this.maxHistorySize);
    }

    // Log request
    this.logRequest(requestInfo);
  }

  /**
   * Record circuit breaker state change
   * @param {string} service - Service name
   * @param {string} oldState - Old state
   * @param {string} newState - New state
   */
  recordCircuitBreakerStateChange(service, oldState, newState) {
    if (newState === 'OPEN') {
      this.metrics.circuitBreaker.opens += 1;
    } else if (newState === 'CLOSED') {
      this.metrics.circuitBreaker.closes += 1;
    } else if (newState === 'HALF_OPEN') {
      this.metrics.circuitBreaker.halfOpens += 1;
    }

    if (!this.metrics.circuitBreaker.byService[service]) {
      this.metrics.circuitBreaker.byService[service] = {
        opens: 0,
        closes: 0,
        halfOpens: 0
      };
    }

    if (newState === 'OPEN') {
      this.metrics.circuitBreaker.byService[service].opens += 1;
    } else if (newState === 'CLOSED') {
      this.metrics.circuitBreaker.byService[service].closes += 1;
    } else if (newState === 'HALF_OPEN') {
      this.metrics.circuitBreaker.byService[service].halfOpens += 1;
    }

    // Log state change
    this.log('warn', 'Circuit breaker state change', {
      service,
      oldState,
      newState
    });
  }

  /**
   * Log request
   * @param {object} requestInfo - Request information
   */
  logRequest(requestInfo) {
    if (!this.config.enabled) return;

    const {
      service,
      action,
      requestId,
      traceId,
      status,
      elapsedMs,
      error,
      userId,
      sessionId
    } = requestInfo;

    const level = status === 'ok' ? 'info' : 'error';
    const message = status === 'ok' 
      ? `MCP request succeeded: ${service}.${action}`
      : `MCP request failed: ${service}.${action}`;

    this.log(level, message, {
      service,
      action,
      requestId,
      traceId,
      status,
      elapsedMs,
      error: error ? { code: error.code, message: error.message } : null,
      userId,
      sessionId
    });
  }

  /**
   * Log message
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {string} message - Log message
   * @param {object} data - Additional data
   */
  log(level, message, data = {}) {
    if (!this.config.enabled) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data
    };

    if (this.config.logFormat === 'json') {
      logger.debug(JSON.stringify(logEntry));
    } else {
      const prefix = `[${logEntry.timestamp}] [${level.toUpperCase()}]`;
      logger.debug(`${prefix} ${message}`, data);
    }
  }

  /**
   * Calculate percentile
   * @param {array} values - Array of numbers
   * @param {number} percentile - Percentile (0-100)
   * @returns {number} Percentile value
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Calculate average
   * @param {array} values - Array of numbers
   * @returns {number} Average value
   */
  calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Get latency statistics
   * @param {array} values - Latency values
   * @returns {object} Latency statistics
   */
  getLatencyStats(values) {
    if (values.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: this.calculateAverage(values),
      p50: this.calculatePercentile(values, 50),
      p95: this.calculatePercentile(values, 95),
      p99: this.calculatePercentile(values, 99)
    };
  }

  /**
   * Get current metrics
   * @returns {object} Current metrics
   */
  getMetrics() {
    return {
      requests: {
        total: this.metrics.requests.total,
        success: this.metrics.requests.success,
        error: this.metrics.requests.error,
        successRate: this.metrics.requests.total > 0 
          ? (this.metrics.requests.success / this.metrics.requests.total) 
          : 0,
        errorRate: this.metrics.requests.total > 0 
          ? (this.metrics.requests.error / this.metrics.requests.total) 
          : 0,
        byService: this.metrics.requests.byService,
        byAction: this.metrics.requests.byAction
      },
      latency: {
        overall: this.getLatencyStats(this.metrics.latency.total),
        byService: Object.fromEntries(
          Object.entries(this.metrics.latency.byService).map(([service, values]) => [
            service,
            this.getLatencyStats(values)
          ])
        ),
        byAction: Object.fromEntries(
          Object.entries(this.metrics.latency.byAction).map(([action, values]) => [
            action,
            this.getLatencyStats(values)
          ])
        )
      },
      errors: {
        total: this.metrics.errors.total,
        byCode: this.metrics.errors.byCode,
        byService: this.metrics.errors.byService
      },
      circuitBreaker: this.metrics.circuitBreaker
    };
  }

  /**
   * Get request history
   * @param {number} limit - Maximum number of requests to return
   * @returns {array} Request history
   */
  getRequestHistory(limit = 100) {
    return this.requestHistory.slice(-limit);
  }

  /**
   * Get metrics summary
   * @returns {object} Metrics summary
   */
  getSummary() {
    const metrics = this.getMetrics();
    return {
      totalRequests: metrics.requests.total,
      successRate: (metrics.requests.successRate * 100).toFixed(2) + '%',
      errorRate: (metrics.requests.errorRate * 100).toFixed(2) + '%',
      avgLatency: Math.round(metrics.latency.overall.avg) + 'ms',
      p95Latency: Math.round(metrics.latency.overall.p95) + 'ms',
      totalErrors: metrics.errors.total,
      circuitBreakerOpens: metrics.circuitBreaker.opens
    };
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        error: 0,
        byService: {},
        byAction: {}
      },
      latency: {
        total: [],
        byService: {},
        byAction: {}
      },
      errors: {
        total: 0,
        byCode: {},
        byService: {}
      },
      circuitBreaker: {
        opens: 0,
        closes: 0,
        halfOpens: 0,
        byService: {}
      }
    };
    this.requestHistory = [];
    logger.debug('🔄 MCP metrics reset');
  }

  /**
   * Start periodic metrics collection
   */
  startPeriodicCollection() {
    if (this.collectionInterval) return;

    logger.debug(`📊 Starting periodic metrics collection (interval: ${this.config.collectInterval}ms)`);

    this.collectionInterval = setInterval(() => {
      this.collectAndLog();
    }, this.config.collectInterval);
  }

  /**
   * Stop periodic metrics collection
   */
  stopPeriodicCollection() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      logger.debug('🛑 Stopped periodic metrics collection');
    }
  }

  /**
   * Collect and log current metrics
   */
  collectAndLog() {
    const summary = this.getSummary();
    this.log('info', 'MCP Metrics Summary', summary);
  }
}

// Export singleton instance
let metricsInstance = null;

function getMetrics(config = MCPConfig) {
  if (!metricsInstance) {
    metricsInstance = new MCPMetrics(config);
  }
  return metricsInstance;
}

function resetMetrics() {
  if (metricsInstance) {
    metricsInstance.stopPeriodicCollection();
  }
  metricsInstance = null;
}

module.exports = {
  MCPMetrics,
  getMetrics,
  resetMetrics
};
