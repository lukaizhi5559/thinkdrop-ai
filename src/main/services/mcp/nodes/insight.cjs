/**
 * Insight Node
 * Generates contextual insights from screen content using OCR + web search
 * 
 * Supports two modes:
 * 1. Page Insight - Automatic insights for current window/page
 * 2. Highlight Insight - Focused insights for user-selected text
 */

const logger = require('./../../../logger.cjs');
module.exports = async function insight(state) {
  const { mcpClient, message, ocrText, windowTitle, selectedText, insightType = 'page' } = state;

  logger.debug(`💡 [NODE:INSIGHT] Generating ${insightType} insight...`);

  try {
    // Check cache first
    const cacheKey = insightType === 'page' 
      ? `page_insight:${windowTitle}:${hashString(ocrText?.substring(0, 200) || '')}`
      : `highlight_insight:${hashString(selectedText || '')}`;
    
    const cached = global.insightCache?.get(cacheKey);
    const cacheTTL = insightType === 'page' ? 300000 : 3600000; // 5 min for page, 1 hour for highlight
    
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      const age = Math.round((Date.now() - cached.timestamp) / 1000);
      logger.debug(`⚡ [NODE:INSIGHT] Using cached insight (${age}s old)`);
      return {
        ...state,
        insights: cached.data
      };
    }

    // Extract context based on insight type
    let searchQuery;
    let contextText;

    if (insightType === 'highlight') {
      // Highlight Insight: Use exact selected text
      contextText = selectedText || '';
      searchQuery = constructHighlightQuery(contextText);
    } else {
      // Page Insight: Use OCR text directly for keyword extraction
      contextText = ocrText || '';
      searchQuery = constructPageQuery(windowTitle, [], contextText);
    }

    logger.debug(`🔍 [NODE:INSIGHT] Search query: "${searchQuery}"`);

    // Perform web search and YouTube search in parallel with graceful failure handling
    let searchResults = [];
    let videoLinks = [];
    
    try {
      const [webResult, videoResult] = await Promise.allSettled([
        mcpClient.callService('web-search', 'web.search', {
          query: searchQuery,
          limit: insightType === 'page' ? 7 : 3
        }),
        searchYouTubeVideos(searchQuery)
      ]);
      
      if (webResult.status === 'fulfilled') {
        const searchData = webResult.value.data || webResult.value;
        searchResults = searchData.results || [];
        logger.debug(`✅ [NODE:INSIGHT] Found ${searchResults.length} web results`);
      } else {
        logger.warn(`⚠️  [NODE:INSIGHT] Web search failed: ${webResult.reason?.message || webResult.reason}`);
      }
      
      if (videoResult.status === 'fulfilled') {
        videoLinks = videoResult.value || [];
        logger.debug(`✅ [NODE:INSIGHT] Found ${videoLinks.length} video results`);
      } else {
        logger.warn(`⚠️  [NODE:INSIGHT] YouTube search failed: ${videoResult.reason?.message || videoResult.reason}`);
      }
    } catch (error) {
      logger.warn(`⚠️  [NODE:INSIGHT] Search failed: ${error.message}`);
      logger.debug(`⏭️  [NODE:INSIGHT] Continuing without search results (graceful degradation)`);
    }

    // If no search results, return null insights (graceful degradation)
    if (searchResults.length === 0) {
      logger.debug(`⏭️  [NODE:INSIGHT] No search results available, returning null insights`);
      return {
        ...state,
        insights: null
      };
    }

    // Format insights
    const insights = {
      type: insightType,
      query: searchQuery,
      summary: generateSummary(searchResults, contextText),
      links: searchResults.map(r => ({
        title: r.title,
        url: r.url || r.link,
        snippet: r.snippet || r.description || ''
      })),
      videoLinks: videoLinks,
      concepts: await extractConcepts(mcpClient, contextText),
      timestamp: Date.now()
    };

    // Cache the result
    if (!global.insightCache) {
      global.insightCache = new Map();
    }
    global.insightCache.set(cacheKey, {
      data: insights,
      timestamp: Date.now()
    });

    // Clean old cache entries (keep last 50)
    if (global.insightCache.size > 50) {
      const entries = Array.from(global.insightCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      entries.slice(0, entries.length - 50).forEach(([key]) => {
        global.insightCache.delete(key);
      });
    }

    // Save to database
    try {
      await saveInsightToDatabase(state, insights);
    } catch (dbError) {
      logger.warn(`⚠️  [NODE:INSIGHT] Failed to save to database: ${dbError.message}`);
    }

    return {
      ...state,
      insights
    };

  } catch (error) {
    logger.error('❌ [NODE:INSIGHT] Error:', error.message);
    return {
      ...state,
      insights: null,
      error: error.message
    };
  }
};

