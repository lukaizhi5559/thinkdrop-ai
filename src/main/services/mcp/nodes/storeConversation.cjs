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

    // IMPORTANT: Do NOT store conversations in user-memory database
    // Conversations are already stored in conversation service (conversation.duckdb)
    // User-memory (user_memory.duckdb) should ONLY contain explicit memories from memory_store intent
    // 
    // This prevents pollution of user-memory with every query/question
    // Examples of what should NOT be in user-memory:
    // - "do I have any appts" (question - goes to conversation history only)
    // - "what time is it" (question - goes to conversation history only)
    // - "what's the weather" (question - goes to conversation history only)
    //
    // Examples of what SHOULD be in user-memory:
    // - "Set a reminder that I have appt. in two weeks" (memory_store intent)
    // - "Remember my favorite coffee is oat milk latte" (memory_store intent)
    // - "My car's VIN is ABC123" (memory_store intent)
    
    logger.debug('✅ [NODE:STORE_CONVERSATION] Conversation stored in conversation service (not user-memory)');

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
