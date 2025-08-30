// WebSearchAgent.cjs - Free web search using SearXNG public instances
const axios = require('axios');

class WebSearchAgent {
  constructor() {
    this.name = 'WebSearchAgent';
    this.initialized = false;
    
    // Public SearXNG instances (fallback chain)
    this.searxInstances = [
      'https://searx.be',
      'https://search.sapti.me',
      'https://searx.tiekoetter.com',
      'https://searx.work'
    ];
    
    this.currentInstanceIndex = 0;
    this.cache = new Map(); // Simple in-memory cache
  }

  async initialize() {
    console.log('🔍 Initializing WebSearchAgent...');
    this.initialized = true;
    return { success: true };
  }

  // Normalize query for cache key
  normalizeQuery(query, params = {}) {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    const paramStr = JSON.stringify(params);
    return `${normalized}|${paramStr}`;
  }

  // Get cache TTL based on query characteristics
  getCacheTTL(query, params = {}) {
    // Time-sensitive queries get shorter TTL
    const timeSensitive = /\b(latest|recent|today|yesterday|news|breaking)\b/i.test(query);
    if (timeSensitive) return 10 * 60 * 1000; // 10 minutes
    
    // General queries get longer TTL
    return 24 * 60 * 60 * 1000; // 24 hours
  }

  // Check cache for existing results
  getCachedResult(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      console.log('🎯 Cache hit for search query');
      return cached.data;
    }
    return null;
  }

  // Store result in cache
  setCachedResult(cacheKey, data, ttl) {
    this.cache.set(cacheKey, {
      data,
      expires: Date.now() + ttl
    });
  }

  // Get next SearXNG instance (fallback rotation)
  getNextInstance() {
    const instance = this.searxInstances[this.currentInstanceIndex];
    this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.searxInstances.length;
    return instance;
  }

  // Main search function
  async search(query, options = {}) {
    try {
      const {
        limit = 10,
        categories = 'general',
        language = 'en',
        timeRange = null, // 'day', 'week', 'month', 'year'
        format = 'json'
      } = options;

      // Check cache first
      const cacheKey = this.normalizeQuery(query, { limit, categories, language, timeRange });
      const cached = this.getCachedResult(cacheKey);
      if (cached) return cached;

      console.log(`🔍 Searching for: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);

      let lastError = null;
      
      // Try each SearXNG instance until one works
      for (let attempt = 0; attempt < this.searxInstances.length; attempt++) {
        const instance = this.getNextInstance();
        
        try {
          const searchUrl = `${instance}/search`;
          const params = {
            q: query,
            format: format,
            categories: categories,
            language: language,
            pageno: 1
          };

          if (timeRange) {
            params.time_range = timeRange;
          }

          console.log(`🌐 Trying SearXNG instance: ${instance}`);
          
          const response = await axios.get(searchUrl, {
            params,
            timeout: 10000, // 10 second timeout
            headers: {
              'User-Agent': 'ThinkDrop-AI/1.0 (https://thinkdrop.ai)'
            }
          });

          if (response.data && response.data.results) {
            const results = response.data.results.slice(0, limit).map(result => ({
              title: result.title || '',
              url: result.url || '',
              content: result.content || '',
              snippet: result.content || '',
              publishedDate: result.publishedDate || null,
              engine: result.engine || 'searx'
            }));

            const searchResult = {
              success: true,
              results,
              query,
              totalResults: response.data.number_of_results || results.length,
              instance: instance,
              timestamp: Date.now()
            };

            // Cache the result
            const ttl = this.getCacheTTL(query, options);
            this.setCachedResult(cacheKey, searchResult, ttl);

            console.log(`✅ Found ${results.length} results from ${instance}`);
            return searchResult;
          }
        } catch (error) {
          lastError = error;
          console.warn(`⚠️ SearXNG instance ${instance} failed:`, error.message);
          continue;
        }
      }

      // All instances failed
      throw new Error(`All SearXNG instances failed. Last error: ${lastError?.message}`);

    } catch (error) {
      console.error('❌ WebSearchAgent search failed:', error);
      return {
        success: false,
        error: error.message,
        results: [],
        query,
        timestamp: Date.now()
      };
    }
  }

  // Search with specific intent (for hybrid queries)
  async searchWithIntent(query, intent, entities = [], options = {}) {
    try {
      // Enhance query based on intent
      let enhancedQuery = query;
      
      if (intent === 'compare_entities' && entities.length > 0) {
        // Add comparison keywords
        enhancedQuery = `${entities[0]} competitors alternatives similar companies`;
      } else if (intent === 'find_facts') {
        // Add factual keywords
        enhancedQuery = `${query} facts information about`;
      }

      console.log(`🎯 Intent-enhanced search: "${enhancedQuery}"`);
      
      return await this.search(enhancedQuery, {
        ...options,
        limit: options.limit || 8 // Slightly fewer results for intent-based searches
      });

    } catch (error) {
      console.error('❌ Intent-based search failed:', error);
      return this.search(query, options); // Fallback to regular search
    }
  }

  // Clean up cache periodically
  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now >= value.expires) {
        this.cache.delete(key);
      }
    }
    console.log(`🧹 Cache cleanup completed. ${this.cache.size} entries remaining.`);
  }

  // Agent execution interface (for compatibility with existing system)
  async execute(action, params, context) {
    switch (action) {
      case 'search':
        return await this.search(params.query, params.options);
      
      case 'search-with-intent':
        return await this.searchWithIntent(
          params.query, 
          params.intent, 
          params.entities, 
          params.options
        );
      
      case 'cleanup-cache':
        this.cleanupCache();
        return { success: true, message: 'Cache cleaned up' };
      
      default:
        throw new Error(`Unknown WebSearchAgent action: ${action}`);
    }
  }
}

module.exports = WebSearchAgent;
