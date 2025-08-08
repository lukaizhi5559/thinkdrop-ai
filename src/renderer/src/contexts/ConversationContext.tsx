import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// Types
export interface ConversationSession {
  id: string;
  type: 'user-initiated' | 'ai-initiated';
  title: string;
  triggerReason: 'manual' | 'context-similarity' | 'time-pattern' | 'activity-change' | 'idle-return';
  triggerConfidence: number;
  contextData: Record<string, any>;
  relatedMemories: string[];
  currentActivity: Record<string, any>;
  isActive: boolean;
  isHibernated: boolean;
  hibernationData?: Record<string, any>;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  lastMessage?: string;
  unreadCount?: number;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
  sessionId: string;
  metadata?: Record<string, any>;
}

interface ConversationContextType {
  // Session Management
  sessions: ConversationSession[];
  activeSessionId: string | null;
  loadSessions: () => Promise<void>;
  createSession: (type: 'user-initiated' | 'ai-initiated', options?: Partial<ConversationSession>) => Promise<string>;
  switchToSession: (sessionId: string) => void;
  updateSession: (sessionId: string, updates: Partial<ConversationSession>) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  hibernateSession: (sessionId: string, hibernationData?: Record<string, any>) => Promise<boolean>;
  resumeSession: (sessionId: string) => Promise<{ success: boolean; resumptionMessage?: string; suggestedActions?: string[] }>;
  
  // Message Management
  messages: Record<string, ChatMessage[]>;
  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  
  // Sidebar State
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  openSidebar: () => void;
  
  // Context Awareness
  checkContextSimilarity: (currentActivity: Record<string, any>) => Promise<{ similarity: number; shouldTrigger: boolean; relatedSessions: string[] }>;
  evaluateAutoTrigger: (currentActivity: Record<string, any>, triggerType?: string, confidence?: number) => Promise<{ triggered: boolean; sessionId?: string; autoMessage?: string }>;
  
