/**
 * Store Conversation Node
 * Stores the conversation exchange in memory for future context
 */

module.exports = async function storeConversation(state) {
  const { mcpClient, message, answer, context, intent } = state;

  console.log('💾 [NODE:STORE_CONVERSATION] Storing conversation exchange...');

  try {
    // Build storage text
    const storageText = `User asked: "${message}"\nAssistant responded: "${answer}"`;

    // Store in user-memory
    await mcpClient.callService('user-memory', 'memory.store', {
      text: storageText,
      tags: ['conversation', 'auto_stored', intent.type],
      metadata: {
        userMessage: message,
        aiResponse: answer,
        sessionId: context.sessionId,
        userId: context.userId,
        source: 'conversation_auto_store',
        intent: intent.type,
        confidence: intent.confidence,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

    console.log('✅ [NODE:STORE_CONVERSATION] Conversation stored for future context');

    return {
      ...state,
      conversationStored: true
    };
  } catch (error) {
    console.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to store conversation:', error.message);
    // Don't fail the entire workflow if storage fails
    return {
      ...state,
      conversationStored: false,
      storageError: error.message
    };
  }
};
