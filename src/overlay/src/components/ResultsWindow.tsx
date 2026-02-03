/**
 * Results Window Component
 * 
 * Clean, modern results display styled like PromptCaptureBox
 * Shows AI response results in a scrollable, interactive window
 */

import { useEffect, useState, useRef } from 'react';
import { OverlayPayload } from '../../../types/overlay-intents';
import { getCommunicationAgent, hasCommunicationAgent } from '../services/communicationAgentSingleton';
import { OmniParserStatus } from '../services/communicationAgent';
import CompactAutomationProgress from './intents/CompactAutomationProgress';

const ipcRenderer = (window as any).electron?.ipcRenderer;

// Initialize Communication Agent singleton at module load time
// This ensures it exists BEFORE the component mounts and BEFORE Worker Agent broadcasts IPC events
try {
  if (!hasCommunicationAgent()) {
    console.log('🚀 [RESULTS_WINDOW_MODULE] Pre-initializing Communication Agent singleton');
    const agent = getCommunicationAgent({
      serverUrl: 'http://localhost:4000',
      onMessage: () => {}, // Will be updated when component mounts
      onProgress: () => {}, // Will be updated when component mounts
      onStreamToken: () => {}, // Will be updated when component mounts
      onError: () => {} // Will be updated when component mounts
    });
    
    // Connect to Socket.IO backend immediately so routing is available
    agent.connect()
      .then(() => {
        console.log('✅ [RESULTS_WINDOW_MODULE] Connected to Socket.IO backend');
      })
      .catch(err => {
        console.warn('⚠️ [RESULTS_WINDOW_MODULE] Backend not available:', err.message);
        console.log('ℹ️ [RESULTS_WINDOW_MODULE] Worker Agent will still work via IPC');
      });
    
    console.log('✅ [RESULTS_WINDOW_MODULE] Communication Agent ready for IPC events');
  }
} catch (error) {
  console.error('❌ [RESULTS_WINDOW_MODULE] Failed to initialize Communication Agent:', error);
}

