/**
 * Resolve References Node
 * Resolves pronouns and references using the coreference MCP service
 * 
 * This node calls the Python-based coreference service to resolve:
 * - Pronouns: "he", "she", "it", "they" → actual names
 * - References: "the show", "the cartoon", "the movie" → specific titles
 * - Demonstratives: "that", "this" → specific entities
 */

module.exports = async function resolveReferences(state) {
  const { mcpClient, message, conversationHistory = [], context } = state;

  console.log('🔍 [NODE:RESOLVE_REFERENCES] Resolving coreferences...');
  console.log(`📝 [NODE:RESOLVE_REFERENCES] Original message: "${message}"`);

  try {
    // Call coreference service
    const result = await mcpClient.callService('coreference', 'resolve', {
      message,
      conversationHistory: conversationHistory.slice(-5), // Last 5 messages for context
      options: {
        includeConfidence: true,
        method: 'auto' // auto, neuralcoref, or rule_based
      }
    });

    // MCP protocol wraps response in 'data' field
    const data = result.data || result;
    const resolvedMessage = data.resolvedMessage || message;
    const replacements = data.replacements || [];
    const method = data.method || 'unknown';

    // Log results
    if (replacements.length > 0) {
      console.log(`✅ [NODE:RESOLVE_REFERENCES] Resolved ${replacements.length} reference(s) using ${method}`);
      replacements.forEach(r => {
        console.log(`   📌 "${r.original}" → "${r.resolved}" (confidence: ${(r.confidence * 100).toFixed(1)}%)`);
      });
      console.log(`📝 [NODE:RESOLVE_REFERENCES] Resolved message: "${resolvedMessage}"`);
    } else {
      console.log('ℹ️  [NODE:RESOLVE_REFERENCES] No references to resolve');
    }

    return {
      ...state,
      message: resolvedMessage, // Replace with resolved message
      originalMessage: message, // Keep original for debugging
      coreferenceReplacements: replacements,
      coreferenceMethod: method
    };
  } catch (error) {
    console.warn('⚠️ [NODE:RESOLVE_REFERENCES] Resolution failed, using original message:', error.message);
    
    // Graceful fallback - continue with original message
    // This ensures the system still works even if coreference service is down
    return {
      ...state,
      originalMessage: message,
      coreferenceReplacements: [],
      coreferenceMethod: 'fallback'
    };
  }
};
