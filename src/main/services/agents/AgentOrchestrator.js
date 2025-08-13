/**
 * AgentOrchestrator - Object-based approach
 * Supports both string-based agents (legacy) and object-based agents (new)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const IntentResponses = require('../utils/IntentResponses.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define AsyncFunction constructor for dynamic async function creation
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

export class AgentOrchestrator {
  constructor() {
    this.agents = new Map();
    this.loadedAgents = new Map();
    this.context = {};
    this.initialized = false;
  }

  async initialize(config = {}) {
    try {
      
      this.context = {
        ...config,
        orchestratorPath: __dirname,
        timestamp: new Date().toISOString()
      };
      
      // Ensure database is available in context for agents
      if (config.database) {
        this.context.database = config.database;
      } else {
        console.warn('⚠️ No database connection provided to orchestrator');
      }

      // Initialize shared embedder for all agents
      await this.initializeSharedEmbedder();

      // Register default agents
      await this.registerDefaultAgents();
      
      // Preload critical agents
      const criticalAgents = config.preloadAgents || ['UserMemoryAgent'];
      
      await this.preloadAgents(criticalAgents);
      
      this.initialized = true;
      
      return { success: true, agentCount: this.agents.size };
      
    } catch (error) {
      console.error('❌ AgentOrchestrator initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize shared embedder for all agents to use
   */
  async initializeSharedEmbedder() {
    try {
      console.log('🔗 AgentOrchestrator: Initializing shared embedder...');
      
      // Use dynamic import for ES modules in Electron with proper callback
      const transformers = await import('@xenova/transformers');
      
      // Initialize embedding model (same as IntentParser)
      this.sharedEmbedder = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
        device: 'cpu',
        progress_callback: null
      });
      
      // Add embedder to context so all agents can access it
      this.context.embedder = this.sharedEmbedder;
      
      console.log('✅ AgentOrchestrator: Shared embedder initialized successfully');
      
    } catch (error) {
      console.error('❌ AgentOrchestrator: Failed to initialize shared embedder:', error);
      // Don't throw - continue without embedder, agents can handle gracefully
      this.context.embedder = null;
    }
  }

  /**
   * Create agents table in DuckDB if it doesn't exist
   */
  async createAgentsTable() {
    const { database } = this.context;
    if (!database) {
      throw new Error('Database connection not available');
    }

    try {
      // Create table first
      const createTableSQL = `CREATE TABLE IF NOT EXISTS agents (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        parameters JSON,
        dependencies JSON,
        execution_target TEXT DEFAULT 'frontend' NOT NULL 
          CHECK (execution_target IN ('frontend', 'backend')),
        requires_database BOOLEAN DEFAULT false,
        database_type TEXT 
          CHECK (database_type IN ('sqlite', 'duckdb')),
        bootstrap TEXT,
        code TEXT,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        version TEXT DEFAULT 'v1',
        config JSON DEFAULT '{}',
        secrets JSON DEFAULT '{}',
        orchestrator_metadata JSON DEFAULT '{}',
        memory JSON
      );`;

      await database.run(createTableSQL);

      // Create indexes
      const indexStatements = [
        'CREATE INDEX IF NOT EXISTS idx_agents_name ON agents (name)',
        'CREATE INDEX IF NOT EXISTS idx_agents_execution_target ON agents (execution_target)',
        'CREATE INDEX IF NOT EXISTS idx_agents_requires_database ON agents (requires_database)',
        'CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents (created_at)'
      ];

      await Promise.all(indexStatements.map(stmt => database.run(stmt)));

    } catch (error) {
      console.error('❌ Failed to create agents table:', error);
      throw error;
    }
  }

  /**
   * Create default agents in DuckDB if they don't exist
   */
  async createDefaultAgent(agentName, agentData) {
    const { database } = this.context;
    if (!database) {
      throw new Error('Database connection not available');
    }

    try {
      // Check if agent already exists
      const existingAgent = await database.query(
        'SELECT id FROM agents WHERE name = ?',
        [agentName]
      );

      // Safely check if existingAgent is defined and has entries
      if (existingAgent && Array.isArray(existingAgent) && existingAgent.length > 0) {
        return existingAgent[0];
      }

      // Ensure dependencies is properly formatted as an array for JSON column
      let dependencies;
      if (agentData.dependencies) {
        // If it's a string, split it into an array
        if (typeof agentData.dependencies === 'string') {
          dependencies = agentData.dependencies.split(',').map(dep => dep.trim());
        } else if (Array.isArray(agentData.dependencies)) {
          dependencies = agentData.dependencies;
        } else {
          dependencies = [];
        }
      } else {
        dependencies = [];
      }

      // Insert new agent
      const insertSQL = `
        INSERT INTO agents (
          name, description, parameters, dependencies, execution_target,
          requires_database, database_type, bootstrap, code, version,
          config, secrets, orchestrator_metadata, memory
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      // Convert dependencies to JSON format
      const jsonDependencies = JSON.stringify(dependencies);

      await database.run(insertSQL, [
        agentData.name,
        agentData.description || null,
        JSON.stringify(agentData.parameters || {}),
        jsonDependencies, // Use JSON format for dependencies
        agentData.execution_target || 'frontend',
        agentData.requires_database || false,
        agentData.database_type || null,
        agentData.bootstrap || null,
        agentData.code || null,
        agentData.version || 'v1',
        JSON.stringify(agentData.config || {}),
        JSON.stringify(agentData.secrets || {}),
        JSON.stringify(agentData.orchestrator_metadata || {}),
        agentData.memory ? JSON.stringify(agentData.memory) : null
      ]);
      
      // Query for the inserted agent to get the ID
      const result = await database.query('SELECT id FROM agents WHERE name = ?', [agentData.name]);

      
      // Safely handle the result which might be undefined or not an array
      if (result && Array.isArray(result) && result.length > 0) {
        return result[0];
      } else {
        // Create a fallback object with a generated UUID
        const fallbackId = `fallback-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        console.log(`⚠️ No result returned from database, using fallback ID: ${fallbackId}`);
        return { id: fallbackId };
      }
    } catch (error) {
      console.error(`❌ Failed to create default agent ${agentName}:`, error);
      throw error;
    }
  }

  /**
   * Register default agents in DuckDB database
   */
  async registerDefaultAgents() {
    // First ensure the agents table exists
    await this.createAgentsTable();

    // Use __dirname directly since we're already in the agents directory
    const agentsDir = __dirname;
    const defaultAgents = [
      {
        name: 'ScreenCaptureAgent',
        description: 'Captures screenshots and performs OCR text extraction',
        dependencies: ['screenshot-desktop', 'node-screenshots', 'tesseract.js', 'path', 'fs', 'url'],
        execution_target: 'frontend',
        requires_database: false,
        config: { screenshot_dir: 'screenshots', ocr_enabled: true },
        orchestrator_metadata: { category: 'system', priority: 'high' }
      },
      {
        name: 'UserMemoryAgent',
        description: 'Manages user memory storage and retrieval using DuckDB',
        dependencies: ['duckdb', 'path', 'fs', 'url'],
        execution_target: 'frontend',
        requires_database: true,
        database_type: 'duckdb',
        config: { memory_retention_days: 30, max_memories: 10000 },
        orchestrator_metadata: { category: 'memory', priority: 'critical' }
      },
      {
        name: 'IntentParserAgent_phi3_embedded',
        description: 'Parses user intents using local Phi3 LLM with embedded prompts for offline processing',
        dependencies: ['path', 'fs'],
        execution_target: 'frontend',
        requires_database: false,
        config: { confidence_threshold: 0.7, use_phi3: true },
        orchestrator_metadata: { category: 'nlp', priority: 'high' }
      },
      {
        name: 'Phi3Agent',
        description: 'Local Phi3 LLM agent using Ollama for offline natural language processing',
        dependencies: ['child_process', 'path'],
        execution_target: 'frontend',
        requires_database: false,
        config: { model: 'phi4-mini:latest', timeout: 30000, max_tokens: 100 },
        orchestrator_metadata: { category: 'llm', priority: 'high' }
      },
      {
        name: 'SemanticEmbeddingAgent',
        description: 'Generates semantic embeddings using @xenova/transformers for local semantic search',
        dependencies: ['@xenova/transformers'],
        execution_target: 'frontend',
        requires_database: false,
        config: { model: 'all-MiniLM-L6-v2', embedding_dim: 384 },
        orchestrator_metadata: { category: 'ml', priority: 'high' }
      },
      {
        name: 'EmbeddingDaemonAgent',
        description: 'Background daemon for generating embeddings for memories without them',
        dependencies: [],
        execution_target: 'frontend',
        requires_database: true,
        database_type: 'duckdb',
        config: { interval_minutes: 10, batch_size: 10 },
        orchestrator_metadata: { category: 'daemon', priority: 'medium' }
      },
      {
        name: 'ConversationSessionAgent',
        description: 'Manages multi-chat conversation sessions with context awareness and auto-initiation',
        dependencies: [],
        execution_target: 'frontend',
        requires_database: true,
        database_type: 'duckdb',
        config: { max_active_sessions: 10, hibernation_timeout_minutes: 30, context_similarity_threshold: 0.7 },
        orchestrator_metadata: { category: 'conversation', priority: 'high' }
      },
      // {
      //   name: 'IntentParserAgent',
      //   description: 'Parses user intents and determines appropriate actions',
      //   dependencies: ['path', 'fs'],
      //   execution_target: 'frontend',
      //   requires_database: false,
      //   config: { confidence_threshold: 0.7 },
      //   orchestrator_metadata: { category: 'nlp', priority: 'medium' }
      // },
      // {
      //   name: 'PlannerAgent',
      //   description: 'Creates and manages execution plans for complex tasks',
      //   dependencies: ['path', 'fs'],
      //   execution_target: 'frontend',
      //   requires_database: false,
      //   config: { max_plan_steps: 10 },
      //   orchestrator_metadata: { category: 'planning', priority: 'medium' }
      // }
    ];

    const fs = await import('fs');
    
    for (const agentData of defaultAgents) {
      // Read agent code from file first
      const agentPath = path.join(agentsDir, `${agentData.name}.cjs`);
      
      try {
        // Read agent file contents
        const agentCode = fs.readFileSync(agentPath, 'utf-8');
        
        // Extract bootstrap function if available
        let bootstrap = null;
        if (agentCode.includes('bootstrap')) {
          const bootstrapMatch = agentCode.match(/async\s+bootstrap\s*\([^)]*\)\s*{([\s\S]*?)\s*},/m);
          if (bootstrapMatch && bootstrapMatch[0]) {
            bootstrap = bootstrapMatch[0];
          }
        }
        
        // Update agentData with code and bootstrap
        agentData.code = agentCode;
        agentData.bootstrap = bootstrap;
        agentData.filePath = agentPath;
        
        // Register agent with full code in database (single operation)
        await this.registerAgent(agentData.name, agentData);
        
      } catch (readError) {
        console.error(`❌ Failed to read agent file: ${agentPath}`, readError);
        // Fall back to basic registration without code
        await this.registerAgent(agentData.name, agentData);
      }
    }
  }

  /**
   * Register an agent with the orchestrator and store in DuckDB
   */
  async registerAgent(name, agentData, filePath = null) {
    const { database } = this.context;
    
    // Handle legacy file-based registration for backward compatibility
    if (typeof agentData === 'string') {
      filePath = agentData;
      agentData = { name, filePath };
      
      // Read agent file contents to store in database
      try {
        const fs = await import('fs');
        const agentCode = fs.readFileSync(filePath, 'utf-8');
        
        // Extract bootstrap function if available
        let bootstrap = null;
        if (agentCode.includes('bootstrap')) {
          const bootstrapMatch = agentCode.match(/async\s+bootstrap\s*\([^)]*\)\s*{([\s\S]*?)\s*},/m);
          if (bootstrapMatch && bootstrapMatch[1]) {
            bootstrap = bootstrapMatch[0];
          }
        }
        
        // Update agentData with code and bootstrap
        agentData.code = agentCode;
        agentData.bootstrap = bootstrap;
      } catch (readError) {
        console.error(`❌ Failed to read agent file: ${filePath}`, readError);
      }
      
      this.agents.set(name, agentData);
      
      // Continue to store in database if available
      if (!database) {
        return;
      }
    }

    
    if (!database) {
      console.warn('⚠️ Database connection not available, storing in memory only');
      this.agents.set(name, agentData);
      return;
    }

    try {
      // Note: Table creation is handled by registerDefaultAgents() to avoid race conditions
      
      // Check if agent already exists
      const existingAgent = await database.query(
        'SELECT id FROM agents WHERE name = ?',
        [name]
      );
      
      // Ensure dependencies is properly formatted as an array for JSON column
      let dependencies;
      if (agentData.dependencies) {
        // If it's a string, split it into an array
        if (typeof agentData.dependencies === 'string') {
          dependencies = agentData.dependencies.split(',').map(dep => dep.trim());
        } else if (Array.isArray(agentData.dependencies)) {
          dependencies = agentData.dependencies;
        } else {
          dependencies = [];
        }
      } else {
        dependencies = [];
      }
      
      // Convert dependencies to JSON format
      const jsonDependencies = JSON.stringify(dependencies);

      // Safely check if existingAgent is defined and has entries
      if (existingAgent && Array.isArray(existingAgent) && existingAgent.length > 0) {
        // Update existing agent
        const updateSQL = `
          UPDATE agents SET 
            description = ?, parameters = ?, dependencies = ?, execution_target = ?,
            requires_database = ?, database_type = ?, bootstrap = ?, code = ?, config = ?,
            orchestrator_metadata = ?, updated_at = now()
          WHERE name = ?
        `;

        await database.run(updateSQL, [
          agentData.description || null,
          JSON.stringify(agentData.parameters || {}),
          jsonDependencies,
          agentData.execution_target || 'frontend',
          agentData.requires_database || false,
          agentData.database_type || null,
          agentData.bootstrap || null,
          agentData.code || null,
          JSON.stringify(agentData.config || {}),
          JSON.stringify(agentData.orchestrator_metadata || {}),
          name
        ]);

      } else {
        // Insert new agent
        const insertSQL = `
          INSERT INTO agents (
            name, description, parameters, dependencies, execution_target,
            requires_database, database_type, bootstrap, code, version,
            config, secrets, orchestrator_metadata, memory
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await database.run(insertSQL, [
          name,
          agentData.description || null,
          JSON.stringify(agentData.parameters || {}),
          jsonDependencies,
          agentData.execution_target || 'frontend',
          agentData.requires_database || false,
          agentData.database_type || null,
          agentData.bootstrap || null,
          agentData.code || null,
          agentData.version || 'v1',
          JSON.stringify(agentData.config || {}),
          JSON.stringify(agentData.secrets || {}),
          JSON.stringify(agentData.orchestrator_metadata || {}),
          agentData.memory ? JSON.stringify(agentData.memory) : null
        ]);

        // No explicit commit needed in DuckDB auto-commit mode
        console.log('🔍 Insert completed, DuckDB auto-commit should handle persistence');
        
        // Small delay to ensure write is flushed
        await new Promise(resolve => setTimeout(resolve, 100));

      }

      // Also store in memory for quick access
      this.agents.set(name, agentData);
      
    } catch (error) {
      console.error(`❌ Failed to register agent ${name} in database:`, error);
      // Fallback to memory storage
      this.agents.set(name, agentData);
    }
  }

  /**
   * Preload agents for faster access
   */
  async preloadAgents() {
    const agentNames = Array.from(this.agents.keys());
    
    for (const agentName of agentNames) {
      try {
        await this.loadAgent(agentName);
      } catch (error) {
        console.warn(`⚠️ Failed to preload agent ${agentName}:`, error.message);
      }
    }
  }

  /**
   * Load an agent from DuckDB database or fallback to file
   */
  async loadAgent(agentName) {
    
    // Check if agent is already loaded
    if (this.loadedAgents.has(agentName)) {
      const cachedAgent = this.loadedAgents.get(agentName);
      return cachedAgent;
    }

    try {
      
      // First try to load from DuckDB database
      let agentData = await this.loadAgentFromDatabase(agentName);
      // If not found in database, try legacy file-based loading
      if (!agentData) {
        agentData = await this.loadAgentFromFile(agentName);
      }
      
      if (!agentData) {
        console.error(`❌ DEBUG: Agent ${agentName} not found in database or file system`);
        throw new Error(`Agent ${agentName} not found in database or file system`);
      }

      // Create agent instance
      let agentInstance;
      
      if (agentData.code) {
        // Database-stored agent with code
        agentInstance = await this.createAgentFromCode(agentData);
      } else if (agentData.filePath) {
        // File-based agent (legacy)
        agentInstance = await this.createAgentFromFile(agentData);
      } else {
        console.error(`❌ DEBUG: Agent ${agentName} has no code or file path`);
        throw new Error(`Agent ${agentName} has no code or file path`);
      }
                
      this.loadedAgents.set(agentName, agentInstance);
      
      return agentInstance;
      
    } catch (error) {
      console.error(`❌ Failed to load agent ${agentName}:`, error);
      throw error;
    }
  }

  /**
   * Load agent data from DuckDB database
   */
  async loadAgentFromDatabase(agentName) {
    const { database } = this.context;
    
    if (!database) {
      console.log(`⚠️ Database connection not available for ${agentName}`);
      return null;
    }

    try {
      const result = await database.query(
        `SELECT * FROM agents WHERE name = ?`,
        [agentName]
      );

      // Safely check if result is defined and has entries
      if (!result || !Array.isArray(result) || result.length === 0) {
        console.log(`🔍 Agent ${agentName} not found in database`);
        return null;
      }

      const agentRow = result[0];
    
      return {
        id: agentRow.id,
        name: agentRow.name,
        description: agentRow.description,
        parameters: agentRow.parameters ? JSON.parse(agentRow.parameters) : {},
        dependencies: agentRow.dependencies ? (typeof agentRow.dependencies === 'string' ? JSON.parse(agentRow.dependencies) : agentRow.dependencies) : [],
        execution_target: agentRow.execution_target,
        requires_database: agentRow.requires_database,
        database_type: agentRow.database_type,
        bootstrap: agentRow.bootstrap,
        code: agentRow.code,
        config: agentRow.config ? JSON.parse(agentRow.config) : {},
        secrets: agentRow.secrets ? JSON.parse(agentRow.secrets) : {},
        orchestrator_metadata: agentRow.orchestrator_metadata ? JSON.parse(agentRow.orchestrator_metadata) : {},
        memory: agentRow.memory ? JSON.parse(agentRow.memory) : null,
        version: agentRow.version,
        created_at: agentRow.created_at,
        updated_at: agentRow.updated_at
      };
      
    } catch (error) {
      console.error(`❌ Failed to load agent ${agentName} from database:`, error);
      return null;
    }
  }

  /**
   * Load agent data from file (legacy support)
   */
  async loadAgentFromFile(agentName) {
    const agentInfo = this.agents.get(agentName);
    if (!agentInfo || !agentInfo.filePath) {
      return null;
    }

    console.log(`📁 Loading agent ${agentName} from file: ${agentInfo.filePath}`);
    return agentInfo;
  }

  /**
   * Create agent instance from database-stored code
   */
  async createAgentFromCode(agentData) {
    // If we have code in database, create agent from stored code
    if (agentData.code) {
      try { 
        // Create a temporary module to evaluate the agent code
        const path = await import('path');
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const { fileURLToPath } = await import('url');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        
        // Create a sandbox environment for evaluating the agent code
        const vm = await import('vm');
        
        // Create a custom require function that handles ES modules
        const customRequire = (modulePath) => {
          // Check if it's the problematic ES module
          if (modulePath.includes('NaturalLanguageIntentParser')) {
            // Return a mock object since this isn't actually used in the agent code
            return {
              parseIntent: () => ({ intent: 'unknown', confidence: 0.5 }),
              extractEntities: () => []
            };
          }
          // For other modules, use the original require
          return require(modulePath);
        };
        
        const context = {
          exports: {},
          require: customRequire,
          module: { exports: {} },
          __filename,
          __dirname,
          import: async (modulePath) => import(modulePath),
          console
        };
        
        // Add global objects to context
        Object.keys(global).forEach(key => {
          context[key] = global[key];
        });
        
        // Create a new context with the sandbox
        const sandbox = vm.createContext(context);
        
        // Check if the code contains AGENT_FORMAT export
        if (agentData.code.includes('AGENT_FORMAT')) {
          
          // Extract AGENT_FORMAT directly from the code
          const agentFormatCode = `
            ${agentData.code}
            module.exports = AGENT_FORMAT;
          `;
          
          // Execute the modified code in the sandbox
          vm.runInContext(agentFormatCode, sandbox);
        } else {
          // Execute the agent code in the sandbox as is
          vm.runInContext(agentData.code, sandbox);
        }
        
        // Get the AGENT_FORMAT object from the sandbox
        const agentFormat = sandbox.module.exports.default || sandbox.module.exports || sandbox.AGENT_FORMAT;
         
        // Check if the execute method is a dummy function or missing
        if (!agentFormat.execute) {
          console.error(`❌ Agent ${agentData.name} has no execute function!`);
          throw new Error('No execute function found in agent code');
        }
        
        if (agentFormat.execute && agentFormat.execute.toString().includes('No valid execute code provided')) {
          console.error(`❌ Agent ${agentData.name} has a dummy execute function!`);
          console.log(`🔍 Execute function: ${agentFormat.execute.toString()}`);
        }
        
        // Create agent instance from the evaluated AGENT_FORMAT
        const agentInstance = {
          name: agentData.name,
          description: agentData.description || agentFormat.description,
          schema: agentFormat.schema || {},
          dependencies: agentData.dependencies || agentFormat.dependencies || [],
          execution_target: agentData.execution_target || agentFormat.execution_target || 'backend',
          requires_database: agentData.requires_database ?? agentFormat.requires_database ?? false,
          database_type: agentData.database_type || agentFormat.database_type || null,
          
          // Database-specific fields
          id: agentData.id,
          config: agentData.config || {},
          secrets: agentData.secrets || {},
          orchestrator_metadata: agentData.orchestrator_metadata || {},
          memory: agentData.memory,
          version: agentData.version || 'v1',
          created_at: agentData.created_at,
          updated_at: agentData.updated_at,
          
          // Copy methods from the evaluated AGENT_FORMAT
          bootstrap: agentFormat.bootstrap,
          execute: agentFormat.execute
        };
        
        return agentInstance;
      } catch (error) {
        console.error(`❌ Failed to evaluate agent code for ${agentData.name}:`, error);
        console.log(`🔄 Falling back to string-based agent creation`);
        
        // Fall back to string-based agent creation
        return await this.createStringBasedAgent({
          name: agentData.name,
          description: agentData.description,
          dependencies: agentData.dependencies,
          execution_target: agentData.execution_target,
          requires_database: agentData.requires_database,
          database_type: agentData.database_type,
          bootstrap: agentData.bootstrap,
          code: agentData.code
        }, agentData);
      }
    }
    
    // If no code in database, fall back to file-based loading
    console.log(`⚠️ No code found in database for ${agentData.name}`);
    console.log(`🔄 Falling back to file-based loading`);
    
    // Try to find corresponding file
    const path = await import('path');
    const agentsDir = path.join(__dirname);
    const agentPath = path.join(agentsDir, `${agentData.name}.cjs`);
    
    return await this.createAgentFromFile({
      name: agentData.name,
      filePath: agentPath,
      ...agentData
    });
  }

  /**
   * Create agent instance from file
   */
  async createAgentFromFile(agentData) {
    // Import the agent module
    const agentModule = await import(agentData.filePath);
    const agentFormat = agentModule.AGENT_FORMAT || agentModule.default;
    
    if (!agentFormat) {
      throw new Error(`Agent ${agentData.name} does not export AGENT_FORMAT`);
    }

    // Create agent instance based on format type
    if (this.isObjectBasedAgent(agentFormat)) {
      // Object-based agent - methods are already defined
      return this.createObjectBasedAgent(agentFormat, agentData);
    } else {
      // String-based agent - use legacy approach
      return await this.createStringBasedAgent(agentFormat, agentData);
    }
  }

  isObjectBasedAgent(agentFormat) {
    // Check if bootstrap and execute are functions (object-based) or strings (string-based)
    return typeof agentFormat.bootstrap === 'function' && typeof agentFormat.execute === 'function';
  }

  createObjectBasedAgent(agentFormat, agentData = null) {
    // Object-based agent - methods are already functions, just bind context
    const agentInstance = {
      // Use database data if available, otherwise use format data
      name: agentData?.name || agentFormat.name,
      description: agentData?.description || agentFormat.description,
      schema: agentFormat.schema,
      dependencies: agentData?.dependencies || agentFormat.dependencies,
      execution_target: agentData?.execution_target || agentFormat.execution_target,
      requires_database: agentData?.requires_database ?? agentFormat.requires_database,
      database_type: agentData?.database_type || agentFormat.database_type,
      
      // Database-specific fields
      id: agentData?.id,
      config: agentData?.config || {},
      secrets: agentData?.secrets || {},
      orchestrator_metadata: agentData?.orchestrator_metadata || {},
      memory: agentData?.memory,
      version: agentData?.version || 'v1',
      created_at: agentData?.created_at,
      updated_at: agentData?.updated_at,
      
      // Bind all methods to the instance
      bootstrap: agentFormat.bootstrap.bind(agentFormat),
      execute: agentFormat.execute.bind(agentFormat),
      
      // Bind helper methods if they exist
      ...this.bindHelperMethods(agentFormat)
    };

    return agentInstance;
  }

  bindHelperMethods(agentFormat) {
    const helperMethods = {};
    
    // Find all methods that aren't bootstrap/execute
    for (const [key, value] of Object.entries(agentFormat)) {
      if (typeof value === 'function' && !['bootstrap', 'execute'].includes(key)) {
        helperMethods[key] = value.bind(agentFormat);
      }
    }
    
    return helperMethods;
  }

  async createStringBasedAgent(agentFormat, agentData = null) {
    // Legacy string-based agent approach (fallback)
    const agentInstance = {
      // Use database data if available, otherwise use format data
      name: agentData?.name || agentFormat.name || 'UnknownAgent',
      description: agentData?.description || agentFormat.description || 'No description provided',
      schema: agentFormat.schema || {},
      dependencies: agentData?.dependencies || agentFormat.dependencies || [],
      execution_target: agentData?.execution_target || agentFormat.execution_target || 'backend',
      requires_database: agentData?.requires_database ?? agentFormat.requires_database ?? false,
      database_type: agentData?.database_type || agentFormat.database_type || null,
      
      // Database-specific fields
      id: agentData?.id,
      config: agentData?.config || {},
      secrets: agentData?.secrets || {},
      orchestrator_metadata: agentData?.orchestrator_metadata || {},
      memory: agentData?.memory,
      version: agentData?.version || 'v1',
      created_at: agentData?.created_at,
      updated_at: agentData?.updated_at
    };

    // Create bootstrap function from string
    if (agentFormat.bootstrap && typeof agentFormat.bootstrap === 'string') {
      try {
        const bootstrapCode = this.extractFunctionBody(agentFormat.bootstrap);
        agentInstance.bootstrap = new AsyncFunction('config', 'context', bootstrapCode);
      } catch (error) {
        console.error(`❌ Failed to create bootstrap function for ${agentInstance.name}:`, error);
        // Provide fallback bootstrap function
        agentInstance.bootstrap = async () => ({ success: true, message: 'Default bootstrap (no code provided)' });
      }
    }

    // Create execute function from string
    if (agentFormat.code && typeof agentFormat.code === 'string') {
      try {
        const executeCode = this.extractFunctionBody(agentFormat.code);
        agentInstance.execute = new AsyncFunction('params', 'context', executeCode);
      } catch (error) {
        console.error(`❌ Failed to create execute function for ${agentInstance.name}:`, error);
        // Provide fallback execute function
        agentInstance.execute = async () => ({ success: false, error: 'No valid execute code provided' });
      }
    } else if (typeof agentFormat.code === 'object' && agentFormat.code !== null) {
      // Handle case where code is an object with methods
      console.log(`ℹ️ Agent ${agentInstance.name} has object-based code, using execute method directly`);
      if (typeof agentFormat.code.execute === 'function') {
        agentInstance.execute = agentFormat.code.execute.bind(agentFormat.code);
      }
    } else {
      // No code provided at all
      console.warn(`⚠️ Agent ${agentInstance.name} has no code property`);
      agentInstance.execute = async () => ({ success: false, error: 'No execute code provided' });
    }

    return agentInstance;
  }

  extractFunctionBody(codeString) {
    // Extract function body from string (legacy support)
    if (!codeString || typeof codeString !== 'string') {
      console.warn('⚠️ Invalid code string provided to extractFunctionBody:', typeof codeString);
      return 'return { success: false, error: "No code provided" };'; // Return valid function body
    }
    
    let cleanCode = codeString.trim();
    
    // Handle method definitions like: async bootstrap(config, context) { ... }
    const methodMatch = cleanCode.match(/^async\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*,?\s*$/);
    if (methodMatch) {
      return methodMatch[1].trim();
    }
    
    // Handle arrow functions like: async (params) => { ... }
    const arrowMatch = cleanCode.match(/^async\s*\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*,?\s*$/);
    if (arrowMatch) {
      return arrowMatch[1].trim();
    }
    
    // Handle function declarations like: async function name(params) { ... }
    const funcMatch = cleanCode.match(/^async\s+function\s+\w+\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
    if (funcMatch) {
      return funcMatch[1].trim();
    }
    
    // If it's already just a function body (starts with statements, not function declaration)
    if (!cleanCode.match(/^(async\s+)?(function|\w+\s*\(|\([^)]*\)\s*=>)/)) {
      return cleanCode;
    }
    
    // Fallback: try to extract content between first { and last }
    const firstBrace = cleanCode.indexOf('{');
    const lastBrace = cleanCode.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
      return cleanCode.substring(firstBrace + 1, lastBrace).trim();
    }
    
    // If all else fails, return a safe default
    console.warn('⚠️ Could not extract function body from:', cleanCode.substring(0, 100) + '...');
    return 'return { success: false, error: "Could not parse function body" };';
  }

  /**
   * Execute an agent with proper dependency injection and bootstrap
   */
  async executeAgent(agentName, params, context = {}) {
    // ... (rest of the code remains the same)
    try {
      const agent = await this.loadAgent(agentName);
      const dependencies = {};

      // Always load dependencies for execution context (not just during bootstrap)
      if (agent.dependencies && Array.isArray(agent.dependencies)) {
        for (const dependency of agent.dependencies) {
          try {
            let module;
            const dependencyCamelcase = this.toCamelCase(dependency);
          
            // Handle built-in Node.js modules and native modules that require CommonJS require()
            const builtInModules = ['child_process', 'fs', 'path', 'url', 'crypto', 'os', 'util'];
            if (builtInModules.includes(dependency) || dependency === 'node-screenshots') {
              const { createRequire } = await import('module');
              const require = createRequire(import.meta.url);
              module = require(dependency);
              dependencies[dependencyCamelcase] = module;
              // Loaded built-in module
            } else {
              // Standard import for other dependencies
              module = await import(dependency);
              dependencies[dependencyCamelcase] = module.default || module;
            }
          } catch (error) {
            console.warn(`⚠️ Failed to import dependency ${dependency}:`, error.message);
            // Try fallback with require() for native modules
            if (dependency.includes('-') || dependency.includes('_')) {
              try {
                const { createRequire } = await import('module');
                const require = createRequire(import.meta.url);
                const module = require(dependency);
                const dependencyCamelcase = this.toCamelCase(dependency);
                dependencies[dependencyCamelcase] = module;
                console.log(`✅ Fallback: Loaded ${dependency} via require()`);
              } catch (requireError) {
                console.warn(`⚠️ Fallback also failed for ${dependency}:`, requireError.message);
              }
            }
          }
        }
      }
      
      // Dependencies loaded for agent execution
      console.log(`🔍 screenshotDesktop available:`, !!dependencies.screenshotDesktop);

      // Bootstrap agent if needed (using the same dependencies)
      if (agent.bootstrap && !agent._bootstrapped) {
        console.log(`🔧 Bootstrapping ${agentName}...`);
        await agent.bootstrap(this.context, { ...this.context, ...context, ...dependencies });
        agent._bootstrapped = true;
        
        // Update the cached agent with bootstrap flag
        this.loadedAgents.set(agentName, agent);
        console.log(`✅ ${agentName} bootstrapped successfully`);
      } else if (agent._bootstrapped) {
        console.log(`🔄 Using already bootstrapped ${agentName}`);
      }
      
      // Execute agent with orchestrator reference for agent-to-agent communication
      const enhancedContext = {
        ...this.context,
        ...context,
        ...dependencies, // Dependencies must come after context to avoid being overridden
        orchestrator: this, // Allow agents to call other agents
        executeAgent: this.executeAgent.bind(this), // Direct method access
        getAgent: this.getAgent.bind(this), // Access to other agents
      };
      
      if (!agent.execute || typeof agent.execute !== 'function') {
        throw new Error('No valid execute code provided');
      }
      
      const result = await agent.execute(params, enhancedContext);
      
      // console.log(`✅ ${agentName} executed successfully`, enhancedContext);
      return {
        success: true,
        agent: agentName,
        action: params.action || 'default',
        result,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Agent execution failed for ${agentName}:`, error);
      return {
        success: false,
        agent: agentName,
        action: params.action || 'default',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Pre-bootstrap critical agents in the background to eliminate first-query delay
   */
  async bootstrapCriticalAgents() {
    console.log('🚀 [BOOTSTRAP] Starting background agent pre-warming...');
    
    try {
      // Bootstrap agents in parallel for maximum speed
      const bootstrapPromises = [
        // SemanticEmbeddingAgent - Critical for semantic search
        this.executeAgent('SemanticEmbeddingAgent', {
          action: 'bootstrap'
        }, {}).catch(err => console.warn('⚠️ SemanticEmbeddingAgent bootstrap failed:', err.message)),
        
        // Phi3Agent - Critical for LLM responses
        this.executeAgent('Phi3Agent', {
          action: 'check-availability'
        }, {}).catch(err => console.warn('⚠️ Phi3Agent bootstrap failed:', err.message)),
        
        // UserMemoryAgent - Critical for memory search (using memory-list to validate connection)
        this.executeAgent('UserMemoryAgent', {
          action: 'memory-list',
          limit: 1
        }, {}).catch(err => console.warn('⚠️ UserMemoryAgent bootstrap failed:', err.message))
      ];
      
      await Promise.allSettled(bootstrapPromises);
      console.log('✅ [BOOTSTRAP] Background agent pre-warming completed');
      
    } catch (error) {
      console.warn('⚠️ [BOOTSTRAP] Background bootstrapping failed:', error.message);
    }
  }

  /**
   * STAGED SEMANTIC SEARCH: Progressive search from current scope to cross-session
   * @param {string} prompt - User message
   * @param {Object} options - Processing options
   * @param {Object} context - Execution context with conversationContext and currentSessionId
   * @returns {Object|null} - Enhanced response if memories found, null if should continue to intent classification
   */
  async trySemanticSearchFirst(prompt, options = {}, context = {}) {
    if (options.preferSemanticSearch === false) {
      console.log('🔕 [STAGED] preferSemanticSearch=false, skipping staged search');
      return null;
    }

    console.log('🔍 [STAGED-SEARCH] Starting progressive staged search: Current → Session → Cross-Session');
    
    // Detect if this is a cross-session query that should search across all sessions
    const isCrossSessionQuery = /\b(recently|before|earlier|previously|talked about|discussed|mentioned|food|pizza|conversation|chat)\b/i.test(prompt);
    console.log('🔍 [STAGED-SEARCH] Cross-session query detected:', isCrossSessionQuery);
    
    try {
      let stage1Result = null;
      
      // Stage 1: Current Scope (recent conversation only)
      const stage1 = await this.stageCurrentScope(prompt, { conversationContext: context.conversationContext });
      if (stage1 && stage1.success) {
        console.log('✅ [STAGE-1] Current scope success');
        stage1Result = stage1.data.response;
        
        // For non-cross-session queries, return immediately
        if (!isCrossSessionQuery) {
          console.log('🔍 [STAGE-1] Non-cross-session query, returning current scope result');
          return { success: true, data: { response: stage1.data.response } };
        } else {
          console.log('🔍 [STAGE-1] Cross-session query detected, continuing to search other sessions...');
        }
      }

      let stage2Result = null;
      let stage3Result = null;
      
      // Stage 2: Session Scope (semantic search within current session)
      if (context.currentSessionId) {
        const s2 = await this.stageSemanticMemory(prompt, { sessionId: context.currentSessionId });
        if (s2 && s2.success) {
          const phiPrompt = this.buildStagedPrompt(prompt, { conversationContext: context.conversationContext, memorySnippets: s2.data.snippets });
          const resp = await this.executeAgent('Phi3Agent', {
            action: 'query-phi3-fast',
            prompt: phiPrompt,
            options: { timeout: 12000, maxTokens: 150, temperature: 0.2 }
          });
          if (resp.success && resp.result?.response) {
            console.log('✅ [STAGE-2] Session scope success');
            stage2Result = resp.result.response;
            
            // For non-cross-session queries, return immediately
            if (!isCrossSessionQuery) {
              console.log('🔍 [STAGE-2] Non-cross-session query, returning session scope result');
              return { success: true, data: { response: resp.result.response } };
            } else {
              console.log('🔍 [STAGE-2] Cross-session query, continuing to search all sessions...');
            }
          }
        }
      }

      // Stage 3: Cross-Session (semantic search across all sessions)
      const s3 = await this.stageSemanticMemory(prompt, { sessionId: null });
      if (s3 && s3.success) {
        const phiPrompt = this.buildStagedPrompt(prompt, { conversationContext: context.conversationContext, memorySnippets: s3.data.snippets });
        const resp = await this.executeAgent('Phi3Agent', {
          action: 'query-phi3-fast',
          prompt: phiPrompt,
          options: { timeout: 13000, maxTokens: 160, temperature: 0.2 }
        });
        if (resp.success && resp.result?.response) {
          console.log('✅ [STAGE-3] Cross-session success');
          stage3Result = resp.result.response;
        }
      }
      
      // Combine results from multiple stages for cross-session queries
      if (isCrossSessionQuery && (stage1Result || stage2Result || stage3Result)) {
        console.log('🔍 [STAGED-SEARCH] Combining results from multiple stages');
        const combinedResults = [stage1Result, stage2Result, stage3Result].filter(Boolean);
        
        if (combinedResults.length > 0) {
          // For cross-session queries, prefer the most comprehensive result
          const finalResult = stage3Result || stage2Result || stage1Result;
          console.log('✅ [STAGED-SEARCH] Cross-session query completed, returning combined result');
          return { success: true, data: { response: finalResult } };
        }
      }
      
      // Fallback: return any single result we found
      if (stage1Result) {
        console.log('✅ [STAGED-SEARCH] Returning Stage 1 result as fallback');
        return { success: true, data: { response: stage1Result } };
      }
      if (stage2Result) {
        console.log('✅ [STAGED-SEARCH] Returning Stage 2 result as fallback');
        return { success: true, data: { response: stage2Result } };
      }
      if (stage3Result) {
        console.log('✅ [STAGED-SEARCH] Returning Stage 3 result as fallback');
        return { success: true, data: { response: stage3Result } };
      }
      
      console.log('📝 [STAGED-SEARCH] No sufficient results from any stage, proceeding to intent classification');
      return null;
      
    } catch (error) {
      console.warn('⚠️ [STAGED-SEARCH] Staged search failed, proceeding to intent classification:', error.message);
      return null;
    }
  }

  /**
   * Build a concise Phi3 prompt using conversation context and/or memory snippets
   */
  buildStagedPrompt(prompt, { conversationContext = '', memorySnippets = [] } = {}) {
    const maxCtx = 1500;
    const convo = conversationContext ? (conversationContext.length > maxCtx ? conversationContext.slice(0, maxCtx) + '...[truncated]' : conversationContext) : '';
    const mem = memorySnippets.join('\n\n');
    const memTrunc = mem.length > maxCtx ? mem.slice(0, maxCtx) + '...[truncated]' : mem;

    if (convo && !memTrunc) {
      return `You are ThinkDrop AI. Answer based on our recent conversation.\n\nRECENT CONVERSATION:\n${convo}\n\nQUESTION: ${prompt}\n\nBe concise (2-4 sentences).`;
    }

    if (convo && memTrunc) {
      return `You are ThinkDrop AI. Use recent conversation and relevant history.\n\nRECENT CONVERSATION:\n${convo}\n\nRELEVANT HISTORY:\n${memTrunc}\n\nQUESTION: ${prompt}\n\nAnswer concisely, prioritizing directly relevant details.`;
    }

    return `You are ThinkDrop AI. Use relevant history to answer.\n\nRELEVANT HISTORY:\n${memTrunc}\n\nQUESTION: ${prompt}\n\nAnswer in 2-4 sentences, focused and specific.`;
  }

  /**
   * Stage 1: Current-scope check using only recent conversation context
   * Returns null if no meaningful context or low relevance
   */
  async stageCurrentScope(prompt, { conversationContext }) {
    if (!conversationContext || conversationContext.length < 40) return null;
    try {
      // Light semantic check: compare embeddings of prompt vs convo sample
      const sample = conversationContext.length > 1200
        ? `${conversationContext.slice(0, 400)}\n...\n${conversationContext.slice(-400)}`
        : conversationContext;

      const [q, c] = await Promise.all([
        this.executeAgent('SemanticEmbeddingAgent', { action: 'generate-embedding', text: prompt }),
        this.executeAgent('SemanticEmbeddingAgent', { action: 'generate-embedding', text: sample })
      ]);

      if (!q.success || !c.success) return null;
      const qv = q.result.embedding, cv = c.result.embedding;
      const dot = qv.reduce((s, v, i) => s + v * cv[i], 0);
      const n1 = Math.sqrt(qv.reduce((s, v) => s + v * v, 0));
      const n2 = Math.sqrt(cv.reduce((s, v) => s + v * v, 0));
      const sim = dot / (n1 * n2 + 1e-8);

      // Lower threshold for conversational recency
      if (sim >= 0.18) {
        const phiPrompt = this.buildStagedPrompt(prompt, { conversationContext: sample, memorySnippets: [] });
        const resp = await this.executeAgent('Phi3Agent', {
          action: 'query-phi3-fast',
          prompt: phiPrompt,
          options: { timeout: 10000, maxTokens: 140, temperature: 0.2 }
        });
        if (resp.success && resp.result?.response) {
          return { success: true, data: { response: resp.result.response, stage: 'current_scope' } };
        }
      }
    } catch (e) {
      console.warn('⚠️ [STAGE-1] Current scope check failed:', e.message);
    }
    return null;
  }

  /**
   * Stage 2/3: Session or Cross-session semantic search via UserMemoryAgent
   */
  async stageSemanticMemory(prompt, { sessionId = null }) {
    const params = {
      action: 'memory-semantic-search',
      query: prompt,
      limit: 20,
      minSimilarity: sessionId ? 0.26 : 0.32
    };
    if (sessionId) params.sessionId = sessionId;

    // Use entity-aware database search
    const res = await this.getEntityFilteredMemories(prompt, params);
    if (!res.success || !res.result?.results?.length) return null;
    
    const memories = res.result.results;
    const top = Math.max(...memories.map(m => m.similarity));
    const avg3 = memories.slice(0, 3).reduce((s, m) => s + m.similarity, 0) / Math.min(3, memories.length);
    const sufficient = top >= (sessionId ? 0.28 : 0.34) || avg3 >= (sessionId ? 0.25 : 0.30);
    if (!sufficient) return null;

    const snippets = memories.slice(0, 3).map((m, i) => {
      const txt = (m.source_text || '').slice(0, 220);
      return `Memory ${i + 1} (${Math.round((m.similarity || 0) * 100)}%): ${txt}${(m.source_text || '').length > 220 ? '...' : ''}`;
    });

    return { success: true, data: { snippets, memories, stage: sessionId ? 'session_scope' : 'cross_session' } };
  }

  /**
   * Extract entities from query using NER, then use them for database-optimized memory filtering
   * Leverages existing memory_entities table with proper joins and indexing
   */
  async getEntityFilteredMemories(prompt, searchParams) {
    try {
      // First extract entities from the query using existing NER system
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const DistilBertIntentParser = require('../utils/DistilBertIntentParser.cjs');
      
      const parser = new DistilBertIntentParser();
      await parser.initialize();
      
      const entities = await parser.extractEntities(prompt);
      console.log(`🏷️ [ENTITY-EXTRACT] Query: "${prompt}" -> Entities:`, entities);
      
      // Collect relevant entity terms
      const relevantTerms = [];
      if (entities.TECHNOLOGY && entities.TECHNOLOGY.length > 0) {
        relevantTerms.push(...entities.TECHNOLOGY);
      }
      if (entities.PROGRAMMING_LANGUAGE && entities.PROGRAMMING_LANGUAGE.length > 0) {
        relevantTerms.push(...entities.PROGRAMMING_LANGUAGE);
      }
      if (entities.FRAMEWORK && entities.FRAMEWORK.length > 0) {
        relevantTerms.push(...entities.FRAMEWORK);
      }
      
      if (relevantTerms.length === 0) {
        // No entities found, use regular semantic search
        console.log('📝 [ENTITY-FILTER] No relevant entities found, using standard semantic search');
        return await this.executeAgent('UserMemoryAgent', searchParams);
      }
      
      // Use database query to find memories with matching entities
      console.log(`🎯 [ENTITY-FILTER] Searching memories with entities: [${relevantTerms.join(', ')}]`);
      
      // Create entity-aware search parameters
      const entitySearchParams = {
        ...searchParams,
        action: 'memory-semantic-search-with-entities',
        entities: relevantTerms
      };
      
      const result = await this.executeAgent('UserMemoryAgent', entitySearchParams);
      
      if (result.success && result.result?.results?.length > 0) {
        console.log(`✅ [ENTITY-FILTER] Found ${result.result.results.length} entity-filtered memories`);
        return result;
      } else {
        // Fallback to regular search if entity search fails
        console.log('⚠️ [ENTITY-FILTER] Entity search failed, falling back to standard search');
        return await this.executeAgent('UserMemoryAgent', searchParams);
      }
      
    } catch (error) {
      console.warn('⚠️ [ENTITY-FILTER] Entity filtering failed, using standard search:', error.message);
      return await this.executeAgent('UserMemoryAgent', searchParams);
    }
  }

  /**
   * LEGACY: Old semantic-first processing (kept for compatibility)
   * @deprecated Use the new staged search above
   */
  async trySemanticSearchFirstLegacy(prompt, options = {}, context = {}) {
    if (options.preferSemanticSearch === false) {
      console.log('🔍 [LEGACY-SEMANTIC] Semantic search disabled by options, skipping...');
      return null;
    }

    console.log('🔍 [LEGACY-SEMANTIC] Attempting legacy semantic search before intent classification...');
    try {
      // For cross-session queries, don't scope to current session
      const searchParams = {
        action: 'memory-semantic-search',
        query: prompt,
        limit: 20,  // Increased from 10 to ensure sufficient cross-session content
        minSimilarity: 0.08  // Lowered to capture all 3 sessions including Chat 3 (0.0808)
      };
      
      // Use LLM to determine if query needs cross-session scope
      let needsCrossSessionScope = false;
      try {
        const scopeClassification = await this.executeAgent('Phi3Agent', {
          action: 'query-phi3-fast',
          prompt: `Analyze this user query and determine if it needs cross-session scope:

Query: "${prompt}"

Does this query refer to information from a DIFFERENT conversation session or ask about historical context across multiple conversations?

Key indicators for CROSS_SESSION:
- "way back", "long ago", "ages ago", "previously", "in the past"
- "ever" (have we ever, did we ever)
- "another conversation", "previous conversation", "other session"
- "didn't mention", "never said", "haven't discussed" (checking across all history)
- References to distant/old conversations or denying past discussions
- Questions about what was discussed across all conversations

Key indicators for CURRENT_SESSION:
- "before" (recently discussed in current conversation)
- "earlier" (in current conversation)
- "we talked about" (likely current session unless specified otherwise)
- "just now", "recently", "a moment ago"

Examples:
- "what framework we talked about before" → recent discussion → CURRENT_SESSION
- "have we ever discussed presidents" → asking about all history → CROSS_SESSION  
- "who was that president I mentioned way back" → distant past → CROSS_SESSION
- "I didn't mention a framework in another conversation" → checking across sessions → CROSS_SESSION
- "was code brought up in a previous conversation" → checking historical context → CROSS_SESSION
- "what framework should I use" → general question → CURRENT_SESSION

Respond with exactly: CURRENT_SESSION or CROSS_SESSION`.trim(),
          options: { 
            timeout: 3000, 
            maxTokens: 5,
            temperature: 0.1
          }
        }, context);
        
        if (scopeClassification.success && scopeClassification.result?.response) {
          needsCrossSessionScope = scopeClassification.result.response.trim().toUpperCase() === 'CROSS_SESSION';
          console.log(`🔍 [SCOPE-DEBUG] LLM classified "${prompt}" as ${needsCrossSessionScope ? 'CROSS_SESSION' : 'CURRENT_SESSION'}`);
        }
      } catch (scopeError) {
        console.warn('⚠️ [SCOPE-DEBUG] Failed to classify scope, defaulting to current session:', scopeError.message);
      }
      
      // Only add session scoping for current-session queries
      if (!needsCrossSessionScope) {
        searchParams.sessionId = context.currentSessionId; // Prevent cross-session contamination for current-session queries
      }
      
      const semanticResult = await this.executeAgent('UserMemoryAgent', searchParams, {
        source: 'semantic_first_orchestrator',
        timestamp: new Date().toISOString()
      });
      
      if (semanticResult.success && semanticResult.result?.results && semanticResult.result.results.length > 0) {
        const memories = semanticResult.result.results;
        const topScore = Math.max(...memories.map(m => m.similarity));
        const avgTop3Score = memories.slice(0, 3).reduce((sum, m) => sum + m.similarity, 0) / Math.min(3, memories.length);
        
        console.log(`🎯 [SEMANTIC-FIRST] Found ${memories.length} memories - top: ${topScore.toFixed(3)}, avg3: ${avgTop3Score.toFixed(3)}`);
        
        // Debug: Log memory content for conversational queries (will be determined by LLM later)
        const debugConversationalPattern = /\b(first|last|earlier|before|after|previous|next|what.*(ask|say|said|tell|told)|sum up|summary|summarize|recap|overview|what.*(chat|discuss|talk)|what.*message|what.*conversation|2nd|second|third|1st)\b/i.test(prompt);
        if (debugConversationalPattern && memories.length > 0) {
          console.log('🔍 [DEBUG] Potential conversational query detected, found memories:');
          memories.slice(0, 3).forEach((memory, index) => {
            console.log(`  Memory ${index + 1} (${(memory.similarity * 100).toFixed(1)}%): "${memory.source_text?.substring(0, 100)}..."`);
          });
        }
        
        // Semantic-first thresholds (optimized for fast path - more aggressive)
        const hasRelevantMemories = topScore >= 0.25 || avgTop3Score >= 0.22;
        
        if (hasRelevantMemories) {
          console.log('✅ [SEMANTIC-FIRST] FAST PATH - Using memories for immediate response');
          
          // Build memory context string from top memories with entity filtering
          let relevantMemories = memories.slice(0, 3);
        
          // If user mentions specific technologies, filter memories for relevance
          const userQuery = prompt.toLowerCase();
          const mentionedTechs = ['svelte', 'sveltejs', 'react', 'python', 'javascript', 'typescript'];
          const queryTech = mentionedTechs.find(tech => userQuery.includes(tech));
        
          if (queryTech) {
            // Prioritize memories that mention the same technology
            const techRelevantMemories = memories.filter(memory => 
              memory.source_text.toLowerCase().includes(queryTech)
            );
            
            if (techRelevantMemories.length > 0) {
              relevantMemories = techRelevantMemories.slice(0, 2);
              console.log(`🎯 [CONTEXT-FILTER] Filtered memories for ${queryTech}: ${relevantMemories.length} relevant`);
            }
          }
        
          const memoryContext = relevantMemories.map((memory, index) => {
            const preview = memory.source_text.length > 150 
              ? memory.source_text.substring(0, 150) + '...'
              : memory.source_text;
            return `Memory ${index + 1} (${Math.round(memory.similarity * 100)}% match): ${preview}`;
          }).join('\n\n');
          
          console.log(`🔍 [DEBUG] Memory context being passed to Phi3:`, memoryContext.substring(0, 500) + '...');
          
          // Use LLM-based conversational query detection for more accurate classification
          let isConversationalQuery = false;
          let isPositionalQuery = false;
          
          try {
            const classificationResult = await this.executeAgent('UserMemoryAgent', {
              action: 'classify-conversational-query',
              query: prompt
            }, context);
            
            if (classificationResult.success && classificationResult.result && classificationResult.result.result) {
              console.log(`🔍 [DEBUG] Raw classification result:`, classificationResult.result);
              const actualResult = classificationResult.result.result;
              isConversationalQuery = actualResult.isConversational;
              isPositionalQuery = actualResult.type === 'positional';
              console.log(`🔍 [DEBUG] Processed values: isConversationalQuery=${isConversationalQuery}, isPositionalQuery=${isPositionalQuery}`);
              console.log(`🔍 [DEBUG] LLM classified "${prompt}" as ${isConversationalQuery ? 'CONVERSATIONAL' : 'NON-CONVERSATIONAL'} (${actualResult.type || 'general'})`);
            } else {
              console.log(`🔍 [DEBUG] Classification failed:`, classificationResult);
              throw new Error('UserMemoryAgent classification failed');
            }
          } catch (error) {
            console.warn('⚠️ [DEBUG] LLM classification failed, falling back to regex:', error.message);
            // Fallback to regex if LLM classification fails
            isConversationalQuery = /\b(first|last|earlier|before|after|previous|next|what.*(ask|say|said|tell|told)|sum up|summary|summarize|recap|overview|what.*(chat|discuss|talk)|what.*message|what.*conversation|2nd|second|third|1st)\b/i.test(prompt);
            isPositionalQuery = /\b(first|last|earliest|latest|initial|1st|2nd|second|third)\s*(message|thing|question|ask)\b/i.test(prompt);
          }
          
          let enhancedPrompt;
        if (isConversationalQuery) {
          // Build conversation context - include cross-session data if available and needed
          let conversationContext = context.conversationContext || '';
          
          // Check if we have cross-session conversation messages in memories
          const crossSessionMessages = memories.filter(m => {
            // For cross-session queries, look for messages from different sessions
            // Use AgentOrchestrator's scope classification (needsCrossSessionScope) as primary authority
            const isCrossSession = needsCrossSessionScope && m.session_id && m.session_id !== context.currentSessionId;
            const isConversationMessage = m.responseType === 'conversation_message' || 
                                        m.source_text?.includes('user:') || 
                                        m.source_text?.includes('ai:') ||
                                        m.sender; // Has sender field indicating it's a conversation message
            
            // For cross-session queries, include ALL conversation messages regardless of session
            // since the AgentOrchestrator already determined this needs cross-session scope
            const isFromCrossSessionSearch = needsCrossSessionScope && isConversationMessage;
            
            return (isCrossSession || isFromCrossSessionSearch) && isConversationMessage;
          });
          
          console.log(`🔍 [CROSS-SESSION-DEBUG] Filtering memories: total=${memories.length}, crossSession=${crossSessionMessages.length}`);
          console.log(`🔍 [CROSS-SESSION-DEBUG] Current session ID: ${context.currentSessionId}`);
          
          // Debug: Show structure of ALL memories to see session distribution
          const sessionDistribution = {};
          memories.forEach((memory, index) => {
            const sessionId = memory.session_id || 'NO_SESSION';
            sessionDistribution[sessionId] = (sessionDistribution[sessionId] || 0) + 1;
            
            if (index < 5) { // Show first 5 memories
              console.log(`🔍 [CROSS-SESSION-DEBUG] Memory ${index + 1} structure:`, {
                session_id: memory.session_id,
                responseType: memory.responseType,
                sender: memory.sender,
                source_text_preview: memory.source_text?.substring(0, 50) + '...',
                has_user_colon: memory.source_text?.includes('user:'),
                has_ai_colon: memory.source_text?.includes('ai:'),
                sessionTitle: memory.sessionTitle,
                sessionType: memory.sessionType,
                sessionSimilarity: memory.sessionSimilarity
              });
            }
          });
          
          console.log(`🔍 [CROSS-SESSION-DEBUG] Session distribution:`, sessionDistribution);
          
          if (crossSessionMessages.length > 0) {
            console.log(`🔍 [CROSS-SESSION-DEBUG] Sample cross-session message:`, {
              session_id: crossSessionMessages[0].session_id,
              responseType: crossSessionMessages[0].responseType,
              sender: crossSessionMessages[0].sender,
              preview: crossSessionMessages[0].source_text?.substring(0, 100)
            });
          }
          
          if (needsCrossSessionScope && crossSessionMessages.length > 0) {
            // Build cross-session conversation context
            const crossSessionContext = crossSessionMessages
              .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) // Sort by time
              .map(msg => `${msg.sender}: ${msg.source_text}`)
              .join('\n');
            
            conversationContext = crossSessionContext + '\n\n[CURRENT SESSION]\n' + conversationContext;
            console.log(`🔍 [CROSS-SESSION-DEBUG] Added ${crossSessionMessages.length} cross-session messages to context`);
          }
          
          const universalContext = conversationContext ? `\nRECENT CONVERSATION CHAIN:\n${conversationContext}\n` : '';
          
          console.log(`🔍 [SEMANTIC-DEBUG] Building conversational prompt with context:`, {
            hasUniversalContext: !!conversationContext,
            universalContextLength: conversationContext?.length || 0,
            universalContextPreview: conversationContext?.substring(0, 100) || 'NONE',
            hasCrossSessionData: crossSessionMessages.length > 0,
            crossSessionMessages: crossSessionMessages.length
          });
          
          // Always use the enhanced conversational prompt for any conversational query
          // Truncate context if too long to prevent prompt corruption
          const maxContextLength = 1500; // Reasonable limit to prevent truncation
          const truncatedUniversalContext = universalContext.length > maxContextLength 
            ? universalContext.substring(0, maxContextLength) + '...[truncated]'
            : universalContext;
          const truncatedMemoryContext = memoryContext.length > maxContextLength
            ? memoryContext.substring(0, maxContextLength) + '...[truncated]'
            : memoryContext;
            
          // For conversational queries, determine if conversation context is more relevant than stored memories
          // Use semantic similarity to make this decision intelligently
          let useConversationContextPrimarily = false;
          
          if (context.conversationContext && context.conversationContext.length > 100) {
            try {
              // For conversational queries about "what we talked about", prioritize conversation context
              const isAboutPastConversation = /\b(we|us|our|talked|discussed|mentioned|said|conversation|chat)\b/i.test(prompt);
              
              if (isAboutPastConversation) {
                // For cross-session queries, prioritize cross-session context over current session context
                if (needsCrossSessionScope && crossSessionMessages.length > 0) {
                  useConversationContextPrimarily = true;
                  console.log(`🔍 [SEMANTIC-DEBUG] Cross-session query detected, prioritizing cross-session conversation context`);
                } else {
                  // For current session queries, use current session conversation context
                  useConversationContextPrimarily = true;
                  console.log(`🔍 [SEMANTIC-DEBUG] Detected past conversation query, prioritizing current session conversation context`);
                }
              } else {
                // Generate embeddings for both the query and conversation context
                const queryEmbedding = await this.executeAgent('SemanticEmbeddingAgent', {
                  action: 'generate-embedding',
                  text: prompt
                }, context);
                
                // Sample beginning, middle, and end of conversation for comprehensive matching
                let contextSample;
                if (context.conversationContext.length > 1200) {
                  const length = context.conversationContext.length;
                  const beginning = context.conversationContext.substring(0, 300);
                  const middle = context.conversationContext.substring(Math.floor(length / 2) - 150, Math.floor(length / 2) + 150);
                  const end = context.conversationContext.substring(length - 300);
                  contextSample = `${beginning}\n...\n${middle}\n...\n${end}`;
                } else {
                  contextSample = context.conversationContext;
                }
                
                const contextEmbedding = await this.executeAgent('SemanticEmbeddingAgent', {
                  action: 'generate-embedding', 
                  text: contextSample
                }, context);
                
                if (queryEmbedding.success && contextEmbedding.success) {
                  // Calculate semantic similarity between query and conversation context
                  const similarity = this.cosineSimilarity(
                    queryEmbedding.result.embedding,
                    contextEmbedding.result.embedding
                  );
                  
                  // Lower threshold for conversational queries (0.15 instead of 0.3)
                  useConversationContextPrimarily = similarity > 0.15;
                  console.log(`🔍 [SEMANTIC-DEBUG] Query-Context similarity: ${similarity.toFixed(3)}, using conversation context: ${useConversationContextPrimarily}`);
                }
              }
            } catch (embeddingError) {
              console.warn('⚠️ [SEMANTIC-DEBUG] Failed to compute context relevance, using fallback logic:', embeddingError.message);
              // Fallback: use conversation context if it's substantial and memories are sparse
              useConversationContextPrimarily = memories.length < 3 && context.conversationContext.length > 500;
            }
          }
          
          if (useConversationContextPrimarily) {
            enhancedPrompt = `You are ThinkDrop AI. Answer based on our recent conversation.

RECENT CONVERSATION:
${truncatedUniversalContext}

QUESTION: ${prompt}

Answer based on what we discussed in our recent conversation above. Be specific and reference the actual content we talked about.`.trim();
          } else {
            enhancedPrompt = `You are ThinkDrop AI. Answer naturally about our conversation history.

RECENT CONTEXT:
${truncatedUniversalContext}

RELEVANT HISTORY:
${truncatedMemoryContext}

QUESTION: ${prompt}

Answer naturally and conversationally.`.trim();
          }
        } else {
            enhancedPrompt = `You are ThinkDrop AI. Use the information below to answer the question.

RELEVANT INFORMATION:
${memoryContext}

USER QUESTION:
${prompt}

INSTRUCTIONS:
- Answer in natural, conversational language (NOT JSON format)
- Be CONCISE and to the point (2-3 sentences max)
- Focus specifically on what the user asked about
- Reference the provided information when directly relevant
- If user asks about SvelteJS, focus on SvelteJS (not other technologies)
- Do not include these instructions in your answer

ANSWER:`.trim();
        }

        console.log(`🔍 [DEBUG] Final prompt being sent to Phi3:`, enhancedPrompt.substring(0, 800) + '...');
          
          try {
            const phi3Result = await this.executeAgent('Phi3Agent', {
              action: 'query-phi3-fast',
              prompt: enhancedPrompt,
              options: { 
                timeout: 15000, 
                maxTokens: isConversationalQuery ? 150 : 100, // Reduced tokens for concise responses
                temperature: 0.1 // Lower temperature for more precise conversational responses
              }
            }, {
              source: 'semantic_first_enhanced',
              timestamp: new Date().toISOString()
            });
            
            if (phi3Result.success && phi3Result.result?.response) {
              console.log('🎉 [SEMANTIC-FIRST] FAST PATH SUCCESS - Returning enhanced response');
              
              // BACKGROUND PROCESSING: Store question context in memory for future retrieval
              setImmediate(async () => {
                try {
                  console.log('🚀 [BACKGROUND] Storing semantic question context in memory...');
                  
                  // Extract entities for semantic-first path using DistilBertIntentParser
                  let extractedEntities = {};
                  try {
                    const { createRequire } = await import('module');
                    const require = createRequire(import.meta.url);
                    const DistilBertIntentParser = require('../utils/DistilBertIntentParser.cjs');
                    
                    const parser = new DistilBertIntentParser();
                    await parser.initialize();
                    
                    extractedEntities = await parser.extractEntities(prompt);
                    console.log('🏷️ [BACKGROUND] Extracted entities for memory storage:', extractedEntities);
                  } catch (entityError) {
                    console.warn('⚠️ [BACKGROUND] Entity extraction failed, storing without entities:', entityError.message);
                  }
                  
                  // Store the AI response, not the user question
                  const aiResponse = phi3Result.result.response;
                  
                  // Also extract entities from the AI response for better context
                  let responseEntities = {};
                  try {
                    // Reuse the same parser instance
                    const aiResponseEntities = await parser.extractEntities(aiResponse);
                    responseEntities = aiResponseEntities;
                    console.log('🏷️ [BACKGROUND] Extracted entities from AI response:', responseEntities);
                  } catch (responseEntityError) {
                    console.warn('⚠️ [BACKGROUND] Failed to extract entities from AI response:', responseEntityError.message);
                    responseEntities = {}; // Fallback to empty object
                  }
                  
                  // Combine entities from both user question and AI response
                  const combinedEntities = {};
                  Object.keys(extractedEntities).forEach(key => {
                    combinedEntities[key] = [...new Set([
                      ...(extractedEntities[key] || []),
                      ...(responseEntities[key] || [])
                    ])];
                  });
                  
                  const memoryStoreResult = await this.executeAgent('UserMemoryAgent', {
                    action: 'memory-store',
                    sourceText: aiResponse, // Store the AI response, not the user question
                    entities: combinedEntities, // Use combined entities
                    category: 'ai_response',
                    metadata: {
                      intent: 'semantic_enhanced_response',
                      timestamp: new Date().toISOString(),
                      confidence: 0.9,
                      userQuestion: prompt, // Keep the original question as metadata
                      memoriesUsed: memories.length,
                      topSimilarity: topScore,
                      method: 'semantic_first_fast_path'
                    }
                  }, {
                    ...context,
                    executeAgent: this.executeAgent.bind(this)
                  });
                  
                  if (memoryStoreResult.success) {
                    console.log('✅ [BACKGROUND] Semantic question context stored in memory');
                  } else {
                    console.warn('⚠️ [BACKGROUND] Failed to store semantic question context:', memoryStoreResult.error);
                  }
                } catch (memoryError) {
                  console.warn('⚠️ [BACKGROUND] Memory storage failed for semantic question:', memoryError.message);
                }
              });
              
              return {
                success: true,
                data: phi3Result.result.response,
                intentClassificationPayload: {
                  primaryIntent: 'semantic_enhanced_response',
                  intents: [{ intent: 'semantic_enhanced_response', confidence: 0.9, reasoning: 'Semantic search found relevant memories' }],
                  entities: [],
                  requiresMemoryAccess: true,
                  requiresExternalData: false,
                  captureScreen: false,
                  suggestedResponse: phi3Result.result.response,
                  sourceText: prompt,
                  memoriesUsed: memories.length,
                  topSimilarity: topScore,
                  method: 'semantic_first_fast_path',
                  timestamp: new Date().toISOString()
                }
              };
            }
          } catch (phi3Error) {
            console.warn('⚠️ [SEMANTIC-FIRST] Phi3 failed for semantic response, continuing to intent classification:', phi3Error.message);
          }
        }
      }
      
      console.log('📝 [SEMANTIC-FIRST] No relevant memories found, proceeding to intent classification...');
      return null;
    } catch (semanticError) {
      console.warn('⚠️ [SEMANTIC-FIRST] Semantic search failed, proceeding to intent classification:', semanticError.message);
      return null;
    }
  }

  /**
   * Direct question processing: Handle evergreen general knowledge questions immediately with Phi3
   * @param {string} prompt - User message
   * @param {Object} routingDecision - NER routing decision
   * @param {Object} options - Processing options
   * @returns {Object|null} - Direct response if handled, null if should continue to orchestration
   */
  async tryDirectQuestionFirst(prompt, routingDecision, options = {}) {
    // Handle case where NER routing failed - create fallback for potential questions
    if (!routingDecision) {
      // Simple heuristic: if it looks like a question, treat it as one
      const looksLikeQuestion = /^(what|who|when|where|why|how|which|is|are|do|does|did|can|could|would|should|will)\b/i.test(prompt.trim());
      if (!looksLikeQuestion) {
        return null;
      }
      
      // Create fallback routing decision for question-like prompts
      routingDecision = {
        primaryIntent: 'question',
        confidence: 0.5,
        entities: {},
        needsOrchestration: true
      };
    }
    
    // Only handle questions (orchestration is expected for questions, so we'll filter ourselves)
    if (routingDecision.primaryIntent !== 'question') {
      return null;
    }

    const text = prompt.trim();

    // Early exit: Treat modal requests as commands, not questions
    if (/^(can|could|would|will)\s+you\b/i.test(text)) {
      return null;
    }

    // 1) Stale-risk gate: Auto-route time-sensitive queries to orchestration
    if (this._isStaleRisk(text)) {
      console.log('⏰ [EARLY-QUESTION] Time-sensitive query detected, routing to orchestration');
      return null;
    }

    // 2) General knowledge detector: Only handle evergreen, timeless questions
    if (!this._isEvergreenGK(text)) {
      console.log('🔍 [EARLY-QUESTION] Not detected as evergreen GK, routing to orchestration');
      return null;
    }
  
    console.log('✅ [EARLY-QUESTION] Detected as evergreen GK question');

    // 3) Safety guards: Route computational/sensitive queries appropriately
    if (this._looksComputational(text)) {
      console.log('🔢 [EARLY-QUESTION] Computational query detected, routing to orchestration');
      return null;
    }
    
    if (this._isSensitiveDomain(text)) {
      console.log('⚠️ [EARLY-QUESTION] Sensitive domain detected, routing to orchestration');
      return null;
    }

    console.log('🚀 [EARLY-QUESTION] All checks passed - handling evergreen GK question directly with Phi3...');
    console.log('🔍 [EARLY-QUESTION] Question text:', text);
    try {
      const phi3Agent = this.getAgent('Phi3Agent');
      if (!phi3Agent) {
        console.warn('⚠️ [EARLY-QUESTION] Phi3Agent not available, falling back to orchestration');
        return null;
      }

      // Add timeout for safety
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 1600);

      // Extract conversation context from options for chain awareness
      const conversationContext = options.conversationContext ? `\n\nRECENT CONVERSATION CONTEXT:\n${options.conversationContext}\n` : '';

      console.log(`🔍 [DIRECT-QUESTION-DEBUG] Context info:`, {
        hasConversationContext: !!options.conversationContext,
        contextLength: options.conversationContext?.length || 0,
        contextPreview: options.conversationContext?.substring(0, 100) || 'NONE'
      });

      const directResponse = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: `You are answering an evergreen general-knowledge question.${conversationContext}
- Be concise (2-4 sentences).
- If there's conversation context above, use it to provide a more relevant response.
- If the answer depends on current events or post-2023 facts, say you are not sure.
- Do NOT invent current prices, office holders, dates, or scores.

Question: ${text}
Answer:`,
        options: {
          temperature: 0.2,
          maxTokens: 180,
          timeout: options.timeoutMs ?? 1600,
          signal: controller.signal
        }
      }).finally(() => clearTimeout(timeout));
      
      // Validate response quality
      const answer = directResponse?.response?.trim();
      if (!answer || /^i('?| a)m not sure|i don'?t know/i.test(answer)) {
        console.log('⚠️ [EARLY-QUESTION] Phi3 response uncertain, routing to orchestration');
        return null;
      }

      if (directResponse && directResponse.response) {
        console.log('✅ [EARLY-QUESTION] Direct Phi3 response successful');
        console.log('🔍 [EARLY-QUESTION] Phi3 response content:', directResponse.response);
        return {
          success: true,
          response: directResponse.response,
          handledBy: 'early_question_handler',
          method: 'direct_phi3_evergreen',
          timestamp: new Date().toISOString()
        };
      }
      
      return null;
      
    } catch (error) {
      console.warn('⚠️ [EARLY-QUESTION] Direct handling failed, falling back to orchestration:', error.message);
      return null;
    }
  }

  /**
   * Check if query has stale-risk (time-sensitive, current events, post-2023 facts)
   * @private
   */
  _isStaleRisk(text) {
    const recencyKeywords = /\b(current|latest|today|tonight|now|this (week|month|year)|recent|up[- ]?to[- ]?date|live|breaking|update|patch|release)\b/i.test(text);
    const staleCategories = /\b(price|cost|deal|sale|release|version|changelog|score|standings|ranking|game|match|weather|forecast|traffic|stock|crypto|exchange rate|election|president|governor|mayor|schedule|timetable|news)\b/i.test(text);
    const futureYear = /20(2[4-9]|3\d)\b/.test(text); // 2024+ mentioned
    // Only treat relative date phrases as stale if paired with a time unit
    const relativeDates = /\b(yesterday|tomorrow|(last|next|this)\s+(week|month|year|night|evening|morning|quarter))\b/i.test(text);
    
    return recencyKeywords || staleCategories || futureYear || relativeDates;
  }

  /**
   * Check if query is evergreen general knowledge (timeless, stable facts)
   * @private
   */
  _isEvergreenGK(text) {
    // Avoid "how to" procedures - route those elsewhere
    if (/\bhow to\b/i.test(text)) {
      return false;
    }
    
    // Definitions, timeless facts, classical science, math theory
    const definitionLike = /\b(what is|define|explain|describe|difference between|why does|how does\b.*\bwork)\b/i.test(text);
    const conceptualQuestions = /\b(concept|theory|principle|law|rule|definition|meaning)\b/i.test(text);
    const timelessTopics = /\b(photosynthesis|mitochondria|pythagorean|algorithm|http|dns|binary|sorting|recursion|data structure|gravity|evolution|geometry|algebra|calculus|thermodynamics|cellular respiration)\b/i.test(text);
    
    // Must not have stale-risk indicators
    const noStaleRisk = !this._isStaleRisk(text);
    
    return (definitionLike || conceptualQuestions || timelessTopics) && noStaleRisk;
  }

  /**
   * Check if query looks computational (needs calculator/tools)
   * @private
   */
  _looksComputational(text) {
    return /(\d+\s*[\+\-×x\*\/]\s*\d+)|\bpercent of\b|\b(convert|compute|calculate|solve|average|median|mode|derivative|integral|probability|p-value)\b/i.test(text);
  }

  /**
   * Check if query is in sensitive domain (medical, legal, financial advice)
   * @private
   */
  _isSensitiveDomain(text) {
    return /\b(diagnosis|symptom|treatment|dosage|medication|legal advice|contract|lease|tax|investment|financial advice|lawsuit|medical|health)\b/i.test(text);
  }

  /**
   * Execute multiple agents in a workflow (agent-to-agent communication)
   * @param {Array} workflow - Array of {agent, params, context} objects
   * @param {Object} sharedContext - Context shared across all agents
   * @returns {Object} Combined results from all agents
   */
  async executeWorkflow(workflow, sharedContext = {}) {
    console.log(`🔄 Executing workflow with ${workflow.length} agents`);
    
    // Initialize workflow state
    const workflowState = {
      workflow,
      currentStep: 0,
      results: [],
      context: { ...sharedContext },
      status: 'running',
      paused: false
    };
    
    // Create workflow control functions
    const workflowControls = this.createWorkflowControls(workflowState);
    
    // Add workflow controls to context for agents to use
    workflowState.context.workflowControls = workflowControls;
    
    return await this.executeWorkflowSteps(workflowState);
  }

  /**
   * Create workflow control functions for agent-to-agent communication
   * @param {Object} workflowState - Current workflow state
   * @returns {Object} Workflow control functions
   */
  createWorkflowControls(workflowState) {
    return {
      start: (stepIndex = 0) => {
        console.log(`🚀 Workflow start() called - jumping to step ${stepIndex}`);
        workflowState.currentStep = stepIndex;
        workflowState.status = 'running';
        workflowState.paused = false;
        return { action: 'start', targetStep: stepIndex };
      },
      
      next: (stepIndex = null) => {
        const targetStep = stepIndex !== null ? stepIndex : workflowState.currentStep + 1;
        console.log(`⏭️ Workflow next() called - jumping to step ${targetStep}`);
        workflowState.currentStep = targetStep;
        return { action: 'next', targetStep };
      },
      
      stop: (reason = 'Manual stop') => {
        console.log(`🛑 Workflow stop() called - ${reason}`);
        workflowState.status = 'stopped';
        return { action: 'stop', reason };
      },
      
      pause: (reason = 'Manual pause') => {
        console.log(`⏸️ Workflow pause() called - ${reason}`);
        workflowState.paused = true;
        return { action: 'pause', reason };
      },
      
      // Utility functions for agents
      getCurrentStep: () => workflowState.currentStep,
      getTotalSteps: () => workflowState.workflow.length,
      getResults: () => workflowState.results,
      getContext: () => workflowState.context,
      getStatus: () => workflowState.status
    };
  }

  /**
   * Execute workflow steps with control flow support
   * @param {Object} workflowState - Workflow state object
   * @returns {Object} Workflow execution result
   */
  async executeWorkflowSteps(workflowState) {
    const { workflow, context } = workflowState;
    
    while (workflowState.currentStep < workflow.length && workflowState.status === 'running') {
      // Check if workflow is paused
      if (workflowState.paused) {
        console.log(`⏸️ Workflow paused at step ${workflowState.currentStep}`);
        break;
      }
      
      const step = workflow[workflowState.currentStep];
      const { agent, params, context: stepContext = {} } = step;
      
      // Executing workflow step
      
      try {
        // Execute agent with accumulated context and previous results
        const stepResult = await this.executeAgent(agent, params, {
          ...context,
          ...stepContext,
          previousResults: workflowState.results,
          currentStep: workflowState.currentStep,
          totalSteps: workflow.length,
          workflowControls: context.workflowControls
        });
        
        workflowState.results.push(stepResult);
        
        // Add result to shared context for next agents
        context[`${agent}_result`] = stepResult;
        context[`step_${workflowState.currentStep}_result`] = stepResult;
        
        // Check if agent used workflow controls
        if (stepResult.result && stepResult.result.workflowControl) {
          const control = stepResult.result.workflowControl;
          console.log(`🎛️ Agent ${agent} used workflow control: ${control.action}`);
          
          switch (control.action) {
            case 'next':
              workflowState.currentStep = control.targetStep;
              continue;
            case 'stop':
              workflowState.status = 'stopped';
              break;
            case 'pause':
              workflowState.paused = true;
              break;
            default:
              workflowState.currentStep++;
          }
        } else {
          // Normal progression to next step
          workflowState.currentStep++;
        }
        
        // Stop workflow if step fails (unless configured to continue)
        if (!stepResult.success && !step.continueOnError) {
          console.error(`❌ Workflow stopped at step ${workflowState.currentStep} due to error`);
          workflowState.status = 'failed';
          break;
        }
        
      } catch (error) {
        console.error(`❌ Error executing step ${workflowState.currentStep}:`, error);
        workflowState.results.push({
          success: false,
          agent,
          action: params.action,
          error: error.message,
          step: workflowState.currentStep,
          timestamp: new Date().toISOString()
        });
        
        if (!step.continueOnError) {
          workflowState.status = 'failed';
          break;
        }
        
        workflowState.currentStep++;
      }
    }
    
    // Determine final status
    const finalStatus = workflowState.status === 'running' ? 'completed' : workflowState.status;
    
    return {
      success: workflowState.results.every(r => r.success) && finalStatus === 'completed',
      workflow: true,
      status: finalStatus,
      steps: workflowState.results.length,
      totalSteps: workflow.length,
      currentStep: workflowState.currentStep,
      results: workflowState.results,
      paused: workflowState.paused,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Safe JSON stringify that handles BigInt values
   */
  safeJsonStringify(obj, space = null) {
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, space);
  }

  /**
   * Local LLM fallback orchestration - handles local intent parsing with Phi3 when backend is disconnected
   * @param {string} userMessage - User message to process
   * @param {Object} intentDataOrContext - Pre-classified intent data OR context object (for backward compatibility)
   * @param {Object} context - Additional context for processing
   * @returns {Object} Orchestration result
   */
  async handleLocalOrchestration(userMessage, intentDataOrContext = {}, context = {}) {
    if (!this.initialized) {
      throw new Error('AgentOrchestrator not initialized. Call initialize() first.');
    }

    try {
      console.log('🔄 Local LLM orchestration started');
      console.log('📝 User message:', userMessage);
      
      // Check if we received pre-classified intent data
      const hasPreClassifiedIntent = intentDataOrContext && 
        (intentDataOrContext.primaryIntent || intentDataOrContext.intents);
      
      let intentResult;
      
      if (hasPreClassifiedIntent) {
        console.log('✅ Using pre-classified intent data (avoiding redundant classification)');
        console.log('🎯 Pre-classified intent:', intentDataOrContext.primaryIntent);
        
        // Handle suggestedResponse for memory_retrieve with async import
        let suggestedResponse = intentDataOrContext.suggestedResponse || null;
        console.log(`[DEBUG] Setting suggestedResponse for ${intentDataOrContext.primaryIntent}: ${suggestedResponse}`);
        
        // For memory_retrieve, use IntentParser's centralized fallback response
        if (intentDataOrContext.primaryIntent === 'memory_retrieve' && !suggestedResponse) {
          try {
            const { createRequire } = await import('module');
            const require = createRequire(import.meta.url);
            const parserFactory = require('../utils/IntentParserFactory.cjs');
            const parser = await parserFactory.getParserForUseCase('fast-fallback');
            suggestedResponse = parser.getFallbackResponse('memory_retrieve', userMessage);
          } catch (error) {
            console.warn('Failed to load IntentParser, using fallback:', error);
            suggestedResponse = IntentResponses.getSuggestedResponse('memory_retrieve', userMessage);
          }
        }
        
        // Use the pre-classified intent data directly
        intentResult = {
          success: true,
          result: {
            intent: intentDataOrContext.primaryIntent,
            confidence: intentDataOrContext.confidence || 0.8,
            entities: intentDataOrContext.entities || [],
            category: 'general',
            requiresContext: false,
            method: 'pre_classified',
            captureScreen: intentDataOrContext.captureScreen === true,
            requiresMemoryAccess: intentDataOrContext.requiresMemoryAccess === true,
            suggestedResponse: suggestedResponse,
            sourceText: intentDataOrContext.sourceText || userMessage
          }
        };
      } else {
        console.log('🤖 No pre-classified intent data, using local Phi3-based intent parsing...');
        // Backward compatibility: treat intentDataOrContext as context
        const mergedContext = { ...intentDataOrContext, ...context };
        intentResult = await this.executeLocalIntentParsing(userMessage, mergedContext);
      }
      
      if (!intentResult.success) {
        console.warn('⚠️ Local intent parsing failed, using fallback response');
        return {
          success: true,
          response: 'I\'m having trouble understanding your request right now. Could you please rephrase it?',
          handledBy: 'fallback',
          method: 'error_fallback',
          timestamp: new Date().toISOString()
        };
      }
      
      // Process the intent result and create appropriate response
      const orchestrationResult = await this.processLocalIntentResult(intentResult, userMessage, context);
      
      console.log('✅ Local LLM orchestration completed');
      return orchestrationResult;
      
    } catch (error) {
      console.error('❌ Local LLM orchestration failed:', error);
      return {
        success: false,
        error: error.message,
        response: 'I encountered an error processing your request. Please try again.',
        handledBy: 'error_handler',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Execute local intent parsing using Phi3Agent via IntentParserAgent_phi3_embedded
   */
  async executeLocalIntentParsing(userMessage, context = {}) {
    try {
      console.log('🧠 Executing local intent parsing with Phi3...');
      
      // Use IntentParserAgent_phi3_embedded for local intent parsing
      const intentResult = await this.executeAgent('IntentParserAgent_phi3_embedded', {
        action: 'parse-intent-enhanced',
        message: userMessage,
        userContext: context.userContext || {}
      }, {
        ...context,
        executeAgent: this.executeAgent.bind(this) // Provide agent-to-agent communication
      });
      
      if (!intentResult.success) {
        console.warn('⚠️ IntentParserAgent_phi3_embedded failed:', intentResult.error);
        return { success: false, error: intentResult.error };
      }
      
      console.log('✅ Local intent parsing successful:', intentResult.result);
      // Reduced verbose logging - only log intent classification result
      const actualResult = intentResult.result.result;
      const actualMetadata = intentResult.result.metadata;
      
      console.log(`[INFO] Intent classified as: ${actualResult.intent} (confidence: ${actualResult.confidence || 'N/A'})`);
      console.log('🔍 DEBUG: actualResult.intent:', actualResult.intent);
      
      return {
        success: true,
        intent: actualResult.intent,
        confidence: actualResult.confidence,
        entities: actualResult.entities || [],
        category: actualResult.category || 'general',
        method: actualMetadata?.method || 'local',
        requiresContext: actualResult.requiresContext || false
      };
      
    } catch (error) {
      console.error('❌ Local intent parsing execution failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process local intent result and generate appropriate response
   */
  async processLocalIntentResult(intentResult, userMessage, context = {}) {
    try {
      const { intent, confidence, entities, category, method } = intentResult?.result;
      
      console.log('🔍 DEBUG: intentResult in processLocalIntentResult:', JSON.stringify(intentResult, null, 2));
      console.log(`🎯 Processing intent: ${intent} (confidence: ${confidence}, method: ${method})`);
      
      // Handle different intent types with local processing
      switch (intent) {
        case 'command':
          // Route command intents through unified orchestration for proper agent selection
          console.log('🎯 Routing command intent through unified orchestration...');
          return await this.processUnifiedOrchestration(userMessage, intentResult.result, context);
          
        case 'memory_store':
          return await this.handleLocalMemoryStore(userMessage, intentResult.result, context);
          
        case 'memory_retrieve':
          return await this.handleLocalMemoryRetrieve(userMessage, entities, context);

        case 'greeting':
          return this.handleLocalGreeting(userMessage, context);
          
        case 'question':
        default:
          return await this.handleLocalQuestion(userMessage, intentResult, context);
      }
      
    } catch (error) {
      console.error('❌ Local intent result processing failed:', error);
      return {
        success: false,
        error: error.message,
        response: 'I had trouble processing your request. Please try again.',
        handledBy: 'error_handler',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Process command intents through unified orchestration for proper agent routing
   */
  async processUnifiedOrchestration(userMessage, intentData, context = {}) {
    try {
      console.log('🎯 Processing unified orchestration for command intent...');
      console.log('📋 Intent data:', { 
        intent: intentData.intent, 
        captureScreen: intentData.captureScreen,
        entities: intentData.entities 
      });
      
      // Create intent payload for unified orchestration
      const intentPayload = {
        type: intentData.intent,
        message: userMessage,
        intents: [{
          intent: intentData.intent,
          confidence: intentData.confidence || 0.8,
          reasoning: 'Local Phi3 classification'
        }],
        primaryIntent: intentData.intent,
        entities: intentData.entities || [],
        requiresMemoryAccess: intentData.requiresMemoryAccess === true,
        requiresExternalData: intentData.requiresExternalData === true,
        captureScreen: intentData.captureScreen === true,
        suggestedResponse: intentData.intent === 'memory_retrieve' ? null : intentData.suggestedResponse,
        sourceText: userMessage,
        timestamp: new Date().toISOString(),
        context: {
          source: 'local_unified_orchestration',
          sessionId: `unified-session-${Date.now()}`,
          ...context
        }
      };
      
      console.log('🚀 Executing unified orchestration with payload:', {
        type: intentPayload.type,
        captureScreen: intentPayload.captureScreen,
        primaryIntent: intentPayload.primaryIntent
      });
      
      // Use the unified orchestration system
      const result = await this.ask(intentPayload);
      
      return {
        success: true,
        response: result.response || intentData.suggestedResponse || 'Command processed successfully.',
        handledBy: 'UnifiedOrchestration',
        method: 'unified_command_processing',
        timestamp: new Date().toISOString(),
        orchestrationResult: result
      };
      
    } catch (error) {
      console.error('❌ Unified orchestration failed:', error);
      return {
        success: false,
        error: error.message,
        response: 'I had trouble processing that command. Please try again.',
        handledBy: 'error_handler',
        method: 'unified_orchestration_error',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Handle local memory storage operations
   */
  async handleLocalMemoryStore(userMessage, intentResult, context = {}) {
    try {
      console.log('💾 Handling local memory store operation...');
      
      // FAST RESPONSE: Return immediately with suggested response
      const fastResponse = {
        success: true,
        response: IntentResponses.getSuggestedResponse('memory_store', userMessage),
        handledBy: 'UserMemoryAgent',
        method: 'local_memory_store',
        timestamp: new Date().toISOString()
      };
      
      // BACKGROUND PROCESSING: Do memory storage after response is sent
      setImmediate(async () => {
        try {
          console.log('🚀 [BACKGROUND] Starting memory storage...');
          const memoryResult = await this.executeAgent('UserMemoryAgent', {
            action: 'memory-store',
            sourceText: intentResult.sourceText || userMessage,
            suggestedResponse: intentResult.suggestedResponse || "I'll remember that for you.",
            primaryIntent: 'memory_store',
            entities: intentResult.entities || [],
            metadata: {
              timestamp: new Date().toISOString(),
              source: 'local_orchestration'
            }
          }, context);
          
          if (memoryResult.success) {
            console.log('✅ [BACKGROUND] Memory storage completed successfully');
          } else {
            console.warn('⚠️ [BACKGROUND] Memory storage failed:', memoryResult.error);
          }
        } catch (error) {
          console.error('❌ [BACKGROUND] Memory storage failed:', error);
        }
      });
      
      return fastResponse;
      
    } catch (error) {
      console.error('❌ Local memory store failed:', error);
      return {
        success: true,
        response: IntentResponses.getSuggestedResponse('memory_store', userMessage),
        handledBy: 'fallback',
        method: 'memory_store_error',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Handle local memory retrieval operations
   */
  async handleLocalMemoryRetrieve(userMessage, entities, context = {}) {
    try {
      console.log('🔍 Handling local memory retrieve operation...');
      
      // Build search query from extracted entities if available
      let searchQuery = userMessage;
      
      if (entities && Object.keys(entities).length > 0) {
        // Enhanced query building for better semantic matching
        const queryParts = [];
        
        // Add temporal context for time-based queries
        if (entities.datetime && entities.datetime.length > 0) {
          queryParts.push(...entities.datetime);
          // For "what's going on" type queries, add event-related terms
          if (userMessage.toLowerCase().includes('what') && userMessage.toLowerCase().includes('going on')) {
            queryParts.push('events', 'appointments', 'plans', 'schedule');
          }
        }
        
        // Add other entity types
        if (entities.person && entities.person.length > 0) queryParts.push(...entities.person);
        if (entities.location && entities.location.length > 0) queryParts.push(...entities.location);
        if (entities.event && entities.event.length > 0) queryParts.push(...entities.event);
        if (entities.items && entities.items.length > 0) queryParts.push(...entities.items);
        if (entities.contact && entities.contact.length > 0) queryParts.push(...entities.contact);

        if (queryParts.length > 0) {
          searchQuery = queryParts.join(' ');
          console.log('✅ Enhanced search query from entities:', searchQuery);
        }
      }
      
      const memoryResult = await this.executeAgent('UserMemoryAgent', {
        action: 'memory-semantic-search',
        query: searchQuery,
        limit: 5,
        minSimilarity: 0.11   // Optimized based on similarity testing for temporal queries
      }, context);
      
      console.log(`[INFO] Memory search completed: ${memoryResult.success ? 'success' : 'failed'}`);
      
      // Handle nested result structure from agent execution
      const actualResults = memoryResult.result?.results || memoryResult.results;
      
      if (memoryResult.success && actualResults && actualResults.length > 0) {
        console.log(`[INFO] Found ${actualResults.length} relevant memories for context`);
        
        // Generate natural response using Phi3
        try {
          // Apply temporal relevance boost before sorting
          const boostedMemories = actualResults.map(memory => {
            let boostedSimilarity = memory.similarity;
            
            // Boost memories that contain temporal references matching the query
            const queryLower = userMessage.toLowerCase();
            const memoryLower = memory.source_text.toLowerCase();
            
            // Temporal matching patterns
            const temporalBoosts = [
              { query: /\b(week ago|last week)\b/, memory: /\b(last week|week ago)\b/, boost: 0.2 },
              { query: /\b(yesterday|a day ago)\b/, memory: /\b(yesterday|a day ago)\b/, boost: 0.2 },
              { query: /\b(couple weeks? ago|two weeks? ago)\b/, memory: /\b(two weeks? ago|couple weeks? ago)\b/, boost: 0.2 },
              { query: /\b(next week|upcoming week)\b/, memory: /\b(next week|upcoming week)\b/, boost: 0.15 },
              { query: /\b(this week|current week)\b/, memory: /\b(this week|current week)\b/, boost: 0.15 },
              { query: /\b(next month|upcoming month)\b/, memory: /\b(next month|in a month|upcoming month)\b/, boost: 0.2 },
              { query: /\b(this month|current month)\b/, memory: /\b(this month|current month)\b/, boost: 0.15 }
            ];
            
            for (const { query, memory: memoryPattern, boost } of temporalBoosts) {
              if (query.test(queryLower) && memoryPattern.test(memoryLower)) {
                boostedSimilarity += boost;
                // Temporal boost applied
                break;
              }
            }
            
            return { ...memory, similarity: boostedSimilarity };
          });
          
          // Sort memories by boosted similarity (highest first)
          const sortedMemories = boostedMemories.sort((a, b) => b.similarity - a.similarity);
          const topMemory = sortedMemories[0];
          
          // Debug logging for memory selection
          console.log(`[DEBUG] Memory selection analysis:`);
          sortedMemories.forEach((mem, i) => {
            console.log(`  ${i+1}. Similarity: ${mem.similarity.toFixed(4)} - "${mem.source_text.substring(0, 60)}..."`);
          });
          
          // Check if the most relevant memory meets minimum similarity threshold
          const minSimilarityThreshold = 0.2; // Match the semantic search threshold
          console.log(`[DEBUG] Top memory similarity: ${topMemory.similarity.toFixed(4)}, threshold: ${minSimilarityThreshold}`);
          if (topMemory.similarity < minSimilarityThreshold) {
            return {
              success: true,
              response: "I don't have any relevant information stored about that.",
              handledBy: 'UserMemoryAgent',
              method: 'memory_retrieve_no_results',
              timestamp: new Date().toISOString()
            };
          }
          
          // Focus on the most relevant memory, include others as context if needed
          const memoryContext = sortedMemories
            .slice(0, 3) // Only use top 3 most relevant memories
            .filter(m => m.similarity >= minSimilarityThreshold) // Only include relevant memories
            .map((m, index) => {
              const relevanceLabel = index === 0 ? 'PRIMARY' : `CONTEXT`;
              return `${relevanceLabel}: ${m.source_text}`;
            })
            .join('\n');
            
          // Debug: Log the exact memories being passed to Phi3
          console.log(`[DEBUG] Memory context being passed to Phi3:`);
          console.log(`[DEBUG] ${memoryContext}`);
          console.log(`[DEBUG] End of memory context`);
          
          // Additional safety check: if no relevant memories after filtering, don't call Phi3
          if (!memoryContext || memoryContext.trim() === '') {
            return {
              success: true,
              response: "I don't have any relevant information stored about that.",
              handledBy: 'UserMemoryAgent',
              method: 'memory_retrieve_no_context',
              timestamp: new Date().toISOString()
            };
          }
          
          // Create a more concise prompt for memory retrieval
          const isUpcomingQuery = /\b(coming|happening|scheduled|planned|upcoming|next|future)\b/i.test(userMessage);
          
          let prompt;
if (isUpcomingQuery) {
  prompt = `
Based on the stored memories below, answer what upcoming events/items are scheduled.

STORED MEMORIES:
${memoryContext}

QUESTION: "${userMessage}"

Answer based on the memories above. If no relevant information is found, say "I don't have that information stored."
  `.trim();
} else {
  prompt = `
Based on the stored memories below, answer the user's question.

STORED MEMORIES:
${memoryContext}

QUESTION: "${userMessage}"

Answer based on the memories above. If no relevant information is found, say "I don't have that information stored."
  `.trim();
}
          
          const phi3Result = await this.executeAgent('Phi3Agent', {
            action: 'query-phi3',
            prompt: prompt,
            options: {
              maxTokens: 60,
              temperature: 0.2
            }
          }, context);
          
          if (phi3Result.success && phi3Result.result?.response) {
            const result = {
              success: true,
              response: phi3Result.result.response,
              handledBy: 'UserMemoryAgent + Phi3Agent',
              method: 'local_memory_retrieve_with_llm',
              timestamp: new Date().toISOString(),
              memories: actualResults.length
            };
            // Generated natural response
            return result;
          }
        } catch (error) {
          console.warn(`[WARN] Failed to generate natural response, falling back to simple format:`, error);
        }
        
        // Fallback to simple response if Phi3 fails
        const responseText = `I found this information: ${actualResults.map(m => m.source_text || m.suggested_response).join(', ')}`;
        console.log(`[DEBUG] Generated fallback response:`, responseText);
        
        const result = {
          success: true,
          response: responseText,
          handledBy: 'UserMemoryAgent',
          method: 'local_memory_retrieve',
          timestamp: new Date().toISOString()
        };
        console.log(`[DEBUG] Returning result:`, result);
        return result;
      } else {
        // No memories found - fallback to question handling for general knowledge
        console.log('🔄 No memories found, falling back to question handling...');
        try {
          const questionResult = await this.handleLocalQuestion(userMessage, {
            result: { intent: 'question', confidence: 0.6 }
          }, context);
          return questionResult;
        } catch (questionError) {
          console.warn('⚠️ Question fallback failed:', questionError.message);
          // Check if this was a memory-related question for better fallback
          const isMemoryQuestion = /\b(previous|last|earlier|before|discuss|conversation|chat|talk|said|mention)\b/i.test(userMessage);
          const fallbackResponse = isMemoryQuestion 
            ? 'I don\'t have any record of our previous conversations in my memory.'
            : 'I don\'t have that information stored. Could you provide more details?';
            
          return {
            success: true,
            response: fallbackResponse,
            handledBy: 'UserMemoryAgent',
            method: 'memory_not_found',
            timestamp: new Date().toISOString()
          };
        }
      }
      
    } catch (error) {
      console.error('❌ Local memory retrieve failed:', error);
      return {
        success: true,
        response: 'I\'m having trouble accessing my memory right now. Could you remind me?',
        handledBy: 'fallback',
        method: 'memory_retrieve_error',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Handle local greeting responses
   */
  handleLocalGreeting(userMessage, context = {}) {
    const normalized = userMessage.trim().toLowerCase();
  
    const timeBasedGreeting = () => {
      const hour = new Date().getHours();
      if (hour < 12) return 'Good morning! How can I help you today?';
      if (hour < 18) return 'Good afternoon! What can I do for you?';
      return 'Good evening! Need any assistance?';
    };
  
    const greetingsMap = {
      general: [
        'Hello! How can I help you today?',
        'Hi there! What can I do for you?',
        'Hey! I\'m here to assist you.',
        'What’s up? Ready when you are.',
        'Howdy! Need something?',
        'Greetings! Let me know how I can assist.'
      ],
      casual: [
        'Yo! What’s up?',
        'Hey hey! Need anything?',
        'Sup? I’m here to help.',
        'Hey there! How’s it going?'
      ]
    };
  
    const matchedCategory = (() => {
      if (/yo|sup|what'?s up|hey hey|hiya|howdy/.test(normalized)) return 'casual';
      if (/good (morning|afternoon|evening)/.test(normalized)) return 'time';
      if (/hi|hello|hey|greetings/.test(normalized)) return 'general';
      return 'general';
    })();
  
    let response;
    if (matchedCategory === 'time') {
      response = timeBasedGreeting();
    } else {
      const options = greetingsMap[matchedCategory] || greetingsMap.general;
      response = options[Math.floor(Math.random() * options.length)];
    }
  
    return {
      success: true,
      response,
      action: 'local-greeting',
      method: 'pattern-greeting',
      timestamp: new Date().toISOString()
    };
  }  

  /**
   * Handle local question responses using Phi3 LLM
   */
  async handleLocalQuestion(userMessage, intentResult, context = {}) {
    try {
      console.log('❓ Handling local question with Phi3...');
      console.log('🔍 Question entities to preserve:', intentResult.result?.entities);
      
      // For screen-related questions, capture screenshot first
      if (intentResult.result?.captureScreen) {
        console.log('📸 Capturing screen for visual question...');
        try {
          const screenshotResult = await this.executeAgent('ScreenCaptureAgent', {
            action: 'capture_and_extract'
          }, context);
          
          if (screenshotResult.success && screenshotResult.result) {
            console.log('✅ Screenshot captured, adding to context');
            context.screenshot = screenshotResult.result.screenshot;
            context.extractedText = screenshotResult.result.extractedText;
            userMessage += `\n\nScreen content: ${screenshotResult.result.extractedText?.substring(0, 500) || 'No text extracted'}`;
          }
        } catch (screenshotError) {
          console.warn('⚠️ Screenshot capture failed:', screenshotError.message);
        }
      }
      
      // Try to use Phi3 for actual response generation
      try {
        console.log('🤖 Querying Phi3 for question response...');
        
        // Check if this is a memory-related question
        const isMemoryQuestion = /\b(previous|last|earlier|before|discuss|conversation|chat|talk|said|mention)\b/i.test(userMessage);
        
        let concisePrompt;
        if (isMemoryQuestion) {
          concisePrompt = `No relevant memories found. Answer briefly in 1 sentence:\n\nQuestion: ${userMessage}\n\nBrief response (don't make up details):`
        } else {
          concisePrompt = `Answer briefly in 1-2 sentences:\n\nQuestion: ${userMessage}\n\nBrief answer:`
        }
        
        const phi3Result = await this.executeAgent('Phi3Agent', {
          action: 'query-phi3-fast',
          prompt: concisePrompt,
          options: { 
            timeout: 10000, 
            maxTokens: 120,
            temperature: 0.2,
            repeat_penalty: 1.1
          }
        }, {
          ...context,
          executeAgent: this.executeAgent.bind(this)
        });
        
        if (phi3Result.success && phi3Result.result && phi3Result.result.response) {
          console.log('✅ Phi3 provided response for question');
          
          const fastResponse = {
            success: true,
            response: phi3Result.result.response,
            handledBy: 'phi3_question_handler',
            method: 'phi3_response',
            confidence: intentResult.confidence,
            timestamp: new Date().toISOString()
          };
          
          // BACKGROUND PROCESSING: Store question context in memory for future retrieval
          setImmediate(async () => {
            try {
              console.log('🚀 [BACKGROUND] Storing question context in memory...');
              const memoryStoreResult = await this.executeAgent('UserMemoryAgent', {
                action: 'memory-store',
                sourceText: userMessage,
                entities: intentResult.result?.entities || {},
                category: 'question',
                metadata: {
                  intent: 'question',
                  timestamp: new Date().toISOString(),
                  confidence: intentResult.confidence,
                  phi3Response: phi3Result.result.response
                }
              }, {
                ...context,
                executeAgent: this.executeAgent.bind(this)
              });
              
              if (memoryStoreResult.success) {
                console.log('✅ [BACKGROUND] Question context stored in memory');
              } else {
                console.warn('⚠️ [BACKGROUND] Failed to store question context:', memoryStoreResult.error);
              }
            } catch (memoryError) {
              console.warn('⚠️ [BACKGROUND] Memory storage failed for question:', memoryError.message);
            }
          });
          
          return fastResponse;
        }
      } catch (phi3Error) {
        console.warn('⚠️ Phi3 failed for question, falling back to generic response:', phi3Error.message);
      }
      
      // Fallback to generic responses if Phi3 fails
      const responses = [
        'That\'s an interesting question. I\'m currently running in local mode with limited capabilities.',
        'I understand you\'re asking about that. My local processing is somewhat limited right now.',
        'I see what you\'re asking. In local mode, I can help with basic tasks and information storage.',
        'That\'s a good question. I\'m operating locally right now, so my responses may be more basic.'
      ];
      
      const baseResponse = responses[Math.floor(Math.random() * responses.length)];
      
      // Add helpful suggestions based on what we can do locally
      const suggestions = [
        'I can help you store and retrieve information, though.',
        'Feel free to ask me to remember things for you.',
        'I can take notes and help you recall information later.',
        'Try asking me to remember something or recall what you\'ve told me.'
      ];
      
      const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
      const fullResponse = `${baseResponse} ${suggestion}`;
      
      return {
        success: true,
        response: fullResponse,
        handledBy: 'local_question_handler',
        method: 'local_fallback',
        confidence: intentResult.confidence,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Local question handling failed:', error);
      return {
        success: true,
        response: 'I\'m here to help, though I\'m running in a limited local mode right now.',
        handledBy: 'fallback',
        method: 'question_error',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Main orchestration method - processes intent classification payloads from backend
   * Maps intents to agents and uses executeWorkflow for orchestration
   */
  async ask(intentPayload, context = {}) {
    if (!this.initialized) {
      throw new Error('AgentOrchestrator not initialized. Call initialize() first.');
    }

    try {
      console.log('📥 Intent payload type:', typeof intentPayload);
      
      // Parse intent payload
      let processedPayload = this.parseIntentPayload(intentPayload);
      
      // Extract intents and create workflow
      const workflow = this.createWorkflowFromIntents(processedPayload, context);
      console.log('🔄 Created workflow with', workflow.length, 'steps');
      
      if (workflow.length === 0) {
        console.log('⚠️ No workflow steps created - returning empty result');
        return {
          success: true,
          primaryIntent: processedPayload.primaryIntent,
          intentsProcessed: [],
          message: 'No actionable intents found'
        };
      }
      
      // Execute workflow
      const workflowResult = await this.executeWorkflow(workflow, {
        ...context,
        originalPayload: processedPayload,
        userId: context.userId || 'default_user'
      });
      
      // Workflow completed
      
      // Format response for main.cjs compatibility
      return {
        success: workflowResult.status === 'completed',
        primaryIntent: processedPayload.primaryIntent,
        intentsProcessed: workflowResult.results || [],
        workflowStatus: workflowResult.status,
        steps: workflowResult.steps,
        totalSteps: workflowResult.totalSteps,
        timestamp: new Date().toISOString(),
        context: {
          requiresMemoryAccess: processedPayload.requiresMemoryAccess,
          captureScreen: processedPayload.captureScreen,
          sourceText: processedPayload.sourceText?.substring(0, 100) + '...' || 'No source text',
          suggestedResponse: processedPayload.suggestedResponse
        }
      };
      
    } catch (error) {
      console.error('❌ AgentOrchestrator.ask() failed:', error);
      console.error('❌ Error stack:', error.stack);
      
      return {
        success: false,
        error: error.message,
        fallback: 'I encountered an error processing your request. Please try again.'
      };
    }
  }

  /**
   * Parse intent payload from various input formats
   */
  parseIntentPayload(intentPayload) {
    console.log('🔍 Parsing intent payload...');
    
    if (typeof intentPayload === 'string') {
      try {
        const parsed = JSON.parse(intentPayload);
        console.log('📦 Parsed string payload as JSON');
        return this.extractIntentData(parsed);
      } catch (parseError) {
        console.log('🔄 String payload is not JSON, treating as legacy input');
        return {
          intents: [{ intent: 'question', confidence: 0.8 }],
          primaryIntent: 'question',
          entities: [],
          requiresMemoryAccess: false,
          captureScreen: false,
          sourceText: intentPayload
        };
      }
    } else if (intentPayload && typeof intentPayload === 'object') {
      console.log('📦 Processing object payload');
      return this.extractIntentData(intentPayload);
    } else {
      throw new Error('Invalid intentPayload: must be string or object');
    }
  }

  /**
   * Extract intent data from parsed payload
   */
  extractIntentData(payload) {
    // Handle nested payload structures
    if (payload.payload && payload.payload.intents) {
      console.log('📦 Found nested payload structure');
      return payload.payload;
    }
    
    // Handle message-wrapped payloads
    if (payload.message && typeof payload.message === 'string') {
      try {
        const parsed = JSON.parse(payload.message);
        console.log('📦 Parsed message-wrapped payload');
        return this.extractIntentData(parsed);
      } catch (error) {
        console.log('🔄 Message field is not JSON, using as source text');
      }
    }
    
    // Handle intentPayload nested structure
    if (payload.intentPayload && payload.intentPayload.intents) {
      console.log('📦 Found intentPayload nested structure');
      return payload.intentPayload;
    }
    
    // Handle direct intent payload
    if (payload.intents && Array.isArray(payload.intents)) {
      console.log('📦 Found direct intent payload');
      return payload;
    }
    
    // Fallback structure
    console.log('🔄 Using fallback structure for unknown payload format');
    
    // Determine appropriate sourceText - avoid stringifying objects
    let sourceText = payload.sourceText;
    if (!sourceText) {
      // Try to extract meaningful text from common payload properties
      if (payload.message && typeof payload.message === 'string') {
        sourceText = payload.message;
      } else if (payload.query && typeof payload.query === 'string') {
        sourceText = payload.query;
      } else if (payload.text && typeof payload.text === 'string') {
        sourceText = payload.text;
      } else {
        // Only stringify as last resort and mark it clearly
        sourceText = '[System Generated] ' + JSON.stringify(payload);
        console.log('⚠️ Warning: Using stringified payload as sourceText');
      }
    }

    // Use consistent intent from payload or fallback
    const fallbackIntent = payload.primaryIntent || payload.intent || 'question';
    
    return {
      intents: [{ intent: fallbackIntent, confidence: 0.8 }],
      primaryIntent: fallbackIntent,
      entities: payload.entities || [],
      requiresMemoryAccess: payload.requiresMemoryAccess || false,
      captureScreen: payload.captureScreen || false,
      sourceText: sourceText,
      suggestedResponse: payload.suggestedResponse || payload.response || null
    };
  }

  /**
   * Create workflow from intents
   */
  createWorkflowFromIntents(processedPayload, context) {
    console.log('🔄 Creating workflow from intents...');
    
    const { intents, primaryIntent, requiresMemoryAccess, captureScreen, sourceText } = processedPayload;
    const workflow = [];
    
    // Determine if we need screenshot capture
    const shouldCaptureScreen = captureScreen === true || (requiresMemoryAccess && captureScreen !== false);
  
    console.log('🔍 Should capture screen:', shouldCaptureScreen);
    console.log('🔍 Processing intents:', intents?.map(i => i.intent) || [primaryIntent]);
    
    // Add screenshot capture step if needed
    if (shouldCaptureScreen) {
      console.log('📸 Adding ScreenCaptureAgent to workflow');
      workflow.push({
        agent: 'ScreenCaptureAgent',
        params: {
          action: 'capture_and_extract',
          includeOCR: true,
          ocrOptions: {
            languages: ['eng'],
            confidence: 0.7
          }
        },
        context: { ...context, stepName: 'screenshot_capture' }
      });
    }
    
    // Process each intent and map to agents (supports multiple agents per intent)
    const intentsToProcess = intents || [{ intent: primaryIntent }];
    
    for (const intentObj of intentsToProcess) {
      const intent = intentObj.intent;
      const agentNames = this.getAgentsForIntent(intent);
      
      // Processing intent
      
      if (agentNames.length > 0) {
        // Create workflow step for each agent mapped to this intent
        for (let i = 0; i < agentNames.length; i++) {
          const agentName = agentNames[i];
          const agentParams = this.getAgentParamsForIntent(intent, processedPayload, context, agentName);
          
          workflow.push({
            agent: agentName,
            params: agentParams,
            context: { 
              ...context, 
              stepName: `${intent}_${agentName.toLowerCase()}_processing`,
              intent: intent,
              agentIndex: i,
              totalAgentsForIntent: agentNames.length,
              originalPayload: processedPayload
            }
          });
          
          console.log(`  ✅ Added ${agentName} to workflow for intent: ${intent}`);
        }
      } else {
        console.log(`⚠️ No agents found for intent: ${intent}`);
      }
    }
    
    console.log(`✅ Created workflow with ${workflow.length} steps`);
    return workflow;
  }
  /**
   * Get agent parameters for specific intent and agent
   */
  getAgentParamsForIntent(intent, processedPayload, context, agentName = null) {
    console.log(`🔧 Getting params for intent: ${intent}, agent: ${agentName}`);
    
    const { sourceText, entities } = processedPayload;
    
    // Agent-specific parameter handling
    if (agentName) {
      switch (agentName) {
        case 'UserMemoryAgent':
          return this.getMemoryAgentParams(intent, processedPayload, context);
        case 'DynamicAgent':
          return this.getDynamicAgentParams(intent, processedPayload, context);
        case 'SchedulingAgent':
          return this.getSchedulingAgentParams(intent, processedPayload, context);
        case 'TaskAgent':
          return this.getTaskAgentParams(intent, processedPayload, context);
        case 'ReminderAgent':
          return this.getReminderAgentParams(intent, processedPayload, context);
        case 'AutomationAgent':
          return this.getAutomationAgentParams(intent, processedPayload, context);
        case 'ScreenCaptureAgent':
          return this.getScreenCaptureAgentParams(intent, processedPayload, context);
        case 'IntentParserAgent':
          return this.getIntentParserAgentParams(intent, processedPayload, context);
        case 'MemoryEnrichmentAgent':
          return this.getMemoryEnrichmentAgentParams(intent, processedPayload, context);
      }
    }
    
    // Legacy intent-based parameter handling (fallback)
    switch (intent) {
      case 'memory_store':
      case 'memory_store':
        return {
          action: 'store_intent_classification',
          data: {
            ...processedPayload,
            timestamp: new Date().toISOString()
          }
        };
        
      case 'memory_retrieve':
      case 'memory-retrieve':
      case 'memory_search':
        return {
          action: 'memory-retrieve',
          query: sourceText || 'recent memories',
          limit: 10
        };
        
      case 'memory_list':
        return {
          action: 'list_memories',
          limit: 20
        };
        
      case 'command':
        return {
          action: 'execute_command',
          command: sourceText,
          entities: entities,
          context: context
        };
        
      case 'appointment':
        return {
          action: 'schedule_appointment',
          description: sourceText,
          entities: entities,
          context: context
        };
        
      case 'task':
        return {
          action: 'create_task',
          description: sourceText,
          entities: entities,
          context: context
        };
        
      case 'capture-screen':
      case 'capture-window':
        return {
          action: 'capture_and_extract',
          includeOCR: true,
          ocrOptions: {
            languages: ['eng'],
            confidence: 0.7
          }
        };
        
      case 'extract-text':
        return {
          action: 'extract_text_from_image',
          ocrOptions: {
            languages: ['eng'],
            confidence: 0.7
          }
        };
        
      case 'parse-intent':
        return {
          text: sourceText,
          context: entities
        };
        
      default:
        console.log(`🤷 Using default params for intent: ${intent}`);
        return {
          action: intent,
          data: processedPayload
        };
    }
  }

  /**
   * Agent-specific parameter methods
   */
  getMemoryAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    switch (intent) {
      case 'memory_store':
      case 'memory_store':
        return {
          action: 'store_intent_classification',
          data: {
            ...processedPayload,
            timestamp: new Date().toISOString()
          }
        };
      case 'memory-delete':
      case 'memory_delete':
        return {
          action: 'memory-delete',
          memoryId: processedPayload.memoryId || entities.find(e => e.type === 'memoryId')?.value,
          timestamp: new Date().toISOString()
        };
      case 'memory-update':
      case 'memory_update':
        return {
          action: 'memory-update',
          data: {
            ...processedPayload,
            timestamp: new Date().toISOString()
          }
        };
      case 'memory-retrieve':
      case 'memory_retrieve':
      case 'memory_search':
        // Extract pagination parameters from entities or processedPayload
        const limitEntity = entities.find(e => e.type === 'limit');
        const offsetEntity = entities.find(e => e.type === 'offset');
        const searchQueryEntity = entities.find(e => e.type === 'searchQuery');
        
        // Build search query from extracted entities if no explicit searchQuery
        let searchQuery = processedPayload.searchQuery || searchQueryEntity?.value;
        
        if (!searchQuery && entities.length > 0) {
          // Build semantic search query from extracted entities
          const entityValues = entities.map(e => e.value).filter(v => v && v.length > 0);
          if (entityValues.length > 0) {
            searchQuery = entityValues.join(' ');
            console.log('✅ Built search query from entities:', searchQuery, 'from entities:', entities);
          }
        }
        
        return {
          action: 'memory-retrieve',
          searchQuery: searchQuery || null,
          pagination: processedPayload.pagination || {
            limit: limitEntity?.value || 50,
            offset: offsetEntity?.value || 0
          },
          limit: limitEntity?.value || 50,
          offset: offsetEntity?.value || 0,
          timestamp: new Date().toISOString()
        };
      case 'command':
      case 'appointment':
      case 'task':
      case 'question':
      case 'greeting':
      case 'help':
      case 'creative':
      case 'analysis':
      case 'calculation':
      case 'system_info':
        return {
          action: 'store_context',
          data: {
            ...processedPayload,
            intent: intent,
            sourceText: sourceText,
            entities: entities,
            timestamp: new Date().toISOString()
          }
        };
      default:
        return {
          action: 'query_memories',
          query: sourceText || 'recent memories',
          limit: 10
        };
    }
  }

  getDynamicAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    return {
      action: 'execute_dynamic_task',
      task: {
        intent: intent,
        description: sourceText,
        entities: entities,
        context: context
      },
      timestamp: new Date().toISOString()
    };
  }

  getSchedulingAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    return {
      action: 'schedule_appointment',
      appointment: {
        description: sourceText,
        entities: entities,
        context: context
      },
      timestamp: new Date().toISOString()
    };
  }

  getTaskAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    return {
      action: 'create_task',
      task: {
        description: sourceText,
        entities: entities,
        priority: 'normal',
        context: context
      },
      timestamp: new Date().toISOString()
    };
  }

  getReminderAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    return {
      action: 'create_reminder',
      reminder: {
        description: sourceText,
        entities: entities,
        context: context
      },
      timestamp: new Date().toISOString()
    };
  }

  getAutomationAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    return {
      action: 'execute_automation',
      automation: {
        description: sourceText,
        entities: entities,
        context: context
      },
      timestamp: new Date().toISOString()
    };
  }

  getScreenCaptureAgentParams(intent, processedPayload, context) {
    return {
      action: 'capture_and_extract',
      includeOCR: true,
      ocrOptions: {
        languages: ['eng'],
        confidence: 0.7
      }
    };
  }

  getIntentParserAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    return {
      text: sourceText,
      context: entities
    };
  }

  getMemoryEnrichmentAgentParams(intent, processedPayload, context) {
    const { sourceText, entities } = processedPayload;
    
    return {
      action: 'enrich_context',
      text: sourceText,
      entities: entities,
      context: context
    };
  }

  /**
   * Get appropriate agents for an intent (supports multiple agents per intent)
   */
  getAgentsForIntent(intent) {
    const intentMap = {
      // Screen capture intents
      'capture-screen': ['ScreenCaptureAgent'],
      'capture-window': ['ScreenCaptureAgent'],
      'extract-text': ['ScreenCaptureAgent'],
      
      // Memory intents - support both hyphen and underscore formats
      'memory-store': ['UserMemoryAgent'],
      'memory_store': ['UserMemoryAgent'],
      'memory-retrieve': ['UserMemoryAgent'], 
      'memory_retrieve': ['UserMemoryAgent'],
      'memory-search': ['UserMemoryAgent'],
      'memory_search': ['UserMemoryAgent'],
      'memory-list': ['UserMemoryAgent'],
      'memory_list': ['UserMemoryAgent'],
      'memory-delete': ['UserMemoryAgent'],
      'memory_delete': ['UserMemoryAgent'],
      'memory-update': ['UserMemoryAgent'],
      'memory_update': ['UserMemoryAgent'],
      
      // Multi-agent intents (only include agents that exist)
      'command': ['UserMemoryAgent'], // Commands need memory storage (DynamicAgent removed - doesn't exist)
      'appointment': ['UserMemoryAgent'], // Appointments need memory
      'task': ['UserMemoryAgent'], // Tasks need memory
      'reminder': ['UserMemoryAgent'], // Reminders need memory
      'automation': ['UserMemoryAgent'], // Automation needs memory
      
      // Context-aware intents
      'question': ['UserMemoryAgent'], // Questions may need memory context
      'greeting': ['UserMemoryAgent'], // Greetings should be remembered
      'conversation': ['UserMemoryAgent'], // General conversation needs memory
      
      // New AI assistant intents
      'help': ['UserMemoryAgent'], // Help requests may need context from memory
      'creative': ['UserMemoryAgent'], // Creative requests should be stored for context
      'analysis': ['UserMemoryAgent'], // Analysis results should be stored
      'calculation': ['UserMemoryAgent'], // Calculations may reference stored data
      'system_info': ['UserMemoryAgent'], // System info requests should be logged
      
      // Utility intents
      'parse-intent': ['IntentParserAgent'],
      'enrich-memory': ['MemoryEnrichmentAgent'],
    };
    
    const agents = intentMap[intent] || [];
    console.log(`🔍 Intent '${intent}' maps to agents: [${agents.join(', ')}]`);
    return agents;
  }

  /**
   * Legacy method for backward compatibility (returns first agent only)
   */
  getAgentForIntent(intent) {
    const agents = this.getAgentsForIntent(intent);
    const firstAgent = agents.length > 0 ? agents[0] : null;
    console.log(`🔍 Intent '${intent}' maps to agent: ${firstAgent || 'none'}`);
    return firstAgent;
  }

  /**
   * Get a loaded agent instance
   */
  getAgent(agentName) {
    return this.loadedAgents.get(agentName);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Convert dependency name to camelCase for consistent injection
   */
  getRegisteredAgents() {
    return Array.from(this.agents.keys());
  }

  getLoadedAgents() {
    return Array.from(this.loadedAgents.keys());
  }

  isAgentLoaded(agentName) {
    return this.loadedAgents.has(agentName);
  }

  toCamelCase(input) {
    return input.replace(/[-.](\w)/g, (_, char) => char.toUpperCase());
  }

  async unloadAgent(agentName) {
    if (this.loadedAgents.has(agentName)) {
      this.loadedAgents.delete(agentName);
      console.log(`🗑️ Agent ${agentName} unloaded`);
      return true;
    }
    return false;
  }

  async reloadAgent(agentName) {
    await this.unloadAgent(agentName);
    return await this.loadAgent(agentName);
  }

  /**
   * Clear all loaded agents cache to force reload
   */
  clearAgentCache() {
    const agentNames = Array.from(this.loadedAgents.keys());
    this.loadedAgents.clear();
    console.log(`🗑️ Cleared agent cache for: [${agentNames.join(', ')}]`);
    return agentNames;
  }

  /**
   * Force re-registration of an agent from file to update database with latest code
   */
  async forceReregisterAgent(agentName) {
    const { database } = this.context;
    if (!database) {
      throw new Error('Database connection not available');
    }

    try {
      console.log(`🔄 Force re-registering agent: ${agentName}`);
      
      // First, delete existing agent from database
      await database.run('DELETE FROM agents WHERE name = ?', [agentName]);
      console.log(`🗑️ Deleted existing ${agentName} from database`);
      
      // Clear from cache
      this.loadedAgents.delete(agentName);
      
      // Find agent in default agents list
      const agentsDir = __dirname;
      const defaultAgents = [
        {
          name: 'ScreenCaptureAgent',
          description: 'Captures screenshots and performs OCR text extraction',
          dependencies: ['screenshot-desktop', 'node-screenshots', 'tesseract.js', 'path', 'fs', 'url'],
          execution_target: 'frontend',
          requires_database: false,
          database_type: null,
          filePath: `${agentsDir}/ScreenCaptureAgent.cjs`
        },
        {
          name: 'UserMemoryAgent',
          description: 'Manages user memory storage and retrieval',
          dependencies: ['path', 'fs'],
          execution_target: 'frontend',
          requires_database: true,
          database_type: 'duckdb',
          filePath: `${agentsDir}/UserMemoryAgent.cjs`
        }
      ];
      
      const agentData = defaultAgents.find(a => a.name === agentName);
      if (!agentData) {
        throw new Error(`Agent ${agentName} not found in default agents list`);
      }
      
      // Read fresh code from file
      const fs = await import('fs');
      const agentCode = fs.readFileSync(agentData.filePath, 'utf-8');
      console.log(`📖 Read fresh code for ${agentName} (${agentCode.length} characters)`);
      
      // Extract bootstrap function if it exists
      let bootstrap = null;
      const bootstrapMatch = agentCode.match(/async\s+bootstrap\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/m);
      if (bootstrapMatch) {
        bootstrap = bootstrapMatch[0];
      }
      
      // Update agentData with fresh code
      agentData.code = agentCode;
      agentData.bootstrap = bootstrap;
      
      // Re-register with fresh code
      await this.registerAgent(agentData.name, agentData);
      console.log(`✅ Successfully re-registered ${agentName} with updated code`);
      
      return { success: true, message: `Agent ${agentName} re-registered successfully` };
      
    } catch (error) {
      console.error(`❌ Failed to re-register agent ${agentName}:`, error);
      throw error;
    }
  }

}

export default AgentOrchestrator;
           