export default function ResultsWindow() {
  console.log('🎨 [RESULTS_WINDOW] Component rendering');
  
  const [overlayPayload, setOverlayPayload] = useState<OverlayPayload | null>(null);
  const [promptText, setPromptText] = useState<string>('');
  const contentRef = useRef<HTMLDivElement>(null);
  
  // Communication Agent state
  const [streamingResponse, setStreamingResponse] = useState<string>('');
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);
  const [routingDecision, setRoutingDecision] = useState<{
    route: string;
    reasoning: string;
    confidence: number;
  } | null>(null);
  const [isRoutingExpanded, setIsRoutingExpanded] = useState(false);
  
  // OmniParser warmup status
  const [omniParserStatus, setOmniParserStatus] = useState<OmniParserStatus | null>(null);
  
  // Request deduplication
  const lastSentMessage = useRef<{ text: string; timestamp: number } | null>(null);
  
  // Draggable state
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Update Communication Agent callbacks when component mounts
  useEffect(() => {
    console.log('🔄 [RESULTS_WINDOW] Updating Communication Agent callbacks');
    
    const commAgent = getCommunicationAgent();
    commAgent.updateConfig({
      serverUrl: 'http://localhost:4000',
      
      onOmniParserStatus: (status: OmniParserStatus) => {
        console.log('🔥 [RESULTS_WINDOW] OmniParser status update:', status);
        setOmniParserStatus(status);
      },
      
      onMessage: (message) => {
        console.log('📨 [RESULTS_WINDOW] Message received:', message);
        
        // Handle status messages with routing decisions
        if (message.type === 'status') {
          console.log('📊 [RESULTS_WINDOW] Status update:', message.payload);
          setIsThinking(false);
          
          // Extract routing decision if present
          if (message.payload?.route) {
            setRoutingDecision({
              route: message.payload.route,
              reasoning: message.payload.reasoning || '',
              confidence: message.payload.confidence || 0
            });
          }
        }
        
        // Handle stream start
        if (message.type === 'llm_stream_start') {
          setIsThinking(false);
          setIsStreaming(true);
          console.log('🚀 [RESULTS_WINDOW] Streaming started');
        }
        
        // Handle completion messages
        if (message.type === 'llm_stream_end') {
          setIsStreaming(false);
          console.log('✅ [RESULTS_WINDOW] Streaming complete');
        }
      },
      
      onProgress: (progress) => {
        console.log('📊 [RESULTS_WINDOW] Progress update:', progress);
        
        // Add step-level progress
        if (progress.stepDescription) {
          setCurrentStep(progress.stepDescription);
          setProgressSteps(prev => [...prev, progress.stepDescription!]);
        }
        
        // Add action-level progress
        if (progress.actionDescription) {
          setProgressSteps(prev => [...prev, `  → ${progress.actionDescription}`]);
        }
      },
      
      onStreamToken: (token) => {
        console.log('💬 [RESULTS_WINDOW] Stream token:', token);
        setIsThinking(false); // Hide "Thinking..." when streaming starts
        setIsStreaming(true);
        setStreamingResponse(prev => prev + token);
      },
      
      onError: (error) => {
        console.error('❌ [RESULTS_WINDOW] Error:', error);
        setStreamingResponse(`Error: ${error}`);
        setIsStreaming(false);
      }
    });

    console.log('✅ [RESULTS_WINDOW] Callbacks updated');

    // Don't disconnect on unmount - singleton persists
    return () => {
      console.log('🔌 [RESULTS_WINDOW] Component unmounting (singleton persists)');
    };
  }, []);

  // Listen for overlay updates (keep for backward compatibility)
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleOverlayUpdate = (_event: any, payload: OverlayPayload) => {
      console.log('📨 [RESULTS_WINDOW] Received overlay update:', payload);
      setOverlayPayload(payload);
      
      // Reset streaming state on new request
      if (payload.uiVariant === 'loading') {
        setStreamingResponse('');
        setProgressSteps([]);
        setCurrentStep('');
        setIsStreaming(false);
      }
    };

    const handlePromptText = async (_event: any, text: string) => {
      console.log('📝 [RESULTS_WINDOW] Received prompt text:', text);
      
      // Validate: Ignore empty messages
      if (!text || text.trim().length === 0) {
        console.warn('⚠️ [RESULTS_WINDOW] Empty message ignored');
        return;
      }
      
      // Deduplication: Ignore duplicate messages within 2 seconds
      const now = Date.now();
      if (lastSentMessage.current) {
        const timeSinceLastSend = now - lastSentMessage.current.timestamp;
        if (lastSentMessage.current.text === text && timeSinceLastSend < 2000) {
          console.warn('🔄 [RESULTS_WINDOW] Duplicate message ignored (sent', timeSinceLastSend, 'ms ago)');
          return;
        }
      }
      
      // Track this message
      lastSentMessage.current = { text, timestamp: now };
      
      setPromptText(text);
      
      // Reset state for new request - clear old automation UI
      setOverlayPayload(null);
      setStreamingResponse('');
      setProgressSteps([]);
      setCurrentStep('');
      setIsStreaming(false);
      setIsThinking(true);
      setRoutingDecision(null);
      
      // Send message to Communication Agent
      if (hasCommunicationAgent()) {
        try {
          console.log('📤 [RESULTS_WINDOW] Sending message to Communication Agent');
          const commAgent = getCommunicationAgent();
          await commAgent.sendMessage(text, {
            timestamp: now
          });
        } catch (error: any) {
          console.error('❌ [RESULTS_WINDOW] Failed to send message:', error);
          setStreamingResponse(`Error: ${error.message}`);
          setIsStreaming(false);
        }
      } else {
        console.error('❌ [RESULTS_WINDOW] Communication Agent not initialized');
        setStreamingResponse('Error: Communication Agent not initialized');
        setIsStreaming(false);
      }
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
      const maxHeight = 800; // Increased to allow more content before scrolling
      
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
        console.log('📏 [RESULTS_WINDOW] Resizing to:', { width: estimatedWidth, height: totalHeight, contentHeight, state: overlayPayload?.uiVariant });
      }
      
      ipcRenderer.send('results-window:resize', { width: estimatedWidth, height: totalHeight });
    };

    // Initial resize
    const timeoutId = setTimeout(resizeWindow, 100);
    
    // Watch for content changes using MutationObserver
    const observer = new MutationObserver(() => {
      resizeWindow();
    });
    
    observer.observe(contentRef.current, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
    
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [overlayPayload, promptText, streamingResponse, progressSteps, routingDecision, isRoutingExpanded]);

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

  // Draggable header handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only allow dragging from header, not from close button
    if ((e.target as HTMLElement).closest('button')) return;
    
    setIsDragging(true);
    const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top
    };
    
    console.log('🖱️ [RESULTS_WINDOW] Drag started');
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!ipcRenderer) return;
      
      // Calculate new window position
      const newX = e.screenX - dragOffset.current.x;
      const newY = e.screenY - dragOffset.current.y;
      
      ipcRenderer.send('results-window:move', { x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      console.log('🖱️ [RESULTS_WINDOW] Drag ended');
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Render results based on Communication Agent state
  const renderResults = () => {
    // Check if we have an automation overlay payload
    if (overlayPayload?.uiVariant === 'automation_progress') {
      console.log('🤖 [RESULTS_WINDOW] Rendering compact automation UI with payload:', overlayPayload);
      return (
        <CompactAutomationProgress 
          payload={overlayPayload}
          omniParserStatus={omniParserStatus}
          onEvent={(event) => {
            console.log('🎯 [RESULTS_WINDOW] Automation event:', event);
            // Handle automation events (e.g., completion, errors, clarifications)
            if (event.type === 'completed') {
              setIsThinking(false);
            }
          }}
        />
      );
    }
    
    // Show thinking indicator when waiting for routing decision
    if (isThinking) {
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

    return (
      <div className="space-y-4">
        {/* Show routing decision with reasoning (collapsible) */}
        {routingDecision && (
          <div 
            className="rounded-lg border overflow-hidden"
            style={{
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderColor: 'rgba(59, 130, 246, 0.3)',
            }}
          >
            <button
              onClick={() => setIsRoutingExpanded(!isRoutingExpanded)}
              className="w-full p-3 flex items-center justify-between hover:bg-opacity-20 transition-colors"
              style={{
                backgroundColor: isRoutingExpanded ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                cursor: 'pointer',
                border: 'none',
                textAlign: 'left',
              }}
            >
              <div className="flex items-center gap-2">
                <div className="text-blue-400 text-xs font-semibold uppercase tracking-wide">
                  {routingDecision.route === 'direct' ? 'Direct Response' : 'Worker Agent'}
                </div>
                <div className="text-gray-500 text-xs">
                  ({Math.round(routingDecision.confidence * 100)}% confidence)
                </div>
              </div>
              <div className="text-blue-400 text-sm">
                {isRoutingExpanded ? '▼' : '▶'}
              </div>
            </button>
            {isRoutingExpanded && (
              <div className="px-3 pb-3 text-gray-300 text-sm leading-relaxed">
                {routingDecision.reasoning}
              </div>
            )}
          </div>
        )}

        {/* Show Worker Agent progress steps */}
        {progressSteps.length > 0 && (
          <div className="space-y-2">
            <div className="text-blue-400 text-sm font-medium">Progress:</div>
            {progressSteps.map((step, index) => (
              <div 
                key={index} 
                className="text-gray-300 text-sm"
                style={{ 
                  paddingLeft: step.startsWith('  →') ? '16px' : '0',
                  color: step.startsWith('  →') ? '#9ca3af' : '#e5e7eb'
                }}
              >
                {step}
              </div>
            ))}
            {isStreaming && currentStep && (
              <div className="flex items-center gap-2 mt-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-gray-400 text-sm italic">{currentStep}</span>
              </div>
            )}
          </div>
        )}

        {/* Show streaming LLM response (direct response) */}
        {streamingResponse && (
          <div className="prose prose-invert max-w-none">
            <div className="text-white text-sm leading-relaxed whitespace-pre-wrap">
              {streamingResponse}
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-1" />
              )}
            </div>
          </div>
        )}

        {/* Fallback: waiting for results */}
        {!isThinking && !routingDecision && !streamingResponse && progressSteps.length === 0 && (
          <div className="text-gray-400 text-sm text-center">
            Waiting for response...
          </div>
        )}
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
      {/* Fixed header with prompt text and close button (draggable) */}
      <div 
        className="flex items-center justify-between px-4 py-3 border-b"
        onMouseDown={handleMouseDown}
        style={{
          borderColor: 'rgba(255, 255, 255, 0.1)',
          flexShrink: 0,
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
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
        <div ref={contentRef}>
          {renderResults()}
        </div>
      </div>
    </div>
  );
}
