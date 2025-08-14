/**
 * ModelCache - Singleton pattern for expensive model initializations
 * Eliminates redundant model loading during semantic search operations
 * Target: Reduce 8+ seconds of model init to <50ms cache hits
 */

class ModelCache {
  constructor() {
    // Model instances
    this.distilbertParser = null;
    this.nerClassifier = null;
    this.phi3Agent = null;
    this.semanticEmbedder = null;
    
    // Initialization promises to prevent race conditions
    this.distilbertPromise = null;
    this.nerPromise = null;
    this.phi3Promise = null;
    this.embedderPromise = null;
    
    // Performance tracking
    this.initTimes = {};
    this.hitCount = 0;
    this.missCount = 0;
    
    // AgentOrchestrator reference for proper agent initialization
    this.agentOrchestrator = null;
  }

  /**
   * Set the AgentOrchestrator reference for proper agent initialization
   * @param {Object} orchestrator - AgentOrchestrator instance
   */
  setAgentOrchestrator(orchestrator) {
    this.agentOrchestrator = orchestrator;
    console.log('[CACHE] AgentOrchestrator reference set for model initialization');
  }

  /**
   * Get or initialize DistilBERT Intent Parser
   * @returns {Promise<Object>} DistilBERT parser instance
   */
  async getDistilBERT() {
    const startTime = Date.now();
    
    if (this.distilbertParser) {
      this.hitCount++;
      console.log(`[CACHE-HIT] DistilBERT retrieved in ${Date.now() - startTime}ms`);
      return this.distilbertParser;
    }

    if (this.distilbertPromise) {
      console.log('[CACHE-WAIT] DistilBERT initialization in progress...');
      return await this.distilbertPromise;
    }

    console.log('[CACHE-MISS] Initializing DistilBERT (first time)...');
    this.missCount++;
    
    this.distilbertPromise = this._initializeDistilBERT();
    this.distilbertParser = await this.distilbertPromise;
    this.initTimes.distilbert = Date.now() - startTime;
    
    console.log(`[CACHE-INIT] DistilBERT initialized in ${this.initTimes.distilbert}ms`);
    return this.distilbertParser;
  }

  /**
   * Get or initialize NER Classifier
   * @returns {Promise<Object>} NER classifier instance
   */
  async getNER() {
    const startTime = Date.now();
    
    if (this.nerClassifier) {
      this.hitCount++;
      console.log(`[CACHE-HIT] NER retrieved in ${Date.now() - startTime}ms`);
      return this.nerClassifier;
    }

    if (this.nerPromise) {
      console.log('[CACHE-WAIT] NER initialization in progress...');
      return await this.nerPromise;
    }

    console.log('[CACHE-MISS] Initializing NER (first time)...');
    this.missCount++;
    
    this.nerPromise = this._initializeNER();
    this.nerClassifier = await this.nerPromise;
    this.initTimes.ner = Date.now() - startTime;
    
    console.log(`[CACHE-INIT] NER initialized in ${this.initTimes.ner}ms`);
    return this.nerClassifier;
  }

  /**
   * Get or initialize Phi3 Agent
   * @returns {Promise<Object>} Phi3 agent instance
   */
  async getPhi3() {
    const startTime = Date.now();
    
    if (this.phi3Agent) {
      this.hitCount++;
      console.log(`[CACHE-HIT] Phi3 retrieved in ${Date.now() - startTime}ms`);
      return this.phi3Agent;
    }

    if (this.phi3Promise) {
      console.log('[CACHE-WAIT] Phi3 initialization in progress...');
      return await this.phi3Promise;
    }

    console.log('[CACHE-MISS] Initializing Phi3 (first time)...');
    this.missCount++;
    
    this.phi3Promise = this._initializePhi3();
    this.phi3Agent = await this.phi3Promise;
    this.initTimes.phi3 = Date.now() - startTime;
    
    console.log(`[CACHE-INIT] Phi3 initialized in ${this.initTimes.phi3}ms`);
    return this.phi3Agent;
  }

  /**
   * Get or initialize Semantic Embedder
   * @returns {Promise<Object>} Semantic embedder instance
   */
  async getSemanticEmbedder() {
    const startTime = Date.now();
    
    if (this.semanticEmbedder) {
      this.hitCount++;
      console.log(`[CACHE-HIT] SemanticEmbedder retrieved in ${Date.now() - startTime}ms`);
      return this.semanticEmbedder;
    }

    if (this.embedderPromise) {
      console.log('[CACHE-WAIT] SemanticEmbedder initialization in progress...');
      return await this.embedderPromise;
    }

    console.log('[CACHE-MISS] Initializing SemanticEmbedder (first time)...');
    this.missCount++;
    
    this.embedderPromise = this._initializeSemanticEmbedder();
    this.semanticEmbedder = await this.embedderPromise;
    this.initTimes.embedder = Date.now() - startTime;
    
    console.log(`[CACHE-INIT] SemanticEmbedder initialized in ${this.initTimes.embedder}ms`);
    return this.semanticEmbedder;
  }

