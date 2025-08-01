import React, { useState, useEffect } from 'react';
import ChatMessages from './components/ChatMessages';
import InsightWindow from './components/InsightWindow';
import MemoryDebugger from './components/MemoryDebugger';
import UnifiedInterface from './components/UnifiedInterface';

import { LocalLLMProvider } from './contexts/LocalLLMContext';
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
  const [showResponse, setShowResponse] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGatheringInsight, setIsGatheringInsight] = useState(false);

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

  // Render the unified interface
  return (
    <div className="w-full h-full">
      <UnifiedInterface
        isListening={isListening}
        toggleListening={toggleListening}
        isAnalyzing={isAnalyzing}
        isGatheringInsight={isGatheringInsight}
        showResponse={showResponse}
        setShowResponse={setShowResponse}
      />
    </div>
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
