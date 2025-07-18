/**
 * AgentOrchestrator - Object-based approach
 * Supports both string-based agents (legacy) and object-based agents (new)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AgentOrchestrator {
  constructor() {
    this.agents = new Map();
    this.loadedAgents = new Map();
    this.context = {};
    this.initialized = false;
  }

  async initialize(config = {}) {
    try {
      console.log('🎭 Initializing AgentOrchestrator-object...');
      
      this.context = {
        ...config,
        orchestratorPath: __dirname,
        timestamp: new Date().toISOString()
      };

      // Register default agents
      await this.registerDefaultAgents();
      
      // Preload critical agents
      const criticalAgents = config.preloadAgents || ['UserMemoryAgent'];
      console.log('🚨 Preloading critical agents:', criticalAgents);
      
      await this.preloadAgents(criticalAgents);
      
      this.initialized = true;
      console.log(`✅ AgentOrchestrator initialized with ${this.agents.size} registered agents`);
      
      return { success: true, agentCount: this.agents.size };
      
    } catch (error) {
      console.error('❌ AgentOrchestrator initialization failed:', error);
      throw error;
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

      console.log('✅ Agents table created/verified in DuckDB');
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
        console.log(`🔄 Agent ${agentName} already exists in database`);
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
      console.log(`🔧 Formatted dependencies for ${agentName}:`, jsonDependencies);

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

      console.log(`✅ Created default agent: ${agentName}`, result);
      
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

    // Use __dirname directly since we're already in the agents_new directory
    const agentsDir = __dirname;
    const defaultAgents = [
      {
        name: 'ScreenCaptureAgent',
        description: 'Captures screenshots and performs OCR text extraction',
        dependencies: ['screenshot-desktop', 'tesseract.js', 'path', 'fs', 'url'],
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
      console.log(`📖 Reading agent code from file: ${agentPath}`);
      
      try {
        // Read agent file contents
        const agentCode = fs.readFileSync(agentPath, 'utf-8');
        console.log(`📄 Read agent code from file: ${agentPath} (${agentCode.length} bytes)`);
        
        // Extract bootstrap function if available
        let bootstrap = null;
        if (agentCode.includes('bootstrap')) {
          const bootstrapMatch = agentCode.match(/async\s+bootstrap\s*\([^)]*\)\s*{([\s\S]*?)\s*},/m);
          if (bootstrapMatch && bootstrapMatch[0]) {
            bootstrap = bootstrapMatch[0];
            console.log(`🔍 Extracted bootstrap function (${bootstrap.length} bytes)`);
          }
        }
        
        // Update agentData with code and bootstrap
        agentData.code = agentCode;
        agentData.bootstrap = bootstrap;
        agentData.filePath = agentPath;
        
        // Register agent with full code in database (single operation)
        await this.registerAgent(agentData.name, agentData);
        console.log(`✅ Registered agent with code: ${agentData.name}`);
        
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
      console.log(`📝 Registering agent (legacy): ${name} at ${filePath}`);
      
      // Read agent file contents to store in database
      try {
        const fs = await import('fs');
        const agentCode = fs.readFileSync(filePath, 'utf-8');
        console.log(`📄 Read agent code from file: ${filePath} (${agentCode.length} bytes)`);
        
        // Extract bootstrap function if available
        let bootstrap = null;
        if (agentCode.includes('bootstrap')) {
          const bootstrapMatch = agentCode.match(/async\s+bootstrap\s*\([^)]*\)\s*{([\s\S]*?)\s*},/m);
          if (bootstrapMatch && bootstrapMatch[1]) {
            bootstrap = bootstrapMatch[0];
            console.log(`🔍 Extracted bootstrap function (${bootstrap.length} bytes)`);
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

    console.log(`📝 Registering agent in DuckDB: ${name}`);
    
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

        console.log(`🔄 Updated agent in database: ${name}`);
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

        console.log(`✅ Registered agent in database: ${name}`);
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
        console.log(`🔄 Preloaded agent: ${agentName}`);
      } catch (error) {
        console.warn(`⚠️ Failed to preload agent ${agentName}:`, error.message);
      }
    }
  }

  /**
   * Load an agent from DuckDB database or fallback to file
   */
  async loadAgent(agentName) {
    console.log(`🔍 DEBUG: loadAgent called for ${agentName}`);
    
    // Check if agent is already loaded
    if (this.loadedAgents.has(agentName)) {
      console.log(`🔄 DEBUG: Agent ${agentName} already loaded, returning cached instance`);
      const cachedAgent = this.loadedAgents.get(agentName);
      console.log(`🔄 DEBUG: Cached agent has bootstrap: ${!!cachedAgent.bootstrap}, execute: ${!!cachedAgent.execute}`);
      return cachedAgent;
    }

    try {
      console.log(`📦 Loading agent: ${agentName}`);
      
      // First try to load from DuckDB database
      console.log(`🔍 DEBUG: Attempting to load ${agentName} from database...`);
      let agentData = await this.loadAgentFromDatabase(agentName);
      console.log(`🔍 DEBUG: Database load result for ${agentName}: ${!!agentData}`);
      
      // If not found in database, try legacy file-based loading
      if (!agentData) {
        console.log(`🔍 DEBUG: Agent ${agentName} not found in database, trying file-based loading...`);
        agentData = await this.loadAgentFromFile(agentName);
        console.log(`🔍 DEBUG: File-based load result for ${agentName}: ${!!agentData}`);
      }
      
      if (!agentData) {
        console.error(`❌ DEBUG: Agent ${agentName} not found in database or file system`);
        throw new Error(`Agent ${agentName} not found in database or file system`);
      }
      
      console.log(`🔍 DEBUG: Agent data for ${agentName}:`, {
        hasCode: !!agentData.code,
        codeLength: agentData.code ? agentData.code.length : 0,
        hasFilePath: !!agentData.filePath,
        hasBootstrap: !!agentData.bootstrap,
        dependencies: agentData.dependencies
      });

      // Create agent instance
      let agentInstance;
      
      if (agentData.code) {
        // Database-stored agent with code
        console.log(`🔍 DEBUG: Creating ${agentName} from code (${agentData.code.length} bytes)`);
        agentInstance = await this.createAgentFromCode(agentData);
      } else if (agentData.filePath) {
        // File-based agent (legacy)
        console.log(`🔍 DEBUG: Creating ${agentName} from file: ${agentData.filePath}`);
        agentInstance = await this.createAgentFromFile(agentData);
      } else {
        console.error(`❌ DEBUG: Agent ${agentName} has no code or file path`);
        throw new Error(`Agent ${agentName} has no code or file path`);
      }
      
      console.log(`🔍 DEBUG: Created agent instance for ${agentName}:`, {
        hasBootstrap: !!agentInstance.bootstrap,
        bootstrapType: typeof agentInstance.bootstrap,
        hasExecute: !!agentInstance.execute,
        executeType: typeof agentInstance.execute,
        dependencies: agentInstance.dependencies
      });

      this.loadedAgents.set(agentName, agentInstance);
      console.log(`✅ Agent ${agentName} loaded successfully`);
      
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
    console.log(`📊 Loaded agent ${agentName} from database`);
    
    // Log code content length and first 100 characters
    if (agentRow.code) {
      console.log(`📄 Agent code length: ${agentRow.code.length} bytes`);
      console.log(`📄 Agent code snippet: ${agentRow.code.substring(0, 100)}...`);
    } else {
      console.log(`⚠️ No code found for agent ${agentName} in database`);
    }
      
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
    console.log(`🔧 Creating agent from database code: ${agentData.name}`);

    // If we have code in database, create agent from stored code
    if (agentData.code) {
      try {
        // For object-based agents, we need to evaluate the code to get the AGENT_FORMAT object
        console.log(`🧩 Evaluating agent code for ${agentData.name}`);
        
        // Create a temporary module to evaluate the agent code
        const path = await import('path');
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const { fileURLToPath } = await import('url');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        
        // Create a sandbox environment for evaluating the agent code
        const vm = await import('vm');
        const context = {
          exports: {},
          require,
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
        
        // Log the first 200 characters of the code being evaluated
        console.log(`🔍 Code snippet being evaluated for ${agentData.name}: ${agentData.code.substring(0, 200)}...`);
        
        // Check if the code contains AGENT_FORMAT export
        if (agentData.code.includes('AGENT_FORMAT')) {
          console.log(`🔍 Found AGENT_FORMAT in code, using direct extraction`);
          
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
        
        console.log(`✅ Successfully evaluated agent code for ${agentData.name}`);
        console.log(`🔍 Agent format keys: ${Object.keys(agentFormat).join(', ')}`);
        console.log(`🔍 Bootstrap type: ${typeof agentFormat.bootstrap}`);
        console.log(`🔍 Execute type: ${typeof agentFormat.execute}`);
        
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
        
        // Log the created agent instance
        console.log(`🔍 Created agent instance with bootstrap: ${typeof agentInstance.bootstrap}`);
        console.log(`🔍 Created agent instance with execute: ${typeof agentInstance.execute}`);
        
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
      return ''; // Return empty string for invalid input
    }
    
    let cleanCode = codeString.trim();
    
    // Remove async function declaration if present
    cleanCode = cleanCode.replace(/^async\s+function\s*\([^)]*\)\s*\{/, '');
    cleanCode = cleanCode.replace(/^async\s*\([^)]*\)\s*=>\s*\{/, '');
    cleanCode = cleanCode.replace(/^\([^)]*\)\s*=>\s*\{/, '');
    
    // Remove trailing }
    if (cleanCode.endsWith('}')) {
      cleanCode = cleanCode.slice(0, -1);
    }
    
    return cleanCode.trim();
  }

  /**
   * Execute an agent with proper dependency injection and bootstrap
   */
  async executeAgent(agentName, params, context = {}) {
    try {
      console.log(`🎯 Executing ${agentName}.${params.action || 'default'}`);
      
      const agent = await this.loadAgent(agentName);
      const dependencies = {};

      // Bootstrap agent if needed
      if (agent.bootstrap && !agent._bootstrapped) {
        console.log(`🔧 Bootstrapping ${agentName}...`);
        
        // Process dependencies if they exist
        if (agent.dependencies && Array.isArray(agent.dependencies)) {
          for (const dependency of agent.dependencies) {
            try {
              let module;
              const dependencyCamelcase = this.toCamelCase(dependency);
            
              // Standard import for other dependencies
              module = await import(dependency);
              dependencies[dependencyCamelcase] = module.default || module;
            } catch (error) {
              console.warn(`⚠️ Failed to import dependency ${dependency}:`, error.message);
            }
          }
        }
        
        console.log(`🔍 Dependencies being passed to ${agentName}:`, Object.keys(dependencies));
        console.log(`🔍 screenshotDesktop available:`, !!dependencies.screenshotDesktop);
        
        await agent.bootstrap(this.context, { ...this.context, ...context, ...dependencies });
        agent._bootstrapped = true;
        console.log(`✅ ${agentName} bootstrapped successfully`);
      }
      
      // Execute agent with orchestrator reference for agent-to-agent communication
      const enhancedContext = {
        ...this.context,
        ...context,
        ...dependencies, // Dependencies must come after context to avoid being overridden
        orchestrator: this, // Allow agents to call other agents
        executeAgent: this.executeAgent.bind(this), // Direct method access
        getAgent: this.getAgent.bind(this) // Access to other agents
      };
      
      console.log(`🔍 DEBUG: About to execute ${agentName}.execute with params:`, params);
      console.log(`🔍 DEBUG: Agent execute type: ${typeof agent.execute}`);
      console.log(`🔍 DEBUG: Agent execute code:`, agent.execute ? agent.execute.toString().substring(0, 100) + '...' : 'undefined');
      
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
      
      console.log(`📋 Executing workflow step ${workflowState.currentStep + 1}/${workflow.length}: ${agent}.${params.action}`);
      
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
   * Main orchestration method - processes intent classification payloads from backend
   * Maps intents to agents and uses executeWorkflow for orchestration
   */
  async ask(intentPayload, context = {}) {
    if (!this.initialized) {
      throw new Error('AgentOrchestrator not initialized. Call initialize() first.');
    }

    try {
      console.log('🎯 AgentOrchestrator.ask() called');
      console.log('📥 Intent payload type:', typeof intentPayload);
      console.log('📥 Intent payload:', JSON.stringify(intentPayload, null, 2));
      
      // Parse intent payload
      let processedPayload = this.parseIntentPayload(intentPayload);
      console.log('🔍 Processed payload:', JSON.stringify(processedPayload, null, 2));
      
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
      console.log('🚀 Executing workflow...', workflow);
      const workflowResult = await this.executeWorkflow(workflow, {
        ...context,
        originalPayload: processedPayload,
        userId: context.userId || 'default_user'
      });
      
      console.log('✅ Workflow execution completed');
      console.log('📊 Workflow result:', JSON.stringify(workflowResult, null, 2));
      
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
          sourceText: processedPayload.sourceText?.substring(0, 100) + '...' || 'No source text'
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
    console.log('🔍 Extracting intent data from payload...');
    
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
    return {
      intents: [{ intent: 'question', confidence: 0.8 }],
      primaryIntent: payload.primaryIntent || 'question',
      entities: payload.entities || [],
      requiresMemoryAccess: payload.requiresMemoryAccess || false,
      captureScreen: payload.captureScreen || false,
      sourceText: payload.sourceText || JSON.stringify(payload)
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
      
      console.log(`🎭 Processing intent: ${intent} -> Agents: [${agentNames.join(', ')}]`);
      
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
      case 'memory_search':
        return {
          action: 'query_memories',
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
      case 'command':
      case 'appointment':
      case 'task':
      case 'question':
      case 'greeting':                                                  
        return {
          action: 'store_context',
          data: {
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
      
      // Multi-agent intents
      'command': ['UserMemoryAgent', 'DynamicAgent'], // Commands need memory + dynamic execution
      'appointment': ['UserMemoryAgent', 'SchedulingAgent'], // Appointments need memory + scheduling
      'task': ['UserMemoryAgent', 'TaskAgent'], // Tasks need memory + task management
      'reminder': ['UserMemoryAgent', 'ReminderAgent'], // Reminders need memory + reminder system
      'automation': ['UserMemoryAgent', 'AutomationAgent'], // Automation needs memory + execution
      
      // Context-aware intents
      'question': ['UserMemoryAgent'], // Questions may need memory context
      'greeting': ['UserMemoryAgent'], // Greetings should be remembered
      'conversation': ['UserMemoryAgent'], // General conversation needs memory
      
      // Utility intents
      'parse-intent': ['IntentParserAgent'],
      'enrich-memory': ['MemoryEnrichmentAgent']
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

}

export default AgentOrchestrator;
           