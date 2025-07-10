import React, { useState, useEffect } from 'react';
import { Droplet, X } from 'lucide-react';
import { Button } from './ui/button';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

export default function ChatMessages() {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());

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
        
        // Show loading indicator for user messages (AI response will come from backend)
        if (message.sender === 'user') {
          setIsLoading(true);
          // Loading will be cleared when AI response arrives from backend
          setTimeout(() => {
            // Clear loading if no response comes within 10 seconds
            setIsLoading(false);
          }, 10000);
        } else if (message.sender === 'ai') {
          // Clear loading when AI response arrives
          setIsLoading(false);
        }
      });
    }
  }, [processedMessageIds]);

  useEffect(() => {
    if (window.electronAPI?.adjustChatMessagesHeight) {
      const contentHeight = Math.min(chatMessages.length * 80 + 100, 400); // Max height of 400px
      window.electronAPI.adjustChatMessagesHeight(contentHeight);
    }
  }, [chatMessages.length]);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    const scrollContainer = document.querySelector('.chat-messages-scroll');
    if (scrollContainer && chatMessages.length > 0) {
      // Use setTimeout to ensure DOM is updated before scrolling
      setTimeout(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }, 100);
    }
  }, [chatMessages.length, isLoading]);

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
    <div className="w-full h-screen flex flex-col bg-gray-900/95">
      {/* Draggable Header */}
      <div
        className="flex items-center space-x-2 p-4 pb-2 border-b border-white/10 cursor-move flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-6 h-6 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center">
          <Droplet className="w-3 h-3 text-white" />
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
        className="chat-messages-scroll flex-1 overflow-y-auto overflow-x-hidden p-4"
        style={{ 
          WebkitAppRegion: 'no-drag',
          minHeight: 0, // Important for flex child to shrink
          maxHeight: '100%'
        } as React.CSSProperties}
      >
        <div className="space-y-4">
        {chatMessages.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-white/40 text-sm mb-2">No messages yet</div>
            <div className="text-white/30 text-xs">Start a conversation by typing in the chat input below</div>
          </div>
        ) : (
          chatMessages.map((message) => (
            <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[85%] rounded-xl px-4 py-2 ${
                  message.sender === 'user'
                    ? 'bg-gradient-to-r from-teal-500 to-blue-500 text-white'
                    : 'bg-white/10 text-white/90 border border-white/10'
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-line">{message.text}</p>
              </div>
            </div>
          ))
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
        </div>
      </div>
    </div>
  );
}
