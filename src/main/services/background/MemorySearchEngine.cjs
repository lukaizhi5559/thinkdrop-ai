/**
 * Memory Search Engine - Stage 4 implementation with re-ranking formula
 * Provides semantic search with multi-factor scoring and re-ranking
 */

class MemorySearchEngine {
  constructor(options = {}) {
    this.config = {
      // Ranking weights
      wCos: 0.6,      // Cosine similarity weight
      wEnt: 0.2,      // Entity overlap weight
      wSess: 0.1,     // Session relevance weight
      wRec: 0.1,      // Recency weight
      
      // Stage budgets (max results per stage)
      stageBudgets: {
        S1: 12,
        S2: 8,
        S3: 8,
        S4: 12
      },
      
      // Filtering thresholds
      minScore: 0.5,
      recencyHalfLifeDays: 60,
      
      ...options
    };
    
    this.UserMemoryAgent = null;
    this.SemanticEmbeddingAgent = null;
  }

  /**
   * Initialize with required agents
   */
  async initialize(coreAgent) {
    try {
      this.UserMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
      this.SemanticEmbeddingAgent = coreAgent.getAgent('SemanticEmbeddingAgent');
      
      // Initialize DistilBert parser for entity extraction
      const DistilBertIntentParserClass = require('../utils/DistilBertIntentParser.cjs');
      this.DistilBertIntentParser = new DistilBertIntentParserClass();
      await this.DistilBertIntentParser.initialize();
      
      if (!this.UserMemoryAgent) {
        throw new Error('UserMemoryAgent not available');
      }
      
      console.log('[MEMORY-SEARCH] Initialized memory search engine with DistilBERT NER');
      return true;
      
    } catch (error) {
      console.error('[MEMORY-SEARCH] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Stage 4: Advanced memory search with re-ranking
   * @param {string} query - Search query
   * @param {Object} context - Search context
   * @param {string} context.sessionId - Current session ID
   * @param {Array} context.entities - Extracted entities from query
   * @returns {Object} Search results with scores
   */
  async searchStage4(query, context = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`[MEMORY-SEARCH-S4] Starting Stage 4 search for: "${query.substring(0, 50)}..."`);
      
      // Step 1: Generate query embedding
      const queryEmbedding = await this.generateQueryEmbedding(query);
      if (!queryEmbedding) {
        throw new Error('Failed to generate query embedding');
      }
      
      // Step 2: Extract entities from query
      const queryEntities = context.entities || await this.extractEntities(query);
      
      // Step 3: Retrieve candidate memories
      const candidates = await this.retrieveCandidateMemories(query, context);
      if (candidates.length === 0) {
        return {
          success: true,
          results: [],
          totalCandidates: 0,
          processingTime: Date.now() - startTime
        };
      }
      
      console.log(`[MEMORY-SEARCH-S4] Retrieved ${candidates.length} candidate memories`);
      
      // Step 4: Score and rank candidates
      const scoredResults = await this.scoreAndRankCandidates(
        candidates,
        queryEmbedding,
        queryEntities,
        context
      );
      
      // Step 5: Apply filtering and budget constraints
      const filteredResults = this.applyFiltering(scoredResults);
      const finalResults = this.applyBudget(filteredResults, 'S4');
      
      const processingTime = Date.now() - startTime;
      console.log(`[MEMORY-SEARCH-S4] Completed in ${processingTime}ms, returning ${finalResults.length} results`);
      
      return {
        success: true,
        results: finalResults,
        totalCandidates: candidates.length,
        processingTime
      };
      
    } catch (error) {
      console.error('[MEMORY-SEARCH-S4] Search failed:', error);
      return {
        success: false,
        error: error.message,
        results: [],
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Generate embedding for query
   */
  async generateQueryEmbedding(query) {
    try {
      if (!this.SemanticEmbeddingAgent) {
        console.warn('[MEMORY-SEARCH-S4] SemanticEmbeddingAgent not available');
        return null;
      }
      
      const result = await this.SemanticEmbeddingAgent.execute({
        action: 'generate-embedding',
        text: query
      });
      
      if (result.success && result.embedding) {
        return result.embedding;
      }
      
      return null;
      
    } catch (error) {
      console.warn('[MEMORY-SEARCH-S4] Failed to generate query embedding:', error.message);
      return null;
    }
  }

  /**
   * Extract entities from query using DistilBERT parser
   */
  async extractEntities(query) {
    try {
      if (!this.DistilBertIntentParser) {
        console.warn('[MEMORY-SEARCH-S4] DistilBertIntentParser not available, using fallback');
        return this.extractEntitiesFallback(query);
      }
      
      const entityCategories = await this.DistilBertIntentParser.extractEntities(query);
      
      // Convert categorized entities to flat array format
      const entities = [];
      
      if (entityCategories) {
        Object.entries(entityCategories).forEach(([type, values]) => {
          if (Array.isArray(values)) {
            values.forEach(value => {
              entities.push({
                text: value,
                type: type.toUpperCase(),
                salience: 0.8 // Higher salience for search queries
              });
            });
          }
        });
      }
      
      return entities;
      
    } catch (error) {
      console.warn('[MEMORY-SEARCH-S4] DistilBERT entity extraction failed:', error.message);
      return this.extractEntitiesFallback(query);
    }
  }

  /**
   * Fallback entity extraction for when DistilBERT is not available
   */
  extractEntitiesFallback(query) {
    const entities = [];
    
    // Extract potential entities (capitalized words, quoted phrases)
    const words = query.split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && /^[A-Z]/.test(word)) {
        entities.push({
          text: word.toLowerCase(),
          type: 'ENTITY',
          salience: 0.5
        });
      }
    }
    
    return entities;
  }

  /**
   * Retrieve candidate memories from storage
   */
  async retrieveCandidateMemories(query, context) {
    try {
      const searchResult = await this.UserMemoryAgent.execute({
        action: 'memory-search',
        query: query,
        limit: 50, // Get more candidates for better ranking
        sessionId: context.sessionId
      });
      
      if (!searchResult.success || !searchResult.memories) {
        return [];
      }
      
      return searchResult.memories.map(memory => ({
        id: memory.key,
        sourceText: memory.sourceText,
        suggestedResponse: memory.suggestedResponse,
        metadata: this.parseMetadata(memory.metadata),
        score: memory.score || 0
      }));
      
    } catch (error) {
      console.error('[MEMORY-SEARCH-S4] Failed to retrieve candidates:', error);
      return [];
    }
  }

  /**
   * Parse metadata string to object
   */
  parseMetadata(metadataStr) {
    try {
      return JSON.parse(metadataStr || '{}');
    } catch (error) {
      return {};
    }
  }

  /**
   * Score and rank candidates using multi-factor formula
   */
  async scoreAndRankCandidates(candidates, queryEmbedding, queryEntities, context) {
    const scoredCandidates = [];
    
    for (const candidate of candidates) {
      const scores = await this.calculateCandidateScores(
        candidate,
        queryEmbedding,
        queryEntities,
        context
      );
      
      // Apply re-ranking formula: Score = wCos*cos + wEnt*ent + wSess*sess + wRec*rec
      const finalScore = (
        this.config.wCos * scores.cosine +
        this.config.wEnt * scores.entity +
        this.config.wSess * scores.session +
        this.config.wRec * scores.recency
      );
      
      scoredCandidates.push({
        ...candidate,
        scores,
        finalScore,
        explanation: this.generateScoreExplanation(scores, finalScore)
      });
    }
    
    // Sort by final score (descending)
    return scoredCandidates.sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Calculate individual scores for a candidate
   */
  async calculateCandidateScores(candidate, queryEmbedding, queryEntities, context) {
    const scores = {
      cosine: 0,
      entity: 0,
      session: 0,
      recency: 0
    };
    
    // Cosine similarity score
    if (queryEmbedding && candidate.metadata.embedding) {
      scores.cosine = this.calculateCosineSimilarity(
        queryEmbedding,
        candidate.metadata.embedding
      );
    }
    
    // Entity overlap score
    if (queryEntities.length > 0 && candidate.metadata.entities) {
      scores.entity = this.calculateEntityOverlap(
        queryEntities,
        candidate.metadata.entities
      );
    }
    
    // Session relevance score
    scores.session = this.calculateSessionRelevance(
      candidate.metadata.sessionId,
      context.sessionId
    );
    
    // Recency score
    if (candidate.metadata.timestamp) {
      scores.recency = this.calculateRecencyScore(candidate.metadata.timestamp);
    }
    
    return scores;
  }

  /**
   * Calculate cosine similarity between embeddings
   */
  calculateCosineSimilarity(embA, embB) {
    try {
      // Parse embeddings if they're strings
      const vecA = Array.isArray(embA) ? embA : JSON.parse(embA);
      const vecB = Array.isArray(embB) ? embB : JSON.parse(embB);
      
      if (vecA.length !== vecB.length) {
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
      
      const denominator = Math.sqrt(normA) * Math.sqrt(normB);
      return denominator === 0 ? 0 : dotProduct / denominator;
      
    } catch (error) {
      console.warn('[MEMORY-SEARCH-S4] Cosine similarity calculation failed:', error.message);
      return 0;
    }
  }

  /**
   * Calculate entity overlap score
   */
  calculateEntityOverlap(queryEntities, candidateEntities) {
    if (!queryEntities.length || !candidateEntities.length) {
      return 0;
    }
    
    const queryEntityTexts = new Set(queryEntities.map(e => e.text.toLowerCase()));
    const candidateEntityTexts = new Set(candidateEntities.map(e => e.text.toLowerCase()));
    
    const intersection = new Set([...queryEntityTexts].filter(x => candidateEntityTexts.has(x)));
    const union = new Set([...queryEntityTexts, ...candidateEntityTexts]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Calculate session relevance score
   */
  calculateSessionRelevance(candidateSessionId, currentSessionId) {
    if (!candidateSessionId || !currentSessionId) {
      return 0.5; // Neutral score
    }
    
    return candidateSessionId === currentSessionId ? 1.0 : 0.3;
  }

  /**
   * Calculate recency score with exponential decay
   */
  calculateRecencyScore(timestamp) {
    try {
      const now = Date.now();
      const ageMs = now - timestamp;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      
      // Exponential decay: score = e^(-age/halfLife)
      const halfLifeDays = this.config.recencyHalfLifeDays;
      return Math.exp(-ageDays / halfLifeDays);
      
    } catch (error) {
      return 0.5; // Neutral score
    }
  }

  /**
   * Generate human-readable score explanation
   */
  generateScoreExplanation(scores, finalScore) {
    const parts = [];
    
    if (scores.cosine > 0.7) parts.push('high semantic similarity');
    else if (scores.cosine > 0.4) parts.push('moderate semantic similarity');
    
    if (scores.entity > 0.5) parts.push('strong entity overlap');
    if (scores.session > 0.8) parts.push('same session');
    if (scores.recency > 0.8) parts.push('very recent');
    else if (scores.recency > 0.5) parts.push('recent');
    
    return parts.length > 0 ? parts.join(', ') : 'basic relevance';
  }

  /**
   * Apply minimum score filtering
   */
  applyFiltering(scoredResults) {
    return scoredResults.filter(result => result.finalScore >= this.config.minScore);
  }

  /**
   * Apply stage budget constraints
   */
  applyBudget(results, stage) {
    const budget = this.config.stageBudgets[stage] || 10;
    return results.slice(0, budget);
  }

  /**
   * Get search engine status
   */
  getStatus() {
    return {
      initialized: !!(this.UserMemoryAgent && this.SemanticEmbeddingAgent),
      config: this.config
    };
  }
}

module.exports = MemorySearchEngine;
