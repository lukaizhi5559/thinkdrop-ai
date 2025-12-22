/**
 * Overlay App Component
 * 
 * Main overlay container with:
 * - Transparent full-screen layer
 * - Bottom prompt bar
 * - Dynamic intent-driven UI components
 */

import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { OverlayPayload } from '../../types/overlay-intents';
import PromptBar from './components/PromptBar';
import OverlayRenderer from './components/OverlayRenderer';
import GhostOverlay from './components/GhostOverlay';
import { useConversationSignals } from './hooks/useConversationSignals';
import { initializeConversationSignals } from './signals/init';

// Lazy load ChatWindow to prevent dependency issues in other windows
const ChatWindow = lazy(() => import('./components/ChatWindow'));

// Electron IPC
const ipcRenderer = (window as any).electron?.ipcRenderer;

function App() {
  const [overlayPayload, setOverlayPayload] = useState<OverlayPayload | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isOnlineMode, setIsOnlineMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Get active session ID for conversation continuity
  const { signals, createSession } = useConversationSignals();
  
  // Detect which window mode we're in
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode'); // 'prompt', 'intent', 'chat', or null (ghost)
  const isPromptMode = mode === 'prompt';
  const isIntentMode = mode === 'intent';
  const isChatMode = mode === 'chat';

  useEffect(() => {
    const modeLabel = isPromptMode ? 'PROMPT' : isIntentMode ? 'INTENT' : isChatMode ? 'CHAT' : 'GHOST';
    console.log(`🚀 [OVERLAY] App mounted in ${modeLabel} mode`);
    
    // Initialize conversation signals to load sessions
    initializeConversationSignals().catch(err => {
      console.error('❌ [OVERLAY] Failed to initialize conversation signals:', err);
    });
    
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
    console.log('🌐 [OVERLAY] Online mode:', isOnlineMode);
    
    if (ipcRenderer) {
      // Check if chat window is open - if so, use its active session
      // This prevents creating a new session when the user is already viewing a conversation
      const chatWindowState = await ipcRenderer.invoke('chat-window:get-state');
      const isChatOpen = chatWindowState?.isVisible;
      
      // 🔒 CRITICAL: Get the CURRENT active session from backend (source of truth)
      // Don't rely on signals which might be stale due to async updates
      let sessionId: string | null = null;
      
      try {
        console.log('🔍 [OVERLAY] Calling session.getActive...');
        const sessionResult = await (window as any).electronAPI.mcpCall({
          serviceName: 'conversation',
          action: 'session.getActive',
          payload: {}
        });
        
        console.log('📦 [OVERLAY] session.getActive response:', sessionResult);
        
        if (sessionResult.success && sessionResult.data?.data?.sessionId) {
          sessionId = sessionResult.data.data.sessionId;
          console.log('✅ [OVERLAY] Got active session from backend:', sessionId);
        } else {
          console.warn('⚠️  [OVERLAY] session.getActive returned no sessionId:', sessionResult);
        }
      } catch (error) {
        console.error('❌ [OVERLAY] Failed to get active session from backend:', error);
      }
      
      // Fallback to signals if backend call failed
      if (!sessionId) {
        sessionId = signals.activeSessionId.value;
        console.log('🔍 [OVERLAY] Using activeSessionId from signals (fallback):', sessionId);
      }
      
      console.log('� [OVERLAY] Chat window open:', isChatOpen);
      
      if (!sessionId) {
        console.log('🆕 [OVERLAY] No active session, creating new one');
        sessionId = await createSession('user-initiated', {
          title: 'New Chat'
        });
        console.log('✅ [OVERLAY] Created new session:', sessionId);
      }
      
      console.log('💬 [OVERLAY] Using session ID:', sessionId);
      console.log('📤 [OVERLAY] Sending message to session:', sessionId);
      
      // 🚀 CRITICAL: Add user message to backend FIRST so chat window can load it
      // This MUST complete before we start MCP processing to ensure conversation history includes the new message
      try {
        console.log('📝 [OVERLAY] Adding user message to backend via MCP...');
        
        const addResult = await (window as any).electronAPI.mcpCall({
          serviceName: 'conversation',
          action: 'message.add',
          payload: {
            sessionId: sessionId,
            text: message,
            sender: 'user',
            metadata: {}
          }
        });
        
        if (!addResult.success || !addResult.data?.success) {
          console.error('❌ [OVERLAY] Failed to add user message:', addResult.error || addResult.data?.error);
          return; // Don't proceed if message wasn't added
        }
        
        console.log('✅ [OVERLAY] User message added to backend:', addResult.data.data?.messageId);
        
        // Notify chat window to reload messages immediately
        if ((window as any).electron?.ipcRenderer) {
          console.log('📤 [OVERLAY] Notifying chat window to reload messages (user message added)');
          (window as any).electron.ipcRenderer.send('conversation:message-added', { sessionId: sessionId });
          
          // Notify chat window to show thinking indicator
          console.log('📤 [OVERLAY] Notifying chat window to show thinking indicator');
          (window as any).electron.ipcRenderer.send('conversation:processing-started', { sessionId: sessionId });
        }
      } catch (error) {
        console.error('❌ [OVERLAY] Failed to add message to backend:', error);
        return; // Don't proceed if there was an error
      }
      
      // Use private-mode handler with overlay mode enabled
      // The backend will handle sending the initial "Thinking..." and subsequent updates to the intent window
      // NOTE: Message has been added above, so retrieveMemory will fetch it correctly
      try {
        const result = await (window as any).electronAPI.invoke('private-mode:process', {
          message,
          context: {
            overlayMode: true,
            conversationId: sessionId, // For overlay payload
            sessionId: sessionId, // For StateGraph conversation storage
            correlationId: `overlay_${Date.now()}`,
            userId: 'default_user',
            timestamp: new Date().toISOString(),
            useOnlineMode: isOnlineMode
          }
        });
        console.log('✅ [OVERLAY] Private mode processing complete:', result);
        
        // Notify chat window that processing is complete
        if ((window as any).electron?.ipcRenderer) {
          console.log('📤 [OVERLAY] Notifying chat window that processing is complete');
          (window as any).electron.ipcRenderer.send('conversation:processing-complete', { sessionId: sessionId });
        }
        
        // Note: Chat window will be notified automatically by the backend's storeConversation node
        // when the AI response is actually stored (no delay needed!)
      } catch (error) {
        console.error('❌ [OVERLAY] Private mode processing error:', error);
        
        // Notify chat window that processing failed
        if ((window as any).electron?.ipcRenderer) {
          console.log('📤 [OVERLAY] Notifying chat window that processing failed');
          (window as any).electron.ipcRenderer.send('conversation:processing-complete', { sessionId });
        }
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
          onConnectionChange={setIsOnlineMode}
        />
      </div>
    );
  }

  if (isIntentMode) {
    // INTENT WINDOW: Interactive intent UIs (web search results, command guides, etc.)
    // Click-through enabled only for automation mode in Computer Use
    const isAutomationProgress = overlayPayload?.intent === 'command_automate' && 
                                  overlayPayload?.uiVariant === 'automation_progress' &&
                                  overlayPayload?.slots?.mode === 'computer-use-streaming';
    
    return (
      <div ref={containerRef} className={`relative w-full h-full overflow-hidden flex items-center ${isAutomationProgress ? 'pointer-events-none' : ''}`}>
        {overlayPayload && (
          <OverlayRenderer 
            payload={overlayPayload} 
            onEvent={handleOverlayEvent}
          />
        )}
      </div>
    );
  }

  if (isChatMode) {
    // CHAT WINDOW: Conversation history and management
    console.log('🎯 [OVERLAY] Rendering ChatWindow in chat mode');
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-hidden">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <div className="text-white">Loading chat...</div>
          </div>
        }>
          <ChatWindow />
        </Suspense>
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
