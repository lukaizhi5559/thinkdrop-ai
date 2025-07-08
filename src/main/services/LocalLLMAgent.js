/**
 * LocalLLMAgent - Central orchestration brain for ThinkDrop AI's agent ecosystem
 * Provides local-first agent orchestration with optional cloud sync
 */
import { EventEmitter } from 'events';
import { ipcMain } from 'electron';
import duckdb from 'duckdb';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import os from 'os';
import { AgentSandbox } from './AgentSandbox.js';

class LocalLLMAgent extends EventEmitter {
  constructor() {
    super();
    this.isInitialized = false;
    this.localLLMAvailable = false;
    this.currentLocalModel = null;
    this.database = null;
    this.dbConnection = null;
    this.agentCache = new Map();
    this.orchestrationCache = new Map();

    // Persistent session management for conversation memory
    this.currentSessionId = null;
    this.sessionStartTime = null;

    // Secure agent sandbox using Node.js vm
    this.agentSandbox = new AgentSandbox({
      memoryLimit: 128, // 128MB memory monitoring
      timeoutMs: 30000, // 30 second timeout
      allowedCapabilities: [
        'console.log',
        'JSON.parse',
        'JSON.stringify',
        'Date.now',
        'Math.*'
      ]
    });

    // Configuration
    this.config = {
      databasePath: path.join(os.homedir(), '.thinkdrop', 'agent_communications.duckdb'),
      ollamaUrl: 'http://127.0.0.1:11434', // Use IPv4 explicitly to avoid IPv6 connection issues
      preferredModels: ['phi3:mini', 'llama3.2:1b', 'tinyllama'],
      maxRetries: 3,
      retryDelay: 1000,
      fallbackModels: ['llama3.2:1b', 'tinyllama'], // Fallback options if phi3:mini unavailable
      cacheExpiry: 5 * 60 * 1000, // 5 minutes
      maxCacheSize: 100,
      requestTimeout: 60000 // 60 seconds
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

    return new Promise((resolve, reject) => {
      this.database = new duckdb.Database(this.config.databasePath, (err) => {
        if (err) {
          console.error('❌ Failed to initialize DuckDB:', err);
          reject(err);
          return;
        }

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
      const createTablesSQL = `
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

        CREATE TABLE IF NOT EXISTS user_memories (
          key VARCHAR PRIMARY KEY,
          value TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
          key VARCHAR PRIMARY KEY,
          value JSON NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

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
      const isOllamaRunning = await this.checkOllamaStatus();

      if (!isOllamaRunning) {
        console.log('⚠️ Ollama not running. LocalLLM features will be limited.');
        this.localLLMAvailable = false;
        return false;
      }

      const testResult = await this.retryOperation(
        () => this.testLocalLLMCapabilities(),
        2, // Max 2 retries for initialization
        2000 // 2 second delay between retries
      ).catch((error) => {
        console.warn('⚠️ LLM initialization failed after retries:', error.message);
        return { success: false, error: error.message };
      });

      if (testResult.success) {
        this.localLLMAvailable = true;
        this.currentLocalModel = testResult.model;
        console.log(`✅ Local LLM initialized: ${testResult.model}`);

        // Warm up the model with a simple query to improve subsequent response times
        await this.queryLocalLLM('Hi', {
          temperature: 0.1,
          maxTokens: 3,
          timeout: 10000
        }).catch((error) => {
          console.warn('⚠️ Model warm-up failed (non-critical):', error.message);
        });

        return true;
      }

      console.error(`❌ Local LLM initialization failed: ${testResult.error}`);
      this.localLLMAvailable = false;
      return false;
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
    return new Promise((resolve) => {
      const url = new URL(`${this.config.ollamaUrl}/api/tags`);

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: '/api/tags',
          method: 'GET',
          timeout: 5000
        },
        (res) => {
          console.log(`🔍 Ollama status check: ${res.statusCode}`);
          resolve(res.statusCode === 200);
        }
      );

      req.on('error', (error) => {
        console.log(`🔍 Ollama status check failed: ${error.message}`);
        resolve(false);
      });

      req.on('timeout', () => {
        console.log('🔍 Ollama status check timed out');
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Get available models from Ollama using Node.js http
   */
  async getOllamaModels() {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.config.ollamaUrl}/api/tags`);

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: '/api/tags',
          method: 'GET',
          timeout: 5000
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (error) {
              reject(new Error('Failed to parse models response'));
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Test local LLM capabilities with Phi-3 Mini priority
   */
  async testLocalLLMCapabilities() {
    let testModel = null;

    try {
      const modelsData = await this.getOllamaModels();
      const models = modelsData.models || [];

      if (models.length === 0) {
        return { success: false, error: 'No models available' };
      }

      const modelNames = models.map((m) => m.name);

      // Check for preferred model
      if (modelNames.includes(this.config.preferredModels[0])) {
        testModel = this.config.preferredModels[0];
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
      console.log(`🧪 Testing model ${testModel} with prompt: "${testPrompt}"`);

      let testResponse;
      try {
        testResponse = await this.queryLocalLLM(testPrompt, {
          model: testModel,
          temperature: 0.1,
          maxTokens: 5,
          timeout: 12000,
          bypassAvailabilityCheck: true
        });
      } catch (error) {
        console.warn(`⚠️ Model ${testModel} failed, trying fallback models...`);

        for (const fallbackModel of ['tinyllama', 'llama3.2:1b']) {
          if (modelNames.includes(fallbackModel)) {
            console.log(`🔄 Trying fallback model: ${fallbackModel}`);
            try {
              testResponse = await this.queryLocalLLM(testPrompt, {
                model: fallbackModel,
                temperature: 0.1,
                maxTokens: 5,
                timeout: 8000,
                bypassAvailabilityCheck: true
              });
              testModel = fallbackModel;
              break;
            } catch (fallbackError) {
              console.warn(`⚠️ Fallback model ${fallbackModel} also failed:`, fallbackError.message);
              continue;
            }
          }
        }

        if (!testResponse) {
          throw error;
        }
      }

      console.log(`🧪 Model test response: "${testResponse}"`);

      if (testResponse && testResponse.toLowerCase().includes('ok')) {
        console.log(`✅ Model test passed for ${testModel}`);
        return {
          success: true,
          model: testModel,
          totalModels: models.length
        };
      }

      console.log(`❌ Model test failed for ${testModel} - response did not contain 'ok'`);
      return { success: false, error: 'Model test failed' };
    } catch (error) {
      console.error(`🚨 Model test exception for ${testModel}:`, error.message);
      console.error('🚨 Full error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Query local LLM (Ollama)
   */
  async queryLocalLLM(prompt, options = {}) {
    if (!this.localLLMAvailable && !options.bypassAvailabilityCheck) {
      throw new Error('Local LLM not available');
    }

    const systemContext = `You are Thinkdrop AI, a fast desktop assistant. Be concise and helpful.`;

    const recentMessages = await this.getRecentConversation(options.sessionId, 3);
    let conversationContext = '';
    if (recentMessages.length > 0) {
      conversationContext = '\nRecent conversation:\n' + recentMessages
        .map((msg) =>
          `${
            msg.from_agent === 'user' ? 'User' : 'AI'
          }: ${JSON.parse(msg.content).userInput || JSON.parse(msg.content).response || ''}`
        )
        .join('\n') + '\n';
    }

    const contextualPrompt = `${systemContext}${conversationContext}\nUser: ${prompt}\nAI:`;

    const requestBody = {
      model: options.model || this.currentLocalModel,
      prompt: contextualPrompt,
      stream: options.stream !== false,
      options: {
        temperature: options.temperature || 0.0,
        num_predict: options.maxTokens || 150,
        top_p: 0.95,
        top_k: 5,
        repeat_penalty: 1.0,
        num_ctx: options.contextWindow || 1024,
        num_thread: options.numThread || 1,
        stop: options.stopTokens || ['\n\n', 'User:', 'Human:']
      }
    };

    return new Promise((resolve, reject) => {
      const url = new URL(`${this.config.ollamaUrl}/api/generate`);
      const postData = JSON.stringify(requestBody);
      const timeoutMs = options.timeout || 15000;

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: '/api/generate',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                reject(new Error(`LLM request failed: ${res.statusCode} - ${data}`));
                return;
              }

              const lines = data.trim().split('\n');
              let fullResponse = '';

              for (const line of lines) {
                if (line.trim()) {
                  try {
                    const parsed = JSON.parse(line);
                    if (parsed.response) {
                      fullResponse += parsed.response;
                    }
                    if (parsed.done) {
                      break;
                    }
                  } catch (parseError) {
                    continue;
                  }
                }
              }

              resolve(fullResponse || 'No response generated');
            } catch (error) {
              console.error('❌ Local LLM parse error:', error.message);
              reject(error);
            }
          });
        }
      );

      req.on('error', (error) => {
        console.error('❌ Local LLM connection error:', error.message);
        if (error.code === 'ECONNRESET' || error.message.includes('socket hang up')) {
          reject(new Error('Connection lost - please check if Ollama is running'));
        } else {
          reject(new Error(`Connection failed: ${error.message}`));
        }
      });

      req.on('timeout', () => {
        console.warn('⚠️ Local LLM request timeout');
        req.destroy();
        reject(new Error('Request timeout - LLM took too long to respond'));
      });

      const timeoutHandle = setTimeout(() => {
        req.destroy();
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      req.on('close', () => {
        clearTimeout(timeoutHandle);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Load default agents into cache
   */
  async loadDefaultAgents() {
    console.log('📦 Loading default agents...');

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
      },
      {
        name: 'UserMemoryAgent',
        id: 'user-memory-agent',
        description: 'Personal memory CRUD operations for user context and preferences',
        parameters: JSON.stringify({ memoryTypes: ['personal', 'preferences', 'context'] }),
        dependencies: JSON.stringify([]),
        execution_target: 'frontend',
        requires_database: false,
        database_type: 'duckdb',
        code: `module.exports = {
          execute: async (params, context) => {
            const { action, key, value, query } = params;
            switch (action) {
              case 'store':
                try {
                  console.log(\`🔍 Requesting memory storage: key='\${key}'\`);
                  return {
                    success: true,
                    action: 'store_memory',
                    key,
                    value,
                    timestamp: new Date().toISOString()
                  };
                } catch (error) {
                  console.error(\`❌ Memory storage request error: \${error.message}\`);
                  return { success: false, error: \`Failed to request memory storage: \${error.message}\` };
                }
              case 'retrieve':
                try {
                  console.log('🔍 Requesting memory retrieval');
                  return {
                    success: true,
                    action: 'retrieve_memory',
                    key: key || '*'
                  };
                } catch (error) {
                  return { success: false, error: \`Failed to request memory retrieval: \${error.message}\` };
                }
              case 'search':
                try {
                  console.log(\`🔍 Requesting memory search for: '\${query}'\`);
                  return {
                    success: true,
                    action: 'search_memory',
                    query
                  };
                } catch (error) {
                  return { success: false, error: \`Search request failed: \${error.message}\` };
                }
              default:
                return { success: false, error: 'Unknown action' };
            }
          }
        };`,
        config: JSON.stringify({ timeout: 10000, cacheExpiry: 300000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({ priority: 'high', type: 'memory' }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify(['memory_crud', 'user_context', 'personalization']),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: '1.0.0',
        source: 'default'
      },
      {
        name: 'MemoryEnrichmentAgent',
        id: 'memory-enrichment-agent',
        description: 'Prompt personalization using user memories and context',
        parameters: JSON.stringify({ enrichmentTypes: ['personal', 'contextual', 'historical'] }),
        dependencies: JSON.stringify(['UserMemoryAgent']),
        execution_target: 'frontend',
        requires_database: true,
        database_type: 'duckdb',
        code: `module.exports = {
          execute: async (params, context) => {
            const { prompt, userMemories } = params;
            let enrichedPrompt = prompt;
            if (userMemories && userMemories.name) {
              enrichedPrompt = \`[User Context: Name is \${userMemories.name}] \${prompt}\`;
            }
            return {
              success: true,
              enrichedPrompt,
              contextAdded: Object.keys(userMemories || {}).length
            };
          }
        };`,
        config: JSON.stringify({ timeout: 5000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({ priority: 'medium', type: 'enrichment' }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify(['prompt_enrichment', 'context_injection', 'personalization']),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: '1.0.0',
        source: 'default'
      },
      {
        name: 'IntentParserAgent',
        id: 'intent-parser-agent',
        description: 'Intent detection and classification for user requests using LLM',
        parameters: JSON.stringify({
          intents: [
            'question',
            'command',
            'memory_store',
            'memory_retrieve',
            'external_data_required'
          ],
          categories: [
            'personal_info',
            'preferences',
            'calendar',
            'travel',
            'work',
            'health',
            'general'
          ]
        }),
        dependencies: JSON.stringify([]),
        execution_target: 'frontend',
        requires_database: false,
        database_type: null,
        code: `module.exports = {execute: async function(params, context) {const message = params.message;const llmClient = context?.llmClient;const fallbackDetection = function(msg) {const lowerMessage = msg.toLowerCase();let intent = 'question';let memoryCategory = null;let confidence = 0.7;if(lowerMessage.match(/my name (is|=) [\w\s]+/i)){intent = 'memory_store';memoryCategory = 'personal_info';confidence = 0.8;}else if(lowerMessage.match(/my favorite|i like|i prefer|i love/i) && lowerMessage.match(/color|food|movie|book|music|song/i)){intent = 'memory_store';memoryCategory = 'preferences';confidence = 0.8;}else if(lowerMessage.match(/what.*my name|who am i/i)){intent = 'memory_retrieve';memoryCategory = 'personal_info';confidence = 0.8;}else if(lowerMessage.match(/what.*favorite|what.*like|what.*prefer/i)){intent = 'memory_retrieve';memoryCategory = 'preferences';confidence = 0.8;}else if(lowerMessage.match(/appointment|schedule|meeting|calendar|flight|plane|travel|trip|airport/i) || lowerMessage.match(/what time|when is|tomorrow/i)){intent = 'external_data_required';memoryCategory = lowerMessage.match(/flight|plane|airport|travel|trip/i) ? 'travel' : 'calendar';confidence = 0.8;}return {success: true,intent,memoryCategory,confidence,entities: [],requiresExternalData: intent === 'external_data_required'};};if(!llmClient){console.log('LLM client not available for intent detection, using fallback');return fallbackDetection(message);}try{const prompt = "You are an intent detection system. Classify the user message into: question, command, memory_store, memory_retrieve, or external_data_required. For memory/external data, specify category: personal_info, preferences, calendar, travel, work, health, general. Include confidence (0-1) and if external data is needed. Extract entities. Reply in JSON format only. User message: " + message;const result = await llmClient.complete({prompt,max_tokens: 500,temperature: 0.1,stop: ["\n\n"]});try{const parsedResult = JSON.parse(result.text);console.log('LLM intent detection result:', parsedResult);return {success: true,...parsedResult};}catch(parseError){console.error('Failed to parse LLM intent detection result:', parseError);return fallbackDetection(message);}}catch(error){console.error('Error in LLM intent detection:', error);return fallbackDetection(message);}}};}
`,
        config: JSON.stringify({ timeout: 5000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({ priority: 'high', type: 'parser' }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify(['intent_detection', 'entity_extraction', 'classification']),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: '1.0.0',
        source: 'default'
      }
    ];

    const insertAgent = this.database.prepare(`
      INSERT OR REPLACE INTO cached_agents (
        name, id, description, parameters, dependencies, execution_target,
        requires_database, database_type, code, config, secrets,
        orchestrator_metadata, memory, capabilities, created_at,
        updated_at, version, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    defaultAgents.forEach((agent) => {
      insertAgent.run(
        agent.name,
        agent.id,
        agent.description,
        agent.parameters,
        agent.dependencies,
        agent.execution_target,
        agent.requires_database,
        agent.database_type,
        agent.code,
        agent.config,
        agent.secrets,
        agent.orchestrator_metadata,
        agent.memory,
        agent.capabilities,
        agent.created_at,
        agent.updated_at,
        agent.version,
        agent.source
      );

      this.agentCache.set(agent.name, agent);
    });

    console.log(`✅ Loaded ${defaultAgents.length} default agents`);
  }

  /**
   * Setup health monitoring
   */
  setupHealthMonitoring() {
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
   * Register IPC handlers for LocalLLMAgent
   */
  registerIpcHandlers() {
    console.log('📡 Registering LocalLLMAgent IPC handlers...');
    
    ipcMain.handle('local-llm:health', async () => {
      return await this.getHealthStatus();
    });

    ipcMain.handle('local-llm:process-message', async (event, message) => {
      return await this.processMessage(message);
    });

    ipcMain.handle('local-llm:get-all-memories', async () => {
      return await this.getAllUserMemories();
    });
    
    console.log('✅ LocalLLMAgent IPC handlers registered successfully');
  }

  /**
   * Get health status
   */
  async getHealthStatus() {
    const health = {
      timestamp: new Date().toISOString(),
      initialized: this.isInitialized,
      localLLMAvailable: this.localLLMAvailable,
      currentModel: this.currentLocalModel,
      databaseConnected: this.database !== null,
      agentCacheSize: this.agentCache.size,
      orchestrationCacheSize: this.orchestrationCache.size
    };

    try {
      if (this.dbConnection) {
        await new Promise((resolve, reject) => {
          this.dbConnection.run('SELECT 1', [], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        health.errors = ['Database connection not available'];
      }

      if (this.localLLMAvailable) {
        try {
          await this.queryLocalLLM('Health check', {
            maxTokens: 10,
            bypassAvailabilityCheck: false
          });
        } catch (error) {
          health.localLLMAvailable = false;
          health.errors = health.errors || [];
          health.errors.push(`LLM test failed: ${error.message}`);
        }
      } else {
        health.errors = health.errors || [];
        health.errors.push('Local LLM not available');
      }

      if (!health.errors || health.errors.length === 0) {
        health.status = 'healthy';
      } else if (health.initialized && health.databaseConnected) {
        health.status = 'degraded';
      } else {
        health.status = 'unhealthy';
      }
    } catch (error) {
      health.status = 'error';
      health.errors = health.errors || [];
      health.errors.push(`Health check failed: ${error.message}`);
    }

    return health;
  }

  /**
   * Main orchestration method - decides local vs backend processing
   */
  async orchestrateAgents(userInput, context = {}) {
    const startTime = Date.now();

    if (!this.currentSessionId || this.shouldStartNewSession()) {
      this.currentSessionId = this.generateSessionId();
      this.sessionStartTime = Date.now();
      console.log(`🆕 Starting new conversation session: ${this.currentSessionId}`);
    } else {
      console.log(`🔄 Continuing conversation session: ${this.currentSessionId}`);
    }

    const sessionId = this.currentSessionId;
    console.log(`🎯 Starting orchestration: ${sessionId}`);

    try {
      const complexity = await this.analyzeInputComplexity(userInput);

      if (complexity.canHandleLocally && this.localLLMAvailable) {
        return await this.handleLocalOrchestration(userInput, context, sessionId);
      }
      return await this.escalateToBackend(userInput, context, sessionId, complexity);
    } catch (error) {
      console.error(`❌ Orchestration failed: ${sessionId}`, error.message);

      await this.logCommunication({
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
    const complexity = {
      canHandleLocally: true,
      reasons: [],
      estimatedComplexity: 'low'
    };

    const input = userInput.toLowerCase();

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

    if (input.includes('analyze') || input.includes('summarize')) {
      complexity.estimatedComplexity = 'medium';
    }

    return complexity;
  }

  /**
   * Handle orchestration locally using agent-based architecture
   */
  async handleLocalOrchestration(userInput, context, sessionId) {
    console.log(`🏠 Handling locally with agents: ${sessionId}`);
    const startTime = Date.now();

    try {
      console.log('🎯 Parsing intent...');
      const intentResult = await this.executeAgent('IntentParserAgent', { message: userInput }, context);
      const intent = intentResult.success ? intentResult.intent : 'question';
      const memoryCategory = intentResult.memoryCategory || null;
      const requiresExternalData = intentResult.requiresExternalData || false;

      console.log(`🎯 Detected intent: ${intent}, category: ${memoryCategory || 'general'}, requires external data: ${requiresExternalData}`);

      // Handle requests that require external data (prevent hallucinations)
      if (requiresExternalData) {
        console.log('🌐 Request requires external data, providing appropriate response');
        const response = {
          success: true,
          message: "I'm sorry, but I don't have access to your calendar or appointment information. This would require integration with your calendar service or other external data sources.",
          executionTime: Date.now() - startTime,
          sessionId
        };

        await this.logCommunication({
          from_agent: 'LocalLLMAgent',
          to_agent: 'user',
          message_type: 'external_data_required',
          content: { userInput, response: response.message },
          context,
          success: true,
          execution_time_ms: response.executionTime,
          session_id: sessionId
        });

        return response;
      }

      let userMemories = {};
      if (intent === 'memory_store') {
        console.log('💾 Processing memory storage request with LLM extraction...');
        
        // Use LLM to extract key-value pairs from the memory storage request
        const memoryExtractionPrompt = `Extract the key-value pair from this memory storage request. Respond with ONLY a JSON object containing "key" and "value" fields. Use snake_case for keys and be concise.

User input: "${userInput}"

Examples:
- "my name is John" → {"key": "name", "value": "John"}
- "remember my favorite color is blue" → {"key": "favorite_color", "value": "blue"}
- "I work at Google" → {"key": "workplace", "value": "Google"}

JSON:`;

        try {
          const llmResponse = await this.queryLocalLLM(memoryExtractionPrompt, {
            max_tokens: 100,
            temperature: 0.1,
            stop: ['\n', '```']
          });

          console.log('🧠 LLM memory extraction response:', llmResponse);

          // Parse the LLM response to extract key-value pair
          let memoryData;
          try {
            // Clean up the response (remove any markdown or extra text)
            const cleanResponse = llmResponse.replace(/```json|```|`/g, '').trim();
            memoryData = JSON.parse(cleanResponse);
          } catch (parseError) {
            console.log('⚠️ Failed to parse LLM response, trying fallback extraction...');
            
            // Simple fallback patterns as safety net
            const fallbackPatterns = [
              { pattern: /name is ([\w\s]+)/i, key: 'name' },
              { pattern: /favorite color is ([\w\s]+)/i, key: 'favorite_color' },
              { pattern: /work at ([\w\s]+)/i, key: 'workplace' }
            ];
            
            for (const { pattern, key } of fallbackPatterns) {
              const match = userInput.match(pattern);
              if (match) {
                memoryData = { key, value: match[1].trim() };
                break;
              }
            }
          }

          if (memoryData && memoryData.key && memoryData.value) {
            console.log(`💾 Storing ${memoryData.key}: ${memoryData.value}`);

            await this.executeAgent('UserMemoryAgent', {
              action: 'store',
              key: memoryData.key,
              value: memoryData.value
            }, context);

            userMemories[memoryData.key] = memoryData.value;
          } else {
            console.log('⚠️ Could not extract memory data from input:', userInput);
          }
        } catch (error) {
          console.error('❌ Failed to extract memory with LLM:', error);
        }
      } else {
        console.log('🧠 Retrieving user memories...');
        const memoryResult = await this.executeAgent('UserMemoryAgent', { action: 'retrieve' }, context);

        if (memoryResult.success && memoryResult.results) {
          userMemories = memoryResult.results.reduce((acc, mem) => ({ ...acc, [mem.key]: mem.value }), {});
          console.log('🧠 Retrieved memories:', Object.keys(userMemories));
        }
      }

      console.log('✨ Enriching prompt with user context...');
      const enrichmentResult = await this.executeAgent('MemoryEnrichmentAgent', {
        prompt: userInput,
        userMemories
      }, context);
      const enrichedPrompt = enrichmentResult.success ? enrichmentResult.enrichedPrompt : userInput;

      console.log(`✨ Context added: ${enrichmentResult.contextAdded || 0} items`);

      console.log('🤖 Generating LLM response...');
      console.log('🎯 Enriched prompt:', enrichedPrompt);
      const llmResponse = await this.queryLocalLLM(enrichedPrompt, {
        sessionId,
        temperature: 0.0,
        maxTokens: 150,
        contextWindow: 1024,
        numThread: 1,
        stopTokens: ['\n\n'],
        timeout: 12000
      });
      console.log('🎯 LLM raw response:', JSON.stringify(llmResponse));

      const response = {
        success: true,
        message: llmResponse || 'Response generated successfully',
        source: 'agent_orchestrated_llm',
        model: this.currentLocalModel,
        executionTime: Date.now() - startTime,
        sessionId,
        agentsUsed: ['IntentParserAgent', 'UserMemoryAgent', 'MemoryEnrichmentAgent'],
        intent,
        contextEnriched: enrichmentResult.contextAdded > 0
      };

      await this.logCommunication({
        from_agent: 'LocalLLMAgent',
        to_agent: 'user',
        message_type: 'agent_orchestration_success',
        content: {
          userInput,
          enrichedPrompt,
          response: response.message,
          intent,
          agentsUsed: response.agentsUsed
        },
        context,
        success: true,
        execution_time_ms: response.executionTime,
        session_id: sessionId
      });

      return response;
    } catch (error) {
      console.error(`❌ Agent orchestration failed: ${sessionId}`, error.message);

      const fallbackResponse = {
        success: false,
        message: 'I apologize, but I\'m having trouble processing your request right now. Please try again.',
        source: 'fallback',
        timestamp: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        error: error.message,
        fallback: true
      };

      await this.logCommunication({
        from_agent: 'LocalLLMAgent',
        to_agent: 'user',
        message_type: 'local_llm_error',
        content: { userInput, error: error.message },
        context,
        success: false,
        error_message: error.message,
        execution_time_ms: fallbackResponse.executionTime,
        session_id: sessionId
      });

      return fallbackResponse;
    }
  }

  /**
   * Escalate to backend processing
   */
  async escalateToBackend(userInput, context, sessionId, complexity) {
    console.log(`☁️ Escalating to backend: ${sessionId}`);

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
   * Log agent communication to DuckDB
   */
  async logCommunication(logData) {
    if (!this.dbConnection) {
      console.warn('⚠️ Database connection not available for logging');
      return;
    }

    try {
      const id = this.generateCallId();
      const deviceId = this.getDeviceId();
      const timestamp = new Date().toISOString();
      const escapedContent = JSON.stringify(logData.content || {}).replace(/'/g, "''");
      const escapedContext = JSON.stringify(logData.context || {}).replace(/'/g, "''");
      const errorMessage = logData.error_message ? `'${logData.error_message.replace(/'/g, "''")}'` : 'NULL';
      const executionId = logData.session_id ? `'${logData.session_id}'` : 'NULL';

      const insertSQL = `
        INSERT INTO agent_communications (
          id, timestamp, from_agent, to_agent, message_type, content, context,
          success, error_message, execution_time_ms, synced_to_backend, sync_attempts,
          device_id, log_level, execution_id, agent_version, injected_secrets,
          context_used, retry_count
        ) VALUES (
          '${id}',
          '${timestamp}',
          '${logData.from_agent || 'unknown'}',
          '${logData.to_agent || 'unknown'}',
          '${logData.message_type || 'unknown'}',
          '${escapedContent}',
          '${escapedContext}',
          ${logData.success !== undefined ? logData.success : false},
          ${errorMessage},
          ${logData.execution_time_ms || 0},
          false,
          0,
          '${deviceId}',
          '${logData.log_level || 'info'}',
          ${executionId},
          '1.0.0',
          NULL,
          false,
          0
        )
      `;

      await new Promise((resolve, reject) => {
        this.dbConnection.run(insertSQL, (err) => {
          if (err) {
            console.error('❌ DuckDB insert error:', err.message);
            console.error('SQL:', insertSQL);
            reject(err);
          } else {
            resolve();
          }
        });
      });

      console.log(`📝 Logged communication: ${logData.from_agent} → ${logData.to_agent} (${logData.message_type})`);
    } catch (error) {
      console.error('❌ Failed to log communication:', error.message);
    }
  }

  /**
   * Get recent conversation for memory context
   */
  async getRecentConversation(sessionId, limit = 3) {
    if (!this.dbConnection || !sessionId) {
      return [];
    }

    try {
      const sql = `
        SELECT from_agent, content, timestamp
        FROM agent_communications
        WHERE execution_id = '${sessionId}'
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `;

      return new Promise((resolve) => {
        this.dbConnection.all(sql, (err, rows) => {
          if (err) {
            console.warn('⚠️ Failed to get recent conversation:', err.message);
            resolve([]);
          } else {
            resolve(rows.reverse());
          }
        });
      });
    } catch (error) {
      console.warn('⚠️ Error getting recent conversation:', error.message);
      return [];
    }
  }

  /**
   * Execute a specific agent by name using secure sandbox
   * Default trusted agents can bypass the sandbox for performance and reliability
   */
  async executeAgent(agentName, params, context = {}) {
    try {
      const agent = this.agentCache.get(agentName);
      if (!agent) {
        throw new Error(`Agent '${agentName}' not found in cache`);
      }

      // List of trusted default agents that can bypass the sandbox
      const trustedAgents = ['IntentParserAgent'];
      const bypassSandbox = trustedAgents.includes(agentName);

      if (bypassSandbox) {
        console.log(`🔑 Executing trusted agent directly (sandbox bypass): ${agentName}`);
      } else {
        console.log(`🔒 Executing agent in secure sandbox: ${agentName}`);
      }

      const agentContext = {
        ...context,
        agentName,
        timestamp: new Date().toISOString()
      };
      
      // Add llmClient adapter for IntentParserAgent
      if (agentName === 'IntentParserAgent' && this.localLLMAvailable) {
        console.log('🧠 Adding LLM client to IntentParserAgent context');
        // Create an adapter that wraps queryLocalLLM for the agent to use
        agentContext.llmClient = {
          complete: async (options) => {
            try {
              const response = await this.queryLocalLLM(options.prompt, {
                temperature: options.temperature || 0.1,
                maxTokens: options.max_tokens || 500,
                stopTokens: options.stop || []
              });
              return { text: response };
            } catch (error) {
              console.error('❌ LLM client error:', error.message);
              throw error;
            }
          }
        };
      }

      let result;
      
      // Execute trusted agents directly, bypassing the sandbox
      if (bypassSandbox) {
        try {
          // For IntentParserAgent, use a hardcoded implementation
          if (agentName === 'IntentParserAgent') {
            console.log(`🔑 Using hardcoded implementation for ${agentName}`);
            
            // Direct implementation of IntentParserAgent
            const message = params.message;
            const llmClient = agentContext?.llmClient;
            
            // Fallback detection function
            const detectIntent = (msg) => {
              const lowerMessage = msg.toLowerCase();
              let intent = 'question';
              let memoryCategory = null;
              let confidence = 0.7;
              
              if(lowerMessage.match(/my name (is|=) [\w\s]+/i)) {
                intent = 'memory_store';
                memoryCategory = 'personal_info';
                confidence = 0.8;
              } else if(lowerMessage.match(/my favorite|i like|i prefer|i love/i) && 
                        lowerMessage.match(/color|food|movie|book|music|song/i)) {
                intent = 'memory_store';
                memoryCategory = 'preferences';
                confidence = 0.8;
              } else if(lowerMessage.match(/what.*my name|who am i/i)) {
                intent = 'memory_retrieve';
                memoryCategory = 'personal_info';
                confidence = 0.8;
              } else if(lowerMessage.match(/what.*favorite|what.*like|what.*prefer/i)) {
                intent = 'memory_retrieve';
                memoryCategory = 'preferences';
                confidence = 0.8;
              } else if(lowerMessage.match(/appointment|schedule|meeting|calendar|flight|plane|travel|trip|airport/i) ||
                        lowerMessage.match(/what time|when is|tomorrow/i)) {
                intent = 'external_data_required';
                memoryCategory = lowerMessage.match(/flight|plane|airport|travel|trip/i) ? 'travel' : 'calendar';
                confidence = 0.8;
              }
              
              return {
                success: true,
                intent,
                memoryCategory,
                confidence,
                entities: [],
                requiresExternalData: intent === 'external_data_required'
              };
            };
            
            // If no LLM client or LLM fails, use fallback detection
            if (!llmClient) {
              console.log('LLM client not available for intent detection, using fallback');
              result = detectIntent(message);
            } else {
              try {
                // Use LLM for intent detection with simplified prompt
                const prompt = `Classify this message: "${message}"

Return ONLY a JSON object with these fields:
- intent: "question", "command", "memory_store", "memory_retrieve", or "external_data_required"
- category: "personal_info", "preferences", "calendar", "travel", "work", "health", or "general"
- confidence: number between 0-1
- requiresExternalData: true or false`;
                
                // Set strict parameters to ensure we get complete JSON
                const maxTokens = message.length < 20 ? 300 : 500; // Adjust based on input length
                
                console.log('🔍 Sending intent detection prompt to LLM...');
                const llmResult = await llmClient.complete({
                  prompt,
                  max_tokens: maxTokens,
                  temperature: 0.1,
                  stop: ["\n\n", "```"] // Stop on double newline or code block markers
                });
                
                // Log the raw LLM response for debugging
                console.log('📝 Raw LLM response:', JSON.stringify(llmResult.text));
                
                // Check if we got a valid response
                if (!llmResult.text || llmResult.text.trim() === '' || llmResult.text.includes('No response generated')) {
                  console.warn('⚠️ Empty or "No response generated" received, using fallback detection');
                  result = detectIntent(message);
                } else {
                  try {
                    // Preprocess the text to handle markdown-formatted JSON
                    let textToParse = llmResult.text.trim();
                    
                    // Remove markdown code block formatting if present
                    if (textToParse.includes('```')) {
                      // Extract content between markdown code blocks
                      const match = textToParse.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
                      if (match && match[1]) {
                        textToParse = match[1].trim();
                        console.log('🔍 Extracted JSON from code block');
                      } else {
                        // If we can't extract between blocks, just remove the backticks
                        textToParse = textToParse.replace(/```(?:json)?|```/g, '').trim();
                        console.log('🔍 Removed code block markers');
                      }
                    }
                    
                    // Check if we have a valid JSON string after preprocessing
                    if (!textToParse || textToParse.trim() === '') {
                      console.warn('⚠️ Empty text after preprocessing, using fallback detection');
                      result = detectIntent(message);
                    } else {
                      console.log('🔍 Preprocessed JSON text:', JSON.stringify(textToParse));
                      
                      // Handle truncated or malformed JSON
                      try {
                        // Try to extract just the intent and category information using regex
                        // This is more robust than trying to parse the entire JSON
                        const intentMatch = textToParse.match(/"intent"\s*:\s*"([^"]+)"/i);
                        const categoryMatch = textToParse.match(/"(?:memoryCategory|category)"\s*:\s*"([^"]+)"/i);
                        const confidenceMatch = textToParse.match(/"confidence"\s*:\s*([0-9.]+)/i);
                        const externalDataMatch = textToParse.match(/"requiresExternalData"\s*:\s*(true|false)/i);
                        
                        if (intentMatch) {
                          console.log('🔧 Extracted intent using regex:', intentMatch[1]);
                          
                          // Build a result object from the extracted data
                          const intent = intentMatch[1];
                          const memoryCategory = categoryMatch ? categoryMatch[1] : null;
                          const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;
                          const requiresExternalData = externalDataMatch 
                            ? externalDataMatch[1] === 'true' 
                            : intent === 'external_data_required';
                          
                          // Special handling for calendar/appointment/travel related queries
                          const isCalendarOrTravel = 
                            message.toLowerCase().match(/appointment|schedule|meeting|calendar|flight|plane|travel|trip|airport/i) ||
                            message.toLowerCase().match(/what time|when is|tomorrow/i);
                          
                          // If message mentions calendar/travel but intent doesn't reflect that, override
                          if (isCalendarOrTravel && intent === 'question') {
                            console.log('🔧 Overriding intent to external_data_required based on message content');
                            result = {
                              success: true,
                              intent: 'external_data_required',
                              memoryCategory: message.toLowerCase().match(/flight|plane|airport|travel|trip/i) ? 'travel' : 'calendar',
                              confidence: 0.8,
                              entities: [],
                              requiresExternalData: true
                            };
                          } else {
                            result = {
                              success: true,
                              intent: intent,
                              memoryCategory: memoryCategory,
                              confidence: confidence,
                              entities: [],
                              requiresExternalData: requiresExternalData
                            };
                          }
                          
                          console.log('✅ Extracted intent data:', result);
                        } else {
                          // Fallback to trying to parse the JSON directly
                          try {
                            // Try to add missing braces if needed
                            let jsonToTry = textToParse;
                            if (!jsonToTry.startsWith('{')) {
                              jsonToTry = '{' + jsonToTry;
                              console.log('🔧 Added opening brace');
                            }
                            if (!jsonToTry.endsWith('}')) {
                              jsonToTry = jsonToTry + '}';
                              console.log('🔧 Added closing brace');
                            }
                            
                            // Try to fix common JSON errors
                            // Replace any trailing commas before closing brackets
                            jsonToTry = jsonToTry.replace(/,\s*([\}\]])/g, '$1');
                            // Fix any unquoted property names
                            jsonToTry = jsonToTry.replace(/(\{|,)\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
                            
                            console.log('🔧 Attempting to parse fixed JSON:', jsonToTry);
                            const parsedResult = JSON.parse(jsonToTry);
                            console.log('✅ LLM intent detection result:', parsedResult);
                            
                            // Validate the parsed result has the expected fields
                            if (!parsedResult.intent) {
                              console.warn('⚠️ Parsed JSON missing intent field, using fallback detection');
                              result = detectIntent(message);
                            } else {
                              result = {
                                success: true,
                                intent: parsedResult.intent || 'question',
                                memoryCategory: parsedResult.memoryCategory || parsedResult.category || null,
                                confidence: parsedResult.confidence || 0.7,
                                entities: parsedResult.entities || [],
                                requiresExternalData: parsedResult.requiresExternalData || parsedResult.intent === 'external_data_required' || false
                              };
                            }
                          } catch (jsonError) {
                            console.error('❌ Failed to parse fixed JSON:', jsonError);
                            result = detectIntent(message);
                          }
                        }
                      } catch (regexError) {
                        console.error('❌ Regex extraction failed:', regexError);
                        result = detectIntent(message);
                      }
                    }
                  } catch(parseError) {
                    console.error('❌ Failed to parse LLM intent detection result:', parseError);
                    console.log('❓ Attempted to parse:', JSON.stringify(llmResult.text));
                    result = detectIntent(message);
                  }
                }
              } catch(error) {
                console.error('Error in LLM intent detection:', error);
                result = detectIntent(message);
              }
            }
            
            console.log(`✅ Trusted agent ${agentName} executed successfully (hardcoded implementation)`);
          } else {
            // For other trusted agents, use Function constructor
            const moduleExports = {};
            const agentFunction = new Function('module', 'exports', 'params', 'context', agent.code);
            agentFunction(moduleExports, moduleExports, params, agentContext);
            result = await moduleExports.execute(params, agentContext);
            console.log(`✅ Trusted agent ${agentName} executed successfully (direct execution)`);
          }
        } catch (directError) {
          console.error(`❌ Direct execution failed for ${agentName}, falling back to sandbox:`, directError.message);
          // Fall back to sandbox if direct execution fails
          result = await this.agentSandbox.executeAgent(agent.code, agentName, params, agentContext);
        }
      } else {
        // Use sandbox for untrusted agents
        result = await this.agentSandbox.executeAgent(agent.code, agentName, params, agentContext);
      }

      if (!result || !result.success) {
        const errorMsg = result ? result.error : 'Unknown execution error';
        console.error(`❌ Execution failed for ${agentName}:`, errorMsg);
        return {
          success: false,
          error: `Execution failed: ${errorMsg}`,
          errorType: result?.errorType || 'EXECUTION_ERROR',
          agentName
        };
      }

      if (bypassSandbox) {
        console.log(`✅ Trusted agent ${agentName} completed successfully`);
      } else {
        console.log(`✅ Agent ${agentName} executed successfully in secure sandbox`);
      }

      if (agentName === 'UserMemoryAgent' && result.action) {
        console.log(`🔄 Processing ${result.action} intent from UserMemoryAgent`);
        switch (result.action) {
          case 'store_memory':
            return await this.handleMemoryStore(result.key, result.value);
          case 'retrieve_memory':
            return await this.handleMemoryRetrieve(result.key);
          case 'search_memory':
            return await this.handleMemorySearch(result.query);
          default:
            console.warn(`⚠️ Unknown memory action: ${result.action}`);
        }
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to execute agent ${agentName}:`, error.message);
      return {
        success: false,
        error: error.message,
        agentName
      };
    }
  }

  /**
   * Get communication logs from DuckDB
   */
  async getCommunications(options = {}) {
    if (!this.dbConnection) {
      console.warn('⚠️ Database connection not available for retrieving communications');
      return [];
    }

    try {
      const {
        limit = 50,
        offset = 0,
        fromAgent = null,
        toAgent = null,
        messageType = null,
        sessionId = null,
        success = null
      } = options;

      let whereClause = '';
      const params = [];
      const conditions = [];

      if (fromAgent) {
        conditions.push('from_agent = ?');
        params.push(fromAgent);
      }
      if (toAgent) {
        conditions.push('to_agent = ?');
        params.push(toAgent);
      }
      if (messageType) {
        conditions.push('message_type = ?');
        params.push(messageType);
      }
      if (sessionId) {
        conditions.push('execution_id = ?');
        params.push(sessionId);
      }
      if (success !== null) {
        conditions.push('success = ?');
        params.push(success);
      }

      if (conditions.length > 0) {
        whereClause = 'WHERE ' + conditions.join(' AND ');
      }

      const query = `
        SELECT * FROM agent_communications
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      params.push(limit, offset);

      return new Promise((resolve, reject) => {
        this.dbConnection.all(query, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const communications = rows.map((row) => ({
              ...row,
              content: JSON.parse(row.content || '{}'),
              context: JSON.parse(row.context || '{}')
            }));
            resolve(communications);
          }
        });
      });
    } catch (error) {
      console.error('❌ Failed to retrieve communications:', error.message);
      return [];
    }
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `session_${timestamp}_${random}`;
  }

  /**
   * Determine if we should start a new conversation session
   */
  shouldStartNewSession() {
    if (!this.sessionStartTime) return true;
    const sessionTimeout = 30 * 60 * 1000; // 30 minutes
    const timeSinceStart = Date.now() - this.sessionStartTime;
    return timeSinceStart > sessionTimeout;
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
    try {
      return crypto
        .createHash('sha256')
        .update(`${os.hostname()}-${os.platform()}-${os.arch()}`)
        .digest('hex')
        .substring(0, 16);
    } catch (error) {
      console.warn('⚠️ Failed to generate device ID, using fallback');
      return 'fallback-device-id';
    }
  }

  /**
   * Retry mechanism for critical operations
   */
  async retryOperation(operation, maxRetries = 3, delay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Operation failed (attempt ${attempt}/${maxRetries}):`, error.message);

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * Handle memory store operation (block/Drop pattern)
   */
  async handleMemoryStore(key, value) {
    try {
      console.log(`💾 Storing memory: key='${key}'`);

      if (!key || typeof key !== 'string') {
        return { success: false, error: 'Invalid memory key' };
      }

      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const timestamp = new Date().toISOString();

      return new Promise((resolve, reject) => {
        const stmt = this.dbConnection.prepare(
          'INSERT OR REPLACE INTO user_memories (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)'
        );

        stmt.run(key, valueStr, timestamp, timestamp, (err) => {
          if (err) {
            console.error('❌ Memory storage failed:', err);
            resolve({ success: false, error: `Memory storage failed: ${err.message}` });
          } else {
            console.log('✅ Memory stored successfully');
            resolve({ success: true, key, timestamp });
          }
        });
      });
    } catch (error) {
      console.error('❌ Memory store error:', error);
      return { success: false, error: `Memory store error: ${error.message}` };
    }
  }

  /**
   * Handle memory retrieve operation (block/Drop pattern)
   */
  async handleMemoryRetrieve(key) {
    try {
      console.log(`🔍 Retrieving memory: key='${key || '*'}'`);

      return new Promise((resolve, reject) => {
        let query;
        let params = [];

        if (key && key !== '*') {
          query = 'SELECT key, value, created_at, updated_at FROM user_memories WHERE key = ?';
          params = [key];
        } else {
          query = 'SELECT key, value, created_at, updated_at FROM user_memories';
        }

        // Only pass params if we have any to avoid parameter count mismatch
        const executeQuery = params.length > 0
          ? (callback) => this.dbConnection.all(query, params, callback)
          : (callback) => this.dbConnection.all(query, callback);

        executeQuery((err, rows) => {
          if (err) {
            console.error('❌ Memory retrieval failed:', err);
            resolve({ success: false, error: `Memory retrieval failed: ${err.message}` });
            return;
          }

          const results = [];
          if (rows && rows.length > 0) {
            rows.forEach((row) => {
              try {
                const parsedValue = JSON.parse(row.value);
                results.push({
                  key: row.key,
                  value: parsedValue,
                  created_at: row.created_at,
                  updated_at: row.updated_at
                });
              } catch (parseError) {
                results.push({
                  key: row.key,
                  value: row.value,
                  created_at: row.created_at,
                  updated_at: row.updated_at
                });
              }
            });
          }

          console.log(`✅ Retrieved ${results.length} memories`);
          resolve({ success: true, results });
        });
      });
    } catch (error) {
      console.error('❌ Memory retrieve error:', error);
      return { success: false, error: `Memory retrieve error: ${error.message}` };
    }
  }

  /**
   * Handle memory search operation (block/Drop pattern)
   */
  async handleMemorySearch(query) {
    try {
      console.log(`🔍 Searching memories for: '${query}'`);

      if (!query || typeof query !== 'string') {
        return { success: false, error: 'Invalid search query' };
      }

      return new Promise((resolve, reject) => {
        const searchTerm = `%${query}%`;

        this.dbConnection.all(
          "SELECT key, value FROM user_memories WHERE key LIKE ? OR value LIKE ?",
          [searchTerm, searchTerm],
          (err, rows) => {
            if (err) {
              console.error('❌ Memory search failed:', err);
              resolve({ success: false, error: `Memory search failed: ${err.message}` });
              return;
            }

            const results = [];
            if (rows && rows.length > 0) {
              rows.forEach((row) => {
                try {
                  results.push({
                    key: row.key,
                    value: JSON.parse(row.value)
                  });
                } catch (parseError) {
                  results.push({
                    key: row.key,
                    value: row.value
                  });
                }
              });
            }

            console.log(`✅ Found ${results.length} matching memories`);
            resolve({ success: true, results });
          }
        );
      });
    } catch (error) {
      console.error('❌ Memory search error:', error);
      return { success: false, error: `Memory search error: ${error.message}` };
    }
  }

  /**
   * Get all user memories from DuckDB for debugging
   */
  async getAllUserMemories() {
    try {
      console.log('🔍 Retrieving all user memories for debugging');

      return new Promise((resolve, reject) => {
        this.dbConnection.all('SELECT * FROM user_memories ORDER BY updated_at DESC', (err, rows) => {
          if (err) {
            console.error('❌ Failed to retrieve user memories:', err);
            reject(err);
            return;
          }

          console.log(`📊 Raw database rows retrieved: ${rows.length}`);
          if (rows.length > 0) {
            console.log('📋 Sample row structure:', JSON.stringify(rows[0], null, 2));
          }

          const memories = rows.map((row) => {
            try {
              // Try to parse JSON values
              return {
                key: row.key,
                value: JSON.parse(row.value),
                created_at: row.created_at,
                updated_at: row.updated_at
              };
            } catch (parseError) {
              // If not JSON, use as string
              return {
                key: row.key,
                value: row.value,
                created_at: row.created_at,
                updated_at: row.updated_at
              };
            }
          });

          console.log(`✅ Retrieved ${memories.length} user memories`);
          resolve(memories);
        });
      });
    } catch (error) {
      console.error('❌ Failed to retrieve user memories:', error);
      return [];
    }
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

export default LocalLLMAgent;