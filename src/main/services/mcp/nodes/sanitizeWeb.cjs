/**
 * Sanitize Web Node
 * Sanitizes and validates web search results before using them
 */

module.exports = async function sanitizeWeb(state) {
  const { contextDocs } = state;

  console.log('🧹 [NODE:SANITIZE_WEB] Sanitizing web results...');

  try {
    if (!contextDocs || contextDocs.length === 0) {
      console.log('⚠️ [NODE:SANITIZE_WEB] No results to sanitize');
      return state;
    }

    // Basic sanitization: remove empty results, truncate long text
    const sanitized = contextDocs
      .filter(doc => doc.text && doc.text.trim().length > 0)
      .map(doc => ({
        ...doc,
        text: doc.text.slice(0, 1000), // Truncate to 1000 chars
        sanitized: true
      }));

    console.log(`✅ [NODE:SANITIZE_WEB] Sanitized ${sanitized.length}/${contextDocs.length} results`);

    return {
      ...state,
      contextDocs: sanitized
    };
  } catch (error) {
    console.error('❌ [NODE:SANITIZE_WEB] Error:', error.message);
    // Don't fail the workflow, just pass through
    return state;
  }
};
