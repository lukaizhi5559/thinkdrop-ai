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
      // Conversation history - use semantic search for better context
      mcpClient.callService('conversation', 'message.search', {
        sessionId: context.sessionId,
        query: message,
        limit: 10,
        minSimilarity: 0.3,
        includeRecent: 3 // Always include 3 most recent messages
      }).catch(err => {
        console.warn('⚠️ [NODE:RETRIEVE_MEMORY] Semantic search failed, falling back to chronological:', err.message);
        // Fallback to chronological if semantic search fails
        return mcpClient.callService('conversation', 'message.list', {
          sessionId: context.sessionId,
          limit: 10,
          direction: 'DESC'
        }).catch(() => ({ messages: [] }));
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
    // CRITICAL: Messages come in DESC order (newest first), but LLM needs chronological order (oldest first)
    // We must reverse the array so the LLM can follow the conversation flow correctly
    const conversationHistory = (conversationData.messages || [])
      .map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text,
        timestamp: msg.timestamp
      }))
      .reverse(); // Reverse to chronological order (oldest → newest)

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