  // Loading States
  isLoading: boolean;
  error: string | null;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export const useConversation = () => {
  const context = useContext(ConversationContext);
  if (context === undefined) {
    throw new Error('useConversation must be used within a ConversationProvider');
  }
  return context;
};

interface ConversationProviderProps {
  children: React.ReactNode;
}

export const ConversationProvider: React.FC<ConversationProviderProps> = ({ children }) => {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Debug logging for provider initialization
  React.useEffect(() => {
    console.log('🔍 [ConversationProvider] Initialized with state:', {
      sessionsCount: sessions.length,
      activeSessionId,
      isSidebarOpen,
      isLoading,
      error
    });
  }, []);

  // Load sessions from backend
  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (window.electronAPI?.agentExecute) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'session-list',
          options: {
            includeHibernated: false,
            limit: 50
          }
        });
        
        if (result.success) {
          setSessions(result.data.sessions || []);
          
          // Set active session to the most recent if none is set
          if (!activeSessionId && result.data.sessions.length > 0) {
            setActiveSessionId(result.data.sessions[0].id);
          }
        } else {
          setError(result.error || 'Failed to load sessions');
        }
      } else {
        // Fallback for development/demo mode
        const demoSession: ConversationSession = {
          id: 'demo-session',
          type: 'user-initiated',
          title: 'Demo Chat',
          triggerReason: 'manual',
          triggerConfidence: 0.0,
          contextData: {},
          relatedMemories: [],
          currentActivity: {},
          isActive: true,
          isHibernated: false,
          messageCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          lastMessage: 'Welcome to ThinkDrop AI!',
          unreadCount: 0
        };
        setSessions([demoSession]);
        setActiveSessionId('demo-session');
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Create new session
  const createSession = useCallback(async (
    type: 'user-initiated' | 'ai-initiated',
    options: Partial<ConversationSession> = {}
  ): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);

      const sessionData = {
        sessionType: type,
        title: options.title || (type === 'ai-initiated' ? 'AI Conversation' : 'New Chat'),
        triggerReason: options.triggerReason || 'manual',
        triggerConfidence: options.triggerConfidence || 0.0,
        contextData: options.contextData || {},
        relatedMemories: options.relatedMemories || [],
        currentActivity: options.currentActivity || {}
      };

      if (window.electronAPI?.agentExecute) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'session-create',
          options: sessionData
        });

        if (result.success) {
          const sessionId = result.sessionId;
          
          // Add to local state
          const newSession: ConversationSession = {
            id: sessionId,
            type,
            title: sessionData.title,
            triggerReason: sessionData.triggerReason,
            triggerConfidence: sessionData.triggerConfidence,
            contextData: sessionData.contextData,
            relatedMemories: sessionData.relatedMemories,
            currentActivity: sessionData.currentActivity,
            isActive: true,
            isHibernated: false,
            messageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            unreadCount: 0
          };

          setSessions(prev => [newSession, ...prev]);
          return sessionId;
        } else {
          throw new Error(result.error || 'Failed to create session');
        }
      } else {
        // Fallback for demo mode
        const sessionId = `demo-${Date.now()}`;
        const newSession: ConversationSession = {
          id: sessionId,
          type,
          title: sessionData.title,
          triggerReason: sessionData.triggerReason,
          triggerConfidence: sessionData.triggerConfidence,
          contextData: sessionData.contextData,
          relatedMemories: sessionData.relatedMemories,
          currentActivity: sessionData.currentActivity,
          isActive: true,
          isHibernated: false,
          messageCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          unreadCount: 0
        };
        setSessions(prev => [newSession, ...prev]);
        return sessionId;
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Switch to session
  const switchToSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    
    // Mark session as read
    setSessions(prev => prev.map(session => 
      session.id === sessionId 
        ? { ...session, unreadCount: 0, lastActivityAt: new Date().toISOString() }
        : session
    ));
    
    // Close sidebar on mobile after selection
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, []);

  // Update session
  const updateSession = useCallback(async (sessionId: string, updates: Partial<ConversationSession>): Promise<boolean> => {
    try {
      if (window.electronAPI?.agentExecute) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'session-update',
          options: {
            sessionId,
            updates
          }
        });

        if (result.success) {
          setSessions(prev => prev.map(session => 
            session.id === sessionId 
              ? { ...session, ...updates, updatedAt: new Date().toISOString() }
              : session
          ));
          return true;
        }
      } else {
        // Fallback for demo mode
        setSessions(prev => prev.map(session => 
          session.id === sessionId 
            ? { ...session, ...updates, updatedAt: new Date().toISOString() }
            : session
        ));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update session:', error);
      return false;
    }
  }, []);

  // Delete session
  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      if (window.electronAPI?.agentExecute) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'session-delete',
          options: {
            sessionId
          }
        });

        if (result.success) {
          setSessions(prev => prev.filter(session => session.id !== sessionId));
          
          // Switch to another session if this was active
          if (activeSessionId === sessionId) {
            const remainingSessions = sessions.filter(s => s.id !== sessionId);
            setActiveSessionId(remainingSessions.length > 0 ? remainingSessions[0].id : null);
          }
          
          // Remove messages for this session
          setMessages(prev => {
            const updated = { ...prev };
            delete updated[sessionId];
            return updated;
          });
          
          return true;
        }
      } else {
        // Fallback for demo mode
        setSessions(prev => prev.filter(session => session.id !== sessionId));
        if (activeSessionId === sessionId) {
          const remainingSessions = sessions.filter(s => s.id !== sessionId);
          setActiveSessionId(remainingSessions.length > 0 ? remainingSessions[0].id : null);
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete session:', error);
      return false;
    }
  }, [activeSessionId, sessions]);

  // Hibernate session
  const hibernateSession = useCallback(async (sessionId: string, hibernationData: Record<string, any> = {}): Promise<boolean> => {
    try {
      if (window.electronAPI?.agentExecute) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'session-hibernate',
          options: {
            sessionId,
            hibernationData
          }
        });

        if (result.success) {
          setSessions(prev => prev.map(session => 
            session.id === sessionId 
              ? { ...session, isHibernated: true, hibernationData, updatedAt: new Date().toISOString() }
              : session
          ));
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Failed to hibernate session:', error);
      return false;
    }
  }, []);

  // Resume session
  const resumeSession = useCallback(async (sessionId: string): Promise<{ success: boolean; resumptionMessage?: string; suggestedActions?: string[] }> => {
    try {
      if (window.electronAPI?.agentExecute) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'session-resume',
          options: {
            sessionId
          }
        });

        if (result.success) {
          setSessions(prev => prev.map(session => 
            session.id === sessionId 
              ? { ...session, isHibernated: false, isActive: true, updatedAt: new Date().toISOString() }
              : session
          ));
          
          return {
            success: true,
            resumptionMessage: result.data.resumptionMessage,
            suggestedActions: result.data.suggestedActions
          };
        }
      }
      return { success: false };
    } catch (error) {
      console.error('Failed to resume session:', error);
      return { success: false };
    }
  }, []);

  // Message management
  const addMessage = useCallback((sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    // Duplicate detection for AI messages
    if (message.sender === 'ai' && message.text.length > 10) {
      setMessages(prev => {
        const existingMessages = prev[sessionId] || [];
        const recentAiMessages = existingMessages.slice(-3).filter(msg => msg.sender === 'ai');
        
        const isDuplicate = recentAiMessages.some(msg => {
          const textMatch = msg.text === message.text;
          const recentTime = Date.now() - new Date(msg.timestamp).getTime() < 5000; // 5 seconds
          return textMatch && recentTime;
        });

        if (isDuplicate) {
          console.log('🚫 [CONVERSATION-CONTEXT] Blocked duplicate AI message:', message.text.substring(0, 50) + '...');
          return prev;
        }

        console.log('✅ [CONVERSATION-CONTEXT] Adding AI message (passed duplicate check)');
        const newMessage: ChatMessage = {
          ...message,
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          sessionId
        };

        return {
          ...prev,
          [sessionId]: [...(prev[sessionId] || []), newMessage]
        };
      });
    } else {
      // For user messages, add directly without duplicate detection
      console.log('✅ [CONVERSATION-CONTEXT] Adding user message');
      const newMessage: ChatMessage = {
        ...message,
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        sessionId
      };

      setMessages(prev => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] || []), newMessage]
      }));
    }

    // Update session with last message and increment count
    setSessions(prev => prev.map(session => 
      session.id === sessionId 
        ? { 
            ...session, 
            lastMessage: message.text,
            messageCount: session.messageCount + 1,
            lastActivityAt: new Date().toISOString(),
            unreadCount: session.id !== activeSessionId ? (session.unreadCount || 0) + 1 : 0
          }
        : session
    ));

    // Store in localStorage as backup
    try {
      localStorage.setItem(`chat_messages_${sessionId}`, JSON.stringify(messages[sessionId] || []));
    } catch (error) {
      console.warn('Failed to store messages in localStorage:', error);
    }
  }, [activeSessionId, messages]);

  const updateMessage = useCallback((sessionId: string, messageId: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => ({
      ...prev,
      [sessionId]: (prev[sessionId] || []).map(msg => 
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
    }));
  }, []);

  const getSessionMessages = useCallback((sessionId: string): ChatMessage[] => {
    return messages[sessionId] || [];
  }, [messages]);

  // Sidebar management
  const toggleSidebar = useCallback(() => {
    console.log('🔍 [ConversationProvider] toggleSidebar called, current state:', isSidebarOpen);
    setIsSidebarOpen(prev => {
      const newState = !prev;
      console.log('🔍 [ConversationProvider] Sidebar state changing:', prev, '->', newState);
      return newState;
    });
  }, [isSidebarOpen]);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  // Context awareness functions
  const checkContextSimilarity = useCallback(async (currentActivity: Record<string, any>) => {
    try {
      if (window.electronAPI?.agentExecute && activeSessionId) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'context-similarity',
          options: {
            sessionId: activeSessionId,
            currentContext: currentActivity
          }
        });

        if (result.success) {
          return {
            similarity: result.data.similarity,
            shouldTrigger: result.data.shouldTrigger,
            relatedSessions: result.data.relatedSessions
          };
        }
      }
      
      return {
        similarity: 0,
        shouldTrigger: false,
        relatedSessions: []
      };
    } catch (error) {
      console.error('Failed to check context similarity:', error);
      return {
        similarity: 0,
        shouldTrigger: false,
        relatedSessions: []
      };
    }
  }, [activeSessionId]);

  const evaluateAutoTrigger = useCallback(async (
    currentActivity: Record<string, any>,
    triggerType: string = 'context-similarity',
    confidence: number = 0.8
  ) => {
    try {
      if (window.electronAPI?.agentExecute) {
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'auto-trigger-evaluate',
          options: {
            currentContext: currentActivity,
            userActivity: currentActivity,
            triggerType,
            confidence
          }
        });

        if (result.success) {
          return {
            triggered: result.data.triggered,
            sessionId: result.data.sessionId,
            autoMessage: result.data.autoMessage
          };
        }
      }
      
      return {
        triggered: false,
        sessionId: undefined,
        autoMessage: undefined
      };
    } catch (error) {
      console.error('Failed to evaluate auto trigger:', error);
      return {
        triggered: false,
        sessionId: undefined,
        autoMessage: undefined
      };
    }
  }, []);

  const contextValue: ConversationContextType = {
    // Session Management
    sessions,
    activeSessionId,
    loadSessions,
    createSession,
    switchToSession,
    updateSession,
    deleteSession,
    hibernateSession,
    resumeSession,
    
    // Message Management
    messages,
    addMessage,
    updateMessage,
    getSessionMessages,
    
    // Sidebar State
    isSidebarOpen,
    toggleSidebar,
    closeSidebar,
    openSidebar,
    
    // Context Awareness
    checkContextSimilarity,
    evaluateAutoTrigger,
    
    // Loading States
    isLoading,
    error
  };

  return (
    <ConversationContext.Provider value={contextValue}>
      {children}
    </ConversationContext.Provider>
  );
};
