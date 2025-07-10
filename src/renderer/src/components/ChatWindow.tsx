import React, { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Send, X, Droplet } from 'lucide-react';
import { useLocalLLM } from '../contexts/LocalLLMContext';
import useWebSocket from '../hooks/useWebSocket';

export default function ChatWindow() {
  const [currentMessage, setCurrentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // LocalLLMAgent integration
  const { isInitialized, isLocalLLMAvailable } = useLocalLLM();
  
  // WebSocket integration for real-time streaming
  const {
    state: wsState,
    sendLLMRequest,
    connect: connectWebSocket,
    disconnect: disconnectWebSocket
  } = useWebSocket({
    autoConnect: false, // Manual connection control
    onConnected: () => console.log('✅ ChatWindow WebSocket connected'),
    onDisconnected: () => console.log('🔌 ChatWindow WebSocket disconnected'),
    onError: (error) => console.error('❌ ChatWindow WebSocket error:', error)
  });
  
  // Combined loading state
  const isBusy = isLoading || wsState.activeRequests > 0;

  // Auto-focus the textarea when component mounts and ensure it's ready
  useEffect(() => {
    const focusTextarea = () => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        // Ensure cursor is at the end
        textareaRef.current.setSelectionRange(
          textareaRef.current.value.length,
          textareaRef.current.value.length
        );
      }
    };
    
    // Focus immediately and after a short delay to ensure window is ready
    focusTextarea();
    const timeoutId = setTimeout(focusTextarea, 100);
    
    // Listen for message-loaded events to regain focus
    const handleMessageLoaded = () => {
      // Regain focus when a message is loaded in the chat messages window
      setTimeout(() => {
        focusTextarea();
      }, 300);
    };
    
    if (window.electronAPI?.onMessageLoaded) {
      window.electronAPI.onMessageLoaded(handleMessageLoaded);
    }
    
    return () => {
      clearTimeout(timeoutId);
      // Note: Electron IPC listeners are cleaned up when window is destroyed
    };
  }, []);

  const handleSendMessage = async () => {
    if (!currentMessage.trim() || isBusy) return;
    
    setIsLoading(true);
    const messageText = currentMessage.trim();
    setCurrentMessage(''); // Clear immediately to prevent double-send
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    // Create user message for local display
    const userMessage = {
      id: `user_${Date.now()}`,
      text: messageText,
      sender: 'user' as const,
      timestamp: new Date()
    };
    
    try {
      // Send to traditional chat system for UI display (user message)
      if (window.electronAPI?.sendChatMessage) {
        await window.electronAPI.sendChatMessage(userMessage);
      }
      
      // Connect WebSocket if not connected
      if (!wsState.isConnected) {
        console.log('🔌 Connecting to WebSocket for streaming...');
        await connectWebSocket();
        // Wait a moment for connection to establish
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Send LLM request via WebSocket for streaming response
      if (wsState.isConnected) {
        console.log('📤 Sending LLM request via WebSocket:', messageText);
        await sendLLMRequest({
          message: messageText,
          sessionId: `session_${Date.now()}`,
          options: {
            temperature: 0.7,
            maxTokens: 1000
          }
        });
        console.log('✅ LLM request sent successfully');
      } else {
        console.warn('⚠️ WebSocket not connected, falling back to LocalLLM');
        // Fallback to local LLM if WebSocket fails
        if (isInitialized) {
          console.log('🔄 Using LocalLLM fallback');
        }
      }
      
      // Success - regain focus after a delay
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
        setIsLoading(false);
      }, 300);
      
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore message if sending failed
      setCurrentMessage(messageText);
      setIsLoading(false);
      
      // Still regain focus even on error
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 300);
    }
  };

  const handleClose = () => {
    if (window.electronAPI?.hideChat) {
      window.electronAPI.hideChat();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      // Add small delay to ensure event is fully processed
      setTimeout(() => {
        handleSendMessage();
      }, 0);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentMessage(e.target.value);
    // Auto-resize textarea
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = target.scrollHeight + 'px';
  };

  return (
    <div className="w-full h-full flex flex-col justify-end bg-transparent">
      {/* Chat Input Area - Fixed at bottom like ChatGPT */}
      <div className="p-4">
        <div 
          className="rounded-2xl bg-gray-900/95 p-4 border-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center space-x-3"
          >
            <div className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative ${
              isInitialized && isLocalLLMAvailable 
                ? 'from-teal-400 to-blue-500' 
                : 'from-gray-500 to-gray-600'
            }`}
            >
              <Droplet className="w-4 h-4 text-white" />
              {/* Agent status indicator */}
              {isLoading && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
              )}
              {isInitialized && isLocalLLMAvailable && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full" />
              )}
              {!isInitialized && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-400 rounded-full" />
              )}
            </div>
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
            <Button
              variant="ghost"
              size="sm"
              className="text-white/60 hover:text-white hover:bg-white/10 w-8 h-8 p-0 rounded-lg flex-shrink-0"
              onClick={handleClose}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
