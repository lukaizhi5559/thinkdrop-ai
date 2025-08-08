import React, { useState, useEffect } from 'react';
import { LocalLLMProvider } from './contexts/LocalLLMContext';
import { ConversationProvider } from './contexts/ConversationContext';
import UnifiedInterface from './components/UnifiedInterface';
import ChatMessages from './components/ChatMessages';
import InsightWindow from './components/InsightWindow';
import MemoryDebugger from './components/MemoryDebugger';
import { ConversationSidebar } from './components/ConversationSidebar';
import { SidebarToggle } from './components/SidebarToggle';

import { initializeConversationSignals } from './signals/init';
import './types/electronAPI'; // Import Electron API types

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
  
  // Main unified overlay interface state
  const [isListening, setIsListening] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGatheringInsight] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  // Initialize signals when app starts
  useEffect(() => {
    console.log('🚀 [APP] Initializing conversation signals...');
    initializeConversationSignals().catch(error => {
      console.error('❌ [APP] Failed to initialize signals:', error);
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
      console.log('Stopped listening...');
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
      <div className="h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-hidden relative">
        {/* Conversation Sidebar */}
        <ConversationSidebar />
        
        {/* Test Buttons */}
        <div className="fixed top-16 left-4 z-10">
          <SidebarToggle />
        </div>
        
        {/* Main Content */}
        <UnifiedInterface
          isListening={isListening}
          toggleListening={toggleListening}
          isAnalyzing={isAnalyzing}
          isGatheringInsight={isGatheringInsight}
          showResponse={showResponse}
          setShowResponse={setShowResponse}
        />
      </div>
    </ConversationProvider>
  );
};

// Wrap App with LocalLLMProvider for agent orchestration context
const AppWithProvider: React.FC = () => {
  return (
    <LocalLLMProvider>
    <App />
    </LocalLLMProvider>
  );
};

export default AppWithProvider;
