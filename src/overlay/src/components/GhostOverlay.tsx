/**
 * Ghost Overlay Component
 * 
 * Renders in the ghost window (full-screen, click-through)
 * Displays:
 * - Ghost mouse cursor
 * - Border highlights around items
 * - Visual cues
 * - Loading animations
 */

import { useState, useEffect } from 'react';
import { sendGhostHoverData } from '../utils/overlayPosition';
import { AlertCircle, X } from 'lucide-react';
import { OverlayPayload } from '../../../types/overlay-intents';
import PromptCaptureBox from './PromptCaptureBox';

interface HighlightedItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'text' | 'image' | 'button' | 'element';
  content?: string;
}

interface BannerNotification {
  id: string;
  feature: string;
  message: string;
}

const ipcRenderer = (window as any).electron?.ipcRenderer;

interface GhostOverlayProps {
  onPromptSubmit?: (text: string) => void;
  overlayPayload?: OverlayPayload | null;
  onEvent?: (event: any) => void;
}

export default function GhostOverlay({ onPromptSubmit, overlayPayload, onEvent }: GhostOverlayProps) {
  console.log('🎭 [GHOST_OVERLAY] Component rendering');
  
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [targetPos, setTargetPos] = useState({ x: 0, y: 0 });
  const [isAutomating, setIsAutomating] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [highlightedItems] = useState<HighlightedItem[]>([]); // For future use
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerNotification | null>(null);
  
  // Debug logging for overlayPayload changes
  useEffect(() => {
    console.log('🔄 [GHOST] overlayPayload changed:', overlayPayload ? {
      uiVariant: overlayPayload.uiVariant,
      intent: overlayPayload.intent,
      hasSlots: !!overlayPayload.slots
    } : 'null');
  }, [overlayPayload]);
  
  const [promptCaptureActive, setPromptCaptureActive] = useState(false);
  const [promptCaptureText, setPromptCaptureText] = useState('');
  const [initialPromptText, setInitialPromptText] = useState('');
  const [promptCaptureCursor, setPromptCaptureCursor] = useState({ x: 0, y: 0 });
  const [promptCaptureSelection, setPromptCaptureSelection] = useState({ start: 0, end: 0 });

  // Log component mount
  useEffect(() => {
    console.log('🎨 [GHOST] GhostOverlay component mounted!');
    return () => console.log('👋 [GHOST] GhostOverlay component unmounted');
  }, []);

  // Listen for prompt capture cancellation via native IPC
  useEffect(() => {
    if (!ipcRenderer) return;
    
    const handleCancellation = () => {
      console.log('🚫 [GHOST] Received prompt capture cancellation via IPC');
      
      // Deactivate prompt capture
      setPromptCaptureActive(false);
      setPromptCaptureText('');
      setInitialPromptText('');
      setPromptCaptureSelection({ start: 0, end: 0 });
      
      // Always clear overlay payload to hide prompt capture box
      if (onEvent) {
        console.log('🧹 [GHOST] Clearing overlay payload via onEvent');
        onEvent('overlay:clear');
      }
      
      // Re-enable click-through
      ipcRenderer.send('ghost-overlay:set-clickthrough', true);
    };
    
    ipcRenderer.on('prompt-capture-cancelled', handleCancellation);
    console.log('✅ [GHOST] Registered prompt-capture-cancelled listener');
    
    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('prompt-capture-cancelled', handleCancellation);
      }
    };
  }, [onEvent]);

  // Log when overlayPayload changes
  useEffect(() => {
    if (overlayPayload) {
      console.log('📦 [GHOST] Received overlayPayload:', {
        intent: overlayPayload.intent,
        uiVariant: overlayPayload.uiVariant,
        hasSlots: !!overlayPayload.slots
      });
    } else {
      console.log('📦 [GHOST] overlayPayload is null/undefined');
    }
  }, [overlayPayload]);

  // Listen for IPC command to move ghost mouse to specific coordinates (for testing)
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleMoveTo = (_event: any, { x, y }: { x: number; y: number }) => {
      console.log(`👻 [GHOST] Moving to (${x}, ${y})`);
      setTargetPos({ x, y });
      setMousePos({ x, y });
      setIsAutomating(true);
      
      // Reset automation state after a moment
      setTimeout(() => setIsAutomating(false), 1000);
    };

    ipcRenderer.on('ghost:move-to', handleMoveTo);

    return () => {
      ipcRenderer.removeListener('ghost:move-to', handleMoveTo);
    };
  }, []);

  // Smooth animation to target position during automation
  useEffect(() => {
    if (!isAutomating) return;

    const animate = () => {
      setMousePos((prev) => {
        const dx = targetPos.x - prev.x;
        const dy = targetPos.y - prev.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 1) return targetPos;

        // Smooth easing
        const speed = 0.15;
        return {
          x: prev.x + dx * speed,
          y: prev.y + dy * speed,
        };
      });
    };

    const interval = setInterval(animate, 16); // 60fps
    return () => clearInterval(interval);
  }, [isAutomating, targetPos]);

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isAutomating) {
        setMousePos({ x: e.clientX, y: e.clientY });
        setTargetPos({ x: e.clientX, y: e.clientY });
      }
      
      // Update prompt capture cursor position in real-time
      if (promptCaptureActive) {
        setPromptCaptureCursor({ x: e.clientX, y: e.clientY });
      }
      
      // Check if hovering over any highlighted item
      const item = highlightedItems.find(
        (item) =>
          e.clientX >= item.x &&
          e.clientX <= item.x + item.width &&
          e.clientY >= item.y &&
          e.clientY <= item.y + item.height
      );

      if (item && hoveredItem !== item.id) {
        setHoveredItem(item.id);
        // Send hover data to intent window
        sendGhostHoverData({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          type: item.type,
          content: item.content,
        });
      } else if (!item && hoveredItem) {
        setHoveredItem(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [highlightedItems, hoveredItem, promptCaptureActive]);

  // Listen for automation events
  useEffect(() => {
    console.log('🔧 [GHOST] Setting up IPC listeners, ipcRenderer available:', !!ipcRenderer);
    if (!ipcRenderer) {
      console.error('❌ [GHOST] IPC renderer not available!');
      return;
    }

    const handleAutomationStart = () => {
      console.log('🤖 [GHOST] ===== AUTOMATION STARTED =====');
      setIsAutomating(true);
    };

    const handleAutomationEnd = () => {
      console.log('✅ [GHOST] ===== AUTOMATION ENDED =====');
      setIsAutomating(false);
    };

    const handleMouseMove = (_event: any, data: { x: number; y: number }) => {
      console.log(`👻 [GHOST] Mouse move to: (${data.x}, ${data.y})`);
      setTargetPos({ x: data.x, y: data.y });
    };

    const handleMouseClick = (_event: any, data: { x: number; y: number }) => {
      console.log(`🖱️  [GHOST] Mouse CLICK at: (${data.x}, ${data.y})`);
      setTargetPos({ x: data.x, y: data.y });
      setIsClicking(true);
      setTimeout(() => setIsClicking(false), 300);
    };

    ipcRenderer.on('automation:started', handleAutomationStart);
    ipcRenderer.on('automation:ended', handleAutomationEnd);
    ipcRenderer.on('ghost:mouse-move', handleMouseMove);
    ipcRenderer.on('ghost:mouse-click', handleMouseClick);
    
    console.log('✅ [GHOST] IPC listeners registered successfully');

    return () => {
      console.log('🧹 [GHOST] Cleaning up IPC listeners');
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('automation:started', handleAutomationStart);
        ipcRenderer.removeListener('automation:ended', handleAutomationEnd);
        ipcRenderer.removeListener('ghost:mouse-move', handleMouseMove);
        ipcRenderer.removeListener('ghost:mouse-click', handleMouseClick);
      }
    };
  }, []);

  // Listen for private mode error notifications
  useEffect(() => {
    if (!ipcRenderer) return;

    const handlePrivateModeError = (_event: any, data: { feature: string; query: string }) => {
      setBanner({
        id: `banner-${Date.now()}`,
        feature: data.feature,
        message: `${data.feature} requires Live Mode to be enabled. Toggle Live Mode in the prompt bar below.`
      });
      
      // Disable click-through when banner is shown
      ipcRenderer.send('ghost-overlay:set-clickthrough', false);
    };

    ipcRenderer.on('overlay:private-mode-error', handlePrivateModeError);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('overlay:private-mode-error', handlePrivateModeError);
      }
    };
  }, []);

  // Listen for prompt capture events
  useEffect(() => {
    if (!ipcRenderer) return;

    const handlePromptCaptureStarted = (_event: any, data: { initialText: string; cursorPosition: { x: number; y: number } }) => {
      console.log('📝 [GHOST] Prompt capture started', data);
      setPromptCaptureActive(true);
      setPromptCaptureText(data.initialText || '');
      setInitialPromptText(data.initialText || ''); // Store initial captured text separately
      setPromptCaptureCursor(data.cursorPosition);
      
      // Disable click-through during prompt capture
      ipcRenderer.send('ghost-overlay:set-clickthrough', false);
    };

    const handlePromptCaptureUpdate = (_event: any, data: { text: string; selectionStart?: number; selectionEnd?: number }) => {
      console.log('📝 [GHOST] Prompt capture update', data.text.substring(0, 50));
      setPromptCaptureText(data.text);
      if (data.selectionStart !== undefined && data.selectionEnd !== undefined) {
        setPromptCaptureSelection({ start: data.selectionStart, end: data.selectionEnd });
      }
    };

    const handlePromptCaptureSubmit = (_event: any, data: { text: string }) => {
      console.log('✅ [GHOST] Prompt capture submit', data.text.substring(0, 50));
      
      // Call the prop function to submit the query
      if (onPromptSubmit) {
        console.log('📤 [GHOST] Calling onPromptSubmit prop with text:', data.text.substring(0, 50));
        onPromptSubmit(data.text);
      } else {
        console.warn('⚠️  [GHOST] onPromptSubmit prop not provided!');
      }
      
      // After submission, reset to fresh state but keep active
      // This allows user to immediately type a new query while results are showing
      console.log('🔄 [GHOST] Resetting prompt capture to fresh state (keeping active)');
      setPromptCaptureText('');
      setInitialPromptText('');
      setPromptCaptureSelection({ start: 0, end: 0 });
      // Keep promptCaptureActive true so box stays visible and editable
      // Keep click-through disabled so user can type new queries
    };

    const handlePromptCaptureCancelled = () => {
      console.log('❌ [GHOST] Prompt capture cancelled');
      setPromptCaptureActive(false);
      setPromptCaptureText('');
      setInitialPromptText(''); // Clear initial text
      setPromptCaptureSelection({ start: 0, end: 0 });
      
      // Always clear overlay payload to hide prompt capture box
      if (onEvent) {
        console.log('🧹 [GHOST] Clearing overlay payload via onEvent');
        onEvent('overlay:clear');
      }
      
      // Re-enable click-through
      ipcRenderer.send('ghost-overlay:set-clickthrough', true);
    };

    ipcRenderer.on('prompt-capture-started', handlePromptCaptureStarted);
    ipcRenderer.on('prompt-capture-update', handlePromptCaptureUpdate);
    ipcRenderer.on('prompt-capture-submit', handlePromptCaptureSubmit);
    ipcRenderer.on('prompt-capture-cancelled', handlePromptCaptureCancelled);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('prompt-capture-started', handlePromptCaptureStarted);
        ipcRenderer.removeListener('prompt-capture-update', handlePromptCaptureUpdate);
        ipcRenderer.removeListener('prompt-capture-submit', handlePromptCaptureSubmit);
        ipcRenderer.removeListener('prompt-capture-cancelled', handlePromptCaptureCancelled);
      }
    };
  }, [onPromptSubmit, onEvent]);

  // Listen for ESC key to close/dismiss the prompt capture box
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && promptCaptureActive) {
        console.log('⌨️  [GHOST] ESC pressed - closing prompt capture box');
        setPromptCaptureActive(false);
        setPromptCaptureText('');
        setInitialPromptText('');
        setPromptCaptureSelection({ start: 0, end: 0 });
        
        // Clear overlay payload via onEvent to trigger click-through re-enable
        if (onEvent) {
          onEvent('overlay:clear');
        }
        
        // Re-enable click-through
        if (ipcRenderer) {
          ipcRenderer.send('ghost-overlay:set-clickthrough', true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [promptCaptureActive, onEvent]);

  const handleCloseBanner = () => {
    console.log('[GhostOverlay] Close banner clicked');
    setBanner(null);
    
    // Re-enable click-through when banner is closed
    if (ipcRenderer) {
      ipcRenderer.send('ghost-overlay:set-clickthrough', true);
    }
  };

  const handleEnableLiveMode = () => {
    console.log('[GhostOverlay] Enable live mode clicked');
    // Close the banner
    setBanner(null);
    
    // Re-enable click-through when banner is closed
    if (ipcRenderer) {
      ipcRenderer.send('ghost-overlay:set-clickthrough', true);
      
      // Emit event to prompt bar to toggle connection
      console.log('[GhostOverlay] Sending banner:enable-live-mode IPC event');
      ipcRenderer.send('banner:enable-live-mode');
    }
  };

  return (
    <div className="w-full h-full pointer-events-none">
      {/* Prompt Capture Box - now shows thinking state and results inline */}
      <PromptCaptureBox
        text={promptCaptureText}
        cursorPosition={promptCaptureCursor}
        isActive={promptCaptureActive}
        initialText={initialPromptText}
        selectionStart={promptCaptureSelection.start}
        selectionEnd={promptCaptureSelection.end}
      />

      {/* Banner Notification */}
      {banner && (
        <div 
          className="fixed top-0 left-0 right-0 z-50 flex justify-center p-4 pointer-events-auto animate-in slide-in-from-top duration-300"
          style={{ zIndex: 9999 }}
        >
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
                  {banner.feature} Requires Live Mode
                </h3>
                <p className="text-sm" style={{ color: '#ffffff' }}>
                  {banner.message}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleEnableLiveMode}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg cursor-pointer"
                  style={{
                    backgroundColor: '#ffffff',
                    color: '#ea580c',
                    pointerEvents: 'auto',
                  }}
                >
                  Enable Live Mode
                </button>
                <button
                  onClick={handleCloseBanner}
                  className="p-2 rounded-lg transition-colors hover:bg-white/20 cursor-pointer"
                  style={{
                    pointerEvents: 'auto',
                  }}
                >
                  <X className="w-5 h-5" style={{ color: '#ffffff' }} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Animated Ghost Mouse Cursor - Always visible for visual cue and coordinate tracking */}
      {mousePos.x > 0 && mousePos.y > 0 && (
        <div
          className="fixed pointer-events-none transition-all duration-100"
          style={{
            left: mousePos.x,
            top: mousePos.y,
            zIndex: 10000,
          }}
        >
          {/* Mouse Pointer SVG */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`drop-shadow-lg transition-transform ${isClicking ? 'scale-90' : 'scale-100'}`}
          >
            {/* Pointer shape */}
            <path
              d="M5 3L19 12L12 13L9 20L5 3Z"
              fill="#3B82F6"
              stroke="#1E40AF"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            {/* Inner highlight */}
            <path
              d="M7 6L16 12.5L12 13.5L10 17L7 6Z"
              fill="#60A5FA"
              opacity="0.6"
            />
          </svg>

          {/* Ripple effect on click */}
          {isClicking && (
            <div className="absolute top-0 left-0 w-12 h-12 -translate-x-1/2 -translate-y-1/2">
              <div className="absolute inset-0 bg-blue-500/30 rounded-full animate-ping" />
              <div className="absolute inset-0 bg-blue-400/20 rounded-full animate-pulse" />
            </div>
          )}

          {/* Glow trail effect */}
          <div className="absolute top-0 left-0 w-8 h-8 -translate-x-1/2 -translate-y-1/2 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
        </div>
      )}

      {/* Highlighted items borders */}
      {highlightedItems.map((item) => (
        <div
          key={item.id}
          className={`fixed border-2 rounded-lg transition-all duration-200 pointer-events-none ${
            hoveredItem === item.id
              ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/50'
              : 'border-blue-400/50 bg-blue-400/5'
          }`}
          style={{
            left: item.x,
            top: item.y,
            width: item.width,
            height: item.height,
          }}
        >
          {/* Label */}
          {hoveredItem === item.id && item.content && (
            <div className="absolute -top-6 left-0 px-2 py-1 bg-blue-600 text-white text-xs rounded shadow-lg whitespace-nowrap">
              {item.content}
            </div>
          )}
        </div>
      ))}

      {/* Loading pulse animation (example) */}
      {/* <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="w-16 h-16 bg-blue-500/30 rounded-full animate-pulse" />
      </div> */}
    </div>
  );
}
