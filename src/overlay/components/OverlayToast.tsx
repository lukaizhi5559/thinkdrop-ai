import { useEffect, useState } from 'react';
import { X, Eye } from 'lucide-react';
import '../types/electronAPI'; // Import type definitions
import '../index.css'; // Import Tailwind styles

interface ToastData {
  message: string;
  persistent?: boolean;
  duration?: number;
}

/**
 * Combined overlay for:
 * 1. Persistent AI viewing indicator (always visible at bottom)
 * 2. Temporary hotkey toast messages (above indicator)
 */
export function OverlayToast() {
  // AI Viewing Indicator state
  const [activeWindow, setActiveWindow] = useState<string | null>(null);
  const [activeApp, setActiveApp] = useState<string | null>(null);
  const [indicatorVisible, setIndicatorVisible] = useState(false);
  
  // Hotkey Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastPersistent, setToastPersistent] = useState(true);

  useEffect(() => {
    console.log('🔧 [OVERLAY] Component mounted, setting up listeners...');
    
    // Listen for active window updates (AI viewing indicator)
    const handleActiveWindowUpdate = (_: any, data: { windowName: string; app: string }) => {
      console.log('👁️  [AI VIEWING] Active window updated:', data);
      setActiveWindow(data.windowName);
      setActiveApp(data.app)
      console.log('THE ACTIVE WINDOW:', data);
      setIndicatorVisible(true);
    };
    
    // Listen for hotkey toast messages
    const handleHotkeyToast = (_: any, data: string | ToastData) => {
      console.log('🍞 [OVERLAY TOAST] Received:', data);
      
      // Check if already dismissed (for persistent toasts)
      const STORAGE_KEY = 'hotkey-toast-dismissed';
      
      if (typeof data === 'string') {
        // Legacy string format
        if (localStorage.getItem(STORAGE_KEY) === 'true') {
          console.log('🍞 [OVERLAY TOAST] Already dismissed');
          return;
        }
        setToastMessage(data);
        setToastPersistent(true);
        setToastVisible(true);
      } else {
        // Object format with options
        const persistent = data.persistent !== false;
        if (persistent && localStorage.getItem(STORAGE_KEY) === 'true') {
          console.log('🍞 [OVERLAY TOAST] Already dismissed');
          return;
        }
        
        setToastMessage(data.message);
        setToastPersistent(persistent);
        setToastVisible(true);
        
        // Auto-hide for non-persistent toasts
        if (!persistent && data.duration) {
          setTimeout(() => {
            setToastVisible(false);
          }, data.duration);
        }
      }
    };

    // Set up IPC listeners
    if (window.electronAPI?.onActiveWindowUpdate) {
      window.electronAPI.onActiveWindowUpdate(handleActiveWindowUpdate);
      console.log('✅ [OVERLAY] Active window listener registered');
    } else {
      console.error('❌ [OVERLAY] electronAPI.onActiveWindowUpdate not available!');
    }
    
    if (window.electronAPI?.receive) {
      window.electronAPI.receive('show-hotkey-toast', handleHotkeyToast);
      console.log('✅ [OVERLAY] Toast listener registered');
    } else {
      console.error('❌ [OVERLAY] electronAPI.receive not available!');
    }
    
    console.log('🔧 [OVERLAY] All listeners set up, waiting for messages...');

    return () => {
      // Cleanup if needed
    };
  }, []);
  
  const handleCloseToast = () => {
    setToastVisible(false);
    if (toastPersistent) {
      localStorage.setItem('hotkey-toast-dismissed', 'true');
      console.log('🍞 [OVERLAY TOAST] Dismissed permanently');
    }
  };

  return (
    <div className="fixed toast bottom-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse gap-3 items-center" style={{ pointerEvents: 'none' }}>
      {/* AI Viewing Indicator (persistent, at bottom) */}
      {indicatorVisible && activeWindow && (
        <div
          className="
            flex items-center gap-2 px-4 py-2 rounded-full
            bg-blue-500/20 border border-blue-500/30
            backdrop-blur-md shadow-lg
            pointer-events-auto
          "
        >
          <Eye className="w-4 h-4 text-teal-400 animate-pulse" />
          <span className="text-xs font-medium text-white-400">
            AI Viewing: <span className="text-white-400">{activeWindow}</span>
          </span>
        </div>
      )}
      
      {/* Hotkey Toast (above indicator) */}
      {toastVisible && toastMessage && (
        <div
          className="
            flex items-center gap-3 px-6 py-4 rounded-xl border
            bg-gray-800/95 border-gray-700/50
            backdrop-blur-md shadow-2xl
            min-w-[300px] max-w-[600px]
            pointer-events-auto
            animate-in slide-in-from-bottom-2 duration-300
          "
        >
          <span 
            className="text-sm font-medium text-white/90 flex-1 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: toastMessage }}
          />
          <button
            onClick={handleCloseToast}
            className="
              text-white/50 hover:text-white/80 
              transition-colors 
              flex-shrink-0 ml-2
              hover:bg-white/10 rounded p-1
            "
            aria-label="Close notification"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
