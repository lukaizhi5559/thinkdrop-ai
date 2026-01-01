import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Check, Copy, RotateCcw, ThumbsUp, ThumbsDown, Edit3 } from 'lucide-react';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from './ui/tooltip';
import useWebSocket from '../hooks/useWebSocket';
import { ThinkingIndicator } from './AnalyzingIndicator'; 
import { RichContentRenderer } from './rich-content';
import { useConversationSignals } from '../hooks/useConversationSignals';
import { useGlobalToast } from '../contexts/ToastContext';
import { useGuide } from '../contexts/GuideContext';
import { useSignals } from '@preact/signals-react/runtime';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  isStreaming?: boolean;
}

interface ChatMessagesProps {
  onPendingConfirmation?: (confirmation: {
    command: string;
    category: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    resolvedMessage: string;
    originalMessage: string;
  } | null) => void;
}

export default function ChatMessages({ 
  onPendingConfirmation
}: ChatMessagesProps = {}) {
  // Signals work automatically in React components - no useSignals() needed
  useSignals();

  // Toast notifications - using global toast context
  const { showToast } = useGlobalToast();
  
  // Use signals for session management (eliminates race conditions)
  const {
    signals,
    activeSessionId,
    sendMessage: signalsSendMessage,
    addMessage: signalsAddMessage,
    loadMessages: signalsLoadMessages,
    loadSessions: signalsLoadSessions,
    createSession,
    toggleSidebar,
    logDebugState
  } = useConversationSignals();
  
  // Guide context for showing guide overlay
  const { showGuide } = useGuide();



  // 🎯 MCP Unified Pipeline
  // ✅ ALWAYS ENABLED: All messages go through MCP StateGraph (handles both online and private modes)
  
  // WebSocket integration - only for connection status (mode detection)
  const {
    state: wsState,
    connect: connectWebSocket,
    disconnect: disconnectWebSocket
  } = useWebSocket({
    autoConnect: false, // Manual connection control
    onConnected: () => {},
    onDisconnected: () => {},
    onError: () => {}
    // Note: onMessage removed - all streaming handled by MCP pipeline
  });



  // Use signals as primary source of truth
  const sessions = signals.sessions.value;

  // State for localStorage persistence fallback
  const [, setLastKnownSessions] = useState<any[]>(() => {
    const stored = localStorage.getItem('lastKnownSessions');
    return stored ? JSON.parse(stored) : [];
  });
  const [initialThinkingMessage, setInitialThinkingMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingLocally, setIsProcessingLocally] = useState(false);
  const [localLLMError, setLocalLLMError] = useState<string | null>(null);
  // Note: Old WebSocket streaming state removed - now using MCP streaming
  
  // ⚡ Streaming state
  const [isStreamingResponse, setIsStreamingResponse] = useState(false);
  const [streamedAnswer, setStreamedAnswer] = useState('');
  const streamedAnswerRef = useRef('');
  
  // Input state from ChatWindow
  const [currentMessage, setCurrentMessage] = useState('');
  const [displayMessage, setDisplayMessage] = useState(''); // For immediate display
  
  // Inline editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  
  // Copy feedback state
  const [copiedMessageIds, setCopiedMessageIds] = useState<Set<string>>(new Set());

  // Load state
  const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());
  const [processedOrchestrationMessages, setProcessedOrchestrationMessages] = useState<Set<string>>(new Set());
  
  // Optimistic message state (for instant UI feedback)
  const [optimisticMessage, setOptimisticMessage] = useState<ChatMessage | null>(null);
  
  // Note: WebSocket conversation tracking removed - now handled by MCP pipeline
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const currentMessageRef = useRef<string>('');
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);
  // Note: streamTimeoutRef removed - handled by MCP pipeline
  const scrollThrottleRef = useRef<number | null>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isProgrammaticScrolling = useRef(false);
  const orchestrationListenerSetup = useRef<boolean>(false);
  
  // Batch loading state
  const [batchSize] = useState(50);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [totalMessageCount, setTotalMessageCount] = useState(0);
  const loadingMoreRef = useRef(false);
  
  // Screen refresh state
  const [isRefreshingScreen, setIsRefreshingScreen] = useState(false);
  
  // Selection detection state
  const [detectedSelection, setDetectedSelection] = useState<{
    text?: string;
    preview: string;
    sourceApp: string;
    windowTitle: string;
    fullText: string;
  } | null>(null);

  // Debug activeSessionId changes and track good state with localStorage persistence
  React.useEffect(() => {
    // Track last known good state with localStorage persistence
    if (activeSessionId) {
      localStorage.setItem('lastKnownActiveSession', activeSessionId);
    }
    if (sessions && sessions.length > 0) {
      const sessionData = sessions.map(s => ({ id: s.id, isActive: s.isActive, title: s.title }));
      localStorage.setItem('lastKnownSessions', JSON.stringify(sessionData));
      setLastKnownSessions(sessionData);
    }
  }, [activeSessionId, sessions]);
  
  // Load older messages function
  const loadOlderMessages = useCallback(async () => {
    if (!activeSessionId || loadingMoreRef.current || !hasMoreMessages) return;
    
    loadingMoreRef.current = true;
    setLoadingOlder(true);
    
    try {
      const currentMessages = signals.activeMessages.value || [];
      const currentCount = currentMessages.length;
      
      // Load the next batch of older messages
      const result = await (window as any).electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'message-list',
        options: {
          sessionId: activeSessionId,
          limit: currentCount + batchSize, // Load all current + next batch
          offset: 0,
          direction: 'DESC' // Most recent first
        }
      });
      
      if (result.success && result.result?.data?.messages) {
        const messages = result.result.data.messages;
        const totalCount = Number(result.result.data.totalCount) || messages.length;
        
        // Update total count
        setTotalMessageCount(totalCount);
        
        // Check if there are more messages to load
        setHasMoreMessages(messages.length < totalCount);
        
        // Use signals to update the messages
        await signalsLoadMessages(activeSessionId, {
          limit: currentCount + batchSize,
          offset: 0,
          direction: 'DESC'
        });
        
      } else {
        setHasMoreMessages(false);
      }
    } catch (error) {
      console.error('📨 [ChatMessages] Error loading older messages:', error);
      setHasMoreMessages(false);
    } finally {
      setLoadingOlder(false);
      loadingMoreRef.current = false;
    }
  }, [activeSessionId, batchSize, hasMoreMessages, signalsLoadMessages]);
  

  
  // Initialize batch loading for active session
  React.useEffect(() => {
    if (activeSessionId) {
      setHasMoreMessages(true);
      setTotalMessageCount(0);
      
      // Load initial batch of messages (most recent 50)
      loadInitialMessages();
    }
  }, [activeSessionId]);

  // Enhanced scroll to bottom function with smooth WebSocket chunk handling
  const scrollToBottom = useCallback((options: { smooth?: boolean; force?: boolean; onComplete?: (() => void) | null } = {}) => {
    const { smooth = true, force = false, onComplete = null } = options;
    // Don't auto-scroll if user is manually scrolling (unless forced)
    if (!force && isUserScrolling) {
      if (onComplete) onComplete();
      return;
    }
    
    // Mark as programmatic scrolling to avoid triggering user scroll detection
    isProgrammaticScrolling.current = true;
    
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      if (messagesEndRef.current && messagesContainerRef.current) {
        const container = messagesContainerRef.current;
        const target = messagesEndRef.current;
        
        // Enhanced smooth scrolling for WebSocket chunks
        if (smooth) {
          // Calculate the distance to scroll
          const scrollDistance = target.offsetTop - container.scrollTop - container.clientHeight + target.offsetHeight;

          if (scrollDistance > 0) {
            // Smooth scroll animation for streaming content
            container.scrollTo({
              top: container.scrollTop + scrollDistance,
              behavior: 'smooth'
            });
            
            // Reset programmatic flag and call callback after scroll completes
            setTimeout(() => {
              isProgrammaticScrolling.current = false;
              if (onComplete) onComplete();
            }, 300); // Give time for smooth scroll to complete
          } else {
            isProgrammaticScrolling.current = false;
            if (onComplete) onComplete();
          }
        } else {
          // Instant scroll fallback
          target.scrollIntoView({ 
            behavior: 'auto',
            block: 'end'
          });
          isProgrammaticScrolling.current = false;
          if (onComplete) onComplete();
        }
      } else {
        if (onComplete) onComplete();
      }
    });
  }, [isUserScrolling]);
  
  // Load initial batch of messages
  const loadInitialMessages = useCallback(async () => {
    if (!activeSessionId) return;
    
    try {
      // First get total count from backend
      const result = await (window as any).electronAPI.agentExecute({
        agentName: 'ConversationSessionAgent',
        action: 'message-list',
        options: {
          sessionId: activeSessionId,
          limit: batchSize,
          offset: 0,
          direction: 'DESC'
        }
      });
      
      if (result.success && result.result?.data?.messages) {
        const messages = result.result.data.messages;
        const totalCount = Number(result.result.data.totalCount) || messages.length;
        
        // Set total count from backend
        setTotalMessageCount(totalCount);
        
        // Update signals with the messages
        await signalsLoadMessages(activeSessionId, {
          limit: batchSize,
          offset: 0,
          direction: 'DESC'
        });
        
        setHasMoreMessages(messages.length < totalCount);
      }
    } catch (error) {
      console.error('📨 [BatchLoad] Error loading initial messages:', error);
    }
  }, [activeSessionId, batchSize, signalsLoadMessages]);
  
  // Get messages for the active session only from signals
  const displayMessages = React.useMemo(() => {
    console.log('🎨 [ChatMessages] Computing displayMessages:', {
      activeSessionId,
      activeMessagesCount: signals.activeMessages.value?.length || 0,
      totalMessageCount,
      optimisticMessage: optimisticMessage ? 'present' : 'null'
    });
    
    if (!activeSessionId) {
      console.log('⚠️ [ChatMessages] No active session, returning empty');
      return [];
    }
    
    const sessionMessages = signals.activeMessages.value || [];
    console.log('📥 [ChatMessages] Session messages from signals:', sessionMessages.length);
    
    // Convert conversation messages to ChatMessage format
    const converted = sessionMessages.map((msg: any) => ({
      id: msg.id,
      text: msg.text,
      sender: msg.sender,
      timestamp: new Date(msg.timestamp),
      isStreaming: false
    }));
    
    // Ensure ascending chronological order regardless of fetch direction
    converted.sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Add optimistic message if it exists and isn't already in the list
    if (optimisticMessage && !converted.find(m => m.text === optimisticMessage.text && m.sender === 'user')) {
      console.log('➕ [ChatMessages] Adding optimistic message');
      converted.push({
        ...optimisticMessage,
        isStreaming: optimisticMessage.isStreaming ?? false
      });
    }
    
    console.log('✅ [ChatMessages] Final displayMessages count:', converted.length);
    return converted;
  }, [activeSessionId, signals.activeMessages.value, totalMessageCount, optimisticMessage]);
  
  // Auto-scroll when new messages are added - track the actual messages array, not just length
  useEffect(() => {
    if (displayMessages.length > 0) {
      const container = messagesContainerRef.current;
      if (container) {
        // Direct scroll to bottom when messages change
        const directScroll = () => {
          container.scrollTop = container.scrollHeight;
          console.log('📜 [AUTO-SCROLL] Scrolled to bottom - scrollTop:', container.scrollTop, 'scrollHeight:', container.scrollHeight);
        };
        
        // Check if user is near bottom BEFORE the new message
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
        
        // Check if the last message is from the user (just sent)
        const lastMessage = displayMessages[displayMessages.length - 1];
        const isUserMessage = lastMessage?.sender === 'user';
        
        console.log('🔍 [AUTO-SCROLL] Check - isNearBottom:', isNearBottom, 'isUserMessage:', isUserMessage, 'lastSender:', lastMessage?.sender);
        
        // ALWAYS scroll if user just sent a message, otherwise only if near bottom
        if (isUserMessage || isNearBottom) {
          setIsUserScrolling(false);
          isProgrammaticScrolling.current = false;
          
          // Multiple scroll attempts to ensure it works
          requestAnimationFrame(directScroll);
          setTimeout(directScroll, 100);
          setTimeout(directScroll, 300);
        }
      }
    }
  }, [displayMessages]);
  
  // Note: handleWebSocketMessage removed - all streaming now handled by MCP pipeline

  // Message sending functionality from ChatWindow
  const handleSendMessage = useCallback(async () => {
    console.log('🚨🚨🚨 [SEND] CODE VERSION: 2024-12-08-01:30 - NEW CODE IS RUNNING! 🚨🚨🚨');
    const currentMsg = currentMessageRef.current;
    const textareaValue = textareaRef.current?.value || '';
    
    // Sending message...
    
    // Use textarea value as fallback if ref is empty
    const messageToSend = currentMsg || textareaValue;
    
    if (!messageToSend.trim() || isLoading || isProcessingLocally) {
      return;
    }
    
    // Get the message text early
    const messageText = messageToSend.trim();
    
    // ✨ OPTIMISTIC UI UPDATE: Clear input immediately for instant feedback
    setCurrentMessage('');
    setDisplayMessage('');
    currentMessageRef.current = '';
    
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
    
    // 🚀 OPTIMISTIC UI: Add user message to display immediately
    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      text: messageText,
      sender: 'user',
      timestamp: new Date(),
      isStreaming: false
    };
    
    setOptimisticMessage(tempMessage);
    
    // Reset user scrolling flag - user just sent a message, they want to see it!
    setIsUserScrolling(false);
    isProgrammaticScrolling.current = false;
    
    // DIRECT SCROLL: Just scroll the container to the bottom immediately
    const directScroll = () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
        console.log('📜 [SCROLL] Direct scroll executed - scrollTop:', container.scrollTop, 'scrollHeight:', container.scrollHeight);
      }
    };
    
    // Multiple scroll attempts with direct scrolling
    requestAnimationFrame(directScroll);
    setTimeout(directScroll, 50);
    setTimeout(directScroll, 150);
    setTimeout(directScroll, 300);
    setTimeout(directScroll, 500);
    
    // 🚀 NEW: Use signals for session management (eliminates race conditions!)
    logDebugState(); // Debug current signals state
    
    console.log('🔍 [SEND] signals.isLoading.value:', signals.isLoading.value);
    // Check if context is still loading
    if (signals.isLoading.value) {
      return;
    }
    
    // 🎯 CRITICAL: Use signals.activeSessionId.value for always-fresh value
    let currentSessionId = signals.activeSessionId.value;
    console.log('🔍 [SEND] Current activeSessionId from signals:', currentSessionId);
    console.log('🔍 [SEND] All sessions:', signals.sessions.value.map(s => ({ id: s.id, title: s.title, isActive: s.isActive })));
    
    // Check for selection from localStorage (needed for metadata AND content)
    let hasSelection = !!detectedSelection;
    let highlightedTextContent: string | undefined = undefined;
    
    // Extract highlighted text from detectedSelection or localStorage
    if (detectedSelection) {
      highlightedTextContent = detectedSelection.text || detectedSelection.fullText || detectedSelection.preview;
      console.log('🔍 [SEND] Using detectedSelection for highlighted text:', highlightedTextContent?.substring(0, 50) + '...');
    } else {
      // Check localStorage for persisted selection
      try {
        const storedSelection = localStorage.getItem('thinkdrop_captured_selection');
        if (storedSelection) {
          const selectionData = JSON.parse(storedSelection);
          // Check if not expired (30 seconds)
          const age = Date.now() - selectionData.timestamp;
          if (age < 30000) {
            hasSelection = true;
            highlightedTextContent = selectionData.text || selectionData.fullText || selectionData.preview;
            console.log('🔍 [SEND] Found selection in localStorage:', highlightedTextContent?.substring(0, 50) + '...');
          } else {
            console.log('⏰ [SEND] Selection in localStorage expired, clearing');
            localStorage.removeItem('thinkdrop_captured_selection');
          }
        }
      } catch (error) {
        console.warn('⚠️ [SEND] Failed to check localStorage selection:', error);
      }
    }
    
    console.log('🔍 [SEND] detectedSelection:', detectedSelection);
    console.log('🔍 [SEND] hasSelection:', hasSelection);
    console.log('🔍 [SEND] highlightedTextContent:', highlightedTextContent ? `"${highlightedTextContent.substring(0, 50)}..."` : 'undefined');
    
    // If no active session, create one using signals
    if (!currentSessionId) {
      try {
        // Use signals sendMessage - this handles session creation AND message sending
        currentSessionId = await signalsSendMessage(messageText);
        console.log('✅ [SEND] Created new session and sent message, sessionId:', currentSessionId);
        
        // Clear optimistic message once real message is added
        setOptimisticMessage(null);
        
        // Continue with the rest of the flow...
      } catch (error) {
        console.error('❌ [SIGNALS] Failed to send message:', error);
        setOptimisticMessage(null); // Clear on error too
        return;
      }
    } else {
      // For existing sessions, we need to manually add the user message
      console.log('📝 [SEND] Adding message to existing session:', currentSessionId);
      if (signalsAddMessage) {
        try {
          // 🔒 CRITICAL: Re-read activeSessionId to ensure we're using the correct session
          // This prevents race conditions where the session was just switched
          const latestSessionId = signals.activeSessionId.value || currentSessionId;
          console.log('🔒 [SEND] Session ID check before adding message - currentSessionId:', currentSessionId, 'latest:', latestSessionId);
          
          await signalsAddMessage(latestSessionId, {
            text: messageText,
            sender: 'user',
            sessionId: latestSessionId,
            metadata: {
              hasHighlightedText: hasSelection
            }
          });
          
          // Reload messages to ensure UI is updated
          console.log('🔄 [SEND] Reloading messages after adding user message...');
          await signalsLoadMessages(latestSessionId, {
            limit: 50,
            offset: 0,
            direction: 'DESC'
          });
          console.log('✅ [SEND] Messages reloaded, activeMessages count:', signals.activeMessages.value?.length);
          
          // Force a small delay to ensure signals have propagated and UI updates
          await new Promise(resolve => setTimeout(resolve, 150));
          
          // Clear optimistic message only after messages are loaded and UI has updated
          console.log('🧹 [SEND] Clearing optimistic message after reload');
          setOptimisticMessage(null);
          
          // Clear detected selection after message is sent
          setDetectedSelection(null);
          
          // Clear persisted selection in main process
          if ((window.electronAPI as any)?.clearPersistedSelection) {
            (window.electronAPI as any).clearPersistedSelection();
          }
        } catch (error) {
          console.error('❌ [SIGNALS] Failed to add user message:', error);
          setOptimisticMessage(null); // Clear on error too
        }
      }
    }
    
    setIsLoading(true);
    setLocalLLMError(null);
    setInitialThinkingMessage('Thinking'); // Reset to default at start of new message
    
    // Clear any previous streaming and error states
    setIsStreamingResponse(false);
    setStreamedAnswer('');
    streamedAnswerRef.current = '';
    setProcessedMessageIds(new Set());
    
    // Scroll to bottom immediately after user sends message to show "Thinking..." indicator
    // Use setTimeout to ensure DOM has updated before scrolling
    setTimeout(() => {
      scrollToBottom({ smooth: true, force: true });
    }, 100);
    
    try {
      // 🎯 UNIFIED PIPELINE: Always use MCP StateGraph
      const isOnlineMode = wsState.isConnected;
      
      // Note: WebSocket tracking removed - handled by MCP pipeline
      
      // Note: Context extraction removed - StateGraph nodes fetch context internally via MCP
      // The frontend only needs to pass sessionId, and nodes like resolveReferences, 
      // parseIntent, and answer will fetch messages as needed from conversation service
      
      // Use MCP StateGraph pipeline
      scrollToBottom({ smooth: true, force: true });
          
      try {
        // Set up early response listener (Phase 1 optimization)
        let intentMessageTimeout: NodeJS.Timeout | null = null;
        let intentMessage: string | null = null;
        
        const handleEarlyResponse = (_event: any, data: any) => {
          // Store the intent message but don't show it immediately
          intentMessage = data.message;
          
          // Show intent message after 2 seconds if response hasn't arrived yet
          intentMessageTimeout = setTimeout(() => {
            if (intentMessage) {
              setInitialThinkingMessage(intentMessage);
            }
          }, 4000); // 2 second delay
        };
        
        // Set up progress listener
        const handleProgress = (_event: any, _data: any) => {
          // Progress tracking (currently unused)
        };
        
        // Register listeners
        if (window.electronAPI?.onPrivateModeEarlyResponse) {
          window.electronAPI.onPrivateModeEarlyResponse(handleEarlyResponse);
        }
        if (window.electronAPI?.onPrivateModeProgress) {
          window.electronAPI.onPrivateModeProgress(handleProgress);
        }
        
        // 📋 Listen for selection detection
        const handleSelectionDetected = (_event: any, selection: any) => {
          console.log('📋 [SELECTION] Detected in renderer:', selection);
          setDetectedSelection(selection);
          // Auto-clear after 5 seconds
          setTimeout(() => setDetectedSelection(null), 5000);
        };
        
        if ((window.electronAPI as any)?.onPrivateModeSelectionDetected) {
          (window.electronAPI as any).onPrivateModeSelectionDetected(handleSelectionDetected);
        }
        
        // ⚡ Streaming via orchestrator (proper architecture)
        let streamedAnswer = '';
        let isStreamingActive = false;
        
        // Register stream token listener
        const handleStreamToken = (_event: any, data: { token: string }) => {
          if (!isStreamingActive) {
            isStreamingActive = true;
            setIsStreamingResponse(true);
          }
          streamedAnswer += data.token;
          streamedAnswerRef.current = streamedAnswer;
          setStreamedAnswer(streamedAnswer);
          
          // Throttle scroll updates during streaming (every 100ms instead of every token)
          if (!scrollThrottleRef.current) {
            scrollThrottleRef.current = window.setTimeout(() => {
              scrollThrottleRef.current = null;
              // Smooth scroll to bottom without interrupting user
              if (!isUserScrolling && messagesContainerRef.current) {
                messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
              }
            }, 200);
          }
        };
        
        if (window.electronAPI?.onPrivateModeStreamToken) {
          window.electronAPI.onPrivateModeStreamToken(handleStreamToken);
        }
        
        console.log('🚀 [CALLING-BACKEND] About to call privateModeProcess with message:', messageText);
        
        // Call MCP unified orchestrator (with streaming support)
        // 🌐 Pass sessionId and online mode flag - StateGraph fetches context internally
        console.log('📋 [CALLING-BACKEND] Passing highlightedText:', highlightedTextContent ? `"${highlightedTextContent.substring(0, 50)}..."` : 'undefined');
        
        if (!window.electronAPI?.privateModeProcess) {
          console.error('❌ [CALLING-BACKEND] privateModeProcess not available');
          setLocalLLMError('Backend communication not available');
          setIsLoading(false);
          setIsProcessingLocally(false);
          return;
        }
        
        // 🔒 CRITICAL: Re-read activeSessionId right before sending to ensure we have the latest value
        // This prevents race conditions where the session was switched but we're using a stale value
        const finalSessionId = signals.activeSessionId.value || currentSessionId;
        console.log('🔒 [SEND] Final session ID check - currentSessionId:', currentSessionId, 'signals.activeSessionId.value:', signals.activeSessionId.value, 'using:', finalSessionId);
        
        const result = await window.electronAPI.privateModeProcess({
          message: messageText,
          context: {
            sessionId: finalSessionId,
            userId: 'default_user',
            timestamp: new Date().toISOString(),
            conversationHistory: [], // StateGraph nodes fetch context via MCP
            useOnlineMode: isOnlineMode,
            highlightedText: highlightedTextContent, // Pass the extracted content
            metadata: {
              hasHighlightedText: hasSelection
            }
          }
        });
        
        console.log('📦 [RESULT-RECEIVED] Got result from backend:', result);
        console.log('🔍 [RESULT-DETAILS] requiresConfirmation:', result?.requiresConfirmation, 'confirmationDetails:', result?.confirmationDetails);
        
        // Check for Gemini warning
        if (result?.geminiWarning) {
          console.warn('⚠️ [GEMINI-WARNING]', result.geminiWarning);
          showToast(
            result.geminiWarning.message,
            result.geminiWarning.severity === 'error' ? 'error' : 'warning'
          );
        }
        
        // Cleanup listeners and timeout
        if (intentMessageTimeout) {
          clearTimeout(intentMessageTimeout);
        }
        if (scrollThrottleRef.current) {
          clearTimeout(scrollThrottleRef.current);
          scrollThrottleRef.current = null;
        }
        if (window.electronAPI?.removePrivateModeListeners) {
          window.electronAPI.removePrivateModeListeners();
        }
        
        // Check if command requires confirmation
        console.log('🔍 [CONFIRMATION-CHECK] Checking result:', {
          hasResult: !!result,
          requiresConfirmation: result?.requiresConfirmation,
          hasDetails: !!result?.confirmationDetails,
          fullResult: result
        });
        
        if (result?.requiresConfirmation && result?.confirmationDetails) {
          console.log('⚠️ [CONFIRMATION] Command requires user confirmation:', result.confirmationDetails);
          
          // Set pending confirmation state via prop
          onPendingConfirmation?.({
            command: result.confirmationDetails.command,
            category: result.confirmationDetails.category,
            riskLevel: result.confirmationDetails.riskLevel,
            resolvedMessage: result.confirmationDetails.resolvedMessage,
            originalMessage: result.confirmationDetails.originalMessage
          });
          
          console.log('✅ [CONFIRMATION] Pending confirmation set, stopping loading');
          
          // Stop loading
          setIsStreamingResponse(false);
          setIsLoading(false);
          setIsProcessingLocally(false);
          return; // Don't add AI message yet
        }
        
        console.log('ℹ️ [CONFIRMATION-CHECK] No confirmation required, proceeding normally');
        
        // Determine final answer: use streamed if available, otherwise use result.response
        const finalAnswer = isStreamingActive ? streamedAnswerRef.current : result?.response;
        
        if (finalAnswer) {
            // Check if this is a guide response first
            const isGuideResponse = result?.guideMode && result?.guideId && result?.guideSteps;
            
            // Add AI response to conversation (only if not a guide and not already saved during streaming)
            if (!isGuideResponse && signalsAddMessage && currentSessionId) {
              await signalsAddMessage(currentSessionId, {
                text: finalAnswer,
                sender: 'ai',
                sessionId: currentSessionId,
                metadata: { 
                  isFinal: true,
                  action: result?.action,
                  mcpPrivateMode: true,
                  elapsedMs: result?.elapsedMs,
                  streaming: isStreamingActive,
                  success: result?.success
                }
              });
              
              // Reload messages to ensure UI is updated
              await signalsLoadMessages(currentSessionId, {
                limit: 50,
                offset: 0,
                direction: 'DESC'
              });
            }
            
            // Check if this is a guide response and show the guide overlay
            console.log('🔍 [GUIDE-DEBUG] Checking for guide in result:', {
              hasGuideMode: !!result?.guideMode,
              hasGuideId: !!result?.guideId,
              hasGuideSteps: !!result?.guideSteps,
              action: result?.action,
              resultKeys: result ? Object.keys(result) : []
            });
            
            if (result?.guideMode && result?.guideId && result?.guideSteps) {
              console.log('📚 [GUIDE] Detected guide response from MCP, showing overlay:', {
                guideId: result.guideId,
                totalSteps: result.guideTotalSteps
              });
              showGuide(
                result.guideId,
                finalAnswer, // Use response as intro text
                result.guideSteps,
                result.guideTotalSteps || result.guideSteps.length
              );
            } else {
              console.warn('⚠️ [GUIDE] Guide detection failed - missing required fields');
            }
            
            // Stop loading and scroll
            setIsStreamingResponse(false);
            setIsLoading(false);
            setIsProcessingLocally(false);
            scrollToBottom({ smooth: true, force: true });
            
            // Log any errors but don't prevent displaying the response
            if (!result?.success && result?.error) {
              console.warn('⚠️ [MCP-PRIVATE] Partial success with errors:', result.error);
            }
          } else {
            console.error('❌ [MCP-PRIVATE] No response received:', result?.error || 'Unknown error');
            setLocalLLMError(`MCP Private Mode error: ${result?.error || 'No response received'}`);
            setIsStreamingResponse(false);
            setIsLoading(false);
            setIsProcessingLocally(false);
          }
      } catch (error: any) {
        console.error('❌ [MCP-UNIFIED] Exception:', error);
        setLocalLLMError(`MCP Unified Pipeline exception: ${error?.message || 'Unknown error'}`);
        setIsStreamingResponse(false);
        setIsLoading(false);
        setIsProcessingLocally(false);
      }
      
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      setIsStreamingResponse(false);
      setIsLoading(false);
      setLocalLLMError('Failed to process message. Please try again.');
    }
    
    // Auto-focus back to textarea after sending
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
  }, [isLoading, isProcessingLocally, wsState.isConnected]);

 
  // Clear local LLM error when connection is restored
  useEffect(() => {
    if (wsState.isConnected && localLLMError) {
      setLocalLLMError(null);
    }
  }, [wsState.isConnected, localLLMError]);

  // Sync displayMessage with currentMessage when it changes programmatically
  useEffect(() => {
    setDisplayMessage(currentMessage);
  }, [currentMessage]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (resizeTimeoutRef.current) {
        cancelAnimationFrame(resizeTimeoutRef.current);
      }
    };
  }, []);

  // Handle screen refresh
  const handleRefreshScreen = useCallback(async () => {
    try {
      setIsRefreshingScreen(true);
      await (window.electronAPI as any)?.invoke('screen-intelligence:refresh');
      showToast('Screen capture refreshed! Next AI response will use updated screen content.', 'success');
    } catch (error) {
      console.error('❌ Error refreshing screen:', error);
      showToast('Failed to refresh screen capture', 'error');
    } finally {
      setTimeout(() => setIsRefreshingScreen(false), 1000);
    }
  }, [showToast]);

  // // Handle WebSocket toggle for testing local LLM fallback
  const handleWebSocketToggle = useCallback(async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    try {
      if (wsState.isConnected) {
        await disconnectWebSocket();
      } else {
        await connectWebSocket();
      }
    } catch (error) {
      console.error('❌ Error toggling WebSocket connection:', error);
    } 
  }, [wsState.isConnected, connectWebSocket, disconnectWebSocket]);
  
  // Input handlers from ChatWindow
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => {
        handleSendMessage();
      }, 0);
    }
  };
  
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const target = e.target;
    
    // Update ref immediately - no React state updates for better performance
    currentMessageRef.current = value;
    
    // Debounce only the button state update
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    debounceTimeoutRef.current = setTimeout(() => {
      setDisplayMessage(value); // Only for button disabled state
      setCurrentMessage(value); // For other components that need it
    }, 100); // Reduced debounce time
    
    // Auto-resize textarea with optimized timing
    if (resizeTimeoutRef.current) {
      cancelAnimationFrame(resizeTimeoutRef.current);
    }
    
    // const target = e.target;
    requestAnimationFrame(() => {
      // Always reset height to auto first to get accurate scrollHeight
      target.style.height = 'auto';
      
      // Calculate the proper height based on content
      const newHeight = Math.max(40, Math.min(target.scrollHeight, 128)); // Min 40px, Max 128px
      target.style.height = newHeight + 'px';
    });
  }, []);
  
  // Focus management from ChatWindow
  const focusTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  };

  // Message action handlers
  const handleCopyMessage = useCallback(async (messageText: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(messageText);
      
      // Show checkmark feedback
      setCopiedMessageIds(prev => new Set(prev).add(messageId));
      
      // Remove checkmark after 2 seconds
      setTimeout(() => {
        setCopiedMessageIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
      }, 2000);
    } catch (error) {
      console.error('❌ Failed to copy message:', error);
    }
  }, []);

  useEffect(() => {
    // Messages are now managed by ConversationContext, no need for localStorage
    // Messages are managed by ConversationContext - no localStorage needed
  }, []);

  const handleRegenerateMessage = useCallback(async (messageId: string) => {
    // Find the user message that preceded this AI message
    const messageIndex = displayMessages.findIndex(m => m.id === messageId);
    if (displayMessages.length > 0) {
      const lastMessage = displayMessages[displayMessages.length - 1];
      if (lastMessage.sender === 'user') {
        await handleSendMessage();
      }
    }
    if (messageIndex > 0) {
      const previousMessage = displayMessages[messageIndex - 1];
      if (previousMessage.sender === 'user') {
        console.log('🔄 Regenerating response for:', previousMessage.text);
        // Set the previous message in textarea and send
        setCurrentMessage(previousMessage.text);
        // Use setTimeout to ensure state is updated before sending
        setTimeout(async () => {
          await handleSendMessage();
        }, 0);
      }
    }
  }, [handleSendMessage]);

  // const handleEditMessage = useCallback((messageId: string, messageText: string) => {
  //   console.log('✏️ Edit message:', messageId, messageText);
  //   // Start inline editing
  //   setEditingMessageId(messageId);
  //   setEditingText(messageText);
  //   // Focus the edit textarea after state update
  //   setTimeout(() => {
  //     if (editTextareaRef.current) {
  //       editTextareaRef.current.focus();
  //       editTextareaRef.current.setSelectionRange(
  //         editTextareaRef.current.value.length,
  //         editTextareaRef.current.value.length
  //       );
  //     }
  //   }, 0);
  // }, []);

  const handleThumbsUp = useCallback((messageId: string) => {
    console.log('👍 Thumbs up for message:', messageId);
    // TODO: Send feedback to backend
  }, []);

  const handleThumbsDown = useCallback((messageId: string) => {
    console.log('👎 Thumbs down for message:', messageId);
    // TODO: Send feedback to backend
  }, []);

  const handleSaveEdit = useCallback(async (messageId: string) => {
    if (!editingText.trim()) return;
    console.log('✅ Saving edit for message:', messageId, editingText);
    
    // Update message in ConversationContext instead of local state
    if (activeSessionId) {
      // For now, just log - proper message editing should be implemented in ConversationContext
      console.log('📝 Message edit requested - should be handled by ConversationContext');
    }
    
    // Set the edited text in the main textarea and send
    setCurrentMessage(editingText.trim());
    setTimeout(async () => {
      await handleSendMessage();
    }, 0);
    
    // Exit edit mode
    setEditingMessageId(null);
    setEditingText('');
  }, [editingText, activeSessionId, handleSendMessage]);

  const handleEditMessage = useCallback((messageId: string, messageText: string) => {
    console.log('✏️ Edit message:', messageId, messageText);
    setEditingMessageId(messageId);
    setEditingText(messageText);
    setTimeout(() => {
      if (editTextareaRef.current) {
        editTextareaRef.current.focus();
        editTextareaRef.current.setSelectionRange(
          editTextareaRef.current.value.length,
          editTextareaRef.current.value.length
        );
      }
    }, 0);
  }, []);

  const handleCancelEdit = useCallback(() => {
    console.log('❌ Canceling edit');
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleEditTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingText(e.target.value);
    const target = e.target;
    requestAnimationFrame(() => {
      target.style.height = 'auto';
      const newHeight = Math.max(40, Math.min(target.scrollHeight, 128));
      target.style.height = newHeight + 'px';
    });
  }, []);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>, messageId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit(messageId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  }, [handleSaveEdit, handleCancelEdit]);

  useEffect(() => {
    // Initialize session on mount
    const initializeSession = async () => {
      console.log('🚀 [CHATMESSAGES] Initializing session...');
      
      // Load all sessions first
      await signalsLoadSessions();
      console.log('✅ [CHATMESSAGES] Sessions loaded, count:', sessions.length);
      
      // Determine which session to use
      let sessionToUse = activeSessionId;
      
      if (!sessionToUse) {
        // If no active session, use the first available session or create one
        if (sessions.length > 0) {
          sessionToUse = sessions[0].id;
          signals.activeSessionId.value = sessionToUse;
          console.log('✅ [CHATMESSAGES] Using first available session:', sessionToUse);
        } else {
          // No sessions exist, create a default one
          console.log('🆕 [CHATMESSAGES] No sessions found, creating default session');
          const newSessionId = await createSession('user-initiated', {
            title: 'Chat Session'
          });
          
          if (!newSessionId) {
            console.error('❌ [CHATMESSAGES] Failed to create default session');
            return;
          }
          
          sessionToUse = newSessionId;
          console.log('✅ [CHATMESSAGES] Created default session:', sessionToUse);
        }
      }
      
      console.log('📋 [CHATMESSAGES] Active session ID:', sessionToUse);
      
      // Ensure we have a valid session before loading messages
      if (!sessionToUse) {
        console.error('❌ [CHATMESSAGES] No valid session ID available');
        return;
      }
      
      // Load messages for the active session
      await signalsLoadMessages(sessionToUse, {
        limit: 50,
        offset: 0,
        direction: 'DESC'
      });
      
      console.log('✅ [CHATMESSAGES] Session initialized');
    };
    
    initializeSession();
    
    // Connect WebSocket when component mounts
    // connectWebSocket().catch(error => {
    //   console.error('❌ Failed to connect WebSocket on mount:', error);
    // });
    
    // Auto-focus textarea
    focusTextarea();
    const timeoutId = setTimeout(focusTextarea, 100);
    
    // 📋 Check for highlighted text when window opens
    const checkForSelection = async () => {
      console.log('🔍 [SELECTION] checkForSelection called');
      try {
        if (!(window.electronAPI as any)?.checkSelection) {
          console.warn('⚠️  [SELECTION] electronAPI.checkSelection not available');
          return;
        }
        
        console.log('📞 [SELECTION] Calling checkSelection API...');
        const selection = await (window.electronAPI as any).checkSelection();
        console.log('📋 [SELECTION] API returned:', selection);
        
        if (selection) {
          console.log('✅ [SELECTION] Selection detected, setting state:', selection);
          setDetectedSelection(selection);
          // Keep indicator visible longer on mount (10 seconds instead of 5)
          setTimeout(() => setDetectedSelection(null), 10000);
        } else {
          console.log('⏭️  [SELECTION] No selection found');
        }
      } catch (error) {
        console.error('❌ [SELECTION] Failed to check for selection:', error);
      }
    };
    
    // Check on mount
    console.log('🚀 [CHATMESSAGES] Component mounted, checking for selection...');
    checkForSelection();
    
    // Also check when window becomes visible (Electron-specific)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('👁️  [VISIBILITY] Window became visible, checking for selection...');
        checkForSelection();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for selection available events from main process
    const handleSelectionAvailable = (_: any, selectionData: any) => {
      console.log('📢 [SELECTION] Received selection-available event:', selectionData);
      setDetectedSelection(selectionData);
      // Keep indicator visible for 10 seconds
      setTimeout(() => setDetectedSelection(null), 10000);
    };
    
    (window.electronAPI as any)?.onSelectionAvailable?.(handleSelectionAvailable);
    
    // Listen for message updates from other windows
    const handleMessageUpdate = async (_: any, data: { sessionId: string }) => {
      // Use signals.activeSessionId.value to get the CURRENT value, not the captured one
      const currentSessionId = signals.activeSessionId.value;
      console.log('📨 [CHATMESSAGES] Received message update for session:', data.sessionId);
      console.log('📨 [CHATMESSAGES] Current activeSessionId from signals:', currentSessionId);
      
      if (data.sessionId === currentSessionId || data.sessionId === 'default_session') {
        console.log('🔄 [CHATMESSAGES] Reloading messages for active session');
        await signalsLoadMessages(data.sessionId, {
          limit: 50,
          offset: 0,
          direction: 'DESC'
        });
      } else {
        console.log('⏭️  [CHATMESSAGES] Skipping reload - session mismatch');
      }
    };
    
    if ((window as any).electron?.ipcRenderer) {
      (window as any).electron.ipcRenderer.on('conversation:message-added', handleMessageUpdate);
    }
    
    // Listen for chat window visibility changes
    const handleChatWindowState = async (_: any, state: { isVisible: boolean }) => {
      // No need to reload messages on visibility change since component stays mounted
      // Messages are already loaded and will be updated via conversation:message-added events
      console.log('👁️  [CHATMESSAGES] Chat window visibility changed:', state.isVisible);
      
      // Removed reload logic to prevent flickering - component now stays mounted with CSS hidden
      // if (state.isVisible && currentSessionId) {
      //   console.log('🔄 [CHATMESSAGES] Window became visible, reloading messages');
      //   await signalsLoadMessages(currentSessionId, { limit: 50, offset: 0, direction: 'DESC' });
      // }
    };
    
    if ((window as any).electron?.ipcRenderer) {
      (window as any).electron.ipcRenderer.on('chat-window:state', handleChatWindowState);
    }
    
    // Listen for processing started/complete events from PromptBar
    const handleProcessingStarted = (_: any, data: { sessionId: string }) => {
      // Use signals.activeSessionId.value to get the CURRENT value, not the captured one
      const currentSessionId = signals.activeSessionId.value;
      console.log('💭 [CHATMESSAGES] Processing started for session:', data.sessionId);
      console.log('💭 [CHATMESSAGES] Current activeSessionId from signals:', currentSessionId);
      
      // Only show thinking indicator if the session matches the current active session
      // This prevents the UI from jumping to a different conversation
      if (data.sessionId === currentSessionId) {
        console.log('💭 [CHATMESSAGES] Session matches - setting isLoading to true');
        setIsLoading(true);
        setInitialThinkingMessage('Thinking');
      } else {
        console.log('⏭️  [CHATMESSAGES] Session mismatch - ignoring processing-started event');
        console.log('   Expected:', currentSessionId, 'Got:', data.sessionId);
      }
    };
    
    const handleProcessingComplete = (_: any, data: { sessionId: string }) => {
      const currentSessionId = signals.activeSessionId.value;
      console.log('✅ [CHATMESSAGES] Processing complete for session:', data.sessionId);
      console.log('✅ [CHATMESSAGES] Current activeSessionId from signals:', currentSessionId);
      
      // Always clear loading state
      console.log('✅ [CHATMESSAGES] Setting isLoading to false');
      setIsLoading(false);
      setIsProcessingLocally(false);
    };
    
    if ((window as any).electron?.ipcRenderer) {
      (window as any).electron.ipcRenderer.on('conversation:processing-started', handleProcessingStarted);
      (window as any).electron.ipcRenderer.on('conversation:processing-complete', handleProcessingComplete);
    }
    
    // Cleanup: disconnect when component unmounts
    return () => {
      disconnectWebSocket();
      clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      (window.electronAPI as any)?.removeSelectionListener?.();
      if ((window as any).electron?.ipcRenderer?.removeListener) {
        (window as any).electron.ipcRenderer.removeListener('conversation:message-added', handleMessageUpdate);
        (window as any).electron.ipcRenderer.removeListener('chat-window:state', handleChatWindowState);
        (window as any).electron.ipcRenderer.removeListener('conversation:processing-started', handleProcessingStarted);
        (window as any).electron.ipcRenderer.removeListener('conversation:processing-complete', handleProcessingComplete);
      }
    };
  }, []); // Remove dependencies to prevent re-mounting

  // Listen for thinking indicator updates from backend
  useEffect(() => {
    const handleThinkingUpdate = (_: any, data: { message: string; sessionId?: string; timestamp: number }) => {
      console.log('💭 Received thinking update:', data.message);
      
      // Only update if it's for the current session or no specific session
      if (!data.sessionId || data.sessionId === activeSessionId) {
        setInitialThinkingMessage(data.message);
        
        // Clear the thinking message after a delay if no new updates
        setTimeout(() => {
          setInitialThinkingMessage(null);
        }, 5000);
      }
    };

    // Set up IPC listener using the same pattern as other listeners
    if (window.electronAPI?.onThinkingIndicatorUpdate) {
      window.electronAPI.onThinkingIndicatorUpdate(handleThinkingUpdate);
    } else {
      console.warn('⚠️ onThinkingIndicatorUpdate not available in electronAPI');
    }
  }, [activeSessionId]);

  // Auto-scroll to bottom when new messages arrive (only if user is not manually scrolling)
  useEffect(() => {
    const hasMessages = displayMessages.length > 0;
    if (hasMessages && !isUserScrolling) {
      const lastMessage = displayMessages[displayMessages.length - 1];
      if (lastMessage && lastMessage.sender === 'ai' && !lastMessage.isStreaming) {
        scrollToBottom({ smooth: true, force: true });
      }
    }
  }, [displayMessages, scrollToBottom, isUserScrolling]);

  // Handle scroll to bottom button click
  const handleScrollToBottom = useCallback(() => {
    setIsUserScrolling(false);
    scrollToBottom({ smooth: true, force: true });
  }, [scrollToBottom]);

  // Handle scroll detection for scroll button visibility and batch loading
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const container = messagesContainerRef.current;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;
    
    // Check if scrolled to top (load older messages)
    if (scrollTop === 0 && hasMoreMessages && !loadingOlder) {
      loadOlderMessages();
    }
    
    // Show scroll button when not near bottom and there are messages
    setShowScrollButton(!isNearBottom && displayMessages.length > 0);
    
    // Track user scrolling - if user scrolls up, mark as user scrolling
    if (!isProgrammaticScrolling.current) {
      setIsUserScrolling(!isNearBottom);
      
      // Reset programmatic flag after a short delay
      setTimeout(() => {
        isProgrammaticScrolling.current = false;
      }, 100);
    }
  }, [displayMessages.length, hasMoreMessages, loadingOlder, loadOlderMessages]);

  useEffect(() => {
    // Listen for new messages from the main process
    if (window.electronAPI?.onChatMessage) {
      window.electronAPI.onChatMessage((_event: any, message: ChatMessage) => {
        // Check if we've already processed this message
        if (processedMessageIds.has(message.id)) {
          return;
        }
        
        // Add to processed messages
        setProcessedMessageIds(prev => new Set([...prev, message.id]));
        
        // Show loading indicator for user messages (AI response will come via WebSocket)
        if (message.sender === 'user') {
          setIsLoading(true);
          // Loading will be cleared when streaming starts
          setTimeout(() => {
            // Clear loading if no response comes within 15 seconds
            setIsLoading(false);
          }, 15000);
        } else if (message.sender === 'ai') {
          // Clear loading when AI response arrives (fallback)
          setIsLoading(false);
        }
      });
    }

    // Listen for orchestration updates (final results from background processing)
    
    if (!orchestrationListenerSetup.current && window.electronAPI?.onOrchestrationUpdate) {
      orchestrationListenerSetup.current = true;
      
      window.electronAPI.onOrchestrationUpdate(async (_event: any, updateData: any) => {
        // Create unique key for this update
        const updateKey = `${updateData.type}-${updateData.timestamp}-${updateData.response?.substring(0, 50)}`;
        
        // Mark as processed
        setProcessedMessageIds(prev => new Set([...prev, updateKey]));
        console.log('✅ [FRONTEND] Processing unique orchestration update:', updateKey);
        
        if (updateData.type === 'orchestration-complete' && updateData.response) {
          console.log('🎯 [ORCHESTRATION] Received final response, clearing thinking indicator');
          
          // Check if this message was already added to prevent duplicates
          const messageKey = `${updateData.response}_${updateData.timestamp}`;
          if (processedOrchestrationMessages.has(messageKey)) {
            console.log('⚠️ [ORCHESTRATION] Duplicate message detected, skipping:', messageKey);
          } else {
            setProcessedOrchestrationMessages(prev => new Set([...prev, messageKey]));
            
            // Add AI response to conversation session (this is what gets displayed)
            // Get current session ID from signals to avoid stale closure issues
            const currentSessionId = signals.activeSessionId.value;
            console.log('🔍 [ORCHESTRATION] Current session ID from signals:', currentSessionId);
                                                                                    
            if (currentSessionId && signalsAddMessage) {
              console.log('📝 [ORCHESTRATION] Adding AI response to conversation session:', currentSessionId);         
              await signalsAddMessage(currentSessionId, {
                text: updateData.response,
                sender: 'ai',
                sessionId: currentSessionId,
                metadata: {
                  handledBy: updateData.handledBy,
                  method: updateData.method,
                  originalTimestamp: updateData.timestamp
                }
              });
              console.log('✅ [ORCHESTRATION] AI response added to session successfully');
            } else {
              console.warn('⚠️ [ORCHESTRATION] No active session from signals; skipping adding AI response');
              console.warn('🔍 [ORCHESTRATION] Debug - currentSessionId:', currentSessionId, 'signalsAddMessage:', !!signalsAddMessage);
            }
          }
          
          // Clear loading and processing states
          console.log('🎯 [ORCHESTRATION] Clearing states - setIsLoading(false), setIsProcessingLocally(false)');
          setIsLoading(false);
          setIsProcessingLocally(false);
          // Don't reset thinking message here - let it disappear naturally when bubble appears
        }
      });
    }
  }, []); // Empty dependency array - orchestration listener should only be set up once

  useEffect(() => {
    const handleResize = () => {
      // Only auto-scroll on resize if user is not manually scrolling
      if (!isUserScrolling) {
        const scrollContainer = document.querySelector('.chat-messages-scroll');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isUserScrolling]);

  // Continuous auto-scroll during streaming for smooth experience
  useEffect(() => {
    if (!isStreamingResponse) return;
    
    // Use requestAnimationFrame for smooth 60fps scrolling
    let animationFrameId: number;
    
    const smoothScroll = () => {
      if (!isUserScrolling && messagesContainerRef.current) {
        const container = messagesContainerRef.current;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        
        // Only auto-scroll if user is near the bottom
        if (isNearBottom) {
          container.scrollTop = container.scrollHeight;
        }
      }
      
      // Continue animation loop while streaming
      if (isStreamingResponse) {
        animationFrameId = requestAnimationFrame(smoothScroll);
      }
    };
    
    // Start the animation loop
    animationFrameId = requestAnimationFrame(smoothScroll);
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isStreamingResponse, isUserScrolling]);

  // Always show the window, even when empty

  return (
    <TooltipProvider>
      <div 
        className="w-full h-full flex flex-col bg-transparent"
        style={{
          overflow: 'hidden'
        }}
      >
        {/* Header with sidebar toggle */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="Toggle conversations"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <div className="text-xs text-white/50">
            {displayMessages.length} message{displayMessages.length !== 1 ? 's' : ''}
          </div>
        </div>
        
        <div className="relative flex-1 flex flex-col min-h-0">
        {/* Loaded counter overlay */}
        <div className="absolute top-4 right-2 z-10 bg-gray-800/80 backdrop-blur-sm rounded-lg px-2 py-1 text-xs text-white/70">
          Loaded: {displayMessages.length}/{totalMessageCount > 0 ? totalMessageCount : '?'}
        </div>
        
        <div 
          ref={messagesContainerRef}
          className="overflow-y-auto overflow-x-hidden p-4 flex-1"
          onScroll={handleScroll}
          style={{ 
            WebkitAppRegion: 'no-drag',
            // flex: '1 1 0%', // Explicit flex-grow with flex-basis 0
            minHeight: 0, // Important for flex child to shrink
            // maxHeight: '100%',
            // height: '300vh' // Force full height
          } as React.CSSProperties}
        >
        <div className="space-y-4">
        {displayMessages.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-white/40 text-sm mb-2">No messages yet</div>
            <div className="text-white/30 text-xs">Start a conversation by typing in the chat input below</div>
          </div>
        ) : (
          <>
            {displayMessages.map((message) => (
              <div key={message.id} className={`group flex flex-col ${message.sender === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Message bubble */}
                <div 
                  className={`max-w-[85%] min-w-0 rounded-xl px-4 py-2 overflow-x-auto overflow-y-hidden ${
                    message.sender === 'user'
                      ? 'bg-gradient-to-r from-teal-500 to-blue-500 text-white'
                      : 'bg-white/10 text-white/90 border border-white/10'
                  }`}
                >
                  {editingMessageId === message.id ? (
                    /* Inline edit mode */
                    <div className="space-y-2">
                      <textarea
                        ref={editTextareaRef}
                        value={editingText}
                        onChange={handleEditTextareaChange}
                        onKeyDown={(e) => handleEditKeyDown(e, message.id)}
                        className="w-full bg-transparent text-sm leading-relaxed resize-none outline-none border-none text-white placeholder-white/50"
                        placeholder="Edit your message..."
                        style={{ minHeight: '24px' }}
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-white/70 hover:text-white hover:bg-white/10"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-white/70 hover:text-white hover:bg-white/10"
                          onClick={() => handleSaveEdit(message.id)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Normal message display */
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      <RichContentRenderer content={message.text} animated={true} />
                    </div>
                  )}
                </div>
                
                {/* Timestamp and Action buttons at bottom - hide during edit mode */}
                {editingMessageId !== message.id && (
                  <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {/* Timestamp */}
                  <span className="text-xs text-white/40">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  
                  <div className="flex gap-1">
                  {/* Copy button for all messages */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-6 p-0 transition-colors duration-200 ${
                          copiedMessageIds.has(message.id)
                            ? 'text-green-400 hover:text-green-300'
                            : 'text-white/60 hover:text-white'
                        } hover:bg-white/10`}
                        onClick={() => handleCopyMessage(message.text, message.id)}
                      >
                        {copiedMessageIds.has(message.id) ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {copiedMessageIds.has(message.id) ? 'Copied!' : 'Copy message'}
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* AI-specific buttons */}
                  {message.sender === 'ai' && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-white/60 hover:text-white hover:bg-white/10"
                            onClick={() => handleRegenerateMessage(message.id)}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Regenerate response</TooltipContent>
                      </Tooltip>
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-white/60 hover:text-green-400 hover:bg-white/10"
                            onClick={() => handleThumbsUp(message.id)}
                          >
                            <ThumbsUp className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Good response</TooltipContent>
                      </Tooltip>
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-white/60 hover:text-red-400 hover:bg-white/10"
                            onClick={() => handleThumbsDown(message.id)}
                          >
                            <ThumbsDown className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Poor response</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  
                  {/* User-specific buttons */}
                  {message.sender === 'user' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-white/60 hover:text-white hover:bg-white/10"
                          onClick={() => handleEditMessage(message.id, message.text)}
                        >
                          <Edit3 className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit message</TooltipContent>
                    </Tooltip>
                  )}
                  </div>
                  </div>
                )}
              </div>
            ))}
            
            {/* Note: Old WebSocket streaming display removed - using MCP streaming below */}
            
            {/* ⚡ NEW: Streaming response display */}
            {isStreamingResponse && streamedAnswer && (
              <div className="flex justify-start group">
                <div className="max-w-[85%] min-w-0 bg-white/10 text-white/90 border border-white/10 rounded-xl px-4 py-2 overflow-x-auto overflow-y-hidden">
                  <div className="text-sm leading-relaxed whitespace-pre-wrap text-white">
                    {streamedAnswer}
                    <span className="inline-block w-2 h-4 bg-white/60 ml-1 animate-pulse">▊</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        
        {/* Thinking indicator - show when loading and not streaming */}
        {!isStreamingResponse && (isLoading || isProcessingLocally) && (
          <div className="flex justify-start">
            {initialThinkingMessage && (
            <ThinkingIndicator isVisible={initialThinkingMessage !== ''} message={initialThinkingMessage} />
            )}
            {/* <div className="bg-white/10 text-white/90 border border-white/10 rounded-xl px-4 py-2">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                {initialThinkingMessage && (
                  <span className="ml-2 text-xs text-white/60">{initialThinkingMessage}</span>
                )}
              </div>
            </div> */}
          </div>
        )}
        
        {/* Invisible element to scroll to */}
        <div ref={messagesEndRef} />
        </div>
        
        {/* Scroll to bottom button - positioned over messages area but outside scroll container */}
        {showScrollButton && (
          <div className="absolute bottom-4 right-4 z-10">
            <button
              onClick={handleScrollToBottom}
              className="bg-gray-800/90 hover:bg-gray-700/90 text-white/90 rounded-full p-2 shadow-lg transition-all duration-200 hover:scale-105 border border-white/10"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="Scroll to bottom"
            >
              <svg 
                className="w-5 h-5" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M19 14l-7 7m0 0l-7-7m7 7V3" 
                />
              </svg>
            </button>
          </div>
        )}
        
        </div>
      </div>
      
    </div>
    </TooltipProvider>
  );
}
