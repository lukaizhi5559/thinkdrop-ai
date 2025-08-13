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
import MarkdownRenderer from './Markdown';
import { useConversationSignals } from '../hooks/useConversationSignals';
// import { useLocalLLM } from '../contexts/LocalLLMContext';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  isStreaming?: boolean;
}

export default function ChatMessages() {
  // Use signals for session management (eliminates race conditions)
  const {
    signals,
    activeSessionId,
    sendMessage: signalsSendMessage,
    addMessage: signalsAddMessage,
    loadMessages: signalsLoadMessages,
    logDebugState
  } = useConversationSignals();



  // LocalLLM integration comment out for now
  // const { isInitialized, isLocalLLMAvailable } = useLocalLLM();
  
  // WebSocket integration for receiving streaming responses
  const {
    state: wsState,
    sendLLMRequest,
    connect: connectWebSocket,
    disconnect: disconnectWebSocket
  } = useWebSocket({
    autoConnect: false, // Manual connection control
    onConnected: () => console.log('✅ ChatMessages WebSocket connected'),
    onDisconnected: () => console.log('🔌 ChatMessages WebSocket disconnected'),
    onError: (error) => console.error('❌ ChatMessages WebSocket error:', error),
    onMessage: (message) => {
      console.log('📨 ChatMessages received WebSocket message:', message);
      handleWebSocketMessage(message);
    }
  });



  // Use signals as primary source of truth
  const sessions = signals.sessions.value;
  const contextIsLoading = signals.isLoading.value;

  // State for localStorage persistence fallback
  const [, setLastKnownSessions] = useState<any[]>(() => {
    const stored = localStorage.getItem('lastKnownSessions');
    return stored ? JSON.parse(stored) : [];
  });
  const [initialThinkingMessage, setInitialThinkingMessage] = useState<string>('Thinking');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const isStreamingEndedRef = useRef<boolean>(false);
  
  // Local LLM processing state
  const [isProcessingLocally, setIsProcessingLocally] = useState(false);
  const [localLLMError, setLocalLLMError] = useState<string | null>(null);
  
  // Input state from ChatWindow
  const [currentMessage, setCurrentMessage] = useState('');
  const [displayMessage, setDisplayMessage] = useState(''); // For immediate display
  
  // Inline editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  
  // Copy feedback state
  const [copiedMessageIds, setCopiedMessageIds] = useState<Set<string>>(new Set());

  // Load state
  const [isLoading, setIsLoading] = useState(false);
  const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());
  const [processedOrchestrationMessages, setProcessedOrchestrationMessages] = useState<Set<string>>(new Set());
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState<string>('');
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const currentMessageRef = useRef<string>('');
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);
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
    console.log('🔍 [ChatMessages] activeSessionId changed:', activeSessionId);
    console.log('🔍 [ChatMessages] sessions count:', sessions?.length || 0);
    console.log('🔍 [ChatMessages] sessions state:', sessions?.map(s => ({ id: s.id, isActive: s.isActive })) || []);
    
    // Track last known good state with localStorage persistence
    if (activeSessionId) {
      localStorage.setItem('lastKnownActiveSession', activeSessionId);
      console.log('💾 [ChatMessages] Saved last known active session to localStorage:', activeSessionId);
    }
    if (sessions && sessions.length > 0) {
      const sessionData = sessions.map(s => ({ id: s.id, isActive: s.isActive, title: s.title }));
      localStorage.setItem('lastKnownSessions', JSON.stringify(sessionData));
      setLastKnownSessions(sessionData);
      console.log('💾 [ChatMessages] Saved last known sessions to localStorage:', sessions.length);
    }
  }, [activeSessionId, sessions]);
  
  // Load older messages function
  const loadOlderMessages = useCallback(async () => {
    if (!activeSessionId || loadingMoreRef.current || !hasMoreMessages) return;
    
    console.log('📨 [ChatMessages] Loading older messages...');
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
        
        console.log(`📨 [ChatMessages] Loaded ${messages.length} total messages (was ${currentCount})`);
        
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
        
        console.log(`📨 [ChatMessages] Now showing ${messages.length}/${totalCount} messages`);
      } else {
        console.warn('📨 [ChatMessages] Failed to load older messages:', result.error || 'Unknown error');
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
      console.log('🔄 [BatchLoad] Initializing batch loading for session:', activeSessionId);
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
    
    console.log('📨 [BatchLoad] Loading initial batch of messages...');
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
        
        console.log(`📨 [BatchLoad] Loaded initial ${messages.length} messages`);
        
        // Set total count from backend
        setTotalMessageCount(totalCount);
        console.log(`📨 [BatchLoad] Total messages available: ${totalCount}`);
        console.log(`📨 [BatchLoad] Backend response totalCount:`, result.result.data.totalCount);
        console.log(`📨 [BatchLoad] Setting totalMessageCount state to:`, totalCount);
        
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
      console.log('📝 [DISPLAY] No active session, showing empty messages');
      return [];
    }
    
    const sessionMessages = signals.activeMessages.value || [];
    console.log('📝 [DISPLAY] Session messages for', activeSessionId, ':', sessionMessages.length, 'messages');
    
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
    
    // Update total count when messages change
    if (converted.length > 0 && totalMessageCount === 0) {
      // This is a fallback - the proper total should come from the backend
      console.log('📝 [DISPLAY] Setting fallback total count:', converted.length);
    }
    
    console.log('📝 [DISPLAY] Converted messages:', converted.length, 'messages');
    console.log('📝 [DISPLAY] Current totalMessageCount state:', totalMessageCount);
    return converted;
  }, [activeSessionId, signals.activeMessages.value, totalMessageCount]);
  
  // Handle incoming WebSocket messages for streaming
  const handleWebSocketMessage = async (message: any) => {
    try {
      if (message.type === 'llm_stream_start') {
        console.log('🚀 Stream started for request:', message.requestId);
        setCurrentStreamingMessage('');
        setStreamingMessageId(`streaming_${message.requestId || Date.now()}`);
        isStreamingEndedRef.current = false; // Reset streaming ended flag
        setIsLoading(false); // Clear loading when streaming starts
        
      } else if (message.type === 'llm_stream_chunk') {
        // Skip processing if streaming has already ended
        if (isStreamingEndedRef.current) {
          console.log('⏭️ Skipping chunk - streaming already ended');
          return;
        }
        
        const chunkText = message.payload?.chunk || message.payload?.text || '';
        if (chunkText) {
          console.log('📝 Processing chunk:', chunkText.substring(0, 50) + '...');
          
          // Add artificial delay for smooth typing effect
          setTimeout(() => {
            if (!isStreamingEndedRef.current) {
              setCurrentStreamingMessage(prev => {
                const newText = prev + chunkText;
                console.log('📄 Updated streaming message length:', newText.length);
                
                // Auto-scroll is now handled by the unified useEffect system
                // No need for manual scroll calls during streaming
                
                return newText;
              });
            } else {
              console.log('⏭️ Skipping delayed chunk - streaming ended during delay');
            }
          }, 60); // 60ms delay per chunk for smooth typing effect
        } else {
          console.warn('⚠️ No chunk text found in message');
        }
        
      } else if (message.type === 'llm_stream_end') {
        console.log('✅ Stream completed for request:', message.requestId);
        console.log('📄 Full response text:', message.payload?.fullText);
        console.log('🔍 [DEBUG] Full llm_stream_end message:', JSON.stringify(message, null, 2));
          
        // Set streaming ended flag FIRST to prevent delayed chunks
        isStreamingEndedRef.current = true;
        
        // Clear streaming state to prevent duplicate display
        const finalText = message.payload?.fullText || currentStreamingMessage || 'No response received';
        setCurrentStreamingMessage('');
        setStreamingMessageId(null);
        setIsLoading(false);
        
        // Create final AI message using the full text from the payload
        const finalMessage: ChatMessage = {
          id: streamingMessageId || `ai_${Date.now()}`,
          text: finalText,
          sender: 'ai',
          timestamp: new Date(),
          isStreaming: false
        };
        
        // Add final message to conversation context
        console.log('🤖 Adding final AI message:', finalMessage);
        if (activeSessionId && signalsAddMessage) {          
          try {
            await signalsAddMessage(activeSessionId, {
              text: finalText,
              sender: 'ai',
              sessionId: activeSessionId,
              metadata: { streamingComplete: true }
            });
            console.log('✅ Final AI message added to session successfully');
          } catch (error) {
            console.error('❌ Error adding final AI message to session:', error);
          }
        } else {
          console.log('⚠️ No active session or signalsAddMessage function available');
        }
        
        // Final scroll-to-bottom when streaming completes (unless user is scrolling)
        console.log('🏁 LLM streaming ended - triggering final scroll-to-bottom');
        setTimeout(() => {
          if (!isUserScrolling) {
            console.log('✅ Final scroll-to-bottom (user not scrolling)');
            scrollToBottom({ smooth: true, force: true });
          } else {
            console.log('⏸️ Skipping final scroll - user is scrolling');
          }
        }, 100); // Small delay to ensure message is rendered
        
        // 🧠 CRITICAL: Trigger AgentOrchestrator for intent classification and memory storage
        console.log('🧠 [AGENT] Triggering AgentOrchestrator for intent classification...');
        // handleAgentOrchestration(message, finalText);
        
      } else if (message.type === 'intent_classification') {
        console.log('🎯🎯🎯 INTENT CLASSIFICATION MESSAGE FOUND! 🎯🎯🎯');
        console.log('  Primary Intent:', message.primaryIntent);
        console.log('  Requires Memory Access:', message.requiresMemoryAccess);
        console.log('  📸 CAPTURE SCREEN FLAG:', message.captureScreen);
        console.log('  Entities:', message.entities);
        console.log('  Full payload:', JSON.stringify(message, null, 2));
        
        // 🧠 CRITICAL: Trigger AgentOrchestrator with intent classification payload
        console.log('🧠 [AGENT] Triggering AgentOrchestrator with intent classification...');
        try {
          console.log('🎯 [AGENT] Processing direct intent classification payload...');
          
          if (window.electronAPI) {
            const orchestrationResult = await window.electronAPI.agentOrchestrate({
              message: JSON.stringify(message),
              intent: message.primaryIntent,
              context: { source: 'intent_classification_direct' }
            });
            console.log('✅ [AGENT] Direct AgentOrchestrator result:', orchestrationResult);
            
            if (orchestrationResult.success) {
              console.log('🎉 [AGENT] Agent chain executed successfully from intent classification!');
              // TODO: Show success indicator in UI
            } else {
              console.error('❌ [AGENT] Direct agent orchestration failed:', orchestrationResult.error);
            }
          }
        } catch (error) {
          console.error('❌ [AGENT] Error in direct agent orchestration:', error);
        }

      } else if (message.type === 'connection_status') {
        console.log('🔗 Connection status:', message.status);
      }
    } catch (error) {
      console.error('❌ Error handling WebSocket message:', error);
    }
  };

  // 🎯 Semantic Search First - Try to find relevant stored memories
  // const trySemanticSearchFirst = useCallback(async (query: string) => {
  //   try {
  //     console.log('🔍 Performing semantic search for:', query.substring(0, 50) + '...');
      
  //     // Call semantic search via Electron API
  //     const result = await window.electronAPI?.agentExecute({
  //       agentName: 'UserMemoryAgent',
  //       action: 'memory-semantic-search',
  //       input: query,
  //       options: {
  //         limit: 3,
  //         minSimilarity: 0.6 // Higher threshold for better relevance
  //       }
  //     });
      
  //     if (result?.success && result.results && result.results.length > 0) {
  //       console.log(`✅ Found ${result.results.length} relevant memories`);
        
  //       // Format the response with found memories
  //       const memories = result.results;
  //       let response = "Based on what I remember:\n\n";
        
  //       memories.forEach((memory: any, index: number) => {
  //         const similarity = Math.round(memory.similarity * 100);
  //         response += `**Memory ${index + 1}** (${similarity}% match):\n`;
  //         response += `${memory.source_text || memory.suggested_response}\n\n`;
  //       });
        
  //       response += "Is this what you were looking for, or would you like me to help with something else?";
        
  //       return {
  //         hasRelevantResults: true,
  //         response: response,
  //         memories: memories
  //       };
  //     }
      
  //     console.log('📝 No relevant memories found with sufficient similarity');
  //     return {
  //       hasRelevantResults: false,
  //       response: '',
  //       memories: []
  //     };
      
  //   } catch (error) {
  //     console.error('❌ Semantic search failed:', error);
  //     return {
  //       hasRelevantResults: false,
  //       response: '',
  //       memories: []
  //     };
  //   }
  // }, []);

  // Message sending functionality from ChatWindow
  const handleSendMessage = useCallback(async () => {
    const currentMsg = currentMessageRef.current;
    
    if (!currentMsg.trim() || isLoading || isProcessingLocally) {
      // Message sending blocked - debug logging removed for performance
      return;
    }
    
    // 🚀 NEW: Use signals for session management (eliminates race conditions!)
    logDebugState(); // Debug current signals state
    
    // Check if context is still loading
    if (contextIsLoading) {
      console.log('⏳ [SIGNALS] Context is still loading, please wait...');
      return;
    }
    
    // 🎯 CRITICAL: Use signals.activeSessionId.value for always-fresh value
    let currentSessionId = signals.activeSessionId.value;
    
    // If no active session, create one using signals
    if (!currentSessionId) {
      console.log('⚠️ [SIGNALS] No active session found, creating one...');
      try {
        // Use signals sendMessage which handles session creation automatically
        const messageText = currentMsg.trim();
        console.log('🚀 [SIGNALS] Using signalsSendMessage for automatic session handling');
        
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
        console.log('✅ [SIGNALS] Message sent and session handled:', currentSessionId);
        
        // Continue with the rest of the flow...
      } catch (error) {
        console.error('❌ [SIGNALS] Failed to send message:', error);
        return;
      }
    } else {
      console.log('✅ [SIGNALS] Using existing session:', currentSessionId);
    }
    
    const messageText = currentMsg.trim();
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
    setCurrentStreamingMessage('');
    setStreamingMessageId(null);
    isStreamingEndedRef.current = false;
    
    // Add to conversation context if we have an active session
    if (currentSessionId && signalsAddMessage) {
      console.log('📝 [USER-MESSAGE] Adding user message to session:', currentSessionId);
      console.log('📝 [USER-MESSAGE] Message text:', messageText);
      
      try {
        await signalsAddMessage(currentSessionId, {
          text: messageText,
          sender: 'user',
          sessionId: currentSessionId,
          metadata: {}
        });
        console.log('✅ [USER-MESSAGE] User message added to session successfully');
      } catch (error) {
        console.error('❌ [USER-MESSAGE] Error adding user message to session:', error);
        // Session add failed - message will be handled by ConversationContext
        console.log('⚠️ [USER-MESSAGE] Session add failed, relying on ConversationContext');
      }
    } else {
      // No session available - create one first
      console.log('⚠️ [USER-MESSAGE] No session available, should create session first');
    }
    
    try {
      console.log('🔍 [DEBUG] Connection state check:', {
        isConnected: wsState.isConnected,
        reconnectCount: wsState.reconnectCount,
        activeRequests: wsState.activeRequests,
        messageText: messageText.substring(0, 50) + '...'
      });
      
      // 🎯 ENHANCED PIPELINE: Use existing backend infrastructure with better orchestration
      console.log('🧠 [ENHANCED-PIPELINE] Starting message processing with existing backend...');
      
      if (!wsState.isConnected) {
        console.warn('⚠️ WebSocket not connected, trying progressive search first...');
        
        // Try progressive search for cross-session queries
        const progressiveSuccess = await useProgressiveSearch(messageText);
        
        if (!progressiveSuccess) {
          console.log('🔄 Progressive search failed or not applicable, falling back to local LLM');
          await handleLocalLLMCall(messageText);
        }
        return;
      }
      
      // Send message via WebSocket for backend processing with enhanced orchestration
      await sendLLMRequest({
        prompt: messageText,
        provider: 'openai',
        options: {
          taskType: 'ask',
          stream: true,
          temperature: 0.7,
          useSemanticFirst: true // Flag to indicate semantic-first processing preference
        }
      });
      
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
  }, [isLoading, isProcessingLocally, wsState.isConnected, sendLLMRequest]);

  // Handle local LLM fallback when backend is disconnected
  const handleLocalLLMCall = useCallback(async (messageText: string) => {
    let isThinkingMsg = false;
    
    try {
      console.log('🤖 Starting local LLM processing...');
      setIsProcessingLocally(true);
      setIsLoading(false); // Stop main loading, show local processing instead
      // Keep current thinking message, don't reset to prevent flash
      scrollToBottom({ smooth: true, force: true });
      
      // 🚀 FAST PATH: Call Phi3Agent directly for immediate response
      if (!window.electronAPI?.llmQueryLocal) {
        throw new Error('Electron API not available');
      }
      
      // 🎯 ENHANCED: Use existing backend pipeline with semantic-first preferences
      const result = await window.electronAPI.llmQueryLocal(messageText, {
        temperature: 0.0,
        maxTokens: 50,
        // Enhanced options to guide the existing backend pipeline
        preferSemanticSearch: true,    // Hint to prioritize semantic search in orchestration
        enableIntentClassification: true, // Use the sophisticated intent parsers
        useAgentOrchestration: true    // Leverage the full agent orchestration pipeline
      });
      
      if (result.success) {
        // Extract the actual AI response from the result
        // The backend logs show: "Raw Phi3 natural language result: The current President of the USA is Joe Biden..."
        let aiResponseText = '';
        
        // Try to extract from intentClassificationPayload first (this contains the actual Phi3 response)
        if (result.intentClassificationPayload?.reasoning && result.intentClassificationPayload.reasoning.includes('Raw Phi3 natural language result:')) {
          // Extract the actual response from the reasoning field
          const match = result.intentClassificationPayload.reasoning.match(/Raw Phi3 natural language result: (.+)/);
          if (match) {
            aiResponseText = match[1].trim();
          }
        }
        
        // Fallback: try to extract from data.response
        if (!aiResponseText && result.data?.response) {
          aiResponseText = result.data.response;
        }
        
        // Final fallback: use the full result as string
        if (!aiResponseText) {
          aiResponseText = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        }
        
        console.log('✅ [LOCAL-LLM] Extracted AI response:', aiResponseText);

        // For question intents, memory operations, show suggested response in ThinkingIndicator while processing
        if (
          result.intentClassificationPayload?.primaryIntent === 'memory_store' ||
          result.intentClassificationPayload?.primaryIntent === 'memory_retrieve' || 
          result.intentClassificationPayload?.primaryIntent === 'memory-retrieve' ||   
          result.intentClassificationPayload?.primaryIntent === 'question' ||
          result.intentClassificationPayload?.primaryIntent === 'command'
        ) {
          isThinkingMsg = true;
          // Set the thinking message to the suggested response
          const thinkingMsg = result.intentClassificationPayload?.suggestedResponse || result.data || 'Let me look that up for you.';
          setInitialThinkingMessage(thinkingMsg);
          
          // Ensure we stay in processing state to keep ThinkingIndicator visible
          console.log('🎯 [THINKING] Keeping processing state active for orchestration - intent:', result.intentClassificationPayload?.primaryIntent);
          // Don't add the AI message yet - wait for orchestration update
          return;
        }
        
        // Add AI response to conversation
        if (signalsAddMessage && signals.activeSessionId.value) {
          await signalsAddMessage(signals.activeSessionId.value, {
            text: aiResponseText,
            sender: 'ai',
            sessionId: signals.activeSessionId.value,
            metadata: {
              source: 'local_llm',
              processingTime: Date.now(),
              model: 'phi3'
            }
          });
          console.log('✅ [LOCAL-LLM] AI response added to conversation');
        }
        
        scrollToBottom({ smooth: true, force: true });
      } else {
        console.error('❌ [LOCAL-LLM] Local LLM query failed:', result.error);
        setLocalLLMError(result.error || 'Local LLM processing failed');
      }
      
    } catch (error) {
      console.error('❌ [LOCAL-LLM] Local LLM processing error:', error);
      setLocalLLMError('Failed to process with local LLM. Please try again.');
    } finally {
      // Only clear processing state if not waiting for memory retrieve or question orchestration
      if (!isThinkingMsg) {
        console.log('🎯 [THINKING] Clearing processing state in finally block');
        setIsProcessingLocally(false);
        setIsLoading(false);
      } else {
        console.log('🎯 [THINKING] Keeping processing state active for orchestration - memory, question, command:', isThinkingMsg);
      }
      scrollToBottom({ smooth: true, force: true });
    }
  }, [signalsAddMessage, scrollToBottom]);



  // Add progressive search option to existing message handling
  const useProgressiveSearch = useCallback(async (messageText: string) => {
    try {
      console.log('🔍 [PROGRESSIVE] Starting progressive search (backend will handle detection)...');
      scrollToBottom({ smooth: true, force: true });
      
      // Check if progressive search API is available
      if (!(window.electronAPI as any)?.localLLMProgressiveSearch) {
        console.warn('⚠️ Progressive search not available, using fallback');
        return false;
      }

      // Keep loading states active to show "Thinking..." until first intermediate response
      console.log('🔍 [PROGRESSIVE] Keeping loading states active for initial thinking indicator...');
      // Don't clear loading states here - let them show the thinking indicator

      // Set up context
      const context = {
        currentSessionId: signals.activeSessionId.value,
        conversationContext: (signals.activeMessages.value || [])
          .slice(-10)
          .map((msg: any) => `${msg.sender}: ${msg.text}`)
          .join('\n'),
        userId: 'user'
      };

      // Set up intermediate response handler
      const handleIntermediate = async (_event: any, data: any) => {
        console.log('📨 [PROGRESSIVE] Received intermediate response:', data);
        
        // Only clear loading states if this is the final response (continueToNextStage: false)
        if (data?.continueToNextStage === false) {
          console.log('🔍 [PROGRESSIVE] Final stage reached, clearing loading states...');
          setIsLoading(false);
          setIsProcessingLocally(false);
        } else {
          console.log('🔍 [PROGRESSIVE] Intermediate stage, keeping loading states active...');
        }
        
        if (data?.response && signalsAddMessage && signals.activeSessionId.value) {
          await signalsAddMessage(signals.activeSessionId.value, {
            text: data.response,
            sender: 'ai',
            sessionId: signals.activeSessionId.value,
            metadata: { 
              isIntermediate: data?.continueToNextStage !== false,
              isFinal: data?.continueToNextStage === false,
              stage: data?.stage 
            }
          });
          scrollToBottom({ smooth: true, force: true });
          console.log('✅ [PROGRESSIVE] Response added to conversation - Stage:', data?.stage, 'Final:', data?.continueToNextStage === false);
        }
      };

      if ((window.electronAPI as any).onProgressiveSearchIntermediate) {
        (window.electronAPI as any).onProgressiveSearchIntermediate(handleIntermediate);
      } else {
        console.warn('⚠️ [PROGRESSIVE] onProgressiveSearchIntermediate not available');
        console.log('🔍 [PROGRESSIVE] Final response added, clearing all loading states...');
        setIsLoading(false);
        setIsProcessingLocally(false);
      }

      // Execute progressive search
      console.log('🚀 [PROGRESSIVE] Calling localLLMProgressiveSearch API...');
      const result = await (window.electronAPI as any).localLLMProgressiveSearch({
        prompt: messageText,
        context: context
      });

      // Cleanup
      if ((window.electronAPI as any).removeAllListeners) {
        (window.electronAPI as any).removeAllListeners('progressive-search-intermediate');
      }

      if (result.success && signalsAddMessage && signals.activeSessionId.value) {
        await signalsAddMessage(signals.activeSessionId.value, {
          text: result.data.response,
          sender: 'ai',
          sessionId: signals.activeSessionId.value,
          metadata: { isFinal: true }
        });
        
        // Clear loading states after final response is added
        console.log('🔍 [PROGRESSIVE] Final response added, clearing all loading states...');
        setIsLoading(false);
        setIsProcessingLocally(false);
        
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Progressive search failed:', error);
      // Clear loading states on error
      setIsLoading(false);
      setIsProcessingLocally(false);
      return false;
    }
  }, [signalsAddMessage]);



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
    
    console.log('🔍 [DEBUG] WebSocket toggle clicked in input area!', {
      currentState: wsState.isConnected,
      reconnectCount: wsState.reconnectCount
    });
      
    try {
      if (wsState.isConnected) {
        console.log('🔌 Disconnecting WebSocket for local LLM testing...');
        await disconnectWebSocket();
        console.log('✅ WebSocket disconnected - local LLM fallback will be used');
      } else {
        console.log('🔌 Reconnecting WebSocket...');
        await connectWebSocket();
        console.log('✅ WebSocket reconnected - backend streaming will be used');
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
      console.log('✅ Message copied to clipboard');
      
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
    console.log('💾 Messages are managed by ConversationContext - no localStorage needed');
  }, []);

  const handleRegenerateMessage = useCallback(async (messageId: string) => {
    // Find the user message that preceded this AI message
    const messageIndex = displayMessages.findIndex(m => m.id === messageId);
    if (displayMessages.length > 0) {
      const lastMessage = displayMessages[displayMessages.length - 1];
      if (lastMessage.sender === 'user') {
        console.log('🔄 Last message was from user, regenerating...');
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
    console.log('🔌 ChatMessages mounted - connecting WebSocket...');
    
    
    connectWebSocket().catch(error => {
      console.error('❌ Failed to connect WebSocket on mount:', error);
    });
    
    // Auto-focus textarea
    focusTextarea();
    const timeoutId = setTimeout(focusTextarea, 100);
    
    // Cleanup: disconnect when component unmounts
    return () => {
      console.log('🔌 ChatMessages unmounting - disconnecting WebSocket...');
      disconnectWebSocket();
      clearTimeout(timeoutId);
    };
  }, []); // Remove dependencies to prevent re-mounting

  // Auto-scroll to bottom when new messages arrive (only if user is not manually scrolling)
  useEffect(() => {
    const hasMessages = displayMessages.length > 0;
    if (hasMessages && !isUserScrolling) {
      const lastMessage = displayMessages[displayMessages.length - 1];
      if (lastMessage && lastMessage.sender === 'ai' && !lastMessage.isStreaming) {
        console.log('🔄 Auto-scrolling after AI message completion');
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
      // ...
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
      console.log('🔍 [DEBUG] Setting up orchestration update listener (first time)...');
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

  useEffect(() => {
    if (!currentStreamingMessage) return;
  
    const interval = setInterval(() => {
      if (!isUserScrolling && messagesContainerRef.current && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 100); // Adjust for smoother feeling: try 50–150ms
  
    return () => clearInterval(interval);
  }, [currentStreamingMessage, isUserScrolling]);

  // Always show the window, even when empty

  return (
    <>
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
        {displayMessages.length === 0 && !currentStreamingMessage ? (
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
            
            {/* Streaming message display */}
            {currentStreamingMessage && (
              <div className="flex justify-start">
                <div className="max-w-[85%] min-w-0 bg-white/10 text-white/90 border border-white/10 rounded-xl px-4 py-2 overflow-x-auto overflow-y-hidden">
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    <MarkdownRenderer content={currentStreamingMessage} />
                    <span className="inline-block w-2 h-4 bg-white/60 ml-1 animate-pulse">|</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        
        {/* Thinking indicator for local LLM processing */}
        {(() => {
          const shouldShow = (isLoading && !wsState.isConnected) || isProcessingLocally;
          if (shouldShow) {
            console.log('🎯 [THINKING] Showing ThinkingIndicator - isLoading:', isLoading, 'wsConnected:', wsState.isConnected, 'isProcessingLocally:', isProcessingLocally, 'message:', initialThinkingMessage);
          }
          return shouldShow;
        })() ? (
          <ThinkingIndicator 
            isVisible={true} 
            message={initialThinkingMessage} 
          />
        ) : isLoading && wsState.isConnected ? (
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
