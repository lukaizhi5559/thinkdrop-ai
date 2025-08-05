import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Droplet, Send, Unplug, Copy, RotateCcw, Edit3, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
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
  const [initialThinkingMessage, setInitialThinkingMessage] = useState<string>('Thinking');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const isStreamingEndedRef = useRef<boolean>(false);
  
  // Local LLM processing state
  const [isProcessingLocally, setIsProcessingLocally] = useState(false);
  const [localLLMError, setLocalLLMError] = useState<string | null>(null);
  
  // Input state from ChatWindow
  const [currentMessage, setCurrentMessage] = useState('');
  
  // Inline editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  
  // Copy feedback state
  const [copiedMessageIds, setCopiedMessageIds] = useState<Set<string>>(new Set());
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
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

  // 🎯 Semantic Search First - Try to find relevant stored memories
  const trySemanticSearchFirst = useCallback(async (query: string) => {
    try {
      console.log('🔍 Performing semantic search for:', query.substring(0, 50) + '...');
      
      // Call semantic search via Electron API
      const result = await window.electronAPI?.agentExecute({
        agentName: 'UserMemoryAgent',
        action: 'memory-semantic-search',
        input: query,
        options: {
          limit: 3,
          minSimilarity: 0.6 // Higher threshold for better relevance
        }
      });
      
      if (result?.success && result.results && result.results.length > 0) {
        console.log(`✅ Found ${result.results.length} relevant memories`);
        
        // Format the response with found memories
        const memories = result.results;
        let response = "Based on what I remember:\n\n";
        
        memories.forEach((memory: any, index: number) => {
          const similarity = Math.round(memory.similarity * 100);
          response += `**Memory ${index + 1}** (${similarity}% match):\n`;
          response += `${memory.source_text || memory.suggested_response}\n\n`;
        });
        
        response += "Is this what you were looking for, or would you like me to help with something else?";
        
        return {
          hasRelevantResults: true,
          response: response,
          memories: memories
        };
      }
      
      console.log('📝 No relevant memories found with sufficient similarity');
      return {
        hasRelevantResults: false,
        response: '',
        memories: []
      };
      
    } catch (error) {
      console.error('❌ Semantic search failed:', error);
      return {
        hasRelevantResults: false,
        response: '',
        memories: []
      };
    }
  }, []);

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
    
    // Reset textarea height to single line
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    setIsLoading(true);
    setLocalLLMError(null);
    setInitialThinkingMessage('Thinking'); // Reset to default at start of new message
    
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
      
      // 🎯 STEP 1: Try semantic search first for relevant stored memories
      console.log('🔍 Attempting semantic search first...');
      const semanticResults = await trySemanticSearchFirst(messageText);
      
      if (semanticResults && semanticResults.hasRelevantResults) {
        console.log('✅ Found relevant memories, using semantic search results');
        // Add AI response with semantic search results
        const aiMessage: ChatMessage = {
          id: `ai-${Date.now()}`,
          text: semanticResults.response,
          sender: 'ai',
          timestamp: new Date()
        };
        
        setChatMessages(prev => {
          const updated = [...prev, aiMessage];
          localStorage.setItem('thinkdrop-chat-messages', JSON.stringify(updated));
          return updated;
        });
        
        setIsLoading(false);
        return;
      }
      
      console.log('📝 No relevant memories found, proceeding with LLM...', semanticResults);
      
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
    let isMemoryRetrieve = false;
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
      
      const result = await window.electronAPI.llmQueryLocal(messageText, {
        temperature: 0.0,
        maxTokens: 50
      });
      
      if (result.success) {
        // For memory_retrieve intents, use the initial response in ThinkingIndicator
        // and wait for the orchestration update for the final result
        if (result.intentClassificationPayload?.primaryIntent === 'memory_retrieve') {
          isMemoryRetrieve = true;
          // Set the thinking message to the initial response
          const thinkingMsg = result.data || 'Let me check what I have stored about that.';
          console.log('🎯 [THINKING] Setting thinking message for memory_retrieve:', thinkingMsg);
          console.log('🎯 [THINKING] States - isProcessingLocally:', isProcessingLocally, 'isLoading:', isLoading, 'wsConnected:', wsState.isConnected);
          setInitialThinkingMessage(thinkingMsg);
          
          // Ensure we stay in processing state to keep ThinkingIndicator visible
          console.log('🎯 [THINKING] Keeping processing state active for memory_retrieve');
          // Don't add the AI message yet - wait for orchestration update
          return;
        }
        
        // For non-memory intents, add AI response message immediately
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
        console.log('📝 Note: Background orchestration is handled by IPC handler, no additional frontend call needed');
        
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
      // Only clear processing state if not waiting for memory retrieve orchestration
      if (!isMemoryRetrieve) {
        console.log('🎯 [THINKING] Clearing processing state in finally block');
        setIsProcessingLocally(false);
        setIsLoading(false);
      } else {
        console.log('🎯 [THINKING] Keeping processing state active for memory_retrieve orchestration');
      }
      scrollToBottom({ smooth: true, force: true });
    }
  }, []);

  // Clear local LLM error when connection is restored
  useEffect(() => {
    if (wsState.isConnected && localLLMError) {
      setLocalLLMError(null);
    }
  }, [wsState.isConnected, localLLMError]);

  // // Handle WebSocket toggle for testing local LLM fallback
  // const handleWebSocketToggle = useCallback(async (e?: React.MouseEvent) => {
  //   e?.preventDefault();
  //   e?.stopPropagation();
    
  //   console.log('🔍 [DEBUG] WebSocket toggle clicked!', {
  //     currentState: wsState.isConnected,
  //     reconnectCount: wsState.reconnectCount,
  //     activeRequests: wsState.activeRequests
  //   });
    
  //   try {
  //     if (wsState.isConnected) {
  //       console.log('🔌 Manually disconnecting WebSocket for local LLM testing...');
  //       await disconnectWebSocket();
  //       console.log('✅ WebSocket disconnected - local LLM fallback will be used');
  //     } else {
  //       console.log('🔌 Reconnecting WebSocket...');
  //       await connectWebSocket();
  //       console.log('✅ WebSocket reconnected - backend streaming will be used');
  //     }
  //   } catch (error) {
  //     console.error('❌ Error toggling WebSocket connection:', error);
  //   }
  // }, [wsState.isConnected, connectWebSocket, disconnectWebSocket]);
  
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
    
    // Auto-resize textarea to fit content
    const target = e.target;
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

  const handleRegenerateMessage = useCallback(async (messageId: string) => {
    // Find the user message that preceded this AI message
    const messageIndex = chatMessages.findIndex(m => m.id === messageId);
    if (messageIndex > 0) {
      const previousMessage = chatMessages[messageIndex - 1];
      if (previousMessage.sender === 'user') {
        console.log('🔄 Regenerating response for:', previousMessage.text);
        // Remove the AI message and regenerate
        setChatMessages(prev => prev.filter(m => m.id !== messageId));
        // Set the previous message in textarea and send
        setCurrentMessage(previousMessage.text);
        // Use setTimeout to ensure state is updated before sending
        setTimeout(async () => {
          await handleSendMessage();
        }, 0);
      }
    }
  }, [chatMessages, handleSendMessage]);

  const handleEditMessage = useCallback((messageId: string, messageText: string) => {
    console.log('✏️ Edit message:', messageId, messageText);
    // Start inline editing
    setEditingMessageId(messageId);
    setEditingText(messageText);
    // Focus the edit textarea after state update
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
    
    // Update the message in the chat
    setChatMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, text: editingText.trim() }
        : msg
    ));
    
    // Remove messages from this point forward and regenerate
    const messageIndex = chatMessages.findIndex(m => m.id === messageId);
    if (messageIndex !== -1) {
      // Remove subsequent messages
      setChatMessages(prev => prev.slice(0, messageIndex + 1));
      
      // Set the edited text in the main textarea and send
      setCurrentMessage(editingText.trim());
      setTimeout(async () => {
        await handleSendMessage();
      }, 0);
    }
    
    // Exit edit mode
    setEditingMessageId(null);
    setEditingText('');
  }, [editingText, chatMessages, handleSendMessage]);

  const handleCancelEdit = useCallback(() => {
    console.log('❌ Canceling edit');
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleEditTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingText(e.target.value);
    
    // Auto-resize textarea
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

    // Listen for orchestration updates (final results from background processing)
    if (window.electronAPI?.onOrchestrationUpdate) {
      window.electronAPI.onOrchestrationUpdate((_event: any, updateData: any) => {
        console.log('🔄 Received orchestration update:', updateData);
        
        if (updateData.type === 'orchestration-complete' && updateData.response) {
          console.log('🎯 [ORCHESTRATION] Received final response, clearing thinking indicator');
          // Update the last AI message with the final response
          setChatMessages(prev => {
            const lastIndex = prev.length - 1;
            if (lastIndex >= 0 && prev[lastIndex].sender === 'ai') {
              const updatedMessages = [...prev];
              updatedMessages[lastIndex] = {
                ...updatedMessages[lastIndex],
                text: updateData.response,
                isStreaming: false
              };
              return updatedMessages;
            } else {
              // Add new AI message if none exists
              return [...prev, {
                id: `ai-${Date.now()}`,
                text: updateData.response,
                sender: 'ai' as const,
                timestamp: new Date(),
                isStreaming: false
              }];
            }
          });
          
          // Clear loading and processing states
          console.log('🎯 [ORCHESTRATION] Clearing states - setIsLoading(false), setIsProcessingLocally(false)');
          setIsLoading(false);
          setIsProcessingLocally(false);
          // Don't reset thinking message here - let it disappear naturally when bubble appears
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
        <div 
          ref={messagesContainerRef}
          className="overflow-y-auto overflow-x-hidden p-4 flex-1"
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
                
                {/* Action buttons at bottom - hide during edit mode */}
                {editingMessageId !== message.id && (
                  <div className={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
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
        
        {/* Invisible element to scroll to */}
        <div ref={messagesEndRef} />
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
                  {wsState.isConnected ? 'Live: Messages sent to the server.' : 'Private: messages processed locally.'}
                </p>
              </TooltipContent>
            </Tooltip>   
            <textarea
              ref={textareaRef}
              value={currentMessage}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="flex-1 text-sm bg-white/5 text-white placeholder-white/50 resize-none min-h-[24px] max-h-32 py-2 px-3 rounded-lg border border-white/10 focus:border-teal-400/50 focus:outline-none transition-colors"
              rows={1}
              style={{ WebkitAppRegion: 'no-drag', outline: 'none', boxShadow: 'none' } as React.CSSProperties}
            />
            <Button
              onClick={handleSendMessage}
              disabled={!currentMessage.trim() || isLoading}
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
