/**
 * Guide Window Content - Wrapper for GuideOverlay in separate window
 * This component is rendered when App.tsx receives mode=guide
 */

import React, { useEffect, useState } from 'react';
import { GuideOverlay } from './GuideOverlay';

interface GuideStep {
  id: string;
  title: string;
  description?: string;
  code?: string;
  explanation?: string;
  expectedDuration?: number;
}

interface GuideData {
  guideId: string;
  intro: string;
  steps: GuideStep[];
  totalSteps: number;
  currentStepIndex: number;
  isExecuting: boolean;
}

export const GuideWindowContent: React.FC = () => {
  const [guideData, setGuideData] = useState<GuideData | null>(null);

  useEffect(() => {
    console.log('📚 [GUIDE-WINDOW] Guide window content mounted');

    // Listen for guide data from main process
    const handleGuideShow = (_event: any, data: GuideData) => {
      console.log('📚 [GUIDE-WINDOW] Received guide data:', data);
      setGuideData(data);
    };

    // Register listener
    if (window.electronAPI?.on) {
      window.electronAPI.on('guide:show', handleGuideShow);
    }

    return () => {
      // Cleanup if needed
    };
  }, []);

  const handleClose = () => {
    console.log('❌ [GUIDE-WINDOW] Close requested');
    window.electronAPI?.send('guide:close');
  };

  const handleExecute = async (guideId: string, fromStep: number) => {
    console.log('🎯 [GUIDE-WINDOW] Execute requested:', guideId, fromStep);
    
    // Update local state
    setGuideData(prev => prev ? { ...prev, isExecuting: true } : null);
    
    // Send execute request to main process
    window.electronAPI?.send('guide:execute', { guideId, fromStep });
  };

  const handleAbort = async (guideId: string) => {
    console.log('🛑 [GUIDE-WINDOW] Abort requested:', guideId);
    
    // Send abort request to main process
    window.electronAPI?.send('guide:abort', { guideId });
    
    // Update local state
    setGuideData(prev => prev ? { ...prev, isExecuting: false } : null);
  };

  // Show loading state if no guide data yet
  if (!guideData) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'transparent' }}>
        <div className="text-teal-400 text-lg">Loading guide...</div>
      </div>
    );
  }

  // Render GuideOverlay with guide data
  // The entire window is draggable via -webkit-app-region: drag
  return (
    <div 
      className="h-screen w-screen flex items-center justify-center" 
      style={{ 
        background: 'transparent',
        WebkitAppRegion: 'drag', // Makes entire window draggable
        cursor: 'move'
      } as React.CSSProperties}
    >
      <div 
        style={{ 
          WebkitAppRegion: 'no-drag', // Allow interactions with overlay content
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        } as React.CSSProperties}
      >
        <GuideOverlay
          guideId={guideData.guideId}
          intro={guideData.intro}
          steps={guideData.steps}
          totalSteps={guideData.totalSteps}
          onClose={handleClose}
          onExecute={handleExecute}
          onAbort={handleAbort}
          isExecuting={guideData.isExecuting}
        />
      </div>
    </div>
  );
};
