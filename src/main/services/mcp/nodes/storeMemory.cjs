/**
 * Store Memory Node
 * Stores user memory directly (for memory_store intent)
 */

module.exports = async function storeMemory(state) {
  const { mcpClient, message, intent, context } = state;

  console.log('💾 [NODE:STORE_MEMORY] Storing memory...');

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
      metadata: {
        source: 'user_input',
        intent: intent.type,
        confidence: intent.confidence,
        entities: entities,
        sessionId: context.sessionId,
        userId: context.userId,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

    console.log('✅ [NODE:STORE_MEMORY] Memory stored successfully');

    return {
      ...state,
      memoryStored: true,
      memoryId: result.id,
      answer: "Got it! I'll remember that."
    };
  } catch (error) {
    console.error('❌ [NODE:STORE_MEMORY] Error:', error.message);
    return {
      ...state,
      memoryStored: false,
      error: error.message,
      answer: "I had trouble storing that memory. Please try again."
    };
  }
};
