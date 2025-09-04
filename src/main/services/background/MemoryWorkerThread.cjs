/**
 * Memory Worker Thread - Actual processing implementation
 * Runs in separate thread to avoid blocking main process
 */

const { parentPort, workerData } = require('worker_threads');
const path = require('path');

class MemoryProcessor {
  constructor(config) {
    this.config = config;
    this.workerId = Math.random().toString(36).substr(2, 9);
    this.initialized = false;
    
    // Initialize components asynchronously
    this.initializeComponents();
  }

  async initializeComponents() {
    try {
      const DistilBertIntentParserClass = require('../utils/DistilBertIntentParser.cjs');
      
      // Initialize DistilBert parser instance
      this.DistilBertIntentParser = new DistilBertIntentParserClass();
      await this.DistilBertIntentParser.initialize();
      
      // Initialize the memory processor
      await this.initialize();
      
    } catch (error) {
      console.error(`[WORKER-${this.workerId}] Failed to initialize:`, error);
      this.initialized = false;
    }
  }

  /**
   * Initialize the memory processor
   */
  async initialize() {
    try {
      console.log(`[WORKER-${this.workerId}] *** UPDATED CODE *** Initializing memory processor (no database connection)...`);
      
      // Worker thread only handles processing, no database operations
      this.initialized = true;
      console.log(`[WORKER-${this.workerId}] *** UPDATED CODE *** Memory processor initialized and ready`);
      
    } catch (error) {
      console.error(`[WORKER-${this.workerId}] Failed to initialize:`, error);
      throw error;
    }
  }

  /**
   * Process a batch of conversation turns
   */
  async processBatch(batch) {
    const results = [];
    
    try {
      // Wait for initialization if not ready
      if (!this.initialized) {
        console.log(`[WORKER-${this.workerId}] Waiting for initialization...`);
        let attempts = 0;
        while (!this.initialized && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }
        
        if (!this.initialized) {
          throw new Error('Worker failed to initialize after 30 seconds');
        }
      }
      
      for (const turn of batch) {
        const result = await this.processTurn(turn);
        results.push(result);
      }
      
      return {
        type: 'batchComplete',
        success: true,
        results,
        workerId: this.workerId
      };
      
    } catch (error) {
      console.error(`[WORKER-${this.workerId}] Batch processing failed:`, error);
      return {
        type: 'batchComplete',
        success: false,
        error: error.message,
        workerId: this.workerId
      };
    }
  }

