const { chromium } = require('playwright');

// Agent state
let browser = null;
let context = null;
let page = null;
let isInitialized = false;

// Search engine configurations
const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q='
};

// Cache for search results
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

const AGENT_FORMAT = {
  name: 'PlaywrightSearchAgent',
  description: 'Advanced web automation and search using Playwright for real browser-based search',
  version: '1.0.0',
  
  // Agent availability check
  get isAvailable() {
    return true; // Always available if Playwright is installed
  },

  async initialize(options = {}) {
    try {
      if (isInitialized) return { success: true };

      console.log('🔍 Initializing PlaywrightSearchAgent...');

      const browserOptions = {
        headless: options.headless !== false, // Default to headless
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      };

      browser = await chromium.launch(browserOptions);
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
      });
      
      page = await context.newPage();
      isInitialized = true;

      console.log('✅ PlaywrightSearchAgent initialized successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to initialize PlaywrightSearchAgent:', error);
      return { success: false, error: error.message };
    }
  },

  // Main search function
  async search(query, options = {}) {
    try {
      const {
        engine = 'google',
        maxResults = 10,
        includeSnippets = true,
        timeout = 30000
      } = options;

      // Check cache first
      const cacheKey = normalizeQuery(query, { engine, maxResults });
      const ttl = getCacheTTL(query, options);
      const cachedResult = getCachedResult(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }

      await AGENT_FORMAT.initialize();

      console.log(`🔍 Searching for: "${query}" using ${engine}`);

      const searchUrl = SEARCH_ENGINES[engine] + encodeURIComponent(query);
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout });

      let results = [];

      switch (engine) {
        case 'google':
          results = await AGENT_FORMAT.extractGoogleResults(maxResults, includeSnippets);
          break;
        case 'bing':
          results = await AGENT_FORMAT.extractBingResults(maxResults, includeSnippets);
          break;
        case 'duckduckgo':
          results = await AGENT_FORMAT.extractDuckDuckGoResults(maxResults, includeSnippets);
          break;
        default:
          throw new Error(`Unsupported search engine: ${engine}`);
      }

      console.log(`✅ Found ${results.length} search results`);

      const searchResult = {
        success: true,
        query,
        engine,
        results,
        totalResults: results.length,
        source: 'playwright',
        timestamp: new Date().toISOString()
      };

      // Cache the result
      setCachedResult(cacheKey, searchResult, ttl);

      return searchResult;

    } catch (error) {
      console.error('❌ Search failed:', error);
      return {
        success: false,
        error: error.message,
        query,
        results: []
      };
    }
  },

  // Extract Google search results
  async extractGoogleResults(maxResults, includeSnippets) {
    try {
      // Try multiple selectors for Google results
      const selectors = [
        'div[data-ved]',
        '.g',
        '.tF2Cxc',
        '[data-header-feature] .g'
      ];

      let resultsFound = false;
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          resultsFound = true;
          break;
        } catch (e) {
          console.log(`Selector ${selector} not found, trying next...`);
        }
      }

      if (!resultsFound) {
        console.log('No Google results found with any selector');
        return [];
      }

      // Extract results using multiple approaches
      const searchResults = await page.evaluate((maxResults) => {
        const results = [];
        
        // Try different result container selectors
        const containers = document.querySelectorAll('.g, .tF2Cxc, div[data-ved]');
        
        for (const container of containers) {
          if (results.length >= maxResults) break;
          
          // Try different title selectors
          const titleElement = container.querySelector('h3') || 
                              container.querySelector('h2') ||
                              container.querySelector('[role="heading"]');
          
          // Try different link selectors
          const linkElement = container.querySelector('a[href]') ||
                             container.querySelector('h3 a') ||
                             container.querySelector('h2 a');
          
          // Try different snippet selectors
          const snippetElement = container.querySelector('.VwiC3b') ||
                                container.querySelector('.s3v9rd') ||
                                container.querySelector('[data-sncf]') ||
                                container.querySelector('.IsZvec') ||
                                container.querySelector('span[style*="line-height"]');

          if (titleElement && linkElement && linkElement.href && 
              !linkElement.href.includes('google.com/search') &&
              !linkElement.href.includes('accounts.google.com')) {
            
            results.push({
              title: titleElement.textContent?.trim() || '',
              url: linkElement.href || '',
              description: snippetElement?.textContent?.trim() || '',
              publishedAt: new Date().toISOString(),
              source: { name: 'Google Search' }
            });
          }
        }
        
        return results;
      }, maxResults);

      console.log(`Extracted ${searchResults.length} Google results`);
      return searchResults.slice(0, maxResults);

    } catch (error) {
      console.error('Error extracting Google results:', error);
      return [];
    }
  },

  // Extract Bing search results
  async extractBingResults(maxResults, includeSnippets) {
    try {
      await page.waitForSelector('.b_algo', { timeout: 10000 });

      const searchResults = await page.$$eval('.b_algo', (elements) => {
        return elements.slice(0, maxResults).map(element => {
          const titleElement = element.querySelector('h2 a');
          const snippetElement = element.querySelector('.b_caption p');

          if (!titleElement) return null;

          return {
            title: titleElement.textContent?.trim() || '',
            url: titleElement.href || '',
            description: snippetElement?.textContent?.trim() || '',
            publishedAt: new Date().toISOString(),
            source: { name: 'Bing Search' }
          };
        }).filter(result => result && result.title && result.url);
      });

      return searchResults;

    } catch (error) {
      console.error('Error extracting Bing results:', error);
      return [];
    }
  },

  // Extract DuckDuckGo search results
  async extractDuckDuckGoResults(maxResults, includeSnippets) {
    try {
      // Try multiple selectors for DuckDuckGo results
      const selectors = [
        '[data-testid="result"]',
        '.result',
        '.web-result',
        '.results_links'
      ];

      let resultsFound = false;
      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          resultsFound = true;
          break;
        } catch (e) {
          console.log(`DuckDuckGo selector ${selector} not found, trying next...`);
        }
      }

      if (!resultsFound) {
        console.log('No DuckDuckGo results found with any selector');
        return [];
      }

      const searchResults = await page.evaluate((maxResults) => {
        const results = [];
        
        // Try different result container selectors
        const containers = document.querySelectorAll('[data-testid="result"], .result, .web-result, .results_links');
        
        for (const container of containers) {
          if (results.length >= maxResults) break;
          
          // Try different title and link selectors
          const linkElement = container.querySelector('h2 a') ||
                             container.querySelector('h3 a') ||
                             container.querySelector('.result__title a') ||
                             container.querySelector('a[href]');
          
          // Try different snippet selectors
          const snippetElement = container.querySelector('[data-result="snippet"]') ||
                                container.querySelector('.result__snippet') ||
                                container.querySelector('.snippet') ||
                                container.querySelector('span');

          if (linkElement && linkElement.href && linkElement.textContent) {
            results.push({
              title: linkElement.textContent?.trim() || '',
              url: linkElement.href || '',
              description: snippetElement?.textContent?.trim() || '',
              publishedAt: new Date().toISOString(),
              source: { name: 'DuckDuckGo Search' }
            });
          }
        }
        
        return results;
      }, maxResults);

      console.log(`Extracted ${searchResults.length} DuckDuckGo results`);
      return searchResults.slice(0, maxResults);

    } catch (error) {
      console.error('Error extracting DuckDuckGo results:', error);
      return [];
    }
  },

  // Navigate to a specific URL and extract content
  async navigateAndExtract(url, options = {}) {
    try {
      await AGENT_FORMAT.initialize();

      const { 
        selector = 'body',
        timeout = 30000,
        waitFor = 'networkidle'
      } = options;

      console.log(`🌐 Navigating to: ${url}`);

      await page.goto(url, { waitUntil: waitFor, timeout });
      
      // Extract content based on selector
      const content = await page.$eval(selector, (element) => {
        return {
          text: element.textContent?.trim() || '',
          html: element.innerHTML || '',
          title: document.title || ''
        };
      });

      return {
        success: true,
        url,
        content,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Navigation failed:', error);
      return {
        success: false,
        error: error.message,
        url
      };
    }
  },

  // Check if agent is available
  async checkAvailability() {
    try {
      // Test browser launch
      const testBrowser = await chromium.launch({ headless: true });
      await testBrowser.close();
      return true;
    } catch (error) {
      console.error('PlaywrightSearchAgent not available:', error);
      return false;
    }
  },

  // Clean up resources
  async cleanup() {
    try {
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
      
      isInitialized = false;
      console.log('✅ PlaywrightSearchAgent cleaned up');

    } catch (error) {
      console.error('❌ Cleanup failed:', error);
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
    const { action, query, options } = params;
    
    switch (action) {
      case 'search':
        return await AGENT_FORMAT.search(query, options);
      
      case 'navigate':
        return await AGENT_FORMAT.navigateAndExtract(params.url, options);
      
      case 'cleanup-cache':
        AGENT_FORMAT.cleanupCache();
        return { success: true, message: 'Cache cleaned up' };
      
      case 'cleanup':
        await AGENT_FORMAT.cleanup();
        return { success: true, message: 'Agent cleaned up' };
      
      default:
        throw new Error(`Unknown PlaywrightSearchAgent action: ${action}`);
    }
  }
};

// Graceful cleanup on process exit
process.on('exit', () => AGENT_FORMAT.cleanup());
process.on('SIGINT', () => AGENT_FORMAT.cleanup());
process.on('SIGTERM', () => AGENT_FORMAT.cleanup());

module.exports = AGENT_FORMAT;
