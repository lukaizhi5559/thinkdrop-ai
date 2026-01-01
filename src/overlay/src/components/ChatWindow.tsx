/**
 * Chat Window Component
 * 
 * Displays conversation history with sidebar for managing conversations
 * Simplified version of UnifiedInterface focused only on chat functionality
 */

import { useState, useEffect } from 'react';
import { MessageCircle, X, Minimize2, Maximize2 } from 'lucide-react';
import { ConversationSidebar } from './ConversationSidebar';
import ChatMessages from './ChatMessages';
import { ToastProvider } from '../contexts/ToastContext';
import { GuideProvider } from '../contexts/GuideContext';

const ipcRenderer = (window as any).electron?.ipcRenderer;

export default function ChatWindow() {
  const [isVisible, setIsVisible] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);

  // Listen for visibility toggle from PromptBar
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleVisibilityChange = (_event: any, state: { isVisible: boolean }) => {
      setIsVisible(state.isVisible);
    };

    ipcRenderer.on('chat-window:state', handleVisibilityChange);
    
    // Get initial state
    ipcRenderer.invoke('chat-window:get-state').then((state: { isVisible: boolean }) => {
      setIsVisible(state.isVisible);
    });

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('chat-window:state', handleVisibilityChange);
      }
    };
  }, []);

  const handleClose = () => {
    if (ipcRenderer) {
      ipcRenderer.send('chat-window:toggle');
    }
  };

  const handleToggleMaximize = () => {
    setIsMaximized(!isMaximized);
    // TODO: Implement window resize via IPC
  };

  // Don't unmount - just hide with CSS to prevent re-fetching data
  // if (!isVisible) return null;

  return (
    <ToastProvider>
      <GuideProvider>
        <div className={`w-full h-full bg-gray-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden ${!isVisible ? 'hidden' : ''}`}>
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gray-800/50"
        // style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-lg flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <h2 className="text-white font-semibold">Conversations</h2>
        </div>
        
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            onClick={handleToggleMaximize}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <Minimize2 className="w-4 h-4 text-white/70" />
            ) : (
              <Maximize2 className="w-4 h-4 text-white/70" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title="Hide Chat Window"
          >
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>
      </div>

          {/* Content Area */}
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            <ConversationSidebar />

            {/* Messages Area */}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 overflow-hidden">
                <ChatMessages />
              </div>
              
              {/* Note: Input is handled by PromptBar */}
              <div className="px-4 py-3 border-t border-white/10 bg-gray-800/30">
                <p className="text-white/40 text-xs text-center">
                  Use the prompt bar below to send messages
                </p>
              </div>
            </div>
          </div>
        </div>
      </GuideProvider>
    </ToastProvider>
  );
}
