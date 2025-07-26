import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Droplet, X, Send, Unplug } from 'lucide-react';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from './ui/tooltip';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import useWebSocket from '../hooks/useWebSocket';
import { ThinkingIndicator } from './AnalyzingIndicator';
// import { useLocalLLM } from '../contexts/LocalLLMContext';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  isStreaming?: boolean;
}

// Simple markdown renderer component (memoized for performance)
const MarkdownRenderer: React.FC<{ content: any }> = React.memo(({ content }) => {
  // Ensure content is always a string
  const safeContent = React.useMemo(() => {
    if (typeof content === 'string') {
      return content;
    }
    if (content === null || content === undefined) {
      return '';
    }
    if (typeof content === 'object') {
      // If it's an object, try to extract text or stringify it
      if (content.text && typeof content.text === 'string') {
        return content.text;
      }
      if (content.content && typeof content.content === 'string') {
        return content.content;
      }
      // Last resort: stringify the object
      try {
        return JSON.stringify(content, null, 2);
      } catch {
        return '[Invalid content object]';
      }
    }
    // Convert other types to string
    return String(content);
  }, [content]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        code({ className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = !match;
          return !isInline ? (
            <SyntaxHighlighter
              style={oneDark as any}
              language={match[1]}
              PreTag="div"
              {...props}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        p: ({ children }) => (
          <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed">{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-white/20 pl-4 italic mb-2">
            {children}
          </blockquote>
        ),
        h1: ({ children }) => (
          <h1 className="text-lg font-bold mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-bold mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-bold mb-1">{children}</h3>
        ),
      }}
    >
      {safeContent}
    </ReactMarkdown>
  );
});

export default function ChatMessages() {
  // Load chat messages from localStorage on component mount (memoized)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('thinkdrop-chat-messages');
      console.log('THE MESSAGES SAVAED:', JSON.stringify(saved));
      if (!saved) return [];
      
      const loadedMessages = JSON.parse(saved).map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
      console.log('THE MESSAGES SAVAED:', JSON.stringify(loadedMessages), saved);
      return loadedMessages;
    } catch (error) {
      console.error('Failed to load chat messages from localStorage:', error);
      return [];
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState<string>('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const isStreamingEndedRef = useRef<boolean>(false);
  
  // Local LLM processing state
  const [isProcessingLocally, setIsProcessingLocally] = useState(false);
  const [localLLMError, setLocalLLMError] = useState<string | null>(null);
  
  // Input state from ChatWindow
  const [currentMessage, setCurrentMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-scroll state and refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isProgrammaticScrolling = useRef(false);
  
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
  
  // Handle agent orchestration with direct intent classification payload
  const handleAgentOrchestrationDirect = async (intentClassificationMessage: any) => {
    try {
      console.log('🎯 [AGENT] Processing direct intent classification payload...');
      
      if (window.electronAPI) {
        const orchestrationResult = await window.electronAPI.agentOrchestrate({
          message: JSON.stringify(intentClassificationMessage),
          intent: intentClassificationMessage.primaryIntent,
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
  };

  // Handle agent orchestration after streaming completes
  // const handleAgentOrchestration = async (message: any, finalText: string) => {
  //   try {
  //     console.log('🧠 [AGENT] Processing intent classification for agent orchestration...', message);
      
  //     // Extract intent classification data from backend response
  //     const intentClassification = message.payload?.intentClassification || message.intentClassification;
      
  //     if (intentClassification) {
  //       console.log('🎯 [AGENT] Found intent classification data:', intentClassification);
        
  //       // Trigger AgentOrchestrator with intent classification payload directly
  //       if (window.electronAPI) {
  //         const orchestrationResult = await window.electronAPI.agentOrchestrate({
  //           intentPayload: intentClassification, // Pass as object, not string
  //           context: { source: 'chat_streaming' }
  //         });
  //         console.log('✅ [AGENT] AgentOrchestrator result:', orchestrationResult);
          
  //         if (orchestrationResult.success) {
  //           console.log('🎉 [AGENT] Agent chain executed successfully!');
  //           // TODO: Show success indicator in UI
  //         } else {
  //           console.error('❌ [AGENT] Agent orchestration failed:', orchestrationResult.error);
  //         }
  //       }
  //     } else {
  //       console.log('ℹ️ [AGENT] No intent classification data found, creating basic payload...');
        
  //       // Create a basic intent classification payload for memory storage
  //       const basicIntentPayload = {
  //         intents: [{
  //           intent: 'general_query',
  //           confidence: 0.8,
  //           reasoning: 'General user query without specific intent classification'
  //         }],
  //         primaryIntent: 'general_query',
  //         entities: [],
  //         requiresMemoryAccess: true, // Always store for memory
  //         requiresExternalData: false,
  //         suggestedResponse: finalText,
  //         sourceText: chatMessages[chatMessages.length - 1]?.text || 'User query',
  //         metadata: {
  //           timestamp: new Date().toISOString(),
  //           source: 'chat_message',
  //           requestId: message.requestId
  //         }
  //       };
        
  //       console.log('📝 [AGENT] Triggering with basic intent payload:', basicIntentPayload);
        
  //       // Trigger AgentOrchestrator with basic payload directly
  //       if (window.electronAPI) {
  //         const orchestrationResult = await window.electronAPI.agentOrchestrate({
  //           intentPayload: basicIntentPayload, // Pass as object, not string
  //           context: { source: 'chat_streaming_basic' }
  //         });
  //         console.log('✅ [AGENT] Basic orchestration result:', orchestrationResult);
  //       }
  //     }
  //   } catch (error) {
  //     console.error('❌ [AGENT] Error in agent orchestration:', error);
  //   }
  // };

  // Handle incoming WebSocket messages for streaming
  const handleWebSocketMessage = (message: any) => {
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
        console.log('🔍 [DEBUG] Intent classification data:', message.payload?.intentClassification);
        console.log('🔍 [DEBUG] All payload keys:', Object.keys(message.payload || {}));
        
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
        
        // Add final message to chat history
        console.log('🤖 Adding final AI message:', finalMessage);
        setChatMessages(prev => {
          console.log('📊 Current messages before adding AI message:', prev.length);
          const exists = prev.some(m => m.id === finalMessage.id);
          if (exists) {
            console.log('⚠️ AI message already exists, skipping');
            return prev;
          }
          const newMessages = [...prev, finalMessage];
          console.log('📊 Messages after adding AI message:', newMessages.length);
          return newMessages;
        });
        
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
        handleAgentOrchestrationDirect(message);
        
      } else if (message.type === 'connection_status') {
        console.log('🔗 Connection status:', message.status);
      }
    } catch (error) {
      console.error('❌ Error handling WebSocket message:', error);
    }
  };

  // Message sending functionality from ChatWindow
  const handleSendMessage = useCallback(async () => {
    console.log('📤 [DEBUG] handleSendMessage called', {
      currentMessage: currentMessage.substring(0, 50) + '...',
      isLoading,
      isProcessingLocally,
      wsStateConnected: wsState.isConnected
    });
    
    if (!currentMessage.trim() || isLoading || isProcessingLocally) {
      console.log('🚫 [DEBUG] Message sending blocked:', {
        noMessage: !currentMessage.trim(),
        isLoading,
        isProcessingLocally
      });
      return;
    }
    
    const messageText = currentMessage.trim();
    setCurrentMessage('');
    setIsLoading(true);
    setLocalLLMError(null);
    
    // Clear any previous error states
    setProcessedMessageIds(new Set());
    setCurrentStreamingMessage('');
    setStreamingMessageId(null);
    isStreamingEndedRef.current = false;
    
    // Add user message immediately
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      text: messageText,
      sender: 'user',
      timestamp: new Date()
    };
    
    setChatMessages(prev => {
      const updated = [...prev, userMessage];
      // Save to localStorage
      localStorage.setItem('thinkdrop-chat-messages', JSON.stringify(updated));
      return updated;
    });
    
    try {
      console.log('🔍 [DEBUG] Connection state check:', {
        isConnected: wsState.isConnected,
        reconnectCount: wsState.reconnectCount,
        activeRequests: wsState.activeRequests,
        messageText: messageText.substring(0, 50) + '...'
      });
      
      if (!wsState.isConnected) {
        console.warn('⚠️ WebSocket not connected, using local LLM fallback');
        await handleLocalLLMFallback(messageText);
        return;
      }
      
      // Send message via WebSocket for backend processing
      await sendLLMRequest({
        prompt: messageText,
        provider: 'openai',
        options: {
          taskType: 'ask',
          stream: true,
          temperature: 0.7
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
  }, [currentMessage, isLoading, isProcessingLocally, wsState.isConnected, sendLLMRequest]);

  // Handle local LLM fallback when backend is disconnected
  const handleLocalLLMFallback = useCallback(async (messageText: string) => {
    try {
      console.log('🤖 Starting local LLM processing...');
      setIsProcessingLocally(true);
      setIsLoading(false); // Stop main loading, show local processing instead
      
      // 🚀 FAST PATH: Call Phi3Agent directly for immediate response
      if (!window.electronAPI?.llmQueryLocal) {
        throw new Error('Electron API not available');
      }
      
      const result = await window.electronAPI.llmQueryLocal(messageText, {
        temperature: 0.0,
        maxTokens: 50
      });
      
      if (result.success) {
        // Add AI response message immediately
        const aiMessage: ChatMessage = {
          id: `ai-${Date.now()}`,
          text: result.data || 'I processed your request using local capabilities.',
          sender: 'ai',
          timestamp: new Date()
        };
        
        setChatMessages(prev => {
          const updated = [...prev, aiMessage];
          localStorage.setItem('thinkdrop-chat-messages', JSON.stringify(updated));
          return updated;
        });
        
        console.log('✅ Local LLM processing completed successfully');
        
        // 🧠 BACKGROUND: Asynchronously trigger memory storage (non-blocking)
        setTimeout(async () => {
          try {
            console.log('🧠 [BACKGROUND] Starting async memory storage for local LLM...');
            
            // Create intent classification payload similar to online LLM
            const intentClassificationPayload = {
              primaryIntent: 'conversation', // Default to conversation intent
              requiresMemoryAccess: true,
              requiresExternalData: false,
              entities: [],
              sourceText: messageText,
              suggestedResponse: typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
              captureScreen: false,
              timestamp: new Date().toISOString(),
              context: {
                source: 'local_llm',
                sessionId: `local-session-${Date.now()}`
              }
            };
            
            // Trigger AgentOrchestrator for memory storage (same as online LLM)
            if (window.electronAPI?.agentOrchestrate) {
              const orchestrationResult = await window.electronAPI.agentOrchestrate({
                message: JSON.stringify(intentClassificationPayload),
                intent: intentClassificationPayload.primaryIntent,
                context: { source: 'local_llm_memory_storage' }
              });
              
              if (orchestrationResult.success) {
                console.log('✅ [BACKGROUND] Local LLM memory storage completed successfully');
              } else {
                console.warn('⚠️ [BACKGROUND] Local LLM memory storage failed:', orchestrationResult.error);
              }
            }
          } catch (memoryError) {
            console.warn('⚠️ [BACKGROUND] Local LLM memory storage error (non-critical):', memoryError);
          }
        }, 100); // Small delay to ensure UI response is rendered first
        
      } else {
        throw new Error(result.error || 'Local LLM processing failed');
      }
      
    } catch (error) {
      console.error('❌ Local LLM fallback failed:', error);
      setLocalLLMError('Local processing failed. Please check if Ollama is running.');
      
      // Add error message to chat
      const errorMessage: ChatMessage = {
        id: `ai-error-${Date.now()}`,
        text: 'I\'m having trouble processing your request locally. Please ensure Ollama is running or try again when connected to the backend.',
        sender: 'ai',
        timestamp: new Date()
      };
      
      setChatMessages(prev => {
        const updated = [...prev, errorMessage];
        localStorage.setItem('thinkdrop-chat-messages', JSON.stringify(updated));
        return updated;
      });
    } finally {
      setIsProcessingLocally(false);
      setIsLoading(false);
    }
  }, []);

  // Clear local LLM error when connection is restored
  useEffect(() => {
    if (wsState.isConnected && localLLMError) {
      setLocalLLMError(null);
    }
  }, [wsState.isConnected, localLLMError]);

  // Handle WebSocket toggle for testing local LLM fallback
  const handleWebSocketToggle = useCallback(async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    console.log('🔍 [DEBUG] WebSocket toggle clicked!', {
      currentState: wsState.isConnected,
      reconnectCount: wsState.reconnectCount,
      activeRequests: wsState.activeRequests
    });
    
    try {
      if (wsState.isConnected) {
        console.log('🔌 Manually disconnecting WebSocket for local LLM testing...');
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
    setCurrentMessage(value);
    
    // Debounced auto-resize to prevent lag
    const target = e.target;
    requestAnimationFrame(() => {
      if (target.scrollHeight !== target.clientHeight) {
        target.style.height = 'auto';
        target.style.height = Math.min(target.scrollHeight, 128) + 'px'; // Max height 128px
      }
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

  useEffect(() => {
    // Connect WebSocket when component mounts
    console.log('🔌 ChatMessages mounted - connecting WebSocket...');
    console.log('📊 Current messages count on mount:', chatMessages.length);
    
    connectWebSocket().catch(error => {
      console.error('❌ Failed to connect WebSocket on mount:', error);
    });
    
    // Auto-focus textarea
    focusTextarea();
    const timeoutId = setTimeout(focusTextarea, 100);
    
    // Cleanup: disconnect when component unmounts
    return () => {
      console.log('🔌 ChatMessages unmounting - disconnecting WebSocket...');
      console.log('📊 Messages count on unmount:', chatMessages.length);
      disconnectWebSocket();
      clearTimeout(timeoutId);
    };
  }, []); // Remove dependencies to prevent re-mounting
  
  // Persist messages to localStorage whenever they change
  useEffect(() => {
    console.log('💾 Saving messages to localStorage:', chatMessages.length);
    localStorage.setItem('thinkdrop-chat-messages', JSON.stringify(chatMessages));
  }, [chatMessages]);

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

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    if (!isUserScrolling && (chatMessages.length > 0 || currentStreamingMessage)) {
      scrollToBottom({ smooth: true, force: false });
    }
  }, [chatMessages, currentStreamingMessage, isUserScrolling, scrollToBottom]);

  // Gentle scroll for streaming messages - respect user scrolling behavior
  useEffect(() => {
    if (currentStreamingMessage && !isUserScrolling) {
      console.log('📡 Streaming message detected, gentle scroll:', { isUserScrolling });
      // Only auto-scroll during streaming if user is not manually scrolling
      scrollToBottom({ smooth: true, force: false });
    }
  }, [currentStreamingMessage, isUserScrolling, scrollToBottom]);

  // Scroll detection to show/hide scroll button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Ignore scroll events caused by programmatic scrolling
      if (isProgrammaticScrolling.current) {
        console.log('🤖 Ignoring programmatic scroll event');
        return;
      }
      
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
      
      console.log('👆 User scroll detected:', { scrollTop, scrollHeight, clientHeight, isAtBottom, hasStreaming: !!currentStreamingMessage });
      
      setShowScrollButton(!isAtBottom);
      
      // Don't pause auto-scroll during streaming - let streaming continue
      if (currentStreamingMessage) {
        console.log('📡 Streaming active - not pausing auto-scroll');
        return;
      }
      
      // Detect if user is manually scrolling (only for actual user interaction)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      console.log('⏸️ Setting isUserScrolling = true');
      setIsUserScrolling(true);
      scrollTimeoutRef.current = setTimeout(() => {
        if (isAtBottom) {
          console.log('▶️ Resuming auto-scroll (user at bottom)');
          setIsUserScrolling(false);
        }
      }, 1000); // Resume auto-scroll after 1 second if at bottom
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle scroll to bottom button click
  const handleScrollToBottom = useCallback(() => {
    setIsUserScrolling(false);
    scrollToBottom({ smooth: true, force: true });
  }, [scrollToBottom]);

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
        
        // Add message to chat
        setChatMessages(prev => {
          // Double-check for duplicates by ID
          const exists = prev.some(m => m.id === message.id);
          if (exists) {
            return prev;
          }
          
          // Notify that a message was loaded (for focus management)
          setTimeout(() => {
            if (window.electronAPI?.notifyMessageLoaded) {
              window.electronAPI.notifyMessageLoaded();
            }
          }, 200);
          
          return [...prev, message];
        });
        
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
  }, [processedMessageIds, wsState.isConnected, connectWebSocket]);

  // TEMPORARILY DISABLED: Height adjustment causing chat window to disappear
  useEffect(() => {
    if (window.electronAPI?.adjustChatMessagesHeight) {
      // Calculate content height with better logic
      const baseHeight = 200; // Minimum window height
      const messageHeight = 60; // Height per message (reduced from 80)
      const padding = 100; // Extra padding for UI elements
      
      const contentHeight = Math.max(
        baseHeight, 
        Math.min(chatMessages.length * messageHeight + padding, 500) // Max height of 500px
      );
      
      console.log(`📏 Adjusting chat window height: ${contentHeight}px for ${chatMessages.length} messages`);
      window.electronAPI.adjustChatMessagesHeight(contentHeight);
    }
  }, [chatMessages.length]);

  // Auto-scroll to bottom when new messages are added or streaming updates
  useEffect(() => {
    if (chatMessages.length > 0 || currentStreamingMessage) {
      scrollToBottom({ smooth: true, force: false });
    }
  }, [chatMessages.length, currentStreamingMessage, scrollToBottom]);

  useEffect(() => {
    const handleResize = () => {
      // Force a re-render to recalculate scroll area
      const scrollContainer = document.querySelector('.chat-messages-scroll');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleClose = () => {
    // Hide the chat messages window via Electron IPC
    if (window.electronAPI?.hideChatMessages) {
      window.electronAPI.hideChatMessages();
    } else {
      console.log('Chat messages window close requested - Electron API not available');
    }
  };

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
        className="w-full flex flex-col bg-gray-900/95"
        style={{
          height: '100vh',
          minHeight: '100vh',
          maxHeight: '100vh',
          overflow: 'hidden'
        }}
      >
        {/* Draggable Header */}
        <div
          className="flex items-center space-x-2 p-4 pb-2 border-b border-white/10 cursor-move flex-shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div 
            className={`relative group w-6 h-6 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 ${
              wsState.isConnected 
                ? 'bg-gradient-to-br from-teal-400 to-blue-500 hover:from-teal-300 hover:to-blue-400' 
                : 'bg-gradient-to-br from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
            }`}
            title={wsState.isConnected 
              ? `WebSocket: Connected (Click to disconnect for local LLM testing)${wsState.activeRequests > 0 ? ` (${wsState.activeRequests} active)` : ''}` 
              : 'WebSocket: Disconnected (Click to reconnect)'
            }
            onClick={handleWebSocketToggle}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {wsState.isConnected ? (
              <Droplet className="w-3 h-3 text-white" />
            ) : (
              <Unplug className="w-3 h-3 text-white" />
            )}
            {/* Custom tooltip */}
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
              {wsState.isConnected 
                ? `Connected (Click to test local LLM)${wsState.activeRequests > 0 ? ` (${wsState.activeRequests} active)` : ''}` 
                : 'Disconnected (Click to reconnect)'
              }
              {/* Arrow */}
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          </div>
        <span className="text-white/90 font-medium text-sm">Messages</span>
        <div className="flex-1" />
        <span className="text-white/50 text-xs">Drag to move</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-6 w-6 p-0 text-white/50 hover:text-white/90 hover:bg-white/10"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Messages Container - Takes up remaining space and scrolls */}
      <div 
        ref={messagesContainerRef}
        className="overflow-y-auto overflow-x-hidden p-4"
        style={{ 
          WebkitAppRegion: 'no-drag',
          // flex: '1 1 0%', // Explicit flex-grow with flex-basis 0
          minHeight: 0, // Important for flex child to shrink
          // maxHeight: '100%',
          // height: '300vh' // Force full height
        } as React.CSSProperties}
      >
        <div className="space-y-4">
        {chatMessages.length === 0 && !currentStreamingMessage ? (
          <div className="text-center py-8">
            <div className="text-white/40 text-sm mb-2">No messages yet</div>
            <div className="text-white/30 text-xs">Start a conversation by typing in the chat input below</div>
          </div>
        ) : (
          <>
            {chatMessages.map((message) => (
              <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`max-w-[85%] rounded-xl px-4 py-2 ${
                    message.sender === 'user'
                      ? 'bg-gradient-to-r from-teal-500 to-blue-500 text-white'
                      : 'bg-white/10 text-white/90 border border-white/10'
                  }`}
                >
                  <div className="text-sm leading-relaxed">
                    <MarkdownRenderer content={message.text} />
                  </div>
                </div>
              </div>
            ))}
            
            {/* Streaming message display */}
            {currentStreamingMessage && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-white/10 text-white/90 border border-white/10 rounded-xl px-4 py-2">
                  <div className="text-sm leading-relaxed">
                    <MarkdownRenderer content={currentStreamingMessage} />
                    <span className="inline-block w-2 h-4 bg-white/60 ml-1 animate-pulse">|</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        
        {/* Thinking indicator for local LLM processing */}
        {(isLoading && !wsState.isConnected) || isProcessingLocally ? (
          <ThinkingIndicator 
            isVisible={true} 
            message="Thinking" 
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
        
        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={handleScrollToBottom}
            className="absolute bottom-20 right-4 bg-gray-800/90 hover:bg-gray-700/90 text-white/90 rounded-full p-2 shadow-lg transition-all duration-200 hover:scale-105 border border-white/10"
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
        )}
      </div>
      
      {/* Chat Input Area - Fixed at bottom */}
      <div className="p-3 border-t border-white/10 flex-shrink-0">
        <div 
          className="rounded-xl bg-gray-800/30 p-3"
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
                  onClick={async () => {
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
                  }}
                  title={wsState.isConnected 
                    ? 'Connected - Click to disconnect and test local LLM' 
                    : 'Disconnected - Click to reconnect to backend'
                  }
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
                      title="WebSocket: Connected"
                    />
                  )}
                  {!wsState.isConnected && !isLoading && (
                    <div 
                      className="absolute -top-1 -right-1 w-3 h-3 bg-red-400 rounded-full" 
                      title="WebSocket: Disconnected"
                    />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  WebSocket: {wsState.isConnected ? 'Connected' : 'Disconnected'}
                </p>
              </TooltipContent>
            </Tooltip>   
            <textarea
              ref={textareaRef}
              value={currentMessage}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask ThinkDrop AI anything..."
              className="flex-1 bg-white/5 text-white placeholder-white/50 resize-none min-h-[24px] max-h-32 py-2 px-3 rounded-lg border border-white/10 focus:border-teal-400/50 focus:outline-none transition-colors"
              rows={1}
              style={{ WebkitAppRegion: 'no-drag', outline: 'none', boxShadow: 'none' } as React.CSSProperties}
            />
            <Button
              onClick={handleSendMessage}
              disabled={!currentMessage.trim() || isLoading}
              className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white w-10 h-10 p-0 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
    

    </>
  );
}
