/**
 * Command Automate Progress Component
 * 
 * Displays automation plan execution progress with real-time step updates
 * Shows current step, progress bar, and allows pause/cancel
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { Play, Pause, X, CheckCircle, Loader2, AlertCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { PlanInterpreter } from '../../automation/interpreter';

const ipcRenderer = (window as any).electron?.ipcRenderer;

interface CommandAutomateProgressProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

interface AutomationStep {
  id: string;
  description: string;
  kind: {
    type: string;
    [key: string]: any;
  };
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

export default function CommandAutomateProgress({ payload, onEvent }: CommandAutomateProgressProps) {
  const { slots } = payload;
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [status, setStatus] = useState<'running' | 'paused' | 'completed' | 'error'>('running');
  const [error, setError] = useState<string | null>(null);
  const [isVisible] = useState(true);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const interpreterRef = useRef<PlanInterpreter | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<number, 'pending' | 'running' | 'completed' | 'failed'>>({})

  // Get data from slots
  const steps: AutomationStep[] = slots.steps || [];
  const totalSteps = slots.totalSteps || steps.length;
  const goal = slots.goal || 'Automation in progress';
  const planId = slots.planId;
  const automationPlan = slots.automationPlan;

  // Listen for step progress events from main process
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleStepStarted = (_event: any, data: any) => {
      if (data.planId === planId) {
        setCurrentStepIndex(data.stepIndex);
        setStatus('running');
        setStepStatuses(prev => ({ ...prev, [data.stepIndex]: 'running' }));
      }
    };

    const handleStepCompleted = (_event: any, data: any) => {
      if (data.planId === planId) {
        setStepStatuses(prev => ({ ...prev, [data.stepIndex]: 'completed' }));
        // Update step status
        if (data.stepIndex < totalSteps - 1) {
          setCurrentStepIndex(data.stepIndex + 1);
        } else {
          setStatus('completed');
        }
      }
    };

    const handleStepFailed = (_event: any, data: any) => {
      if (data.planId === planId) {
        setStepStatuses(prev => ({ ...prev, [data.stepIndex]: 'failed' }));
        setStatus('error');
        setError(data.error || 'Step failed');
      }
    };

    ipcRenderer.on('automation:step-started', handleStepStarted);
    ipcRenderer.on('automation:step-completed', handleStepCompleted);
    ipcRenderer.on('automation:step-failed', handleStepFailed);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('automation:step-started', handleStepStarted);
        ipcRenderer.removeListener('automation:step-completed', handleStepCompleted);
        ipcRenderer.removeListener('automation:step-failed', handleStepFailed);
      }
    };
  }, [planId, totalSteps]);

  // Execute automation plan
  useEffect(() => {
    if (!automationPlan || !steps.length) return;

    // Create interpreter and start execution
    const interpreter = new PlanInterpreter(automationPlan);
    interpreterRef.current = interpreter;

    // Notify ghost overlay that automation is starting
    if (ipcRenderer) {
      ipcRenderer.send('automation:started');
    }

    // Start execution in background
    interpreter.execute({
      onStepStart: (step, index) => {
        setCurrentStepIndex(index);
        setStatus('running');
        setStepStatuses(prev => ({ ...prev, [index]: 'running' }));
        
        // Emit IPC event for logging/tracking
        if (ipcRenderer) {
          ipcRenderer.send('automation:step-started', {
            planId,
            stepId: step.id,
            stepIndex: index,
            totalSteps
          });
        }
      },
      onStepComplete: (step, index) => {
        setStepStatuses(prev => ({ ...prev, [index]: 'completed' }));
        // Emit IPC event
        if (ipcRenderer) {
          ipcRenderer.send('automation:step-completed', {
            planId,
            stepId: step.id,
            stepIndex: index
          });
        }
      },
      onStepFailed: (step, index, error) => {
        setStepStatuses(prev => ({ ...prev, [index]: 'failed' }));
        setStatus('error');
        setError(error);
        // Emit IPC event
        if (ipcRenderer) {
          ipcRenderer.send('automation:step-failed', {
            planId,
            stepId: step.id,
            stepIndex: index,
            error: error
          });
        }
      },
      onComplete: () => {
        setStatus('completed');
        
        // Emit IPC event
        if (ipcRenderer) {
          ipcRenderer.send('automation:completed', { planId });
          ipcRenderer.send('automation:ended');
        }
      }
    }).catch((err) => {
      setStatus('error');
      setError(err.message);
      
      // Notify ghost overlay that automation ended
      if (ipcRenderer) {
        ipcRenderer.send('automation:ended');
      }
    });

    // Cleanup on unmount
    return () => {
      if (interpreterRef.current) {
        interpreterRef.current.cancel();
      }
      
      // Notify ghost overlay that automation ended
      if (ipcRenderer) {
        ipcRenderer.send('automation:ended');
      }
    };
  }, [automationPlan, steps.length, planId, totalSteps]);

  // Position window based on screen dimensions
  useEffect(() => {
    if (!ipcRenderer) return;

    const timer = setTimeout(() => {
      const screenWidth = window.screen.availWidth;
      const screenHeight = window.screen.availHeight;
      
      // Use 50% width for automation progress (narrower than web search)
      const cardWidth = Math.floor(screenWidth * 0.5);
      const cardHeight = Math.floor(screenHeight * 0.7); // 70% height
      const x = Math.floor((screenWidth - cardWidth) / 2);
      const y = Math.floor((screenHeight - cardHeight) / 2);
      
      ipcRenderer.send('overlay:position-intent', {
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        animate: false
      });
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Handle mouse events for click-through
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const element = cardRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const isOverCard = 
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      if (ipcRenderer) {
        ipcRenderer.send('intent-window:set-ignore-mouse', !isOverCard);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handlePause = () => {
    if (status === 'running') {
      setStatus('paused');
      if (interpreterRef.current) {
        interpreterRef.current.pause();
      }
      if (ipcRenderer) {
        ipcRenderer.send('automation:pause', { planId });
      }
    } else if (status === 'paused') {
      setStatus('running');
      if (interpreterRef.current) {
        interpreterRef.current.resume();
      }
      if (ipcRenderer) {
        ipcRenderer.send('automation:resume', { planId });
      }
    }
  };

  const handleCancel = () => {
    if (interpreterRef.current) {
      interpreterRef.current.cancel();
    }
    if (ipcRenderer) {
      ipcRenderer.send('automation:cancel', { planId });
    }
    onEvent({ type: 'close' });
  };

  const handleRetry = () => {
    setStatus('running');
    setError(null);
    setCurrentStepIndex(0);
    if (ipcRenderer) {
      ipcRenderer.send('automation:retry', { planId });
    }
  };

  const currentStep = steps[currentStepIndex];
  const progress = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
      <div
        ref={cardRef}
        className="bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl w-full h-full max-h-[80vh] pointer-events-auto overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status === 'running' && (
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            )}
            {status === 'paused' && (
              <Pause className="w-5 h-5 text-yellow-400" />
            )}
            {status === 'completed' && (
              <CheckCircle className="w-5 h-5 text-green-400" />
            )}
            {status === 'error' && (
              <AlertCircle className="w-5 h-5 text-red-400" />
            )}
            <div>
              <h3 className="text-white font-semibold">Automation in Progress</h3>
              <p className="text-gray-400 text-sm">{goal}</p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-4 border-b border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">
              Step {currentStepIndex + 1} of {totalSteps}
            </span>
            <span className="text-sm text-gray-400">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                status === 'error' ? 'bg-red-500' :
                status === 'completed' ? 'bg-green-500' :
                status === 'paused' ? 'bg-yellow-500' :
                'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Steps Stepper */}
        <div className="border-b border-gray-700/50">
          {/* Toggle Button */}
          <button
            onClick={() => setShowAllSteps(!showAllSteps)}
            className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
          >
            <span className="text-sm text-gray-300">
              {showAllSteps ? 'Hide' : 'Show'} all steps ({totalSteps})
            </span>
            {showAllSteps ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>

          {/* All Steps List */}
          {showAllSteps && (
            <div className="px-6 pb-4 max-h-[400px] overflow-y-auto">
              <div className="space-y-2">
                {steps.map((step, index) => {
                  const stepStatus = stepStatuses[index] || 'pending';
                  const isCurrent = index === currentStepIndex;
                  
                  return (
                    <div
                      key={step.id}
                      className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                        isCurrent ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-gray-800/30'
                      }`}
                    >
                      {/* Step Number & Status Icon */}
                      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                        {stepStatus === 'completed' ? (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        ) : stepStatus === 'running' ? (
                          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                        ) : stepStatus === 'failed' ? (
                          <AlertCircle className="w-5 h-5 text-red-400" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-600 flex items-center justify-center">
                            <span className="text-[10px] text-gray-500">{index + 1}</span>
                          </div>
                        )}
                      </div>

                      {/* Step Details */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium mb-1 ${
                          stepStatus === 'completed' ? 'text-green-300' :
                          stepStatus === 'running' ? 'text-blue-300' :
                          stepStatus === 'failed' ? 'text-red-300' :
                          'text-gray-400'
                        }`}>
                          {step.description}
                        </p>
                        <p className="text-xs text-gray-500">
                          {step.kind.type}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Current Step (when collapsed) */}
          {!showAllSteps && currentStep && status !== 'completed' && (
            <div className="px-6 pb-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="mt-1">
                  {status === 'running' ? (
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  ) : status === 'paused' ? (
                    <Pause className="w-4 h-4 text-yellow-400" />
                  ) : (
                    <Clock className="w-4 h-4 text-gray-400" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium mb-1">
                    {currentStep.description}
                  </p>
                  <p className="text-gray-400 text-xs">
                    Action: {currentStep.kind.type}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error State */}
        {status === 'error' && error && (
          <div className="px-6 py-4 bg-red-500/10 border-b border-red-500/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-300 text-sm font-medium mb-1">
                  Automation Failed
                </p>
                <p className="text-red-400 text-xs">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Completed State */}
        {status === 'completed' && (
          <div className="px-6 py-4 bg-green-500/10 border-b border-green-500/20">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <p className="text-green-300 text-sm font-medium">
                Automation completed successfully!
              </p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Plan ID: {planId?.substring(0, 12)}...
          </div>
          <div className="flex items-center gap-2">
            {status === 'error' && (
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors"
              >
                Retry
              </button>
            )}
            {(status === 'running' || status === 'paused') && (
              <button
                onClick={handlePause}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
              >
                {status === 'running' ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Resume
                  </>
                )}
              </button>
            )}
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              {status === 'completed' ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
