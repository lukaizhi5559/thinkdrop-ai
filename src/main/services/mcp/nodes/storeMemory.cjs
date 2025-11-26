/**
 * Store Memory Node
 * Stores user memory directly (for memory_store intent)
 */

const logger = require('./../../../logger.cjs');
module.exports = async function storeMemory(state) {
  const { mcpClient, message, intent, context } = state;

  logger.debug('💾 [NODE:STORE_MEMORY] Storing memory...');

  try {
    // Extract entities if available
    const entities = intent.entities || [];
    
    // Build tags
    const tags = ['user_memory', intent.type];
    if (entities.length > 0) {
      entities.forEach(e => {
        if (e.type) tags.push(e.type);
      });
    }

    // Store in user-memory service
    const result = await mcpClient.callService('user-memory', 'memory.store', {
      text: message,
      tags: tags,
      entities: entities, // TOP-LEVEL: Required for memory_entities table
      metadata: {
        source: 'user_input',
        intent: intent.type,
        confidence: intent.confidence,
        entities: entities, // Also in metadata for reference
        sessionId: context.sessionId,
        userId: context.userId,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

    // MCP protocol wraps response in 'data' field
    const memoryData = result.data || result;

    logger.debug('✅ [NODE:STORE_MEMORY] Memory stored successfully');

    // Use the suggestedResponse from intent parser, or fallback
    const response = intent.suggestedResponse || "Got it! I'll remember that.";

    return {
      ...state,
      memoryStored: true,
      memoryId: memoryData.id,
      answer: response
    };
  } catch (error) {
    logger.error('❌ [NODE:STORE_MEMORY] Error:', error.message);
    return {
      ...state,
      memoryStored: false,
      error: error.message,
      answer: "I had trouble storing that memory. Please try again."
    };
  }
};
