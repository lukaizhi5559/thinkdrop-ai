/**
 * MCP Circuit Breaker
 * 
 * Implements circuit breaker pattern to prevent cascading failures.
 * States: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery)
 */

const { MCPConfig } = require('./config.cjs');

const logger = require('./../../logger.cjs');
/**
 * Circuit Breaker States
 */
const CircuitState = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Failing, reject requests immediately
  HALF_OPEN: 'HALF_OPEN'  // Testing recovery, allow limited requests
};

class MCPCircuitBreaker {
  constructor(serviceName, config = MCPConfig) {
    this.serviceName = serviceName;
    this.config = config.circuitBreaker;
    
    // Circuit state
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    
    // Metrics
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.halfOpenAttempts = 0;
    
    // State change callbacks
    this.onStateChange = null;
  }

  /**
   * Execute function with circuit breaker protection
   * @param {function} fn - Async function to execute
   * @returns {Promise<any>} Function result
   */
  async execute(fn) {
    this.totalRequests += 1;

    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new Error(`Circuit breaker is OPEN for service: ${this.serviceName}`);
      }
    }

    // Check if we're in half-open state and limit requests
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenRequests) {
        throw new Error(`Circuit breaker is HALF_OPEN and max attempts reached for service: ${this.serviceName}`);
      }
      this.halfOpenAttempts += 1;
    }

    // Execute function
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  onSuccess() {
    this.totalSuccesses += 1;
    this.successCount += 1;

    if (this.state === CircuitState.HALF_OPEN) {
      // Check if we've had enough successes to close the circuit
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        this.reset();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed request
   */
  onFailure() {
    this.totalFailures += 1;
    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state reopens the circuit
      this.transitionTo(CircuitState.OPEN);
      this.successCount = 0;
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we've exceeded failure threshold
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Check if circuit should attempt reset
   * @returns {boolean}
   */
  shouldAttemptReset() {
    if (this.state !== CircuitState.OPEN) {
      return false;
    }

    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    return timeSinceLastFailure >= this.config.timeout;
  }

  /**
   * Transition to new state
   * @param {string} newState - New circuit state
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    logger.debug(`🔄 Circuit breaker for ${this.serviceName}: ${oldState} → ${newState}`);

    // Reset half-open attempts when entering half-open state
    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      this.successCount = 0;
    }

    // Trigger callback if set
    if (this.onStateChange) {
      this.onStateChange(oldState, newState, this.serviceName);
    }
  }

  /**
   * Reset circuit breaker
   */
  reset() {
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    logger.debug(`✅ Circuit breaker reset for ${this.serviceName}`);
  }

  /**
   * Force open the circuit
   */
  forceOpen() {
    this.transitionTo(CircuitState.OPEN);
    logger.debug(`⚠️ Circuit breaker forced OPEN for ${this.serviceName}`);
  }

  /**
   * Force close the circuit
   */
  forceClose() {
    this.transitionTo(CircuitState.CLOSED);
    this.reset();
    logger.debug(`✅ Circuit breaker forced CLOSED for ${this.serviceName}`);
  }

  /**
   * Get current state
   * @returns {string} Current circuit state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if circuit is open
   * @returns {boolean}
   */
  isOpen() {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Check if circuit is closed
   * @returns {boolean}
   */
  isClosed() {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Check if circuit is half-open
   * @returns {boolean}
   */
  isHalfOpen() {
    return this.state === CircuitState.HALF_OPEN;
  }

  /**
   * Get circuit breaker statistics
   * @returns {object} Statistics
   */
  getStats() {
    return {
      serviceName: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      failureRate: this.totalRequests > 0 
        ? (this.totalFailures / this.totalRequests) 
        : 0,
      successRate: this.totalRequests > 0 
        ? (this.totalSuccesses / this.totalRequests) 
        : 0,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      timeSinceLastFailure: this.lastFailureTime 
        ? Date.now() - this.lastFailureTime 
        : null,
      timeSinceLastStateChange: Date.now() - this.lastStateChange
    };
  }

  /**
   * Set state change callback
   * @param {function} callback - Callback function (oldState, newState, serviceName)
   */
  setStateChangeCallback(callback) {
    this.onStateChange = callback;
  }
}

/**
 * Circuit Breaker Manager
 * Manages circuit breakers for multiple services
 */
class CircuitBreakerManager {
  constructor(config = MCPConfig) {
    this.config = config;
    this.breakers = new Map();
  }

  /**
   * Get or create circuit breaker for service
   * @param {string} serviceName - Service name
   * @returns {MCPCircuitBreaker} Circuit breaker instance
   */
  getBreaker(serviceName) {
    if (!this.breakers.has(serviceName)) {
      const breaker = new MCPCircuitBreaker(serviceName, this.config);
      
      // Set up state change logging
      breaker.setStateChangeCallback((oldState, newState, service) => {
        logger.debug(`🔔 Circuit breaker state change: ${service} (${oldState} → ${newState})`);
      });
      
      this.breakers.set(serviceName, breaker);
    }
    return this.breakers.get(serviceName);
  }

  /**
   * Execute function with circuit breaker protection
   * @param {string} serviceName - Service name
   * @param {function} fn - Async function to execute
   * @returns {Promise<any>} Function result
   */
  async execute(serviceName, fn) {
    if (!this.config.circuitBreaker.enabled) {
      // Circuit breaker disabled, execute directly
      return await fn();
    }

    const breaker = this.getBreaker(serviceName);
    return await breaker.execute(fn);
  }

  /**
   * Get all circuit breakers
   * @returns {Map} Map of service name to circuit breaker
   */
  getAllBreakers() {
    return this.breakers;
  }

  /**
   * Get statistics for all circuit breakers
   * @returns {object} Statistics for all breakers
   */
  getAllStats() {
    const stats = {};
    this.breakers.forEach((breaker, serviceName) => {
      stats[serviceName] = breaker.getStats();
    });
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    this.breakers.forEach(breaker => {
      breaker.forceClose();
    });
    logger.debug('🔄 All circuit breakers reset');
  }

  /**
   * Remove circuit breaker for service
   * @param {string} serviceName - Service name
   */
  removeBreaker(serviceName) {
    this.breakers.delete(serviceName);
  }

  /**
   * Clear all circuit breakers
   */
  clear() {
    this.breakers.clear();
  }
}

// Export singleton instance
let managerInstance = null;

function getCircuitBreakerManager(config = MCPConfig) {
  if (!managerInstance) {
    managerInstance = new CircuitBreakerManager(config);
  }
  return managerInstance;
}

function resetCircuitBreakerManager() {
  if (managerInstance) {
    managerInstance.clear();
  }
  managerInstance = null;
}

module.exports = {
  MCPCircuitBreaker,
  CircuitBreakerManager,
  CircuitState,
  getCircuitBreakerManager,
  resetCircuitBreakerManager
};
