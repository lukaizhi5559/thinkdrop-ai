/**
 * Web Search Node
 * Performs web search for factual queries
 */

const logger = require('./../../../logger.cjs');
module.exports = async function webSearch(state) {
  const { mcpClient, message, resolvedMessage, intent } = state;

  logger.debug('🌐 [NODE:WEB_SEARCH] Performing web search...');

  try {
    // Use resolved message if available (after coreference resolution), otherwise original
    const searchMessage = resolvedMessage || message;
    
    // Extract search query
    const query = searchMessage.replace(/^(search for|search|find|look up|google)\s+/i, '').trim();
    
    logger.debug(`🔍 [NODE:WEB_SEARCH] Query: "${query}"`);

    // Call web-search service (limit 3 for faster response)
    const result = await mcpClient.callService('web-search', 'web.search', {
      query: query,
      limit: 3
    });

    // MCP protocol wraps response in 'data' field
    const searchData = result.data || result;
    const searchResults = searchData.results || [];
    
    logger.debug(`✅ [NODE:WEB_SEARCH] Found ${searchResults.length} results`);

    // Populate intentContext.slots for overlay system
    // Preserve existing intent (could be 'web_search', 'question', or 'general_knowledge')
    const intentContext = state.intentContext || { intent: intent?.type || 'web_search', slots: {}, uiVariant: null };
    intentContext.slots = {
      ...intentContext.slots,
      results: searchResults.map(r => ({
        title: r.title,
        snippet: r.snippet || r.description || '',
        url: r.url || r.link
      })),
      subject: query
    };

    return {
      ...state,
      intentContext,
      searchResults,
      contextDocs: searchResults.map(r => ({
        id: r.url || r.link,
        text: `${r.title}\n${r.snippet || r.description || ''}`,
        source: 'web_search',
        url: r.url || r.link
      }))
    };
  } catch (error) {
    logger.error('❌ [NODE:WEB_SEARCH] Error:', error.message);
    return {
      ...state,
      searchResults: [],
      contextDocs: [],
      error: error.message
    };
  }
};