/**
 * Extract key entities from text using coreference service
 */
async function extractKeyEntities(mcpClient, text, windowTitle) {
  try {
    // Use first 500 chars for entity extraction
    const sample = text.substring(0, 500);
    
    // Call coreference service to extract entities
    const result = await mcpClient.callService('coreference', 'entities.extract', {
      text: sample
    });

    const entities = result.data?.entities || [];
    
    // Filter for important entity types
    const keyEntities = entities
      .filter(e => ['PERSON', 'ORG', 'GPE', 'WORK_OF_ART', 'EVENT', 'PRODUCT'].includes(e.type))
      .map(e => e.text)
      .slice(0, 5); // Top 5 entities

    logger.debug(`🏷️ [NODE:INSIGHT] Extracted entities: ${keyEntities.join(', ')}`);
    
    return keyEntities;
  } catch (error) {
    logger.warn('⚠️ [NODE:INSIGHT] Entity extraction failed:', error.message);
    // Fallback: extract capitalized words from window title
    return windowTitle
      .split(/\s+/)
      .filter(word => word.length > 2 && /^[A-Z]/.test(word))
      .slice(0, 3);
  }
}

/**
 * Extract key concepts from text (without coreference service)
 */
async function extractConcepts(mcpClient, text) {
  if (!text || text.length < 20) return [];
  
  // Extract concepts using simple keyword extraction
  // This avoids the coreference service which doesn't support entities.extract
  const keywords = extractKeywordsFromText(text);
  
  // Return top 8 keywords as concepts
  return keywords.slice(0, 8);
}

/**
 * Construct search query for Page Insight
 */
function constructPageQuery(windowTitle, entities, ocrText = '') {
  // Check if there's a custom query from a follow-up question
  if (global.insightCustomQuery) {
    logger.debug(`🎯 [NODE:INSIGHT] Using custom query: ${global.insightCustomQuery}`);
    // Combine custom query with OCR context for better results
    const contextWords = ocrText
      .substring(0, 500)
      .split(/\s+/)
      .filter(word => {
        const cleaned = word.replace(/[^a-zA-Z0-9]/g, '');
        return cleaned.length >= 3 && /[a-zA-Z]/.test(cleaned);
      })
      .slice(0, 20)
      .join(' ');
    
    return `${global.insightCustomQuery} ${contextWords}`.substring(0, 400);
  }
  
  // If we have OCR text, extract only clean, meaningful words
  if (ocrText && ocrText.length > 50) {
    // Extract only clean words (2+ chars, alphanumeric)
    const words = ocrText
      .substring(0, 1500)
      .split(/\s+/)
      .filter(word => {
        // Remove special chars and check if word is meaningful
        const cleaned = word.replace(/[^a-zA-Z0-9]/g, '');
        return cleaned.length >= 2 && 
               /[a-zA-Z]/.test(cleaned) && // Must contain at least one letter
               !/^\d+$/.test(cleaned); // Not just numbers
      })
      .map(word => word.replace(/[^a-zA-Z0-9\s]/g, '')) // Clean each word
      .filter(word => word.length >= 2);
    
    // Remove common UI words that aren't useful
    const stopwords = new Set(['home', 'search', 'menu', 'page', 'click', 'button', 'link', 
                                'about', 'privacy', 'focused', 'unread', 'starred', 'notifications']);
    
    const meaningfulWords = words
      .filter(w => !stopwords.has(w.toLowerCase()))
      .slice(0, 50); // Take first 50 meaningful words
    
    // Build query from meaningful words
    const query = meaningfulWords.join(' ').substring(0, 400);
    
    logger.debug(`🧹 [NODE:INSIGHT] Cleaned ${words.length} words → ${meaningfulWords.length} meaningful words`);
    
    // If we have enough meaningful content, use it
    if (query.length >= 30 && meaningfulWords.length >= 5) {
      return query;
    }
    
    // Otherwise fall back to keyword extraction
    return constructFallbackQuery(windowTitle, ocrText);
  }
  
  // Fallback: Extract keywords if OCR text is too short
  const textKeywords = extractKeywordsFromText(ocrText);
  
  // Clean window title (remove app name, file extensions)
  const cleanTitle = windowTitle
    .replace(/\s*[-–—]\s*[^-–—]+$/, '') // Remove " - AppName" suffix
    .replace(/\.(pdf|docx?|txt|html?)$/i, '') // Remove file extensions
    .replace(/^\(\d+\)\s*/, '') // Remove notification counts like "(33)"
    .replace(/Google Chrome|Safari|Firefox|Edge/gi, '') // Remove browser names
    .trim();

  // Prioritize: OCR keywords > title
  let queryParts = [];
  
  if (textKeywords.length > 0) {
    queryParts = textKeywords.slice(0, 5);
  } else if (cleanTitle) {
    queryParts = [cleanTitle];
  }
  
  return queryParts.join(' ').substring(0, 200);
}

