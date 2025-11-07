/**
 * Parse Intent Node
 * Extracts intent and entities from user message via phi4 service
 */

module.exports = async function parseIntent(state) {
  const { mcpClient, message, resolvedMessage, context, conversationMessages } = state;

  // Use resolved message if available (after coreference resolution), otherwise use original
  const messageToClassify = resolvedMessage || message;
  
  console.log(' [NODE:PARSE_INTENT] Parsing intent...');
  if (resolvedMessage && resolvedMessage !== message) {
    console.log(`📝 [NODE:PARSE_INTENT] Using resolved message: "${message}" → "${resolvedMessage}"`);
  }

  // Fetch recent conversation messages for context-aware intent classification
  let recentMessages = [];
  try {
    const messagesResult = await mcpClient.callService('conversation', 'message.list', {
      sessionId: context.sessionId,
      limit: 5,
      direction: 'DESC'
    });
    
    const messagesData = messagesResult.data || messagesResult;
    const messages = messagesData.messages || [];
    
    // Convert to format expected by phi4 (chronological order)
    recentMessages = messages.reverse().map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text,
      timestamp: msg.created_at || msg.timestamp
    }));
    
    console.log(`📚 [NODE:PARSE_INTENT] Including ${recentMessages.length} recent messages for context`);
  } catch (error) {
    console.warn('⚠️ [NODE:PARSE_INTENT] Failed to fetch conversation history:', error.message);
    // Continue without conversation history
  }

  try {
    // 🎯 CONTEXT-AWARE INTENT: Include previous exchange for better classification
    // This helps with elliptical messages like "nothing next week" after "do I have any appts"
    let enhancedMessage = messageToClassify;
    if (recentMessages.length >= 2) {
      const lastUserMsg = recentMessages[recentMessages.length - 3];
      const lastAiMsg = recentMessages[recentMessages.length - 2];
      
      // If current message is very short (≤4 words), prepend context hint
      if (messageToClassify.split(/\s+/).length <= 4 && lastUserMsg && lastAiMsg) {
        enhancedMessage = `[Previous question: "${lastUserMsg.content}"] [AI response: "${lastAiMsg.content.substring(0, 100)}..."] [Current: "${messageToClassify}"]`;
        console.log(`🔗 [NODE:PARSE_INTENT] Enhanced short message with context for better classification`);
      }
    }
    
    const result = await mcpClient.callService('phi4', 'intent.parse', {
      message: enhancedMessage,
      context: {
        sessionId: context.sessionId,
        userId: context.userId,
        conversationHistory: recentMessages // Add conversation history for context-aware classification
      }
    });

    // MCP protocol wraps response in 'data' field
    const intentData = result.data || result;

    return {
      ...state,
      intent: {
        type: intentData.intent || 'general_query',
        confidence: intentData.confidence || 0.5,
        entities: intentData.entities || [],
        requiresMemory: intentData.requiresMemory || false,
        suggestedResponse: intentData.suggestedResponse // Pass through for memory_store
      }
    };
  } catch (error) {
    console.error(' [NODE:PARSE_INTENT] Failed:', error.message);
    throw error;
  }
};
