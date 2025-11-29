/**
 * Prompt Bar Component
 * 
 * Collapsible bottom-center prompt bar
 * - 50% screen width, centered
 * - Slide up/down animation
 * - Expand/collapse with arrow button
 */

import React, { useState, useRef, useEffect } from 'react';
import { Droplet, Unplug, Send, Monitor, ChevronUp, X } from 'lucide-react';

interface PromptBarProps {
  onSubmit: (message: string) => void;
  isReady: boolean;
}

const ipcRenderer = (window as any).electron?.ipcRenderer;

export default function PromptBar({ onSubmit, isReady }: PromptBarProps) {
  const [message, setMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSubmit(message.trim());
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
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
    
    // Notify main process to resize window based on textarea height
    if (ipcRenderer) {
      // Base height (110px) + additional height from textarea expansion
      // Reduced from 120px to account for actual content height
      const textareaExtraHeight = Math.max(0, newHeight - 24); // 24px is min height
      const totalWindowHeight = 110 + textareaExtraHeight;
      ipcRenderer.send('overlay:resize-height', totalWindowHeight);
    }
  };

  const toggleConnection = () => {
    setIsConnected(!isConnected);
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Notify main process when expanded state changes
  useEffect(() => {
    if (ipcRenderer) {
      ipcRenderer.send('overlay:set-expanded', isExpanded);
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
    <div className="fixed bottom-0 left-0 right-0 flex items-end justify-center transition-all duration-500 ease-out pointer-events-none">
      {/* Expand/Collapse Button (always visible when collapsed) */}
      {!isExpanded && (
        <div className="flex justify-center pb-2 animate-in fade-in slide-in-from-bottom-4 duration-500 pointer-events-auto">
          <button
            onClick={toggleExpanded}
            className="
              bg-gray-800/80 backdrop-blur-xl p-3 rounded-full
              border border-white/10
              hover:bg-gray-700/80 hover:scale-110 
              transition-all duration-300 ease-out
              click-active
            "
            title="Expand prompt bar"
          >
            <ChevronUp className="w-6 h-6 text-white" />
          </button>
        </div>
      )}

      {/* Main Prompt Bar */}
      {isExpanded && (
        <div 
          className="
            w-full rounded-xl bg-gray-800/60 backdrop-blur-xl p-3
            border border-white/10 click-active
            pointer-events-auto
          "
          style={{ transitionProperty: 'background-color, opacity, transform', transitionDuration: '300ms' } as any}
        >
        {/* Header with drag handle and close button */}
        <div 
          className="flex items-center justify-between mb-2 cursor-move drag-handle"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          <div className="text-xs text-white/60 select-none">
            {isConnected ? 'Live Mode On' : 'Private Mode On'}
          </div>
          <button
            onClick={toggleExpanded}
            className="
              p-1 rounded-lg hover:bg-white/10 transition-colors
              click-active
            "
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title="Collapse (ESC)"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        {/* Input Area */}
        <div className="flex items-center space-x-3 click-active">
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
          
          {/* Textarea Input */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isReady ? "Ask anything..." : "Initializing..."}
            disabled={!isReady}
            className="
              flex-1 text-sm bg-white/5 text-white placeholder-white/50 
              resize-none min-h-[24px] py-2 px-3 rounded-lg 
              border border-white/10 focus:border-teal-400/50 
              focus:outline-none transition-colors click-active
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            rows={1}
            style={{ outline: 'none', boxShadow: 'none' }}
          />
          
          {/* Send Button */}
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
            <Send className="w-3 h-3" />
          </button>
        </div>
        
        {/* Bottom Status Bar */}
        <div className="flex items-center justify-center mt-2 text-xs text-white/60 space-x-3">
          <div className="text-center">
            Thinkdrop can make mistakes. Check important info.
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
