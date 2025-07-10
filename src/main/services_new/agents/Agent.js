/**
 * Agent - Base interface for all agents in the system
 * Defines the standard agent-to-agent communication protocol
 */

export class Agent {
  constructor(options = {}) {
    this.name = this.constructor.name;
    this.logger = options.logger || console;
    this.initialized = false;
  }

  /**
   * Initialize the agent (optional)
   * Override in subclasses if initialization is needed
   */
  async initialize() {
    this.initialized = true;
    this.logger.info(`✅ ${this.name} initialized`);
  }

  /**
   * Main execution method - must be implemented by all agents
   * @param {Object} input - Input data for the agent
   * @param {Object} context - Execution context including previous results
   * @returns {Promise<Object>} - Agent execution result
   */
  async execute(input, context) {
    throw new Error(`${this.name} must implement execute() method`);
  }

  /**
   * Cleanup method (optional)
   * Override in subclasses if cleanup is needed
   */
  async cleanup() {
    this.logger.info(`🧹 ${this.name} cleanup complete`);
  }

  /**
   * Get agent metadata
   */
  getMetadata() {
    return {
      name: this.name,
      initialized: this.initialized,
      capabilities: this.getCapabilities(),
      version: this.getVersion()
    };
  }

  /**
   * Get agent capabilities (override in subclasses)
   */
  getCapabilities() {
    return [];
  }

  /**
   * Get agent version (override in subclasses)
   */
  getVersion() {
    return '1.0.0';
  }
}

/**
 * AgentInput interface definition
 */
export class AgentInput {
  constructor(data = {}) {
    this.message = data.message || '';
    this.intent = data.intent || '';
    this.context = data.context || {};
    this.metadata = data.metadata || {};
  }
}

/**
 * AgentOutput interface definition
 */
export class AgentOutput {
  constructor(data = {}) {
    this.success = data.success !== false;
    this.result = data.result || null;
    this.error = data.error || null;
    this.metadata = data.metadata || {};
    this.nextAgent = data.nextAgent || null;
  }
}

/**
 * ExecutionContext interface definition
 */
export class ExecutionContext {
  constructor(data = {}) {
    this.sessionId = data.sessionId || '';
    this.userId = data.userId || '';
    this.timestamp = data.timestamp || new Date().toISOString();
    this.previousResults = data.previousResults || [];
    this.userInput = data.userInput || '';
    this.intentResult = data.intentResult || null;
    this.planResult = data.planResult || null;
    this.metadata = data.metadata || {};
  }
}
