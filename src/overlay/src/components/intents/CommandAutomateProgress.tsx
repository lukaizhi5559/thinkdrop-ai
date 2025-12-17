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
  const [isVisible, setIsVisible] = useState(true); // Visible initially for countdown
  const [showAllSteps, setShowAllSteps] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const interpreterRef = useRef<PlanInterpreter | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<number, 'pending' | 'running' | 'completed' | 'failed'>>({});
  const [stepErrors, setStepErrors] = useState<Record<number, string>>({});
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [isReplanning, setIsReplanning] = useState(false);
  const [failedStepIndex, setFailedStepIndex] = useState<number | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(5); // 5 second countdown
  const [automationStarted, setAutomationStarted] = useState(false);
  const [replanAttempts, setReplanAttempts] = useState(0);
  const maxReplanAttempts = 3;
  const replanInFlightRef = useRef(false);

  // Get data from slots
  const steps: AutomationStep[] = slots.steps || [];
  const totalSteps = slots.totalSteps || steps.length;
  const goal = slots.goal || 'Automation in progress';
  const planId = slots.planId;
  const automationPlan = slots.automationPlan;

  // Function to trigger replanning
  const handleReplan = () => {
    console.log('🔄 [AUTOMATE] Triggering replan');
    
    if (!ipcRenderer || !automationPlan) {
      console.error('❌ [AUTOMATE] Cannot replan: missing IPC or automation plan');
      return;
    }
    
    // Send replan request
    ipcRenderer.send('automation:replan-needed', {
      planId,
      failedStepIndex: failedStepIndex || currentStepIndex,
      failedStepDescription: steps[failedStepIndex || currentStepIndex]?.description,
      error: error || 'Element not found',
      previousPlan: automationPlan,
      requestPartialPlan: true
    });
  };

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
        setStepErrors(prev => ({ ...prev, [data.stepIndex]: data.error || 'Step failed' }));
        
        // Set global error status - automation should stop
        setStatus('error');
        setError(`Step ${data.stepIndex + 1} failed: ${data.error || 'Step failed'}`);
      }
    };

    const handleTriggerReplan = (_event: any, data: any) => {
      console.log('🔄 [AUTOMATE] Replan triggered:', data);
      setIsReplanning(true);
      setFailedStepIndex(data.failedStepIndex);
      setStatus('error');
      setError(`${data.reason}\n\nAutomatically replanning...`);
      
      // Trigger replan after a short delay
      setTimeout(() => {
        handleReplan();
      }, 1000);
    };

    const handleClarificationAnswer = (_event: any, data: { answer: string; questionId?: string; stepIndex: number }) => {
      console.log('✅ [AUTOMATE] Received clarification answer:', data);
      
      setIsReplanning(true);
      setStatus('error');
      setError(`Replanning with your answer: "${data.answer}"...`);
      
      // Send replan request with clarification answer
      if (ipcRenderer) {
        ipcRenderer.send('automation:replan-with-clarification', {
          planId,
          failedStepIndex: data.stepIndex,
          clarificationAnswer: data.answer,
          questionId: data.questionId,
          previousPlan: automationPlan
        });
      }
    };

    ipcRenderer.on('automation:step-started', handleStepStarted);
    ipcRenderer.on('automation:step-completed', handleStepCompleted);
    ipcRenderer.on('automation:step-failed', handleStepFailed);
    ipcRenderer.on('automation:trigger-replan', handleTriggerReplan);
    ipcRenderer.on('prompt-bar:clarification-answer', handleClarificationAnswer);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('automation:step-started', handleStepStarted);
        ipcRenderer.removeListener('automation:step-completed', handleStepCompleted);
        ipcRenderer.removeListener('automation:step-failed', handleStepFailed);
        ipcRenderer.removeListener('automation:trigger-replan', handleTriggerReplan);
        ipcRenderer.removeListener('prompt-bar:clarification-answer', handleClarificationAnswer);
      }
    };
  }, [planId, totalSteps]);

  // Countdown timer before automation starts
  useEffect(() => {
    if (countdown === null || countdown <= 0 || automationStarted) return;

    const timer = setTimeout(() => {
      const newCountdown = countdown - 1;
      setCountdown(newCountdown);
      
      if (newCountdown === 0) {
        // Countdown finished - hide window and start automation
        console.log('⏱️  [AUTOMATE] Countdown finished - starting automation');
        setIsVisible(false);
        setAutomationStarted(true);
        setCountdown(null);
        
        // Notify PromptBar that automation is now running (via main process)
        if (ipcRenderer) {
          ipcRenderer.send('automation:started');
        }
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, automationStarted]);

  // Execute automation plan
  useEffect(() => {
    console.log('🔍 [AUTOMATE] Execution useEffect triggered:', {
      hasAutomationPlan: !!automationPlan,
      stepsLength: steps.length,
      automationStarted,
      countdown
    });
    
    if (!automationPlan || !steps.length || !automationStarted) {
      console.log('⏸️  [AUTOMATE] Skipping execution - conditions not met');
      return;
    }

    console.log('🚀 [AUTOMATE] Starting automation execution!');
    
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
        setStepErrors(prev => ({ ...prev, [index]: error }));
        
        // Set global error status - automation will stop
        setStatus('error');
        setError(`Step ${index + 1} failed: ${error}`);
        
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
      },
      onReplanNeeded: (context) => {
        console.log('🔄 [AUTOMATE] Replanning needed:', context);
        
        // Check if a replan is already in flight
        if (replanInFlightRef.current) {
          console.warn('⚠️  [AUTOMATE] Replan already in progress, ignoring duplicate request');
          return;
        }
        
        // Check if we've exceeded max replan attempts
        if (replanAttempts >= maxReplanAttempts) {
          console.error(`❌ [AUTOMATE] Max replan attempts (${maxReplanAttempts}) exceeded`);
          setStatus('error');
          setError(`Automation failed after ${maxReplanAttempts} replan attempts. Please review the plan and try again.`);
          setIsVisible(true); // Show window for user to see error
          if (ipcRenderer) {
            ipcRenderer.send('automation:ended');
          }
          return;
        }
        
        // Mark replan as in-flight
        replanInFlightRef.current = true;
        
        // Increment replan attempts
        setReplanAttempts(prev => prev + 1);
        
        // Track the failed step index for plan merging
        setFailedStepIndex(context.stepIndex);
        setIsReplanning(true);
        
        // Set status to show we're replanning
        setStatus('error');
        setError(`Replanning after step ${context.stepIndex + 1} failure (attempt ${replanAttempts + 1}/${maxReplanAttempts}): ${context.error}`);
        
        // Emit IPC event to trigger replanning
        if (ipcRenderer) {
          ipcRenderer.send('automation:replan-needed', {
            planId,
            failedStepId: context.failedStep.id,
            failedStepIndex: context.stepIndex,
            failedStepDescription: context.failedStep.description,
            error: context.error,
            screenshot: context.screenshot,
            previousPlan: context.previousPlan,
            requestPartialPlan: true  // Request only fix steps, not full plan
          });
        }
      },
      onUserInputNeeded: (context) => {
        console.log('❓ [AUTOMATE] User input needed:', context);
        
        // Set status to show we're waiting for user input
        setStatus('error');
        setError(`Waiting for your answer...`);
        setFailedStepIndex(context.stepIndex);
        
        // Send clarification request to PromptBar
        if (ipcRenderer) {
          ipcRenderer.send('prompt-bar:request-clarification', {
            question: context.message,
            stepDescription: context.step.description,
            stepIndex: context.stepIndex,
            questionId: context.questionId
          });
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
  }, [automationPlan, steps.length, planId, totalSteps, automationStarted]);

  // Handle replan result
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleReplanResult = (_event: any, result: any) => {
      console.log('📥 [AUTOMATE] Received replan result:', result);
      
      // Clear replan in-flight lock
      replanInFlightRef.current = false;
      
      if (result.success && result.newPlan) {
        console.log('✅ [AUTOMATE] New plan received, merging with original plan');
        
        // Check if this is a "fix plan" (partial) or full plan
        const isFixPlan = result.newPlan.steps.length < 10; // Heuristic: fix plans are usually short
        
        if (isFixPlan && failedStepIndex !== null && automationPlan) {
          console.log(`🔧 [AUTOMATE] Detected fix plan with ${result.newPlan.steps.length} steps`);
          
          // Merge fix plan into original plan at the failed step
          const mergedPlan = {
            ...automationPlan,
            steps: [
              // Keep completed steps (0 to failedStepIndex-1)
              ...automationPlan.steps.slice(0, failedStepIndex),
              // Insert fix steps
              ...result.newPlan.steps.map((step: any, idx: number) => ({
                ...step,
                id: `fix_${failedStepIndex}_${idx}`,
                description: `[FIX] ${step.description}`
              })),
              // Keep remaining original steps (failedStepIndex+1 to end)
              ...automationPlan.steps.slice(failedStepIndex + 1)
            ]
          };
          
          console.log(`📋 [AUTOMATE] Merged plan: ${mergedPlan.steps.length} total steps`);
          console.log(`   - Completed: ${failedStepIndex} steps`);
          console.log(`   - Fix: ${result.newPlan.steps.length} steps`);
          console.log(`   - Remaining: ${automationPlan.steps.length - failedStepIndex - 1} steps`);
          
          // Create new interpreter with merged plan
          const newInterpreter = new PlanInterpreter(mergedPlan);
          interpreterRef.current = newInterpreter;
          
          // Reset state for continuation
          setIsReplanning(false);
          setStatus('running');
          setError(null);
          
          // Resume execution from the failed step (now replaced with fix steps)
          console.log(`▶️  [AUTOMATE] Resuming execution from step ${failedStepIndex}`);
          
          // Start execution from the failed step index
          newInterpreter.resumeFrom(failedStepIndex, {
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
                  totalSteps: mergedPlan.steps.length
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
              setStepErrors(prev => ({ ...prev, [index]: error }));
              
              // Set global error status - automation will stop
              setStatus('error');
              setError(`Step ${index + 1} failed: ${error}`);
              
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
            },
            onReplanNeeded: (context) => {
              // Handle nested replanning if a fix step also fails
              console.log('🔄 [AUTOMATE] Nested replanning needed:', context);
              setFailedStepIndex(context.stepIndex);
              setIsReplanning(true);
              setStatus('error');
              setError(`Replanning after step ${context.stepIndex + 1} failure: ${context.error}`);
              
              if (ipcRenderer) {
                ipcRenderer.send('automation:replan-needed', {
                  planId,
                  failedStepId: context.failedStep.id,
                  failedStepIndex: context.stepIndex,
                  failedStepDescription: context.failedStep.description,
                  error: context.error,
                  screenshot: context.screenshot,
                  previousPlan: context.previousPlan,
                  requestPartialPlan: true
                });
              }
            },
            onUserInputNeeded: (context) => {
              console.log('❓ [AUTOMATE] User input needed:', context);
              setStatus('error');
              setError(`${context.message}\n\nQuestion ID: ${context.questionId || 'N/A'}`);
              
              if (ipcRenderer) {
                ipcRenderer.send('automation:user-input-needed', {
                  planId,
                  questionId: context.questionId,
                  message: context.message,
                  stepId: context.step.id,
                  stepIndex: context.stepIndex
                });
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
          
        } else {
          console.log('🔄 [AUTOMATE] Full plan replacement');
          // Full plan replacement (fallback)
          // This would require restarting the entire automation
        }
        
      } else {
        console.error('❌ [AUTOMATE] Replanning failed:', result.error);
        setIsReplanning(false);
        setStatus('error');
        setError(`Replanning failed (attempt ${replanAttempts}/${maxReplanAttempts}): ${result.error}`);
        setIsVisible(true); // Show window so user can see the error
        
        // If we've hit max attempts, stop automation
        if (replanAttempts >= maxReplanAttempts) {
          console.error(`❌ [AUTOMATE] Max replan attempts reached, stopping automation`);
          if (ipcRenderer) {
            ipcRenderer.send('automation:ended');
          }
        }
      }
    };

    ipcRenderer.on('automation:replan-result', handleReplanResult);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('automation:replan-result', handleReplanResult);
      }
    };
  }, [failedStepIndex, automationPlan]);

  // Handle play/stop commands from PromptBar
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleStop = () => {
      console.log('⏸️  [AUTOMATE] Stop requested - showing window and pausing');
      
      // Cancel countdown if still counting down
      if (countdown !== null && countdown > 0) {
        console.log('⏸️  [AUTOMATE] Canceling countdown');
        setCountdown(null);
      }
      
      setIsVisible(true);
      setStatus('paused');
      if (interpreterRef.current) {
        interpreterRef.current.pause();
      }
    };

    const handlePlay = () => {
      console.log('▶️  [AUTOMATE] Play requested - hiding window and resuming');
      
      // If countdown was cancelled, start automation immediately
      if (!automationStarted) {
        setAutomationStarted(true);
      }
      
      setIsVisible(false);
      setStatus('running');
      if (interpreterRef.current) {
        interpreterRef.current.resume();
      }
    };

    ipcRenderer.on('automation:stop', handleStop);
    ipcRenderer.on('automation:play', handlePlay);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('automation:stop', handleStop);
        ipcRenderer.removeListener('automation:play', handlePlay);
      }
    };
  }, [countdown, automationStarted]);

  // Hide overlay during screenshots to prevent it from appearing in vision API calls
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleHideForScreenshot = () => {
      console.log('🙈 [AUTOMATE] Hiding overlay for screenshot');
      setIsVisible(false);
    };

    const handleShowAfterScreenshot = () => {
      console.log('👁️  [AUTOMATE] Showing overlay after screenshot');
      // Only show if we're in paused/debug mode, not during active automation
      if (status === 'paused' || status === 'error' || status === 'completed') {
        setIsVisible(true);
      }
    };

    ipcRenderer.on('automation:hide-overlay', handleHideForScreenshot);
    ipcRenderer.on('automation:show-overlay', handleShowAfterScreenshot);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('automation:hide-overlay', handleHideForScreenshot);
        ipcRenderer.removeListener('automation:show-overlay', handleShowAfterScreenshot);
      }
    };
  }, [status]);

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

  const handleDebugStep = async (stepIndex: number) => {
    console.log(`🐛 [DEBUG] Executing step ${stepIndex + 1}`);
    if (!interpreterRef.current || !automationPlan) return;

    try {
      // Hide window during step execution
      setIsVisible(false);
      setStepStatuses(prev => ({ ...prev, [stepIndex]: 'running' }));
      setCurrentStepIndex(stepIndex);
      
      // Small delay to ensure window is hidden
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Execute single step using interpreter
      const step = automationPlan.steps[stepIndex];
      await interpreterRef.current.executeStep(step);
      
      setStepStatuses(prev => ({ ...prev, [stepIndex]: 'completed' }));
      console.log(`✅ [DEBUG] Step ${stepIndex + 1} completed`);
    } catch (error: any) {
      console.error(`❌ [DEBUG] Step ${stepIndex + 1} failed:`, error.message);
      setStepStatuses(prev => ({ ...prev, [stepIndex]: 'failed' }));
      setStepErrors(prev => ({ ...prev, [stepIndex]: error.message }));
    } finally {
      // Show window again after step completes
      setIsVisible(true);
    }
  };

  const toggleStepExpand = (index: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const currentStep = steps[currentStepIndex];
  const progress = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

  return (
    <div className={`fixed inset-0 flex items-center justify-center pointer-events-none z-50 transition-opacity duration-200 ${
      isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
    }`}>
      <div
        ref={cardRef}
        className="bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl w-full h-full max-h-[80vh] pointer-events-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {countdown !== null && countdown > 0 ? (
              <div className="w-12 h-12 rounded-full bg-blue-500/20 border-2 border-blue-400 flex items-center justify-center">
                <span className="text-2xl font-bold text-blue-400">{countdown}</span>
              </div>
            ) : status === 'running' && !isReplanning ? (
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            ) : isReplanning ? (
              <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
            ) : status === 'paused' ? (
              <Pause className="w-5 h-5 text-yellow-400" />
            ) : status === 'completed' ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : status === 'error' && !isReplanning ? (
              <AlertCircle className="w-5 h-5 text-red-400" />
            ) : null}
            <div>
              <h3 className="text-white font-semibold">
                {countdown !== null && countdown > 0 ? `Starting in ${countdown}...` :
                 isReplanning ? 'Replanning...' :
                 status === 'completed' ? 'Automation Completed' :
                 status === 'paused' ? 'Automation Paused' :
                 status === 'error' ? 'Automation Failed' :
                 'Automation in Progress'}
              </h3>
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
        <div className="px-6 py-4 border-b border-gray-700/50 flex-shrink-0">
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
        <div className="border-b border-gray-700/50 flex-1 overflow-y-auto">
          {/* Toggle Button */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-700/50">
            <button
              onClick={() => setShowAllSteps(!showAllSteps)}
              className="flex-1 flex items-center justify-between hover:bg-gray-800/50 transition-colors rounded px-2 py-1"
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
            <button
              onClick={() => setDebugMode(!debugMode)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                debugMode 
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                  : 'bg-gray-700/50 text-gray-400 border border-gray-600/30 hover:bg-gray-700'
              }`}
            >
              {debugMode ? '🐛 Debug ON' : 'Debug'}
            </button>
          </div>

          {/* All Steps List */}
          {showAllSteps && (
            <div className="px-6 pb-4">
              <div className="space-y-2">
                {steps.map((step, index) => {
                  const stepStatus = stepStatuses[index] || 'pending';
                  const isCurrent = index === currentStepIndex;
                  const stepError = stepErrors[index];
                  const isExpanded = expandedSteps.has(index);
                  const hasFailed = stepStatus === 'failed';
                  
                  return (
                    <div
                      key={step.id}
                      className={`rounded-lg transition-colors ${
                        isCurrent ? 'bg-blue-500/10 border border-blue-500/30' : 
                        hasFailed ? 'bg-red-500/5 border border-red-500/20' :
                        'bg-gray-800/30'
                      }`}
                    >
                      {/* Step Header */}
                      <div className="flex items-start gap-3 p-3">
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

                        {/* Debug Controls */}
                        {debugMode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDebugStep(index);
                            }}
                            disabled={stepStatus === 'running'}
                            className="flex-shrink-0 p-1.5 rounded hover:bg-purple-500/20 text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Execute this step"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}

                        {/* Expand Icon */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStepExpand(index);
                          }}
                          className="flex-shrink-0 p-1 hover:bg-gray-700/50 rounded transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronUp className={`w-4 h-4 ${
                              hasFailed ? 'text-red-400' : 'text-gray-400'
                            }`} />
                          ) : (
                            <ChevronDown className={`w-4 h-4 ${
                              hasFailed ? 'text-red-400' : 'text-gray-400'
                            }`} />
                          )}
                        </button>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pl-12 space-y-2">
                          {/* Error Details */}
                          {hasFailed && stepError && (
                            <div className="bg-red-900/20 border border-red-500/30 rounded p-3">
                              <p className="text-xs font-medium text-red-300 mb-1">Error:</p>
                              <p className="text-xs text-red-400 font-mono">
                                {stepError}
                              </p>
                            </div>
                          )}
                          
                          {/* Step Metadata */}
                          <div className="bg-gray-800/50 border border-gray-700/50 rounded p-3">
                            <p className="text-xs font-medium text-gray-300 mb-2">Step Metadata:</p>
                            <div className="space-y-1">
                              <div className="flex gap-2">
                                <span className="text-xs text-gray-500 w-16">Type:</span>
                                <span className="text-xs text-gray-300 font-mono">{step.kind.type}</span>
                              </div>
                              <div className="flex gap-2">
                                <span className="text-xs text-gray-500 w-16">ID:</span>
                                <span className="text-xs text-gray-400 font-mono">{step.id}</span>
                              </div>
                              {Object.entries(step.kind).filter(([key]) => key !== 'type').map(([key, value]) => (
                                <div key={key} className="flex gap-2">
                                  <span className="text-xs text-gray-500 w-16 capitalize">{key}:</span>
                                  <span className="text-xs text-gray-300 font-mono break-all">
                                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
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
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0">
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
