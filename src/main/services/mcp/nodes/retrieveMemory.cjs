/**
 * Retrieve Memory Node
 * Fetches conversation history, session context, and long-term memories in parallel
 */

module.exports = async function retrieveMemory(state) {
  const { mcpClient, message, context, intent } = state;

  console.log('🔍 [NODE:RETRIEVE_MEMORY] Fetching context (parallel)...');

  try {
    // Parallel fetch: conversation history, session context, and memories
    const [conversationResult, sessionContextResult, memoriesResult] = await Promise.all([
      // Conversation history
      mcpClient.callService('conversation', 'message.list', {
        sessionId: context.sessionId,
        limit: 10,
        direction: 'DESC'
      }).catch(err => {
        console.warn('⚠️ [NODE:RETRIEVE_MEMORY] Conversation fetch failed:', err.message);
        return { messages: [] };
      }),

      // Session context
      mcpClient.callService('conversation', 'context.get', {
        sessionId: context.sessionId
      }).catch(err => {
        console.warn('⚠️ [NODE:RETRIEVE_MEMORY] Session context fetch failed:', err.message);
        return { facts: [], entities: [] };
      }),

      // Long-term memories (only if not a meta-question)
      intent.type !== 'context_query' 
        ? mcpClient.callService('user-memory', 'memory.search', {
            query: message,
            limit: 5,
            sessionId: context.sessionId,
            userId: context.userId,
            minSimilarity: 0.4
          }).catch(err => {
            console.warn('⚠️ [NODE:RETRIEVE_MEMORY] Memory search failed:', err.message);
            return { results: [] };
          })
        : Promise.resolve({ results: [] })
    ]);

    // MCP protocol wraps responses in 'data' field
    const conversationData = conversationResult.data || conversationResult;
    const sessionContextData = sessionContextResult.data || sessionContextResult;
    const memoriesData = memoriesResult.data || memoriesResult;

    // Process conversation history
    const conversationHistory = (conversationData.messages || []).map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text,
      timestamp: msg.timestamp
    }));

    // Process memories
    const memories = (memoriesData.results || []).map(mem => ({
      id: mem.id,
      text: mem.text,
      similarity: mem.similarity,
      entities: mem.entities || [],
      metadata: mem.metadata || {},
      created_at: mem.created_at
    }));

    console.log(`✅ [NODE:RETRIEVE_MEMORY] Loaded ${conversationHistory.length} messages, ${memories.length} memories`);

    return {
      ...state,
      conversationHistory,
      sessionFacts: sessionContextData.facts || [],
      sessionEntities: sessionContextData.entities || [],
      memories,
      rawMemoriesCount: memories.length
    };
  } catch (error) {
    console.error('❌ [NODE:RETRIEVE_MEMORY] Failed:', error.message);
    throw error;
  }
};
