/**
 * Retrieve Memory Node
 * Fetches conversation history, session context, and long-term memories in parallel
 */

const logger = require('./../../../logger.cjs');

/**
 * Calculate Levenshtein distance between two strings (simple text similarity)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Calculate text similarity ratio (0-1) between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity ratio (0 = completely different, 1 = identical)
 */
function textSimilarity(a, b) {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return 1 - (distance / maxLength);
}

/**
 * Deduplicate memories by removing near-duplicates
 * Keeps the memory with highest similarity score when duplicates are found
 * @param {Array} memories - Array of memory objects
 * @returns {Array} - Deduplicated memories
 */
function deduplicateMemories(memories) {
  if (memories.length <= 1) return memories;
  
  const deduplicated = [];
  const SIMILARITY_THRESHOLD = 0.85; // 85% similar = considered duplicate
  
  for (const memory of memories) {
    // Check if this memory is similar to any already added
    const isDuplicate = deduplicated.some(existing => {
      const similarity = textSimilarity(memory.text, existing.text);
      
      if (similarity >= SIMILARITY_THRESHOLD) {
        // If new memory has higher similarity score, replace the existing one
        if (memory.similarity > existing.similarity) {
          const index = deduplicated.indexOf(existing);
          deduplicated[index] = memory;
          logger.debug(`🔄 [DEDUP] Replaced duplicate: "${existing.text}" → "${memory.text}" (${(similarity * 100).toFixed(0)}% similar)`);
        } else {
          logger.debug(`🚫 [DEDUP] Skipped duplicate: "${memory.text}" (${(similarity * 100).toFixed(0)}% similar to "${existing.text}")`);
        }
        return true; // Mark as duplicate
      }
      return false;
    });
    
    if (!isDuplicate) {
      deduplicated.push(memory);
    }
  }
  
  return deduplicated;
}
module.exports = async function retrieveMemory(state) {
  const { mcpClient, message, context, intent } = state;

  logger.debug('🔍 [NODE:RETRIEVE_MEMORY] Fetching context (parallel)...');

  try {
    // Parallel fetch: conversation history, session context, and memories
    const [conversationResult, sessionContextResult, memoriesResult] = await Promise.all([
      // Conversation history - get recent messages chronologically
      // Note: conversation service doesn't support semantic search yet
      mcpClient.callService('conversation', 'message.list', {
        sessionId: context.sessionId,
        limit: 10,
        direction: 'DESC'
      }).catch(err => {
        logger.warn('⚠️ [NODE:RETRIEVE_MEMORY] Conversation history fetch failed:', err.message);
        return { messages: [] };
      }),

      // Session context
      mcpClient.callService('conversation', 'context.get', {
        sessionId: context.sessionId
      }).catch(err => {
        logger.warn('⚠️ [NODE:RETRIEVE_MEMORY] Session context fetch failed:', err.message);
        return { facts: [], entities: [] };
      }),

      // Long-term memories (only if not a meta-question)
      // NOTE: No sessionId - memories are user-scoped and accessible across all sessions
      intent.type !== 'context_query' 
        ? mcpClient.callService('user-memory', 'memory.search', {
            query: message,
            limit: 5,
            userId: context.userId,
            minSimilarity: 0.35 // Lowered to capture appointment queries (38% similarity)
          }).catch(err => {
            logger.warn('⚠️ [NODE:RETRIEVE_MEMORY] Memory search failed:', err.message);
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
    const rawMemories = (memoriesData.results || []).map(mem => ({
      id: mem.id,
      text: mem.text,
      similarity: mem.similarity,
      entities: mem.entities || [],
      metadata: mem.metadata || {},
      created_at: mem.created_at
    }));

    // Deduplicate memories - remove near-duplicates based on text similarity
    const memories = deduplicateMemories(rawMemories);

    logger.debug(`✅ [NODE:RETRIEVE_MEMORY] Loaded ${conversationHistory.length} messages, ${rawMemories.length} raw memories → ${memories.length} after deduplication`);

    return {
      ...state,
      conversationHistory,
      sessionFacts: sessionContextData.facts || [],
      sessionEntities: sessionContextData.entities || [],
      memories,
      rawMemoriesCount: memories.length
    };
  } catch (error) {
    logger.error('❌ [NODE:RETRIEVE_MEMORY] Failed:', error.message);
    throw error;
  }
};
