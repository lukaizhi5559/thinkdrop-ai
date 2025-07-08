/**
 * Secure Agent Sandbox using Node.js vm
 * Provides secure execution environment for agent code with strict capability controls
 */

import vm from 'vm';
import crypto from 'crypto';
import { performance } from 'perf_hooks';

export class AgentSandbox {
  constructor(options = {}) {
    this.memoryLimit = options.memoryLimit || 128; // MB (for monitoring)
    this.timeoutMs = options.timeoutMs || 30000; // 30 seconds
    this.allowedCapabilities = new Set(options.allowedCapabilities || [
      'console.log',
      'JSON.parse',
      'JSON.stringify',
      'Date.now',
      'Math.*'
    ]);
    
    // Track active contexts for cleanup
    this.activeContexts = new Map();
    
    console.log('🔒 AgentSandbox initialized with Node.js vm isolation');
  }

  /**
   * Execute agent code in secure sandbox using Node.js vm
   */
  async executeAgent(agentCode, agentName, params, context) {
    const executionId = crypto.randomUUID();
    let vmContext = null;
    
    try {
      console.log(`🔒 Creating secure VM sandbox for agent: ${agentName}`);
      
      // Perform security analysis
      const securityCheck = this.analyzeCodeSecurity(agentCode);
      if (!securityCheck.safe) {
        throw new Error(`Security violation: ${securityCheck.violations.join(', ')}`);
      }
      
      // Create secure sandbox context
      const sandbox = this.createSecureSandbox(context);
      vmContext = vm.createContext(sandbox);
      this.activeContexts.set(executionId, vmContext);
      
      // Prepare agent execution wrapper
      const wrappedCode = this.wrapAgentCode(agentCode, agentName, params, context);
      
      // Execute with timeout using vm.runInContext
      const result = await this.executeWithTimeout(wrappedCode, vmContext, this.timeoutMs);
      
      console.log(`✅ Agent ${agentName} executed successfully in VM sandbox`);
      return result;
      
    } catch (error) {
      console.error(`❌ VM sandbox execution failed for ${agentName}:`, error.message);
      
      return {
        success: false,
        error: error.message,
        errorType: this.categorizeError(error),
        executionId
      };
      
    } finally {
      // Cleanup context
      if (this.activeContexts.has(executionId)) {
        try {
          this.activeContexts.delete(executionId);
        } catch (cleanupError) {
          console.warn(`⚠️ Failed to cleanup context ${executionId}:`, cleanupError.message);
        }
      }
    }
  }

