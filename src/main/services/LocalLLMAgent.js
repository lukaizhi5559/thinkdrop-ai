/**
 * LocalLLMAgent - Central orchestration brain for ThinkDrop AI's agent ecosystem
 * Provides local-first agent orchestration with optional cloud sync
 */
const { EventEmitter } = require('events');
const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class LocalLLMAgent extends EventEmitter {
  constructor() {
    super();
    this.isInitialized = false;
    this.localLLMAvailable = false;
    this.currentLocalModel = null;
    this.database = null;
    this.agentCache = new Map();
    this.orchestrationCache = new Map();
    
    // Configuration
    this.config = {
      databasePath: path.join(process.cwd(), 'data', 'local-llm-agent.duckdb'),
      ollamaUrl: 'http://localhost:11434',
      preferredModel: 'phi3:mini', // Microsoft Phi-3 Mini - lightweight and efficient
      fallbackModels: ['llama3.2:1b', 'tinyllama'], // Fallback options if phi3:mini unavailable
      cacheExpiry: 5 * 60 * 1000, // 5 minutes
      maxCacheSize: 100,
      requestTimeout: 30000, // 30 seconds
      maxRetries: 3
    };
  }

  /**
   * Initialize LocalLLMAgent service
   */
  async initialize() {
    try {
      console.log('🤖 Initializing LocalLLMAgent...');
      
      // 1. Setup local database
      await this.initializeDatabase();
      
      // 2. Initialize local LLM connection
      await this.initializeLocalLLM();
      
      // 3. Load default agents
      await this.loadDefaultAgents();
      
      // 4. Setup health monitoring
      this.setupHealthMonitoring();
      
      this.isInitialized = true;
      console.log('✅ LocalLLMAgent initialized successfully');
      
      this.emit('initialized', {
        localLLMAvailable: this.localLLMAvailable,
        currentModel: this.currentLocalModel,
        agentCount: this.agentCache.size
      });
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize LocalLLMAgent:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Initialize DuckDB database with required schema
   */
  async initializeDatabase() {
    console.log('📊 Setting up local DuckDB database...');
    
    // Ensure data directory exists
    const dataDir = path.dirname(this.config.databasePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Initialize DuckDB database
    return new Promise((resolve, reject) => {
      this.database = new duckdb.Database(this.config.databasePath, (err) => {
        if (err) {
          console.error('❌ Failed to initialize DuckDB:', err);
          reject(err);
          return;
        }
        
        // Create connection for operations
        this.dbConnection = this.database.connect();
        this.initializeTables().then(resolve).catch(reject);
      });
    });
  }
  
  /**
   * Initialize database tables
   */
  async initializeTables() {
    return new Promise((resolve, reject) => {
      // Create tables using DuckDB connection
      const createTablesSQL = `
        -- Agent communications log
        CREATE TABLE IF NOT EXISTS agent_communications (
          id VARCHAR PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          from_agent VARCHAR NOT NULL,
          to_agent VARCHAR NOT NULL,
          message_type VARCHAR NOT NULL,
          content JSON NOT NULL,
          context JSON,
          success BOOLEAN NOT NULL,
          error_message VARCHAR,
          execution_time_ms INTEGER,
          synced_to_backend BOOLEAN DEFAULT FALSE,
          sync_attempts INTEGER DEFAULT 0,
          device_id VARCHAR NOT NULL,
          log_level VARCHAR DEFAULT 'info',
          execution_id VARCHAR,
          agent_version VARCHAR,
          injected_secrets JSON,
          context_used BOOLEAN DEFAULT FALSE,
          retry_count INTEGER DEFAULT 0
        );

        -- Cached agents from backend
        CREATE TABLE IF NOT EXISTS cached_agents (
          name VARCHAR PRIMARY KEY,
          id VARCHAR NOT NULL,
          description VARCHAR NOT NULL,
          parameters JSON NOT NULL,
          dependencies JSON NOT NULL,
          execution_target VARCHAR NOT NULL,
          requires_database BOOLEAN NOT NULL,
          database_type VARCHAR,
          code VARCHAR NOT NULL,
          config JSON NOT NULL,
          secrets JSON,
          orchestrator_metadata JSON,
          memory JSON,
          capabilities JSON,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          version VARCHAR NOT NULL,
          cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          access_count INTEGER DEFAULT 0,
          source VARCHAR DEFAULT 'backend'
        );

        -- Orchestration sessions
        CREATE TABLE IF NOT EXISTS orchestration_sessions (
          session_id VARCHAR PRIMARY KEY,
          workflow_name VARCHAR,
          status VARCHAR,
          current_step INTEGER,
          context_data JSON,
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          user_id VARCHAR,
          total_steps INTEGER,
          success_rate REAL,
          error_log JSON,
          performance_metrics JSON
        );

        -- User preferences and settings
        CREATE TABLE IF NOT EXISTS user_preferences (
          key VARCHAR PRIMARY KEY,
          value JSON NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      
      // Execute table creation using DuckDB connection
      this.dbConnection.exec(createTablesSQL, (err) => {
        if (err) {
          console.error('❌ Failed to create DuckDB tables:', err);
          reject(err);
          return;
        }
        
        console.log('✅ DuckDB database initialized successfully');
        resolve();
      });
    });
  }

  /**
   * Initialize local LLM connection (Ollama)
   */
  async initializeLocalLLM() {
    console.log('🧠 Initializing Local LLM connection...');
    
    try {
      // Check if Ollama is running
      const isOllamaRunning = await this.checkOllamaStatus();
      
      if (!isOllamaRunning) {
        console.log('⚠️ Ollama not running. LocalLLM features will be limited.');
        this.localLLMAvailable = false;
        return false;
      }
      
      // Test model availability
      const testResult = await this.testLocalLLMCapabilities();
      
      if (testResult.success) {
        console.log(`✅ Local LLM initialized: ${testResult.model}`);
        this.currentLocalModel = testResult.model;
        this.localLLMAvailable = true;
        return true;
      } else {
        console.log('⚠️ No working local models found. Using fallback mode.');
        this.localLLMAvailable = false;
        return false;
      }
      
    } catch (error) {
      console.error('❌ Local LLM initialization failed:', error.message);
      this.localLLMAvailable = false;
      return false;
    }
  }

  /**
   * Check if Ollama service is running
   */
  async checkOllamaStatus() {
    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test local LLM capabilities with Phi-3 Mini priority
   */
  async testLocalLLMCapabilities() {
    try {
      // Get available models
      const response = await fetch(`${this.config.ollamaUrl}/api/tags`);
      const data = await response.json();
      const models = data.models || [];
      
      if (models.length === 0) {
        return { success: false, error: 'No models available' };
      }
      
      // Find preferred model (Phi-3 Mini) first
      let testModel = null;
      const modelNames = models.map(m => m.name);
      
      // Check for preferred model
      if (modelNames.includes(this.config.preferredModel)) {
        testModel = this.config.preferredModel;
        console.log(`🎯 Using preferred model: ${testModel}`);
      } else {
        // Check fallback models
        for (const fallback of this.config.fallbackModels) {
          if (modelNames.includes(fallback)) {
            testModel = fallback;
            console.log(`🔄 Using fallback model: ${testModel}`);
            break;
          }
        }
        
        // If no preferred/fallback found, use first available
        if (!testModel) {
          testModel = models[0].name;
          console.log(`⚠️ Using first available model: ${testModel}`);
        }
      }
      
      const testPrompt = 'Respond with "OK" if you can understand this message.';
      
      const testResponse = await this.queryLocalLLM(testPrompt, {
        model: testModel,
        temperature: 0.1,
        maxTokens: 10
      });
      
      if (testResponse && testResponse.toLowerCase().includes('ok')) {
        return {
          success: true,
          model: testModel,
          totalModels: models.length
        };
      }
      
      return { success: false, error: 'Model test failed' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Query local LLM (Ollama)
   */
  async queryLocalLLM(prompt, options = {}) {
    if (!this.localLLMAvailable) {
      throw new Error('Local LLM not available');
    }
    
    const requestBody = {
      model: options.model || this.currentLocalModel,
      prompt: prompt,
      stream: false,
      options: {
        temperature: options.temperature || 0.7,
        num_predict: options.maxTokens || 1000,
        top_p: 0.9,
        top_k: 40
      }
    };
    
    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(options.timeout || this.config.requestTimeout)
      });
      
      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status}`);
      }
      
      const data = await response.json();
      return data.response;
      
    } catch (error) {
      console.error('❌ Local LLM query failed:', error.message);
      throw error;
    }
  }

  /**
   * Load default agents into cache
   */
  async loadDefaultAgents() {
    console.log('📦 Loading default agents...');
    
    // Default LocalLLMAgent entry
    const defaultAgents = [
      {
        name: 'LocalLLMAgent',
        id: 'local-llm-agent',
        description: 'Local LLM orchestration and prompt clarification',
        parameters: JSON.stringify({}),
        dependencies: JSON.stringify([]),
        execution_target: 'frontend',
        requires_database: true,
        database_type: 'duckdb',
        code: 'module.exports = { execute: async (params, context) => ({ success: true, message: "LocalLLMAgent ready" }) };',
        config: JSON.stringify({ timeout: 30000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({ priority: 'high', type: 'orchestrator' }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify(['orchestration', 'clarification', 'local_llm']),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: '1.0.0',
        source: 'default'
      }
    ];
    
    // Insert default agents
    const insertAgent = this.database.prepare(`
      INSERT OR REPLACE INTO cached_agents (
        name, id, description, parameters, dependencies, execution_target,
        requires_database, database_type, code, config, secrets,
        orchestrator_metadata, memory, capabilities, created_at,
        updated_at, version, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const agent of defaultAgents) {
      insertAgent.run(
        agent.name, agent.id, agent.description, agent.parameters,
        agent.dependencies, agent.execution_target, agent.requires_database,
        agent.database_type, agent.code, agent.config, agent.secrets,
        agent.orchestrator_metadata, agent.memory, agent.capabilities,
        agent.created_at, agent.updated_at, agent.version, agent.source
      );
      
      // Add to cache
      this.agentCache.set(agent.name, agent);
    }
    
    console.log(`✅ Loaded ${defaultAgents.length} default agents`);
  }

  /**
   * Setup health monitoring
   */
  setupHealthMonitoring() {
    // Health check every 30 seconds
    setInterval(async () => {
      try {
        const health = await this.getHealthStatus();
        this.emit('health-update', health);
      } catch (error) {
        console.error('❌ Health check failed:', error.message);
      }
    }, 30000);
  }

  /**
   * Get health status
   */
  async getHealthStatus() {
    return {
      timestamp: new Date().toISOString(),
      initialized: this.isInitialized,
      localLLMAvailable: this.localLLMAvailable,
      currentModel: this.currentLocalModel,
      databaseConnected: this.database !== null,
      agentCacheSize: this.agentCache.size,
      orchestrationCacheSize: this.orchestrationCache.size
    };
  }

  /**
   * Main orchestration method - decides local vs backend processing
   */
  async orchestrateAgents(userInput, context = {}) {
    const startTime = Date.now();
    const sessionId = this.generateSessionId();
    
    console.log(`🎯 Starting orchestration: ${sessionId}`);
    
    try {
      // 1. Analyze user input complexity
      const complexity = await this.analyzeInputComplexity(userInput);
      
      // 2. Decide local vs backend processing
      if (complexity.canHandleLocally && this.localLLMAvailable) {
        return await this.handleLocalOrchestration(userInput, context, sessionId);
      } else {
        return await this.escalateToBackend(userInput, context, sessionId, complexity);
      }
      
    } catch (error) {
      console.error(`❌ Orchestration failed: ${sessionId}`, error.message);
      
      // Log the failure
      this.logCommunication({
        from_agent: 'LocalLLMAgent',
        to_agent: 'system',
        message_type: 'orchestration_error',
        content: { userInput, error: error.message },
        context,
        success: false,
        error_message: error.message,
        execution_time_ms: Date.now() - startTime,
        session_id: sessionId
      });
      
      throw error;
    }
  }

  /**
   * Analyze input complexity to decide local vs backend
   */
  async analyzeInputComplexity(userInput) {
    // Simple heuristics for now - can be enhanced with local LLM
    const complexity = {
      canHandleLocally: true,
      reasons: [],
      estimatedComplexity: 'low'
    };
    
    const input = userInput.toLowerCase();
    
    // High complexity indicators
    if (input.includes('create agent') || input.includes('generate code')) {
      complexity.canHandleLocally = false;
      complexity.reasons.push('Agent generation requires backend');
      complexity.estimatedComplexity = 'high';
    }
    
    if (input.includes('complex workflow') || input.includes('multi-step')) {
      complexity.canHandleLocally = false;
      complexity.reasons.push('Complex workflows require backend orchestration');
      complexity.estimatedComplexity = 'high';
    }
    
    // Medium complexity - can try local first
    if (input.includes('analyze') || input.includes('summarize')) {
      complexity.estimatedComplexity = 'medium';
    }
    
    return complexity;
  }

  /**
   * Handle orchestration locally
   */
  async handleLocalOrchestration(userInput, context, sessionId) {
    console.log(`🏠 Handling locally: ${sessionId}`);
    
    // For now, provide a basic local response
    // This will be enhanced with actual agent execution
    const response = {
      success: true,
      sessionId,
      response: `Local processing: ${userInput}`,
      handledBy: 'LocalLLMAgent',
      timestamp: new Date().toISOString(),
      executionTime: Date.now()
    };
    
    // Log the communication
    this.logCommunication({
      from_agent: 'LocalLLMAgent',
      to_agent: 'user',
      message_type: 'local_response',
      content: { userInput, response: response.response },
      context,
      success: true,
      execution_time_ms: Date.now() - response.executionTime,
      session_id: sessionId
    });
    
    return response;
  }

  /**
   * Escalate to backend processing
   */
  async escalateToBackend(userInput, context, sessionId, complexity) {
    console.log(`☁️ Escalating to backend: ${sessionId}`);
    
    // For now, return a placeholder - will integrate with existing backendIntegration service
    const response = {
      success: true,
      sessionId,
      response: `Backend escalation needed for: ${userInput}`,
      handledBy: 'BackendLLMAgent',
      escalationReason: complexity.reasons.join(', '),
      timestamp: new Date().toISOString()
    };
    
    return response;
  }

  /**
   * Log agent communication
   */
  logCommunication(logData) {
    try {
      const id = this.generateCallId();
      const deviceId = this.getDeviceId();
      
      const insertLog = this.database.prepare(`
        INSERT INTO agent_communications (
          id, from_agent, to_agent, message_type, content, context,
          success, error_message, execution_time_ms, device_id,
          log_level, execution_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertLog.run(
        id,
        logData.from_agent,
        logData.to_agent,
        logData.message_type,
        JSON.stringify(logData.content),
        JSON.stringify(logData.context || {}),
        logData.success,
        logData.error_message || null,
        logData.execution_time_ms || 0,
        deviceId,
        logData.log_level || 'info',
        logData.session_id || null
      );
      
    } catch (error) {
      console.error('❌ Failed to log communication:', error.message);
    }
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique call ID
   */
  generateCallId() {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get device ID
   */
  getDeviceId() {
    // Simple device ID based on hostname and platform
    const os = require('os');
    return crypto.createHash('sha256')
      .update(`${os.hostname()}-${os.platform()}-${os.arch()}`)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log('🧹 Cleaning up LocalLLMAgent...');
    
    if (this.database) {
      this.database.close();
    }
    
    this.agentCache.clear();
    this.orchestrationCache.clear();
    
    console.log('✅ LocalLLMAgent cleanup completed');
  }
}

module.exports = LocalLLMAgent;
