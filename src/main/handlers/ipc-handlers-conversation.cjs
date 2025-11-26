/**
 * IPC Handlers for Conversation Persistence
 * Connects frontend ConversationContext to ConversationSessionAgent
 */

const logger = require('./../logger.cjs');
function setupConversationHandlers(ipcMain, coreAgent) {
  logger.debug('🔧 Setting up conversation persistence IPC handlers...');
  
  // Check if coreAgent is available at setup time
  if (!coreAgent) {
    logger.warn('⚠️ CoreAgent not available - conversation handlers will return errors');
  }
  
  

  // Session Management Handlers
  ipcMain.handle('conversation-session-create', async (event, options) => {
    try {
      logger.debug('📝 [IPC] Creating conversation session:', options);
      
      if (!coreAgent) {
        return {
          success: false,
          error: 'CoreAgent not initialized'
        };
      }
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-create',
        ...options
      });

      if (result.success) {
        logger.debug('✅ [IPC] Session created successfully:', result.data?.sessionId);
        return {
          success: true,
          sessionId: result.data?.sessionId,
          session: result.data
        };
      } else {
        logger.error('❌ [IPC] Failed to create session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Session creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-session-list', async (event, options = {}) => {
    try {
      logger.debug('📋 [IPC] Listing conversation sessions');
      
      // if (!coreAgent) {
      //   logger.debug('⏳ [IPC] CoreAgent not ready, waiting...');
      //   // Wait for CoreAgent to be available (up to 10 seconds)
      //   let attempts = 0;
      //   while (!coreAgent && attempts < 100) {
      //     await new Promise(resolve => setTimeout(resolve, 100));
      //     coreAgent = getCoreAgent();
      //     attempts++;
      //   }
        
      //   if (!coreAgent) {
      //     logger.error('❌ [IPC] CoreAgent still not available after waiting');
      //     return {
      //       success: false,
      //       error: 'CoreAgent not initialized after waiting',
      //       sessions: []
      //     };
      //   }
        
      //   logger.debug('✅ [IPC] CoreAgent is now available');
      // }
      if (!coreAgent) {
        logger.error('❌ [IPC] CoreAgent still not available after waiting');
        return {
          success: false,
          error: 'CoreAgent not initialized after waiting',
          sessions: []
        };
      }
      
      logger.debug('🔍 [IPC] Calling ConversationSessionAgent with options:', options);
      
      // Check if coreAgent is actually ConversationSessionAgent (MCP mode)
      const result = coreAgent.execute ? 
        await coreAgent.execute({ action: 'session-list', ...options }) :
        await coreAgent.executeAgent('ConversationSessionAgent', { action: 'session-list', ...options });

      // Convert BigInt values to regular numbers for JSON serialization
      const sanitizeForJSON = (obj) => {
        return JSON.parse(JSON.stringify(obj, (key, value) =>
          typeof value === 'bigint' ? Number(value) : value
        ));
      };
      
      logger.debug('🔍 [IPC] Full agent result:', JSON.stringify(sanitizeForJSON(result), null, 2));

      if (result.success) {
        logger.debug('🔍 [IPC] Raw result from agent:', {
          success: result.success,
          hasResult: !!result.result,
          hasData: !!result.result?.data,
          hasSessions: !!result.result?.data?.sessions,
          sessionsLength: result.result?.data?.sessions?.length,
          dataKeys: result.result?.data ? Object.keys(result.result.data) : 'no data'
        });
        
        const responseData = {
          success: true,
          data: result.result?.data || { sessions: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } }
        };
        
        // Sanitize BigInt values in the response data
        const sanitizedResponseData = sanitizeForJSON(responseData);
        
        logger.debug(`✅ [IPC] Found ${result.result?.data?.sessions?.length || 0} sessions`);
        logger.debug('🔍 [IPC] Returning response:', JSON.stringify(sanitizedResponseData, null, 2));
        
        return sanitizedResponseData;
      } else {
        logger.error('❌ [IPC] Failed to list sessions:', result.error);
        return {
          success: false,
          error: result.error,
          sessions: []
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Session listing error:', error);
      return {
        success: false,
        error: error.message,
        sessions: []
      };
    }
  });

  ipcMain.handle('conversation-session-get', async (event, sessionId) => {
    try {
      logger.debug('🔍 [IPC] Getting conversation session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-get',
        sessionId
      });

      if (result.success) {
        logger.debug('✅ [IPC] Session retrieved successfully');
        return {
          success: true,
          session: result.data
        };
      } else {
        logger.error('❌ [IPC] Failed to get session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Session retrieval error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-session-update', async (event, sessionId, updates) => {
    try {
      logger.debug('📝 [IPC] Updating conversation session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-update',
        sessionId,
        ...updates
      });

      if (result.success) {
        logger.debug('✅ [IPC] Session updated successfully');
        return {
          success: true,
          session: result.data
        };
      } else {
        logger.error('❌ [IPC] Failed to update session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Session update error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-session-delete', async (event, sessionId) => {
    try {
      logger.debug('🗑️ [IPC] Deleting conversation session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-delete',
        sessionId
      });

      if (result.success) {
        logger.debug('✅ [IPC] Session deleted successfully');
        return {
          success: true
        };
      } else {
        logger.error('❌ [IPC] Failed to delete session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Session deletion error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Message Management Handlers
  ipcMain.handle('conversation-message-add', async (event, sessionId, message) => {
    try {
      logger.debug('💬 [IPC] Adding message to session:', event, sessionId, message);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-add',
        sessionId,
        text: message.text,
        sender: message.sender,
        metadata: message.metadata || {}
      });

      if (result.success) {
        logger.debug('✅ [IPC] Message added successfully:', result);
        return {
          success: true,
          message: {
            id: result.result.data?.messageId,
            text: result.result.data?.text,
            sender: result.result.data?.sender,
            timestamp: result.result.data?.timestamp,
            sessionId: result.result.data?.sessionId,
            metadata: result.result.data?.metadata
          }
        };
      } else {
        logger.error('❌ [IPC] Failed to add message:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Message addition error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-message-list', async (event, sessionId, options = {}) => {
    try {
      logger.debug('📋 [IPC] Listing messages for session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-list',
        sessionId,
        ...options
      });

      if (result.success) {
        logger.debug(`✅ [IPC] Found ${result.data?.messages?.length || 0} messages`);
        return {
          success: true,
          messages: result.data?.messages || []
        };
      } else {
        logger.error('❌ [IPC] Failed to list messages:', result.error);
        return {
          success: false,
          error: result.error,
          messages: []
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Message listing error:', error);
      return {
        success: false,
        error: error.message,
        messages: []
      };
    }
  });

  ipcMain.handle('conversation-message-update', async (event, messageId, updates) => {
    try {
      logger.debug('📝 [IPC] Updating message:', messageId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-update',
        messageId,
        ...updates
      });

      if (result.success) {
        logger.debug('✅ [IPC] Message updated successfully');
        return {
          success: true
        };
      } else {
        logger.error('❌ [IPC] Failed to update message:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Message update error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-message-delete', async (event, messageId) => {
    try {
      logger.debug('🗑️ [IPC] Deleting message:', messageId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-delete',
        messageId
      });

      if (result.success) {
        logger.debug('✅ [IPC] Message deleted successfully');
        return {
          success: true
        };
      } else {
        logger.error('❌ [IPC] Failed to delete message:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('❌ [IPC] Message deletion error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.debug('✅ Conversation persistence IPC handlers setup complete');
}

module.exports = { setupConversationHandlers };
