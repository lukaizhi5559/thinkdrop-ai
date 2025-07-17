/**
 * AgentFormat interface and template for ThinkDrop AI agents
 * Standardizes agent structure, metadata, and execution patterns
 */

import { Agent } from './Agent.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @typedef {Object} AgentFormat
 * @property {string} name - Agent name
 * @property {string} description - Description of agent's purpose
 * @property {Object} schema - JSON schema for input parameters
 * @property {string[]} dependencies - Required npm modules/dependencies
 * @property {'frontend'|'backend'} execution_target - Where agent runs
 * @property {boolean} requires_database - Whether agent needs database access
 * @property {'sqlite'|'duckdb'|'postgresql'} [database_type] - Database type if required
 * @property {string} bootstrap - Bootstrap code as string
 * @property {string} code - Main execution code as string
 */

/**
 * AgentFormat template for creating new agents
 */
export const AGENT_FORMAT_TEMPLATE = {
  name: 'AgentName',
  description: 'Description of task',
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['action1', 'action2']
      }
    },
    required: ['action']
  },
  dependencies: ['npm-module'],
  execution_target: 'frontend',
  requires_database: false,
  database_type: undefined,
  bootstrap: `
async bootstrap(config, context) {
  // Handle own setup - dependencies, database, etc.
  // No main.cjs dependencies allowed here
  console.log('🚀 Bootstrapping agent:', this.name);
  
  if (this.requires_database) {
    this.db = await this.initializeDatabase(config);
  }
  
  return true;
}
  `.trim(),
  code: `
async execute(params, context) {
  const { action } = params;
  
  switch (action) {
    case 'action1':
      return this.handleAction1(params, context);
    case 'action2':
      return this.handleAction2(params, context);
    default:
      throw new Error(\`Unknown action: \${action}\`);
  }
}

async handleAction1(params, context) {
  // Implementation for action1
  return { success: true, result: 'Action1 completed' };
}

async handleAction2(params, context) {
  // Implementation for action2
  return { success: true, result: 'Action2 completed' };
}
  `.trim()
};

/**
 * Validate agent format against the interface
 * @param {Object} agent - Agent object to validate
 * @returns {Object} - Validation result
 */
