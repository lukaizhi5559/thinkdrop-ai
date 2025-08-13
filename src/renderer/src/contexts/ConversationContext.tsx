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
  switchToSession: (sessionId: string) => Promise<void>;
  updateSession: (sessionId: string, updates: Partial<ConversationSession>) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  hibernateSession: (sessionId: string, hibernationData?: Record<string, any>) => Promise<boolean>;
  resumeSession: (sessionId: string) => Promise<{ success: boolean; resumptionMessage?: string; suggestedActions?: string[] }>;
  
  // Message Management
  messages: Record<string, ChatMessage[]>;
  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => Promise<void>;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  loadMessages: (sessionId: string) => Promise<void>;
  
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

  // Debug activeSessionId changes with stack trace
  const debugSetActiveSessionId = useCallback((sessionId: string | null) => {
    console.log('🔍 [ConversationContext] setActiveSessionId called:', {
      from: activeSessionId,
      to: sessionId,
      stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });
    setActiveSessionId(sessionId);
  }, [activeSessionId]);
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

  // Load messages for a specific session from backend
  const loadMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      console.error('❌ [ConversationContext] Cannot load messages: sessionId is undefined');
      return;
    }
    
    console.log(`🔄 [ConversationContext] Loading messages for session: ${sessionId}`);
    
    try {
      if (window.electronAPI?.agentExecute) {
        console.log(`📤 [ConversationContext] Sending message-list request for session: ${sessionId}`);
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'message-list',
          options: {
            sessionId,
            limit: 500,  // Increased from 100 to handle longer conversations
            offset: 0
          }
        });

        console.log(`📥 [ConversationContext] Raw result from message-list:`, result);
        console.log(`📥 [ConversationContext] Result structure:`, {
          success: result.success,
          hasResult: !!result.result,
          hasData: !!result.data,
          hasMessages: !!result.messages,
          resultKeys: result.result ? Object.keys(result.result) : 'no result',
          dataKeys: result.data ? Object.keys(result.data) : 'no data',
          fullResult: result
        });

        if (result.success) {
          // Handle nested response structure - backend returns result.result.data.messages
          const messages = result.messages || result.result?.data?.messages || result.result?.messages || result.data?.messages || [];
          console.log(`✅ [ConversationContext] Loaded ${messages.length} messages for session ${sessionId}`);
          console.log(`📋 [ConversationContext] Messages:`, messages);
          setMessages(prev => ({
            ...prev,
            [sessionId]: messages
          }));
        } else {
          console.error('❌ [ConversationContext] Failed to load messages:', result.error);
        }
      } else {
        console.warn('⚠️ [ConversationContext] Backend not available for loading messages');
      }
    } catch (error) {
      console.error('❌ [ConversationContext] Error loading messages:', error);
    }
  }, []);

  // Load sessions from backend
  const loadSessions = useCallback(async () => {
    // Prevent multiple simultaneous calls
    if (isLoading) {
      console.log('🔄 [ConversationContext] loadSessions already in progress, skipping...');
      return;
    }
    
    setIsLoading(true);
    
    try {
      console.log('🔍 [ConversationContext] Checking electronAPI availability...');
      console.log('electronAPI exists:', !!window.electronAPI);
      console.log('conversation-session-list exists:', !!(window as any).electronAPI?.['conversation-session-list']);
      
      if ((window as any).electronAPI?.['conversation-session-list']) {
        console.log('🔗 [ConversationContext] Calling conversation-session-list...');
        const result = await (window as any).electronAPI['conversation-session-list']({
          includeHibernated: false,
          limit: 50
        });
        console.log('📥 [ConversationContext] Session list result:', result);
        
        if (result.success && result.data && result.data.sessions) {
          console.log('✅ [ConversationContext] Loaded sessions from backend:', result.data.sessions.length);
          console.log('Sessions:', result.data.sessions.map((s: any) => ({ id: s.id, title: s.title, isActive: s.isActive, lastMessage: s.lastMessage, messageCount: s.messageCount })));
          
          const parsedSessions = result.data.sessions.map((session: any) => ({
            ...session,
            contextData: typeof session.contextData === 'string' ? JSON.parse(session.contextData || '{}') : session.contextData
          }));

          console.log('📋 [ConversationContext] Loaded sessions:', parsedSessions.map((s: ConversationSession) => ({ id: s.id, title: s.title, isActive: s.isActive })));
          setSessions(parsedSessions);

          // Load messages for all sessions to populate sidebar previews
          console.log('📥 [ConversationContext] Loading messages for all sessions...');
          parsedSessions.forEach((session: ConversationSession) => {
            loadMessages(session.id);
          });

          // Check if there's an active session and set it
          const activeSession = parsedSessions.find((s: ConversationSession) => s.isActive);
          if (activeSession) {
            console.log('🎯 [ConversationContext] Found active session:', activeSession.id);
            setActiveSessionId(activeSession.id);
            // Close sidebar if we have an active session
            console.log('🔧 [ConversationContext] Closing sidebar - active session detected');
            setIsSidebarOpen(false);
          } else {
            console.log('🚪 [ConversationContext] No active session found, opening sidebar for manual selection');
            console.log('🔧 [ConversationContext] Current sidebar state before opening:', isSidebarOpen);
            setIsSidebarOpen(true);
            console.log('✅ [ConversationContext] Sidebar set to open - waiting for user to select a session');
            setActiveSessionId(null);
            console.log('⏳ [ConversationContext] Waiting for user to select a session from sidebar');
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
        setIsSidebarOpen(false);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load sessions on mount
  useEffect(() => {
    console.log('🚀 [ConversationContext] Component mounted, loading sessions...');
    loadSessions();
  }, []); // Empty dependency array - only run once on mount

  // Monitor session activity and auto-open sidebar when no active sessions
  useEffect(() => {
    if (sessions.length > 0) {
      const hasActiveSession = sessions.some(session => session.isActive);
      const hasActiveSessionId = activeSessionId !== null;
      
      console.log('🔍 [ConversationContext] Session activity check:', {
        sessionsCount: sessions.length,
        hasActiveSession,
        hasActiveSessionId,
        currentSidebarState: isSidebarOpen
      });
      
      // If we have sessions but no active session, open sidebar for selection
      if (!hasActiveSession && !hasActiveSessionId && !isSidebarOpen) {
        console.log('🚪 [ConversationContext] Auto-opening sidebar - no active sessions detected');
        setIsSidebarOpen(true);
      }
    }
  }, [sessions, activeSessionId, isSidebarOpen]);

  // Load messages when active session changes
  useEffect(() => {
    console.log(`🔄 [ConversationContext] Active session changed to: ${activeSessionId}`);
    
    if (!activeSessionId) {
      console.log('⚠️ [ConversationContext] No active session set, skipping message loading');
      return;
    }
    
    // Skip loading messages for active session - let ChatMessages batch loading handle it
    console.log(`🔄 [ConversationContext] Skipping message loading for active session - batch loading will handle it: ${activeSessionId}`);
    
    // Check if messages are already loaded for this session
    const currentMessages = messages[activeSessionId];
    const hasMessages = currentMessages && currentMessages.length > 0;
    
    console.log(`🔄 [ConversationContext] Messages exist for session: ${hasMessages ? currentMessages.length : 0}`);
    
    // Only load messages for non-active sessions (for sidebar display)
    // Active session messages will be handled by ChatMessages batch loading
    // if (!hasMessages) {
    //   console.log(`🔄 [ConversationContext] Loading messages for active session: ${activeSessionId}`);
    //   loadMessages(activeSessionId);
    // } else {
    //   console.log(`✅ [ConversationContext] Messages already loaded for session: ${activeSessionId} (${currentMessages.length} messages)`);
    // }
  }, [activeSessionId]); // Removed loadMessages and messages dependencies

  // Create new session
  const createSession = useCallback(async (
    type: 'user-initiated' | 'ai-initiated',
    options: Partial<ConversationSession> = {}
  ): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);

      // Generate unique default title if none provided
      const generateUniqueTitle = () => {
        const sessionCount = sessions.length + 1;
        return type === 'ai-initiated' ? `AI Chat ${sessionCount}` : `Chat ${sessionCount}`;
      };

      const sessionData = {
        sessionType: type,
        title: options.title || generateUniqueTitle(),
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
          // Handle nested response structure from IPC
          const actualResult = result.result || result;
          const sessionId = actualResult.sessionId || actualResult.data?.id || result.sessionId;
          
          if (!sessionId) {
            console.error('❌ Session creation response:', result);
            console.error('❌ Actual result:', actualResult);
            throw new Error('Session created but no sessionId returned');
          }
          
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

          // Set all existing sessions to inactive and add the new active session
          setSessions(prev => [
            newSession,
            ...prev.map(session => ({ ...session, isActive: false }))
          ]);
          
          // Set the new session as active in the context
          setActiveSessionId(sessionId);
          
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
  const switchToSession = useCallback(async (sessionId: string) => {
    console.log('🔄 [ConversationContext] switchToSession called for:', sessionId);
    
    // Update frontend state immediately to provide responsive UI
    debugSetActiveSessionId(sessionId);
    
    // Update sessions state to reflect the switch (without changing lastActivityAt to preserve order)
    setSessions(prev => prev.map(session => ({
      ...session,
      isActive: session.id === sessionId,
      unreadCount: session.id === sessionId ? 0 : session.unreadCount
      // Don't update lastActivityAt to preserve session order
    })));
    
    try {
      // Call backend to properly set is_active flags
      if (window.electronAPI?.agentExecute) {
        console.log('📤 [ConversationContext] Calling backend session-switch for:', sessionId);
        const result = await window.electronAPI.agentExecute({
          agentName: 'ConversationSessionAgent',
          action: 'session-switch',
          options: { sessionId }
        });
        
        if (result.success) {
          console.log('✅ [ConversationContext] Backend session switch successful for:', sessionId);
        } else {
          console.error('❌ [ConversationContext] Backend session switch failed:', result.error);
          // Frontend state is already updated, so we continue
        }
      }
    } catch (error) {
      console.error('❌ [ConversationContext] Error calling backend session switch:', error);
      // Frontend state is already updated, so we continue
    }
    
    // Load messages for the new session if not already loaded
    if (!messages[sessionId] || messages[sessionId].length === 0) {
      loadMessages(sessionId);
    }
    
    // Close sidebar after selection (always, not just on mobile)
    console.log('🔧 [ConversationContext] Closing sidebar after session selection');
    setTimeout(() => {
      setIsSidebarOpen(false);
      console.log('✅ [ConversationContext] Sidebar closed');
    }, 100);
  }, [messages, loadMessages]);

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

  // Message management with backend persistence
  const addMessage = useCallback(async (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => {

    try {
      // Save to backend database first
      if ((window as any).electronAPI?.['conversation-message-add']) {
        console.log('[MESSAGE-TEXT]',message);
        const result = await (window as any).electronAPI['conversation-message-add'](sessionId, {
          text: message.text,
          sender: message.sender,
          metadata: message.metadata || {}
        });

        if (result.success) {
          console.log('✅ [CONVERSATION-CONTEXT] Message saved to database:', result.message.id);
          
          // Update local state with the message from backend (includes generated ID and timestamp)
          const newMessage: ChatMessage = {
            id: result.message.id,
            text: result.message.text,
            sender: result.message.sender,
            timestamp: result.message.timestamp,
            sessionId: result.message.sessionId,
            metadata: result.message.metadata
          };

          setMessages(prev => ({
            ...prev,
            [sessionId]: [...(prev[sessionId] || []), newMessage]
          }));
        } else {
          console.error('❌ [CONVERSATION-CONTEXT] Failed to save message to database:', result.error);
          // Fallback to local-only storage
          const fallbackMessage: ChatMessage = {
            ...message,
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            sessionId
          };

          setMessages(prev => ({
            ...prev,
            [sessionId]: [...(prev[sessionId] || []), fallbackMessage]
          }));
        }
      } else {
        console.warn('⚠️ [CONVERSATION-CONTEXT] Backend not available, using local storage only');
        // Fallback to local-only storage
        const fallbackMessage: ChatMessage = {
          ...message,
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          sessionId
        };

        setMessages(prev => ({
          ...prev,
          [sessionId]: [...(prev[sessionId] || []), fallbackMessage]
        }));
      }
    } catch (error) {
      console.error('❌ [CONVERSATION-CONTEXT] Error adding message:', error);
      // Fallback to local-only storage
      const fallbackMessage: ChatMessage = {
        ...message,
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        sessionId
      };

      setMessages(prev => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] || []), fallbackMessage]
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
    loadMessages,
    
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
