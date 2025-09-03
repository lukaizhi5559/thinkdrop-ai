// WebSearchAgent.cjs - Web search using NewsAPI for reliable news and information
const axios = require('axios');

// Agent state and configuration
let isInitialized = false;

// Load environment variables if not already loaded
if (typeof process !== 'undefined' && !process.env.NEWSAPI_KEY) {
  try {
    require('dotenv').config();
  } catch (e) {
    console.log('⚠️ Could not load dotenv in WebSearchAgent');
  }
}

// Function to get NewsAPI key dynamically
function getNewsAPIKey() {
  // Try multiple ways to get the key
  if (typeof process !== 'undefined' && process.env) {
    // First try direct access
    if (process.env.NEWSAPI_KEY) {
      return process.env.NEWSAPI_KEY;
    }
    
    // Try reloading dotenv
    try {
      require('dotenv').config();
      if (process.env.NEWSAPI_KEY) {
        return process.env.NEWSAPI_KEY;
      }
    } catch (e) {
      console.log('⚠️ Could not reload dotenv');
    }
  }
  
  // If process is undefined, try to access it through global or other means
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '../../../..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/NEWSAPI_KEY=(.+)/);
      if (match && match[1]) {
        console.log('🔑 Found NewsAPI key via direct file read');
        return match[1].trim();
      }
    }
  } catch (e) {
    console.log('⚠️ Could not read .env file directly:', e.message);
  }
  
  return 'YOUR_NEWSAPI_KEY_HERE';
}

// NewsAPI configuration
const NEWSAPI_CONFIG = {
  baseUrl: 'https://newsapi.org/v2',
  // Note: API key should be set via environment variable NEWSAPI_KEY
  // Get free key at: https://newsapi.org/register
  get apiKey() {
    return getNewsAPIKey();
  },
  maxResults: 10
};

// Fallback providers for different query types
const FALLBACK_PROVIDERS = {
  duckduckgo: 'https://api.duckduckgo.com',
  // Add more providers as needed
};

let searchCache = new Map();

// Utility functions
function normalizeQuery(query, params = {}) {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  const paramStr = JSON.stringify(params);
  return `${normalized}|${paramStr}`;
}

function getCacheTTL(query, params = {}) {
  // Time-sensitive queries get shorter TTL
  const timeSensitive = /\b(latest|recent|today|yesterday|news|breaking)\b/i.test(query);
  if (timeSensitive) return 10 * 60 * 1000; // 10 minutes
  
  // General queries get longer TTL
  return 24 * 60 * 60 * 1000; // 24 hours
}

function getCachedResult(cacheKey) {
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    console.log('🎯 Cache hit for search query');
    return cached.data;
  }
  return null;
}

function setCachedResult(cacheKey, data, ttl) {
  searchCache.set(cacheKey, {
    data,
    expires: Date.now() + ttl
  });
}

