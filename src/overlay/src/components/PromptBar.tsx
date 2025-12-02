/**
 * Prompt Bar Component
 * 
 * Collapsible bottom-center prompt bar
 * - 50% screen width, centered
 * - Slide up/down animation
 * - Expand/collapse with arrow button
 * 
 */

import React, { useState, useRef, useEffect } from 'react';
import { Droplet, Unplug, ArrowUp, ChevronUp, X, FileSearch, MessageCircle } from 'lucide-react';

interface PromptBarProps {
  onSubmit: (message: string) => void;
  isReady: boolean;
  onConnectionChange?: (isConnected: boolean) => void;
}

const ipcRenderer = (window as any).electron?.ipcRenderer;

export default function PromptBar({ 
  onSubmit, 
  isReady,
  onConnectionChange
}: PromptBarProps) {
  const [message, setMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isInputHovered, setIsInputHovered] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState<number | null>(null);
  const [hasResults, setHasResults] = useState(false);
  const [isResultsVisible, setIsResultsVisible] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Listen for web search results availability
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleWebSearchState = (_event: any, state: { hasResults: boolean; isVisible: boolean }) => {
      setHasResults(state.hasResults);
      setIsResultsVisible(state.isVisible);
    };

    const handleChatWindowState = (_event: any, state: { isVisible: boolean }) => {
      setIsChatVisible(state.isVisible);
    };

    ipcRenderer.on('web-search:state', handleWebSearchState);
    ipcRenderer.on('chat-window:state', handleChatWindowState);
    
    // Get initial chat window state
    ipcRenderer.invoke('chat-window:get-state').then((state: { isVisible: boolean }) => {
      setIsChatVisible(state.isVisible);
    }).catch(() => {
      // Ignore errors, default to visible
    });
    
    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('web-search:state', handleWebSearchState);
        ipcRenderer.removeListener('chat-window:state', handleChatWindowState);
      }
    };
  }, []);

  const handleToggleWebSearch = () => {
    if (ipcRenderer) {
      ipcRenderer.send('web-search:toggle');
    }
  };

  const handleToggleChatWindow = () => {
    if (ipcRenderer) {
      ipcRenderer.send('chat-window:toggle');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSubmit(message.trim());
      setMessage('');
      
      // Reset textarea height and window size after React updates
      if (textareaRef.current && ipcRenderer) {
        // Wait for React to update the textarea value to empty
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const resetHeight = textareaRef.current.scrollHeight;
            textareaRef.current.style.height = resetHeight + 'px';
            
            // Update saved height state to the reset height
            setTextareaHeight(resetHeight);
            
            // Resize window to fit reset textarea
            const baseHeight = 66;
            const totalHeight = baseHeight + resetHeight;
            ipcRenderer.send('overlay:resize-prompt', {
              height: totalHeight,
              animate: true
            });
          }
        }, 0);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      setIsExpanded(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    
    // Calculate max height as 50% of screen height minus some padding
    const screenHeight = window.screen.availHeight;
    const maxTextareaHeight = Math.floor(screenHeight * 0.5) - 100; // 50% minus base UI height
    
    // Auto-resize textarea
    e.target.style.height = 'auto';
    const newHeight = Math.min(e.target.scrollHeight, maxTextareaHeight);
    e.target.style.height = newHeight + 'px';
    
    // Save textarea height to state so it persists on collapse/expand
    setTextareaHeight(newHeight);
    
    // Resize the prompt window to accommodate the textarea
    if (ipcRenderer) {
      // Calculate total prompt bar height: padding + input area + status bar
      // p-3 (24px) + icon (32px) + textarea py-2 (16px) + mt-2 (8px) + status (16px) + border (2px) = 98px
      // But textarea height already includes its padding, so: 24 + 32 + 8 + 16 + 2 = 82px base
      const baseHeight = 66; // Base UI height without textarea content
      const totalHeight = baseHeight + newHeight;
      
      // Resize the prompt window
      ipcRenderer.send('overlay:resize-prompt', {
        height: totalHeight,
        animate: false // No animation for smooth typing experience
      });
    }
  };

  const toggleConnection = () => {
    const newState = !isConnected;
    setIsConnected(newState);
    if (onConnectionChange) {
      onConnectionChange(newState);
    }
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Notify main process when expanded state changes and resize window
  useEffect(() => {
    if (ipcRenderer) {
      ipcRenderer.send('overlay:set-expanded', isExpanded);
      
      // Resize window when expanding/collapsing
      if (isExpanded) {
        // When expanding, resize to fit saved textarea height
        const baseHeight = 66;
        const currentTextareaHeight = textareaHeight || 24; // Use saved height or min height
        const totalHeight = baseHeight + currentTextareaHeight;
        
        ipcRenderer.send('overlay:resize-prompt', {
          height: totalHeight,
          animate: true
        });
      } else {
        // When collapsing, resize to just the button
        ipcRenderer.send('overlay:resize-prompt', {
          height: 55,
          animate: true
        });
      }
    }
  }, [isExpanded, textareaHeight]);

  // Initialize textarea height and restore saved height when expanding
  useEffect(() => {
    if (textareaRef.current && isExpanded) {
      // Restore saved height or calculate from content
      if (textareaHeight) {
        textareaRef.current.style.height = textareaHeight + 'px';
      } else {
        textareaRef.current.style.height = 'auto';
        const initialHeight = textareaRef.current.scrollHeight;
        textareaRef.current.style.height = initialHeight + 'px';
        setTextareaHeight(initialHeight);
      }
    }
  }, [isExpanded]);

  // Handle mouse events for click-through when collapsed
  useEffect(() => {
    if (!ipcRenderer || isExpanded) return;

    // When collapsed, enable click-through except over the arrow button
    const handleMouseMove = (e: MouseEvent) => {
      const element = document.elementFromPoint(e.clientX, e.clientY);
      const isOverButton = element?.closest('.click-active') !== null;
      
      // Disable click-through when over button, enable otherwise
      ipcRenderer.send('overlay:set-ignore-mouse-events', !isOverButton, { forward: true });
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isExpanded]);

  // Dragging is handled via CSS -webkit-app-region: drag
  // No JavaScript needed!

  return (
    <div className="w-full h-full flex justify-center pointer-events-none"
      onMouseEnter={() => setIsInputHovered(true)}
      onMouseLeave={() => setIsInputHovered(false)}
    >
      {/* Expand/Collapse Button (always visible when collapsed) */}
      {!isExpanded && (
        <div className="flex items-end pointer-events-auto mb-6">
          <button
            onClick={toggleExpanded}
            className="
              bg-gray-800/80 backdrop-blur-xl p-2 rounded-full
              border border-white/10
              hover:bg-gray-700/80 hover:scale-110 
              transition-all duration-300 ease-out
              click-active
            "
            title="Expand prompt bar"
          >
            <ChevronUp className="w-5 h-5 text-white" />
          </button>
        </div>
      )}

      {/* Main Prompt Bar */}
      {isExpanded && (
        <div 
          className={`
            w-full rounded-xl backdrop-blur-xl p-3
            border border-white/10 click-active
            pointer-events-auto
            animate-in fade-in slide-in-from-bottom-4 
            transition-colors duration-300
            ${isInputHovered ? 'bg-gray-800/90' : 'bg-gray-800/50'}
          `}
        >
        {/* Header with drag handle and close button */}
        {/* <div 
          className="flex items-center justify-between mb-1 py-1 cursor-move drag-handle"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          <div className="text-xs text-white/60 text-center select-none">
            {isConnected ? 'Live Mode On' : 'Private Mode On'}
          </div>
          <button
            onClick={toggleExpanded}
            className="
              p-1.5 rounded-lg hover:bg-white/10 transition-colors
              click-active
            "
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title="Collapse (ESC)"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div> */}

        {/* Input Area */}
        <div 
          className="flex items-center space-x-3 click-active"
        >
          
          
          {/* Textarea Input */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isReady ? "Ask anything..." : "Initializing..."}
            disabled={!isReady}
            className="
              flex-1 text-sm bg-transparent text-white placeholder-white/50 
              resize-none min-h-[24px] max-h-[400px] py-2 px-3 rounded-lg 
              border border-white/10 focus:border-teal-400/50 
              focus:outline-none transition-colors click-active
              disabled:opacity-50 disabled:cursor-not-allowed
              overflow-y-auto
            "
            rows={1}
            style={{ border: 'none', outline: 'none', boxShadow: 'none', height: 'auto' }}
          />
          
          {/* Send Button */}
          <button
            onClick={toggleExpanded}
            className="
              p-1.5 rounded-lg hover:bg-white/10 transition-colors
              click-active
            "
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title="Collapse (ESC)"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
        
        {/* Bottom Status Bar */}
        <div className="flex items-center justify-between mt-2 text-xs text-white/60 space-x-3">
          
          {/* Toggle Button */}
          <div className="flex items-center space-x-2">
            {/* Chat Window Toggle Button */}
            <div 
              className={`rounded-lg p-0.5 transition-all duration-200 ${
                isChatVisible ? 'bg-blue-500/20' : ''
              }`}
            >
              <div 
                className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                  isChatVisible
                    ? 'from-blue-400 to-indigo-500 hover:from-blue-300 hover:to-indigo-400' 
                    : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
                }`}
                onClick={handleToggleChatWindow}
                title={isChatVisible ? 'Hide Chat Window' : 'Show Chat Window'}
              >
                <MessageCircle className="w-4 h-4 text-white" />
                {/* Status indicator */}
                <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                  isChatVisible ? 'bg-green-400' : 'bg-gray-400'
                }`} />
              </div>
            </div>
            
            {/* Web Search Toggle Button */}
            {hasResults && (
              <div 
                className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                  isResultsVisible
                    ? 'from-purple-400 to-pink-500 hover:from-purple-300 hover:to-pink-400' 
                    : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
                }`}
                onClick={handleToggleWebSearch}
                title={isResultsVisible ? 'Hide Search Results' : 'Show Search Results'}
              >
                <FileSearch className="w-4 h-4 text-white" />
                {/* Indicator dot when results available */}
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-purple-400" />
              </div>
            )}

            {/* Connection Toggle Button */}
            <div 
              className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                isConnected 
                  ? 'from-teal-400 to-blue-500 hover:from-teal-300 hover:to-blue-400' 
                  : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
              }`}
              onClick={toggleConnection}
              title={isConnected ? 'Live Mode' : 'Private Mode'}
            >
              {isConnected ? <Droplet className="w-4 h-4 text-white" /> : <Unplug className="w-4 h-4 text-white" />}
              {/* Status Indicator */}
              <div 
                className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                  isConnected ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
            </div>
            <div className="text-xs text-white/60 text-center select-none">
                {isConnected ? 'Live Mode' : 'Private Mode'}
            </div>
          </div>
          <div className="text-center">
            Thinkdrop can make mistakes. Check important info.
          </div>
          <button
            onClick={handleSubmit}
            disabled={!isReady || !message.trim()}
            className="
              bg-gradient-to-r from-teal-500 to-blue-500 
              hover:from-teal-600 hover:to-blue-600 
              text-white w-9 h-9 p-0 rounded-xl 
              disabled:opacity-50 disabled:cursor-not-allowed 
              flex-shrink-0 flex items-center justify-center
              transition-all click-active
            "
            title="Send message"
          >
            <ArrowUp className="w-6 h-6" />
          </button>
        </div>
        </div>
      )}
    </div>
  );
}
