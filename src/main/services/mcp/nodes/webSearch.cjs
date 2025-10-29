/**
 * Web Search Node
 * Performs web search for factual queries
 */

module.exports = async function webSearch(state) {
  const { mcpClient, message, intent } = state;

  console.log('🌐 [NODE:WEB_SEARCH] Performing web search...');

  try {
    // Extract search query
    const query = message.replace(/^(search for|search|find|look up|google)\s+/i, '').trim();
    
    console.log(`🔍 [NODE:WEB_SEARCH] Query: "${query}"`);

    // Call web-search service
    const result = await mcpClient.callService('web-search', 'search.web', {
      query: query,
      limit: 5
    });

    const searchResults = result.results || [];
    
    console.log(`✅ [NODE:WEB_SEARCH] Found ${searchResults.length} results`);

    return {
      ...state,
      searchResults,
      contextDocs: searchResults.map(r => ({
        id: r.url || r.link,
        text: `${r.title}\n${r.snippet || r.description || ''}`,
        source: 'web_search',
        url: r.url || r.link
      }))
    };
  } catch (error) {
    console.error('❌ [NODE:WEB_SEARCH] Error:', error.message);
    return {
      ...state,
      searchResults: [],
      contextDocs: [],
      error: error.message
    };
  }
};
