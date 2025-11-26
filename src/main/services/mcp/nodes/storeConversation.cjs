/**
 * Store Conversation Node
 * Stores the conversation exchange in memory for future context
 */

const logger = require('./../../../logger.cjs');
module.exports = async function storeConversation(state) {
  const { mcpClient, message, resolvedMessage, answer, context, intent } = state;
  
  // Use resolved message if available (after coreference resolution), otherwise original
  const userMessage = resolvedMessage || message;

  logger.debug('💾 [NODE:STORE_CONVERSATION] Storing conversation exchange...');

  try {
    // Build storage text
    const storageText = `User asked: "${userMessage}"\nAssistant responded: "${answer}"`;

    // Start with entities from user's message (extracted during intent parsing)
    const userEntities = intent.entities || [];
    logger.debug(`📋 [NODE:STORE_CONVERSATION] User message entities: ${userEntities.length}`, userEntities);

    // Extract entities from AI response (contains rich information like names, dates, places)
    let responseEntities = [];
    try {
      const extractResult = await mcpClient.callService('phi4', 'entity.extract', {
        text: answer
      });
      responseEntities = extractResult.data?.entities || extractResult.entities || [];
      logger.debug(`📋 [NODE:STORE_CONVERSATION] AI response entities: ${responseEntities.length}`, responseEntities);
    } catch (error) {
      logger.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to extract entities from response:', error.message);
    }

    // Combine entities from both user message and AI response
    // Remove duplicates based on value (case-insensitive)
    const seenValues = new Set();
    const entities = [...userEntities, ...responseEntities].filter(entity => {
      const key = entity.value?.toLowerCase();
      if (!key || seenValues.has(key)) return false;
      seenValues.add(key);
      return true;
    });
    
    logger.debug(`📋 [NODE:STORE_CONVERSATION] Total unique entities: ${entities.length}`, entities);

    // Store in user-memory
    await mcpClient.callService('user-memory', 'memory.store', {
      text: storageText,
      tags: ['conversation', 'auto_stored', intent.type],
      entities: entities, // TOP-LEVEL: Required for memory_entities table
      metadata: {
        userMessage: userMessage,
        aiResponse: answer,
        sessionId: context.sessionId,
        userId: context.userId,
        source: 'conversation_auto_store',
        intent: intent.type,
        confidence: intent.confidence,
        entities: entities, // Also in metadata for reference
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

    logger.debug('✅ [NODE:STORE_CONVERSATION] Conversation stored for future context');

    return {
      ...state,
      conversationStored: true
    };
  } catch (error) {
    logger.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to store conversation:', error.message);
    // Don't fail the entire workflow if storage fails
    return {
      ...state,
      conversationStored: false,
      storageError: error.message
    };
  }
};
