/**
 * SemanticEmbeddingAgent - Generates semantic embeddings for memory storage
 * Leverages existing embedding infrastructure from Phi3Agent
 * CommonJS format for VM compatibility
 */

const AGENT_FORMAT = {
  name: 'SemanticEmbeddingAgent',
  description: 'Generates semantic embeddings for text using @xenova/transformers for memory search',
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Embedding operation to perform',
        enum: [
          'generate-embedding',
          'batch-generate-embeddings',
          'calculate-similarity'
        ]
      },
      text: { type: 'string', description: 'Text to generate embedding for' },
      texts: { type: 'array', items: { type: 'string' }, description: 'Array of texts for batch embedding' },
      embedding1: { type: 'array', items: { type: 'number' }, description: 'First embedding for similarity calculation' },
      embedding2: { type: 'array', items: { type: 'number' }, description: 'Second embedding for similarity calculation' }
    },
    required: ['action']
  },
  dependencies: ['@xenova/transformers'],
  execution_target: 'frontend',
  requires_database: false,

  // Bootstrap method - skip embedder initialization, do it lazily during execute
  async bootstrap(config, context) {
    try {
      console.log('[INFO] SemanticEmbeddingAgent: Bootstrap completed (embedder will be initialized lazily)');
      
      // Don't initialize embedder here - do it lazily during execute
      this.isEmbeddingReady = false;
      
      return {
        success: true,
        message: 'SemanticEmbeddingAgent bootstrap completed (lazy initialization)',
        model: 'Xenova/all-MiniLM-L6-v2',
        dimensions: 384
      };
      
    } catch (error) {
      console.error('[ERROR] SemanticEmbeddingAgent bootstrap failed:', error);
      
      return {
        success: false,
        error: error.message,
        message: 'Failed to bootstrap SemanticEmbeddingAgent'
      };
    }
  },

  // Execute method for embedding operations
  async execute(params, context) {
    try {
      const { action } = params;
      
      // Handle bootstrap action first (doesn't require initialized model)
      if (action === 'bootstrap') {
        return await this.bootstrap(params, context);
      }
      
      // For all other actions, ensure embedder is ready (lazy initialization)
      if (!this.isEmbeddingReady || !this.embedder) {
        console.log('[INFO] SemanticEmbeddingAgent: Lazy-initializing embedder...');
        console.log('[DEBUG] Execute context keys:', Object.keys(context || {}));
        console.log('[DEBUG] Embedder in context:', !!context?.embedder);
        
        // Check if embedder is passed in context
        if (context?.embedder) {
          console.log('[INFO] Using embedder passed in execute context');
          this.embedder = context.embedder;
          this.isEmbeddingReady = true;
        } else {
          console.error('[ERROR] No embedder provided in execute context');
          throw new Error('Embedding model not available. No embedder provided in context.');
        }
      }
      
      switch (action) {
        case 'generate-embedding':
          return await AGENT_FORMAT.generateEmbedding.call(this, params, context);
          
        case 'batch-generate-embeddings':
          return await AGENT_FORMAT.batchGenerateEmbeddings.call(this, params, context);
          
        case 'calculate-similarity':
          return await AGENT_FORMAT.calculateSimilarity.call(this, params, context);
          
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      
    } catch (error) {
      console.error('[ERROR] SemanticEmbeddingAgent execution failed:', error);
      return {
        success: false,
        error: error.message,
        action: params.action
      };
    }
  },

  // Generate embedding for a single text
  async generateEmbedding(params, context) {
    try {
      const { text } = params;
      
      if (!text || typeof text !== 'string') {
        throw new Error('Text parameter is required and must be a string');
      }
      
      console.log(`[INFO] Generating embedding for text: "${text.substring(0, 50)}..."`);
      
      // Generate embedding using the same approach as Phi3Agent
      const embedding = await this.embedder(text, { 
        pooling: 'mean', 
        normalize: true 
      });
      
      // Extract the embedding data (384-dimensional vector)
      const embeddingVector = Array.from(embedding.data);
      
      console.log(`[SUCCESS] Generated embedding with ${embeddingVector.length} dimensions`);
      
      return {
        success: true,
        text: text,
        embedding: embeddingVector,
        dimensions: embeddingVector.length,
        model: 'Xenova/all-MiniLM-L6-v2'
      };
      
    } catch (error) {
      console.error('[ERROR] Embedding generation failed:', error);
      throw error;
    }
  },

  // Generate embeddings for multiple texts (batch processing)
  async batchGenerateEmbeddings(params, context) {
    try {
      const { texts } = params;
      
      if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Texts parameter must be a non-empty array');
      }
      
      console.log(`[INFO] Generating embeddings for ${texts.length} texts`);
      
      const results = [];
      
      // Process each text individually to avoid memory issues
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        
        if (typeof text !== 'string') {
          console.warn(`[WARN] Skipping non-string text at index ${i}`);
          continue;
        }
        
        try {
          const embedding = await this.embedder(text, { 
            pooling: 'mean', 
            normalize: true 
          });
          
          const embeddingVector = Array.from(embedding.data);
          
          results.push({
            index: i,
            text: text,
            embedding: embeddingVector,
            success: true
          });
          
        } catch (error) {
          console.error(`[ERROR] Failed to generate embedding for text ${i}:`, error);
          results.push({
            index: i,
            text: text,
            error: error.message,
            success: false
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      console.log(`[SUCCESS] Generated ${successCount}/${texts.length} embeddings`);
      
      return {
        success: true,
        results: results,
        total: texts.length,
        successful: successCount,
        failed: texts.length - successCount,
        model: 'Xenova/all-MiniLM-L6-v2'
      };
      
    } catch (error) {
      console.error('[ERROR] Batch embedding generation failed:', error);
      throw error;
    }
  },

  // Calculate cosine similarity between two embeddings
  async calculateSimilarity(params, context) {
    try {
      const { embedding1, embedding2 } = params;
      
      if (!Array.isArray(embedding1) || !Array.isArray(embedding2)) {
        throw new Error('Both embedding1 and embedding2 must be arrays');
      }
      
      if (embedding1.length !== embedding2.length) {
        throw new Error('Embeddings must have the same dimensions');
      }
      
      // Calculate cosine similarity (same implementation as Phi3Agent)
      const similarity = AGENT_FORMAT.cosineSimilarity.call(this, embedding1, embedding2);
      
      return {
        success: true,
        similarity: similarity,
        embedding1_dims: embedding1.length,
        embedding2_dims: embedding2.length
      };
      
    } catch (error) {
      console.error('[ERROR] Similarity calculation failed:', error);
      throw error;
    }
  },

  // Cosine similarity calculation (from Phi3Agent)
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (normA * normB);
  }
};

// Export using CommonJS format
module.exports = AGENT_FORMAT;
