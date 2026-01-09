/**
 * Prompt Bar Component
 * 
 * Collapsible bottom-center prompt bar
 * - 50% screen width, centered
 * - Slide up/down animation
 * - Expand/collapse with arrow button
 * 
 */

import React, { useState, useRef, useEffect } from 'react';
import { Droplet, Unplug, ArrowUp, ChevronUp, X, Globe, MessageCircle, Monitor, Zap, AlertCircle, Play, Square } from 'lucide-react';

interface PromptBarProps {
  onSubmit: (message: string) => void;
  isReady: boolean;
  onConnectionChange?: (isConnected: boolean) => void;
}

const ipcRenderer = (window as any).electron?.ipcRenderer;

export default function PromptBar({ 
  onSubmit, 
  isReady,
  onConnectionChange
}: PromptBarProps) {
  const [message, setMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [textareaHeight, setTextareaHeight] = useState<number | null>(null);
  const [hasResults, setHasResults] = useState(false);
  const [isResultsVisible, setIsResultsVisible] = useState(false);
  const [hasScreenResults, setHasScreenResults] = useState(false);
  const [isScreenResultsVisible, setIsScreenResultsVisible] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [hasAutomation, setHasAutomation] = useState(false);
  const [isAutomationVisible, setIsAutomationVisible] = useState(false);
  const [isAutomationRunning, setIsAutomationRunning] = useState(false);
  const [wasExpandedBeforeAutomation, setWasExpandedBeforeAutomation] = useState(true);
  const [clarificationMode, setClarificationMode] = useState<{
    active: boolean;
    question: string;
    stepDescription: string;
    stepIndex: number;
    questionId?: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Listen for web search results availability
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleWebSearchState = (_event: any, state: { hasResults: boolean; isVisible: boolean }) => {
      setHasResults(state.hasResults);
      setIsResultsVisible(state.isVisible);
    };

    const handleScreenIntelligenceState = (_event: any, state: { hasResults: boolean; isVisible: boolean }) => {
      setHasScreenResults(state.hasResults);
      setIsScreenResultsVisible(state.isVisible);
    };

    const handleChatWindowState = (_event: any, state: { isVisible: boolean }) => {
      setIsChatVisible(state.isVisible);
    };

    const handleAutomationState = (_event: any, state: { hasAutomation: boolean; isVisible: boolean; isRunning?: boolean }) => {
      console.log('🎯 [PROMPT_BAR] Received automation:state', state);
      setHasAutomation(state.hasAutomation);
      setIsAutomationVisible(state.isVisible);
      if (state.isRunning !== undefined) {
        console.log(`🔴 [PROMPT_BAR] Setting isAutomationRunning to: ${state.isRunning}`);
        
        // Auto-collapse prompt bar when automation starts
        if (state.isRunning && !isAutomationRunning) {
          console.log('📦 [PROMPT_BAR] Automation started - collapsing prompt bar');
          setWasExpandedBeforeAutomation(isExpanded);
          setIsExpanded(false);
          
          // CRITICAL: Activate clarification mode for Computer Use automation
          // This ensures any user input bypasses intent classification and goes directly to the automation
          console.log('🔒 [PROMPT_BAR] Activating clarification mode for Computer Use automation');
          setClarificationMode({
            active: true,
            question: 'Computer Use automation is running. Type your response if clarification is needed.',
            stepDescription: 'Computer Use Automation',
            stepIndex: 0,
            questionId: 'computer-use-active'
          });
        }
        // Auto-restore prompt bar when automation completes
        else if (!state.isRunning && isAutomationRunning) {
          console.log('📤 [PROMPT_BAR] Automation completed - restoring prompt bar');
          setIsExpanded(wasExpandedBeforeAutomation);
          
          // CRITICAL: Clear clarification mode when automation ends
          console.log('🔓 [PROMPT_BAR] Clearing clarification mode - automation ended');
          setClarificationMode(null);
        }
        
        setIsAutomationRunning(state.isRunning);
      }
    };

    // Listen for shared clarification state changes from main process
    const handleClarificationStateChanged = (_event: any, state: {
      active: boolean;
      question: string | null;
      stepDescription: string | null;
      stepIndex: number | null;
      questionId: string | null;
      intent: string | null;
    }) => {
      console.log('🔔 [PROMPT_BAR] ===== CLARIFICATION STATE CHANGED =====');
      console.log('🔔 [PROMPT_BAR] New state from main process:', JSON.stringify(state, null, 2));
      
      if (state.active) {
        const newClarificationMode = {
          active: true,
          question: state.question || '',
          stepDescription: state.stepDescription || '',
          stepIndex: state.stepIndex || 0,
          questionId: state.questionId ?? undefined
        };
        
        console.log('✅ [PROMPT_BAR] Activating clarification mode:', newClarificationMode);
        setClarificationMode(newClarificationMode);
        setIsExpanded(true);
        setMessage('');
        
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      } else {
        console.log('🔕 [PROMPT_BAR] Deactivating clarification mode');
        setClarificationMode(null);
      }
    };

    ipcRenderer.on('web-search:state', handleWebSearchState);
    ipcRenderer.on('screen-intelligence:state', handleScreenIntelligenceState);
    ipcRenderer.on('chat-window:state', handleChatWindowState);
    ipcRenderer.on('automation:state', handleAutomationState);
    ipcRenderer.on('clarification:state-changed', handleClarificationStateChanged);
    
    // Get initial chat window state
    ipcRenderer.invoke('chat-window:get-state').then((state: { isVisible: boolean }) => {
      setIsChatVisible(state.isVisible);
    }).catch(() => {
      // Ignore errors, default to visible
    });
    
    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('web-search:state', handleWebSearchState);
        ipcRenderer.removeListener('screen-intelligence:state', handleScreenIntelligenceState);
        ipcRenderer.removeListener('chat-window:state', handleChatWindowState);
        ipcRenderer.removeListener('automation:state', handleAutomationState);
        ipcRenderer.removeListener('clarification:state-changed', handleClarificationStateChanged);
      }
    };
  }, []);

  // Listen for banner enable live mode event
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleEnableLiveMode = () => {
      if (!isConnected) {
        toggleConnection();
      }
    };

    ipcRenderer.on('banner:enable-live-mode', handleEnableLiveMode);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('banner:enable-live-mode', handleEnableLiveMode);
      }
    };
  }, [isConnected]);

  const handleToggleWebSearch = () => {
    if (ipcRenderer) {
      // Close other overlays first (one window at a time rule)
      if (isChatVisible) {
        ipcRenderer.send('chat-window:toggle');
      }
      if (isScreenResultsVisible) {
        ipcRenderer.send('screen-intelligence:toggle');
      }
      // Then toggle web search
      ipcRenderer.send('web-search:toggle');
    }
  };

  const handleToggleScreenIntelligence = () => {
    if (ipcRenderer) {
      // Close other overlays first (one window at a time rule)
      if (isChatVisible) {
        ipcRenderer.send('chat-window:toggle');
      }
      if (isResultsVisible) {
        ipcRenderer.send('web-search:toggle');
      }
      // Then toggle screen intelligence
      ipcRenderer.send('screen-intelligence:toggle');
    }
  };

  const handleToggleChatWindow = () => {
    if (ipcRenderer) {
      // Close other overlays first (one window at a time rule)
      if (isResultsVisible) {
        ipcRenderer.send('web-search:toggle');
      }
      if (isScreenResultsVisible) {
        ipcRenderer.send('screen-intelligence:toggle');
      }
      if (isAutomationVisible) {
        ipcRenderer.send('automation:toggle');
      }
      // Then toggle chat window
      ipcRenderer.send('chat-window:toggle');
    }
  };

  const handleToggleAutomation = () => {
    if (!ipcRenderer) return;
    
    // If automation is running (window hidden), send stop command to pause and show window
    if (isAutomationRunning) {
      console.log('⏸️  [PROMPT_BAR] Stopping automation');
      ipcRenderer.send('automation:stop');
      setIsAutomationRunning(false);
      setIsAutomationVisible(true);
    } 
    // If automation is paused (window visible), send play command to resume and hide window
    else if (isAutomationVisible) {
      console.log('▶️  [PROMPT_BAR] Playing automation');
      ipcRenderer.send('automation:play');
      setIsAutomationRunning(true);
      setIsAutomationVisible(false);
    }
    // If automation window is not visible and not running, just show it
    else {
      // Close other overlays first (one window at a time rule)
      if (isChatVisible) {
        ipcRenderer.send('chat-window:toggle');
      }
      if (isResultsVisible) {
        ipcRenderer.send('web-search:toggle');
      }
      if (isScreenResultsVisible) {
        ipcRenderer.send('screen-intelligence:toggle');
      }
      // Then show automation
      ipcRenderer.send('automation:toggle');
    }
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      // CRITICAL: Check if we're in clarification mode FIRST before any processing
      console.log('🔍 [PROMPT_BAR] ===== HANDLE SUBMIT CALLED =====');
      console.log('🔍 [PROMPT_BAR] Message:', message.trim());
      console.log('🔍 [PROMPT_BAR] Current clarificationMode:', JSON.stringify(clarificationMode, null, 2));
      console.log('🔍 [PROMPT_BAR] clarificationMode?.active:', clarificationMode?.active);
      
      if (clarificationMode?.active) {
        console.log('✅ [PROMPT_BAR] ===== IN CLARIFICATION MODE =====');
        
        // Check if user wants to cancel/change context
        const lowerMessage = message.trim().toLowerCase();
        const cancelPhrases = [
          // Core cancels
          'cancel', 'cancel that', 'cancel this', 'cancel please', 'abort', 'stop', 'stop it', 'halt',
          'never mind', 'nevermind', 'nvm', 'nm', 'forget it', 'forget about it', 'forget that',
          'scratch that', 'disregard that', 'ignore that',

          // Restart
          'start over', 'start again', 'restart', 'reset', 'begin again', "let's start over",
          'can we start over', 'start from scratch', 'new session', 'clear', 'clear this', 'clear chat',

          // Change mind / no longer want
          'changed my mind', 'change my mind', 'actually no', 'no thanks', 'no thank you',
          'not anymore', "don't want", "i don't want", "don't need", "i don't need",
          'not interested', 'no longer interested', 'on second thought', 'wait no', 'hold on',
          'hold up', 'wait', 'actually...', 'nah', 'nope', 'belay that',

          // Polite
          'sorry cancel', 'sorry nevermind', 'my bad cancel', 'oops wrong', 'wrong thing',
          'mistake', 'misclick', 'accident', 'sorry about that', 'thanks anyway', 'thanks but no',
          'maybe later',

          // Forceful
          'quit', 'exit', 'end this', 'enough', 'done', "i'm done", 'cancel everything', 'stop everything',

          // Short
          'no', 'skip', 'skip this', "don't", 'dont', "don't do that", "don't continue"
        ];
        const wantsToCancel = cancelPhrases.some(phrase => lowerMessage.includes(phrase));
        
        if (wantsToCancel) {
          console.log('🚫 [PROMPT_BAR] User wants to cancel clarification - detected cancel phrase');
          console.log('🚫 [PROMPT_BAR] Message:', message.trim());
          
          // Clear clarification mode in main process
          if (ipcRenderer) {
            ipcRenderer.send('clarification:clear');
          }
          
          // Clear local state
          setClarificationMode(null);
          
          // Process as new request through StateGraph
          console.log('🔄 [PROMPT_BAR] Processing as new request through StateGraph');
          onSubmit(message.trim());
          setMessage('');
          
          // Reset textarea height
          if (textareaRef.current) {
            setTimeout(() => {
              if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                const resetHeight = textareaRef.current.scrollHeight;
                textareaRef.current.style.height = resetHeight + 'px';
                setTextareaHeight(resetHeight);
                
                if (ipcRenderer) {
                  const baseHeight = 66;
                  const totalHeight = baseHeight + resetHeight;
                  ipcRenderer.send('overlay:resize-prompt', {
                    height: totalHeight,
                    animate: true
                  });
                }
              }
            }, 0);
          }
          
          return;
        }
        
        console.log('✅ [PROMPT_BAR] Submitting clarification answer:', message.trim());
        console.log('🔄 [PROMPT_BAR] BYPASSING state graph - sending directly to backend via IPC');
        console.log('📋 [PROMPT_BAR] Clarification details:', {
          questionId: clarificationMode.questionId,
          stepIndex: clarificationMode.stepIndex,
          answer: message.trim()
        });
        
        // CRITICAL: Send clarification answer directly via IPC, bypassing state graph
        // We already know the intent (command_automate), so we send the response
        // directly to CommandAutomateProgress which forwards it to the backend
        if (ipcRenderer) {
          ipcRenderer.send('prompt-bar:clarification-answer', {
            answer: message.trim(),
            questionId: clarificationMode.questionId,
            stepIndex: clarificationMode.stepIndex
          });
        }
        
        // CRITICAL: Do NOT clear clarification mode here!
        // Clarification mode should stay active until automation ends (automation:state with isRunning=false)
        // This ensures subsequent user inputs continue to bypass intent classification
        console.log('✅ [PROMPT_BAR] Clarification answer sent - keeping clarification mode active');
        setMessage('');
        
        // Reset textarea height
        if (textareaRef.current) {
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto';
              const resetHeight = textareaRef.current.scrollHeight;
              textareaRef.current.style.height = resetHeight + 'px';
              setTextareaHeight(resetHeight);
              
              if (ipcRenderer) {
                const baseHeight = 66;
                const totalHeight = baseHeight + resetHeight;
                ipcRenderer.send('overlay:resize-prompt', {
                  height: totalHeight,
                  animate: true
                });
              }
            }
          }, 0);
        }
        
        // RETURN EARLY - do NOT call onSubmit() which would trigger state graph
        console.log('🚫 [PROMPT_BAR] RETURNING EARLY - NOT calling onSubmit()');
        return;
      }
      
      // Normal message submission (goes through state graph)
      console.log('📤 [PROMPT_BAR] Normal submission - calling onSubmit() which triggers state graph');
      onSubmit(message.trim());
      setMessage('');
      
      // Reset textarea height and window size after React updates
      if (textareaRef.current && ipcRenderer) {
        // Wait for React to update the textarea value to empty
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const resetHeight = textareaRef.current.scrollHeight;
            textareaRef.current.style.height = resetHeight + 'px';
            
            // Update saved height state to the reset height
            setTextareaHeight(resetHeight);
            
            // Resize window to fit reset textarea
            const baseHeight = 66;
            const totalHeight = baseHeight + resetHeight;
            ipcRenderer.send('overlay:resize-prompt', {
              height: totalHeight,
              animate: true
            });
          }
        }, 0);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      setIsExpanded(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    
    // Calculate max height as 50% of screen height minus some padding
    const screenHeight = window.screen.availHeight;
    const maxTextareaHeight = Math.floor(screenHeight * 0.5) - 100; // 50% minus base UI height
    
    // Auto-resize textarea
    e.target.style.height = 'auto';
    const newHeight = Math.min(e.target.scrollHeight, maxTextareaHeight);
    e.target.style.height = newHeight + 'px';
    
    // Save textarea height to state so it persists on collapse/expand
    setTextareaHeight(newHeight);
    
    // Resize the prompt window to accommodate the textarea
    if (ipcRenderer) {
      // Calculate total prompt bar height: padding + input area + status bar
      // p-3 (24px) + icon (32px) + textarea py-2 (16px) + mt-2 (8px) + status (16px) + border (2px) = 98px
      // But textarea height already includes its padding, so: 24 + 32 + 8 + 16 + 2 = 82px base
      const baseHeight = 66; // Base UI height without textarea content
      const totalHeight = baseHeight + newHeight;
      
      // Resize the prompt window
      ipcRenderer.send('overlay:resize-prompt', {
        height: totalHeight,
        animate: false // No animation for smooth typing experience
      });
    }
  };

  const toggleConnection = () => {
    const newState = !isConnected;
    setIsConnected(newState);
    if (onConnectionChange) {
      onConnectionChange(newState);
    }
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Notify main process when expanded state changes and resize window
  useEffect(() => {
    if (ipcRenderer) {
      ipcRenderer.send('overlay:set-expanded', isExpanded);
      
      // Resize window when expanding/collapsing
      if (isExpanded) {
        // When expanding, resize to fit saved textarea height
        const baseHeight = 66;
        const currentTextareaHeight = textareaHeight || 24; // Use saved height or min height
        const totalHeight = baseHeight + currentTextareaHeight;
        
        ipcRenderer.send('overlay:resize-prompt', {
          height: totalHeight,
          animate: true
        });
      } else {
        // When collapsing, resize to just the button
        ipcRenderer.send('overlay:resize-prompt', {
          height: 55,
          animate: true
        });
      }
    }
  }, [isExpanded, textareaHeight]);

  // Initialize textarea height and restore saved height when expanding
  useEffect(() => {
    if (textareaRef.current && isExpanded) {
      // Restore saved height or calculate from content
      if (textareaHeight) {
        textareaRef.current.style.height = textareaHeight + 'px';
      } else {
        textareaRef.current.style.height = 'auto';
        const initialHeight = textareaRef.current.scrollHeight;
        textareaRef.current.style.height = initialHeight + 'px';
        setTextareaHeight(initialHeight);
      }
    }
  }, [isExpanded]);

  // Handle mouse events for click-through when collapsed
  useEffect(() => {
    if (!ipcRenderer || isExpanded) return;

    // When collapsed, enable click-through except over the arrow button
    const handleMouseMove = (e: MouseEvent) => {
      const element = document.elementFromPoint(e.clientX, e.clientY);
      const isOverButton = element?.closest('.click-active') !== null;
      
      // Disable click-through when over button, enable otherwise
      ipcRenderer.send('overlay:set-ignore-mouse-events', !isOverButton, { forward: true });
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isExpanded]);

  // Dragging is handled via CSS -webkit-app-region: drag
  // No JavaScript needed!

  return (
    <div 
      className="w-full h-full flex justify-center pointer-events-none"
    >
        {/* Expand/Collapse Button (always visible when collapsed) */}
      {!isExpanded && (
        <div className="flex items-end pointer-events-auto mb-6">
          <button
            onClick={toggleExpanded}
            className="
              bg-gray-800/80 backdrop-blur-xl p-2 rounded-full
              border border-white/10
              hover:bg-gray-700/80 hover:scale-110 
              transition-all duration-300 ease-out
              click-active
            "
            title="Expand prompt bar"
          >
            <ChevronUp className="w-5 h-5 text-white" />
          </button>
        </div>
      )}

      {/* Main Prompt Bar */}
      {isExpanded && (
        <div 
          className={`
            w-full rounded-xl backdrop-blur-xl p-3
            border border-white/10 click-active
            pointer-events-auto
            animate-in fade-in slide-in-from-bottom-4 
            transition-colors duration-300
            bg-gray-800/90
          `}
        >
        {/* Header with drag handle and close button */}
        {/* <div 
          className="flex items-center justify-between mb-1 py-1 cursor-move drag-handle"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          <div className="text-xs text-white/60 text-center select-none">
            {isConnected ? 'Live Mode On' : 'Private Mode On'}
          </div>
          <button
            onClick={toggleExpanded}
            className="
              p-1.5 rounded-lg hover:bg-white/10 transition-colors
              click-active
            "
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title="Collapse (ESC)"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div> */}

        {/* Clarification Question Banner */}
        {clarificationMode?.active && (
          <div className="mb-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs text-orange-400 font-medium mb-1">
                  Step {clarificationMode.stepIndex + 1}: {clarificationMode.stepDescription}
                </div>
                <div className="text-sm text-white">
                  {clarificationMode.question}
                </div>
              </div>
              <button
                onClick={() => {
                  setClarificationMode(null);
                  if (ipcRenderer) {
                    ipcRenderer.send('prompt-bar:clarification-cancelled');
                  }
                }}
                className="p-1 rounded hover:bg-white/10 transition-colors click-active"
                title="Cancel"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>
          </div>
        )}

        {/* Clarification Mode Indicator */}
        {clarificationMode?.active && (
          <div className="mb-2 px-3 py-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-yellow-400" />
              <span className="text-xs text-yellow-400 font-medium">
                Answering clarification question - will bypass intent classification
              </span>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div 
          className="flex items-center space-x-3 click-active"
        >
          
          
          {/* Textarea Input */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={
              clarificationMode?.active 
                ? "Type your answer to the clarification question and press Enter..." 
                : (isReady ? "Ask anything..." : "Initializing...")
            }
            disabled={!isReady && !clarificationMode?.active}
            className={`
              flex-1 text-sm bg-transparent text-white placeholder-white/50 
              resize-none min-h-[24px] max-h-[400px] py-2 px-3 rounded-lg 
              border transition-colors click-active
              disabled:opacity-50 disabled:cursor-not-allowed
              overflow-y-auto
              ${clarificationMode?.active 
                ? 'border-yellow-500/50 focus:border-yellow-400' 
                : 'border-white/10 focus:border-teal-400/50'}
              focus:outline-none
            `}
            rows={1}
            style={{ border: 'none', outline: 'none', boxShadow: 'none', height: 'auto' }}
          />
          
          {/* Send Button */}
          <button
            onClick={toggleExpanded}
            className="
              p-1.5 rounded-lg hover:bg-white/10 transition-colors
              click-active
            "
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title="Collapse (ESC)"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
        
        {/* Bottom Status Bar */}
        <div className="flex items-center justify-between mt-2 text-xs text-white/60 space-x-3">
          
          {/* Toggle Button */}
          <div className="flex items-center space-x-2">
            {/* Chat Window Toggle Button */}
            <div 
              className={`rounded-lg p-0.5 transition-all duration-200 ${
                isChatVisible ? 'bg-blue-500/20' : ''
              }`}
            >
              <div 
                className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                  isChatVisible
                    ? 'from-blue-400 to-indigo-500 hover:from-blue-300 hover:to-indigo-400' 
                    : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
                }`}
                onClick={handleToggleChatWindow}
                title={isChatVisible ? 'Hide Chat Window' : 'Show Chat Window'}
              >
                <MessageCircle className="w-4 h-4 text-white" />
                {/* Status indicator */}
                <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                  isChatVisible ? 'bg-green-400' : 'bg-gray-400'
                }`} />
              </div>
            </div>
            
            {/* Web Search Toggle Button */}
            {hasResults && (
              <div 
                className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                  isResultsVisible
                    ? 'from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500' 
                    : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
                }`}
                onClick={handleToggleWebSearch}
                title={isResultsVisible ? 'Hide Search Results' : 'Show Search Results'}
              >
                <Globe className="w-4 h-4 text-white" />
                {/* Indicator dot when results available */}
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-teal-500" />
              </div>
            )}

            {/* Screen Intelligence Toggle Button */}
            {hasScreenResults && (
              <div 
                className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                  isScreenResultsVisible
                    ? 'from-cyan-400 to-teal-500 hover:from-cyan-300 hover:to-teal-400' 
                    : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
                }`}
                onClick={handleToggleScreenIntelligence}
                title={isScreenResultsVisible ? 'Hide Screen Analysis' : 'Show Screen Analysis'}
              >
                <Monitor className="w-4 h-4 text-white" />
                {/* Indicator dot when results available */}
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-cyan-400" />
              </div>
            )}

            {/* Automation Play/Stop Button */}
            {hasAutomation && (
              <div 
                className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                  isAutomationRunning
                    ? 'from-red-500 to-red-600 hover:from-red-400 hover:to-red-500' 
                    : isAutomationVisible
                    ? 'from-green-500 to-green-600 hover:from-green-400 hover:to-green-500'
                    : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
                }`}
                onClick={handleToggleAutomation}
                title={
                  isAutomationRunning 
                    ? 'Stop Automation (Show Debug Window)' 
                    : isAutomationVisible 
                    ? 'Play Automation (Hide Window)' 
                    : 'Show Automation'
                }
              >
                {isAutomationRunning ? (
                  <Square className="w-4 h-4 text-white" />
                ) : isAutomationVisible ? (
                  <Play className="w-4 h-4 text-white" />
                ) : (
                  <Zap className="w-4 h-4 text-white" />
                )}
                {/* Indicator dot when automation available */}
                <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                  isAutomationRunning ? 'bg-red-400 animate-pulse' : 'bg-orange-400'
                }`} />
              </div>
            )}

            {/* Connection Toggle Button */}
            <div 
              className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer transition-all duration-200 click-active ${
                isConnected 
                  ? 'from-teal-400 to-blue-500 hover:from-teal-300 hover:to-blue-400' 
                  : 'from-gray-500 to-gray-600 hover:from-gray-400 hover:to-gray-500'
              }`}
              onClick={toggleConnection}
              title={isConnected ? 'Live Mode' : 'Private Mode'}
            >
              {isConnected ? <Droplet className="w-4 h-4 text-white" /> : <Unplug className="w-4 h-4 text-white" />}
              {/* Status Indicator */}
              <div 
                className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                  isConnected ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
            </div>
            <div className="text-xs text-white/60 text-center select-none">
                {isConnected ? 'Live Mode' : 'Private Mode'}
            </div>
          </div>
          <div className="text-center">
            Thinkdrop can make mistakes. Check important info.
          </div>
          <button
            onClick={handleSubmit}
            disabled={!isReady || !message.trim()}
            className="
              bg-gradient-to-r from-teal-500 to-blue-500 
              hover:from-teal-600 hover:to-blue-600 
              text-white w-9 h-9 p-0 rounded-xl 
              disabled:opacity-50 disabled:cursor-not-allowed 
              flex-shrink-0 flex items-center justify-center
              transition-all click-active
            "
            title="Send message"
          >
            <ArrowUp className="w-6 h-6" />
          </button>
        </div>
        </div>
      )}
    </div>
  );
}
