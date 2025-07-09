import React, { useState, useEffect } from 'react';
import { Button } from './components/ui/button';
import { 
  Mic, 
  MicOff, 
  Droplet,
  Lightbulb,
  EyeOff,
  Database
} from 'lucide-react';
import ChatWindow from './ChatWindow';
import ChatMessages from './ChatMessages';
import InsightWindow from './InsightWindow';
import MemoryDebugger from './components/MemoryDebugger';
import { LocalLLMProvider } from './contexts/LocalLLMContext';

// Declare global for TypeScript
declare global {
  interface Window {
    electronAPI?: {
      toggleOverlay: () => Promise<void>;
      hideOverlay: () => Promise<void>;
      showOverlay: () => Promise<void>;
      hideAllWindows: () => Promise<void>;
      showAllWindows: () => Promise<void>;
      getGlobalVisibility: () => Promise<boolean>;
      toggleChat: () => Promise<void>;
      showChat: () => Promise<void>;
      hideChat: () => Promise<void>;
      showChatMessages: () => Promise<void>;
      hideChatMessages: () => Promise<void>;
      sendChatMessage: (message: any) => Promise<void>;
      onChatMessage: (callback: (event: any, message: any) => void) => void;
      adjustChatMessagesHeight: (height: number) => Promise<void>;
      
      // Insight window methods
      showInsight: () => Promise<void>;
      hideInsight: () => Promise<void>;
      onInsightUpdate: (callback: (event: any, data: any) => void) => void;
      
      // Memory debugger window methods
      showMemoryDebugger: () => Promise<void>;
      hideMemoryDebugger: () => Promise<void>;
      
      // Focus management between chat windows
      focusChatInput: () => Promise<void>;
      onMessageLoaded: (callback: () => void) => void;
      notifyMessageLoaded: () => Promise<void>;
      startAudioCapture: () => Promise<void>;
      stopAudioCapture: () => Promise<void>;
      onTranscriptUpdate: (callback: (event: any, data: any) => void) => void;
      onAgentResponse: (callback: (event: any, data: any) => void) => void;
      
      // LocalLLMAgent methods
      llmOrchestrate: (userInput: string, context?: any) => Promise<any>;
      llmQueryLocal: (prompt: string, options?: any) => Promise<any>;
      llmGetHealth: () => Promise<any>;
      llmGetCachedAgents: () => Promise<any>;
      llmGetCommunications: (limit?: number) => Promise<any>;
      llmClearCache: () => Promise<any>;
      
      // Memory methods
      getAllUserMemories: (options?: { quiet?: boolean }) => Promise<any[]>;
      
      platform: string;
    };
  }
}

