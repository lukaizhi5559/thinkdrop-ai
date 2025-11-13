/**
 * Guide Overlay - HUD-style movable overlay for displaying guide steps
 * Features:
 * - Transparent, movable, dismissible overlay
 * - Step-by-step navigation (prev/next)
 * - "Do it for me" button for automation
 * - Abort button during execution
 */

import React, { useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Play, Square, X } from 'lucide-react';

interface GuideStep {
  id: string;
  title: string;
  description?: string;
  code?: string;
  explanation?: string;
  expectedDuration?: number;
}

interface GuideOverlayProps {
  guideId: string;
  intro: string;
  steps: GuideStep[];
  totalSteps: number;
  onClose: () => void;
  onExecute: (guideId: string, fromStep: number) => void;
  onAbort: (guideId: string) => void;
  isExecuting?: boolean;
}

export const GuideOverlay: React.FC<GuideOverlayProps> = ({
  guideId,
  intro,
  steps,
  totalSteps,
  onClose,
  onExecute,
  onAbort,
  isExecuting = false
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const currentStep = steps[currentStepIndex];

  // Navigation handlers
  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const handleExecute = () => {
    onExecute(guideId, currentStepIndex);
  };

  const handleAbort = () => {
    onAbort(guideId);
  };

  return (
    <div
      className="bg-gradient-to-br from-gray-700/90 to-gray-800/90 backdrop-blur-xl rounded-lg shadow-2xl border border-gray-500/30"
      style={{
        width: '750px',
        maxHeight: '320px'
      }}
    >
      {/* Header - Draggable area */}
      <div 
        className="bg-black/20 px-4 py-2 rounded-t-lg border-b border-gray-500/20"
        style={{ WebkitAppRegion: 'drag', cursor: 'move' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen size={18} className="text-gray-300" />
            <div>
              <h3 className="text-white font-semibold text-sm">Interactive Guide</h3>
              <p className="text-gray-300 text-xs">
                Step {currentStepIndex + 1} of {totalSteps}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors p-1 hover:bg-white/10 rounded"
            title="Close"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto" style={{ maxHeight: '180px' }}>
        {currentStepIndex === 0 && intro && (
          <div className="mb-4">
            <p className="text-white/90 text-sm leading-relaxed">{intro.split('## Steps:')[0]}</p>
          </div>
        )}

        {currentStep && (
          <div className="space-y-4">
            <h4 className="text-white font-semibold text-lg">{currentStep.title}</h4>
            
            {currentStep.explanation && (
              <div className="bg-blue-400/10 rounded-lg p-3 border border-blue-400/20">
                <p className="text-blue-100 text-sm leading-relaxed">
                  💡 {currentStep.explanation}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="bg-black/20 px-4 py-3 border-t border-gray-500/20 flex items-center justify-between rounded-b-lg">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            disabled={currentStepIndex === 0}
            className="px-3 py-1.5 bg-gray-600/30 hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-1.5 text-sm"
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <button
            onClick={handleNext}
            disabled={currentStepIndex === totalSteps - 1}
            className="px-3 py-1.5 bg-gray-600/30 hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-1.5 text-sm"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Execute/Abort Button */}
        <div>
          {isExecuting ? (
            <button
              onClick={handleAbort}
              className="px-4 py-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2 font-medium text-sm"
            >
              <Square size={14} />
              Abort
            </button>
          ) : (
            <button
              onClick={handleExecute}
              className="px-5 py-1.5 bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white rounded-lg transition-all flex items-center gap-2 shadow-lg font-medium text-sm"
            >
              <Play size={14} />
              Do it for me
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
