/**
 * IPC Handlers for MCP Memory Operations
 * 
 * Routes memory queries to MCP user-memory service in private mode.
 */

const { ipcMain } = require('electron');

const logger = require('./../logger.cjs');
/**
 * Setup MCP memory handlers
 */
function setupMCPMemoryHandlers(mcpClient) {
  logger.debug('🔌 Registering MCP memory IPC handlers...');

  /**
   * Query memories through MCP user-memory service
   */
  ipcMain.handle('query-memories-direct', async (event, options = {}) => {
    try {
      logger.debug('🔍 [MCP-MEMORY] Query memories via MCP service:', options);
      const { limit = 50, offset = 0, searchQuery = null } = options;

      if (!mcpClient) {
        logger.error('❌ [MCP-MEMORY] MCP client not available');
        return {
          success: false,
          error: 'MCP client not initialized'
        };
      }

      // Call MCP user-memory service
      let result;
      if (searchQuery) {
        // Use search action if query provided
        result = await mcpClient.execute('user-memory', 'memory.search', {
          query: searchQuery,
          limit,
          userId: 'default_user',
          minSimilarity: 0.3
        });
      } else {
        // Use list action for all memories
        result = await mcpClient.execute('user-memory', 'memory.list', {
          limit,
          offset,
          userId: 'default_user'
        });
      }

      logger.debug('📥 [MCP-MEMORY] MCP service result:', result);

      if (result.status === 'ok' && result.data) {
        // Transform MCP response to match expected format
        const mcpMemories = result.data.memories || [];
        const total = result.data.total || mcpMemories.length;

        logger.debug(`✅ [MCP-MEMORY] Retrieved ${mcpMemories.length} memories from MCP service`);
        
        // Log first memory structure for debugging
        if (mcpMemories.length > 0) {
          logger.debug('📋 [MCP-MEMORY] First memory structure:', JSON.stringify(mcpMemories[0], null, 2));
        }

        // Transform MCP memory format to match frontend expectations
        const memories = mcpMemories.map(mem => {
          // Parse metadata if it's a string
          let metadata = mem.metadata;
          if (typeof metadata === 'string') {
            try {
              metadata = JSON.parse(metadata);
            } catch (e) {
              metadata = {};
            }
          }

          // Extract primary intent from metadata or entities
          const primaryIntent = metadata?.intent || 
                               metadata?.primary_intent || 
                               (mem.entities && mem.entities.length > 0 ? mem.entities[0] : 'unknown');

          return {
            id: mem.id,
            timestamp: mem.created_at || mem.timestamp || new Date().toISOString(),
            user_id: mem.user_id || mem.userId || 'default_user',
            type: mem.type || 'user_memory',
            primary_intent: primaryIntent,
            primaryIntent: primaryIntent,
            source_text: mem.text || mem.source_text || '',
            sourceText: mem.text || mem.source_text || '',
            extracted_text: metadata?.extractedText || null,
            extractedText: metadata?.extractedText || null,
            suggested_response: metadata?.assistantResponse || metadata?.suggested_response || '',
            suggestedResponse: metadata?.assistantResponse || metadata?.suggested_response || '',
            metadata: typeof mem.metadata === 'string' ? mem.metadata : JSON.stringify(mem.metadata || {}),
            entities: mem.entities || [],
            screenshot: mem.screenshot || null,
            synced_to_backend: true, // MCP memories are always synced
            syncedToBackend: true,
            backend_memory_id: mem.id,
            backendMemoryId: mem.id,
            created_at: mem.created_at || mem.timestamp || new Date().toISOString(),
            createdAt: mem.created_at || mem.timestamp || new Date().toISOString(),
            updated_at: mem.updated_at || mem.created_at || new Date().toISOString(),
            updatedAt: mem.updated_at || mem.created_at || new Date().toISOString(),
            // Additional fields from MCP
            similarity: mem.similarity,
            embedding: mem.embedding
          };
        });

        logger.debug('📋 [MCP-MEMORY] Transformed first memory:', memories.length > 0 ? JSON.stringify(memories[0], null, 2) : 'none');

        return {
          success: true,
          data: {
            memories: memories,
            pagination: {
              offset: offset,
              limit: limit,
              total: total,
              hasMore: offset + memories.length < total
            }
          },
          count: memories.length,
          totalCount: total,
          searchQuery: searchQuery,
          source: 'mcp-user-memory'
        };
      } else {
        logger.warn('⚠️ [MCP-MEMORY] MCP service returned no data:', result);
        return {
          success: false,
          error: result.error || 'Failed to retrieve memories from MCP service',
          data: {
            memories: [],
            pagination: {
              offset: 0,
              limit: limit,
              total: 0,
              hasMore: false
            }
          }
        };
      }

    } catch (error) {
      logger.error('❌ [MCP-MEMORY] Query error:', error);
      return {
        success: false,
        error: error.message,
        data: {
          memories: [],
          pagination: {
            offset: 0,
            limit: 50,
            total: 0,
            hasMore: false
          }
        }
      };
    }
  });

  /**
   * Delete memory through MCP user-memory service
   */
  ipcMain.handle('delete-memory-direct', async (event, memoryId) => {
    try {
      logger.debug('🗑️ [MCP-MEMORY] Delete memory via MCP service:', memoryId);

      if (!mcpClient) {
        logger.error('❌ [MCP-MEMORY] MCP client not available');
        return {
          success: false,
          error: 'MCP client not initialized'
        };
      }

      // Call MCP user-memory service
      const result = await mcpClient.execute('user-memory', 'memory.delete', {
        memoryId: memoryId, // Service expects 'memoryId', not 'id'
        userId: 'default_user'
      });

      logger.debug('📥 [MCP-MEMORY] Delete result:', result);

      if (result.status === 'ok') {
        logger.debug('✅ [MCP-MEMORY] Memory deleted successfully');
        return {
          success: true,
          deletedCount: 1,
          message: 'Memory deleted successfully'
        };
      } else {
        logger.warn('⚠️ [MCP-MEMORY] Delete failed:', result.error);
        return {
          success: false,
          error: result.error || 'Failed to delete memory'
        };
      }

    } catch (error) {
      logger.error('❌ [MCP-MEMORY] Delete error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.debug('✅ MCP memory IPC handlers registered');
}

module.exports = {
  setupMCPMemoryHandlers
};
