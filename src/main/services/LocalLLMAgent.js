/**
 * LocalLLMAgent - Central orchestration brain for ThinkDrop AI's agent ecosystem
 * Provides local-first agent orchestration with optional cloud sync
 */
import { EventEmitter } from "events";
import { ipcMain } from "electron";
import duckdb from "duckdb";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import http from "http";
import os from "os";
import { AgentSandbox } from "./AgentSandbox.js";
import ExecuteAgent from "./executeAgent.js";
import { pipeline } from "@xenova/transformers";
import OrchestrationService from "./OrchestrationService.js";
import DefaultAgents from "./defaultAgents.js";



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

    // Embedding model for semantic search
    this.embeddingModel = null;
    this.isEmbeddingModelReady = false;
    this.embeddingCache = new Map(); // Cache embeddings to avoid recomputation

    // Secure agent sandbox using Node.js vm
    this.agentSandbox = new AgentSandbox({
      memoryLimit: 128, // 128MB memory monitoring
      timeoutMs: 30000, // 30 second timeout
      allowedCapabilities: [
        "console.log",
        "JSON.parse",
        "JSON.stringify",
        "Date.now",
        "Math.*",
      ],
    });

    // Backend orchestration service for complex workflows
    this.orchestrationService = new OrchestrationService(
      process.env.BIBSCRIP_API_KEY,
      process.env.BIBSCRIP_BASE_URL
    );

    // Initialize DefaultAgents 
    this.defaultAgents = new DefaultAgents();

    // Initialize ExecuteAgent
    this.executeAgentInstance = new ExecuteAgent();

    // Configuration
    this.config = {
      databasePath: path.join(
        os.homedir(),
        ".thinkdrop",
        "agent_communications.duckdb",
      ),
      ollamaUrl: "http://127.0.0.1:11434", // Use IPv4 explicitly to avoid IPv6 connection issues
      preferredModels: ["phi3:mini", "llama3.2:1b", "tinyllama"],
      maxRetries: 3,
      retryDelay: 1000,
      fallbackModels: ["llama3.2:1b", "tinyllama"], // Fallback options if phi3:mini unavailable
      cacheExpiry: 5 * 60 * 1000, // 5 minutes
      maxCacheSize: 100,
      requestTimeout: 60000, // 60 seconds
      // Embedding model configuration for semantic search
      embeddingModel: "Xenova/all-MiniLM-L6-v2", // Lightweight, fast embedding model
      embeddingDimensions: 384, // Dimensions for all-MiniLM-L6-v2
      semanticThreshold: 0.7, // Minimum cosine similarity for semantic matches
      maxEmbeddingCacheSize: 1000, // Cache up to 1000 embeddings
    };

  }

  /**
   * Initialize LocalLLMAgent service
   */
  async initialize() {
    try {
      console.log("🤖 Initializing LocalLLMAgent...");

      // 1. Setup local database
      await this.initializeDatabase();

      // 2. Initialize local LLM connection
      await this.initializeLocalLLM();

      // 3. Initialize embedding model for semantic search
      await this.initializeEmbeddingModel();

      // 4. Load default agents
      await this.defaultAgents.loadDefaultAgents(this.database, this.agentCache);

      // 4. Setup health monitoring
      this.setupHealthMonitoring();

      this.isInitialized = true;
      console.log("✅ LocalLLMAgent initialized successfully");

      this.emit("initialized", {
        localLLMAvailable: this.localLLMAvailable,
        currentModel: this.currentLocalModel,
        agentCount: this.agentCache.size,
      });

      return true;
    } catch (error) {
      console.error("❌ Failed to initialize LocalLLMAgent:", error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Initialize DuckDB database with required schema
   */
  async initializeDatabase() {
    console.log("📊 Setting up local DuckDB database...");

    // Ensure data directory exists
    const dataDir = path.dirname(this.config.databasePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.database = new duckdb.Database(this.config.databasePath, (err) => {
        if (err) {
          console.error("❌ Failed to initialize DuckDB:", err);
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
          console.error("❌ Failed to create DuckDB tables:", err);
          reject(err);
          return;
        }
        console.log("✅ DuckDB database initialized successfully");
        resolve();
      });
    });
  }

  /**
   * Initialize local LLM connection (Ollama)
   */
  async initializeLocalLLM() {
    console.log("🧠 Initializing Local LLM connection...");

    try {
      const isOllamaRunning = await this.checkOllamaStatus();

      if (!isOllamaRunning) {
        console.log(
          "⚠️ Ollama not running. LocalLLM features will be limited.",
        );
        this.localLLMAvailable = false;
        return false;
      }

      const testResult = await this.retryOperation(
        () => this.testLocalLLMCapabilities(),
        2, // Max 2 retries for initialization
        2000, // 2 second delay between retries
      ).catch((error) => {
        console.warn(
          "⚠️ LLM initialization failed after retries:",
          error.message,
        );
        return { success: false, error: error.message };
      });

      if (testResult.success) {
        this.localLLMAvailable = true;
        this.currentLocalModel = testResult.model;
        console.log(`✅ Local LLM initialized: ${testResult.model}`);

        // Warm up the model with a simple query to improve subsequent response times
        await this.queryLocalLLM("Hi", {
          temperature: 0.1,
          maxTokens: 3,
          timeout: 10000,
        }).catch((error) => {
          console.warn(
            "⚠️ Model warm-up failed (non-critical):",
            error.message,
          );
        });

        return true;
      }

      console.error(`❌ Local LLM initialization failed: ${testResult.error}`);
      this.localLLMAvailable = false;
      return false;
    } catch (error) {
      console.error("❌ Local LLM initialization failed:", error.message);
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
          path: "/api/tags",
          method: "GET",
          timeout: 5000,
        },
        (res) => {
          console.log(`🔍 Ollama status check: ${res.statusCode}`);
          resolve(res.statusCode === 200);
        },
      );

      req.on("error", (error) => {
        console.log(`🔍 Ollama status check failed: ${error.message}`);
        resolve(false);
      });

      req.on("timeout", () => {
        console.log("🔍 Ollama status check timed out");
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
          path: "/api/tags",
          method: "GET",
          timeout: 5000,
        },
        (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (error) {
              reject(new Error("Failed to parse models response"));
            }
          });
        },
      );

      req.on("error", (error) => {
        reject(error);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
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
        return { success: false, error: "No models available" };
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

      const testPrompt =
        'Respond with "OK" if you can understand this message.';
      console.log(`🧪 Testing model ${testModel} with prompt: "${testPrompt}"`);

      let testResponse;
      try {
        // Increase timeout for phi3:mini as it may need time to load initially
        const timeout = testModel.includes("phi3") ? 45000 : 15000;
        console.log(
          `⏱️ Using ${timeout / 1000}s timeout for model ${testModel}`,
        );

        testResponse = await this.queryLocalLLM(testPrompt, {
          model: testModel,
          temperature: 0.1,
          maxTokens: 10, // Increased for better response
          timeout: timeout,
          bypassAvailabilityCheck: true,
        });
      } catch (error) {
        console.warn(`⚠️ Model ${testModel} failed, trying fallback models...`);

        for (const fallbackModel of ["tinyllama", "llama3.2:1b"]) {
          if (modelNames.includes(fallbackModel)) {
            console.log(`🔄 Trying fallback model: ${fallbackModel}`);
            try {
              testResponse = await this.queryLocalLLM(testPrompt, {
                model: fallbackModel,
                temperature: 0.1,
                maxTokens: 5,
                timeout: 8000,
                bypassAvailabilityCheck: true,
              });
              testModel = fallbackModel;
              break;
            } catch (fallbackError) {
              console.warn(
                `⚠️ Fallback model ${fallbackModel} also failed:`,
                fallbackError.message,
              );
              continue;
            }
          }
        }

        if (!testResponse) {
          throw error;
        }
      }

      console.log(`🧪 Model test response: "${testResponse}"`);

      if (testResponse && testResponse.toLowerCase().includes("ok")) {
        console.log(`✅ Model test passed for ${testModel}`);
        return {
          success: true,
          model: testModel,
          totalModels: models.length,
        };
      }

      console.log(
        `❌ Model test failed for ${testModel} - response did not contain 'ok'`,
      );
      return { success: false, error: "Model test failed" };
    } catch (error) {
      console.error(`🚨 Model test exception for ${testModel}:`, error.message);
      console.error("🚨 Full error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Query local LLM (Ollama)
   */
  async queryLocalLLM(prompt, options = {}) {
    if (!this.localLLMAvailable && !options.bypassAvailabilityCheck) {
      throw new Error("Local LLM not available");
    }

    const systemContext = `You are Thinkdrop AI, a fast desktop assistant. Be concise and helpful.`;

    const recentMessages = await this.getRecentConversation(
      options.sessionId,
      3,
    );
    let conversationContext = "";
    if (recentMessages.length > 0) {
      conversationContext =
        "\nRecent conversation:\n" +
        recentMessages
          .map(
            (msg) =>
              `${
                msg.from_agent === "user" ? "User" : "AI"
              }: ${JSON.parse(msg.content).userInput || JSON.parse(msg.content).response || ""}`,
          )
          .join("\n") +
        "\n";
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
        stop: options.stopTokens || ["\n\n", "User:", "Human:"],
      },
    };

    return new Promise((resolve, reject) => {
      const url = new URL(`${this.config.ollamaUrl}/api/generate`);
      const postData = JSON.stringify(requestBody);
      const timeoutMs = options.timeout || 30000; // Increased to 30s for local LLMs

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 11434,
          path: "/api/generate",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            try {
              if (res.statusCode !== 200) {
                reject(
                  new Error(`LLM request failed: ${res.statusCode} - ${data}`),
                );
                return;
              }

              const lines = data.trim().split("\n");
              let fullResponse = "";

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

              resolve(fullResponse || "No response generated");
            } catch (error) {
              console.error("❌ Local LLM parse error:", error.message);
              reject(error);
            }
          });
        },
      );

      req.on("error", (error) => {
        console.error("❌ Local LLM connection error:", error.message);
        if (
          error.code === "ECONNRESET" ||
          error.message.includes("socket hang up")
        ) {
          reject(
            new Error("Connection lost - please check if Ollama is running"),
          );
        } else {
          reject(new Error(`Connection failed: ${error.message}`));
        }
      });

      req.on("timeout", () => {
        console.warn("⚠️ Local LLM request timeout");
        req.destroy();
        reject(new Error("Request timeout - LLM took too long to respond"));
      });

      const timeoutHandle = setTimeout(() => {
        req.destroy();
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      req.on("close", () => {
        clearTimeout(timeoutHandle);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Initialize embedding model for semantic search
   */
  async initializeEmbeddingModel() {
    try {
      console.log("🧠 Initializing embedding model for semantic search...");

      // Initialize the embedding pipeline with all-MiniLM-L6-v2
      this.embeddingModel = await pipeline(
        "feature-extraction",
        this.config.embeddingModel,
        {
          quantized: true, // Use quantized model for better performance
          progress_callback: (progress) => {
            if (progress.status === "downloading") {
              console.log(
                `📥 Downloading embedding model: ${Math.round(progress.progress * 100)}%`,
              );
            }
          },
        },
      );

      this.isEmbeddingModelReady = true;
      console.log(
        `✅ Embedding model initialized: ${this.config.embeddingModel}`,
      );

      // Test the embedding model with a simple query
      const testEmbedding = await this.generateEmbedding("test query");
      if (
        testEmbedding &&
        testEmbedding.length === this.config.embeddingDimensions
      ) {
        console.log(
          `🧪 Embedding model test passed (${testEmbedding.length} dimensions)`,
        );
      } else {
        console.warn("⚠️ Embedding model test failed - unexpected dimensions");
      }

      return true;
    } catch (error) {
      console.error("❌ Failed to initialize embedding model:", error);
      this.isEmbeddingModelReady = false;
      return false;
    }
  }

  /**
   * Generate embedding for a given text
   * @param {string} text - Text to generate embedding for
   * @returns {Promise<Array>} - Embedding vector
   */
  async generateEmbedding(text) {
    try {
      if (!this.isEmbeddingModelReady) {
        console.warn(
          "⚠️ Embedding model not ready, falling back to lexical search",
        );
        return null;
      }

      // Check cache first
      const cacheKey = text.toLowerCase().trim();
      if (this.embeddingCache.has(cacheKey)) {
        return this.embeddingCache.get(cacheKey);
      }

      // Generate embedding
      const output = await this.embeddingModel(text, {
        pooling: "mean",
        normalize: true,
      });
      const embedding = Array.from(output.data);

      // Cache the embedding (with size limit)
      if (this.embeddingCache.size >= this.config.maxEmbeddingCacheSize) {
        // Remove oldest entry
        const firstKey = this.embeddingCache.keys().next().value;
        this.embeddingCache.delete(firstKey);
      }
      this.embeddingCache.set(cacheKey, embedding);

      return embedding;
    } catch (error) {
      console.error("❌ Failed to generate embedding:", error);
      return null;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   * @param {Array} embedding1 - First embedding vector
   * @param {Array} embedding2 - Second embedding vector
   * @returns {number} - Cosine similarity score (0-1)
   */
  calculateCosineSimilarity(embedding1, embedding2) {
    if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Load default agents into cache
   */
  async loadDefaultAgents() {
    return await loadDefaultAgents(this.database, this.agentCache);
  }

  /**
   * Setup health monitoring
   */
  setupHealthMonitoring() {
    setInterval(async () => {
      try {
        const health = await this.getHealthStatus();
        this.emit("health-update", health);
      } catch (error) {
        console.error("❌ Health check failed:", error.message);
      }
    }, 30000);
  }

  /**
   * Register IPC handlers for LocalLLMAgent
   */
  registerIpcHandlers() {
    console.log("📡 Registering LocalLLMAgent IPC handlers...");

    ipcMain.handle("local-llm:health", async () => {
      return await this.getHealthStatus();
    });

    ipcMain.handle("local-llm:process-message", async (event, message) => {
      return await this.processMessage(message);
    });

    ipcMain.handle(
      "local-llm:get-all-memories",
      async (event, options = {}) => {
        // Use quiet mode for MemoryDebugger polling to reduce log spam
        const quiet = options.quiet || false;
        return await this.getAllUserMemories(quiet);
      },
    );

    console.log("✅ LocalLLMAgent IPC handlers registered successfully");
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
      orchestrationCacheSize: this.orchestrationCache.size,
    };

    try {
      if (this.dbConnection) {
        await new Promise((resolve, reject) => {
          this.dbConnection.run("SELECT 1", [], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        health.errors = ["Database connection not available"];
      }

      if (this.localLLMAvailable) {
        try {
          await this.queryLocalLLM("Health check", {
            maxTokens: 10,
            bypassAvailabilityCheck: false,
          });
        } catch (error) {
          health.localLLMAvailable = false;
          health.errors = health.errors || [];
          health.errors.push(`LLM test failed: ${error.message}`);
        }
      } else {
        health.errors = health.errors || [];
        health.errors.push("Local LLM not available");
      }

      if (!health.errors || health.errors.length === 0) {
        health.status = "healthy";
      } else if (health.initialized && health.databaseConnected) {
        health.status = "degraded";
      } else {
        health.status = "unhealthy";
      }
    } catch (error) {
      health.status = "error";
      health.errors = health.errors || [];
      health.errors.push(`Health check failed: ${error.message}`);
    }

    return health;
  }

  /**
   * Check if input can be handled with semantic search (even without local LLM)
   * @param {string} userInput - User's input message
   * @returns {boolean} - True if can handle with embedding-based search
   */
  canHandleWithSemanticSearch(userInput) {
    if (!this.isEmbeddingModelReady) {
      return false;
    }

    const input = userInput.toLowerCase();

    // Memory-related queries that can be handled with semantic search
    const memoryPatterns = [
      "what's my",
      "what is my",
      "my favorite",
      "favorite color",
      "remember",
      "remind me",
      "did i",
      "when is",
      "appointment",
      "phone number",
      "contact",
      "mother",
      "mom",
      "name",
      "haircut",
      "meeting",
      "schedule",
      "calendar",
    ];

    // Check if input matches memory-related patterns
    const isMemoryQuery = memoryPatterns.some((pattern) =>
      input.includes(pattern),
    );

    if (isMemoryQuery) {
      console.log("🧠 Detected memory query - can handle with semantic search");
      return true;
    }

    // Simple conversational queries that don't need complex processing
    const simplePatterns = [
      "hello",
      "hi",
      "hey",
      "thanks",
      "thank you",
      "ok",
      "okay",
      "yes",
      "no",
      "good",
      "great",
      "nice",
    ];

    const isSimpleQuery = simplePatterns.some((pattern) =>
      input.includes(pattern),
    );

    if (isSimpleQuery) {
      console.log(
        "💬 Detected simple conversational query - can handle locally",
      );
      return true;
    }

    return false;
  }

  /**
   * Analyze input complexity to decide local vs backend
   */
  async analyzeInputComplexity(userInput) {
    const complexity = {
      canHandleLocally: true,
      reasons: [],
      estimatedComplexity: "low",
    };

    const input = userInput.toLowerCase();

    if (input.includes("create agent") || input.includes("generate code")) {
      complexity.canHandleLocally = false;
      complexity.reasons.push("Agent generation requires backend");
      complexity.estimatedComplexity = "high";
    }

    if (input.includes("complex workflow") || input.includes("multi-step")) {
      complexity.canHandleLocally = false;
      complexity.reasons.push(
        "Complex workflows require backend orchestration",
      );
      complexity.estimatedComplexity = "high";
    }

    if (input.includes("analyze") || input.includes("summarize")) {
      complexity.estimatedComplexity = "medium";
    }

    return complexity;
  }

  /**
   * Handle orchestration locally using agent-based architecture
   */
  async handleLocalOrchestration(userInput, context, sessionId) {
    console.log(`🏠 Handling locally with agents: ${sessionId}`);
    // Store startTime as a local variable that's accessible throughout the method
    const methodStartTime = Date.now();
    const getExecutionTime = () => Date.now() - methodStartTime;

    try {
      // Phase 1: Use PlannerAgent to determine if multi-intent orchestration is needed
      console.log("🧠 Analyzing orchestration requirements...");
      const plannerResult = await this.executeAgent(
        "PlannerAgent",
        { message: userInput },
        context,
      );
      console.log("CHRIS THE:", plannerResult);
      if (plannerResult.success && plannerResult.multiIntent) {
        console.log(
          `🎯 Multi-intent workflow detected: ${plannerResult.intents.join(", ")}`,
        );
        console.log(`📋 Orchestration plan: ${plannerResult.totalSteps} steps`);

        console.log(
          "📋 Generated orchestration plan:",
          JSON.stringify(plannerResult.orchestrationPlan, null, 2),
        );

        // Create workflow object for frontend UI
        const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const workflow = {
          id: workflowId,
          name: `Multi-Intent Workflow: ${plannerResult.intents.join(", ")}`,
          description: `Processing ${plannerResult.totalSteps} steps for: ${userInput.substring(0, 50)}...`,
          status: 'running',
          steps: plannerResult.orchestrationPlan.map((step, index) => ({
            id: `step_${index + 1}`,
            name: `${step.agent} - ${step.action}`,
            description: `Execute ${step.agent} with intent: ${step.data.intent}`,
            status: index === 0 ? 'running' : 'pending',
            agent: step.agent,
            startTime: index === 0 ? new Date().toISOString() : undefined,
            endTime: undefined,
            result: undefined,
            error: undefined
          })),
          currentStepIndex: 0,
          startTime: new Date().toISOString(),
          endTime: undefined,
          result: undefined,
          error: undefined,
          metadata: {
            sessionId,
            originalMessage: userInput,
            intents: plannerResult.intents,
            totalSteps: plannerResult.totalSteps
          }
        };

        // Emit workflow started event to frontend
        await this.emitOrchestrationUpdate({
          type: 'workflow_started',
          workflowId: workflowId,
          workflow: workflow,
          timestamp: new Date().toISOString()
        });

        // Delegate complex orchestration to backend API
        console.log("🚀 Delegating to backend orchestration service...");

        // Emit workflow_started event to show Live Insights panel
        await this.emitOrchestrationUpdate({
          type: 'workflow_started',
          workflowId: workflowId,
          workflow: {
            id: workflowId,
            status: 'running',
            steps: [{ id: 'backend-orchestration', agent: 'BackendOrchestrationAgent', action: 'Processing request...', status: 'running' }],
            startTime: new Date().toISOString()
          },
          result: {
            plan_summary: 'Processing backend orchestration request...',
            task_breakdown: [{ agent: 'BackendOrchestrationAgent', description: 'Processing request...', status: 'running' }],
            agents: [{ name: 'BackendOrchestrationAgent', description: 'Processing your request via backend orchestration', capabilities: ['orchestration', 'planning'] }]
          },
          timestamp: new Date().toISOString()
        });

        try {
          const orchestrationResult = await this.orchestrationService.orchestrate(
            userInput,
            {
              requirements: plannerResult.requirements || [],
              availableServices: plannerResult.availableServices || [],
              enrichWithUserContext: true,
              userId: context.userId || sessionId,
            }
          );

          if (orchestrationResult.success) {
            console.log("✅ Backend orchestration successful");

            const response = {
              success: true,
              message: this.formatOrchestrationResponse(orchestrationResult.data),
              orchestrationData: orchestrationResult.data,
              executionTime: getExecutionTime(),
              sessionId,
              source: "backend_orchestration",
            };

            await this.logCommunication({
              from_agent: "LocalLLMAgent",
              to_agent: "BackendOrchestrationAgent",
              message_type: "orchestration_success",
              content: {
                userInput,
                response: response.message,
                agentCount: orchestrationResult.data.agents?.length || 0,
                workflowSteps: orchestrationResult.data.workflow?.steps?.length || 0,
              },
              context,
              success: true,
              execution_time_ms: response.executionTime,
              session_id: sessionId,
            });

            // Emit workflow completion event
            await this.emitOrchestrationUpdate({
              type: 'workflow_completed',
              workflowId: workflowId,
              status: 'success',
              result: orchestrationResult.data,
              executionTime: response.executionTime,
              timestamp: new Date().toISOString()
            });

            return response;
          } else if (orchestrationResult.needsClarification) {
            console.log("❓ Backend orchestration needs clarification");

            const response = {
              success: true,
              message: this.formatClarificationResponse(orchestrationResult.questions),
              needsClarification: true,
              clarificationId: orchestrationResult.clarificationId,
              questions: orchestrationResult.questions,
              executionTime: getExecutionTime(),
              sessionId,
              source: "backend_orchestration",
            };

            // Emit clarification needed event
            await this.emitOrchestrationUpdate({
              type: 'clarification_needed',
              workflowId: workflowId,
              clarificationId: orchestrationResult.clarificationId,
              questions: orchestrationResult.questions,
              timestamp: new Date().toISOString()
            });

            return response;
          } else {
            throw new Error(orchestrationResult.error || "Backend orchestration failed");
          }
        } catch (orchestrationError) {
          console.error("❌ Backend orchestration failed:", orchestrationError.message);

          // Emit workflow failure event
          await this.emitOrchestrationUpdate({
            type: 'workflow_failed',
            workflowId: workflowId,
            error: orchestrationError.message,
            fallbackIntent: plannerResult.intents[0] || "question",
            timestamp: new Date().toISOString()
          });

          // Fall back to single-intent processing on orchestration failure
          const primaryIntent = plannerResult.intents[0] || "question";
          console.log(
            `🔄 Falling back to single-intent processing: ${primaryIntent}`,
          );

          var intentResult = {
            success: true,
            intent: primaryIntent,
            confidence: 0.8,
            multiIntentPlan: plannerResult,
            orchestrationError: orchestrationError.message,
            fallback: true,
          };
        }
      } else {
        console.log("🎯 Single-intent detected, using IntentParserAgent...");
        var intentResult = await this.executeAgent(
          "IntentParserAgent",
          { message: userInput },
          context,
        );
      }
      const intent = intentResult.success ? intentResult.intent : "question";
      const memoryCategory = intentResult.memoryCategory || null;
      const requiresExternalData = intentResult.requiresExternalData || false;

      console.log(
        `🎯 Detected intent: ${intent}, category: ${memoryCategory || "general"}, requires external data: ${requiresExternalData}`,
      );

      // Handle requests that require external data (prevent hallucinations)
      if (requiresExternalData) {
        console.log(
          "🌐 Request requires external data, providing appropriate response",
        );

        // Generate context-aware response based on the type of external data needed
        let contextualMessage;
        const lowerInput = userInput.toLowerCase();

        if (
          lowerInput.includes("calendar") ||
          lowerInput.includes("schedule") ||
          lowerInput.includes("appointment")
        ) {
          contextualMessage =
            "I'd be happy to help with calendar management! However, I don't currently have access to your calendar data. To assist with scheduling, I would need integration with your calendar service (Google Calendar, Outlook, etc.). For now, I can help you plan or discuss your scheduling needs.";
        } else if (
          lowerInput.includes("flight") ||
          lowerInput.includes("travel") ||
          lowerInput.includes("trip")
        ) {
          contextualMessage =
            "I'd love to help with your travel planning! However, I don't have access to real-time flight information or booking systems. I can help you think through travel plans, but for actual flight details or bookings, you'd need to check with airline websites or travel booking services.";
        } else if (
          lowerInput.includes("email") ||
          lowerInput.includes("message")
        ) {
          contextualMessage =
            "I can help you draft messages or emails! However, I don't have access to send emails or messages directly. I can help you compose what you'd like to say, and then you can copy and send it through your preferred email or messaging service.";
        } else {
          contextualMessage =
            "I'd be happy to help! However, this request might require access to external data or services that I don't currently have. I can still assist with planning, brainstorming, or providing general guidance on this topic.";
        }

        const response = {
          success: true,
          message: contextualMessage,
          executionTime: getExecutionTime(),
          sessionId,
        };

        await this.logCommunication({
          from_agent: "LocalLLMAgent",
          to_agent: "user",
          message_type: "external_data_required",
          content: { userInput, response: response.message },
          context,
          success: true,
          execution_time_ms: response.executionTime,
          session_id: sessionId,
        });

        return response;
      }

      let userMemories = {};

      // Handle command intent
      if (intent === "command") {
        console.log("🔧 Processing command intent...");

        // Generate appropriate response for command intent
        let commandResponse;
        const lowerInput = userInput.toLowerCase();

        if (
          lowerInput.includes("text") ||
          lowerInput.includes("message") ||
          lowerInput.includes("send")
        ) {
          commandResponse =
            "I've noted your message request. While I can't actually send messages, I can help you draft content or remember important details.";
        } else if (
          lowerInput.includes("call") ||
          lowerInput.includes("phone")
        ) {
          commandResponse =
            "I've noted your call request. While I can't make actual phone calls, I can help you prepare what you might want to say or remember important details.";
        } else {
          commandResponse =
            "I understand you want me to perform an action. While I can't directly perform external actions, I can help you plan or remember the details.";
        }

        const response = {
          success: true,
          message: commandResponse,
          source: "command_intent_response",
          model: this.currentLocalModel,
          executionTime: getExecutionTime(),
          sessionId,
          agentsUsed: ["IntentParserAgent"],
          intent,
        };

        await this.logCommunication({
          from_agent: "LocalLLMAgent",
          to_agent: "user",
          message_type: "command_intent_response",
          content: { userInput, response: response.message },
          context,
          success: true,
          execution_time_ms: response.executionTime,
          session_id: sessionId,
        });

        return response;
      } else if (intent === "question") {
        console.log("❓ Processing question intent...");

        // Get recent messages for conversation context
        const recentMessages = await this.getRecentMessages(sessionId, 5);

        // Retrieve user memories to enrich the response
        console.log("🧠 Retrieving user memories for question context...");
        const userMemoryResult = await this.executeAgent(
          "UserMemoryAgent",
          {
            action: "retrieve",
            key: "*",
          },
          context,
        );

        if (userMemoryResult.success) {
          userMemories = userMemoryResult.memories || {};
          console.log(
            `✅ Retrieved ${Object.keys(userMemories).length} memories for question context`,
          );
        }

        // Check if this is a memory-related question
        const lowerInput = userInput.toLowerCase();
        const isMemoryQuestion =
          lowerInput.includes("remember") ||
          lowerInput.includes("what") ||
          lowerInput.includes("when") ||
          lowerInput.includes("where") ||
          lowerInput.includes("who") ||
          lowerInput.includes("how") ||
          lowerInput.includes("my");

        // Enrich the prompt with user context
        console.log("✨ Enriching question prompt with user context...");
        const enrichmentResult = await this.executeAgent(
          "MemoryEnrichmentAgent",
          {
            prompt: userInput,
            userMemories,
            recentMessages,
          },
          context,
        );

        const enrichedPrompt = enrichmentResult.success
          ? enrichmentResult.enrichedPrompt
          : userInput;

        // Generate response using local LLM
        console.log("🧠 Generating response with local LLM...");
        const llmResponse = await this.queryLocalLLM(enrichedPrompt, {
          max_tokens: 300,
          temperature: 0.7,
        });

        const response = {
          success: true,
          message:
            llmResponse ||
            "I'm not sure how to answer that question. Could you rephrase it?",
          source: "question_response",
          model: this.currentLocalModel,
          executionTime: getExecutionTime(),
          sessionId,
          agentsUsed: ["IntentParserAgent", "MemoryEnrichmentAgent"],
          intent,
          memoriesUsed: Object.keys(userMemories),
        };

        await this.logCommunication({
          from_agent: "LocalLLMAgent",
          to_agent: "user",
          message_type: "question_response",
          content: { userInput, response: response.message },
          context,
          success: true,
          execution_time_ms: response.executionTime,
          session_id: sessionId,
        });

        return response;
      } else if (intent === "memory_store") {
        console.log(
          "💾 Processing memory storage request with LLM extraction...",
        );

        // First check if this is a deletion command
        const lowerInput = userInput.toLowerCase();
        const isDeletionCommand = lowerInput.match(/remove|delete|clear|forget|erase/i);
        
        if (isDeletionCommand) {
          console.log("🗑️ Detected memory deletion command...");
          
          // Extract what to delete using patterns
          let keyToDelete = null;
          
          if (lowerInput.match(/favorite.*color|color.*favorite/i)) {
            keyToDelete = "favorite_color";
          } else if (lowerInput.match(/that favorite|my favorite/i)) {
            // Get all user memories and find the most recent favorite
            const allMemories = await this.getAllUserMemories();
            const favoriteKeys = allMemories.filter(m => m.key.includes('favorite'));
            if (favoriteKeys.length > 0) {
              keyToDelete = favoriteKeys[0].key; // Most recent favorite
            }
          } else if (lowerInput.match(/name|my name/i)) {
            keyToDelete = "name";
          } else if (lowerInput.match(/appointment|appt/i)) {
            // Find appointment keys
            const allMemories = await this.getAllUserMemories();
            const appointmentKeys = allMemories.filter(m => m.key.includes('appointment'));
            if (appointmentKeys.length > 0) {
              keyToDelete = appointmentKeys[0].key; // Most recent appointment
            }
          }
          
          if (keyToDelete) {
            console.log(`🗑️ Deleting memory key: ${keyToDelete}`);
            
            try {
              // Delete the memory using UserMemoryAgent
              await this.executeAgent(
                "UserMemoryAgent",
                {
                  action: "delete",
                  key: keyToDelete,
                },
                context,
              );
              
              // Remove from local cache
              delete userMemories[keyToDelete];
              
              return {
                success: true,
                message: `I've removed your ${keyToDelete.replace(/_/g, ' ')} from memory.`,
                source: "memory_deletion",
                model: this.currentLocalModel,
                executionTime: getExecutionTime(),
                sessionId,
                agentsUsed: ["IntentParserAgent", "UserMemoryAgent"],
                intent,
                memoryDeleted: {
                  key: keyToDelete,
                },
              };
            } catch (error) {
              console.error("❌ Failed to delete memory:", error);
              return {
                success: false,
                message: "I had trouble removing that from memory. Could you try again?",
                source: "memory_deletion_failed",
                model: this.currentLocalModel,
                executionTime: getExecutionTime(),
                sessionId,
                agentsUsed: ["IntentParserAgent"],
                intent,
              };
            }
          } else {
            return {
              success: false,
              message: "I'm not sure what you'd like me to remove. Could you be more specific?",
              source: "memory_deletion_unclear",
              model: this.currentLocalModel,
              executionTime: getExecutionTime(),
              sessionId,
              agentsUsed: ["IntentParserAgent"],
              intent,
            };
          }
        }

        // Use LLM to extract key-value pairs from the memory storage request
        // Check if this might be a multi-intent scenario with multiple pieces of information
        const hasMultipleInfo = userInput.includes(' and ') || userInput.includes(', ') || 
                               (userInput.match(/\b(name|phone|number|color|address|email)\b/gi) || []).length > 1;
        
        let memoryExtractionPrompt;
        if (hasMultipleInfo) {
          memoryExtractionPrompt = `Extract ALL key-value pairs from this memory storage request. The input contains multiple pieces of information that should be stored separately. Respond with ONLY a JSON array of objects, each containing "key" and "value" fields. Use snake_case for keys and be concise.

User input: "${userInput}"

Examples:
- "My mom's name is Sarah and her phone is 555-1234" → [{"key": "moms_name", "value": "Sarah"}, {"key": "moms_phone", "value": "555-1234"}]
- "remember my favorite color is blue and I work at Google" → [{"key": "favorite_color", "value": "blue"}, {"key": "workplace", "value": "Google"}]
- "John's email is john@email.com and his address is 123 Main St" → [{"key": "johns_email", "value": "john@email.com"}, {"key": "johns_address", "value": "123 Main St"}]

JSON:`;
        } else {
          memoryExtractionPrompt = `Extract the key-value pair from this memory storage request. Respond with ONLY a JSON object containing "key" and "value" fields. Use snake_case for keys and be concise.

User input: "${userInput}"

Examples:
- "my name is John" → {"key": "name", "value": "John"}
- "remember my favorite color is blue" → {"key": "favorite_color", "value": "blue"}
- "I work at Google" → {"key": "workplace", "value": "Google"}
- "I have an appointment next week Tuesday at 4pm for a haircut" → {"key": "appointment_haircut", "value": "next week Tuesday at 4pm"}
- "My dentist appointment is on Friday at 2pm" → {"key": "appointment_dentist", "value": "Friday at 2pm"}

JSON:`;
        }

        try {
          const llmResponse = await this.queryLocalLLM(memoryExtractionPrompt, {
            max_tokens: 300, // Increased for complex multi-intent workflows
            temperature: 0.1,
            stop: ["}", "]"], // Better stop tokens for JSON completion
          });

          console.log("🧠 LLM memory extraction response:", llmResponse);

          // Parse the LLM response to extract key-value pair(s)
          let memoryDataArray = [];
          try {
            // Clean up the response (remove any markdown or extra text)
            let cleanResponse = llmResponse
              .replace(/```json|```|`/g, "")
              .trim();
            
            // Handle truncated JSON by attempting to complete it
            if (cleanResponse.includes('[') && !cleanResponse.includes(']')) {
              cleanResponse += ']';
              console.log('🔧 Attempting to fix truncated JSON array');
            }
            if (cleanResponse.includes('{') && !cleanResponse.endsWith('}') && !cleanResponse.endsWith(']')) {
              cleanResponse += '}';
              console.log('🔧 Attempting to fix truncated JSON object');
            }
            
            const parsedData = JSON.parse(cleanResponse);
            
            // Handle both single object and array responses
            if (Array.isArray(parsedData)) {
              memoryDataArray = parsedData;
            } else if (parsedData.key && parsedData.value) {
              memoryDataArray = [parsedData];
            }
          } catch (parseError) {
            console.log(
              "⚠️ Failed to parse LLM response, trying fallback extraction...",
            );

            // Enhanced fallback patterns for both single and multi-intent scenarios
            const fallbackPatterns = [
              // Multi-intent patterns (check these first)
              {
                pattern: /(?:mom|mother).*(?:favorite color|color).*is\s+([\w\s]+).*(?:number|phone).*is\s+([\d\-\.\s]+)/i,
                multiExtract: (match) => [
                  { key: "moms_favorite_color", value: match[1].trim() },
                  { key: "moms_phone_number", value: match[2].trim() }
                ]
              },
              {
                pattern: /(?:mom|mother).*(?:name|called).*is\s+([\w\s]+).*(?:number|phone).*is\s+([\d\-\.\s]+)/i,
                multiExtract: (match) => [
                  { key: "moms_name", value: match[1].trim() },
                  { key: "moms_phone_number", value: match[2].trim() }
                ]
              },
              // Complex workflow patterns
              {
                pattern: /(?:create|make|set up|schedule).*(?:workflow|plan|task|reminder).*(?:for|about|to)\s+([\w\s]+)/i,
                multiExtract: (match) => [
                  { key: "workflow_request", value: match[1].trim() },
                  { key: "workflow_type", value: "creation" }
                ]
              },
              {
                pattern: /(?:remind me|set reminder|schedule).*(?:to|about)\s+([\w\s]+).*(?:at|on|in)\s+([\w\s:]+)/i,
                multiExtract: (match) => [
                  { key: "reminder_task", value: match[1].trim() },
                  { key: "reminder_time", value: match[2].trim() }
                ]
              },
              // Single-intent patterns
              { pattern: /name is ([\w\s]+)/i, key: "name" },
              {
                pattern: /favorite color is ([\w\s]+)/i,
                key: "favorite_color",
              },
              { pattern: /work at ([\w\s]+)/i, key: "workplace" },
              {
                pattern: /(?:phone|number).*is\s+([\d\-\.\s]+)/i,
                key: "phone_number"
              },
              // Appointment patterns
              {
                pattern:
                  /(?:i have|i've got|my)\s+(?:an\s+)?(?:appointment|appt|meeting)\s+(?:next|this|on|for)\s+([\w\s]+)\s+(?:at|for|to)\s+([\w\s:]+)(?:\s+(?:for|to)\s+([\w\s]+))?/i,
                keyFn: (matches) =>
                  `appointment_${matches[3] ? matches[3].toLowerCase().replace(/\s+/g, "_") : "general"}`,
                valueFn: (matches) => `${matches[1]} at ${matches[2]}`.trim(),
              },
              {
                pattern:
                  /(?:appointment|appt|meeting)\s+(?:is|for|on)\s+([\w\s]+)\s+(?:at|for)\s+([\w\s:]+)/i,
                keyFn: (matches) => "appointment_general",
                valueFn: (matches) => `${matches[1]} at ${matches[2]}`.trim(),
              },
            ];

            for (const patternObj of fallbackPatterns) {
              const match = userInput.match(patternObj.pattern);
              if (match) {
                if (patternObj.multiExtract) {
                  // Multi-intent extraction
                  memoryDataArray = patternObj.multiExtract(match);
                  console.log("🔍 Multi-intent fallback pattern matched:", patternObj.pattern);
                  console.log("📦 Extracted multiple memory data:", memoryDataArray);
                } else if (patternObj.keyFn && patternObj.valueFn) {
                  // Complex single pattern with custom key/value extraction functions
                  memoryDataArray = [{
                    key: patternObj.keyFn(match),
                    value: patternObj.valueFn(match),
                  }];
                  console.log("🔍 Complex fallback pattern matched:", patternObj.pattern);
                  console.log("📦 Extracted memory data:", memoryDataArray[0]);
                } else {
                  // Simple single pattern with direct key/value
                  memoryDataArray = [{ key: patternObj.key, value: match[1].trim() }];
                  console.log("🔍 Simple fallback pattern matched:", patternObj.pattern);
                  console.log("📦 Extracted memory data:", memoryDataArray[0]);
                }
                break;
              }
            }
          }

          // Store all extracted memory entries
          if (memoryDataArray && memoryDataArray.length > 0) {
            console.log(`💾 Storing ${memoryDataArray.length} memory entries:`);
            
            for (const memoryData of memoryDataArray) {
              if (memoryData && memoryData.key && memoryData.value) {
                console.log(`💾 Storing ${memoryData.key}: ${memoryData.value}`);

                await this.executeAgent(
                  "UserMemoryAgent",
                  {
                    action: "store",
                    key: memoryData.key,
                    value: memoryData.value,
                  },
                  context,
                );
              }
            }
          }

          // Generate confirmation message for stored memories
          if (memoryDataArray && memoryDataArray.length > 0) {
            // Update userMemories object for context
            for (const memoryData of memoryDataArray) {
              if (memoryData && memoryData.key && memoryData.value) {
                userMemories[memoryData.key] = memoryData.value;
              }
            }

            // Generate appropriate confirmation message
            let confirmationMessage = "";
            if (memoryDataArray.length === 1) {
              const memoryData = memoryDataArray[0];
              if (memoryData.key.includes("appointment")) {
                confirmationMessage = `I've saved your ${memoryData.key.replace("appointment_", "")} appointment for ${memoryData.value}.`;
              } else {
                confirmationMessage = `I've remembered that your ${memoryData.key.replace(/_/g, " ")} is ${memoryData.value}.`;
              }
            } else {
              // Multiple memories stored
              const memoryDescriptions = memoryDataArray.map(data => {
                if (data.key.includes("appointment")) {
                  return `${data.key.replace("appointment_", "")} appointment (${data.value})`;
                } else {
                  return `${data.key.replace(/_/g, " ")} (${data.value})`;
                }
              });
              confirmationMessage = `I've remembered ${memoryDescriptions.length} things: ${memoryDescriptions.join(", ")}.`;
            }

            // Return a proper response object
            return {
              success: true,
              message: confirmationMessage,
              source: "memory_storage",
              model: this.currentLocalModel,
              executionTime: getExecutionTime(),
              sessionId,
              agentsUsed: ["IntentParserAgent", "UserMemoryAgent"],
              intent,
              memoryStored: memoryDataArray.map(data => ({
                key: data.key,
                value: data.value,
              })),
            };
          } else {
            console.log(
              "⚠️ Could not extract memory data from input:",
              userInput,
            );

            // Return a proper response object even when extraction fails
            return {
              success: false,
              message:
                "I couldn't understand what to remember from that. Could you phrase it differently?",
              source: "memory_storage_failed",
              model: this.currentLocalModel,
              executionTime: getExecutionTime(),
              sessionId,
              agentsUsed: ["IntentParserAgent"],
              intent,
            };
          }
        } catch (error) {
          console.error("❌ Failed to extract memory with LLM:", error);

          // Return a proper error response
          return {
            success: false,
            message: "I had trouble processing that. Could you try again?",
            source: "memory_storage_error",
            model: this.currentLocalModel,
            executionTime: getExecutionTime(),
            sessionId,
            agentsUsed: ["IntentParserAgent"],
            intent,
            error: error.message,
          };
        }
      } else if (intent === "memory_delete") {
        console.log("🗑️ Processing memory deletion request...");
        
        // Extract what to delete using patterns
        const lowerInput = userInput.toLowerCase();
        let keyToDelete = null;
        
        if (lowerInput.match(/favorite.*color|color.*favorite/i)) {
          keyToDelete = "favorite_color";
        } else if (lowerInput.match(/that favorite|my favorite/i)) {
          // Get all user memories and find the most recent favorite
          const allMemories = await this.getAllUserMemories();
          const favoriteKeys = allMemories.filter(m => m.key.includes('favorite'));
          if (favoriteKeys.length > 0) {
            keyToDelete = favoriteKeys[0].key; // Most recent favorite
          }
        } else if (lowerInput.match(/name|my name/i)) {
          keyToDelete = "name";
        } else if (lowerInput.match(/appointment|appt/i)) {
          // Find appointment keys
          const allMemories = await this.getAllUserMemories();
          const appointmentKeys = allMemories.filter(m => m.key.includes('appointment'));
          if (appointmentKeys.length > 0) {
            keyToDelete = appointmentKeys[0].key; // Most recent appointment
          }
        } else if (lowerInput.match(/everything|all.*memor/i)) {
          keyToDelete = "*"; // Clear all memories
        }
        
        if (keyToDelete) {
          console.log(`🗑️ Deleting memory key: ${keyToDelete}`);
          
          try {
            // Delete the memory using UserMemoryAgent
            const deleteResult = await this.executeAgent(
              "UserMemoryAgent",
              {
                action: keyToDelete === "*" ? "clear" : "delete",
                key: keyToDelete === "*" ? undefined : keyToDelete,
              },
              {
                ...context,
                dbConnection: this.dbConnection, // Pass database connection
              },
            );
            
            if (deleteResult.success) {
              const response = {
                success: true,
                message: keyToDelete === "*" 
                  ? "I've cleared all your memories."
                  : `I've removed your ${keyToDelete.replace(/_/g, ' ')} from memory.`,
                source: "memory_deletion",
                model: this.currentLocalModel,
                executionTime: getExecutionTime(),
                sessionId,
                agentsUsed: ["IntentParserAgent", "UserMemoryAgent"],
                intent,
                memoryDeleted: {
                  key: keyToDelete,
                },
              };
              
              await this.logCommunication({
                from_agent: "LocalLLMAgent",
                to_agent: "UserMemoryAgent",
                message_type: "memory_delete",
                content: JSON.stringify({ key: keyToDelete }),
                context: JSON.stringify(context),
                success: true,
                execution_time_ms: getExecutionTime(),
                session_id: sessionId,
              });
              
              return response;
            } else {
              throw new Error(deleteResult.error || "Delete operation failed");
            }
          } catch (error) {
            console.error("❌ Failed to delete memory:", error);
            return {
              success: false,
              message: "I had trouble removing that from memory. Could you try again?",
              source: "memory_deletion_failed",
              model: this.currentLocalModel,
              executionTime: getExecutionTime(),
              sessionId,
              agentsUsed: ["IntentParserAgent"],
              intent,
              error: error.message,
            };
          }
        } else {
          return {
            success: false,
            message: "I'm not sure what you'd like me to remove. Could you be more specific?",
            source: "memory_deletion_unclear",
            model: this.currentLocalModel,
            executionTime: getExecutionTime(),
            sessionId,
            agentsUsed: ["IntentParserAgent"],
            intent,
          };
        }
      } else if (intent === "memory_retrieve") {
        console.log("🧠 Processing memory retrieval with semantic search...");

        // Retrieve all user memories
        const userMemoryResult = await this.executeAgent(
          "UserMemoryAgent",
          {
            action: "retrieve",
            key: "*",
          },
          context,
        );

        if (userMemoryResult.success) {
          const userMemories = userMemoryResult.memories || {};
          const memoryKeys = Object.keys(userMemories);
          console.log(
            `✅ Retrieved ${memoryKeys.length} memories for semantic search`,
          );

          // Perform semantic memory search
          const semanticMatches = await this.performSemanticMemorySearch(
            userInput,
            userMemories,
          );
          console.log(
            `🔍 Found ${semanticMatches.length} semantic matches:`,
            semanticMatches,
          );

          // If we found relevant memories, format a response
          if (semanticMatches.length > 0) {
            const matchedMemory = semanticMatches[0]; // Use the best match

            // Generate contextual response based on the matched memory
            const contextualResponse = this.generateContextualMemoryResponse(
              userInput,
              matchedMemory,
            );

            const response = {
              success: true,
              message: contextualResponse,
              source: "semantic_memory_match",
              model: this.currentLocalModel,
              executionTime: getExecutionTime(),
              sessionId,
              agentsUsed: ["IntentParserAgent", "UserMemoryAgent"],
              intent,
              matchedMemories: semanticMatches,
              searchQuery: userInput,
            };

            await this.logCommunication({
              from_agent: "LocalLLMAgent",
              to_agent: "user",
              message_type: "semantic_memory_match",
              content: {
                userInput,
                matchedMemories: semanticMatches,
                response: response.message,
              },
              context,
              success: true,
              execution_time_ms: response.executionTime,
              session_id: sessionId,
            });

            return response;
          } else {
            // No semantic matches found, try fallback search or LLM enrichment
            console.log(
              "⚠️ No semantic matches found, trying LLM enrichment...",
            );

            // Get recent messages for conversation context
            const recentMessages = await this.getRecentMessages(sessionId, 5);

            // Enrich the prompt with user context
            const enrichmentResult = await this.executeAgent(
              "MemoryEnrichmentAgent",
              {
                prompt: userInput,
                userMemories,
                recentMessages,
              },
              context,
            );

            const enrichedPrompt = enrichmentResult.success
              ? enrichmentResult.enrichedPrompt
              : userInput;

            // Generate LLM response for cases where no direct matches exist
            const llmResponse = await this.queryLocalLLM(enrichedPrompt, {
              sessionId,
              temperature: 0.7,
              maxTokens: 200,
              contextWindow: 1024,
              numThread: 1,
              stopTokens: ["\n\n"],
              timeout: 12000,
            });

            const response = {
              success: true,
              message:
                llmResponse ||
                "I don't have specific information about that in my memory. Would you like me to remember something for you?",
              source: "memory_retrieval_fallback",
              model: this.currentLocalModel,
              executionTime: getExecutionTime(),
              sessionId,
              agentsUsed: [
                "IntentParserAgent",
                "UserMemoryAgent",
                "MemoryEnrichmentAgent",
              ],
              intent,
              availableMemories: memoryKeys,
            };

            await this.logCommunication({
              from_agent: "LocalLLMAgent",
              to_agent: "user",
              message_type: "memory_retrieval_fallback",
              content: {
                userInput,
                enrichedPrompt,
                response: response.message,
                availableMemories: memoryKeys,
              },
              context,
              success: true,
              execution_time_ms: response.executionTime,
              session_id: sessionId,
            });

            return response;
          }
        } else {
          // Handle case where memory retrieval failed
          console.log("❌ Failed to retrieve memories");

          const response = {
            success: false,
            message:
              "I'm having trouble accessing my memory right now. Could you try again?",
            source: "memory_retrieve_failed",
            model: this.currentLocalModel,
            executionTime: getExecutionTime(),
            sessionId,
            agentsUsed: ["IntentParserAgent", "UserMemoryAgent"],
            intent,
          };

          await this.logCommunication({
            from_agent: "LocalLLMAgent",
            to_agent: "user",
            message_type: "memory_retrieve_failed",
            content: { userInput, response: response.message },
            context,
            success: false,
            execution_time_ms: response.executionTime,
            session_id: sessionId,
          });

          return response;
        }
      } else if (intent === "greeting") {
        console.log("👋 Processing greeting intent...");

        // Get user name from memory if available
        console.log("🧠 Retrieving user memories for personalized greeting...");
        const userMemoryResult = await this.executeAgent(
          "UserMemoryAgent",
          {
            action: "retrieve",
            key: "name",
          },
          context,
        );

        let userName = "";
        if (
          userMemoryResult.success &&
          userMemoryResult.memories &&
          userMemoryResult.memories.name
        ) {
          userName = userMemoryResult.memories.name;
          console.log(`✅ Retrieved user name: ${userName}`);
        }

        // Generate personalized greeting based on time of day and user name
        const hour = new Date().getHours();
        let timeGreeting = "";

        if (hour < 12) {
          timeGreeting = "Good morning";
        } else if (hour < 18) {
          timeGreeting = "Good afternoon";
        } else {
          timeGreeting = "Good evening";
        }

        // Add user name if available
        const personalizedGreeting = userName
          ? `${timeGreeting}, ${userName}!`
          : `${timeGreeting}!`;

        // Select a random greeting variation
        const greetingVariations = [
          `${personalizedGreeting} How can I help you today?`,
          `${personalizedGreeting} What can I assist you with?`,
          `${personalizedGreeting} I'm here and ready to help.`,
          `${personalizedGreeting} How may I be of service?`,
          `${personalizedGreeting} What's on your mind today?`,
        ];

        const randomGreeting =
          greetingVariations[
            Math.floor(Math.random() * greetingVariations.length)
          ];

        const response = {
          success: true,
          message: randomGreeting,
          source: "greeting_response",
          model: this.currentLocalModel,
          executionTime: getExecutionTime(),
          sessionId,
          agentsUsed: ["IntentParserAgent"],
          intent,
        };

        await this.logCommunication({
          from_agent: "LocalLLMAgent",
          to_agent: "user",
          message_type: "greeting_response",
          content: { userInput, response: response.message },
          context,
          success: true,
          execution_time_ms: response.executionTime,
          session_id: sessionId,
        });

        return response;
      } else if (intent === "multi_command") {
        console.log("🔄 Processing multi_command intent...");

        // For multi_command, we need to use PlannerAgent to create a plan
        console.log("📝 Creating execution plan with PlannerAgent...");

        // Get user memories for context
        const userMemoryResult = await this.executeAgent(
          "UserMemoryAgent",
          {
            action: "retrieve",
            key: "*",
          },
          context,
        );

        if (userMemoryResult.success) {
          userMemories = userMemoryResult.memories || {};
        }

        // Execute PlannerAgent to create a plan
        const plannerResult = await this.executeAgent(
          "PlannerAgent",
          {
            message: userInput,
            intent,
            userMemories,
          },
          context,
        );

        if (plannerResult.success && plannerResult.plan) {
          console.log("✅ Successfully created execution plan");

          // For now, we'll just acknowledge the plan and provide a helpful response
          // In a future implementation, we would execute the plan steps

          const response = {
            success: true,
            message: `I understand you want me to perform multiple actions. I've created a plan to help with "${userInput}", but I'm still learning how to execute these complex tasks. Would you like me to break this down into simpler steps?`,
            source: "multi_command_planning",
            model: this.currentLocalModel,
            executionTime: getExecutionTime(),
            sessionId,
            agentsUsed: ["IntentParserAgent", "PlannerAgent"],
            intent,
            plan: plannerResult.plan,
          };

          await this.logCommunication({
            from_agent: "LocalLLMAgent",
            to_agent: "user",
            message_type: "multi_command_planning",
            content: {
              userInput,
              response: response.message,
              plan: plannerResult.plan,
            },
            context,
            success: true,
            execution_time_ms: response.executionTime,
            session_id: sessionId,
          });

          return response;
        } else {
          console.log("❌ Failed to create execution plan");

          // Fallback to treating it as a question
          // return this.handleLocalOrchestration(
          //   userInput,
          //   { ...context, fallbackIntent: "question" },
          //   sessionId,
          // );
        }
      } else if (intent === "orchestration") {
        console.log("🎵 Processing orchestration intent...");

        // For orchestration, we need to use PlannerAgent to create a complex workflow plan
        console.log("📝 Creating orchestration workflow with PlannerAgent...");

        // Get user memories for context
        const userMemoryResult = await this.executeAgent(
          "UserMemoryAgent",
          {
            action: "retrieve",
            key: "*",
          },
          context,
        );

        if (userMemoryResult.success) {
          userMemories = userMemoryResult.memories || {};
        }

        // Execute PlannerAgent to create an orchestration plan
        const plannerResult = await this.executeAgent(
          "PlannerAgent",
          {
            message: userInput,
            intent,
            userMemories,
            orchestration: true,
          },
          context,
        );

        if (plannerResult.success && plannerResult.plan) {
          console.log("✅ Successfully created orchestration workflow");

          const response = {
            success: true,
            message: `I understand you want me to orchestrate a complex workflow. I've created a plan for "${userInput}", but I'm still learning how to execute these sophisticated tasks. Would you like me to explain the steps I would take?`,
            source: "orchestration_planning",
            model: this.currentLocalModel,
            executionTime: getExecutionTime(),
            sessionId,
            agentsUsed: ["IntentParserAgent", "PlannerAgent"],
            intent,
            plan: plannerResult.plan,
          };

          await this.logCommunication({
            from_agent: "LocalLLMAgent",
            to_agent: "user",
            message_type: "orchestration_planning",
            content: {
              userInput,
              response: response.message,
              plan: plannerResult.plan,
            },
            context,
            success: true,
            execution_time_ms: response.executionTime,
            session_id: sessionId,
          });

          return response;
        } else {
          console.log("❌ Failed to create orchestration workflow");

          // Fallback to treating it as a question
          // return this.handleLocalOrchestration(
          //   userInput,
          //   { ...context, fallbackIntent: "question" },
          //   sessionId,
          // );
        }
      } else {
        // Handle communication intents (compose_email, send_text, etc.)
        if (intent === 'compose_email' || intent === 'send_text' || intent === 'communication') {
          console.log(`📧 Handling communication intent: ${intent}`);
          
          // For communication intents, provide a helpful response about limitations
          const response = {
            success: true,
            message: "I understand you want to send a message. Currently, I can help you draft messages, but I don't have access to send emails or texts directly. I can help you compose the message content or guide you through the process.",
            intent,
            category: 'communication',
            executionTime: Date.now() - methodStartTime,
            sessionId
          };

          await this.logCommunication({
            from_agent: 'LocalLLMAgent',
            to_agent: 'user',
            message_type: 'communication_response',
            content: {
              userInput,
              response: response.message,
              intent
            },
            context,
            success: true,
            execution_time_ms: response.executionTime,
            session_id: sessionId
          });

          return response;
        }
        
        // For truly unhandled intents, prevent infinite recursion
        if (context.fallbackIntent === 'question' || context.recursionDepth >= 2) {
          console.log(`🛑 Preventing infinite recursion for intent: ${intent}`);
          
          const response = {
            success: true,
            message: "I'm not sure how to handle that specific request right now. Could you try rephrasing it or asking something else?",
            intent: 'unknown',
            category: 'general',
            executionTime: Date.now() - methodStartTime,
            sessionId
          };

          await this.logCommunication({
            from_agent: 'LocalLLMAgent',
            to_agent: 'user', 
            message_type: 'fallback_response',
            content: {
              userInput,
              response: response.message,
              originalIntent: intent
            },
            context,
            success: true,
            execution_time_ms: response.executionTime,
            session_id: sessionId
          });

          return response;
        }
        
        // Default handler for other intents (with recursion protection)
        console.log(
          `❓ Processing unhandled intent: ${intent}, falling back to question handling...`,
        );

        // Treat unhandled intents as questions with recursion protection
        const fallbackContext = { 
          ...context, 
          fallbackIntent: "question",
          recursionDepth: (context.recursionDepth || 0) + 1
        };
        
        return this.handleLocalOrchestration(
          userInput,
          fallbackContext,
          sessionId,
        );
      }
    } catch (error) {
      console.error(
        `❌ Agent orchestration failed: ${sessionId}`,
        error.message,
      );

      const fallbackResponse = {
        success: false,
        message:
          "I apologize, but I'm having trouble processing your request right now. Please try again.",
        source: "fallback",
        timestamp: new Date().toISOString(),
        executionTime: getExecutionTime(),
        error: error.message,
        fallback: true,
      };

      await this.logCommunication({
        from_agent: "LocalLLMAgent",
        to_agent: "user",
        message_type: "local_llm_error",
        content: { userInput, error: error.message },
        context,
        success: false,
        error_message: error.message,
        execution_time_ms: fallbackResponse.executionTime,
        session_id: sessionId,
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
      handledBy: "BackendLLMAgent",
      escalationReason: complexity.reasons.join(", "),
      timestamp: new Date().toISOString(),
    };

    return response;
  }

  /**
   * Check if a user input is an appointment-related query
   * @param {string} userInput - The user input to check
   * @returns {boolean} - True if the input is an appointment query
   */
  isAppointmentQuery(userInput) {
    if (!userInput) return false;

    const lowerInput = userInput.toLowerCase();

    // Check for appointment-related keywords
    const appointmentKeywords = [
      "appointment",
      "appt",
      "meeting",
      "schedule",
      "calendar",
    ];
    const timeKeywords = [
      "when",
      "time",
      "date",
      "day",
      "next week",
      "tomorrow",
      "tuesday",
    ];

    // Check if input contains both appointment and time keywords
    const hasAppointmentKeyword = appointmentKeywords.some((keyword) =>
      lowerInput.includes(keyword),
    );
    const hasTimeKeyword = timeKeywords.some((keyword) =>
      lowerInput.includes(keyword),
    );

    return hasAppointmentKeyword && hasTimeKeyword;
  }

  /**
   * Get recent messages for a session to provide conversation context
   * @param {string} sessionId - The session ID to get messages for
   * @param {number} limit - Maximum number of messages to retrieve
   * @returns {Promise<Array>} - Array of recent messages
   */
  async getRecentMessages(sessionId, limit = 5) {
    if (!sessionId || !this.dbConnection) {
      return [];
    }

    try {
      const query = `
        SELECT content, timestamp, from_agent, to_agent
        FROM agent_communications
        WHERE execution_id = '${sessionId}'
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `;

      return new Promise((resolve, reject) => {
        this.dbConnection.all(query, (err, rows) => {
          if (err) {
            console.error("❌ Failed to retrieve recent messages:", err);
            resolve([]);
            return;
          }

          // Format messages for context
          const messages = rows
            .map((row) => {
              try {
                const content =
                  typeof row.content === "string"
                    ? JSON.parse(row.content)
                    : row.content;
                return {
                  message: content.userInput || content.response || "",
                  timestamp: row.timestamp,
                  from: row.from_agent,
                  to: row.to_agent,
                };
              } catch (e) {
                return null;
              }
            })
            .filter(Boolean);

          resolve(messages);
        });
      });
    } catch (error) {
      console.error("❌ Error retrieving recent messages:", error);
      return [];
    }
  }

  /**
   * Log agent communication to DuckDB
   */
  async logCommunication(logData) {
    if (!this.dbConnection) {
      console.warn("⚠️ Database connection not available for logging");
      return;
    }

    try {
      const id = this.generateCallId();
      const deviceId = this.getDeviceId();
      const timestamp = new Date().toISOString();
      const escapedContent = JSON.stringify(logData.content || {}).replace(
        /'/g,
        "''",
      );
      const escapedContext = JSON.stringify(logData.context || {}).replace(
        /'/g,
        "''",
      );
      const errorMessage = logData.error_message
        ? `'${logData.error_message.replace(/'/g, "''")}'`
        : "NULL";
      const executionId = logData.session_id
        ? `'${logData.session_id}'`
        : "NULL";

      const insertSQL = `
        INSERT INTO agent_communications (
          id, timestamp, from_agent, to_agent, message_type, content, context,
          success, error_message, execution_time_ms, synced_to_backend, sync_attempts,
          device_id, log_level, execution_id, agent_version, injected_secrets,
          context_used, retry_count
        ) VALUES (
          '${id}',
          '${timestamp}',
          '${logData.from_agent || "unknown"}',
          '${logData.to_agent || "unknown"}',
          '${logData.message_type || "unknown"}',
          '${escapedContent}',
          '${escapedContext}',
          ${logData.success !== undefined ? logData.success : false},
          ${errorMessage},
          ${logData.execution_time_ms || 0},
          false,
          0,
          '${deviceId}',
          '${logData.log_level || "info"}',
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
            console.error("❌ DuckDB insert error:", err.message);
            console.error("SQL:", insertSQL);
            reject(err);
          } else {
            resolve();
          }
        });
      });

      console.log(
        `📝 Logged communication: ${logData.from_agent} → ${logData.to_agent} (${logData.message_type})`,
      );
    } catch (error) {
      console.error("❌ Failed to log communication:", error.message);
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
            console.warn("⚠️ Failed to get recent conversation:", err.message);
            resolve([]);
          } else {
            resolve(rows.reverse());
          }
        });
      });
    } catch (error) {
      console.warn("⚠️ Error getting recent conversation:", error.message);
      return [];
    }
  }

  /**
   * Execute a specific agent by name using secure sandbox
   * Default trusted agents can bypass the sandbox for performance and reliability
   */
  async executeAgent(agentName, params, context = {}) {
    // Ensure database connection is available for UserMemoryAgent
    if (agentName === 'UserMemoryAgent' && this.dbConnection) {
      context = {
        ...context,
        dbConnection: this.dbConnection,
      };
    }
    return await this.executeAgentInstance.call(agentName, params, context, this);
  }

  /**
   * Get communication logs from DuckDB
   */
  async getCommunications(options = {}) {
    if (!this.dbConnection) {
      console.warn(
        "⚠️ Database connection not available for retrieving communications",
      );
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
        success = null,
      } = options;

      let whereClause = "";
      const params = [];
      const conditions = [];

      if (fromAgent) {
        conditions.push("from_agent = ?");
        params.push(fromAgent);
      }
      if (toAgent) {
        conditions.push("to_agent = ?");
        params.push(toAgent);
      }
      if (messageType) {
        conditions.push("message_type = ?");
        params.push(messageType);
      }
      if (sessionId) {
        conditions.push("execution_id = ?");
        params.push(sessionId);
      }
      if (success !== null) {
        conditions.push("success = ?");
        params.push(success);
      }

      if (conditions.length > 0) {
        whereClause = "WHERE " + conditions.join(" AND ");
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
              content: JSON.parse(row.content || "{}"),
              context: JSON.parse(row.context || "{}"),
            }));
            resolve(communications);
          }
        });
      });
    } catch (error) {
      console.error("❌ Failed to retrieve communications:", error.message);
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
        .createHash("sha256")
        .update(`${os.hostname()}-${os.platform()}-${os.arch()}`)
        .digest("hex")
        .substring(0, 16);
    } catch (error) {
      console.warn("⚠️ Failed to generate device ID, using fallback");
      return "fallback-device-id";
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
        console.warn(
          `⚠️ Operation failed (attempt ${attempt}/${maxRetries}):`,
          error.message,
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * Handle greeting intent - provide friendly responses
   */
  async handle_greeting(params, context = {}) {
    try {
      const message = params.message || params.data?.message || "";
      console.log(`👋 Handling greeting: "${message}"`);

      const greetingResponses = [
        "Hello! How can I help you today?",
        "Hi there! What can I do for you?",
        "Hey! I'm here to assist you.",
        "Greetings! How may I be of service?",
      ];

      const response =
        greetingResponses[Math.floor(Math.random() * greetingResponses.length)];

      return {
        success: true,
        response,
        intent: "greeting",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Error handling greeting:", error);
      return {
        success: false,
        error: error.message,
        response: "Hello! I'm having trouble right now, but I'm here to help.",
      };
    }
  }

  /**
   * Answer question intent - handle Q&A with local LLM
   */
  async answer_question(params, context = {}) {
    try {
      const message = params.message || params.data?.message || "";
      console.log(`❓ Answering question: "${message}"`);

      if (!this.localLLMAvailable) {
        return {
          success: false,
          error: "Local LLM not available",
          response:
            "I'm sorry, I can't answer questions right now as my local AI is unavailable.",
        };
      }

      const prompt = `You are a helpful AI assistant. Answer this question clearly and concisely:\n\nQuestion: ${message}\n\nAnswer:`;

      const llmResponse = await this.queryLocalLLM(prompt, {
        max_tokens: 200,
        temperature: 0.7,
      });

      if (llmResponse.success) {
        return {
          success: true,
          response: llmResponse.text.trim(),
          intent: "question",
          timestamp: new Date().toISOString(),
        };
      } else {
        return {
          success: false,
          error: llmResponse.error,
          response: "I'm having trouble processing your question right now.",
        };
      }
    } catch (error) {
      console.error("❌ Error answering question:", error);
      return {
        success: false,
        error: error.message,
        response:
          "I encountered an error while trying to answer your question.",
      };
    }
  }

  /**
   * Handle single intent - generic handler for simple intents
   */
  async handle_single_intent(params, context = {}) {
    try {
      const intent = params.intent || params.data?.intent || "unknown";
      const message = params.message || params.data?.message || "";
      console.log(`🎯 Handling single intent '${intent}': "${message}"`);

      // Route to appropriate handler based on intent
      switch (intent) {
        case "greeting":
          return await this.handle_greeting(params, context);
        case "question":
          return await this.answer_question(params, context);
        case "memory_store":
          const key = params.key || `user_input_${Date.now()}`;
          return await this.handleMemoryStore(key, message);
        case "memory_retrieve":
          const searchKey = params.key || message;
          return await this.handleMemoryRetrieve(searchKey);
        default:
          // Generic LLM response for unknown intents
          if (this.localLLMAvailable) {
            const prompt = `You are a helpful AI assistant. Respond to this user message:\n\n${message}\n\nResponse:`;
            const llmResponse = await this.queryLocalLLM(prompt, {
              max_tokens: 150,
              temperature: 0.7,
            });

            if (llmResponse.success) {
              return {
                success: true,
                response: llmResponse.text.trim(),
                intent,
                timestamp: new Date().toISOString(),
              };
            }
          }

          return {
            success: true,
            response:
              "I understand you're trying to communicate with me, but I'm not sure how to help with that specific request.",
            intent,
            timestamp: new Date().toISOString(),
          };
      }
    } catch (error) {
      console.error("❌ Error handling single intent:", error);
      return {
        success: false,
        error: error.message,
        response: "I encountered an error while processing your request.",
      };
    }
  }

  /**
   * Handle memory store operation (block/Drop pattern)
   */
  async handleMemoryStore(key, value) {
    try {
      console.log(`💾 Storing memory: key='${key}'`);

      if (!key || typeof key !== "string") {
        return { success: false, error: "Invalid memory key" };
      }

      const valueStr =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      const timestamp = new Date().toISOString();

      return new Promise((resolve, reject) => {
        const stmt = this.dbConnection.prepare(
          "INSERT OR REPLACE INTO user_memories (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)",
        );

        stmt.run(key, valueStr, timestamp, timestamp, (err) => {
          if (err) {
            console.error("❌ Memory storage failed:", err);
            resolve({
              success: false,
              error: `Memory storage failed: ${err.message}`,
            });
          } else {
            console.log("✅ Memory stored successfully");
            resolve({ success: true, key, timestamp });
          }
        });
      });
    } catch (error) {
      console.error("❌ Memory store error:", error);
      return { success: false, error: `Memory store error: ${error.message}` };
    }
  }

  /**
   * Handle memory retrieve operation (block/Drop pattern)
   */
  async handleMemoryRetrieve(key) {
    try {
      console.log(`🔍 Retrieving memory: key='${key || "*"}'`);

      return new Promise((resolve, reject) => {
        let query;
        let params = [];

        if (key && key !== "*") {
          query =
            "SELECT key, value, created_at, updated_at FROM user_memories WHERE key = ?";
          params = [key];
        } else {
          query =
            "SELECT key, value, created_at, updated_at FROM user_memories";
        }

        // Execute query with proper parameter handling
        const executeQuery = (callback) => {
          if (params.length > 0) {
            this.dbConnection.all(query, params, callback);
          } else {
            this.dbConnection.all(query, callback);
          }
        };

        executeQuery((err, rows) => {
        if (err) {
          console.error("❌ Memory retrieval failed:", err);
          resolve({
            success: false,
            error: `Memory retrieval failed: ${err.message}`,
          });
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
                updated_at: row.updated_at,
              });
            } catch (parseError) {
              results.push({
                key: row.key,
                value: row.value,
                created_at: row.created_at,
                updated_at: row.updated_at,
              });
            }
          });
        }

        console.log(`✅ Retrieved ${results.length} memories`);
        resolve({ success: true, results });
      });
    });
  } catch (error) {
    console.error("❌ Memory retrieve error:", error);
    return {
      success: false,
      error: `Memory retrieve error: ${error.message}`,
    };
  }
}

/**
 * Handle memory search operation (block/Drop pattern)
 */
async handleMemorySearch(query) {
  try {
    console.log(`🔍 Searching memories for: '${query}'`);

    if (!query || typeof query !== "string") {
      return { success: false, error: "Invalid search query" };
    }

    return new Promise((resolve, reject) => {
      const searchTerm = `%${query}%`;

      this.dbConnection.all(
        "SELECT key, value FROM user_memories WHERE key LIKE ? OR value LIKE ?",
        [searchTerm, searchTerm],
        (err, rows) => {
          if (err) {
            console.error("❌ Memory search failed:", err);
            resolve({
              success: false,
              error: `Memory retrieval failed: ${err.message}`,
            });
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
                  updated_at: row.updated_at,
                });
              } catch (parseError) {
                results.push({
                  key: row.key,
                  value: row.value,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                });
              }
            });
          }

          console.log(`✅ Retrieved ${results.length} memories`);
          resolve({ success: true, results });
        });
      });
    } catch (error) {
      console.error("❌ Memory retrieve error:", error);
      return {
        success: false,
        error: `Memory retrieve error: ${error.message}`,
      };
    }
  }

  /**
   * Handle memory search operation (block/Drop pattern)
   */
  async handleMemorySearch(query) {
    try {
      console.log(`🔍 Searching memories for: '${query}'`);

      if (!query || typeof query !== "string") {
        return { success: false, error: "Invalid search query" };
      }

      return new Promise((resolve, reject) => {
        const searchTerm = `%${query}%`;

        this.dbConnection.all(
          "SELECT key, value FROM user_memories WHERE key LIKE ? OR value LIKE ?",
          [searchTerm, searchTerm],
          (err, rows) => {
            if (err) {
              console.error("❌ Memory search failed:", err);
              resolve({
                success: false,
                error: `Memory search failed: ${err.message}`,
              });
              return;
            }

            const results = [];
            if (rows && rows.length > 0) {
              rows.forEach((row) => {
                try {
                  results.push({
                    key: row.key,
                    value: JSON.parse(row.value),
                  });
                } catch (parseError) {
                  results.push({
                    key: row.key,
                    value: row.value,
                  });
                }
              });
            }

            console.log(`✅ Found ${results.length} matching memories`);
            resolve({ success: true, results });
          },
        );
      });
    } catch (error) {
      console.error("❌ Memory search error:", error);
      return { success: false, error: `Memory search error: ${error.message}` };
    }
  }

  /**
   * Get all user memories from DuckDB for debugging
   */
  async getAllUserMemories(quiet = false) {
    try {
      if (!quiet) {
        console.log("🔍 Retrieving all user memories for debugging");
      }

      return new Promise((resolve, reject) => {
        this.dbConnection.all(
          "SELECT * FROM user_memories ORDER BY updated_at DESC",
          (err, rows) => {
            if (err) {
              console.error("❌ Failed to retrieve user memories:", err);
              reject(err);
              return;
            }

            if (!quiet) {
              console.log(`📊 Raw database rows retrieved: ${rows.length}`);
              if (rows.length > 0) {
                console.log("📋 Sample row structure:", rows[0]);
              }
            }

            const memories = rows.map((row) => {
              try {
                // Try to parse value as JSON if it looks like JSON
                const parsedValue =
                  typeof row.value === "string" && row.value.startsWith("{")
                    ? JSON.parse(row.value)
                    : row.value;

                return {
                  key: row.key,
                  value: parsedValue,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                };
              } catch (parseError) {
                // If not JSON, use as string
                return {
                  key: row.key,
                  value: row.value,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                };
              }
            });

            if (!quiet) {
              console.log(`✅ Retrieved ${memories.length} user memories`);
            }
            resolve(memories);
          },
        );
      });
    } catch (error) {
      console.error("❌ Failed to retrieve user memories:", error);
      return [];
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log("🧹 Cleaning up LocalLLMAgent...");

    if (this.database) {
      this.database.close();
    }

    this.agentCache.clear();
    this.orchestrationCache.clear();

    console.log("✅ LocalLLMAgent cleanup completed");
  }
  /**
   * Perform advanced intent-memory correlation using deterministic pattern matching
   * @param {string} userInput - The user's query
   * @param {Object} userMemories - All stored user memories
   * @returns {Promise<Array>} Array of correlated memory matches
   */
  async performIntentMemoryCorrelation(userInput, userMemories) {
    console.log("🧠 Performing deterministic intent-memory correlation...");

    const matches = [];
    const memoryKeys = Object.keys(userMemories);
    
    if (memoryKeys.length === 0) {
      return matches;
    }

    // IMPORTANT: Use deterministic pattern matching instead of LLM to prevent hallucinations
    // Only use LLM for non-factual correlation when absolutely necessary
    
    const query = userInput.toLowerCase();
    
    // Enhanced deterministic pattern matching for intent correlation
    const intentPatterns = {
      // Personal information patterns
      personal_info: {
        patterns: [
          /what.*my.*name/i,
          /who.*am.*i/i,
          /tell.*me.*about.*myself/i,
          /my.*information/i,
          /what.*am.*i.*called/i,
          /my.*identity/i
        ],
        memoryKeyPatterns: ['name', 'identity', 'full_name', 'first_name', 'last_name']
      },
      
      // Preferences patterns
      preferences: {
        patterns: [
          /what.*do.*i.*like/i,
          /what.*my.*favorite/i,
          /what.*do.*i.*prefer/i,
          /tell.*me.*what.*i.*enjoy/i,
          /what.*color.*do.*i.*like/i,
          /favorite.*color/i,
          /preferred.*color/i
        ],
        memoryKeyPatterns: ['favorite', 'prefer', 'like', 'color', 'food', 'movie', 'music', 'book']
      },
      
      // Appointments patterns
      appointments: {
        patterns: [
          /when.*my.*appointment/i,
          /do.*i.*have.*appointment/i,
          /what.*scheduled/i,
          /next.*meeting/i,
          /upcoming.*event/i,
          /haircut.*appointment/i,
          /when.*is.*my.*haircut/i,
          /appointment.*next.*week/i
        ],
        memoryKeyPatterns: ['appointment', 'meeting', 'schedule', 'haircut', 'event']
      },
      
      // Contact information patterns
      contact: {
        patterns: [
          /phone.*number/i,
          /contact.*information/i,
          /how.*to.*reach/i,
          /call.*me/i,
          /mother.*phone/i,
          /mom.*phone/i,
          /father.*phone/i,
          /dad.*phone/i
        ],
        memoryKeyPatterns: ['phone', 'contact', 'mobile', 'cell', 'mother', 'father', 'mom', 'dad']
      }
    };

    // Find matches using deterministic pattern matching
    for (const [category, config] of Object.entries(intentPatterns)) {
      let categoryMatched = false;
      
      // Check if user input matches any pattern for this category
      for (const pattern of config.patterns) {
        if (pattern.test(userInput)) {
          categoryMatched = true;
          break;
        }
      }
      
      if (categoryMatched) {
        // Find memories that match this category's key patterns
        for (const [memoryKey, memoryValue] of Object.entries(userMemories)) {
          let relevanceScore = 0;
          
          // Check if memory key contains any of the category's key patterns
          for (const keyPattern of config.memoryKeyPatterns) {
            if (memoryKey.toLowerCase().includes(keyPattern.toLowerCase())) {
              relevanceScore = 0.9; // High confidence for deterministic matches
              break;
            }
          }
          
          // Additional specific matching for exact queries
          if (category === 'preferences' && query.includes('color') && memoryKey.includes('color')) {
            relevanceScore = 0.95;
          }
          
          if (category === 'appointments' && memoryKey.includes('appointment')) {
            relevanceScore = 0.95;
          }
          
          if (relevanceScore > 0.8) {
            matches.push({
              key: memoryKey,
              value: memoryValue,
              score: relevanceScore,
              matchType: "deterministic_correlation",
              category: category,
              explanation: `Deterministic match for ${category} query`
            });
          }
        }
        
        // If we found matches for this category, don't check other categories
        if (matches.length > 0) {
          break;
        }
      }
    }
    
    console.log(`🎯 Deterministic correlation found ${matches.length} relevant memories`);
    
    // Only use LLM correlation as a last resort for non-factual queries
    if (matches.length === 0 && this.shouldUseLLMCorrelation(userInput)) {
      console.log("🤖 Using LLM correlation as fallback for non-factual query...");
      return await this.performLLMCorrelationFallback(userInput, userMemories);
    }

    return matches;
  }

  /**
   * Determine if LLM correlation should be used for this query
   * @param {string} userInput - The user's query
   * @returns {boolean} Whether to use LLM correlation
   */
  shouldUseLLMCorrelation(userInput) {
    const query = userInput.toLowerCase();
    
    // Avoid LLM correlation for factual queries that could lead to hallucinations
    const factualPatterns = [
      /when.*is.*my/i,
      /what.*time/i,
      /what.*date/i,
      /phone.*number/i,
      /appointment.*at/i,
      /scheduled.*for/i,
      /meeting.*at/i
    ];
    
    for (const pattern of factualPatterns) {
      if (pattern.test(userInput)) {
        console.log("🚫 Avoiding LLM correlation for factual query to prevent hallucinations");
        return false;
      }
    }
    
    // Only use LLM for abstract or interpretive queries
    const abstractPatterns = [
      /how.*do.*i.*feel/i,
      /what.*do.*i.*think/i,
      /describe.*my/i,
      /tell.*me.*about/i,
      /what.*kind.*of/i
    ];
    
    for (const pattern of abstractPatterns) {
      if (pattern.test(userInput)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Perform LLM correlation as a fallback for non-factual queries
   * @param {string} userInput - The user's query
   * @param {Object} userMemories - All stored user memories
   * @returns {Promise<Array>} Array of correlated memory matches
   */
  async performLLMCorrelationFallback(userInput, userMemories) {
    const matches = [];
    
    try {
      const memoryKeys = Object.keys(userMemories);
      const memoryContext = memoryKeys.slice(0, 10).map(key => `${key}: ${userMemories[key]}`).join('\n');
      
      const correlationPrompt = `Analyze the user query and determine which stored memories might be relevant for context.

User Query: "${userInput}"

Available Memories (first 10):
${memoryContext}

IMPORTANT: Only return exact matches. Do NOT fabricate or modify any memory values.
Return JSON format:
{
  "matches": [
    {
      "key": "exact_memory_key",
      "relevance_score": 0.8,
      "explanation": "why this memory provides context"
    }
  ]
}

Only include memories with relevance score > 0.7. If no memories provide relevant context, return empty matches array.`;

      if (this.queryLocalLLM) {
        const result = await this.queryLocalLLM.complete({
          prompt: correlationPrompt,
          max_tokens: 400,
          temperature: 0.1, // Very low temperature to reduce hallucinations
          stop: ["\n\n"]
        });

        if (result && result.text) {
          try {
            let cleanedText = result.text.trim();
            if (cleanedText.startsWith('```json')) {
              cleanedText = cleanedText.replace(/```json\s*/, '').replace(/```\s*$/, '');
            }
            
            const correlationResult = JSON.parse(cleanedText);
            
            if (correlationResult.matches && Array.isArray(correlationResult.matches)) {
              for (const match of correlationResult.matches) {
                // Strict validation: only include if the key exactly exists and score is high
                if (match.key && userMemories[match.key] && match.relevance_score > 0.7) {
                  matches.push({
                    key: match.key,
                    value: userMemories[match.key], // Use exact stored value
                    score: match.relevance_score,
                    matchType: "llm_correlation_fallback",
                    explanation: match.explanation || "LLM contextual correlation"
                  });
                }
              }
            }
            
            console.log(`🤖 LLM fallback correlation found ${matches.length} contextual memories`);
          } catch (parseError) {
            console.error("❌ Failed to parse LLM fallback correlation result:", parseError);
          }
        }
      }
    } catch (error) {
      console.error("❌ LLM fallback correlation failed:", error);
    }
    
    return matches;
  }

  /**
   * Perform hybrid semantic memory search combining lexical, fuzzy, and embedding-based matching
   * @param {string} userInput - The user's query
   * @param {Object} userMemories - All stored user memories
   * @returns {Promise<Array>} Array of matched memory objects with scores
   */
  async performSemanticMemorySearch(userInput, userMemories) {
    console.log("🔍 Performing enhanced hybrid semantic memory search...");

    const query = userInput.toLowerCase();
    const matches = [];

    // Phase 1: Enhanced semantic mapping patterns with intent correlation
    const semanticMappings = {
      // Color-related queries with variations
      "favorite color": ["favorite_color", "color", "preferred_color"],
      "what color": ["favorite_color", "color", "preferred_color"],
      "color preference": ["favorite_color", "color", "preferred_color"],
      "what's my favorite color": ["favorite_color", "color", "preferred_color"],
      "which color do i like": ["favorite_color", "color", "preferred_color"],
      "my color": ["favorite_color", "color", "preferred_color"],

      // Appointment/calendar-related queries with expanded patterns
      "calendar date": ["appointment", "meeting", "schedule", "event"],
      appointment: ["appointment", "meeting", "schedule", "event"],
      schedule: ["appointment", "meeting", "schedule", "event"],
      meeting: ["appointment", "meeting", "schedule", "event"],
      "did i set": ["appointment", "meeting", "schedule", "event"],
      "when is": ["appointment", "meeting", "schedule", "event"],
      "do i have": ["appointment", "meeting", "schedule", "event"],
      "what's scheduled": ["appointment", "meeting", "schedule", "event"],
      "next appointment": ["appointment", "meeting", "schedule", "event"],
      "upcoming": ["appointment", "meeting", "schedule", "event"],
      haircut: ["appointment_haircut", "haircut", "hair_appointment"],
      "hair appointment": ["appointment_haircut", "haircut", "hair_appointment"],
      doctor: ["doctor_appointment", "medical_appointment", "appointment"],
      dentist: ["dentist_appointment", "dental_appointment", "appointment"],

      // Personal information with expanded patterns
      name: ["name", "my_name", "full_name", "first_name", "last_name"],
      "what's my name": ["name", "my_name", "full_name"],
      "who am i": ["name", "my_name", "full_name", "identity"],
      "my name is": ["name", "my_name", "full_name"],
      "call me": ["name", "my_name", "nickname", "preferred_name"],

      // Contact information with expanded patterns
      phone: ["phone_number", "mobile", "cell", "contact_number"],
      "phone number": ["phone_number", "mobile", "cell", "contact_number"],
      mobile: ["phone_number", "mobile", "cell", "contact_number"],
      contact: ["phone_number", "mobile", "cell", "contact_number", "email", "address"],
      mother: ["mother_phone_number", "mom_phone", "mother_contact"],
      "mom's phone": ["mother_phone_number", "mom_phone", "mother_contact"],
      "mother's number": ["mother_phone_number", "mom_phone", "mother_contact"],
      father: ["father_phone_number", "dad_phone", "father_contact"],
      "dad's phone": ["father_phone_number", "dad_phone", "father_contact"],

      // Preferences and favorites with expanded patterns
      favorite: ["favorite", "preferred", "like", "love"],
      "what do i like": ["favorite", "preferred", "like", "love"],
      preference: ["favorite", "preferred", "preference"],
      food: ["favorite_food", "preferred_food", "food_preference"],
      "favorite food": ["favorite_food", "preferred_food", "food_preference"],
      movie: ["favorite_movie", "preferred_movie", "movie_preference"],
      "favorite movie": ["favorite_movie", "preferred_movie", "movie_preference"],
      music: ["favorite_music", "preferred_music", "music_preference"],
      "favorite song": ["favorite_song", "preferred_song", "music_preference"],
      book: ["favorite_book", "preferred_book", "book_preference"],

      // Work and professional information
      work: ["work", "job", "occupation", "profession", "career"],
      job: ["work", "job", "occupation", "profession", "career"],
      company: ["company", "employer", "workplace", "organization"],
      office: ["office", "workplace", "work_location"],

      // Location and address information
      address: ["address", "home_address", "location", "where_i_live"],
      "where do i live": ["address", "home_address", "location"],
      home: ["address", "home_address", "home_location"],
      city: ["city", "location", "hometown"],

      // Health and medical information
      health: ["health", "medical", "condition", "allergy"],
      medical: ["health", "medical", "condition", "doctor"],
      allergy: ["allergy", "allergies", "allergic_to"],
      medication: ["medication", "medicine", "prescription"],

      // General reminder and note queries
      reminder: ["reminder", "note", "remember", "memo"],
      remember: ["reminder", "note", "remember", "memo"],
      note: ["reminder", "note", "remember", "memo"],
      "what did i": ["reminder", "note", "remember", "memo"],
      "did i remember": ["reminder", "note", "remember", "memo"],
    };

    // Check direct semantic mappings first (score: 1.0)
    for (const [queryPattern, memoryKeys] of Object.entries(semanticMappings)) {
      if (query.includes(queryPattern)) {
        for (const memoryKey of memoryKeys) {
          if (userMemories[memoryKey]) {
            matches.push({
              key: memoryKey,
              value: userMemories[memoryKey],
              score: 1.0,
              matchType: "semantic_direct",
              queryPattern,
            });
          }
        }
      }
    }

    // Phase 1.5: Advanced intent-memory correlation for partial matches
    if (matches.length === 0) {
      const correlationMatches = await this.performIntentMemoryCorrelation(userInput, userMemories);
      matches.push(...correlationMatches);
    }

    // Phase 2: Embedding-based semantic search (if model is ready)
    if (this.isEmbeddingModelReady && matches.length === 0) {
      console.log("🧠 Performing embedding-based semantic search...");

      try {
        // Generate embedding for the user query
        const queryEmbedding = await this.generateEmbedding(userInput);

        if (queryEmbedding) {
          // Compare query embedding with memory embeddings
          for (const [memoryKey, memoryValue] of Object.entries(userMemories)) {
            // Create searchable text from memory key and value
            const memoryText = `${memoryKey.replace(/_/g, " ")} ${memoryValue}`;
            const memoryEmbedding = await this.generateEmbedding(memoryText);

            if (memoryEmbedding) {
              const similarity = this.calculateCosineSimilarity(
                queryEmbedding,
                memoryEmbedding,
              );

              if (similarity >= this.config.semanticThreshold) {
                matches.push({
                  key: memoryKey,
                  value: memoryValue,
                  score: similarity,
                  matchType: "embedding_semantic",
                  similarity,
                  memoryText,
                });
              }
            }
          }

          console.log(`🎯 Found ${matches.length} embedding-based matches`);
        }
      } catch (error) {
        console.error("❌ Embedding-based search failed:", error);
      }
    }

    // Phase 3: Enhanced fuzzy matching (fallback if no semantic matches)
    if (matches.length === 0) {
      console.log("🔤 Performing enhanced fuzzy matching...");

      for (const [memoryKey, memoryValue] of Object.entries(userMemories)) {
        const keyScore = this.calculateFuzzyScore(query, memoryKey);
        const valueScore = this.calculateFuzzyScore(query, String(memoryValue));
        const bestScore = Math.max(keyScore, valueScore);

        if (bestScore > 0.3) {
          // Threshold for fuzzy matching
          matches.push({
            key: memoryKey,
            value: memoryValue,
            score: bestScore,
            matchType: "fuzzy",
            keyScore,
            valueScore,
          });
        }
      }
    }

    // Phase 4: Combine and rank all matches
    const rankedMatches = this.rankHybridMatches(matches);

    console.log(
      `🎯 Hybrid search found ${rankedMatches.length} total matches:`,
      rankedMatches,
    );
    return rankedMatches;
  }

  /**
   * Rank and combine hybrid search matches with weighted scoring
   * @param {Array} matches - Array of matches from different search methods
   * @returns {Array} Ranked and deduplicated matches
   */
  rankHybridMatches(matches) {
    // Remove duplicates (same memory key)
    const uniqueMatches = new Map();

    for (const match of matches) {
      const key = match.key;

      if (
        !uniqueMatches.has(key) ||
        uniqueMatches.get(key).score < match.score
      ) {
        // Apply match type weighting
        let weightedScore = match.score;

        switch (match.matchType) {
          case "semantic_direct":
            weightedScore = match.score * 1.0; // Highest priority
            break;
          case "embedding_semantic":
            weightedScore = match.score * 0.95; // High priority for semantic similarity
            break;
          case "fuzzy":
            weightedScore = match.score * 0.8; // Lower priority for fuzzy matches
            break;
        }

        uniqueMatches.set(key, {
          ...match,
          weightedScore,
        });
      }
    }

    // Convert to array and sort by weighted score
    const rankedMatches = Array.from(uniqueMatches.values()).sort(
      (a, b) => b.weightedScore - a.weightedScore,
    );

    return rankedMatches;
  }

  /**
   * Calculate fuzzy matching score between query and target
   * @param {string} query - User query
   * @param {string} target - Memory key or value
   * @returns {number} Score between 0 and 1
   */
  calculateFuzzyScore(query, target) {
    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();

    // Exact match
    if (queryLower === targetLower) return 1.0;

    // Contains match
    if (queryLower.includes(targetLower) || targetLower.includes(queryLower)) {
      return 0.8;
    }

    // Word overlap
    const queryWords = queryLower.split(/\s+/);
    const targetWords = targetLower.split(/[_\s]+/);

    let overlapCount = 0;
    for (const queryWord of queryWords) {
      for (const targetWord of targetWords) {
        if (queryWord.includes(targetWord) || targetWord.includes(queryWord)) {
          overlapCount++;
          break;
        }
      }
    }

    const overlapScore =
      overlapCount / Math.max(queryWords.length, targetWords.length);
    return overlapScore > 0.5 ? 0.6 : overlapScore * 0.4;
  }

  /**
   * Generate deterministic contextual response based on memory matches and user query
   * @param {Array} memoryMatches - Array of matched memory objects
   * @param {string} userInput - Original user query
   * @returns {string} Contextual response
   */
  generateContextualMemoryResponse(memoryMatches, userInput) {
    if (!memoryMatches || memoryMatches.length === 0) {
      return "I don't have any relevant information stored about that.";
    }

    const query = userInput.toLowerCase();
    const bestMatch = memoryMatches[0]; // Highest scored match
    
    // IMPORTANT: Use exact stored values only - no LLM generation to prevent hallucinations
    const memoryKey = bestMatch.key.toLowerCase();
    const memoryValue = bestMatch.value; // Use exact stored value
    const matchType = bestMatch.matchType || 'unknown';
    
    // Deterministic response templates based on memory type and query intent
    let responseTemplate = "";
    
    // Personal information responses
    if (memoryKey.includes('name') || memoryKey.includes('identity')) {
      if (query.includes('who am i') || query.includes('what am i called')) {
        responseTemplate = `You are ${memoryValue}.`;
      } else if (query.includes('my name')) {
        responseTemplate = `Your name is ${memoryValue}.`;
      } else {
        responseTemplate = `Your name: ${memoryValue}.`;
      }
    }
    
    // Preference responses (favorite color, etc.) - use exact values
    else if (memoryKey.includes('favorite') || memoryKey.includes('color') || memoryKey.includes('prefer')) {
      if (memoryKey.includes('color')) {
        if (query.includes('what color') || query.includes('favorite color')) {
          responseTemplate = `Your favorite color is ${memoryValue}.`;
        } else {
          responseTemplate = `Color preference: ${memoryValue}.`;
        }
      } else if (memoryKey.includes('favorite')) {
        const preferenceType = memoryKey.replace('favorite_', '').replace('_', ' ');
        responseTemplate = `Your favorite ${preferenceType}: ${memoryValue}.`;
      } else {
        responseTemplate = `Preference: ${memoryValue}.`;
      }
    }
    
    // Appointment and scheduling responses - use exact stored information
    else if (memoryKey.includes('appointment') || memoryKey.includes('meeting') || memoryKey.includes('schedule')) {
      if (query.includes('do i have') || query.includes('any appointment')) {
        responseTemplate = `Yes, you have: ${memoryValue}.`;
      } else if (query.includes('when is') || query.includes('what time')) {
        responseTemplate = `${memoryValue}.`; // Use exact appointment details
      } else {
        responseTemplate = `Appointment: ${memoryValue}.`;
      }
    }
    
    // Contact information responses - exact values only
    else if (memoryKey.includes('phone') || memoryKey.includes('contact') || memoryKey.includes('mobile')) {
      if (memoryKey.includes('mother') || memoryKey.includes('mom')) {
        responseTemplate = `Mother's phone: ${memoryValue}.`;
      } else if (memoryKey.includes('father') || memoryKey.includes('dad')) {
        responseTemplate = `Father's phone: ${memoryValue}.`;
      } else {
        responseTemplate = `Phone: ${memoryValue}.`;
      }
    }
    
    // Work and professional information
    else if (memoryKey.includes('work') || memoryKey.includes('job') || memoryKey.includes('company')) {
      responseTemplate = `Work: ${memoryValue}.`;
    }
    
    // Location and address information
    else if (memoryKey.includes('address') || memoryKey.includes('location') || memoryKey.includes('home')) {
      responseTemplate = `Location: ${memoryValue}.`;
    }
    
    // Health and medical information
    else if (memoryKey.includes('health') || memoryKey.includes('medical') || memoryKey.includes('allergy')) {
      responseTemplate = `Health info: ${memoryValue}.`;
    }
    
    // Reminder and note information
    else if (memoryKey.includes('reminder') || memoryKey.includes('note') || memoryKey.includes('remember')) {
      responseTemplate = `Note: ${memoryValue}.`;
    }
    
    // Default response for unclassified memories - exact value only
    else {
      responseTemplate = `${memoryKey.replace(/_/g, ' ')}: ${memoryValue}.`;
    }
    
    // Add match confidence indicator for transparency
    let confidenceInfo = "";
    if (bestMatch.score && bestMatch.score >= 0.9) {
      confidenceInfo = " (high confidence match)";
    } else if (bestMatch.score && bestMatch.score >= 0.7) {
      confidenceInfo = " (good match)";
    }
    
    // Handle multiple exact matches - show additional relevant information
    if (memoryMatches.length > 1) {
      const additionalMatches = memoryMatches.slice(1, 2); // Show 1 additional match
      const additionalInfo = additionalMatches.map(match => {
        if (match.key !== bestMatch.key && match.score >= 0.8) {
          return `Also: ${match.key.replace(/_/g, ' ')} - ${match.value}`;
        }
        return null;
      }).filter(Boolean);
      
      if (additionalInfo.length > 0) {
        confidenceInfo += `. ${additionalInfo.join('. ')}`;
      }
    }
    
    return responseTemplate + confidenceInfo;
  }

  /**
   * Format orchestration response from backend API
   */
  formatOrchestrationResponse(orchestrationData) {
    if (!orchestrationData) {
      return "I've processed your request, but didn't receive detailed results from the orchestration service.";
    }

    const { agents = [], workflow = {}, processingTime = 0 } = orchestrationData;
    const agentCount = agents.length;
    const stepCount = workflow.steps?.length || 0;

    let response = "✅ I've successfully orchestrated your request! ";

    if (agentCount > 0) {
      response += `I've prepared ${agentCount} specialized agent${agentCount > 1 ? 's' : ''} `;
      if (stepCount > 0) {
        response += `to execute ${stepCount} step${stepCount > 1 ? 's' : ''} `;
      }
      response += "to handle your task. ";
    }

    if (orchestrationData.userContext?.appliedMemories?.length > 0) {
      response += "I've also incorporated your personal preferences and context. ";
    }

    if (processingTime > 0) {
      response += `Processing completed in ${processingTime}ms.`;
    }

    // Add brief description of what will happen
    if (workflow.steps && workflow.steps.length > 0) {
      response += "\n\nHere's what I'll do:\n";
      workflow.steps.slice(0, 3).forEach((step, index) => {
        response += `${index + 1}. ${step.action || 'Execute'} using ${step.agent || 'specialized agent'}\n`;
      });
      
      if (workflow.steps.length > 3) {
        response += `... and ${workflow.steps.length - 3} more steps.`;
      }
    }

    return response;
  }

  /**
   * Format clarification response from backend API
   */
  formatClarificationResponse(questions) {
    if (!questions || questions.length === 0) {
      return "I need some clarification to proceed with your request, but didn't receive specific questions.";
    }

    let response = "I'd be happy to help with that! I need a bit more information to give you the best solution:\n\n";
    
    questions.forEach((question, index) => {
      response += `${index + 1}. ${question}\n`;
    });

    response += "\nOnce you provide these details, I can create a complete orchestration plan for you!";
    
    return response;
  }
  // Orchestration workflow management methods for frontend integration
  async orchestrateWorkflow(userInput, context = {}) {
    try {
      console.log('🎯 Starting orchestration workflow for:', userInput);
      
      // Use existing handleLocalOrchestration method to process the request
      const result = await this.handleLocalOrchestration(userInput, context);
      
      // Create a workflow object that matches the frontend expectations
      const workflow = {
        id: `workflow_${Date.now()}`,
        status: 'running',
        userInput: userInput,
        intent: result.intent || 'agent_orchestrate',
        steps: this.convertToWorkflowSteps(result),
        startTime: new Date().toISOString(),
        context: context
      };
      
      // Store workflow in memory for status tracking
      this.activeWorkflows = this.activeWorkflows || new Map();
      this.activeWorkflows.set(workflow.id, workflow);
      
      console.log('✅ Orchestration workflow created:', workflow.id);
      return workflow;
    } catch (error) {
      console.error('❌ Error creating orchestration workflow:', error);
      throw error;
    }
  }
  
  async getWorkflowStatus(workflowId) {
    try {
      if (!this.activeWorkflows || !this.activeWorkflows.has(workflowId)) {
        return {
          id: workflowId,
          status: 'not_found',
          error: 'Workflow not found'
        };
      }
      
      const workflow = this.activeWorkflows.get(workflowId);
      return {
        ...workflow,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Error getting workflow status:', error);
      throw error;
    }
  }
  
  async pauseWorkflow(workflowId) {
    try {
      if (!this.activeWorkflows || !this.activeWorkflows.has(workflowId)) {
        throw new Error('Workflow not found');
      }
      
      const workflow = this.activeWorkflows.get(workflowId);
      workflow.status = 'paused';
      workflow.pausedAt = new Date().toISOString();
      
      this.activeWorkflows.set(workflowId, workflow);
      
      console.log('⏸️ Workflow paused:', workflowId);
      return { success: true, workflowId, status: 'paused' };
    } catch (error) {
      console.error('❌ Error pausing workflow:', error);
      throw error;
    }
  }
  
  async resumeWorkflow(workflowId) {
    try {
      if (!this.activeWorkflows || !this.activeWorkflows.has(workflowId)) {
        throw new Error('Workflow not found');
      }
      
      const workflow = this.activeWorkflows.get(workflowId);
      workflow.status = 'running';
      workflow.resumedAt = new Date().toISOString();
      delete workflow.pausedAt;
      
      this.activeWorkflows.set(workflowId, workflow);
      
      console.log('▶️ Workflow resumed:', workflowId);
      return { success: true, workflowId, status: 'running' };
    } catch (error) {
      console.error('❌ Error resuming workflow:', error);
      throw error;
    }
  }
  
  // Emit orchestration updates to frontend UI via IPC
  async emitOrchestrationUpdate(updateData) {
    try {
      // Import BrowserWindow to get all windows using dynamic import
      const { BrowserWindow } = await import('electron');
      const allWindows = BrowserWindow.getAllWindows();
      
      // Manage orchestration protection flag to prevent insight window hiding
      if (updateData.type === 'workflow_started') {
        // Set global orchestration flag to protect insight window
        global.isOrchestrationActive = true;
        console.log('🛡️ Orchestration started - protecting insight window from hiding');
      } else if (updateData.type === 'workflow_completed' || updateData.type === 'workflow_failed') {
        // Clear global orchestration flag
        global.isOrchestrationActive = false;
        console.log('✅ Orchestration ended - insight window protection cleared');
      }
      
      // Send to renderer processes with different channels based on window type
      allWindows.forEach(window => {
        if (window && !window.isDestroyed()) {
          // Get the window's URL to determine its type
          const windowUrl = window.webContents.getURL();
          console.log('🔍 DEBUG: Checking window URL:', windowUrl);
          
          // Send to insight window via separate channel to prevent disappearance
          // Check for multiple possible insight window URL patterns
          const isInsightWindow = windowUrl.includes('mode=insight') || 
                                 windowUrl.includes('insight') ||
                                 windowUrl.includes('InsightWindow') ||
                                 window.getTitle?.()?.includes('Insight') ||
                                 window.webContents.getTitle?.()?.includes('Insight');
          
          if (isInsightWindow) {
            console.log('📱 FOUND INSIGHT WINDOW! Sending orchestration update via safe channel');
            console.log('📱 Window URL:', windowUrl);
            console.log('📱 Window Title:', window.getTitle?.() || 'No title');
            window.webContents.send('insight-orchestration-update', updateData);
            return;
          }
          
          // Send to other windows (overlay, chat, messages, memory debugger) via normal channel
          console.log('📱 Sending to non-insight window:', windowUrl);
          window.webContents.send('orchestration-update', updateData);
        }
      });
      
      console.log('📡 Emitted orchestration update:', updateData.type, updateData.workflowId);
    } catch (error) {
      console.error('❌ Error emitting orchestration update:', error);
    }
  }
  
  // Helper method to convert orchestration results to workflow steps format
  convertToWorkflowSteps(orchestrationResult) {
    const steps = [];
    
    // If we have a workflow with steps from PlannerAgent
    if (orchestrationResult.data && orchestrationResult.data.workflow && orchestrationResult.data.workflow.steps) {
      return orchestrationResult.data.workflow.steps.map((step, index) => ({
        id: `step_${index + 1}`,
        agent: step.agent || 'LocalLLMAgent',
        action: step.action || step.description || 'Process request',
        status: index === 0 ? 'running' : 'pending',
        startTime: index === 0 ? new Date().toISOString() : undefined,
        metadata: step.metadata || {}
      }));
    }
    
    // Fallback: create a single step for simple orchestration
    steps.push({
      id: 'step_1',
      agent: 'LocalLLMAgent',
      action: 'Process user request',
      status: 'running',
      startTime: new Date().toISOString(),
      metadata: {
        intent: orchestrationResult.intent,
        complexity: orchestrationResult.complexity
      }
    });
    
    return steps;
  }
}

export default LocalLLMAgent;