function App() {
  // Check if this is the chat window mode
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  
  // If in chat mode, render the chat input window
  if (mode === 'chat') {
    return <ChatWindow />;
  }
  
  // If in messages mode, render the chat messages window
  if (mode === 'messages') {
    return <ChatMessages />;
  }
  
  // If in insight mode, render the insight window
  if (mode === 'insight') {
    return <InsightWindow />;
  }
  
  // If in memory mode, render the memory debugger window
  if (mode === 'memory') {
    return <MemoryDebugger />;
  }
  
  // Otherwise render the main overlay
  const [isListening, setIsListening] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGatheringInsight, setIsGatheringInsight] = useState(false);
  
  // Toggle states for windows
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isInsightOpen, setIsInsightOpen] = useState(false);



  // Simulate analysis and response
  useEffect(() => {
    if (isListening) {
      const analysisTimer = setTimeout(() => {
        setIsAnalyzing(true);
      }, 3000);
      
      const responseTimer = setTimeout(() => {
        setShowResponse(true);
        setIsAnalyzing(false);
      }, 6000);
      
      return () => {
        clearTimeout(analysisTimer);
        clearTimeout(responseTimer);
      };
    } else {
      setIsAnalyzing(false);
      setShowResponse(false);
    }
  }, [isListening]);

  const toggleListening = async () => {
    setIsListening(!isListening);
    if (!isListening) {
      try {
        await window.electronAPI?.startAudioCapture();
      } catch (error) {
        console.log('Audio capture not available in demo mode');
      }
    } else {
      try {
        await window.electronAPI?.stopAudioCapture();
      } catch (error) {
        console.log('Audio capture not available in demo mode');
      }
    }
  };



  const handleToggleChat = async () => {
    if (isChatOpen) {
      // Close chat windows
      if (window.electronAPI?.hideChat) {
        await window.electronAPI.hideChat();
      }
      if (window.electronAPI?.hideChatMessages) {
        await window.electronAPI.hideChatMessages();
      }
      setIsChatOpen(false);
    } else {
      // Open chat windows
      if (window.electronAPI?.showChat) {
        await window.electronAPI.showChat();
        
        // Also show the chat messages window (even if empty)
        if (window.electronAPI?.showChatMessages) {
          await window.electronAPI.showChatMessages();
        }
      } else {
        // Fallback for development/web mode
        console.log('Chat window requested - Electron API not available');
      }
      setIsChatOpen(true);
    }
  };

  const handleToggleInsight = async () => {
    if (isInsightOpen) {
      // Close insight window
      if (window.electronAPI?.hideInsight) {
        await window.electronAPI.hideInsight();
      }
      setIsInsightOpen(false);
    } else {
      // Open insight window with gathering animation
      setIsGatheringInsight(true);
      // Simulate gathering contextual information
      setTimeout(async () => {
        if (window.electronAPI?.showInsight) {
          await window.electronAPI.showInsight();
        } else {
          // Fallback for development/web mode
          console.log('Insight window requested - Electron API not available');
        }
        setIsGatheringInsight(false);
        setIsInsightOpen(true);
      }, 2000);
    }
  };

  const handleHideAll = async () => {
    if (window.electronAPI?.hideAllWindows) {
      await window.electronAPI.hideAllWindows();
    }
  };

  const handleToggleMemoryDebugger = async () => {
    try {
      if (window.electronAPI?.showMemoryDebugger) {
        await window.electronAPI.showMemoryDebugger();
      } else {
        console.error('Memory debugger not available - electronAPI not loaded');
      }
    } catch (error) {
      console.error('Failed to show memory debugger:', error);
    }
  };

  return (
    <>
      {/* Main Floating Overlay - Centered in frameless window */}
      <div className="flex items-start justify-center w-full h-full">
        <div className="z-50">
        {/* Primary Control Bar */}
        <div 
          className="rounded-2xl bg-gray-900/95 backdrop-blur-sm px-6 py-4 min-w-[400px]"
          style={{
            WebkitAppRegion: 'drag',
            // backdropFilter: 'blur(25px) saturate(180%)',
            // background: 'rgba(0, 0, 0, 0.35)'
          } as React.CSSProperties}
        >
          <div className="flex items-center justify-between">
            {/* Left - ThinkDrop Branding */}
            {/* Chat Button */}
            <Button
                variant="ghost"
                size="lg"
                className={`text-white/80 hover:text-white hover:bg-white/10 rounded-xl p-2 transition-all duration-200 ${
                  isChatOpen ? 'bg-white/10 text-white' : ''
                }`}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onClick={handleToggleChat}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center ${
                    isChatOpen ? 'from-teal-300 to-blue-400' : 'from-teal-400 to-blue-500'
                  }`}>
                    <Droplet className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-white/90 text-base font-medium">
                    {isChatOpen ? 'Ask?' : 'Ask?'}
                  </span>
                </div>
              </Button>
            
            {/* Center - Main Listen Button */}
            <Button
              onClick={toggleListening}
              className={`w-24 h-10 rounded-xl transition-all duration-300 shadow-lg font-medium ${
                isListening
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white'
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {isListening ? (
                <div className="flex items-center space-x-2">
                  <MicOff className="w-4 h-4" />
                  <span className="text-sm">Stop</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Mic className="w-4 h-4" />
                  <span className="text-sm">Listen</span>
                </div>
              )}
            </Button>

            {/* Right - Action Buttons */}
            <div className="flex items-center space-x-2">
              {/* Insight Button */}
              <Button
                variant="ghost"
                size="sm"
                className={`text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200 ${
                  isGatheringInsight ? 'animate-pulse bg-yellow-500/20 text-yellow-400' : ''
                } ${
                  isInsightOpen ? 'bg-yellow-500/20 text-yellow-400' : ''
                }`}
                onClick={handleToggleInsight}
                disabled={isGatheringInsight}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title={isInsightOpen ? 'Close Insight' : 'Open Insight'}
              >
                <Lightbulb className="w-5 h-5" />
              </Button>
              
              {/* Memory Debugger Button */}
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200"
                onClick={handleToggleMemoryDebugger}
                title="Open Memory Debugger"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Database className="w-5 h-5" />
              </Button>
              
              {/* Hide All Button */}
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200"
                onClick={handleHideAll}
                title="Hide ThinkDrop AI"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <EyeOff className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Analysis Indicator */}
        {(isAnalyzing || isGatheringInsight) && (
          <div className="mt-4 bg-black/30 backdrop-blur-lg rounded-xl border border-white/10 px-5 py-4">
            <div className="flex items-center space-x-4">
              <div className="w-3 h-3 bg-teal-400 rounded-full animate-pulse"></div>
              <p className="text-white/80 text-sm">
                {isGatheringInsight ? 'Gathering contextual insights...' : 'Analyzing context...'}
              </p>
            </div>
          </div>
        )}

        {/* Response Panel */}
        {showResponse && (
          <div className="mt-4 bg-black/30 backdrop-blur-lg rounded-xl border border-white/10 p-5">
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <Droplet className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-white/90 font-medium text-base mb-3">ThinkDrop Insight</h3>
                <p className="text-white/70 text-sm leading-relaxed mb-4">
                  I can see you're working on a development project. Based on your screen activity, 
                  I notice code editing and terminal usage. Would you like me to help optimize your workflow 
                  or assist with any specific coding challenges?
                </p>
                <div className="flex space-x-3">
                  <Button 
                    size="sm" 
                    className="bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white text-sm px-4 py-2 rounded-lg"
                  >
                    Tell me more
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-white/60 hover:text-white hover:bg-white/10 text-sm px-4 py-2 rounded-lg"
                    onClick={() => setShowResponse(false)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {!isListening && !showResponse && !isAnalyzing && !isGatheringInsight && (
          <div className="mt-4 text-center">
            <div className="bg-black/20 backdrop-blur-sm rounded-xl border border-white/10 px-5 py-4">
              <p className="text-white/50 text-sm">
                Click "Listen" to start receiving contextual insights
              </p>
            </div>
          </div>
        )}
        </div>
      </div>



    </>
  );
}

// Wrap App with LocalLLMProvider for agent orchestration context
const AppWithProvider: React.FC = () => {
  return (
    <LocalLLMProvider>
      <App />
    </LocalLLMProvider>
  );
};

export default AppWithProvider;
