/**
 * Results Window Component
 * 
 * Clean, modern results display styled like PromptCaptureBox
 * Shows AI response results in a scrollable, interactive window
 */

import { useEffect, useState } from 'react';
import { OverlayPayload } from '../../../types/overlay-intents';

const ipcRenderer = (window as any).electron?.ipcRenderer;

export default function ResultsWindow() {
  const [overlayPayload, setOverlayPayload] = useState<OverlayPayload | null>(null);
  const [promptText, setPromptText] = useState<string>('');

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

  if (!overlayPayload) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-gray-400 text-sm">No results</div>
      </div>
    );
  }

  // Render results based on intent
  const renderResults = () => {
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
        {renderResults()}
      </div>
    </div>
  );
}
