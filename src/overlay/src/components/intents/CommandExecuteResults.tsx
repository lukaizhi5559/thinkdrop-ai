/**
 * Command Execute Results Component
 * 
 * Displays command execution results with shell output and metadata
 * Shows command interpretation method (pattern/embedding) and execution time
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { Terminal, X, Clock, Zap, CheckCircle, Code, AlertCircle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

const ipcRenderer = (window as any).electron?.ipcRenderer;

interface CommandExecuteResultsProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function CommandExecuteResults({ payload, onEvent: _onEvent }: CommandExecuteResultsProps) {
  const { slots } = payload;
  const [isVisible, setIsVisible] = useState(true);
  const [showBanner, setShowBanner] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  // Check for error state (private mode blocking or execution error)
  const hasError = slots.error || slots.errorMessage;
  const errorType = slots.error;

  // Get data from slots
  const originalCommand = slots.originalCommand || slots.query || slots.command || 'Command';
  const shellCommand = slots.shellCommand || slots.executedCommand || '';
  const output = slots.output || slots.result || '';
  const success = slots.success !== false; // Default to true if not specified
  const method = slots.method || 'unknown'; // 'pattern' or 'embedding'
  const confidence = slots.confidence || 0;
  const executionTime = slots.executionTime || slots.latencyMs || 0;
  const category = slots.category || 'general';
  const timestamp = slots.timestamp || new Date().toISOString();

  // Format execution time for human readability
  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Get method display info
  const getMethodInfo = (method: string) => {
    switch (method.toLowerCase()) {
      case 'pattern':
        return { 
          name: 'Pattern Match', 
          color: 'bg-green-500/20 text-green-300 border-green-500/30',
          icon: Zap
        };
      case 'embedding':
        return { 
          name: 'Semantic Match', 
          color: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
          icon: Code
        };
      default:
        return { 
          name: 'Unknown', 
          color: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
          icon: Terminal
        };
    }
  };

  const methodInfo = getMethodInfo(method);
  const MethodIcon = methodInfo.icon;

  // Listen for visibility toggle from PromptBar
  useEffect(() => {
    const electronAPI = (window as any).electron;
    if (!electronAPI?.ipcRenderer) return;

    const handleVisibilityToggle = (_event: any, visible: boolean) => {
      setIsVisible(visible);
    };

    electronAPI.ipcRenderer.on('command-execute:set-visibility', handleVisibilityToggle);
    return () => {
      if (electronAPI.ipcRenderer.removeListener) {
        electronAPI.ipcRenderer.removeListener('command-execute:set-visibility', handleVisibilityToggle);
      }
    };
  }, []);

  // Handle mouse events to make window click-through except over card
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const element = cardRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const isOverCard = 
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      const electronAPI = (window as any).electron;
      if (electronAPI?.ipcRenderer) {
        electronAPI.ipcRenderer.send('intent-window:set-ignore-mouse', !isOverCard);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Handle click outside to close modal
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const element = cardRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const isOutsideCard = 
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;

      if (isOutsideCard) {
        handleClose();
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Position window to match PromptBar centering (60% width, centered)
  useEffect(() => {
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) return;

    const timer = setTimeout(() => {
      const screenWidth = window.screen.availWidth;
      const screenHeight = window.screen.availHeight;
      
      // Match PromptBar sizing: 60% width, centered
      const cardWidth = Math.floor(screenWidth * 0.6);
      const cardHeight = Math.floor(screenHeight * 0.8); // 80% height
      const x = Math.floor((screenWidth - cardWidth) / 2);
      const y = Math.floor((screenHeight - cardHeight) / 2);
      
      ipcRenderer.send('overlay:position-intent', {
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        animate: false
      });
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    // Hide the intent window
    const electronAPI = (window as any).electron;
    if (electronAPI?.ipcRenderer) {
      // Hide the intent window by sending a generic hide command
      electronAPI.ipcRenderer.send('intent-window:hide');
    }
  };

  const handleEnableLiveMode = () => {
    if (ipcRenderer) {
      // Emit event that PromptBar will listen to
      ipcRenderer.send('banner:enable-live-mode');
    }
    // Dismiss banner and close window
    setShowBanner(false);
    setTimeout(() => handleClose(), 300); // Delay to allow animation
  };

  const handleDismissBanner = () => {
    // Just dismiss the banner and close window
    setShowBanner(false);
    setTimeout(() => handleClose(), 300); // Delay to allow animation
  };

  if (!isVisible) return null;

  // Show banner for private mode error
  if (hasError && errorType === 'private_mode_blocked' && showBanner) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex justify-center p-4 animate-in slide-in-from-top duration-300">
        <div 
          className="max-w-2xl w-full rounded-lg shadow-2xl"
          style={{
            background: 'linear-gradient(to right, #f97316, #f59e0b)',
            border: '2px solid #fb923c',
          }}
        >
          <div className="flex items-start gap-3 p-4">
            <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#ffffff' }} />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold mb-1" style={{ color: '#ffffff' }}>
                Command Execution Requires Live Mode
              </h3>
              <p className="text-sm" style={{ color: '#ffffff' }}>
                Command Execution requires Live Mode to be enabled. Toggle Live Mode in the prompt bar below.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleEnableLiveMode}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg cursor-pointer hover:bg-orange-50"
                style={{
                  backgroundColor: '#ffffff',
                  color: '#ea580c',
                }}
              >
                Enable Live Mode
              </button>
              <button
                onClick={handleDismissBanner}
                className="p-2 rounded-lg transition-colors hover:bg-white/20 cursor-pointer"
              >
                <X className="w-5 h-5" style={{ color: '#ffffff' }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render normal results
  return (
    <div 
      ref={cardRef}
      className="w-full h-full bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 flex flex-col 
        animate-in fade-in slide-in-from-top-4"
    >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${success ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              {success ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{originalCommand}</h3>
              <p className="text-xs text-white/50 font-mono">{shellCommand}</p>
            </div>
          </div>
          
          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 ml-3"
            title="Hide Command Results"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Output Content - Scrollable */}
        <div className="px-6 pb-4 flex-1 overflow-y-auto min-h-0">
          <div className="bg-black/40 rounded-lg p-4 border border-white/10">
            <pre className="text-sm text-white/80 font-mono leading-relaxed whitespace-pre-wrap overflow-x-auto">
              {output || '(no output)'}
            </pre>
          </div>
        </div>

        {/* Metadata Footer */}
        <div className="px-6 py-3 border-t border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 text-xs">
            {/* Method Badge */}
            <div className={`
              flex items-center gap-1.5 px-2 py-1 rounded-lg border
              ${methodInfo.color}
            `}>
              <MethodIcon className="w-3 h-3" />
              <span className="font-medium">{methodInfo.name}</span>
            </div>

            {/* Confidence (for embedding matches) */}
            {method === 'embedding' && confidence > 0 && (
              <div className="flex items-center gap-1.5 text-white/50">
                <span>{Math.round(confidence * 100)}% match</span>
              </div>
            )}

            {/* Execution Time */}
            <div className="flex items-center gap-1.5 text-white/50">
              <Clock className="w-3 h-3" />
              <span>{formatTime(executionTime)}</span>
            </div>

            {/* Category */}
            {category && category !== 'general' && (
              <div className="px-2 py-1 bg-white/5 rounded text-white/50">
                {category}
              </div>
            )}

            {/* Timestamp */}
            <div className="ml-auto text-white/40">
              {new Date(timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
    </div>
  );
}
