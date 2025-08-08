import { useSignals } from '@preact/signals-react/runtime';
import { 
  sessions,
  activeSessionId,
  messages,
  isSidebarOpen,
  isLoading,
  error,
  activeSession,
  activeMessages,
  hasActiveSession,
  debugState
} from '../signals/conversationSignals';
import {
  loadSessions,
  loadMessages,
  addMessage,
  sendMessage,
  createSession,
  switchToSession,
  toggleSidebar,
  updateSession,
  deleteSession,
  hibernateSession,
  resumeSession
} from '../signals/conversationActions';

// Hook that provides both signals and traditional API for migration
export const useConversationSignals = () => {
  // Enable signals in this component
  useSignals();

  return {
    // Raw signals (for components that want direct access)
    signals: {
      sessions,
      activeSessionId,
      messages,
      isSidebarOpen,
      isLoading,
      error,
      activeSession,
      activeMessages,
      hasActiveSession,
      debugState
    },
    
    // Traditional API (for easier migration from context)
    sessions: sessions.value,
    activeSessionId: activeSessionId.value,
    messages: messages.value,
    isSidebarOpen: isSidebarOpen.value,
    isLoading: isLoading.value,
    error: error.value,
    activeSession: activeSession.value,
    activeMessages: activeMessages.value,
    hasActiveSession: hasActiveSession.value,
    
    // Actions
    switchToSession,
    createSession,
    loadSessions,
    loadMessages,
    addMessage: addMessage,
    toggleSidebar,
    sendMessage,
    updateSession,
    deleteSession,
    hibernateSession,
    resumeSession,
    
    // Debug helpers
    debugState: debugState.value,
    logDebugState: () => console.log('🔍 [SIGNALS DEBUG]', debugState.value)
  };
};

// Simplified hook for components that just need the active session
export const useActiveSession = () => {
  useSignals();
  return {
    sessionId: activeSessionId.value,
    session: activeSession.value,
    messages: activeMessages.value,
    hasSession: hasActiveSession.value
  };
};

// Hook for session management actions
export const useSessionActions = () => {
  return {
    switchToSession,
    createSession,
    loadSessions,
    sendMessage
  };
};
