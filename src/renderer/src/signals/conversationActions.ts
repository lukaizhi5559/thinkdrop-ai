import { 
  sessions, 
  activeSessionId, 
  messages, 
  isSidebarOpen, 
  isLoading, 
  error 
} from './conversationSignals';
import type { ConversationSession, ChatMessage } from '../contexts/ConversationContext';

// Session Management Actions
export const switchToSession = async (sessionId: string) => {
  console.log('🔄 [SIGNALS] switchToSession called for:', sessionId);
  
  // Immediate synchronous update - UI responds instantly
  activeSessionId.value = sessionId;
  
  // Update sessions state to reflect the switch
  sessions.value = sessions.value.map(session => ({
    ...session,
    isActive: session.id === sessionId,
    unreadCount: session.id === sessionId ? 0 : session.unreadCount
  }));
  
  try {
    // Call backend to properly set is_active flags (async, but UI already updated)
    if (window.electronAPI?.agentExecute) {
      console.log('📤 [SIGNALS] Calling backend session-switch for:', sessionId);
      const result = await window.electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'session-switch',
        options: { sessionId }
      });
      
      if (result.success) {
        console.log('✅ [SIGNALS] Backend session switch successful for:', sessionId);
      } else {
        console.error('❌ [SIGNALS] Backend session switch failed:', result.error);
      }
    }
  } catch (err) {
    console.error('❌ [SIGNALS] Error calling backend session switch:', err);
  }
  
  // Load messages for the session if not already loaded
  const currentMessages = messages.value[sessionId];
  console.log('🔍 [SIGNALS] Checking if messages need loading:', {
    sessionId,
    hasMessages: !!currentMessages,
    messageCount: currentMessages?.length || 0
  });
  
  if (!currentMessages || currentMessages.length === 0) {
    console.log('📥 [SIGNALS] Loading messages for newly switched session:', sessionId);
    await loadMessages(sessionId);
  } else {
    console.log('✅ [SIGNALS] Messages already loaded, skipping load');
  }
  
  // Close sidebar after selection
  setTimeout(() => {
    isSidebarOpen.value = false;
  }, 100);
};

export const createSession = async (sessionType: 'user-initiated' | 'ai-initiated' = 'user-initiated', options: { 
  title?: string;
  contextData?: any;
  relatedMemories?: any[];
  currentActivity?: any;
} = {}) => {
  console.log('🆕 [SIGNALS] Creating new session:', { sessionType, options });
  
  try {
    isLoading.value = true;
    error.value = null;
    
    if (window.electronAPI?.agentExecute) {
      const result = await window.electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'session-create',
        options: {
          sessionType,
          title: options?.title || `Chat ${sessions.value.length + 1}`,
          triggerReason: 'manual',
          triggerConfidence: 0,
          contextData: options?.contextData || {},
          relatedMemories: options?.relatedMemories || [],
          currentActivity: options?.currentActivity || {}
        }
      });

      console.log('🔄 [SIGNALS] Backend response:', result);
      console.log('🔄 [SIGNALS] Response type:', typeof result);
      console.log('🔄 [SIGNALS] Response keys:', result ? Object.keys(result) : 'null/undefined');
      console.log('🔄 [SIGNALS] Success value:', result?.success);
      console.log('🔄 [SIGNALS] Error value:', result?.error);
      console.log('🔄 [SIGNALS] SessionId (top level):', result?.sessionId);
      console.log('🔄 [SIGNALS] Result object:', result?.result);
      console.log('🔄 [SIGNALS] Result keys:', result?.result ? Object.keys(result.result) : 'null/undefined');
      console.log('🔄 [SIGNALS] Result data:', result?.result?.data);

      // Handle both response formats: {success, sessionId, data} and {success, result: {sessionId, data}}
      const sessionId = result?.sessionId || result?.result?.sessionId;
      
      if (result?.success && sessionId) {
        console.log(' [SIGNALS] Session created successfully:', sessionId);
        
        // Create new session object
        const newSession: ConversationSession = {
          id: sessionId,
          title: options.title || 'Chat Session',
          type: sessionType,
          triggerReason: 'manual',
          triggerConfidence: 0,
          contextData: {},
          relatedMemories: [],
          currentActivity: {},
          isActive: true,
          isHibernated: false,
          messageCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          lastMessage: undefined,
          unreadCount: 0
        };
        
        // Add to sessions list and set as active
        const currentSessions = sessions.value;
        console.log('🔄 [SIGNALS] Current sessions before update:', currentSessions.length);
        
        sessions.value = [newSession, ...sessions.value.map(s => ({ ...s, isActive: false }))];
        activeSessionId.value = sessionId;
        
        console.log('🔄 [SIGNALS] Sessions after update:', sessions.value.length);
        console.log('🔄 [SIGNALS] New session added:', newSession);
        console.log('🔄 [SIGNALS] Active session ID set to:', sessionId);
        
        // Initialize empty messages array for this session
        messages.value = {
          ...messages.value,
          [sessionId]: []
        };
        
        return sessionId;
      } else {
        throw new Error(result.error || 'Failed to create session');
      }
    } else {
      throw new Error('Electron API not available');
    }
  } catch (err) {
    console.error('❌ [SIGNALS] Failed to create session:', err);
    error.value = err instanceof Error ? err.message : 'Unknown error';
    throw err;
  } finally {
    isLoading.value = false;
  }
};

