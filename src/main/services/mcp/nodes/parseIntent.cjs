/**
 * Parse Intent Node
 * Extracts intent and entities from user message via phi4 service
 */

module.exports = async function parseIntent(state) {
  const { mcpClient, message, resolvedMessage, context } = state;

  // Use resolved message if available (after coreference resolution), otherwise use original
  const messageToClassify = resolvedMessage || message;
  
  console.log(' [NODE:PARSE_INTENT] Parsing intent...');
  if (resolvedMessage && resolvedMessage !== message) {
    console.log(`📝 [NODE:PARSE_INTENT] Using resolved message: "${message}" → "${resolvedMessage}"`);
  }

  try {
    const result = await mcpClient.callService('phi4', 'intent.parse', {
      message: messageToClassify,
      context: {
        sessionId: context.sessionId,
        userId: context.userId
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
        requiresMemory: intentData.requiresMemory || false
      }
    };
  } catch (error) {
    console.error(' [NODE:PARSE_INTENT] Failed:', error.message);
    throw error;
  }
};
