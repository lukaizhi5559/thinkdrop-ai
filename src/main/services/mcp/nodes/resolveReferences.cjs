/**
 * Resolve References Node
 * Resolves pronouns and references using the coreference MCP service
 * 
 * This node calls the Python-based coreference service to resolve:
 * - Pronouns: "he", "she", "it", "they" → actual names
 * - References: "the show", "the cartoon", "the movie" → specific titles
 * - Demonstratives: "that", "this" → specific entities
 */

/**
 * Strip HTML tags from text to avoid confusing the coreference resolver
 * @param {string} text - Text that may contain HTML tags
 * @returns {string} - Clean text without HTML tags
 */
function stripHtmlTags(text) {
  if (!text) return text;
  // Remove HTML tags like <strong>, <em>, <b>, etc.
  return text.replace(/<[^>]*>/g, '');
}

module.exports = async function resolveReferences(state) {
  const { mcpClient, message, conversationHistory = [], context, intentType } = state;

  console.log('🔍 [NODE:RESOLVE_REFERENCES] Resolving coreferences...');
  console.log(`📝 [NODE:RESOLVE_REFERENCES] Original message: "${message}"`);
  
  // CRITICAL FIX: For screen_intelligence intents, don't use conversation history
  // because references like "this guy" refer to screen content, not previous conversation
  const isScreenIntent = intentType === 'screen_intelligence';
  if (isScreenIntent) {
    console.log('🖥️  [NODE:RESOLVE_REFERENCES] Screen intelligence intent - skipping conversation history to avoid incorrect resolutions');
  }

  // NOTE: We always run coreference resolution here, but the answer node will use the
  // original message (not the resolved one) for screen_intelligence intent.
  // This allows coreference to work for other intents while preserving "this" references
  // to screen content for screen intelligence requests.

  // Use intelligent coreference service with spaCy NER
  // The Python service now uses Named Entity Recognition to smartly resolve:
  // - Pronouns: "he" → "Donald Trump" (finds PERSON entities)
  // - References: "the president" → "Donald Trump" (semantic matching)
  // - Works for any entity type: people, companies, movies, places, etc.
  const ENABLE_COREFERENCE_SERVICE = true; // Now uses smart NER-based resolution
  
  if (!ENABLE_COREFERENCE_SERVICE) {
    console.log('⏭️  [NODE:RESOLVE_REFERENCES] Coreference service disabled');
    return {
      ...state,
      message: message,
      originalMessage: message,
      coreferenceReplacements: [],
      coreferenceMethod: 'disabled'
    };
  }

  try {
    // CRITICAL: Fetch FRESH conversation history to include most recent AI responses
    // The conversationHistory from state was fetched at the START of orchestration,
    // so it doesn't include the previous AI response that just happened
    let freshConversationHistory = conversationHistory;
    
    try {
      const messagesResult = await mcpClient.callService('conversation', 'message.list', {
        sessionId: context.sessionId,
        limit: 10,
        direction: 'DESC'
      });
      
      const messagesData = messagesResult.data || messagesResult;
      // Messages come in DESC order (newest first), reverse to chronological (oldest first)
      freshConversationHistory = (messagesData.messages || [])
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: stripHtmlTags(msg.text), // Strip HTML tags to avoid confusing coreference resolver
          timestamp: msg.timestamp
        }))
        .reverse(); // CRITICAL: Reverse to chronological order for coreference context
      
      console.log(`🔄 [NODE:RESOLVE_REFERENCES] Fetched ${freshConversationHistory.length} fresh messages for coreference context`);
      console.log(`📋 [NODE:RESOLVE_REFERENCES] Last 5 messages being sent to coreference (chronological):`);
      freshConversationHistory.slice(-5).forEach((msg, i) => {
        const idx = freshConversationHistory.length - 5 + i + 1;
        console.log(`   ${idx}. [${msg.role}] ${msg.content.substring(0, 80)}... (${msg.timestamp})`);
      });
    } catch (fetchError) {
      console.warn('⚠️ [NODE:RESOLVE_REFERENCES] Failed to fetch fresh history, using cached:', fetchError.message);
      // Fall back to cached conversationHistory from state
    }
    
    // Call coreference service with fresh history
    // For screen_intelligence intents, pass empty history to avoid incorrect resolutions
    const historyToUse = isScreenIntent ? [] : freshConversationHistory.slice(-5);
    
    const result = await mcpClient.callService('coreference', 'resolve', {
      message,
      conversationHistory: historyToUse, // Empty for screen intents, last 5 for others
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
      resolvedMessage: resolvedMessage, // Set resolved message for downstream nodes
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
      resolvedMessage: message, // Use original message as resolved
      originalMessage: message,
      coreferenceReplacements: [],
      coreferenceMethod: 'fallback'
    };
  }
};
