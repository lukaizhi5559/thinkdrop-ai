/**
 * QueryCache - Intelligent caching for semantic search results
 * Eliminates redundant embeddings, classifications, and LLM calls
 * Target: Reduce repeated processing from seconds to milliseconds
 */

const crypto = require('crypto');

class QueryCache {
  constructor(options = {}) {
    // Cache stores
    this.embeddingCache = new Map();
    this.classificationCache = new Map();
    this.responseCache = new Map();
    this.similarityCache = new Map();
    
    // Configuration
    this.maxCacheSize = options.maxCacheSize || 1000;
    this.ttlMs = options.ttlMs || 30 * 60 * 1000; // 30 minutes default
    this.enableMetrics = options.enableMetrics !== false;
    
    // Metrics
    this.metrics = {
      embedding: { hits: 0, misses: 0 },
      classification: { hits: 0, misses: 0 },
      response: { hits: 0, misses: 0 },
      similarity: { hits: 0, misses: 0 }
    };
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this._cleanup(), 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Generate cache key from text content
   */
  _generateKey(text, prefix = '') {
    const hash = crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex').substring(0, 16);
    return prefix ? `${prefix}:${hash}` : hash;
  }

  /**
   * Check if cache entry is expired
   */
  _isExpired(entry) {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  /**
   * Cache embedding result
   */
  cacheEmbedding(text, embedding) {
    const key = this._generateKey(text, 'emb');
    this.embeddingCache.set(key, {
      embedding,
      timestamp: Date.now()
    });
    
    this._enforceMaxSize(this.embeddingCache);
    console.log(`[CACHE] Stored embedding for key: ${key}`);
  }

  /**
   * Get cached embedding
   */
  getEmbedding(text) {
    const key = this._generateKey(text, 'emb');
    const entry = this.embeddingCache.get(key);
    
    if (!entry || this._isExpired(entry)) {
      if (this.enableMetrics) this.metrics.embedding.misses++;
      return null;
    }
    
    if (this.enableMetrics) this.metrics.embedding.hits++;
    console.log(`[CACHE-HIT] Retrieved embedding for key: ${key}`);
    return entry.embedding;
  }

  /**
   * Cache query classification result
   */
  cacheClassification(query, classification) {
    const key = this._generateKey(query, 'class');
    this.classificationCache.set(key, {
      classification,
      timestamp: Date.now()
    });
    
    this._enforceMaxSize(this.classificationCache);
    console.log(`[CACHE] Stored classification for key: ${key}`);
  }

  /**
   * Get cached classification
   */
  getClassification(query) {
    const key = this._generateKey(query, 'class');
    const entry = this.classificationCache.get(key);
    
    if (!entry || this._isExpired(entry)) {
      if (this.enableMetrics) this.metrics.classification.misses++;
      return null;
    }
    
    if (this.enableMetrics) this.metrics.classification.hits++;
    console.log(`[CACHE-HIT] Retrieved classification for key: ${key}`);
    return entry.classification;
  }

  /**
   * Cache LLM response
   */
  cacheResponse(query, context, response) {
    const contextKey = this._generateContextKey(query, context);
    const key = this._generateKey(contextKey, 'resp');
    
    this.responseCache.set(key, {
      response,
      query,
      contextHash: this._generateKey(JSON.stringify(context)),
      timestamp: Date.now()
    });
    
    this._enforceMaxSize(this.responseCache);
    console.log(`[CACHE] Stored response for key: ${key}`);
  }

  /**
   * Get cached response
   */
  getResponse(query, context) {
    const contextKey = this._generateContextKey(query, context);
    const key = this._generateKey(contextKey, 'resp');
    const entry = this.responseCache.get(key);
    
    if (!entry || this._isExpired(entry)) {
      if (this.enableMetrics) this.metrics.response.misses++;
      return null;
    }
    
    // Verify context hasn't changed significantly
    const currentContextHash = this._generateKey(JSON.stringify(context));
    if (entry.contextHash !== currentContextHash) {
      if (this.enableMetrics) this.metrics.response.misses++;
      return null;
    }
    
    if (this.enableMetrics) this.metrics.response.hits++;
    console.log(`[CACHE-HIT] Retrieved response for key: ${key}`);
    return entry.response;
  }

  /**
   * Cache similarity calculation result
   */
  cacheSimilarity(text1, text2, similarity) {
    const key = this._generateSimilarityKey(text1, text2);
    this.similarityCache.set(key, {
      similarity,
      timestamp: Date.now()
    });
    
    this._enforceMaxSize(this.similarityCache);
  }

  /**
   * Get cached similarity
   */
  getSimilarity(text1, text2) {
    const key = this._generateSimilarityKey(text1, text2);
    const entry = this.similarityCache.get(key);
    
    if (!entry || this._isExpired(entry)) {
      if (this.enableMetrics) this.metrics.similarity.misses++;
      return null;
    }
    
    if (this.enableMetrics) this.metrics.similarity.hits++;
    return entry.similarity;
  }

  /**
   * Generate context-aware key for responses
   */
  _generateContextKey(query, context) {
    const contextStr = JSON.stringify({
      query: query.toLowerCase().trim(),
      sessionId: context.currentSessionId,
      // Include only stable context elements
      hasConversationContext: !!context.conversationContext,
      contextLength: context.conversationContext?.length || 0
    });
    return contextStr;
  }

  /**
   * Generate similarity cache key (order-independent)
   */
  _generateSimilarityKey(text1, text2) {
    const hash1 = this._generateKey(text1);
    const hash2 = this._generateKey(text2);
    // Ensure consistent ordering
    return hash1 < hash2 ? `sim:${hash1}:${hash2}` : `sim:${hash2}:${hash1}`;
  }

  /**
   * Enforce maximum cache size (LRU eviction)
   */
  _enforceMaxSize(cache) {
    if (cache.size > this.maxCacheSize) {
      // Remove oldest entries (simple LRU)
      const entries = Array.from(cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, cache.size - this.maxCacheSize);
      toRemove.forEach(([key]) => cache.delete(key));
      
      console.log(`[CACHE] Evicted ${toRemove.length} old entries`);
    }
  }

  /**
   * Clean up expired entries
   */
  _cleanup() {
    const now = Date.now();
    let totalRemoved = 0;
    
    [this.embeddingCache, this.classificationCache, this.responseCache, this.similarityCache].forEach(cache => {
      const before = cache.size;
      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > this.ttlMs) {
          cache.delete(key);
        }
      }
      totalRemoved += before - cache.size;
    });
    
    if (totalRemoved > 0) {
      console.log(`[CACHE] Cleaned up ${totalRemoved} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const calculateHitRate = (metric) => {
      const total = metric.hits + metric.misses;
      return total > 0 ? (metric.hits / total * 100).toFixed(1) : '0.0';
    };

    return {
      sizes: {
        embedding: this.embeddingCache.size,
        classification: this.classificationCache.size,
        response: this.responseCache.size,
        similarity: this.similarityCache.size
      },
      hitRates: {
        embedding: `${calculateHitRate(this.metrics.embedding)}%`,
        classification: `${calculateHitRate(this.metrics.classification)}%`,
        response: `${calculateHitRate(this.metrics.response)}%`,
        similarity: `${calculateHitRate(this.metrics.similarity)}%`
      },
      metrics: this.metrics,
      config: {
        maxCacheSize: this.maxCacheSize,
        ttlMs: this.ttlMs
      }
    };
  }

  /**
   * Clear all caches
   */
  clearAll() {
    this.embeddingCache.clear();
    this.classificationCache.clear();
    this.responseCache.clear();
    this.similarityCache.clear();
    
    // Reset metrics
    Object.keys(this.metrics).forEach(key => {
      this.metrics[key] = { hits: 0, misses: 0 };
    });
    
    console.log('[CACHE] All caches cleared');
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clearAll();
  }
}

// Export singleton instance
const queryCache = new QueryCache({
  maxCacheSize: 2000,
  ttlMs: 30 * 60 * 1000, // 30 minutes
  enableMetrics: true
});

module.exports = {
  QueryCache,
  queryCache
};
