/**
 * Guide Context - Manages guide state and execution
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

interface GuideStep {
  id: string;
  title: string;
  description?: string;
  code?: string;
  explanation?: string;
  expectedDuration?: number;
}

interface GuideState {
  guideId: string | null;
  intro: string;
  steps: GuideStep[];
  totalSteps: number;
  isVisible: boolean;
  isExecuting: boolean;
}

interface GuideContextType {
  guideState: GuideState;
  showGuide: (guideId: string, intro: string, steps: GuideStep[], totalSteps: number) => void;
  hideGuide: () => void;
  executeGuide: (guideId: string, fromStep: number) => Promise<void>;
  abortGuide: (guideId: string) => Promise<void>;
}

const GuideContext = createContext<GuideContextType | undefined>(undefined);

export const GuideProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [guideState, setGuideState] = useState<GuideState>({
    guideId: null,
    intro: '',
    steps: [],
    totalSteps: 0,
    isVisible: false,
    isExecuting: false
  });

  const showGuide = useCallback((guideId: string, intro: string, steps: GuideStep[], totalSteps: number) => {
    console.log('📚 [GUIDE-CONTEXT] Showing guide in separate window');
    
    const guideData = {
      guideId,
      intro,
      steps,
      totalSteps,
      currentStepIndex: 0,
      isExecuting: false
    };
    
    setGuideState({
      guideId,
      intro,
      steps,
      totalSteps,
      isVisible: true,
      isExecuting: false
    });
    
    // Send guide data to separate guide window
    window.electronAPI?.send('guide:show', guideData);
  }, []);

  const hideGuide = useCallback(() => {
    setGuideState(prev => ({
      ...prev,
      isVisible: false
      // Keep guide data for resume capability
    }));
  }, []);

  const executeGuide = useCallback(async (guideId: string, fromStep: number) => {
    console.log('🎯 [GUIDE-CONTEXT] Executing guide:', guideId, 'from step:', fromStep);
    setGuideState(prev => ({ ...prev, isExecuting: true }));

    try {
      // Call MCP command.guide.execute
      const result = await window.electronAPI?.mcpCall({
        serviceName: 'command',
        action: 'command.guide.execute',
        payload: {
          guideId,
          fromStep
        }
      });

      console.log('✅ [GUIDE-CONTEXT] Guide execution result:', result);

      if (result?.success) {
        setGuideState(prev => ({
          ...prev,
          isExecuting: false,
          isVisible: false // Hide overlay after successful execution
        }));
      } else {
        console.error('❌ [GUIDE-CONTEXT] Guide execution failed:', result?.error);
        setGuideState(prev => ({ ...prev, isExecuting: false }));
      }
    } catch (error) {
      console.error('❌ [GUIDE-CONTEXT] Error executing guide:', error);
      setGuideState(prev => ({ ...prev, isExecuting: false }));
    }
  }, []);

  const abortGuide = useCallback(async (guideId: string) => {
    try {
      // Call MCP command.guide.execute with abort flag
      await window.electronAPI?.mcpCall({
        serviceName: 'command',
        action: 'command.guide.execute',
        payload: {
          guideId,
          abort: true
        }
      });

      setGuideState(prev => ({ ...prev, isExecuting: false }));
    } catch (error) {
      console.error('Error aborting guide:', error);
      setGuideState(prev => ({ ...prev, isExecuting: false }));
    }
  }, []);

  // Guide state is now managed entirely within React
  // No separate window communication needed

  return (
    <GuideContext.Provider
      value={{
        guideState,
        showGuide,
        hideGuide,
        executeGuide,
        abortGuide
      }}
    >
      {children}
    </GuideContext.Provider>
  );
};

export const useGuide = () => {
  const context = useContext(GuideContext);
  if (!context) {
    throw new Error('useGuide must be used within GuideProvider');
  }
  return context;
};
