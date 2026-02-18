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
import ResultsWindow from './components/ResultsWindow';
import StandalonePromptCapture from './components/StandalonePromptCapture';
import { useConversationSignals } from './hooks/useConversationSignals';
import { initializeConversationSignals } from './signals/init';
import AutomationTester from './components/testing/AutomationTester';
import { overlayPayloadSignal } from './signals/overlaySignals';

// Lazy load ChatWindow to prevent dependency issues in other windows
const ChatWindow = lazy(() => import('./components/ChatWindow'));

// Electron IPC
const ipcRenderer = (window as any).electron?.ipcRenderer;

function App() {
  const [isReady, setIsReady] = useState(false);
  const [isOnlineMode, setIsOnlineMode] = useState(false);
  const [showTester, setShowTester] = useState(false);
  
  // Request deduplication
  const lastSubmittedPrompt = useRef<{ text: string; timestamp: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Log when online mode changes
  useEffect(() => {
    console.log(`🌐 [OVERLAY] isOnlineMode state changed to: ${isOnlineMode}`);
  }, [isOnlineMode]);

  // Sync Online Mode (Live Mode) from main process so ghost/prompt-capture submissions use correct flag
  useEffect(() => {
    if (!ipcRenderer) return;

    const init = async () => {
      try {
        const result = await ipcRenderer.invoke('online-mode:get');
        console.log('🌐 [OVERLAY] online-mode:get result:', result);
        if (result && typeof result.enabled === 'boolean') {
          setIsOnlineMode(result.enabled);
        }
      } catch (e) {
        console.warn('⚠️ [OVERLAY] online-mode:get failed:', e);
        // Ignore - fallback to local state
      }
    };

    const handleOnlineModeChanged = (_event: any, enabled: boolean) => {
      console.log('🌐 [OVERLAY] online-mode:changed received:', enabled);
      setIsOnlineMode(!!enabled);
    };

    init();
    ipcRenderer.on('online-mode:changed', handleOnlineModeChanged);
    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('online-mode:changed', handleOnlineModeChanged);
      }
    };
  }, []);

  // Get active session ID for conversation continuity
  // const { signals, createSession } = useConversationSignals();
  
  // Detect which window mode we're in
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode'); // 'prompt', 'intent', 'chat', 'results', 'promptcapture', or null (ghost)
  const isPromptMode = mode === 'prompt';
  const isIntentMode = mode === 'intent';
  const isChatMode = mode === 'chat';
  const isResultsMode = mode === 'results';
  const isPromptCaptureMode = mode === 'promptcapture';

  // Listen for IPC event to open tester (triggered by Cmd+Shift+T global shortcut)
  useEffect(() => {
    console.log('🧪 [OVERLAY] Setting up automation tester listener, mode:', mode);
    console.log('🧪 [OVERLAY] ipcRenderer available:', !!ipcRenderer);
    
    if (!ipcRenderer) {
      console.warn('⚠️ [OVERLAY] IPC renderer not available for tester');
      return;
    }

    const handleShowTester = () => {
      console.log('🧪 [OVERLAY] Received show-automation-tester event!');
      setShowTester(true);
    };

    const handleCloseTester = () => {
      console.log('🧪 [OVERLAY] Closing Automation Tester');
      setShowTester(false);
    };

    console.log('🧪 [OVERLAY] Registering show-automation-tester listener');
    ipcRenderer.on('show-automation-tester', handleShowTester);
    window.addEventListener('close-automation-tester', handleCloseTester);

    return () => {
      console.log('🧪 [OVERLAY] Cleaning up tester listeners');
      ipcRenderer.removeListener('show-automation-tester', handleShowTester);
      window.removeEventListener('close-automation-tester', handleCloseTester);
    };
  }, [mode]);

  useEffect(() => {
    const modeLabel = isPromptMode ? 'PROMPT' : isIntentMode ? 'INTENT' : isChatMode ? 'CHAT' : isResultsMode ? 'RESULTS' : isPromptCaptureMode ? 'PROMPTCAPTURE' : 'GHOST';
    console.log(`🚀 [OVERLAY] App mounted in ${modeLabel} mode`);
    console.log(`🔍 [OVERLAY] Mode detection: isPromptMode=${isPromptMode}, isIntentMode=${isIntentMode}, isChatMode=${isChatMode}, isResultsMode=${isResultsMode}, isPromptCaptureMode=${isPromptCaptureMode}`);
    
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
    console.log(`✅ [OVERLAY] ${modeLabel} window ready, IPC available`);

    // Listen for overlay updates from main process
    // Use signal to avoid re-render issues
    const handleOverlayUpdate = (_event: any, payload: OverlayPayload) => {
      console.log('📨 [OVERLAY] Received overlay update:', payload);
      console.log('📨 [OVERLAY] Payload details:', {
        uiVariant: payload?.uiVariant,
        intent: payload?.intent,
        hasSlots: !!payload?.slots,
        slots: payload?.slots
      });
      overlayPayloadSignal.value = payload;
      console.log('✅ [OVERLAY] overlayPayload signal updated');
    };

    // Register overlay:update listener for all modes
    // Main process temporarily disables click-through for ghost mode when sending IPC
    const isGhostMode = !isPromptMode && !isIntentMode && !isChatMode && !isResultsMode && !isPromptCaptureMode;
    console.log(`🔍 [OVERLAY] Mode: ${isGhostMode ? 'ghost' : modeLabel}`);
    console.log('� [OVERLAY] Registering overlay:update listener...');
    
    ipcRenderer.on('overlay:update', handleOverlayUpdate);
    console.log('✅ [OVERLAY] overlay:update listener registered');
    
    // Cleanup function
    return () => {
      console.log('🧹 [OVERLAY] Cleanup - removing overlay:update listener');
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('overlay:update', handleOverlayUpdate);
      }
    };
  }, [isPromptMode, isIntentMode, isChatMode, isResultsMode, isPromptCaptureMode]);

  // Prompt capture submission is now handled via props passed to GhostOverlay

  // No hit testing needed - CSS pointer-events handles everything!

  const handlePromptSubmit = async (message: string) => {
    console.log('📤 [OVERLAY] Prompt submitted:', message);
    
    // Deduplication: Ignore duplicate submissions within 2 seconds
    const now = Date.now();
    if (lastSubmittedPrompt.current) {
      const timeSinceLastSubmit = now - lastSubmittedPrompt.current.timestamp;
      if (lastSubmittedPrompt.current.text === message && timeSinceLastSubmit < 2000) {
        console.warn('🔄 [OVERLAY] Duplicate prompt submission ignored (submitted', timeSinceLastSubmit, 'ms ago)');
        return;
      }
    }
    
    // Track this submission
    lastSubmittedPrompt.current = { text: message, timestamp: now };
    
    console.log('🚀 [OVERLAY] Routing to new Communication Agent + ResultsWindow flow');

    // Route to new Communication Agent + ResultsWindow flow
    if (ipcRenderer) {
      console.log('📤 [OVERLAY] Sending show-results-window IPC event:', message);
      ipcRenderer.send('show-results-window', { prompt: message });
      console.log('✅ [OVERLAY] IPC event sent - ResultsWindow will handle the rest');
    } else {
      console.error('❌ [OVERLAY] ipcRenderer not available!');
    }
  };

  // OLD AUTOMATION SYSTEM HANDLER (DISABLED)
  // const handlePromptSubmit_OLD = async (message: string) => {
  //   console.log('📤 [OVERLAY] Prompt submitted:', message);
  //   console.log('🌐 [OVERLAY] Online mode (isOnlineMode state):', isOnlineMode);

  //   // ResultsWindow now stays visible and shows loading state during query processing
  //   // No need to close it here - it will show "Thinking..." indicator

  //   // Read the latest online mode from main process to avoid stale state across windows
  //   let onlineModeForSubmit = isOnlineMode;
  //   if (ipcRenderer) {
  //     try {
  //       const result = await ipcRenderer.invoke('online-mode:get');
  //       if (result && typeof result.enabled === 'boolean') {
  //         onlineModeForSubmit = result.enabled;
  //       }
  //     } catch (e) {
  //       // Ignore - fall back to local state
  //     }
  //   }

  //   console.log('🌐 [OVERLAY] Online mode (resolved for submit):', onlineModeForSubmit);
  //   console.log('🌐 [OVERLAY] This will be passed as useOnlineMode to backend');
    
  //   if (ipcRenderer) {
  //     // Check if chat window is open - if so, use its active session
  //     // This prevents creating a new session when the user is already viewing a conversation
  //     const chatWindowState = await ipcRenderer.invoke('chat-window:get-state');
  //     const isChatOpen = chatWindowState?.isVisible;
      
  //     // 🔒 CRITICAL: Get the CURRENT active session from backend (source of truth)
  //     // Don't rely on signals which might be stale due to async updates
  //     let sessionId: string | null = null;
      
  //     try {
  //       console.log('🔍 [OVERLAY] Calling session.getActive...');
  //       const sessionResult = await (window as any).electronAPI.mcpCall({
  //         serviceName: 'conversation',
  //         action: 'session.getActive',
  //         payload: {}
  //       });
        
  //       console.log('📦 [OVERLAY] session.getActive response:', sessionResult);
        
  //       if (sessionResult.success && sessionResult.data?.data?.sessionId) {
  //         sessionId = sessionResult.data.data.sessionId;
  //         console.log('✅ [OVERLAY] Got active session from backend:', sessionId);
  //       } else {
  //         console.warn('⚠️  [OVERLAY] session.getActive returned no sessionId:', sessionResult);
  //       }
  //     } catch (error) {
  //       console.error('❌ [OVERLAY] Failed to get active session from backend:', error);
  //     }
      
  //     // Fallback to signals if backend call failed
  //     if (!sessionId) {
  //       sessionId = signals.activeSessionId.value;
  //       console.log('🔍 [OVERLAY] Using activeSessionId from signals (fallback):', sessionId);
  //     }
      
  //     console.log('� [OVERLAY] Chat window open:', isChatOpen);
      
  //     if (!sessionId) {
  //       console.log('🆕 [OVERLAY] No active session, creating new one');
  //       sessionId = await createSession('user-initiated', {
  //         title: 'New Chat'
  //       });
  //       console.log('✅ [OVERLAY] Created new session:', sessionId);
  //     }
      
  //     console.log('💬 [OVERLAY] Using session ID:', sessionId);
  //     console.log('📤 [OVERLAY] Sending message to session:', sessionId);
      
  //     // 🚀 CRITICAL: Add user message to backend FIRST so chat window can load it
  //     // This MUST complete before we start MCP processing to ensure conversation history includes the new message
  //     try {
  //       console.log('📝 [OVERLAY] Adding user message to backend via MCP...');
        
  //       const addResult = await (window as any).electronAPI.mcpCall({
  //         serviceName: 'conversation',
  //         action: 'message.add',
  //         payload: {
  //           sessionId: sessionId,
  //           text: message,
  //           sender: 'user',
  //           metadata: {
  //             isAutomationActive: false, // Will be overridden by context if automation is active
  //             clarificationMode: false
  //           }
  //         }
  //       });
        
  //       if (!addResult.success || !addResult.data?.success) {
  //         console.error('❌ [OVERLAY] Failed to add user message:', addResult.error || addResult.data?.error);
  //         return; // Don't proceed if message wasn't added
  //       }
        
  //       console.log('✅ [OVERLAY] User message added to backend:', addResult.data.data?.messageId);
        
  //       // Notify chat window to reload messages immediately
  //       if ((window as any).electron?.ipcRenderer) {
  //         console.log('📤 [OVERLAY] Notifying chat window to reload messages (user message added)');
  //         (window as any).electron.ipcRenderer.send('conversation:message-added', { sessionId: sessionId });
          
  //         // Notify chat window to show thinking indicator
  //         console.log('📤 [OVERLAY] Notifying chat window to show thinking indicator');
  //         (window as any).electron.ipcRenderer.send('conversation:processing-started', { sessionId: sessionId });
  //       }
  //     } catch (error) {
  //       console.error('❌ [OVERLAY] Failed to add message to backend:', error);
  //       return; // Don't proceed if there was an error
  //     }
      
  //     // Use private-mode handler with overlay mode enabled
  //     // The backend will handle sending the initial "Thinking..." and subsequent updates to the intent window
  //     // NOTE: Message has been added above, so retrieveMemory will fetch it correctly
  //     try {
  //       // Type guard: sessionId should never be null at this point
  //       if (!sessionId) {
  //         console.error('❌ [OVERLAY] sessionId is null, cannot set loading state');
  //         return;
  //       }
        
  //       // Set loading state in signal to show "Thinking..." indicator
  //       console.log('⏳ [OVERLAY] Setting overlay signal to loading state');
  //       overlayPayloadSignal.value = {
  //         intent: 'screen_intelligence',
  //         uiVariant: 'loading',
  //         slots: {},
  //         conversationId: sessionId,
  //         correlationId: `overlay_${Date.now()}`
  //       };
        
  //       console.log('🚀 [OVERLAY] Calling private-mode:process with context:', {
  //         overlayMode: true,
  //         conversationId: sessionId,
  //         sessionId: sessionId,
  //         useOnlineMode: onlineModeForSubmit
  //       });
        
  //       const result = await (window as any).electronAPI.invoke('private-mode:process', {
  //         message,
  //         context: {
  //           overlayMode: true,
  //           conversationId: sessionId, // For overlay payload
  //           sessionId: sessionId, // For StateGraph conversation storage
  //           correlationId: `overlay_${Date.now()}`,
  //           userId: 'default_user',
  //           timestamp: new Date().toISOString(),
  //           useOnlineMode: onlineModeForSubmit
  //         }
  //       });
  //       console.log('✅ [OVERLAY] Private mode processing complete:', result);
        
  //       // Set results state so PromptCaptureBox can send position to results window
  //       console.log('📊 [OVERLAY] Setting overlay signal to results state');
  //       overlayPayloadSignal.value = {
  //         intent: 'screen_intelligence',
  //         uiVariant: 'results',
  //         slots: result.data || {},
  //         conversationId: sessionId,
  //         correlationId: `overlay_${Date.now()}`
  //       };
        
  //       // Notify chat window that processing is complete
  //       if ((window as any).electron?.ipcRenderer) {
  //         console.log('📤 [OVERLAY] Notifying chat window that processing is complete');
  //         (window as any).electron.ipcRenderer.send('conversation:processing-complete', { sessionId: sessionId });
  //       }
        
  //       // Note: Chat window will be notified automatically by the backend's storeConversation node
  //       // when the AI response is actually stored (no delay needed!)
  //     } catch (error) {
  //       console.error('❌ [OVERLAY] Private mode processing error:', error);
        
  //       // Clear loading state on error
  //       console.log('🧹 [OVERLAY] Clearing loading state from overlay signal (error case)');
  //       overlayPayloadSignal.value = null;
        
  //       // Notify chat window that processing failed
  //       if ((window as any).electron?.ipcRenderer) {
  //         console.log('📤 [OVERLAY] Notifying chat window that processing failed');
  //         (window as any).electron.ipcRenderer.send('conversation:processing-complete', { sessionId });
  //       }
  //     }
  //   } else {
  //     console.error('❌ [OVERLAY] IPC not available');
  //   }
  // };

  const handleOverlayEvent = (eventName: string, data?: any) => {
    console.log('📤 [OVERLAY] Overlay event:', eventName, data);
    
    // Handle overlay:clear locally to clear signal
    if (eventName === 'overlay:clear') {
      console.log('🧹 [OVERLAY] Clearing overlay payload signal');
      overlayPayloadSignal.value = null;
      return;
    }
    
    // Forward other events to main process
    if (ipcRenderer) {
      ipcRenderer.send('overlay:event', { eventName, data });
    }
  };

  // Render different content based on window mode
  if (isPromptMode) {
    // PROMPT WINDOW: Prompt bar for user input (no tester here)
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-hidden flex items-end">
        <PromptBar 
          onSubmit={handlePromptSubmit}
          isReady={isReady}
          onConnectionChange={(newState) => {
            console.log(`📥 [OVERLAY] onConnectionChange callback received: ${newState}`);
            setIsOnlineMode(newState);
          }}
        />
      </div>
    );
  }

  if (isIntentMode) {
    // INTENT WINDOW: Interactive intent UIs (web search results, command guides, etc.)
    // Note: pointer-events are controlled by the component itself, not at the container level
    // This allows plan preview buttons to be clickable while automation is running
    
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-hidden flex items-end">
        {overlayPayloadSignal.value && (
          <OverlayRenderer 
            payload={overlayPayloadSignal.value} 
            onEvent={handleOverlayEvent}
          />
        )}
        {showTester && (
          <AutomationTester onClose={() => {
            setShowTester(false);
            // Hide the intent overlay window when tester closes
            if (ipcRenderer) {
              ipcRenderer.send('intent-overlay:hide');
            }
          }} />
        )}
      </div>
    );
  }

  if (isChatMode) {
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
        {showTester && (
          <AutomationTester onClose={() => setShowTester(false)} />
        )}
      </div>
    );
  }

  if (isResultsMode) {
    console.log('🎯 [OVERLAY] Rendering ResultsWindow in results mode');
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-hidden">
        <ResultsWindow />
      </div>
    );
  }

  if (isPromptCaptureMode) {
    console.log('🎯 [OVERLAY] Rendering StandalonePromptCapture in promptcapture mode');
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-hidden">
        <StandalonePromptCapture />
      </div>
    );
  }

  // GHOST WINDOW: Full-screen overlay for ghost mouse & visual cues, click-through
  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-full overflow-hidden pointer-events-none"
    >
      <GhostOverlay 
        onPromptSubmit={handlePromptSubmit}
        overlayPayload={overlayPayloadSignal.value}
        onEvent={handleOverlayEvent}
      />
      {showTester && (
        <AutomationTester onClose={() => setShowTester(false)} />
      )}
    </div>
  );
}

export default App;