export function validateAgentFormat(agent) {
  const errors = [];
  const warnings = [];
  
  // Required fields
  const requiredFields = ['name', 'description', 'schema', 'dependencies', 'execution_target', 'requires_database', 'bootstrap', 'code'];
  
  for (const field of requiredFields) {
    if (!agent[field] && agent[field] !== false) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Type validations
  if (agent.name && typeof agent.name !== 'string') {
    errors.push('name must be a string');
  }
  
  if (agent.description && typeof agent.description !== 'string') {
    errors.push('description must be a string');
  }
  
  if (agent.dependencies && !Array.isArray(agent.dependencies)) {
    errors.push('dependencies must be an array');
  }
  
  if (agent.execution_target && !['frontend', 'backend'].includes(agent.execution_target)) {
    errors.push('execution_target must be "frontend" or "backend"');
  }
  
  if (agent.requires_database && typeof agent.requires_database !== 'boolean') {
    errors.push('requires_database must be a boolean');
  }
  
  if (agent.database_type && !['sqlite', 'duckdb', 'postgresql'].includes(agent.database_type)) {
    errors.push('database_type must be "sqlite", "duckdb", or "postgresql"');
  }
  
  // Schema validation
  if (agent.schema) {
    if (typeof agent.schema !== 'object') {
      errors.push('schema must be an object');
    } else {
      if (!agent.schema.type) {
        warnings.push('schema should have a type property');
      }
      if (!agent.schema.properties) {
        warnings.push('schema should have a properties object');
      }
    }
  }
  
  // Code validation
  if (agent.bootstrap && typeof agent.bootstrap !== 'string') {
    errors.push('bootstrap must be a string');
  }
  
  if (agent.code && typeof agent.code !== 'string') {
    errors.push('code must be a string');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Create agent class from AgentFormat
 * @param {Object} agentFormat - Agent format object
 * @returns {Class} - Agent class
 */
export function createAgentFromFormat(agentFormat) {
  // Validate format first
  const validation = validateAgentFormat(agentFormat);
  if (!validation.valid) {
    throw new Error(`Invalid agent format: ${validation.errors.join(', ')}`);
  }
  
  // Create dynamic agent class
  const AgentClass = class extends Agent {
    constructor(name, config = {}) {
      super(name || agentFormat.name, config);
      this.dependencies = agentFormat.dependencies;
      this.requires_database = agentFormat.requires_database;
      this.database_type = agentFormat.database_type;
      this.execution_target = agentFormat.execution_target;
      this.schema = agentFormat.schema;
      this.agentDescription = agentFormat.description;
    }
    
    async setup(config, context) {
      // Execute bootstrap code
      const bootstrapCode = agentFormat.bootstrap.trim();
      
      try {
        // Create a custom require function for the sandbox
        const customRequire = (moduleName) => {
          // Handle common modules that agents might need
          const allowedModules = {
            'path': import('path'),
            'fs': import('fs'),
            'fs/promises': import('fs/promises'),
            'duckdb': import('duckdb'),
            'sharp': import('sharp'),
            'tesseract.js': import('tesseract.js')
          };
          
          if (allowedModules[moduleName]) {
            // This is a hack to make require work synchronously
            // In production, we'd want to pre-load these modules
            throw new Error(`Module '${moduleName}' needs to be imported dynamically. Use await import('${moduleName}') instead.`);
          }
          
          throw new Error(`Module '${moduleName}' is not allowed in agent sandbox`);
        };
        
        // Extract the function body instead of using vm
        // This is safer and works with ES modules
        let functionBody;
        const functionMatch = bootstrapCode.match(/async\s+(function\s+)?bootstrap\s*\([^)]*\)\s*\{([\s\S]*)\}/m);
        
        if (functionMatch) {
          // Get everything between first { and last }
          const fullMatch = functionMatch[0];
          const firstBrace = fullMatch.indexOf('{');
          const lastBrace = fullMatch.lastIndexOf('}');
          functionBody = fullMatch.substring(firstBrace + 1, lastBrace);
        } else {
          throw new Error('Bootstrap code must be an async function named "bootstrap"');
        }
        
        // Replace require() calls with dynamic imports
        functionBody = functionBody.replace(/const\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 
          'const $1 = await import("$2")');
        
        console.log('🔍 Extracted bootstrap function body:');
        console.log('First 200 chars:', functionBody.substring(0, 200));
        console.log('Contains async keyword?', functionBody.includes('async'));
        
        // Create an async function using Function constructor
        // This is safer than eval but still allows dynamic code execution
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const bootstrapFunction = new AsyncFunction('config', 'context', '__dirname', '__filename', functionBody);
        
        // Bind this context and execute
        return await bootstrapFunction.call(this, config, context, __dirname, __filename);
      } catch (error) {
        console.error('Failed to execute bootstrap code:', error);
        throw error;
      }
    }
    
    async execute(params, context) {
      // Execute main code
      const executeCode = agentFormat.code.trim();
      
      try {
        // First, extract and bind all helper methods to this instance
        console.log('[DEBUG] Extracting and binding helper methods');
        
        // Extract all method definitions from the code
        const methodRegex = /async\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g;
        let methodMatch;
        const helperMethods = {};
        
        while ((methodMatch = methodRegex.exec(executeCode)) !== null) {
          const methodName = methodMatch[1];
          if (methodName !== 'execute') { // Skip the main execute method
            const methodCode = methodMatch[0];
            console.log(`[DEBUG] Found helper method: ${methodName}`);
            
            try {
              // Extract method body (everything between the first { and the last })
              const methodBodyMatch = methodCode.match(/\{([\s\S]*)\}\s*$/m);
              if (methodBodyMatch) {
                const methodBody = methodBodyMatch[1];
                
                // Create method function and bind to this instance
                const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                const methodFunction = new AsyncFunction('params', 'context', '__dirname', '__filename', methodBody);
                
                // Bind the method to this instance
                this[methodName] = async (params, context) => {
                  return await methodFunction.call(this, params, context, __dirname, __filename);
                };
                
                helperMethods[methodName] = true;
                console.log(`[DEBUG] Successfully bound helper method: ${methodName}`);
              }
            } catch (methodError) {
              console.error(`[ERROR] Failed to bind helper method ${methodName}:`, methodError);
            }
          }
        }
        
        console.log('[DEBUG] Bound helper methods:', Object.keys(helperMethods));
        
        // Now extract and execute the main execute method
        let functionBody;
        
        // Find the execute method
        if (executeCode.trim().startsWith('async')) {
          console.log('[DEBUG] Code starts with async keyword, extracting function body');
          
          // Find the first opening brace after 'async execute(...)'  
          const functionDeclarationMatch = executeCode.match(/async\s+(function\s+)?execute\s*\([^)]*\)\s*\{/m);
          
          if (functionDeclarationMatch) {
            const declarationEndIndex = executeCode.indexOf('{', functionDeclarationMatch.index) + 1;
            // Find the matching closing brace (accounting for nested braces)
            let braceCount = 1;
            let endIndex = declarationEndIndex;
            
            for (let i = declarationEndIndex; i < executeCode.length; i++) {
              if (executeCode[i] === '{') braceCount++;
              if (executeCode[i] === '}') braceCount--;
              
              if (braceCount === 0) {
                endIndex = i;
                break;
              }
            }
            
            // Extract everything between the opening and closing braces
            functionBody = executeCode.substring(declarationEndIndex, endIndex);
            console.log('[DEBUG] Function body extracted, length:', functionBody.length);
          } else {
            throw new Error('Could not find execute function declaration');
          }
        } else {
          throw new Error('Execute code must start with async keyword');
        }
        
        // Replace require() calls with dynamic imports
        functionBody = functionBody.replace(/const\s+(\w+)\s*=\s*require\s*\(\s*['"](\S+)['"]\s*\)/g, 
          'const $1 = await import("$2")');
        
        // Create an async function using Function constructor
        // This is safer than eval but still allows dynamic code execution
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const executeFunction = new AsyncFunction('params', 'context', '__dirname', '__filename', functionBody);
        
        // Bind this context and execute
        return await executeFunction.call(this, params, context, __dirname, __filename);
      } catch (error) {
        console.error('Failed to execute agent code:', error);
        throw error;
      }
    }
    
    getCapabilities() {
      return {
        actions: this.schema?.properties?.action?.enum || [],
        description: this.agentDescription,
        requires_database: this.requires_database,
        database_type: this.database_type,
        execution_target: this.execution_target
      };
    }
  };
  
  // Set class name for debugging
  Object.defineProperty(AgentClass, 'name', { value: agentFormat.name });
  
  return AgentClass;
}

/**
 * Load agent from format file
 * @param {string} filePath - Path to agent format file
 * @returns {Class} - Agent class
 */
export async function loadAgentFromFile(filePath) {
  try {
    const agentModule = await import(filePath);
    const agentFormat = agentModule.default || agentModule.AGENT_FORMAT;
    
    if (!agentFormat) {
      throw new Error(`No agent format found in ${filePath}`);
    }
    
    return createAgentFromFormat(agentFormat);
    
  } catch (error) {
    console.error(`Failed to load agent from ${filePath}:`, error);
    throw error;
  }
}

/**
 * Helper to create agent format from existing agent code
 * @param {Object} options - Agent options
 * @returns {Object} - Agent format object
 */
export function createAgentFormat(options) {
  const {
    name,
    description,
    actions = [],
    dependencies = [],
    execution_target = 'frontend',
    requires_database = false,
    database_type,
    bootstrap,
    code,
    schema
  } = options;
  
  // Auto-generate schema if actions are provided
  const generatedSchema = schema || {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: actions
      }
    },
    required: ['action']
  };
  
  return {
    name,
    description,
    schema: generatedSchema,
    dependencies,
    execution_target,
    requires_database,
    database_type,
    bootstrap: bootstrap || AGENT_FORMAT_TEMPLATE.bootstrap,
    code: code || AGENT_FORMAT_TEMPLATE.code
  };
}

export default {
  AGENT_FORMAT_TEMPLATE,
  validateAgentFormat,
  createAgentFromFormat,
  loadAgentFromFile,
  createAgentFormat
};
