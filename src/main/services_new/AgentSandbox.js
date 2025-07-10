/**
 * AgentSandbox - Secure execution container for dynamic agents
 * Provides isolated runtime environment for downloaded agent code
 */

import { Worker } from 'worker_threads';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AgentSandbox {
  constructor(options = {}) {
    this.maxExecutionTime = options.maxExecutionTime || 30000; // 30 seconds
    this.maxMemory = options.maxMemory || 128 * 1024 * 1024; // 128MB
    this.logger = options.logger || console;
    this.activeWorkers = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      this.logger.info('🔒 Initializing AgentSandbox...');
      
      // Verify sandbox worker script exists
      this.workerScript = path.join(__dirname, 'sandbox-worker.js');
      
      this.isInitialized = true;
      this.logger.info('✅ AgentSandbox initialized with security constraints');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize AgentSandbox:', error);
      throw error;
    }
  }

  /**
   * Create a sandboxed agent from agent data
   */
  async createAgent(agentData) {
    if (!this.isInitialized) {
      throw new Error('AgentSandbox not initialized');
    }

    try {
      // Validate agent data
      this.validateAgentData(agentData);
      
      // Create agent hash for tracking
      const agentHash = this.createAgentHash(agentData);
      
      // Create sandboxed agent wrapper
      const sandboxedAgent = {
        name: agentData.name,
        hash: agentHash,
        execute: async (input, context) => {
          return await this.executeAgent(agentData, input, context);
        },
        cleanup: async () => {
          await this.cleanupAgent(agentHash);
        }
      };
      
      this.logger.info(`🔒 Created sandboxed agent: ${agentData.name}`);
      return sandboxedAgent;
      
    } catch (error) {
      this.logger.error(`Failed to create sandboxed agent: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute agent code in secure sandbox
   */
  async executeAgent(agentData, input, context) {
    const agentHash = this.createAgentHash(agentData);
    
    return new Promise((resolve, reject) => {
      try {
        // Create worker for isolated execution
        const worker = new Worker(this.workerScript, {
          workerData: {
            agentCode: agentData.code,
            agentName: agentData.name,
            input,
            context: this.sanitizeContext(context),
            config: agentData.config || {}
          },
          resourceLimits: {
            maxOldGenerationSizeMb: this.maxMemory / (1024 * 1024),
            maxYoungGenerationSizeMb: 32
          }
        });

        // Track active worker
        this.activeWorkers.set(agentHash, worker);

        // Set execution timeout
        const timeout = setTimeout(() => {
          worker.terminate();
          this.activeWorkers.delete(agentHash);
          reject(new Error(`Agent execution timeout after ${this.maxExecutionTime}ms`));
        }, this.maxExecutionTime);

        // Handle worker messages
        worker.on('message', (result) => {
          clearTimeout(timeout);
          this.activeWorkers.delete(agentHash);
          
          if (result.success) {
            resolve(result.data);
          } else {
            reject(new Error(result.error));
          }
        });

        // Handle worker errors
        worker.on('error', (error) => {
          clearTimeout(timeout);
          this.activeWorkers.delete(agentHash);
          reject(new Error(`Worker error: ${error.message}`));
        });

        // Handle worker exit
        worker.on('exit', (code) => {
          clearTimeout(timeout);
          this.activeWorkers.delete(agentHash);
          
          if (code !== 0) {
            reject(new Error(`Worker exited with code ${code}`));
          }
        });

      } catch (error) {
        reject(new Error(`Failed to start worker: ${error.message}`));
      }
    });
  }

  /**
   * Validate agent data before execution
   */
  validateAgentData(agentData) {
    if (!agentData) {
      throw new Error('Agent data is required');
    }
    
    if (!agentData.name) {
      throw new Error('Agent name is required');
    }
    
    if (!agentData.code) {
      throw new Error('Agent code is required');
    }
    
    // Check for dangerous patterns
    const dangerousPatterns = [
      /require\s*\(\s*['"]fs['"]/, // File system access
      /require\s*\(\s*['"]child_process['"]/, // Process execution
      /require\s*\(\s*['"]net['"]/, // Network access
      /require\s*\(\s*['"]http['"]/, // HTTP access
      /eval\s*\(/, // Code evaluation
      /Function\s*\(/, // Dynamic function creation
      /process\./, // Process access
      /global\./, // Global object access
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(agentData.code)) {
        throw new Error(`Agent code contains dangerous pattern: ${pattern.source}`);
      }
    }
    
    this.logger.info(`✅ Agent ${agentData.name} passed security validation`);
  }

  /**
   * Create unique hash for agent
   */
  createAgentHash(agentData) {
    const content = JSON.stringify({
      name: agentData.name,
      code: agentData.code,
      config: agentData.config
    });
    
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Sanitize context to remove sensitive data
   */
  sanitizeContext(context) {
    const sanitized = { ...context };
    
    // Remove sensitive fields
    delete sanitized.database;
    delete sanitized.llmClient;
    delete sanitized.apiKeys;
    delete sanitized.secrets;
    
    // Limit context size
    const contextString = JSON.stringify(sanitized);
    if (contextString.length > 10000) { // 10KB limit
      this.logger.warn('Context too large, truncating...');
      return { truncated: true, message: 'Context truncated for security' };
    }
    
    return sanitized;
  }

  /**
   * Cleanup specific agent
   */
  async cleanupAgent(agentHash) {
    const worker = this.activeWorkers.get(agentHash);
    if (worker) {
      await worker.terminate();
      this.activeWorkers.delete(agentHash);
      this.logger.info(`🧹 Cleaned up agent: ${agentHash}`);
    }
  }

  /**
   * Get sandbox status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      activeWorkers: this.activeWorkers.size,
      maxExecutionTime: this.maxExecutionTime,
      maxMemory: this.maxMemory
    };
  }

  /**
   * Emergency stop all workers
   */
  async emergencyStop() {
    this.logger.warn('🚨 Emergency stop - terminating all workers');
    
    const terminationPromises = Array.from(this.activeWorkers.values()).map(worker => 
      worker.terminate()
    );
    
    await Promise.all(terminationPromises);
    this.activeWorkers.clear();
    
    this.logger.info('✅ All workers terminated');
  }

  /**
   * Cleanup and shutdown sandbox
   */
  async cleanup() {
    this.logger.info('🛑 Shutting down AgentSandbox...');
    
    // Terminate all active workers
    await this.emergencyStop();
    
    this.isInitialized = false;
    this.logger.info('✅ AgentSandbox shutdown complete');
  }
}