export const loadSessions = async (retryCount = 0) => {
  console.log('📋 [SIGNALS] Loading sessions... (attempt', retryCount + 1, ')');
  
  try {
    isLoading.value = true;
    error.value = null;
    
    // Use direct IPC handler instead of agentExecute (which is disabled in MCP mode)
    const sessionListHandler = (window.electronAPI as any)?.['conversation-session-list'];
    if (!sessionListHandler) {
      console.error('❌ [SIGNALS] conversation-session-list handler not available');
      return;
    }
    
    console.log('🔄 [SIGNALS] Calling backend conversation-session-list...');
    const result = await sessionListHandler({
      limit: 50,
      offset: 0
    }).catch((err: Error) => {
      // Handler not registered yet - retry after delay
      if (err.message.includes('No handler registered') && retryCount < 3) {
        console.log('⏳ [SIGNALS] Handler not ready, retrying in 500ms...');
        return new Promise(resolve => {
          setTimeout(() => resolve(loadSessions(retryCount + 1)), 500);
        });
      }
      throw err;
    });
    
    console.log('📥 [SIGNALS] Backend response received:', result);
    
    console.log(' [SIGNALS] Result structure check:', {
      hasData: !!result.data,
      hasResult: !!result.result,
      dataKeys: result.data ? Object.keys(result.data) : 'no data',
      resultKeys: result.result ? Object.keys(result.result) : 'no result',
      directSessions: result.data?.sessions ? result.data.sessions.length : 'no direct sessions',
      nestedSessions: result.result?.data?.sessions ? result.result.data.sessions.length : 'no nested sessions'
    });
    
    // Handle all possible response formats
    let sessionsData = null;
    
    // Try direct access first: result.data.sessions
    if (result.data?.sessions) {
      sessionsData = result.data.sessions;
      console.log(' [SIGNALS] Found sessions via result.data.sessions');
    }
    // Try nested access: result.result.data.sessions  
    else if (result.result?.data?.sessions) {
      sessionsData = result.result.data.sessions;
      console.log(' [SIGNALS] Found sessions via result.result.data.sessions');
    }
    // Try direct result access: result.sessions
    else if (result.sessions) {
      sessionsData = result.sessions;
      console.log(' [SIGNALS] Found sessions via result.sessions');
    }
    else {
      console.log(' [SIGNALS] No sessions found in any expected location');
    }
    
    console.log(' [SIGNALS] Extracted sessions data:', sessionsData ? sessionsData.length : 'no sessions data');
    
    if (result.success && sessionsData) {
      console.log(' [SIGNALS] Loaded sessions:', sessionsData.length);
      sessions.value = sessionsData;
      
      // Set active session if one exists
      const activeSession = sessionsData.find((s: ConversationSession) => s.isActive);
      if (activeSession) {
        activeSessionId.value = activeSession.id;
        console.log(' [SIGNALS] Found active session:', activeSession.id);
      } else if (sessionsData.length > 0) {
        // Auto-activate the first session if none is active
        const firstSession = sessionsData[0];
        console.log(' [SIGNALS] Auto-activating first session:', firstSession.id);
        await switchToSession(firstSession.id);
      }
    } else {
      console.warn(' [SIGNALS] No sessions data in response:', result);
      console.warn(' [SIGNALS] Expected sessions data, got:', {
        hasDirectData: !!result.data,
        hasNestedData: !!result.result?.data,
        directSessions: !!result.data?.sessions,
        nestedSessions: !!result.result?.data?.sessions,
        resultKeys: result ? Object.keys(result) : 'no result',
        dataKeys: result.data ? Object.keys(result.data) : 'no direct data',
        nestedDataKeys: result.result?.data ? Object.keys(result.result.data) : 'no nested data'
      });
    }
  } catch (err) {
    console.error(' [SIGNALS] Failed to load sessions:', err);
    error.value = err instanceof Error ? err.message : 'Failed to load sessions';
  } finally {
    isLoading.value = false;
  }
};

