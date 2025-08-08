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
  if (!messages.value[sessionId] || messages.value[sessionId].length === 0) {
    await loadMessages(sessionId);
  }
  
  // Close sidebar after selection
  setTimeout(() => {
    isSidebarOpen.value = false;
  }, 100);
};

export const createSession = async (sessionType: 'user-initiated' | 'ai-initiated' = 'user-initiated', options: { title?: string } = {}) => {
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
          title: options.title || 'Chat Session',
          triggerReason: 'manual',
          triggerConfidence: 0,
          contextData: {},
          relatedMemories: [],
          currentActivity: {}
        }
      });
      
      if (result.success && result.result?.data?.sessionId) {
        const sessionId = result.result.data.sessionId;
        console.log('✅ [SIGNALS] Session created successfully:', sessionId);
        
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
        sessions.value = [newSession, ...sessions.value.map(s => ({ ...s, isActive: false }))];
        activeSessionId.value = sessionId;
        
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

export const loadSessions = async () => {
  console.log('📋 [SIGNALS] Loading sessions...');
  
  try {
    isLoading.value = true;
    error.value = null;
    
    if (window.electronAPI?.agentExecute) {
      const result = await window.electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'session-list',
        options: {
          limit: 50,
          offset: 0
        }
      });
      
      if (result.success && result.result?.data?.sessions) {
        console.log('✅ [SIGNALS] Loaded sessions:', result.result.data.sessions.length);
        sessions.value = result.result.data.sessions;
        
        // Set active session if one exists
        const activeSession = result.result.data.sessions.find((s: ConversationSession) => s.isActive);
        if (activeSession) {
          activeSessionId.value = activeSession.id;
          console.log('🎯 [SIGNALS] Found active session:', activeSession.id);
        } else if (result.result.data.sessions.length > 0) {
          // Auto-activate the first session if none is active
          const firstSession = result.result.data.sessions[0];
          console.log('🎯 [SIGNALS] Auto-activating first session:', firstSession.id);
          await switchToSession(firstSession.id);
        }
      } else {
        console.warn('⚠️ [SIGNALS] No sessions data in response:', result);
      }
    }
  } catch (err) {
    console.error('❌ [SIGNALS] Failed to load sessions:', err);
    error.value = err instanceof Error ? err.message : 'Failed to load sessions';
  } finally {
    isLoading.value = false;
  }
};

export const loadMessages = async (sessionId: string) => {
  console.log('📨 [SIGNALS] Loading messages for session:', sessionId);
  
  try {
    if (window.electronAPI?.agentExecute) {
      const result = await window.electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'message-list',
        options: {
          sessionId,
          limit: 100,
          offset: 0
        }
      });
      
      if (result.success && result.result?.data?.messages) {
        console.log('✅ [SIGNALS] Loaded messages:', result.result.data.messages.length);
        messages.value = {
          ...messages.value,
          [sessionId]: result.result.data.messages
        };
      }
    }
  } catch (err) {
    console.error('❌ [SIGNALS] Failed to load messages:', err);
  }
};

export const addMessage = async (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
  console.log('📝 [SIGNALS] Adding message to session:', sessionId);
  
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
      
      if (result.success && result.result?.data) {
        const newMessage: ChatMessage = {
          id: result.result.data.messageId,
          text: result.result.data.text,
          sender: result.result.data.sender,
          timestamp: result.result.data.timestamp,
          sessionId: result.result.data.sessionId,
          metadata: result.result.data.metadata || {}
        };
        
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
                lastMessage: newMessage.text.substring(0, 30),
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
    await window.electronAPI?.agentExecute({
      agentName: 'ConversationSessionAgent',
      action: 'session-update',
      options: { sessionId, updates }
    });
    
    // Update local sessions signal
    const currentSessions = sessions.value;
    const updatedSessions = currentSessions.map(session => 
      session.id === sessionId ? { ...session, ...updates } : session
    );
    sessions.value = updatedSessions;
    
    console.log('✅ [SIGNALS] Session updated successfully');
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
