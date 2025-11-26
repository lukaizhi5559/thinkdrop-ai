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
const logger = require('./../../../logger.cjs');
function stripHtmlTags(text) {
  if (!text) return text;
  // Remove HTML tags like <strong>, <em>, <b>, etc.
  return text.replace(/<[^>]*>/g, '');
}

module.exports = async function resolveReferences(state) {
  const { mcpClient, message, conversationHistory = [], context, intentType } = state;

  logger.debug('🔍 [NODE:RESOLVE_REFERENCES] Resolving coreferences...');
  logger.debug(`📝 [NODE:RESOLVE_REFERENCES] Original message: "${message}"`);
  
  // CRITICAL FIX: If highlighted text is present, use it as fresh context instead of conversation history
  // When user highlights text, "this" refers to the highlighted content, not previous conversation
  const hasHighlightedText = context?.metadata?.hasHighlightedText === true;
  const highlightedText = state.detectedSelection?.text || context?.highlightedText;
  
  logger.debug('📋 [NODE:RESOLVE_REFERENCES] Checking for highlighted text:');
  logger.debug('   - hasHighlightedText flag:', hasHighlightedText);
  logger.debug('   - state.detectedSelection?.text:', state.detectedSelection?.text ? `"${state.detectedSelection.text.substring(0, 50)}..."` : 'undefined');
  logger.debug('   - context?.highlightedText:', context?.highlightedText ? `"${context.highlightedText.substring(0, 50)}..."` : 'undefined');
  logger.debug('   - Final highlightedText:', highlightedText ? `"${highlightedText.substring(0, 50)}..."` : 'undefined');
  
  if (hasHighlightedText && highlightedText) {
    logger.debug(`📎 [NODE:RESOLVE_REFERENCES] Highlighted text detected - using as fresh context for coreference resolution`);
    logger.debug(`   Highlighted: "${highlightedText.substring(0, 100)}..."`);
  } else if (hasHighlightedText && !highlightedText) {
    logger.warn('⚠️ [NODE:RESOLVE_REFERENCES] hasHighlightedText is true but no highlightedText content found!');
  }
  
  // CRITICAL FIX: For screen_intelligence intents, don't use conversation history
  // because references like "this guy" refer to screen content, not previous conversation
  const isScreenIntent = intentType === 'screen_intelligence';
  if (isScreenIntent) {
    logger.debug('🖥️  [NODE:RESOLVE_REFERENCES] Screen intelligence intent - skipping conversation history to avoid incorrect resolutions');
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
    logger.debug('⏭️  [NODE:RESOLVE_REFERENCES] Coreference service disabled');
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
      
      logger.debug(`🔄 [NODE:RESOLVE_REFERENCES] Fetched ${freshConversationHistory.length} fresh messages for coreference context`);
      logger.debug(`📋 [NODE:RESOLVE_REFERENCES] Last 5 messages being sent to coreference (chronological):`);
      freshConversationHistory.slice(-5).forEach((msg, i) => {
        const idx = freshConversationHistory.length - 5 + i + 1;
        logger.debug(`   ${idx}. [${msg.role}] ${msg.content.substring(0, 80)}... (${msg.timestamp})`);
      });
    } catch (fetchError) {
      logger.warn('⚠️ [NODE:RESOLVE_REFERENCES] Failed to fetch fresh history, using cached:', fetchError.message);
      // Fall back to cached conversationHistory from state
    }
    
    // Call coreference service with appropriate context:
    // 1. If highlighted text present → Use highlighted text as fresh context (single message)
    // 2. If screen intent → Use empty history (references point to screen)
    // 3. Otherwise → Use conversation history (last 5 messages)
    let historyToUse;
    
    if (hasHighlightedText && highlightedText) {
      // Create a synthetic "assistant" message with the highlighted text as context
      // CRITICAL: Wrap in a sentence to help spaCy NER recognize full entity names
      // E.g., "Arfrix Dela Cruz" → "The highlighted text is: Arfrix Dela Cruz"
      const wrappedContent = `The highlighted text is: ${highlightedText}`;
      
      historyToUse = [{
        role: 'assistant',
        content: wrappedContent,
        timestamp: new Date().toISOString()
      }];
      logger.debug('📎 [NODE:RESOLVE_REFERENCES] Using highlighted text as coreference context (1 synthetic message)');
    } else if (isScreenIntent) {
      historyToUse = [];
    } else {
      historyToUse = freshConversationHistory.slice(-5);
    }
    
    const result = await mcpClient.callService('coreference', 'resolve', {
      message,
      conversationHistory: historyToUse,
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
      logger.debug(`✅ [NODE:RESOLVE_REFERENCES] Resolved ${replacements.length} reference(s) using ${method}`);
      replacements.forEach(r => {
        logger.debug(`   📌 "${r.original}" → "${r.resolved}" (confidence: ${(r.confidence * 100).toFixed(1)}%)`);
      });
      logger.debug(`📝 [NODE:RESOLVE_REFERENCES] Resolved message: "${resolvedMessage}"`);
    } else {
      logger.debug('ℹ️  [NODE:RESOLVE_REFERENCES] No references to resolve');
    }

    return {
      ...state,
      resolvedMessage: resolvedMessage, // Set resolved message for downstream nodes
      originalMessage: message, // Keep original for debugging
      coreferenceReplacements: replacements,
      coreferenceMethod: method
    };
  } catch (error) {
    logger.warn('⚠️ [NODE:RESOLVE_REFERENCES] Resolution failed, using original message:', error.message);
    
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
