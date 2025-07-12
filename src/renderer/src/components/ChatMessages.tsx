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
// import { useLocalLLM } from '../contexts/LocalLLMContext';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  isStreaming?: boolean;
}

// Simple markdown renderer component (memoized for performance)
const MarkdownRenderer: React.FC<{ content: string }> = React.memo(({ content }) => {
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
              className="rounded-md text-sm"
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className="bg-white/10 px-1 py-0.5 rounded text-sm" {...props}>
              {children}
            </code>
          );
        },
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-white/20 pl-4 italic text-white/80 mb-2">
            {children}
          </blockquote>
        ),
        h1: ({ children }) => <h1 className="text-xl font-bold mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-bold mb-2">{children}</h3>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

export default function ChatMessages() {
  // Load chat messages from localStorage on component mount (memoized)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('thinkdrop-chat-messages');
      if (!saved) return [];
      
      const loadedMessages = JSON.parse(saved).map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
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
  
  // Input state from ChatWindow
  const [currentMessage, setCurrentMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-scroll state and refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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
  const handleAgentOrchestration = async (message: any, finalText: string) => {
    try {
      console.log('🧠 [AGENT] Processing intent classification for agent orchestration...');
      
      // Extract intent classification data from backend response
      const intentClassification = message.payload?.intentClassification || message.intentClassification;
      
      if (intentClassification) {
        console.log('🎯 [AGENT] Found intent classification data:', intentClassification);
        
        // Trigger AgentOrchestrator with intent classification payload directly
        if (window.electronAPI) {
          const orchestrationResult = await window.electronAPI.agentOrchestrate({
            intentPayload: intentClassification, // Pass as object, not string
            context: { source: 'chat_streaming' }
          });
          console.log('✅ [AGENT] AgentOrchestrator result:', orchestrationResult);
          
          if (orchestrationResult.success) {
            console.log('🎉 [AGENT] Agent chain executed successfully!');
            // TODO: Show success indicator in UI
          } else {
            console.error('❌ [AGENT] Agent orchestration failed:', orchestrationResult.error);
          }
        }
      } else {
        console.log('ℹ️ [AGENT] No intent classification data found, creating basic payload...');
        
        // Create a basic intent classification payload for memory storage
        const basicIntentPayload = {
          intents: [{
            intent: 'general_query',
            confidence: 0.8,
            reasoning: 'General user query without specific intent classification'
          }],
          primaryIntent: 'general_query',
          entities: [],
          requiresMemoryAccess: true, // Always store for memory
          requiresExternalData: false,
          suggestedResponse: finalText,
          sourceText: chatMessages[chatMessages.length - 1]?.text || 'User query',
          metadata: {
            timestamp: new Date().toISOString(),
            source: 'chat_message',
            requestId: message.requestId
          }
        };
        
        console.log('📝 [AGENT] Triggering with basic intent payload:', basicIntentPayload);
        
        // Trigger AgentOrchestrator with basic payload directly
        if (window.electronAPI) {
          const orchestrationResult = await window.electronAPI.agentOrchestrate({
            intentPayload: basicIntentPayload, // Pass as object, not string
            context: { source: 'chat_streaming_basic' }
          });
          console.log('✅ [AGENT] Basic orchestration result:', orchestrationResult);
        }
      }
    } catch (error) {
      console.error('❌ [AGENT] Error in agent orchestration:', error);
    }
  };

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
        
        // 🧠 CRITICAL: Trigger AgentOrchestrator for intent classification and memory storage
        console.log('🧠 [AGENT] Triggering AgentOrchestrator for intent classification...');
        handleAgentOrchestration(message, finalText);
        
      } else if (message.type === 'intent_classification') {
        console.log('🎯🎯🎯 INTENT CLASSIFICATION MESSAGE FOUND! 🎯🎯🎯');
        console.log('  Primary Intent:', message.primaryIntent);
        console.log('  Requires Memory Access:', message.requiresMemoryAccess);
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
  const handleSendMessage = async () => {
    if (!currentMessage.trim() || isLoading) return;
    
    const messageText = currentMessage.trim();
    setCurrentMessage('');
    setIsLoading(true);
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    // Create and display user message immediately
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      text: messageText,
      sender: 'user',
      timestamp: new Date()
    };
    
    // Add user message to chat display
    console.log('📝 Adding user message:', userMessage);
    setChatMessages(prev => {
      const newMessages = [...prev, userMessage];
      console.log('📊 Messages after adding user message:', newMessages.length);
      return newMessages;
    });
    
    try {
      // Check if this is a complex request that needs agent orchestration
      const needsOrchestration = /\b(screenshot|capture|screen|email|analyze|remember|save|store)\b/i.test(messageText);
      
      if (needsOrchestration) {
        console.log('🤖 Complex request detected - running agent orchestration first');
        
        // Run agent orchestration for complex requests
        if (window.electronAPI?.agentOrchestrate) {
          try {
            const orchestrationResult = await window.electronAPI.agentOrchestrate({
              message: messageText,
              context: {
                timestamp: new Date().toISOString(),
                source: 'chat_input'
              }
            });
            console.log('🎯 Agent orchestration completed:', orchestrationResult);
          } catch (orchestrationError) {
            console.error('❌ Agent orchestration failed:', orchestrationError);
          }
        }
      }
      
      // Send to WebSocket for streaming response
      if (wsState.isConnected && sendLLMRequest) {
        console.log('📤 Sending message to WebSocket:', messageText);
        
        await sendLLMRequest({
          prompt: messageText,
          provider: 'openai',
          options: {
            taskType: needsOrchestration ? 'orchestrate' : 'ask',
            stream: true,
            temperature: 0.7
          }
        });
        
        console.log('✅ Message sent to WebSocket successfully');
      } else {
        console.warn('⚠️ WebSocket not connected or sendLLMRequest not available');
        setIsLoading(false);
      }
      
    } catch (error) {
      console.error('❌ Error sending message:', error);
      setIsLoading(false);
    }
  };
  
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

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    if (!isUserScrolling && (chatMessages.length > 0 || currentStreamingMessage)) {
      // scrollToBottom();
    }
  }, [chatMessages, currentStreamingMessage, isUserScrolling]);

  // Scroll detection to show/hide scroll button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
      
      setShowScrollButton(!isAtBottom);
      
      // Detect if user is manually scrolling
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      setIsUserScrolling(true);
      scrollTimeoutRef.current = setTimeout(() => {
        if (isAtBottom) {
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

  // Unified scroll to bottom function with options
  const scrollToBottom = useCallback((options = { smooth: true, force: false }) => {
    // Don't auto-scroll if user is manually scrolling (unless forced)
    if (!options.force && isUserScrolling) {
      return;
    }
    
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ 
          behavior: options.smooth ? 'smooth' : 'auto',
          block: 'end'
        });
      }
    });
  }, [isUserScrolling]);

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

  useEffect(() => {
    if (window.electronAPI?.adjustChatMessagesHeight) {
      const contentHeight = Math.min(chatMessages.length * 80 + 100, 400); // Max height of 400px
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

  // Always show the window, even when empty

  return (
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
            className="relative group w-6 h-6 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center cursor-pointer"
            title={wsState.isConnected 
              ? `WebSocket: Connected${wsState.activeRequests > 0 ? ` (${wsState.activeRequests} active)` : ''}` 
              : 'WebSocket: Disconnected'
            }
          >
            <Droplet className="w-3 h-3 text-white" />
            {/* Custom tooltip */}
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
              {wsState.isConnected 
                ? `WebSocket: Connected${wsState.activeRequests > 0 ? ` (${wsState.activeRequests} active)` : ''}` 
                : 'WebSocket: Disconnected'
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
        {/* Debug Panel - Remove this after fixing */}
        <div className="bg-red-900/20 border border-red-500/30 rounded p-2 mb-4 text-xs text-white/70">
          <div className="font-bold text-red-400 mb-1">🐛 DEBUG INFO:</div>
          <div>Messages in state: {chatMessages.length}</div>
          <div>LocalStorage: {localStorage.getItem('thinkdrop-chat-messages') ? 'Has data' : 'Empty'}</div>
          <div>Streaming: {currentStreamingMessage ? 'Yes' : 'No'}</div>
          <div>WebSocket: {wsState.isConnected ? 'Connected' : 'Disconnected'}</div>
          <div>Last message IDs: {chatMessages.slice(-2).map(m => m.id.slice(-8)).join(', ')}</div>
        </div>
        
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
        
        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/10 text-white/90 border border-white/10 rounded-xl px-4 py-2">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}
        
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
                  className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer ${
                    wsState.isConnected 
                      ? 'from-teal-400 to-blue-500' 
                      : 'from-gray-500 to-gray-600'
                  }`}
                  onClick={() => {
                    if (wsState.isConnected) return;

                    console.log('🔄 Manual reconnection requested');
                    connectWebSocket().catch(error => {
                      console.error('❌ Manual reconnection failed:', error);
                    });
                  }}
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
  );
}
