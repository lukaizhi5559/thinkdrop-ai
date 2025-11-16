import React, { useState, useEffect } from 'react';
import { LocalLLMProvider } from './contexts/LocalLLMContext';
import { ConversationProvider } from './contexts/ConversationContext';
import { ToastProvider } from './contexts/ToastContext';
import { GuideProvider } from './contexts/GuideContext';
import UnifiedInterface from './components/UnifiedInterface';
import ChatMessages from './components/ChatMessages';
import InsightWindow from './components/InsightWindow';
import MemoryDebugger from './components/MemoryDebugger';
import { ConversationSidebar } from './components/ConversationSidebar';
import { SidebarToggle } from './components/SidebarToggle';
import { GuideWindowContent } from './components/GuideWindowContent';

import { initializeConversationSignals } from './signals/init';
import './types/electronAPI'; // Import Electron API types
import { ViewType } from '@/types/view';

// Initialize signals immediately when module loads (before React mounts)
// Initializing conversation signals


function App() {
  // Check if this is a specific mode (for legacy compatibility)
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  
  // Legacy mode support (these are no longer used in unified approach but kept for compatibility)
  if (mode === 'messages') {
    return <ChatMessages />;
  }
  
  if (mode === 'insight') {
    return <InsightWindow />;
  }
  
  if (mode === 'memory') {
    return <MemoryDebugger />;
  }
  
  // Guide mode - separate window for interactive guides
  if (mode === 'guide') {
    return <GuideWindowContent />;
  }
  
  // Main unified overlay interface state
  const [isListening, setIsListening] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGatheringInsight] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [currentView, setCurrentView] = useState(mode);

  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
  }

  // Initialize signals when app starts - moved to module level for earlier execution
  useEffect(() => {
    // Signals initialized
    initializeConversationSignals().catch(error => {
      console.error('❌ [APP MODULE] Failed to initialize signals at module level:', error);
    });
  }, []);

  // Simulate analysis and response
  useEffect(() => {
    if (isListening) {
      console.log('Started listening...');
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
      // Cleanup listeners
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

  // Render the unified interface
  return (
    <ConversationProvider>
      <div className="h-screen text-white overflow-hidden relative">
        {/* Conversation Sidebar */}
        <ConversationSidebar />
        
        {/* SidebarToggle - only show in unified interface mode (not in legacy modes) */}
        {(!currentView || currentView === 'chat') && (
          <div className="fixed top-16 left-4 z-10">
            <SidebarToggle />
          </div>
        )}
        
        {/* Main Content */}
        <UnifiedInterface
          isListening={isListening}
          toggleListening={toggleListening}
          isAnalyzing={isAnalyzing}
          isGatheringInsight={isGatheringInsight}
          showResponse={showResponse}
          setShowResponse={setShowResponse}
          onViewChange={handleViewChange}
        />
      </div>
    </ConversationProvider>
  );
};

// Wrap App with providers for agent orchestration context and global toast
const AppWithProvider: React.FC = () => {
  return (
    <LocalLLMProvider>
      <ToastProvider>
        <GuideProvider>
          <App />
        </GuideProvider>
      </ToastProvider>
    </LocalLLMProvider>
  );
};

export default AppWithProvider;
