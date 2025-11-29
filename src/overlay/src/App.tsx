/**
 * Overlay App Component
 * 
 * Main overlay container with:
 * - Transparent full-screen layer
 * - Bottom prompt bar
 * - Dynamic intent-driven UI components
 */

import { useEffect, useState, useRef } from 'react';
import { OverlayPayload } from '../../types/overlay-intents';
import PromptBar from './components/PromptBar';
import OverlayRenderer from './components/OverlayRenderer';

// Electron IPC
const ipcRenderer = (window as any).electron?.ipcRenderer;

function App() {
  const [overlayPayload, setOverlayPayload] = useState<OverlayPayload | null>(null);
  const [isReady, setIsReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('🚀 [OVERLAY] App mounted');
    
    if (!ipcRenderer) {
      console.warn('⚠️  [OVERLAY] IPC not available - running in browser mode');
      return;
    }

    // Signal ready to main process
    ipcRenderer.send('overlay:ready');
    setIsReady(true);
    console.log('✅ [OVERLAY] Overlay ready, IPC available');

    // Listen for overlay updates from main process
    const handleOverlayUpdate = (_event: any, payload: OverlayPayload) => {
      console.log('📨 [OVERLAY] Received overlay update:', payload);
      setOverlayPayload(payload);
    };

    ipcRenderer.on('overlay:update', handleOverlayUpdate);

    // Cleanup
    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('overlay:update', handleOverlayUpdate);
      }
    };
  }, []);

  // No hit testing needed - CSS pointer-events handles everything!

  const handlePromptSubmit = (message: string) => {
    console.log('📤 [OVERLAY] Prompt submitted:', message);
    // TODO: Send to main process for processing
    // For now, just log it
  };

  const handleOverlayEvent = (event: any) => {
    console.log('📤 [OVERLAY] Overlay event:', event);
    if (ipcRenderer) {
      ipcRenderer.send('overlay:event', event);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {/* Overlay content (intent-driven UI) - only shown when there's a payload */}
      {overlayPayload && (
        <div className="absolute inset-0">
          <OverlayRenderer 
            payload={overlayPayload} 
            onEvent={handleOverlayEvent}
          />
        </div>
      )}

      {/* Prompt bar - always visible, fills the small window */}
      <PromptBar 
        onSubmit={handlePromptSubmit}
        isReady={isReady}
      />
    </div>
  );
}

export default App;
