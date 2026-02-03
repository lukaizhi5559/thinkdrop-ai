/**
 * Prompt Capture Box Component
 * 
 * Floating prompt input that follows the cursor during prompt capture mode
 * Displays typed text as user types anywhere on screen
 */

import { useEffect, useState } from 'react';
import { overlayPayloadSignal } from '../signals/overlaySignals';

const ipcRenderer = (window as any).electron?.ipcRenderer;

interface PromptCaptureBoxProps {
  text: string;
  cursorPosition: { x: number; y: number };
  isActive: boolean;
  initialText?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

interface ParsedPrompt {
  capturedText: string | null;
  additionalText: string;
}

export default function PromptCaptureBox({ text, cursorPosition, isActive, initialText, selectionStart = 0, selectionEnd = 0 }: PromptCaptureBoxProps) {
  // Subscribe to signal changes using state
  const [overlayPayload, setOverlayPayload] = useState(overlayPayloadSignal.value);
  
  // Clarification mode state
  const [clarificationMode, setClarificationMode] = useState(false);
  const [clarificationQuestion, setClarificationQuestion] = useState('');
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [clarificationStepIndex, setClarificationStepIndex] = useState(0);
  
  useEffect(() => {
    // Subscribe to signal changes
    const unsubscribe = overlayPayloadSignal.subscribe((value) => {
      console.log('📡 [PROMPT_CAPTURE_BOX] Signal changed:', value);
      setOverlayPayload(value);
    });
    
    return unsubscribe;
  }, []);
  
  // Listen for clarification requests from automation
  useEffect(() => {
    if (!ipcRenderer) return;
    
    const handleClarificationRequest = (_event: any, data: any) => {
      console.log('❓ [PROMPT_CAPTURE_BOX] Clarification requested:', data);
      setClarificationMode(true);
      setClarificationQuestion(data.question || '');
      setClarificationAnswer('');
      setClarificationStepIndex(data.stepIndex || 0);
    };
    
    ipcRenderer.on('prompt-bar:request-clarification', handleClarificationRequest);
    
    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('prompt-bar:request-clarification', handleClarificationRequest);
      }
    };
  }, []);
  
  // Handle clarification answer submission
  const handleClarificationSubmit = () => {
    if (!clarificationAnswer.trim()) return;
    
    console.log('✅ [PROMPT_CAPTURE_BOX] Submitting clarification answer:', clarificationAnswer);
    
    if (ipcRenderer) {
      ipcRenderer.send('prompt-bar:clarification-answer', {
        answer: clarificationAnswer,
        stepIndex: clarificationStepIndex
      });
    }
    
    // Reset clarification mode
    setClarificationMode(false);
    setClarificationQuestion('');
    setClarificationAnswer('');
  };
  
  // Handle clarification cancel
  const handleClarificationCancel = () => {
    console.log('❌ [PROMPT_CAPTURE_BOX] Clarification cancelled');
    setClarificationMode(false);
    setClarificationQuestion('');
    setClarificationAnswer('');
  };

  // Note: Enter key is handled by main process → GhostOverlay IPC → App.tsx → show-results-window
  // No need for local key handler here
  const [position, setPosition] = useState(cursorPosition);
  const [lockedPosition, setLockedPosition] = useState<{ x: number; y: number } | null>(null);
  const [lockedDisplayPosition, setLockedDisplayPosition] = useState<{ x: number; y: number } | null>(null);

  // Calculate dimensions (needed for useEffect dependencies)
  const lines = text.split('\n');
  const maxWidth = 600;
  const minWidth = 400;
  const padding = 16;
  const lineHeight = 24;
  const hasResults = overlayPayload && overlayPayload.uiVariant === 'results';
  const baseHeight = Math.max(lines.length * lineHeight + padding * 2, 100);
  const estimatedWidth = Math.min(Math.max(text.length * 8, minWidth), maxWidth);

  // Lock position when loading state appears, unlock when user types new query
  useEffect(() => {
    // Lock position on loading state
    if (overlayPayload && overlayPayload.uiVariant === 'loading' && !lockedPosition) {
      console.log('📌 [PROMPT_CAPTURE] Locking position on loading:', position);
      setLockedPosition(position);
      
      // Also lock the calculated display position to prevent movement
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const isLeftHalf = position.x < screenWidth / 2;
      const isTopHalf = position.y < screenHeight / 2;
      const offset = 30;
      let posX = position.x;
      let posY = position.y;
      
      if (isLeftHalf && isTopHalf) {
        posX = position.x + offset;
        posY = position.y + offset;
      } else if (isLeftHalf && !isTopHalf) {
        posX = position.x + offset;
        posY = position.y - baseHeight - offset;
      } else if (!isLeftHalf && isTopHalf) {
        posX = position.x - estimatedWidth - offset;
        posY = position.y + offset;
      } else {
        posX = position.x - estimatedWidth - offset;
        posY = position.y - baseHeight - offset;
      }
      
      setLockedDisplayPosition({ x: posX, y: posY });
      console.log('📌 [PROMPT_CAPTURE] Locked display position:', { x: posX, y: posY });
    }
    
    // Results window is now fixed at bottom-right, no need to send position
    
    // Clear lock when overlay is cleared OR when user starts typing (text changes while results are showing)
    if (lockedPosition && (!overlayPayload || (overlayPayload.uiVariant === 'results' && text.length > 0))) {
      console.log('🔓 [PROMPT_CAPTURE] Clearing locked position - user typing new query');
      setLockedPosition(null);
      setLockedDisplayPosition(null);
    }
  }, [overlayPayload, position, lockedPosition, text, estimatedWidth, baseHeight]);

  // Only follow cursor if not locked
  useEffect(() => {
    if (!lockedPosition) {
      setPosition(cursorPosition);
    }
  }, [cursorPosition, lockedPosition]);

  // Use initialText prop as the captured text (only if it's not empty)
  const initialCapturedText = initialText && initialText.trim().length > 0 ? initialText : null;

  // Debug logging
  useEffect(() => {
    if (overlayPayload) {
      console.log('📦 [PROMPT_CAPTURE] Received overlayPayload:', {
        uiVariant: overlayPayload.uiVariant,
        intent: overlayPayload.intent,
        hasSlots: !!overlayPayload.slots
      });
    }
  }, [overlayPayload]);

  // Keep box visible if active OR if we have loading/results state OR if in clarification mode
  // When results are showing, box stays visible and editable for immediate new queries
  const shouldShow = isActive || clarificationMode || (overlayPayload && (overlayPayload.uiVariant === 'loading' || overlayPayload.uiVariant === 'results'));
  
  if (!shouldShow) return null;

  // Parse the text to separate captured text from additional input
  const parsePrompt = (fullText: string): ParsedPrompt => {
    if (!initialCapturedText) {
      return { capturedText: null, additionalText: fullText };
    }
    
    // If text starts with captured text, separate it
    if (fullText.startsWith(initialCapturedText)) {
      return {
        capturedText: initialCapturedText,
        additionalText: fullText.slice(initialCapturedText.length)
      };
    }
    
    // If user has deleted/modified the captured text, treat all as additional text
    return { capturedText: null, additionalText: fullText };
  };

  const { capturedText, additionalText } = parsePrompt(text);

  // Truncate captured text for display (single line, compact)
  const truncateCapturedText = (text: string, maxLength: number = 30): string => {
    // Replace newlines and multiple spaces with single space
    const singleLine = text.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= maxLength) return singleLine;
    return singleLine.substring(0, maxLength) + '...';
  };

  // Render text with selection highlighting
  const renderTextWithSelection = (displayText: string) => {
    const hasSelection = selectionStart !== selectionEnd;
    
    if (!hasSelection) {
      return displayText;
    }

    const beforeSelection = displayText.slice(0, selectionStart);
    const selectedText = displayText.slice(selectionStart, selectionEnd);
    const afterSelection = displayText.slice(selectionEnd);

    return (
      <>
        {beforeSelection}
        <span
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.4)',
            color: '#ffffff',
          }}
        >
          {selectedText}
        </span>
        {afterSelection}
      </>
    );
  };


  // Use locked display position if available, otherwise calculate from current position
  let posX, posY;
  
  if (lockedDisplayPosition) {
    // Use locked display position to prevent movement
    posX = lockedDisplayPosition.x;
    posY = lockedDisplayPosition.y;
  } else {
    // Calculate position dynamically based on cursor
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const isLeftHalf = position.x < screenWidth / 2;
    const isTopHalf = position.y < screenHeight / 2;
    const offset = 30;
    
    posX = position.x;
    posY = position.y;
    
    if (isLeftHalf && isTopHalf) {
      posX = position.x + offset;
      posY = position.y + offset;
    } else if (isLeftHalf && !isTopHalf) {
      posX = position.x + offset;
      posY = position.y - baseHeight - offset;
    } else if (!isLeftHalf && isTopHalf) {
      posX = position.x - estimatedWidth - offset;
      posY = position.y + offset;
    } else {
      posX = position.x - estimatedWidth - offset;
      posY = position.y - baseHeight - offset;
    }
  }

  // Ghost window should always be pointer-events none (results in separate window)
  const hasInteractiveContent = false; // Always false - results window handles interaction

  // Results are shown in separate results window, not here
  return (
    <div
      className="fixed z-[10001]"
      style={{
        left: posX,
        top: posY,
        width: estimatedWidth,
        maxWidth: maxWidth,
        pointerEvents: hasInteractiveContent ? 'auto' : 'none',
      }}
    >
      <div
        className="rounded-xl shadow-2xl backdrop-blur-md"
        style={{
          backgroundColor: 'rgba(23, 23, 23, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          minHeight: baseHeight, // Use baseHeight to keep box size consistent
          maxHeight: hasResults ? '600px' : 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Clarification mode - shows question and answer input */}
        {clarificationMode ? (
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-2">
              <span style={{ fontSize: '20px' }}>❓</span>
              <div className="flex-1">
                <div className="text-sm font-medium mb-2" style={{ color: '#60a5fa' }}>
                  Clarification Needed
                </div>
                <div className="text-sm whitespace-pre-wrap" style={{ color: '#e5e7eb' }}>
                  {clarificationQuestion}
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <input
                type="text"
                value={clarificationAnswer}
                onChange={(e) => setClarificationAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleClarificationSubmit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleClarificationCancel();
                  }
                }}
                placeholder="Type your answer..."
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#e5e7eb',
                  outline: 'none'
                }}
              />
              
              <div className="flex gap-2">
                <button
                  onClick={handleClarificationSubmit}
                  disabled={!clarificationAnswer.trim()}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: clarificationAnswer.trim() ? '#3b82f6' : 'rgba(59, 130, 246, 0.3)',
                    color: '#ffffff',
                    cursor: clarificationAnswer.trim() ? 'pointer' : 'not-allowed',
                    opacity: clarificationAnswer.trim() ? 1 : 0.5
                  }}
                >
                  Submit Answer
                </button>
                <button
                  onClick={handleClarificationCancel}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : /* Thinking indicator - shows in ghost window */
        overlayPayload && overlayPayload.uiVariant === 'loading' ? (
          <div
            className="border-b"
            style={{
              borderColor: 'rgba(255, 255, 255, 0.08)',
            }}
          >
            <div className="p-4 flex items-center gap-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
              <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Thinking...</span>
            </div>
          </div>
        ) : 
          /* Input area - always at bottom */
          <div className="p-4" style={{ flex: '0 0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <div
                className="text-sm whitespace-pre-wrap break-words"
                style={{
                  color: '#e5e7eb',
                  minHeight: '20px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  flex: 1,
                }}
              >
                {capturedText ? (
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap' }}>
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        color: '#60a5fa',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '300px',
                      }}
                    >
                      @CapturedText: {truncateCapturedText(capturedText)}
                    </span>
                    {additionalText && (
                      <span style={{ marginLeft: '6px', flex: 1 }}>{renderTextWithSelection(additionalText)}</span>
                    )}
                    {selectionStart === selectionEnd && (
                      <span className="inline-block w-0.5 h-4 animate-pulse ml-0.5" style={{ backgroundColor: '#3b82f6' }} />
                    )}
                  </div>
                ) : text ? (
                  <>
                    {renderTextWithSelection(text)}
                    {selectionStart === selectionEnd && (
                      <span className="inline-block w-0.5 h-4 animate-pulse ml-0.5" style={{ backgroundColor: '#3b82f6' }} />
                    )}
                  </>
                ) : (
                  <span style={{ color: '#6b7280' }}>Ask anything</span>
                )}
              </div>
              
              {/* Return/Enter icon */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  backgroundColor: text.trim() ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid',
                  borderColor: text.trim() ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                  flexShrink: 0,
                  marginTop: '8px',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={text.trim() ? '#60a5fa' : '#6b7280'}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
              </div>
            </div>
          </div>
        }

        {/* Footer with keyboard shortcuts */}
        <div
          className="px-4 py-2.5 border-t text-xs flex items-center gap-3"
          style={{ 
            borderColor: 'rgba(255, 255, 255, 0.08)',
            color: '#9ca3af',
            flex: '0 0 auto',
          }}
        >
          <span><span style={{ fontWeight: 500 }}>Enter:</span> Send</span>
          <span>•</span>
          <span><span style={{ fontWeight: 500 }}>Shift+Enter:</span> Newline</span>
          <span>•</span>
          <span><span style={{ fontWeight: 500 }}>Esc:</span> Cancel</span>
        </div>
      </div>
    </div>
  );
}