/**
 * Fallback query construction when OCR text is too messy
 */
function constructFallbackQuery(windowTitle, ocrText) {
  const keywords = extractKeywordsFromText(ocrText);
  
  if (keywords.length > 0) {
    return keywords.slice(0, 5).join(' ');
  }
  
  // Last resort: use cleaned window title
  return windowTitle
    .replace(/\s*[-–—]\s*[^-–—]+$/, '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/Google Chrome|Safari|Firefox|Edge/gi, '')
    .trim();
}

/**
 * Extract meaningful keywords from OCR text
 */
function extractKeywordsFromText(text) {
  if (!text || text.length < 20) return [];
  
  // Get first 500 chars for better context
  const sample = text.substring(0, 500);
  
  // Common stopwords to filter out
  const stopwords = ['the', 'this', 'that', 'with', 'from', 'have', 'been', 'were', 'their', 'there', 
                     'google', 'chrome', 'safari', 'firefox', 'edge', 'browser', 'window', 'page'];
  
  // Extract capitalized phrases (names, titles, proper nouns)
  const capitalizedPhrases = sample.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) || [];
  
  // Extract all-caps words (acronyms, important terms)
  const allCaps = sample.match(/\b[A-Z]{2,}\b/g) || [];
  
  // Extract words with numbers (versions, dates, specific identifiers)
  const wordsWithNumbers = sample.match(/\b[A-Za-z]+\d+\b/g) || [];
  
  // Extract quoted text
  const quotedText = sample.match(/["']([^"']{3,40})["']/g) || [];
  
  // Combine all keywords
  const allKeywords = [
    ...capitalizedPhrases,
    ...allCaps,
    ...wordsWithNumbers,
    ...quotedText.map(q => q.replace(/["']/g, ''))
  ];
  
  // Clean and filter
  const keywords = allKeywords
    .map(k => k.trim())
    .filter(k => k.length > 2 && k.length < 50)
    .filter(k => !stopwords.includes(k.toLowerCase()))
    .filter((k, i, arr) => arr.indexOf(k) === i) // Remove duplicates
    .slice(0, 7);
  
  logger.debug(`🔑 [NODE:INSIGHT] Extracted keywords: ${keywords.join(', ')}`);
  
  return keywords;
}

/**
 * Construct search query for Highlight Insight
 */
function constructHighlightQuery(selectedText) {
  const text = selectedText.trim();
  
  // If it's a question, use as-is
  if (/[?¿]$/.test(text)) {
    return text;
  }
  
  // If it's a short phrase/word, add context
  if (text.split(/\s+/).length <= 3) {
    return `${text} explanation overview`;
  }
  
  // Otherwise use as-is
  return text.substring(0, 200);
}

/**
 * Generate summary from search results
 */
function generateSummary(searchResults, contextText) {
  if (searchResults.length === 0) {
    return 'No information found for this content.';
  }

  // Use first result's snippet as summary
  const firstResult = searchResults[0];
  const snippet = firstResult.snippet || firstResult.description || '';
  
  // Clean and truncate
  const summary = snippet
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Limit to ~200 chars (2-3 sentences)
  if (summary.length > 200) {
    const sentences = summary.match(/[^.!?]+[.!?]+/g) || [summary];
    return sentences.slice(0, 2).join(' ').substring(0, 200) + '...';
  }

  return summary || 'Information found. See links below for details.';
}

/**
 * Search YouTube for relevant videos using backend API
 */
async function searchYouTubeVideos(query) {
  try {
    logger.debug(`🔍 [YOUTUBE] Searching for: "${query}"`);
    
    // Call backend YouTube API
    const response = await fetch(`${getBackendApiUrl()}/api/youtube?${new URLSearchParams({
      q: query,
      maxResults: '5',
      order: 'relevance',
      type: 'video'
    })}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`YouTube API responded with ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const videos = data.videos || [];
    
    logger.debug(`✅ [YOUTUBE] Found ${videos.length} videos`);
    
    // Transform API response to expected format
    return videos.map(video => ({
      title: video.title,
      url: video.url || `https://www.youtube.com/watch?v=${video.id}`,
      thumbnail: video.thumbnail?.url || null,
      platform: 'youtube',
      duration: formatYouTubeDuration(video.duration),
      viewCount: video.viewCount,
      channel: video.channel?.title || 'Unknown Channel',
      publishedAt: video.publishedAt
    }));
    
  } catch (error) {
    logger.warn(`⚠️  [YOUTUBE] Search failed: ${error.message}`);
    
    // Fallback to YouTube search URL
    const searchQuery = encodeURIComponent(query);
    const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${searchQuery}`;
    
    return [
      {
        title: `${query} - Search on YouTube`,
        url: youtubeSearchUrl,
        thumbnail: null,
        platform: 'youtube',
        duration: '',
        viewCount: 0,
        channel: 'YouTube',
        publishedAt: new Date().toISOString()
      }
    ];
  }
}

/**
 * Get backend API URL from environment or default
 */
function getBackendApiUrl() {
  return process.env.BIBSCRIP_BASE_URL || 'http://localhost:4000';
}

/**
 * Format YouTube duration from ISO 8601 to human readable
 */
function formatYouTubeDuration(duration) {
  if (!duration) return '';
  
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return duration;

  const hours = (match[1] || '').replace('H', '');
  const minutes = (match[2] || '').replace('M', '');
  const seconds = (match[3] || '').replace('S', '');

  let result = '';
  if (hours) result += `${hours}:`;
  if (minutes) result += `${minutes.padStart(2, '0')}:`;
  if (seconds) result += seconds.padStart(2, '0');

  return result || duration;
}

/**
 * Save insight to database
 */
async function saveInsightToDatabase(state, insights) {
  const { windowTitle, ocrText } = state;
  const db = require('../../utils/duckdb-wrapper.cjs');
  
  const id = `insight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Wrap db.run in a promise since it uses callbacks
  await new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO insight_history (
        id, user_id, window_title, window_id, insight_type,
        query, summary, links, video_links, concepts, ocr_text, created_at, accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      id,
      'default_user',
      windowTitle || 'Unknown',
      null, // window_id can be added later if needed
      insights.type,
      insights.query,
      insights.summary,
      JSON.stringify(insights.links),
      JSON.stringify(insights.videoLinks),
      JSON.stringify(insights.concepts),
      ocrText ? ocrText.substring(0, 5000) : null // Limit OCR text size
    ], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  logger.debug(`💾 [NODE:INSIGHT] Saved insight to database: ${id}`);
}

/**
 * Simple string hash for cache keys
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