  /**
   * Analyze code for security violations
   */
  analyzeCodeSecurity(code) {
    const violations = [];
    const dangerousPatterns = [
      { pattern: /eval\s*\(/g, message: 'eval() is not allowed' },
      { pattern: /Function\s*\(/g, message: 'Function constructor is not allowed' },
      { pattern: /require\s*\(['"]child_process['"]/g, message: 'child_process module is not allowed' },
      { pattern: /require\s*\(['"]fs['"]/g, message: 'fs module is not allowed' },
      { pattern: /require\s*\(['"]net['"]/g, message: 'net module is not allowed' },
      { pattern: /require\s*\(['"]http['"]/g, message: 'http module is not allowed' },
      { pattern: /process\./g, message: 'process object access is not allowed' },
      { pattern: /global\./g, message: 'global object access is not allowed' },
      { pattern: /__dirname/g, message: '__dirname access is not allowed' },
      { pattern: /__filename/g, message: '__filename access is not allowed' }
    ];
    
    dangerousPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(code)) {
        violations.push(message);
      }
    });
    
    return {
      safe: violations.length === 0,
      violations
    };
  }

  /**
   * Create secure sandbox context with restricted globals
   */
  createSecureSandbox(context) {
    // Create database proxy for secure access
    const databaseProxy = this.createDatabaseProxy(context.database);
    
    return {
      // Safe globals
      console: {
        log: (...args) => console.log(`[AGENT]`, ...args),
        error: (...args) => console.error(`[AGENT]`, ...args),
        warn: (...args) => console.warn(`[AGENT]`, ...args)
      },
      JSON: {
        parse: JSON.parse,
        stringify: JSON.stringify
      },
      Date: Date,
      Math: Math,
      
      // Agent context
      database: databaseProxy,
      agentName: context.agentName,
      timestamp: context.timestamp,
      
      // Module system
      module: { exports: {} },
      exports: {},
      
      // Restricted require - only allow safe modules
      require: this.createSecureRequire(),
      
      // Promise support
      Promise: Promise,
      
      // Prevent access to dangerous globals
      global: undefined,
      process: undefined,
      Buffer: undefined,
      __dirname: undefined,
      __filename: undefined
    };
  }

  /**
   * Create secure database proxy
   */
  createDatabaseProxy(database) {
    if (!database) return null;
    
    return {
      prepare: (sql) => {
        // Only allow safe SQL operations
        if (this.isSafeSQLQuery(sql)) {
          return database.prepare(sql);
        }
        throw new Error('Unsafe SQL query blocked by sandbox');
      },
      exec: (sql) => {
        if (this.isSafeSQLQuery(sql)) {
          return database.exec(sql);
        }
        throw new Error('Unsafe SQL query blocked by sandbox');
      }
    };
  }

  /**
   * Create secure require function
   */
  createSecureRequire() {
    const allowedModules = new Set([
      'crypto',
      'util'
    ]);
    
    return (moduleName) => {
      if (allowedModules.has(moduleName)) {
        return require(moduleName);
      }
      throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
    };
  }

  /**
   * Check if SQL query is safe
   */
  isSafeSQLQuery(sql) {
    const dangerousPatterns = [
      /DROP\s+TABLE/i,
      /DELETE\s+FROM/i,
      /TRUNCATE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+TABLE/i,
      /PRAGMA/i
    ];
    
    return !dangerousPatterns.some(pattern => pattern.test(sql));
  }

  /**
   * Execute code with timeout
   */
  async executeWithTimeout(code, context, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      try {
        const result = vm.runInContext(code, context);
        clearTimeout(timer);
        
        // Handle both sync and async results
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          resolve(result);
        }
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Wrap agent code with execution framework
   */
  wrapAgentCode(agentCode, agentName, params, context) {
    return `
      (async function() {
        try {
          // Agent code execution wrapper
          const module = { exports: {} };
          const exports = module.exports;
          
          // Execute agent code to define the agent
          ${agentCode}
          
          // Validate agent exports
          if (!module.exports || typeof module.exports.execute !== 'function') {
            throw new Error('Agent must export an execute function');
          }
          
          // Execute the agent function within sandbox
          const params = ${JSON.stringify(params)};
          const context = ${JSON.stringify(context, (key, value) => {
            // Don't serialize database connection - will be provided via secure API
            if (key === 'database') return undefined;
            return value;
          })};
          
          const result = await module.exports.execute(params, {
            ...context,
            database: database // Use sandboxed database proxy
          });
          
          return {
            success: true,
            ...result
          };
          
        } catch (error) {
          return {
            success: false,
            error: error.message,
            stack: error.stack
          };
        }
      })();
    `;
  }

  /**
   * Categorize error types
   */
  categorizeError(error) {
    if (error.message.includes('timeout')) return 'TIMEOUT';
    if (error.message.includes('Security violation')) return 'SECURITY';
    if (error.message.includes('not allowed')) return 'PERMISSION';
    if (error.message.includes('memory')) return 'MEMORY';
    return 'RUNTIME';
  }

  /**
   * Cleanup all active contexts
   */
  async cleanup() {
    console.log('🧹 Cleaning up AgentSandbox...');
    
    for (const [executionId, context] of this.activeContexts) {
      try {
        // VM contexts are automatically garbage collected
        this.activeContexts.delete(executionId);
      } catch (error) {
        console.warn(`⚠️ Failed to cleanup context ${executionId}:`, error.message);
      }
    }
    
    this.activeContexts.clear();
    console.log('✅ AgentSandbox cleanup completed');
  }

  /**
   * Get sandbox statistics
   */
  getStats() {
    return {
      activeContexts: this.activeContexts.size,
      memoryLimit: this.memoryLimit,
      timeoutMs: this.timeoutMs,
      allowedCapabilities: Array.from(this.allowedCapabilities)
    };
  }
}
