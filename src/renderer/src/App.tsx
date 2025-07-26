import React, { useState, useEffect } from 'react';
import { Button } from './components/ui/button';
import { 
  Droplet
} from 'lucide-react';
import ChatMessages from './components/ChatMessages';
import InsightWindow from './components/InsightWindow';
import MemoryDebugger from './components/MemoryDebugger';
import WebSocketTest from './components/WebSocketTest';
import PrimaryControlBar from './components/PrimaryControlBar';

import { LocalLLMProvider } from './contexts/LocalLLMContext';
import './types/electronAPI'; // Import Electron API types

function App() {
  // Check if this is the chat window mode
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  
  // If in chat mode, render the unified chat component (input + messages)
  if (mode === 'chat') {
    // return <ChatMessages />;
  }
  
  // If in messages mode, render the unified chat component (input + messages)
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
  
  // If in websocket mode, render the WebSocket test component
  if (mode === 'websocket') {
    return <WebSocketTest />;
  }
  
  // Otherwise render the main overlay
  const [isListening, setIsListening] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGatheringInsight, setIsGatheringInsight] = useState(false);
  
  // Toggle states for windows
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isInsightOpen, setIsInsightOpen] = useState(false);
  const [isMemoryDebuggerOpen, setIsMemoryDebuggerOpen] = useState(false);



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
    console.log('handleToggleInsight called - current state:', { isInsightOpen, isGatheringInsight });
    console.trace('handleToggleInsight stack trace');
    
    if (isGatheringInsight) return;
    
    if (isInsightOpen) {
      // Close insight window
      console.log('Closing insight window via handleToggleInsight');
      if (window.electronAPI?.hideInsight) {
        await window.electronAPI.hideInsight();
      }
      setIsInsightOpen(false);
    } else {
      // Open insight window with animation
      console.log('Opening insight window via handleToggleInsight');
      setIsGatheringInsight(true);
      
      setTimeout(async () => {
        if (window.electronAPI?.showInsight) {
          await window.electronAPI.showInsight();
        } else {
          // Fallback for development/web mode
          console.log('Insight window requested - Electron API not available');
        }
        setIsGatheringInsight(false);
        setIsInsightOpen(true);
        console.log('Insight window opened successfully');
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
      if (isMemoryDebuggerOpen) {
        // Close memory debugger window
        if (window.electronAPI?.hideMemoryDebugger) {
          await window.electronAPI.hideMemoryDebugger();
        }
        setIsMemoryDebuggerOpen(false);
      } else {
        // Open memory debugger window
        if (window.electronAPI?.showMemoryDebugger) {
          await window.electronAPI.showMemoryDebugger();
          setIsMemoryDebuggerOpen(true);
        } else {
          console.error('Memory debugger not available - electronAPI not loaded');
        }
      }
    } catch (error) {
      console.error('Failed to toggle memory debugger:', error);
    }
  };

  return (
    <>
      {/* Main Floating Overlay - Centered in frameless window */}
      <div className="flex items-start justify-center w-full h-full">
        <div className="z-50">
        {/* Primary Control Bar */}
        <PrimaryControlBar
          isChatOpen={isChatOpen}
          handleToggleChat={handleToggleChat}
          isListening={isListening}
          toggleListening={toggleListening}
          isGatheringInsight={isGatheringInsight}
          isInsightOpen={isInsightOpen}
          handleToggleInsight={handleToggleInsight}
          isMemoryDebuggerOpen={isMemoryDebuggerOpen}
          handleToggleMemoryDebugger={handleToggleMemoryDebugger}
          handleHideAll={handleHideAll}
        />

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
        
        {/* {!isListening && !showResponse && !isAnalyzing && !isGatheringInsight && (
          <div className="mt-4 text-center">
            <div className="bg-black/20 backdrop-blur-sm rounded-xl border border-white/10 px-5 py-4">
              <p className="text-white/50 text-sm">
                Click "Listen" to start receiving contextual insights
              </p>
            </div>
          </div>
        )} */}
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
