/**
 * IPC Handlers for Conversation Persistence
 * Connects frontend ConversationContext to ConversationSessionAgent
 */

function setupConversationHandlers(ipcMain, coreAgent) {
  console.log('🔧 Setting up conversation persistence IPC handlers...');
  
  // Check if coreAgent is available
  if (!coreAgent) {
    console.warn('⚠️ CoreAgent not available - conversation handlers will return errors');
  }

  // Session Management Handlers
  ipcMain.handle('conversation-session-create', async (event, options) => {
    try {
      console.log('📝 [IPC] Creating conversation session:', options);
      
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
        console.log('✅ [IPC] Session created successfully:', result.data?.sessionId);
        return {
          success: true,
          sessionId: result.data?.sessionId,
          session: result.data
        };
      } else {
        console.error('❌ [IPC] Failed to create session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Session creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-session-list', async (event, options = {}) => {
    try {
      console.log('📋 [IPC] Listing conversation sessions');
      
      if (!coreAgent) {
        return {
          success: false,
          error: 'CoreAgent not initialized',
          sessions: []
        };
      }
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-list',
        ...options
      });

      if (result.success) {
        console.log('🔍 [IPC] Raw result from agent:', {
          success: result.success,
          hasResult: !!result.result,
          hasData: !!result.result?.data,
          hasSessions: !!result.result?.data?.sessions,
          sessionsLength: result.result?.data?.sessions?.length,
          dataKeys: result.result?.data ? Object.keys(result.result.data) : 'no data'
        });
        
        console.log(`✅ [IPC] Found ${result.result?.data?.sessions?.length || 0} sessions`);
        return {
          success: true,
          data: result.result?.data || { sessions: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } }
        };
      } else {
        console.error('❌ [IPC] Failed to list sessions:', result.error);
        return {
          success: false,
          error: result.error,
          sessions: []
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Session listing error:', error);
      return {
        success: false,
        error: error.message,
        sessions: []
      };
    }
  });

  ipcMain.handle('conversation-session-get', async (event, sessionId) => {
    try {
      console.log('🔍 [IPC] Getting conversation session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-get',
        sessionId
      });

      if (result.success) {
        console.log('✅ [IPC] Session retrieved successfully');
        return {
          success: true,
          session: result.data
        };
      } else {
        console.error('❌ [IPC] Failed to get session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Session retrieval error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-session-update', async (event, sessionId, updates) => {
    try {
      console.log('📝 [IPC] Updating conversation session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-update',
        sessionId,
        ...updates
      });

      if (result.success) {
        console.log('✅ [IPC] Session updated successfully');
        return {
          success: true,
          session: result.data
        };
      } else {
        console.error('❌ [IPC] Failed to update session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Session update error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-session-delete', async (event, sessionId) => {
    try {
      console.log('🗑️ [IPC] Deleting conversation session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'session-delete',
        sessionId
      });

      if (result.success) {
        console.log('✅ [IPC] Session deleted successfully');
        return {
          success: true
        };
      } else {
        console.error('❌ [IPC] Failed to delete session:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Session deletion error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Message Management Handlers
  ipcMain.handle('conversation-message-add', async (event, sessionId, message) => {
    try {
      console.log('💬 [IPC] Adding message to session:', event, sessionId, message);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-add',
        sessionId,
        text: message.text,
        sender: message.sender,
        metadata: message.metadata || {}
      });

      if (result.success) {
        console.log('✅ [IPC] Message added successfully:', result);
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
        console.error('❌ [IPC] Failed to add message:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Message addition error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-message-list', async (event, sessionId, options = {}) => {
    try {
      console.log('📋 [IPC] Listing messages for session:', sessionId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-list',
        sessionId,
        ...options
      });

      if (result.success) {
        console.log(`✅ [IPC] Found ${result.data?.messages?.length || 0} messages`);
        return {
          success: true,
          messages: result.data?.messages || []
        };
      } else {
        console.error('❌ [IPC] Failed to list messages:', result.error);
        return {
          success: false,
          error: result.error,
          messages: []
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Message listing error:', error);
      return {
        success: false,
        error: error.message,
        messages: []
      };
    }
  });

  ipcMain.handle('conversation-message-update', async (event, messageId, updates) => {
    try {
      console.log('📝 [IPC] Updating message:', messageId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-update',
        messageId,
        ...updates
      });

      if (result.success) {
        console.log('✅ [IPC] Message updated successfully');
        return {
          success: true
        };
      } else {
        console.error('❌ [IPC] Failed to update message:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Message update error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  ipcMain.handle('conversation-message-delete', async (event, messageId) => {
    try {
      console.log('🗑️ [IPC] Deleting message:', messageId);
      
      const result = await coreAgent.executeAgent('ConversationSessionAgent', {
        action: 'message-delete',
        messageId
      });

      if (result.success) {
        console.log('✅ [IPC] Message deleted successfully');
        return {
          success: true
        };
      } else {
        console.error('❌ [IPC] Failed to delete message:', result.error);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [IPC] Message deletion error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  console.log('✅ Conversation persistence IPC handlers setup complete');
}

module.exports = { setupConversationHandlers };