  /**
   * Private method to initialize DistilBERT
   */
  async _initializeDistilBERT() {
    try {
      // Try to initialize DistilBERT directly
      console.log('[CACHE] Initializing DistilBERT parser...');
      const DistilBertIntentParser = require('./utils/DistilBertIntentParser.cjs');
      const parser = new DistilBertIntentParser();
      await parser.initialize();
      console.log('[CACHE] DistilBERT initialized successfully');
      return parser;
      
    } catch (error) {
      console.warn('[CACHE] DistilBERT initialization failed:', error.message);
      console.log('[CACHE] DistilBERT will use fallback via AgentOrchestrator when needed');
      return null;
    }
  }

  /**
   * Private method to initialize NER
   */
  async _initializeNER() {
    // Import NER initialization logic
    // This would need to be extracted from the current initialization code
    const { pipeline } = require('@huggingface/transformers');
    
    const classifier = await pipeline('ner', 'bert-base-NER', {
      aggregation_strategy: 'simple'
    });
    
    return classifier;
  }

  /**
   * Private method to initialize Phi3
   */
  async _initializePhi3() {
    if (!this.agentOrchestrator) {
      console.error('[CACHE] AgentOrchestrator not available - cannot initialize Phi3');
      return null;
    }

    try {
      console.log('[CACHE] Initializing Phi3 via AgentOrchestrator...');
      
      // Get the agent instance from AgentOrchestrator's loaded agents
      const agentInstance = this.agentOrchestrator.loadedAgents.get('Phi3Agent');
      if (agentInstance) {
        console.log('[CACHE] Using existing Phi3Agent instance from AgentOrchestrator');
        return agentInstance;
      }
      
      // If not loaded, trigger agent loading through orchestrator
      const response = await this.agentOrchestrator.executeAgent('Phi3Agent', {
        action: 'bootstrap'
      });
      
      if (response.success) {
        const loadedAgent = this.agentOrchestrator.loadedAgents.get('Phi3Agent');
        if (loadedAgent) {
          console.log('[CACHE] Phi3 initialized successfully via AgentOrchestrator');
          return loadedAgent;
        }
      }
      
      console.error('[CACHE] Failed to initialize Phi3 via AgentOrchestrator');
      return null;
      
    } catch (error) {
      console.error('[CACHE] Phi3 initialization failed:', error.message);
      return null;
    }
  }

  /**
   * Private method to initialize Semantic Embedder
   */
  async _initializeSemanticEmbedder() {
    if (!this.agentOrchestrator) {
      console.error('[CACHE] AgentOrchestrator not available - cannot initialize SemanticEmbedder');
      return null;
    }

    try {
      console.log('[CACHE] Initializing SemanticEmbedder via AgentOrchestrator...');
      
      // Get the agent instance from AgentOrchestrator's loaded agents
      const agentInstance = this.agentOrchestrator.loadedAgents.get('SemanticEmbeddingAgent');
      if (agentInstance) {
        console.log('[CACHE] Using existing SemanticEmbeddingAgent instance from AgentOrchestrator');
        return agentInstance;
      }
      
      // If not loaded, trigger agent loading through orchestrator
      const response = await this.agentOrchestrator.executeAgent('SemanticEmbeddingAgent', {
        action: 'bootstrap'
      });
      
      if (response.success) {
        const loadedAgent = this.agentOrchestrator.loadedAgents.get('SemanticEmbeddingAgent');
        if (loadedAgent) {
          console.log('[CACHE] SemanticEmbedder initialized successfully via AgentOrchestrator');
          return loadedAgent;
        }
      }
      
      console.error('[CACHE] Failed to initialize SemanticEmbedder via AgentOrchestrator');
      return null;
      
    } catch (error) {
      console.error('[CACHE] SemanticEmbedder initialization failed:', error.message);
      return null;
    }
  }

  /**
   * Warm up all models in background (optional optimization)
   */
  async warmUpModels() {
    console.log('[WARMUP] Starting background model initialization...');
    const startTime = Date.now();
    
    try {
      await Promise.all([
        this.getDistilBERT(),
        this.getNER(),
        this.getPhi3(),
        this.getSemanticEmbedder()
      ]);
      
      const totalTime = Date.now() - startTime;
      console.log(`[WARMUP] All models ready in ${totalTime}ms`);
    } catch (error) {
      console.error('[WARMUP] Model warmup failed:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: this.hitCount / (this.hitCount + this.missCount),
      initTimes: this.initTimes,
      modelsLoaded: {
        distilbert: !!this.distilbertParser,
        ner: !!this.nerClassifier,
        phi3: !!this.phi3Agent,
        embedder: !!this.semanticEmbedder
      }
    };
  }

  /**
   * Clear cache (for testing/debugging)
   */
  clearCache() {
    console.log('[CACHE] Clearing all cached models...');
    this.distilbertParser = null;
    this.nerClassifier = null;
    this.phi3Agent = null;
    this.semanticEmbedder = null;
    
    this.distilbertPromise = null;
    this.nerPromise = null;
    this.phi3Promise = null;
    this.embedderPromise = null;
    
    this.hitCount = 0;
    this.missCount = 0;
    this.initTimes = {};
  }
}

// Export singleton instance
const modelCache = new ModelCache();

module.exports = {
  ModelCache,
  modelCache
};