  /**
   * Process a single conversation turn
   */
  async processTurn(turn) {
    const { turnId, sessionId, userMessage, aiResponse, timestamp, pipeline } = turn;
    
    try {
      console.log(`[WORKER-${this.workerId}] Processing turn ${turnId}`);
      
      // Step 1: PII Masking
      const maskedUserMessage = this.config.piiMasking ? this.maskPII(userMessage) : userMessage;
      const maskedAiResponse = this.config.piiMasking ? this.maskPII(aiResponse) : aiResponse;
      
      // Step 2: Entity Extraction
      const userEntities = await this.extractEntities(maskedUserMessage);
      const aiEntities = await this.extractEntities(maskedAiResponse);
      
      // Step 3: Turn-level aggregation
      const turnEntities = this.aggregateEntities(userEntities, aiEntities);
      
      // Step 4: Generate embeddings
      const userEmbedding = await this.generateEmbedding(maskedUserMessage);
      const aiEmbedding = await this.generateEmbedding(maskedAiResponse);
      const turnEmbedding = await this.generateEmbedding(`${maskedUserMessage}\n${maskedAiResponse}`);
      
      // Step 5: Create turn summary
      const turnSummary = this.createTurnSummary(maskedUserMessage, maskedAiResponse, turnEntities);
      
      // Step 6: Process memory data (return to main process for storage)
      const memoryResult = await this.processMemoryData({
        turnId,
        sessionId,
        userMessage: maskedUserMessage,
        aiResponse: maskedAiResponse,
        userMessageRaw: this.config.keepRaw ? userMessage : null,
        aiResponseRaw: this.config.keepRaw ? aiResponse : null,
        userEntities,
        aiEntities,
        turnEntities,
        userEmbedding,
        aiEmbedding,
        turnEmbedding,
        turnSummary,
        timestamp,
        pipeline
      });
      
      return {
        turnId,
        success: true,
        entitiesCount: turnEntities.length,
        processingTime: Date.now() - turn.enqueuedAt,
        processedMemories: memoryResult.processedMemories
      };
      
    } catch (error) {
      console.error(`[WORKER-${this.workerId}] Failed to process turn ${turnId}:`, error);
      return {
        turnId,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mask PII in text
   */
  maskPII(text) {
    if (!text) return text;
    
    // Email addresses
    text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<EMAIL>');
    
    // Phone numbers (basic patterns)
    text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '<PHONE>');
    text = text.replace(/\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g, '<PHONE>');
    
    // URLs
    text = text.replace(/https?:\/\/[^\s]+/g, '<URL>');
    
    // Credit card numbers (basic pattern)
    text = text.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '<CARD>');
    
    // API keys and tokens (common patterns)
    text = text.replace(/\b[A-Za-z0-9]{32,}\b/g, '<TOKEN>');
    
    return text;
  }

  /**
   * Extract entities from text using DistilBERT parser
   */
  async extractEntities(text) {
    try {
      if (!this.DistilBertIntentParser) {
        return [];
      }
      
      const entityCategories = await this.DistilBertIntentParser.extractEntities(text);
      
      // Convert categorized entities to flat array format
      const entities = [];
      
      if (entityCategories) {
        Object.entries(entityCategories).forEach(([type, values]) => {
          if (Array.isArray(values)) {
            values.forEach(value => {
              entities.push({
                text: value,
                type: type.toUpperCase(),
                salience: 0.7 // Default salience for DistilBERT entities
              });
            });
          }
        });
      }
      
      return entities;
      
    } catch (error) {
      console.warn(`[WORKER-${this.workerId}] Entity extraction failed:`, error.message);
      return [];
    }
  }

  /**
   * Aggregate entities from user and AI messages
   */
  aggregateEntities(userEntities, aiEntities) {
    const entityMap = new Map();
    
    // Add user entities
    userEntities.forEach(entity => {
      const key = `${entity.text.toLowerCase()}_${entity.type}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          text: entity.text,
          type: entity.type,
          salience: entity.salience || 0.5,
          sources: ['user']
        });
      } else {
        const existing = entityMap.get(key);
        existing.salience = Math.max(existing.salience, entity.salience || 0.5);
        if (!existing.sources.includes('user')) {
          existing.sources.push('user');
        }
      }
    });
    
    // Add AI entities
    aiEntities.forEach(entity => {
      const key = `${entity.text.toLowerCase()}_${entity.type}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          text: entity.text,
          type: entity.type,
          salience: entity.salience || 0.3,
          sources: ['ai']
        });
      } else {
        const existing = entityMap.get(key);
        existing.salience = Math.max(existing.salience, entity.salience || 0.3);
        if (!existing.sources.includes('ai')) {
          existing.sources.push('ai');
        }
      }
    });
    
    // Convert to array and sort by salience
    return Array.from(entityMap.values())
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 20); // Keep top 20 entities per turn
  }

  /**
   * Generate embedding for text
   */
  async generateEmbedding(text) {
    try {
      // Use a simple hash-based embedding for now
      // In production, use actual embedding model like MiniLM-L6-v2
      const hash = this.simpleHash(text);
      const embedding = new Array(384).fill(0).map((_, i) => 
        Math.sin(hash * (i + 1)) * 0.1
      );
      
      return embedding;
      
    } catch (error) {
      console.warn(`[WORKER-${this.workerId}] Embedding generation failed:`, error.message);
      return new Array(384).fill(0);
    }
  }

  /**
   * Simple hash function for demo embedding
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Create turn summary
   */
  createTurnSummary(userMessage, aiResponse, entities) {
    const topEntities = entities.slice(0, 5).map(e => e.text).join(', ');
    
    const summary = {
      userIntent: this.extractIntent(userMessage),
      aiAction: this.extractAction(aiResponse),
      keyEntities: topEntities,
      turnType: this.classifyTurnType(userMessage, aiResponse),
      wordCount: (userMessage + ' ' + aiResponse).split(' ').length
    };
    
    return summary;
  }

  /**
   * Extract intent from user message
   */
  extractIntent(message) {
    const lowerMessage = message.toLowerCase();
    
    if (/^(what|how|why|when|where|who)/.test(lowerMessage)) {
      return 'question';
    } else if (/^(create|generate|build|make|write)/.test(lowerMessage)) {
      return 'command';
    } else if (/(remember|save|store|note)/.test(lowerMessage)) {
      return 'memory_store';
    } else if (/(find|search|retrieve|recall)/.test(lowerMessage)) {
      return 'memory_retrieve';
    } else {
      return 'general';
    }
  }

  /**
   * Extract action from AI response
   */
  extractAction(response) {
    if (response.length > 500) {
      return 'detailed_explanation';
    } else if (response.includes('```')) {
      return 'code_generation';
    } else if (/^(I've|I'll|Let me)/.test(response)) {
      return 'assistance';
    } else {
      return 'information';
    }
  }

  /**
   * Classify turn type
   */
  classifyTurnType(userMessage, aiResponse) {
    const userIntent = this.extractIntent(userMessage);
    const aiAction = this.extractAction(aiResponse);
    
    return `${userIntent}_${aiAction}`;
  }

  /**
   * Process memory data for main thread storage
   */
  async processMemoryData(data) {
    try {
      // Create a single, comprehensive memory entry per conversation turn
      const allEntities = [...(data.userEntities || []), ...(data.aiEntities || [])];
      
      // Extract entity text for display (entities are objects with text/type properties)
      const entityTexts = allEntities.map(entity => 
        typeof entity === 'object' && entity.text ? entity.text : String(entity)
      ).filter(text => text && text.trim());
      
      const processedMemories = [
        {
          key: `conversation_${data.turnId}`,
          value: entityTexts.length > 0 ? `Discussed: ${entityTexts.join(', ')}` : 'General conversation',
          sourceText: data.userMessage,
          suggestedResponse: data.aiResponse,
          metadata: {
            sessionId: data.sessionId,
            turnId: data.turnId,
            messageType: 'conversation',
            entities: entityTexts, // Store as text array for UI compatibility
            entityObjects: allEntities, // Store full objects for debugging
            userEntities: (data.userEntities || []).map(e => typeof e === 'object' && e.text ? e.text : String(e)),
            aiEntities: (data.aiEntities || []).map(e => typeof e === 'object' && e.text ? e.text : String(e)),
            timestamp: data.timestamp,
            pipeline: data.pipeline,
            turnSummary: data.turnSummary
          }
        }
      ];
      
      console.log(`[WORKER-${this.workerId}] Processed memory data for turn ${data.turnId}, sending to main process`);
      
      // Return processed data instead of storing directly
      return {
        success: true,
        processedMemories: processedMemories,
        turnId: data.turnId
      };
    } catch (error) {
      console.error(`[WORKER-${this.workerId}] Failed to process memory data:`, error);
      throw error;
    }
  }
}

// Worker thread message handling
if (parentPort) {
  const processor = new MemoryProcessor(workerData.config);
  
  parentPort.on('message', async (message) => {
    const { type, batch } = message;
    
    if (type === 'processBatch') {
      const result = await processor.processBatch(batch);
      parentPort.postMessage(result);
    }
  });
  
  console.log(`[WORKER-${processor.workerId}] Memory worker thread started`);
}

module.exports = MemoryProcessor;