export const loadMessages = async (sessionId: string, options?: {
  limit?: number;
  offset?: number;
  direction?: 'ASC' | 'DESC';
}) => {
  console.log('📨 [SIGNALS] Loading messages for session:', sessionId, options);
  
  try {
    isLoading.value = true;
    if (window.electronAPI?.agentExecute) {
      const result = await window.electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'message-list',
        options: {
          sessionId,
          limit: options?.limit || 50,  // Default to 50 for batch loading
          offset: options?.offset || 0,
          direction: options?.direction || 'DESC'  // Default to DESC for most recent first
        }
      });
      
      console.log('🔍 [SIGNALS] Load messages result:', JSON.stringify(result, null, 2));
      
      // Handle both response formats
      const messagesData = result.result?.data?.messages || result.result?.messages || result.data?.messages || result.messages;
      
      if (result.success && messagesData) {
        console.log('✅ [SIGNALS] Loaded messages:', messagesData.length);
        messages.value = {
          ...messages.value,
          [sessionId]: messagesData
        };
        return messagesData;
      } else {
        console.warn('⚠️ [SIGNALS] No messages found in result:', result);
      }
    }
  } catch (err) {
    console.error('❌ [SIGNALS] Failed to load messages:', err);
  } finally {
    isLoading.value = false;
  }
  return [];
};

export const addMessage = async (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
  console.log('📝 [SIGNALS] Adding message to session:', sessionId);
  console.log('📝 [SIGNALS] Message data:', message);
  
  try {
    if (window.electronAPI?.agentExecute) {
      const result = await window.electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'message-add',
        options: {
          sessionId,
          text: message.text,
          sender: message.sender,
          metadata: message.metadata || {}
        }
      });
      
      console.log('📝 [SIGNALS] Add message result:', JSON.stringify(result, null, 2));
      
      // Handle both response formats: result.data or result.result.data
      const messageData = result.data || result.result?.data;
      
      console.log('📝 [SIGNALS] Parsed messageData:', messageData);
      
      // Check if this is a duplicate message
      if (messageData && messageData.isDuplicate) {
        console.log('⚠️ [SIGNALS] Duplicate message detected, skipping UI update');
        return null;
      }
      
      if (result.success && messageData && messageData.messageId) {
        const newMessage: ChatMessage = {
          id: messageData.messageId,
          text: messageData.text || '',
          sender: messageData.sender || 'ai',
          timestamp: messageData.timestamp || new Date().toISOString(),
          sessionId: messageData.sessionId || sessionId,
          metadata: messageData.metadata || {}
        };
        
        console.log('📝 [SIGNALS] Created newMessage:', newMessage);
        
        // Add message to the session's messages array
        const currentMessages = messages.value[sessionId] || [];
        messages.value = {
          ...messages.value,
          [sessionId]: [...currentMessages, newMessage]
        };
        
        // Update session metadata
        sessions.value = sessions.value.map(session => 
          session.id === sessionId 
            ? { 
                ...session, 
                messageCount: (session.messageCount || 0) + 1,
                lastMessage: newMessage.text ? newMessage.text.substring(0, 30) : '',
                lastActivityAt: new Date().toISOString()
              }
            : session
        );
        
        console.log('✅ [SIGNALS] Message added successfully');
        return newMessage;
      }
    }
  } catch (err) {
    console.error('❌ [SIGNALS] Failed to add message:', err);
    throw err;
  }
};

// UI Actions
export const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value;
  console.log('🔧 [SIGNALS] Sidebar toggled:', isSidebarOpen.value);
};