// Optimize query for better NewsAPI results
function optimizeQuery(query) {
  // Remove punctuation that causes issues with NewsAPI
  let optimized = query
    // Remove apostrophes and contractions
    .replace(/'/g, '')
    .replace(/'/g, '')
    // Remove question marks and exclamation points
    .replace(/[?!]/g, '')
    // Remove question words and optimize for NewsAPI
    .replace(/^(whats|what is|tell me about|give me|show me|find)\s+/i, '')
    .replace(/\s+(news|information|updates?|details?)\s*$/i, '')
    .replace(/^the\s+/i, '')
    // Clean up extra spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  // If query becomes too short, use original without punctuation
  if (optimized.length < 3) {
    optimized = query.replace(/[?!']/g, '').replace(/\s+/g, ' ').trim();
  }
  
  console.log(`🔧 Query optimization: "${query}" -> "${optimized}"`);
  return optimized;
}

// Determine search strategy based on query type
function getSearchStrategy(query) {
  const newsKeywords = /\b(news|latest|recent|breaking|today|yesterday|update|announcement)\b/i;
  const factualKeywords = /\b(what is|who is|define|explain|facts about|information about)\b/i;
  
  if (newsKeywords.test(query)) {
    return 'news';
  } else if (factualKeywords.test(query)) {
    return 'factual';
  }
  return 'general';
}

const AGENT_FORMAT = {
  name: 'WebSearchAgent',
  description: 'Web search using NewsAPI for reliable news and information',
  version: '2.0.0',
  
  // Agent availability check
  get isAvailable() {
    return true; // Always available for web search
  },

  async initialize() {
    console.log('🔍 Initializing WebSearchAgent...');
    isInitialized = true;
    return { success: true };
  },

  // Get NewsAPI key from environment or config
  getNewsApiKey() {
    // Try process.env first
    if (typeof process !== 'undefined' && process.env && process.env.NEWSAPI_KEY) {
      return process.env.NEWSAPI_KEY;
    }
    
    // Try NEWSAPI_CONFIG if available
    if (typeof NEWSAPI_CONFIG !== 'undefined' && NEWSAPI_CONFIG.apiKey && NEWSAPI_CONFIG.apiKey !== 'YOUR_NEWSAPI_KEY_HERE') {
      return NEWSAPI_CONFIG.apiKey;
    }
    
    // Try loading from .env file directly
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(process.cwd(), '.env');
      
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/NEWSAPI_KEY=(.+)/);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    } catch (error) {
      console.log('⚠️ Could not read .env file:', error.message);
    }
    
    return null;
  },

  // Main search function using NewsAPI
  async search(query, options = {}) {
    const maxResults = options.maxResults || 10;
    const cacheKey = normalizeQuery(query, { maxResults });
    const ttl = getCacheTTL(query, options);
    
    // Check cache first
    const cachedResult = getCachedResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    
    console.log(`🔍 Searching for: "${query}"`);
    
    const strategy = getSearchStrategy(query);
    let lastError = null;
    
    try {
      // Try NewsAPI first
      const newsResult = await AGENT_FORMAT.searchWithNewsAPI(query, maxResults, strategy);
      if (newsResult.success && newsResult.articles && newsResult.articles.length > 0) {
        setCachedResult(cacheKey, newsResult, ttl);
        return newsResult;
      }
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ NewsAPI failed: ${error.message}`);
    }
    
    // Try DuckDuckGo fallback for any query type when NewsAPI fails
    try {
      console.log(`🦆 Trying DuckDuckGo fallback for ${strategy} query`);
      const duckDuckGoResult = await AGENT_FORMAT.searchDuckDuckGo(query, maxResults);
      
      if (duckDuckGoResult && duckDuckGoResult.results && duckDuckGoResult.results.length > 0) {
        // Format DuckDuckGo result to match expected structure
        const formattedResult = {
          success: true,
          result: {
            results: duckDuckGoResult.results,
            source: duckDuckGoResult.source,
            strategy: duckDuckGoResult.strategy,
            cached: false,
            timestamp: new Date().toISOString()
          }
        };
        setCachedResult(cacheKey, formattedResult, ttl);
        return formattedResult;
      }
    } catch (duckDuckGoError) {
      console.log(`⚠️ DuckDuckGo fallback also failed: ${duckDuckGoError.message}`);
    }
    
    // If all providers fail, throw error with helpful message
    throw new Error(`Search failed for query "${query}". ${lastError?.message || 'All providers unavailable'}`);
  },

  // NewsAPI search implementation
  async searchWithNewsAPI(query, maxResults, strategy) {
    try {
      console.log(`📰 NewsAPI search: "${query}" (${strategy})`);
      
      // Check if NewsAPI key is available
      const newsApiKey = AGENT_FORMAT.getNewsApiKey();
      if (!newsApiKey) {
        console.log('❌ NewsAPI key not available, skipping NewsAPI search');
        throw new Error('NewsAPI key not available');
      }
      
      console.log(`🔑 NewsAPI key available: ${newsApiKey ? 'YES' : 'NO'}`);
      
      // Optimize query for better results
      const optimizedQuery = optimizeQuery(query);
      
      const endpoint = 'https://newsapi.org/v2/everything';
      const params = {
        q: optimizedQuery,
        sortBy: strategy === 'news' ? 'publishedAt' : 'relevancy',
        language: 'en',
        pageSize: Math.min(maxResults, 100),
        apiKey: newsApiKey
      };
      
      console.log(`🌐 NewsAPI request params:`, { ...params, apiKey: '[HIDDEN]' });
      
      const response = await axios.get(endpoint, {
        params,
        timeout: 10000,
        headers: {
          'User-Agent': 'ThinkDrop-AI/2.0 (Educational Research)'
        }
      });
      
      console.log(`📊 NewsAPI response status: ${response.status}`);
      console.log(`📊 NewsAPI response data keys:`, Object.keys(response.data || {}));
      console.log(`📊 NewsAPI articles count:`, response.data?.articles?.length || 0);
      
      if (response.data && response.data.status === 'ok' && response.data.articles && response.data.articles.length > 0) {
        const articles = response.data.articles.slice(0, maxResults);
        console.log(`✅ NewsAPI found ${articles.length} articles`);
        return {
          success: true,
          articles: articles,
          totalResults: response.data.totalResults || articles.length,
          source: 'newsapi',
          strategy,
          query: optimizedQuery,
          originalQuery: query,
          timestamp: new Date().toISOString()
        };
      }
      
      console.log(`❌ NewsAPI returned no articles for optimized query: "${optimizedQuery}"`);
      
      // Try fallback with original query if optimization didn't work
      if (optimizedQuery !== query) {
        console.log(`🔄 Trying fallback with original query: "${query}"`);
        const fallbackParams = { ...params, q: query };
        
        const fallbackResponse = await axios.get(endpoint, {
          params: fallbackParams,
          timeout: 10000,
          headers: {
            'User-Agent': 'ThinkDrop-AI/2.0 (Educational Research)'
          }
        });
        
        if (fallbackResponse.data && fallbackResponse.data.status === 'ok' && 
            fallbackResponse.data.articles && fallbackResponse.data.articles.length > 0) {
          const articles = fallbackResponse.data.articles.slice(0, maxResults);
          console.log(`✅ NewsAPI fallback found ${articles.length} articles`);
          return {
            success: true,
            articles: articles,
            totalResults: fallbackResponse.data.totalResults || articles.length,
            source: 'newsapi',
            strategy,
            query: query,
            originalQuery: query,
            timestamp: new Date().toISOString()
          };
        }
      }
      
      throw new Error('No results found from NewsAPI');
      
    } catch (error) {
      console.error('❌ NewsAPI search failed:', error.message);
      throw error;
    }
  },

  // DuckDuckGo fallback for factual queries
  async searchDuckDuckGo(query, maxResults = 5) {
    try {
      console.log(`🦆 Using DuckDuckGo fallback for factual query`);
      
      // Use DuckDuckGo Instant Answer API
      const response = await axios.get('https://api.duckduckgo.com/', {
        params: {
          q: query,
          format: 'json',
          no_redirect: '1',
          no_html: '1',
          skip_disambig: '1'
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'ThinkDrop-AI/1.0 (https://github.com/thinkdrop-ai)'
        }
      });

      const data = response.data;
      const results = [];

      // Process abstract (main answer)
      if (data.Abstract && data.Abstract.trim()) {
        results.push({
          title: data.Heading || 'DuckDuckGo Result',
          url: data.AbstractURL || 'https://duckduckgo.com/' + encodeURIComponent(query),
          content: data.Abstract,
          publishedAt: new Date().toISOString(),
          source: 'duckduckgo'
        });
      }

      // Process related topics
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || 'Related Topic',
              url: topic.FirstURL,
              content: topic.Text,
              publishedAt: new Date().toISOString(),
              source: 'duckduckgo'
            });
          }
        }
      }

      // Process definition if available
      if (data.Definition && data.Definition.trim() && results.length === 0) {
        results.push({
          title: data.DefinitionSource || 'Definition',
          url: data.DefinitionURL || 'https://duckduckgo.com/' + encodeURIComponent(query),
          content: data.Definition,
          publishedAt: new Date().toISOString(),
          source: 'duckduckgo'
        });
      }

      // If no results from instant answers, provide a generic but helpful response
      if (results.length === 0) {
        // For news queries, provide a helpful message about getting current info
        if (query.toLowerCase().includes('news') || query.toLowerCase().includes('latest') || 
            query.toLowerCase().includes('breaking') || query.toLowerCase().includes('today')) {
          results.push({
            title: 'Current Information Needed',
            url: 'https://duckduckgo.com/?q=' + encodeURIComponent(query),
            content: `I don't have access to current news about "${query}". For the latest information, I recommend checking recent news sources or searching directly on DuckDuckGo.`,
            publishedAt: new Date().toISOString(),
            source: 'duckduckgo_fallback'
          });
        } else {
          // For general queries, provide a search suggestion
          results.push({
            title: 'Search Suggestion',
            url: 'https://duckduckgo.com/?q=' + encodeURIComponent(query),
            content: `I couldn't find specific information about "${query}" in my instant answers. You might find more detailed results by searching directly on DuckDuckGo or other search engines.`,
            publishedAt: new Date().toISOString(),
            source: 'duckduckgo_fallback'
          });
        }
      }

      return {
        success: true,
        results: results.slice(0, maxResults),
        source: 'duckduckgo',
        cached: false,
        strategy: 'unknown'
      };

    } catch (error) {
      console.log(`⚠️ DuckDuckGo fallback failed: ${error.message}`);
      throw error;
    }
  },

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
  },

  // Clean up cache periodically
  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of searchCache.entries()) {
      if (now >= value.expires) {
        searchCache.delete(key);
      }
    }
    console.log(`🧹 Cache cleanup completed. ${searchCache.size} entries remaining.`);
  },

  // Agent execution interface (for compatibility with existing system)
  async execute(params, context) {
    const { action, query, intent, entities, options } = params;
    
    switch (action) {
      case 'search':
        return await AGENT_FORMAT.search(query, options);
      
      case 'search-with-intent':
        return await AGENT_FORMAT.searchWithIntent(query, intent, entities, options);
      
      case 'cleanup-cache':
        AGENT_FORMAT.cleanupCache();
        return { success: true, message: 'Cache cleaned up' };
      
      default:
        throw new Error(`Unknown WebSearchAgent action: ${action}`);
    }
  }
};

module.exports = AGENT_FORMAT;
