/**
 * Results Window Component
 * 
 * Clean, modern results display styled like PromptCaptureBox
 * Shows AI response results in a scrollable, interactive window
 */

import { useEffect, useState, useRef } from 'react';
import { OverlayPayload } from '../../../types/overlay-intents';

const ipcRenderer = (window as any).electron?.ipcRenderer;

export default function ResultsWindow() {
  const [overlayPayload, setOverlayPayload] = useState<OverlayPayload | null>(null);
  const [promptText, setPromptText] = useState<string>('');
  const contentRef = useRef<HTMLDivElement>(null);

  // Listen for overlay updates
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleOverlayUpdate = (_event: any, payload: OverlayPayload) => {
      console.log('📨 [RESULTS_WINDOW] Received overlay update:', payload);
      setOverlayPayload(payload);
    };

    const handlePromptText = (_event: any, text: string) => {
      console.log('📝 [RESULTS_WINDOW] Received prompt text:', text);
      setPromptText(text);
    };

    ipcRenderer.on('overlay:update', handleOverlayUpdate);
    ipcRenderer.on('results-window:set-prompt', handlePromptText);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('overlay:update', handleOverlayUpdate);
        ipcRenderer.removeListener('results-window:set-prompt', handlePromptText);
      }
    };
  }, []);

  // Dynamically resize window based on content
  useEffect(() => {
    if (!contentRef.current || !ipcRenderer) return;

    const resizeWindow = () => {
      const headerHeight = 52; // Header height (py-3 + border)
      const padding = 32; // Content padding (p-4 * 2)
      const minHeight = 100; // Minimal height when empty
      const maxHeight = 600;
      
      // Calculate width based on prompt text length (match PromptCaptureBox logic)
      const minWidth = 400;
      const maxWidth = 600;
      const estimatedWidth = Math.min(Math.max(promptText.length * 8, minWidth), maxWidth);
      
      // Use minimal height during loading state (just showing "Thinking..." indicator)
      let totalHeight;
      if (overlayPayload?.uiVariant === 'loading') {
        totalHeight = minHeight; // Minimal height for loading indicator
      } else {
        const contentHeight = contentRef.current?.scrollHeight || 0;
        totalHeight = Math.min(Math.max(contentHeight + headerHeight + padding, minHeight), maxHeight);
      }
      
      console.log('📏 [RESULTS_WINDOW] Resizing to:', { width: estimatedWidth, height: totalHeight, state: overlayPayload?.uiVariant });
      ipcRenderer.send('results-window:resize', { width: estimatedWidth, height: totalHeight });
    };

    // Resize after content updates
    const timeoutId = setTimeout(resizeWindow, 100);
    
    return () => clearTimeout(timeoutId);
  }, [overlayPayload, promptText]);

  // ESC key to close results window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('⌨️  [RESULTS_WINDOW] ESC pressed - closing results window');
        if (ipcRenderer) {
          ipcRenderer.send('results-window:close');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClose = () => {
    console.log('❌ [RESULTS_WINDOW] Close button clicked');
    if (ipcRenderer) {
      ipcRenderer.send('results-window:close');
    }
  };

  // Render results based on intent
  const renderResults = () => {
    if (!overlayPayload) {
      return (
        <div className="text-gray-400 text-sm text-center">
          Waiting for results...
        </div>
      );
    }
    
    // Show thinking indicator during loading state
    if (overlayPayload.uiVariant === 'loading') {
      return (
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-gray-400 text-sm">Thinking...</span>
        </div>
      );
    }
    
    const { slots, intent } = overlayPayload;

    if (intent === 'screen_intelligence' && slots?.answer) {
      return (
        <div className="prose prose-invert max-w-none">
          <div className="text-white text-sm leading-relaxed whitespace-pre-wrap">
            {slots.answer}
          </div>
        </div>
      );
    }

    if (intent === 'question' && slots?.answer) {
      return (
        <div className="prose prose-invert max-w-none">
          <div className="text-white text-sm leading-relaxed whitespace-pre-wrap">
            {slots.answer}
          </div>
        </div>
      );
    }

    if (intent === 'web_search' && slots?.answer) {
      return (
        <div className="prose prose-invert max-w-none">
          <div className="text-white text-sm leading-relaxed whitespace-pre-wrap">
            {slots.answer}
          </div>
        </div>
      );
    }

    // Fallback for other intents
    return (
      <div className="text-gray-300 text-sm">
        <pre className="whitespace-pre-wrap">
          {JSON.stringify(slots, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div 
      className="w-full h-full flex flex-col"
      style={{
        backgroundColor: 'rgba(23, 23, 23, 0.95)',
      }}
    >
      {/* Fixed header with prompt text and close button */}
      <div 
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{
          borderColor: 'rgba(255, 255, 255, 0.1)',
          flexShrink: 0,
        }}
      >
        <div 
          className="text-sm font-medium truncate flex-1 mr-2"
          style={{ color: '#e5e7eb' }}
          title={promptText}
        >
          {promptText || 'Results'}
        </div>
        <button
          onClick={handleClose}
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-700 transition-colors flex-shrink-0"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#9ca3af',
            fontSize: '14px',
            cursor: 'pointer',
          }}
          title="Close (ESC)"
        >
          ×
        </button>
      </div>
      
      {/* Scrollable content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4">
        {renderResults()}
      </div>
    </div>
  );
}