export const openSidebar = () => {
  isSidebarOpen.value = true;
};

export const closeSidebar = () => {
  isSidebarOpen.value = false;
};

// Message sending with automatic session handling
export const sendMessage = async (text: string) => {
  console.log('🚀 [SIGNALS] Sending message:', text);
  
  let currentSessionId = activeSessionId.value;
  
  // If no active session, create one
  if (!currentSessionId) {
    console.log('📝 [SIGNALS] No active session, creating one...');
    const newSessionId = await createSession('user-initiated', { title: 'Chat Session' });
    await switchToSession(newSessionId);
    currentSessionId = newSessionId;
  }
  
  // Ensure we have a valid session ID
  if (!currentSessionId) {
    throw new Error('Failed to get or create session');
  }
  
  // Add user message
  await addMessage(currentSessionId, {
    text,
    sender: 'user',
    sessionId: currentSessionId,
    metadata: {}
  });
  
  console.log('✅ [SIGNALS] Message sent successfully to session:', currentSessionId);
  return currentSessionId;
};

// Session management actions
export const updateSession = async (sessionId: string, updates: { title?: string; [key: string]: any }) => {
  console.log('🔧 [SIGNALS] Updating session:', sessionId, updates);
  
  try {
    // Call backend to update session
    const result = await window.electronAPI?.agentExecute({
      agentName: 'ConversationSessionAgent',
      action: 'session-update',
      options: { sessionId, ...updates }
    });
    
    console.log('📡 [SIGNALS] Backend update result:', result);
    
    // Update local sessions signal
    const currentSessions = sessions.value;
    const updatedSessions = currentSessions.map(session => 
      session.id === sessionId ? { ...session, ...updates } : session
    );
    sessions.value = updatedSessions;
    
    console.log('✅ [SIGNALS] Session updated successfully - local state updated');
  } catch (error) {
    console.error('❌ [SIGNALS] Failed to update session:', error);
    throw error;
  }
};

export const deleteSession = async (sessionId: string) => {
  console.log('🗑️ [SIGNALS] Deleting session:', sessionId);
  
  try {
    // Call backend to delete session
    await window.electronAPI?.agentExecute({
      agentName: 'ConversationSessionAgent',
      action: 'session-delete',
      options: { sessionId }
    });
    
    // Remove from local sessions signal
    const currentSessions = sessions.value;
    sessions.value = currentSessions.filter(session => session.id !== sessionId);
    
    // If this was the active session, clear active session
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null;
    }
    
    // Clear messages for this session
    const currentMessages = { ...messages.value };
    delete currentMessages[sessionId];
    messages.value = currentMessages;
    
    console.log('✅ [SIGNALS] Session deleted successfully');
  } catch (error) {
    console.error('❌ [SIGNALS] Failed to delete session:', error);
    throw error;
  }
};

export const hibernateSession = async (sessionId: string) => {
  console.log('💤 [SIGNALS] Hibernating session:', sessionId);
  
  try {
    // Call backend to hibernate session
    await window.electronAPI?.agentExecute({
      agentName: 'ConversationSessionAgent',
      action: 'session-hibernate',
      options: { sessionId }
    });
    
    // Update local sessions signal
    const currentSessions = sessions.value;
    const updatedSessions = currentSessions.map(session => 
      session.id === sessionId ? { ...session, isHibernated: true } : session
    );
    sessions.value = updatedSessions;
    
    console.log('✅ [SIGNALS] Session hibernated successfully');
  } catch (error) {
    console.error('❌ [SIGNALS] Failed to hibernate session:', error);
    throw error;
  }
};

export const resumeSession = async (sessionId: string) => {
  console.log('🔄 [SIGNALS] Resuming session:', sessionId);
  
  try {
    // Call backend to resume session
    await window.electronAPI?.agentExecute({
      agentName: 'ConversationSessionAgent',
      action: 'session-resume',
      options: { sessionId }
    });
    
    // Update local sessions signal
    const currentSessions = sessions.value;
    const updatedSessions = currentSessions.map(session => 
      session.id === sessionId ? { ...session, isHibernated: false } : session
    );
    sessions.value = updatedSessions;
    
    console.log('✅ [SIGNALS] Session resumed successfully');
  } catch (error) {
    console.error('❌ [SIGNALS] Failed to resume session:', error);
    throw error;
  }
};
