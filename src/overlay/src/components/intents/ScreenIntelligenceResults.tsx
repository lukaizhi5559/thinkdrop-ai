/**
 * Screen Intelligence Results Component
 * 
 * Displays screen analysis results with extracted text and metadata
 * Shows provider used and latency information
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { Monitor, X, Clock, Sparkles, Lock, AlertCircle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface ScreenIntelligenceResultsProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function ScreenIntelligenceResults({ payload }: ScreenIntelligenceResultsProps) {
  const { slots } = payload;
  const [isVisible, setIsVisible] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  // Check for error state (private mode blocking)
  const hasError = slots.error || slots.errorMessage;
  const errorType = slots.error;

  // Get data from slots
  const query = slots.query || slots.subject || 'Screen Analysis';
  const analysis = slots.analysis || slots.answer || slots.text || '';
  const provider = slots.provider || 'unknown';
  const latencyMs = slots.latencyMs || slots.latency || 0;
  const timestamp = slots.timestamp || new Date().toISOString();

  // Format latency for human readability
  const formatLatency = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Get provider display name and color
  const getProviderInfo = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'claude':
        return { name: 'Claude', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
      case 'openai':
        return { name: 'OpenAI', color: 'bg-green-500/20 text-green-300 border-green-500/30' };
      case 'grok':
        return { name: 'Grok', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
      default:
        return { name: 'AI', color: 'bg-gray-500/20 text-gray-300 border-gray-500/30' };
    }
  };

  const providerInfo = getProviderInfo(provider);

  // Listen for visibility toggle from PromptBar
  useEffect(() => {
    const electronAPI = (window as any).electron;
    if (!electronAPI?.ipcRenderer) return;

    const handleVisibilityToggle = (_event: any, visible: boolean) => {
      setIsVisible(visible);
    };

    electronAPI.ipcRenderer.on('screen-intelligence:set-visibility', handleVisibilityToggle);
    return () => {
      if (electronAPI.ipcRenderer.removeListener) {
        electronAPI.ipcRenderer.removeListener('screen-intelligence:set-visibility', handleVisibilityToggle);
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

  // Position window on mount - 50% screen height, flush to top
  useEffect(() => {
    console.log('🚀 [ScreenIntelligenceResults] Component mounted, attempting to resize window...');
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      console.error('❌ [ScreenIntelligenceResults] IPC Renderer not available!');
      return;
    }
    console.log('✅ [ScreenIntelligenceResults] IPC Renderer available, scheduling resize...');

    // Wait a bit for window to be ready
    const timer = setTimeout(() => {
      // Get screen dimensions
      const screenWidth = window.screen.availWidth;
      const screenHeight = window.screen.availHeight;
      
      // Fixed window size: 60% width, 50% height
      const windowWidth = Math.floor(screenWidth * 0.6);
      const windowHeight = Math.floor(screenHeight * 0.5);
      
      // Calculate position - centered horizontally, at the very top vertically
      const centerX = Math.floor((screenWidth - windowWidth) / 2);
      const topY = 0; // Flush to top of screen
      
      console.log(`📏 [ScreenIntelligenceResults] Positioning window at (${centerX}, ${topY}) with size ${windowWidth}x${windowHeight}`);
      
      // Position and size window
      ipcRenderer.send('overlay:position-intent', {
        x: centerX,
        y: topY,
        width: windowWidth,
        height: windowHeight,
        animate: false // No animation on initial mount
      });
    }, 100); // Wait 100ms for window to be ready

    return () => clearTimeout(timer);
  }, []); // Only run on mount

  const handleClose = () => {
    // Send IPC to hide the window
    const electronAPI = (window as any).electron;
    if (electronAPI?.ipcRenderer) {
      electronAPI.ipcRenderer.send('screen-intelligence:toggle');
    }
  };

  if (!isVisible) return null;

  // Render error state for private mode blocking
  if (hasError) {
    return (
      <div className="fixed inset-0 pointer-events-none flex items-start justify-center pt-20 px-4">
        <div
          ref={cardRef}
          className="
            pointer-events-auto
            w-full max-w-2xl
            bg-gray-800/80
            backdrop-blur-xl
            border border-red-500/30
            rounded-xl
            shadow-2xl
            overflow-hidden
            animate-fade-in
          "
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-red-500/20">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-red-500/20 rounded-lg">
                {errorType === 'private_mode_blocked' ? (
                  <Lock className="w-4 h-4 text-red-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                )}
              </div>
              <div>
                <h3 className="text-white font-medium text-sm">Screen Intelligence Unavailable</h3>
                <p className="text-white/50 text-xs">{query}</p>
              </div>
            </div>
            
            {/* Close button */}
            <button
              onClick={() => setIsVisible(false)}
              className="
                p-1.5 rounded-lg
                hover:bg-white/10
                transition-colors
                text-white/60 hover:text-white
              "
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Error Content */}
          <div className="p-4">
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-white font-medium text-sm mb-1">Feature Requires Live Mode</h4>
                  <p className="text-white/70 text-xs leading-relaxed">
                    Screen Intelligence with backend vision analysis is only available in <span className="font-semibold text-blue-400">Live Mode</span>.
                  </p>
                </div>
              </div>

              <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                <p className="text-white/60 text-xs mb-2">To use this feature:</p>
                <ol className="space-y-1.5 text-xs text-white/80">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 font-medium">1.</span>
                    <span>Click the <span className="font-semibold">Live Mode</span> toggle in the prompt bar</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 font-medium">2.</span>
                    <span>Try your screen analysis query again</span>
                  </li>
                </ol>
              </div>

              <div className="text-xs text-white/40 italic">
                💡 Live Mode enables real-time screen analysis using Claude, OpenAI, or Grok vision APIs
              </div>
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
      className="bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 flex flex-col m-4 
        animate-in fade-in slide-in-from-top-4"
      style={{ 
        width: 'calc(100% - 32px)', // Account for margin
        maxHeight: 'calc(100vh - 32px)'
      }}
    >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Monitor className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{query}</h3>
            </div>
          </div>
          
          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 ml-3"
            title="Hide Screen Analysis"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Analysis Content - Scrollable */}
        <div className="px-6 pb-4 flex-1 overflow-y-auto min-h-0">
          <div className="prose prose-invert max-w-none">
            <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
              {analysis}
            </p>
          </div>
        </div>

        {/* Metadata Footer */}
        <div className="px-6 py-3 border-t border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 text-xs">
            {/* Provider Badge */}
            <div className={`
              flex items-center gap-1.5 px-2 py-1 rounded-lg border
              ${providerInfo.color}
            `}>
              <Sparkles className="w-3 h-3" />
              <span className="font-medium">{providerInfo.name}</span>
            </div>

            {/* Latency */}
            <div className="flex items-center gap-1.5 text-white/50">
              <Clock className="w-3 h-3" />
              <span>{formatLatency(latencyMs)}</span>
            </div>

            {/* Timestamp */}
            <div className="ml-auto text-white/40">
              {new Date(timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
    </div>
  );
}
