/**
 * Base Agent class for ThinkDrop AI agent-to-agent communication system
 * Provides bootstrap, lifecycle management, and standardized execution interface
 */

const logger = require('./../../logger.cjs');
export class Agent {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.initialized = false;
    this.available = false;
    this.dependencies = [];
    this.lastError = null;
    this.bootstrapTime = null;
  }

  /**
   * Bootstrap the agent - handle setup, dependencies, database connections, etc.
   * This is called lazily on first use or during preload for critical agents
   * @param {Object} globalConfig - Global system configuration
   * @param {Object} context - Shared context bus
   * @returns {Promise<boolean>} - Success status
   */
  async bootstrap(globalConfig = {}, context = {}) {
    try {
      logger.debug(`🚀 Bootstrapping agent: ${this.name}`);
      const startTime = Date.now();
      
      // Merge global config with agent-specific config
      const mergedConfig = this.mergeConfig(globalConfig, this.config);
      
      // Initialize dependencies
      await this.initializeDependencies(mergedConfig, context);
      
      // Agent-specific setup (override in subclasses)
      await this.setup(mergedConfig, context);
      
      this.initialized = true;
      this.available = true;
      this.bootstrapTime = Date.now() - startTime;
      this.lastError = null;
      
      logger.debug(`✅ Agent ${this.name} bootstrapped successfully in ${this.bootstrapTime}ms`);
      return true;
      
    } catch (error) {
      logger.error(`❌ Failed to bootstrap agent ${this.name}:`, error);
      this.lastError = error;
      this.available = false;
      return false;
    }
  }

  /**
   * Execute an action on this agent
   * @param {Object} params - Parameters including action and data
   * @param {Object} context - Shared context bus
   * @returns {Promise<Object>} - Execution result
   */
  async execute(params, context = {}) {
    try {
      // Ensure agent is bootstrapped
      if (!this.initialized) {
        const bootstrapped = await this.bootstrap(context.globalConfig, context);
        if (!bootstrapped) {
          throw new Error(`Agent ${this.name} failed to bootstrap`);
        }
      }

      if (!this.available) {
        throw new Error(`Agent ${this.name} is not available (last error: ${this.lastError?.message})`);
      }

      const { action } = params;
      logger.debug(`🎯 Agent ${this.name} executing action: ${action}`);
      
      // Delegate to action handler (implemented in subclasses)
      const result = await this.handleAction(params, context);
      
      return {
        success: true,
        agent: this.name,
        action,
        result,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error(`❌ Agent ${this.name} execution failed:`, error);
      return {
        success: false,
        agent: this.name,
        action: params.action,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Handle specific action - override in subclasses
   * @param {Object} params - Action parameters
   * @param {Object} context - Shared context
   * @returns {Promise<any>} - Action result
   */
  async handleAction(params, context) {
    throw new Error(`Agent ${this.name} must implement handleAction method`);
  }

  /**
   * Agent-specific setup - override in subclasses
   * @param {Object} config - Merged configuration
   * @param {Object} context - Shared context
   */
  async setup(config, context) {
    // Override in subclasses for agent-specific initialization
  }

  /**
   * Initialize dependencies based on agent configuration
   * @param {Object} config - Merged configuration
   * @param {Object} context - Shared context
   */
  async initializeDependencies(config, context) {
    if (this.dependencies && this.dependencies.length > 0) {
      logger.debug(`📦 Loading dependencies for ${this.name}:`, this.dependencies);
      
      for (const dep of this.dependencies) {
        try {
          // Dynamic import for ES modules or require for CommonJS
          if (dep.startsWith('node:') || ['fs', 'path', 'crypto'].includes(dep)) {
            // Node.js built-in modules
            await import(dep);
          } else {
            // External packages
            require(dep);
          }
        } catch (error) {
          logger.warn(`⚠️ Failed to load dependency ${dep} for ${this.name}:`, error.message);
        }
      }
    }
  }

  /**
   * Merge global and agent-specific configuration
   * @param {Object} globalConfig - Global configuration
   * @param {Object} agentConfig - Agent-specific configuration
   * @returns {Object} - Merged configuration
   */
  mergeConfig(globalConfig, agentConfig) {
    return {
      ...globalConfig.global,
      ...globalConfig.agents?.[this.name],
      ...agentConfig
    };
  }

  /**
   * Get agent status and metadata
   * @returns {Object} - Agent status
   */
  getStatus() {
    return {
      name: this.name,
      initialized: this.initialized,
      available: this.available,
      bootstrapTime: this.bootstrapTime,
      lastError: this.lastError?.message,
      dependencies: this.dependencies
    };
  }

  /**
   * Cleanup agent resources
   */
  async cleanup() {
    logger.debug(`🧹 Cleaning up agent: ${this.name}`);
    this.initialized = false;
    this.available = false;
  }

  /**
   * Retry bootstrap after failure
   * @param {Object} globalConfig - Global configuration
   * @param {Object} context - Shared context
   * @returns {Promise<boolean>} - Success status
   */
  async retry(globalConfig, context) {
    logger.debug(`🔄 Retrying bootstrap for agent: ${this.name}`);
    this.lastError = null;
    return this.bootstrap(globalConfig, context);
  }
}

/**
 * Shared AgentContext structure for inter-agent communication
 */
export class AgentContext {
  constructor(initialData = {}) {
    this.userMemory = initialData.userMemory || {};
    this.systemTime = new Date();
    this.activeAgents = initialData.activeAgents || [];
    this.priorResults = initialData.priorResults || {};
    this.metadata = initialData.metadata || {};
    this.globalConfig = initialData.globalConfig || {};
    
    // Scoped data with access policies
    this.scopes = {
      global: {},      // Available to all agents
      agentLocal: {},  // Agent-specific data
      transient: {}    // Temporary data cleared after execution
    };
  }

  /**
   * Add result from an agent execution
   * @param {string} agentName - Name of the agent
   * @param {string} action - Action that was executed
   * @param {any} result - Result data
   */
  addResult(agentName, action, result) {
    if (!this.priorResults[agentName]) {
      this.priorResults[agentName] = {};
    }
    this.priorResults[agentName][action] = {
      result,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get result from a previous agent execution
   * @param {string} agentName - Name of the agent
   * @param {string} action - Action that was executed
   * @returns {any} - Result data or null
   */
  getResult(agentName, action) {
    return this.priorResults[agentName]?.[action]?.result || null;
  }

  /**
   * Clear transient data
   */
  clearTransient() {
    this.scopes.transient = {};
  }

  /**
   * Set scoped data with access policy
   * @param {string} scope - 'global', 'agentLocal', or 'transient'
   * @param {string} key - Data key
   * @param {any} value - Data value
   * @param {string} agentName - Agent name (for agentLocal scope)
   */
  setScoped(scope, key, value, agentName = null) {
    if (scope === 'agentLocal' && agentName) {
      if (!this.scopes.agentLocal[agentName]) {
        this.scopes.agentLocal[agentName] = {};
      }
      this.scopes.agentLocal[agentName][key] = value;
    } else {
      this.scopes[scope][key] = value;
    }
  }

  /**
   * Get scoped data
   * @param {string} scope - 'global', 'agentLocal', or 'transient'
   * @param {string} key - Data key
   * @param {string} agentName - Agent name (for agentLocal scope)
   * @returns {any} - Data value or null
   */
  getScoped(scope, key, agentName = null) {
    if (scope === 'agentLocal' && agentName) {
      return this.scopes.agentLocal[agentName]?.[key] || null;
    }
    return this.scopes[scope][key] || null;
  }
}
