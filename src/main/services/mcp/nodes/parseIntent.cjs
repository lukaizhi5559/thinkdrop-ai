/**
 * Parse Intent Node
 * Extracts intent and entities from user message
 */

module.exports = async function parseIntent(state) {
  const { mcpClient, message, context } = state;

  console.log('🧠 [NODE:PARSE_INTENT] Parsing intent...');

  try {
    const result = await mcpClient.callService('phi4', 'intent.parse', {
      message,
      context: {
        sessionId: context.sessionId,
        userId: context.userId
      }
    });

    return {
      ...state,
      intent: {
        type: result.intent || 'general_query',
        confidence: result.confidence || 0.5,
        entities: result.entities || [],
        requiresMemory: result.requiresMemory || false
      }
    };
  } catch (error) {
    console.error('❌ [NODE:PARSE_INTENT] Failed:', error.message);
    throw error;
  }
};
