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
import GhostOverlay from './components/GhostOverlay';

// Electron IPC
const ipcRenderer = (window as any).electron?.ipcRenderer;

function App() {
  const [overlayPayload, setOverlayPayload] = useState<OverlayPayload | null>(null);
  const [isReady, setIsReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Detect which window mode we're in
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode'); // 'prompt', 'intent', or null (ghost)
  const isPromptMode = mode === 'prompt';
  const isIntentMode = mode === 'intent';

  useEffect(() => {
    const modeLabel = isPromptMode ? 'PROMPT' : isIntentMode ? 'INTENT' : 'GHOST';
    console.log(`🚀 [OVERLAY] App mounted in ${modeLabel} mode`);
    
    if (!ipcRenderer) {
      console.warn('⚠️  [OVERLAY] IPC not available - running in browser mode');
      return;
    }

    // Signal ready to main process
    ipcRenderer.send('overlay:ready');
    setIsReady(true);
    console.log(`✅ [OVERLAY] ${isPromptMode ? 'Prompt' : 'Ghost'} window ready, IPC available`);

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

  const handlePromptSubmit = async (message: string) => {
    console.log('📤 [OVERLAY] Prompt submitted:', message);
    
    if (ipcRenderer) {
      // Use private-mode handler with overlay mode enabled
      // The backend will handle sending the initial "Thinking..." and subsequent updates to the intent window
      try {
        const result = await (window as any).electronAPI.invoke('private-mode:process', {
          message,
          context: {
            overlayMode: true,
            conversationId: `overlay_${Date.now()}`,
            correlationId: `overlay_${Date.now()}`,
            userId: 'default_user',
            timestamp: new Date().toISOString(),
            useOnlineMode: false
          }
        });
        console.log('✅ [OVERLAY] Private mode processing complete:', result);
      } catch (error) {
        console.error('❌ [OVERLAY] Private mode processing error:', error);
      }
    } else {
      console.error('❌ [OVERLAY] IPC not available');
    }
  };

  const handleOverlayEvent = (event: any) => {
    console.log('📤 [OVERLAY] Overlay event:', event);
    if (ipcRenderer) {
      ipcRenderer.send('overlay:event', event);
    }
  };

  // Render different content based on window mode
  if (isPromptMode) {
    // PROMPT WINDOW: Prompt bar for user input
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-hidden flex items-end">
        <PromptBar 
          onSubmit={handlePromptSubmit}
          isReady={isReady}
        />
      </div>
    );
  }

  if (isIntentMode) {
    // INTENT WINDOW: Interactive intent UIs (web search results, command guides, etc.)
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-hidden">
        {overlayPayload && (
          <OverlayRenderer 
            payload={overlayPayload} 
            onEvent={handleOverlayEvent}
          />
        )}
      </div>
    );
  }

  // GHOST WINDOW: Full-screen overlay for ghost mouse & visual cues, click-through
  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-full overflow-hidden pointer-events-none"
    >
      <GhostOverlay />
    </div>
  );
}

export default App;
