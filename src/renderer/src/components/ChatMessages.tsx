import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Droplet, Send, Unplug, Copy, RotateCcw, Edit3, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from './ui/tooltip';
import useWebSocket from '../hooks/useWebSocket';
import { ThinkingIndicator } from './AnalyzingIndicator';
import MarkdownRenderer from './MarkdownRenderer';
import { useConversationSignals } from '../hooks/useConversationSignals';
import { useToast } from './Toast';

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
  // Toast notifications
  const { showToast, ToastContainer } = useToast();
  
  // Use signals for session management (eliminates race conditions)
  const {
    signals,
    activeSessionId,
    sendMessage: signalsSendMessage,
    addMessage: signalsAddMessage,
    loadMessages: signalsLoadMessages,
    logDebugState
  } = useConversationSignals();



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
    if (!activeSessionId) {
      return [];
    }
    
    const sessionMessages = signals.activeMessages.value || [];
    
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
    
    return converted;
  }, [activeSessionId, signals.activeMessages.value, totalMessageCount]);
  
  // Note: handleWebSocketMessage removed - all streaming now handled by MCP pipeline

  // Message sending functionality from ChatWindow
  const handleSendMessage = useCallback(async () => {
    const currentMsg = currentMessageRef.current;
    const textareaValue = textareaRef.current?.value || '';
    
    // Sending message...
    
    // Use textarea value as fallback if ref is empty
    const messageToSend = currentMsg || textareaValue;
    
    if (!messageToSend.trim() || isLoading || isProcessingLocally) {
      return;
    }
    
    // 🚀 NEW: Use signals for session management (eliminates race conditions!)
    logDebugState(); // Debug current signals state
    
    // Check if context is still loading
    if (signals.isLoading.value) {
      return;
    }
    
    // 🎯 CRITICAL: Use signals.activeSessionId.value for always-fresh value
    let currentSessionId = signals.activeSessionId.value;
    
    // If no active session, create one using signals
    if (!currentSessionId) {
      try {
        // Use signals sendMessage which handles session creation automatically
        const messageText = messageToSend.trim();
        
        // Clear UI immediately
        setCurrentMessage('');
        setDisplayMessage('');
        currentMessageRef.current = '';
        
        if (textareaRef.current) {
          textareaRef.current.value = '';
          textareaRef.current.style.height = 'auto';
        }
        
        // Use signals sendMessage - this handles session creation AND message sending
        currentSessionId = await signalsSendMessage(messageText);
        
        // Continue with the rest of the flow...
      } catch (error) {
        console.error('❌ [SIGNALS] Failed to send message:', error);
        return;
      }
    } else {
      // For existing sessions, we need to manually add the user message
      if (signalsAddMessage) {
        try {
          await signalsAddMessage(currentSessionId, {
            text: messageToSend.trim(),
            sender: 'user',
            sessionId: currentSessionId,
            metadata: {}
          });
        } catch (error) {
          console.error('❌ [SIGNALS] Failed to add user message:', error);
        }
      }
    }
    
    const messageText = messageToSend.trim();
    
    // ✨ OPTIMISTIC UI UPDATE: Clear input and show "Thinking..." immediately
    setCurrentMessage('');
    setDisplayMessage('');
    currentMessageRef.current = ''; // Keep ref in sync
    
    // Clear textarea and reset height for uncontrolled component
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
      // xlastHeightRef.current = 40;
    }
    
    setIsLoading(true);
    setLocalLLMError(null);
    setInitialThinkingMessage('Thinking'); // Reset to default at start of new message
    
    // Clear any previous error states
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
        const result = await window.electronAPI?.privateModeProcess({
          message: messageText,
          context: {
            sessionId: currentSessionId,
            userId: 'default_user',
            timestamp: new Date().toISOString(),
            conversationHistory: [], // StateGraph nodes fetch context via MCP
            useOnlineMode: isOnlineMode
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
        
        if (result?.success) {
            // Determine final answer: use streamed if available, otherwise use result.response
            const finalAnswer = isStreamingActive ? streamedAnswerRef.current : result.response;
            
            // Add AI response to conversation (only if not already saved during streaming)
            if (signalsAddMessage && currentSessionId && finalAnswer) {
              await signalsAddMessage(currentSessionId, {
                text: finalAnswer,
                sender: 'ai',
                sessionId: currentSessionId,
                metadata: { 
                  isFinal: true,
                  action: result.action,
                  mcpPrivateMode: true,
                  elapsedMs: result.elapsedMs,
                  streaming: isStreamingActive
                }
              });
            }
            
            // Stop loading and scroll
            setIsStreamingResponse(false);
            setIsLoading(false);
            setIsProcessingLocally(false);
            scrollToBottom({ smooth: true, force: true });
          } else {
            console.error('❌ [MCP-PRIVATE] Orchestration failed:', result.error);
            setLocalLLMError(`MCP Private Mode error: ${result.error}`);
            setIsLoading(false);
            setIsProcessingLocally(false);
          }
      } catch (error: any) {
        console.error('❌ [MCP-UNIFIED] Exception:', error);
        setLocalLLMError(`MCP Unified Pipeline exception: ${error?.message || 'Unknown error'}`);
        setIsLoading(false);
        setIsProcessingLocally(false);
      }
      
    } catch (error) {
      console.error('❌ Failed to send message:', error);
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
    // Connect WebSocket when component mounts
    connectWebSocket().catch(error => {
      console.error('❌ Failed to connect WebSocket on mount:', error);
    });
    
    // Auto-focus textarea
    focusTextarea();
    const timeoutId = setTimeout(focusTextarea, 100);
    
    // Cleanup: disconnect when component unmounts
    return () => {
      disconnectWebSocket();
      clearTimeout(timeoutId);
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
    
    // Track user scrolling
    if (!isProgrammaticScrolling.current) {
      setIsUserScrolling(!isNearBottom);
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
    <>
    <ToastContainer />
    <TooltipProvider>
      <div 
        className="w-full h-full flex flex-col bg-transparent"
        style={{
          overflow: 'hidden'
        }}
      >
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
                      <MarkdownRenderer content={message.text} />
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
        
        {/* Thinking indicator for local LLM processing */}
        {(() => {
          // Hide thinking indicator if streaming has started
          if (isStreamingResponse) return false;
          
          const shouldShow = (isLoading && !wsState.isConnected) || isProcessingLocally;
          
          return shouldShow;
        })() ? (
          <ThinkingIndicator 
            isVisible={true} 
            message={initialThinkingMessage || undefined} 
          />
        ) : (isLoading && wsState.isConnected && !isStreamingResponse) ? (
          <div className="flex justify-start">
            <div className="bg-white/10 text-white/90 border border-white/10 rounded-xl px-4 py-2">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        ) : null}
        
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
      
      {/* Chat Input Area - Fixed at bottom */}
      <div className="px-3 pt-3 pb-1 border-t border-white/10 flex-shrink-0">
        <div 
          className="rounded-xl bg-gray-800/30 p-3 mb-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex items-center space-x-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div 
                  className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 ${
                    wsState.isConnected 
                      ? 'from-teal-400 to-blue-500 hover:from-teal-300 hover:to-blue-400' 
                      : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
                  }`}
                  onClick={handleWebSocketToggle}
                >
                  {wsState.isConnected ? <Droplet className="w-4 h-4 text-white" /> : <Unplug className="w-4 h-4 text-white" />}
                  {/* WebSocket Connection Status Indicator */}
                  {isLoading && (
                    <div 
                      className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-pulse" 
                      title="Processing..."
                    />
                  )}
                  {wsState.isConnected && !isLoading && (
                    <div 
                      className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full" 
                      title="Connected"
                    />
                  )}
                  {!wsState.isConnected && !isLoading && (
                    <div 
                      className="absolute -top-1 -right-1 w-3 h-3 bg-red-400 rounded-full" 
                      title="Disconnected"
                    />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {wsState.isConnected ? 'Live: Messages sent to the server.' : 'Private: conversation is local.'}
                </p>
              </TooltipContent>
            </Tooltip>   
            <textarea
              ref={textareaRef}
              defaultValue=""
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="flex-1 text-sm bg-white/5 text-white placeholder-white/50 resize-none min-h-[24px] max-h-32 py-2 px-3 rounded-lg border border-white/10 focus:border-teal-400/50 focus:outline-none transition-colors"
              rows={1}
              style={{ WebkitAppRegion: 'no-drag', outline: 'none', boxShadow: 'none' } as React.CSSProperties}
            />
            <Button
              onClick={handleSendMessage}
              disabled={!displayMessage.trim() || isLoading}
              className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white w-9 h-9 p-0 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Send className="w-3 h-3" />
            </Button>
          </div>
          <div className="text-xs mt-2 text-white/60 text-center">
            {wsState.isConnected ? 'Live Mode On' : 'Private Mode On'} | AI can make mistakes.
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
    

    </>
  );
}
