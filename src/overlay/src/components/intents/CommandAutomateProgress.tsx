/**
 * Command Automate Progress Component
 * 
 * Displays automation plan execution progress with real-time step updates
 * Shows current step, progress bar, and allows pause/cancel
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { Play, Pause, X, CheckCircle, Loader2, AlertCircle, Clock, ChevronDown, ChevronUp, Camera } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { PlanInterpreter } from '../../automation/interpreter';
import { ComputerUseClient, ClarificationQuestion } from '../../automation/ComputerUseClient';

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

interface ActionHistoryItem {
  iteration: number;
  type: string;
  reasoning: string;
  timestamp: number;
  status: 'completed' | 'failed';
  error?: string;
}

export default function CommandAutomateProgress({ payload, onEvent }: CommandAutomateProgressProps) {
  const { slots } = payload;
  
  // Debug: Log component render and payload
  console.log('🎬 [AUTOMATE] CommandAutomateProgress rendered', {
    hasSlots: !!slots,
    slotsKeys: slots ? Object.keys(slots) : [],
    mode: slots?.mode,
    goal: slots?.goal,
    wsUrl: slots?.wsUrl
  });
  
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [status, setStatus] = useState<'running' | 'paused' | 'completed' | 'error'>('running');
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true); // Visible by default to show automation progress
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
  const computerUseClientRef = useRef<ComputerUseClient | null>(null);
  
  // AI Reasoning state (for Computer Use mode)
  const [currentReasoning, setCurrentReasoning] = useState<string | null>(null);
  const [currentActionType, setCurrentActionType] = useState<string | null>(null);
  
  // Timing state (for Computer Use mode)
  const [currentTiming, setCurrentTiming] = useState<{
    llmDecisionMs?: number;
    totalProcessingMs?: number;
    timeSinceLastActionMs?: number;
  } | null>(null);
  
  // Plan generation state (for hybrid plan + computer-use)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<any | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  
  // Action history for review after completion
  const [actionHistory, setActionHistory] = useState<ActionHistoryItem[]>([]);
  
  // Clarification state
  const [clarificationQuestions, setClarificationQuestions] = useState<ClarificationQuestion[]>([]);
  const clarificationResolveRef = useRef<((answers: Record<string, string>) => void) | null>(null);
  
  // Screenshot indicator state
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  
  // Completion result state (for comparison tasks and final summaries)
  const [completionResult, setCompletionResult] = useState<any>(null);

  // Get data from slots
  const steps: AutomationStep[] = slots.steps || [];
  const totalSteps = slots.totalSteps || steps.length;
  const goal = slots.goal || 'Automation in progress';
  const planId = slots.planId;
  const automationPlan = slots.automationPlan;
  
  // Check if this is Computer Use streaming mode
  const mode = slots.mode;
  const isComputerUseMode = mode === 'computer-use-streaming';
  const wsUrl = slots.wsUrl;
  const initialScreenshot = slots.screenshot;
  const context = slots.context;
  
  console.log('🔍 [AUTOMATE] Mode detection:', {
    mode,
    isComputerUseMode,
    wsUrl,
    hasScreenshot: !!initialScreenshot,
    hasContext: !!context
  });

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

  // Listen for screenshot hide/show events to prevent UI interference
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleHideForScreenshot = () => {
      console.log('🙈 [AUTOMATE] Hiding UI for screenshot capture');
      setIsVisible(false);
    };

    const handleShowAfterScreenshot = () => {
      console.log('👁️ [AUTOMATE] Showing UI after screenshot capture');
      // Only show if not in countdown or if automation is active
      if (countdown === null || countdown <= 0) {
        setIsVisible(true);
      }
    };

    ipcRenderer.on('overlay:hide-for-screenshot', handleHideForScreenshot);
    ipcRenderer.on('overlay:show-after-screenshot', handleShowAfterScreenshot);

    return () => {
      ipcRenderer.removeListener('overlay:hide-for-screenshot', handleHideForScreenshot);
      ipcRenderer.removeListener('overlay:show-after-screenshot', handleShowAfterScreenshot);
    };
  }, [countdown]);

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
      
      // CRITICAL: Only handle replan for static plan mode
      // Computer Use mode has its own handler in a separate useEffect (line 945)
      if (!isComputerUseMode) {
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
      }
      // For Computer Use mode, do nothing - let the other handler (line 945) process it
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

  // Generate plan for Computer Use mode
  const generatePlan = async () => {
    console.log('🎯 [AUTOMATE] Generating plan for:', goal);
    setIsGeneratingPlan(true);
    setPlanError(null);
    
    try {
      // Get backend URL and API key from slots (passed from main process)
      const backendUrl = slots.backendUrl || 'http://localhost:4000';
      const apiKey = slots.apiKey || 'test-api-key-123';
      
      // Strip data URL prefix from screenshot if present
      let screenshotBase64 = initialScreenshot;
      if (screenshotBase64 && screenshotBase64.startsWith('data:')) {
        const base64Index = screenshotBase64.indexOf('base64,');
        if (base64Index !== -1) {
          screenshotBase64 = screenshotBase64.substring(base64Index + 7);
          console.log('🔧 [AUTOMATE] Stripped data URL prefix from screenshot');
        }
      }
      
      // Call /plan API
      const response = await fetch(`${backendUrl}/api/nutjs/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({
          command: goal,
          intent: 'command_automate',
          context: {
            screenshot: screenshotBase64 ? { base64: screenshotBase64, mimeType: 'image/png' } : undefined,
            activeApp: context?.activeApp,
            activeUrl: context?.activeUrl,
            os: 'darwin'
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`Plan API failed: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ [AUTOMATE] Plan generated:', result);
      
      // Check if clarification is needed
      if (result.needsClarification && result.clarificationQuestions) {
        console.log('❓ [AUTOMATE] Plan needs clarification');
        setClarificationQuestions(result.clarificationQuestions);
        setIsGeneratingPlan(false);
        return;
      }
      
      // Store generated plan
      if (result.success && result.plan) {
        setGeneratedPlan(result.plan);
        console.log('📋 [AUTOMATE] Plan ready with', result.plan.steps?.length || 0, 'steps');
        
        // Request window resize to fit plan content
        if (ipcRenderer) {
          // const stepCount = result.plan.steps?.length || 0;
          // const estimatedHeight = Math.min(
          //   200 + (stepCount * 100) + 150, // Header + steps + footer
          //   800 // Max height
          // );
          // ipcRenderer.send('intent-overlay:resize', {
          //   width: 800,
          //   height: estimatedHeight
          // });
          // Ensure window is clickable for buttons
          ipcRenderer.send('intent-overlay:set-clickable', true);
        }
      } else {
        throw new Error('Plan API returned no plan');
      }
    } catch (error: any) {
      console.error('❌ [AUTOMATE] Plan generation failed:', error);
      setPlanError(error.message || 'Failed to generate plan');
    } finally {
      setIsGeneratingPlan(false);
    }
  };
  
  // Start execution with generated plan
  const startPlanExecution = () => {
    if (!generatedPlan) {
      console.error('❌ [AUTOMATE] Cannot start - no plan available');
      return;
    }
    
    console.log('🚀 [AUTOMATE] Starting plan execution');
    setIsVisible(false);
    setAutomationStarted(true);
    setCountdown(null);
    
    if (ipcRenderer) {
      console.log('📤 [AUTOMATE] Sending automation:started to main process');
      ipcRenderer.send('automation:started');
    }
  };
  
  // Countdown timer before automation starts
  useEffect(() => {
    // Debug: Log all conditions
    console.log('🔍 [AUTOMATE] useEffect check:', {
      isComputerUseMode,
      automationStarted,
      isGeneratingPlan,
      generatedPlan: !!generatedPlan,
      planError: !!planError,
      shouldGeneratePlan: isComputerUseMode && !automationStarted && !isGeneratingPlan && !generatedPlan && !planError
    });
    
    // Computer Use mode: Generate plan first, then wait for user to start
    if (isComputerUseMode && !automationStarted && !isGeneratingPlan && !generatedPlan && !planError) {
      console.log('🌐 [AUTOMATE] Computer Use mode - generating plan');
      generatePlan();
      return;
    }
    
    // Static plan mode: use countdown
    if (isComputerUseMode || countdown === null || countdown <= 0 || automationStarted) return;

    const timer = setTimeout(() => {
      const newCountdown = countdown - 1;
      setCountdown(newCountdown);
      
      if (newCountdown === 0) {
        // Countdown finished - hide window and start automation
        console.log('⏱️  [AUTOMATE] Countdown finished - starting automation');
        setIsVisible(false); // Hide during execution for clean screenshots
        setAutomationStarted(true);
        setCountdown(null);
        
        // Notify PromptBar that automation is now running (via main process)
        if (ipcRenderer) {
          console.log('📤 [AUTOMATE] Sending automation:started to main process');
          ipcRenderer.send('automation:started');
        }
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, automationStarted, isComputerUseMode]);

  // Execute Computer Use streaming mode
  useEffect(() => {
    if (!isComputerUseMode || !automationStarted || !wsUrl) {
      return;
    }

    console.log('🌐 [AUTOMATE] Starting Computer Use streaming mode');
    
    const client = new ComputerUseClient(wsUrl);
    computerUseClientRef.current = client;

    // Define callbacks for both execute methods
    const callbacks = {
      onAction: (action: any, iteration: number, timing?: any) => {
        console.log('🎬 [AUTOMATE] Executing action ' + iteration + ':', action.type);
        console.log('💭 [AUTOMATE] AI Reasoning:', action.reasoning);
        
        // Extract timing data if available
        if (timing) {
          console.log('⏱️ [AUTOMATE] Timing:', {
            llmDecision: `${((timing.llmDecisionMs || 0) / 1000).toFixed(2)}s`,
            totalProcessing: `${((timing.totalProcessingMs || 0) / 1000).toFixed(2)}s`,
            frontendExecution: timing.timeSinceLastActionMs ? `${(timing.timeSinceLastActionMs / 1000).toFixed(2)}s` : 'N/A'
          });
          setCurrentTiming(timing);
        }
        
        // Update state with current action details
        setCurrentReasoning(action.reasoning || null);
        setCurrentActionType(action.type || null);
        setCurrentStepIndex(iteration);
        setStatus('running');
        
        // Record action in history
        setActionHistory(prev => [
          ...prev,
          {
            iteration,
            type: action.type,
            reasoning: action.reasoning || 'No reasoning provided',
            timestamp: Date.now(),
            status: 'completed'
          }
        ]);
        
        // Show action in UI
        if (ipcRenderer) {
          ipcRenderer.send('automation:step-started', {
            planId: `computer-use-${Date.now()}`,
            stepIndex: iteration,
            totalSteps: 20 // Max iterations
          });
        }
      },
      onClarificationNeeded: async (questions: ClarificationQuestion[], iteration: number) => {
        console.log(`❓ [AUTOMATE] Clarification needed (iteration ${iteration}):`, questions);
        
        // Show clarification questions in compact card and wait for user input
        return new Promise<Record<string, string>>((resolve) => {
          setClarificationQuestions(questions);
          clarificationResolveRef.current = resolve;
          
          // Send first question to prompt bar for user input
          if (ipcRenderer && questions.length > 0) {
            console.log('📤 [AUTOMATE] Sending IPC event: prompt-bar:request-clarification');
            console.log('📤 [AUTOMATE] IPC data:', {
              question: questions.map((q, idx) => `Q${idx + 1}: ${q.question}`).join('\n\n'),
              stepDescription: 'Computer Use Automation',
              stepIndex: iteration,
              questionId: questions[0].id
            });
            ipcRenderer.send('prompt-bar:request-clarification', {
              question: questions.map((q, idx) => `Q${idx + 1}: ${q.question}`).join('\n\n'),
              stepDescription: 'Computer Use Automation',
              stepIndex: iteration,
              questionId: questions[0].id
            });
            console.log('✅ [AUTOMATE] IPC event sent successfully');
          } else {
            console.error('❌ [AUTOMATE] Cannot send IPC event:', {
              hasIpcRenderer: !!ipcRenderer,
              questionsLength: questions.length
            });
          }
        });
      },
      onComplete: (result: any) => {
        console.log('✅ [AUTOMATE] Computer Use completed:', result);
        setStatus('completed');
        setIsVisible(true); // Show on completion for review
        setCompletionResult(result); // Store result for display (comparison verdicts, etc.)
        
        if (ipcRenderer) {
          ipcRenderer.send('automation:completed', {
            planId: `computer-use-${Date.now()}`,
            success: true,
            result
          });
          // Main process will forward automation:state to PromptBar with isRunning=false
          ipcRenderer.send('automation:ended');
        }
      },
      onError: (error: string) => {
        console.error('❌ [AUTOMATE] Computer Use error:', error);
        setStatus('error');
        setError(error);
        setIsVisible(true); // Show on error
        
        // Mark last action as failed
        setActionHistory(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            status: 'failed',
            error
          };
          return updated;
        });
        
        if (ipcRenderer) {
          ipcRenderer.send('automation:completed', {
            planId: `computer-use-${Date.now()}`,
            success: false,
            error
          });
          // Main process will forward automation:state to PromptBar with isRunning=false
          ipcRenderer.send('automation:ended');
        }
      },
      onStatus: (message: string) => {
        console.log('ℹ️ [AUTOMATE] Status:', message);
      }
    };
    
    // Use executeWithPlan if plan is available (hybrid approach), otherwise use regular execute
    const executePromise = generatedPlan 
      ? client.executeWithPlan(generatedPlan, initialScreenshot, context, callbacks)
      : client.execute(goal, initialScreenshot, context, callbacks);
    
    executePromise.catch((err) => {
      console.error('❌ [AUTOMATE] Computer Use failed:', err);
      setStatus('error');
      setError(err.message);
      // Show panel only on error so user can see what went wrong
      setIsVisible(true);
    });

    return () => {
      if (computerUseClientRef.current) {
        computerUseClientRef.current.close();
      }
      
      if (ipcRenderer) {
        ipcRenderer.send('automation:ended');
      }
    };
  }, [isComputerUseMode, automationStarted, wsUrl, goal, initialScreenshot, context]);

  // Execute static automation plan
  useEffect(() => {
    console.log('🔍 [AUTOMATE] Execution useEffect triggered:', {
      hasAutomationPlan: !!automationPlan,
      stepsLength: steps.length,
      automationStarted,
      countdown,
      isComputerUseMode
    });
    
    // Skip if Computer Use mode
    if (isComputerUseMode) {
      console.log('⏸️  [AUTOMATE] Skipping static plan - using Computer Use mode');
      return;
    }
    
    if (!automationPlan || !steps.length || !automationStarted) {
      console.log('⏸️  [AUTOMATE] Skipping execution - conditions not met');
      return;
    }

    console.log('🚀 [AUTOMATE] Starting static plan execution!');
    
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
        setIsVisible(true); // Keep window visible to show completion
        
        // Emit IPC event
        if (ipcRenderer) {
          ipcRenderer.send('automation:completed', { planId });
          // Don't send automation:ended - keep panel visible to show success
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
        
        // CRITICAL: Mark replan as in-flight FIRST to block all other replan attempts
        replanInFlightRef.current = true;
        
        // CRITICAL: Stop the interpreter immediately to prevent it from continuing execution
        if (interpreterRef.current) {
          console.log('🛑 [AUTOMATE] Stopping interpreter to prevent concurrent replans');
          interpreterRef.current.stop();
        }
        
        // Increment replan attempts
        setReplanAttempts(prev => prev + 1);
        
        // Track the failed step index for plan merging
        setFailedStepIndex(context.stepIndex);
        setIsReplanning(true);
        
        // Set status to show we're replanning
        setStatus('error');
        setError(`Replanning after step ${context.stepIndex + 1} failure (attempt ${replanAttempts + 1}/${maxReplanAttempts}): ${context.error}`);
        
        console.log('🔒 [AUTOMATE] Replan lock acquired, interpreter stopped, sending replan request...');
        
        // Emit IPC event to trigger replanning
        // Use context.stepIndex directly, not state (state updates are async)
        if (ipcRenderer) {
          ipcRenderer.send('automation:replan-needed', {
            planId,
            previousPlan: context.previousPlan,
            context: {
              requestPartialPlan: true,  // Request only fix steps, not full plan
              isReplanning: true,
              failedStepId: context.failedStep.id,
              failedStepIndex: context.stepIndex,  // Use direct value, not state
              failedStepDescription: context.failedStep.description,
              error: context.error,
              screenshot: context.screenshot
            }
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
      
      // DO NOT clear replan lock here - it will be cleared after new plan starts executing
      
      // Check if backend needs clarification
      if (result.success && result.needsClarification && result.questions) {
        console.log('❓ [AUTOMATE] Backend needs clarification during replan:', result.questions);
        
        // Clear replan lock since we're waiting for user input
        replanInFlightRef.current = false;
        
        // Update UI to show waiting for clarification
        setStatus('error');
        setError(`Waiting for your answer to: "${result.questions[0].text}"`);
        setIsReplanning(false);
        
        // Questions are already forwarded to prompt bar by main process
        // We just need to wait for the answer via handleClarificationAnswer
        return;
      }
      
      if (result.success && result.newPlan) {
        console.log('✅ [AUTOMATE] New plan received, merging with original plan');
        
        // Check if this is a "fix plan" (partial) or full plan
        // Fix plans should be explicitly marked or have metadata indicating they're partial
        const isFixPlan = result.newPlan.isPartial || 
                         (result.newPlan.steps.length < 5 && failedStepIndex !== null);
        
        // Safety check: If we've already replanned multiple times, stop
        if (replanAttempts >= maxReplanAttempts) {
          console.error(`❌ [AUTOMATE] Max replan attempts (${maxReplanAttempts}) reached, stopping`);
          replanInFlightRef.current = false;
          setStatus('error');
          setError(`Automation failed after ${maxReplanAttempts} replan attempts`);
          setIsVisible(true);
          if (ipcRenderer) {
            ipcRenderer.send('automation:ended');
          }
          return;
        }
        
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
          
          // Reset replan lock to allow future replans
          newInterpreter.resetReplanLock();
          
          // Reset state for continuation
          setIsReplanning(false);
          setStatus('running');
          setError(null);
          
          // Resume execution from the failed step (now replaced with fix steps)
          console.log(`▶️  [AUTOMATE] Resuming execution from step ${failedStepIndex}`);
          
          // Clear replan in-flight lock now that new plan is starting
          replanInFlightRef.current = false;
          console.log('🔓 [AUTOMATE] Replan lock released - new plan executing');
          
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
              
              // CRITICAL: Check if replan already in flight to prevent concurrent replans
              if (replanInFlightRef.current) {
                console.warn('⚠️  [AUTOMATE] Nested replan blocked - replan already in progress');
                return;
              }
              
              // Check max replan attempts
              if (replanAttempts >= maxReplanAttempts) {
                console.error(`❌ [AUTOMATE] Max replan attempts (${maxReplanAttempts}) reached in nested replan, stopping`);
                setStatus('error');
                setError(`Automation failed after ${maxReplanAttempts} replan attempts`);
                return;
              }
              
              // Mark replan as in-flight
              replanInFlightRef.current = true;
              console.log('🔒 [AUTOMATE] Nested replan lock acquired');
              
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
          console.error('❌ [AUTOMATE] Full plan replacement detected - this should not happen!');
          console.error(`   Backend sent ${result.newPlan.steps.length} steps instead of partial fix`);
          console.error(`   Failed step was: ${failedStepIndex}, plan had ${automationPlan?.steps.length || 0} steps`);
          
          // Clear replan lock since we're stopping
          replanInFlightRef.current = false;
          console.log('🔓 [AUTOMATE] Replan lock released - stopping due to full plan replacement');
          
          setIsReplanning(false);
          setStatus('error');
          setError(`Backend error: Received full plan replacement (${result.newPlan.steps.length} steps) instead of partial fix. Automation stopped to prevent infinite loop.`);
          setIsVisible(true);
          
          // Stop automation completely
          if (ipcRenderer) {
            ipcRenderer.send('automation:ended');
          }
          if (interpreterRef.current) {
            interpreterRef.current.cancel();
          }
        }
        
      } else {
        console.error('❌ [AUTOMATE] Replanning failed:', result.error);
        
        // Clear replan lock on failure
        replanInFlightRef.current = false;
        console.log('🔓 [AUTOMATE] Replan lock released due to failure');
        
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
  }, [countdown, automationStarted, isComputerUseMode, isGeneratingPlan, generatedPlan, planError]);

  // Ensure window is properly sized and clickable when plan is shown
  useEffect(() => {
    console.log('🔍 [AUTOMATE] Window resize useEffect triggered:', {
      isComputerUseMode,
      hasGeneratedPlan: !!generatedPlan,
      automationStarted,
      hasIpcRenderer: !!ipcRenderer
    });
    
    if (isComputerUseMode && generatedPlan && !automationStarted && ipcRenderer) {
      // const stepCount = generatedPlan.steps?.length || 0;
      // const estimatedHeight = Math.min(
      //   200 + (stepCount * 100) + 150, // Header + steps + footer
      //   800 // Max height
      // );
      
      // console.log(`📐 [AUTOMATE] Requesting window resize to 800x${estimatedHeight} and making clickable`);
      
      // // Force resize and make clickable
      // ipcRenderer.send('intent-overlay:resize', {
      //   width: 800,
      //   height: estimatedHeight
      // });
      ipcRenderer.send('intent-overlay:set-clickable', true);
      
      // Also try to bring window to front
      ipcRenderer.send('intent-overlay:focus');
    }
  }, [generatedPlan, automationStarted, isComputerUseMode, ipcRenderer]);

  // Listen for clarification answers from prompt bar
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleClarificationAnswer = (_event: any, data: { answer: string; questionId?: string }) => {
      console.log('✅ [AUTOMATE] Received clarification answer:', data);
      
      if (clarificationResolveRef.current && clarificationQuestions.length > 0) {
        // Build answers object with all question IDs mapped to the single answer
        // (User provides one combined answer for all questions)
        const answers: Record<string, string> = {};
        clarificationQuestions.forEach((q) => {
          answers[q.id] = data.answer;
        });
        
        console.log('📤 [AUTOMATE] Resolving clarification with answers:', answers);
        clarificationResolveRef.current(answers);
        clarificationResolveRef.current = null;
        
        // Clear clarification questions
        setClarificationQuestions([]);
      }
    };

    ipcRenderer.on('prompt-bar:clarification-answer', handleClarificationAnswer);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('prompt-bar:clarification-answer', handleClarificationAnswer);
      }
    };
  }, [clarificationQuestions]);

  // Show camera indicator during screenshots
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleStartIndicator = () => {
      console.log('📸 [AUTOMATE] Screenshot starting - showing camera indicator');
      setIsCapturingScreenshot(true);
    };

    const handleEndIndicator = () => {
      console.log('📸 [AUTOMATE] Screenshot complete - hiding camera indicator');
      setIsCapturingScreenshot(false);
    };

    ipcRenderer.on('screenshot:start-indicator', handleStartIndicator);
    ipcRenderer.on('screenshot:end-indicator', handleEndIndicator);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('screenshot:start-indicator', handleStartIndicator);
        ipcRenderer.removeListener('screenshot:end-indicator', handleEndIndicator);
      }
    };
  }, []);

  // Position window based on screen dimensions
  // useEffect(() => {
  //   if (!ipcRenderer) return;

  //   const timer = setTimeout(() => {
  //     const screenWidth = window.screen.availWidth;
  //     const screenHeight = window.screen.availHeight;
      
  //     // Use 50% width for automation progress (narrower than web search)
  //     const cardWidth = Math.floor(screenWidth * 0.5);
  //     const cardHeight = Math.floor(screenHeight * 0.7); // 70% height
  //     const x = Math.floor((screenWidth - cardWidth) / 2);
  //     const y = Math.floor((screenHeight - cardHeight) / 2);
      
  //     ipcRenderer.send('overlay:position-intent', {
  //       x,
  //       y,
  //       width: cardWidth,
  //       height: cardHeight,
  //       animate: false
  //     });
  //   }, 100);

  //   return () => clearTimeout(timer);
  // }, []);

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
      ipcRenderer.send('intent-window:hide');
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

  // Hide when not visible
  if (!isVisible && !isComputerUseMode) {
    return null;
  }

  // Show plan generation loading state
  if (isComputerUseMode && isGeneratingPlan) {
    return (
      <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 w-auto max-w-2xl">
        <div className="bg-gray-800/95 backdrop-blur-xl border border-blue-500/30 rounded-xl shadow-2xl p-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-4">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            <div>
              <p className="text-lg font-medium text-white mb-1">Generating Plan...</p>
              <p className="text-sm text-gray-400">Analyzing your request and creating automation steps</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show plan preview with Start button
  if (isComputerUseMode && generatedPlan && !automationStarted) {
    return (
      <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 w-auto max-w-2xl">
        <div className="bg-gray-800/95 backdrop-blur-xl border border-blue-500/30 rounded-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-700/50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-white">Automation Plan Ready</h3>
              <p className="text-xs text-gray-400">
                {generatedPlan.steps?.length || 0} steps • Estimated time: {Math.ceil((generatedPlan.steps?.length || 0) * 3)}s
              </p>
            </div>
            <p className="text-sm text-gray-400">{generatedPlan.goal || goal}</p>
          </div>

          {/* Steps Preview */}
          <div className="px-6 py-4 space-y-3">
            {generatedPlan.steps?.map((step: any, idx: number) => (
              <div key={step.id || idx} className="flex gap-3 p-3 bg-gray-900/50 rounded-lg border border-gray-700/30">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-medium text-sm">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white mb-1">
                    {step.intent ? `${step.intent.charAt(0).toUpperCase() + step.intent.slice(1)}` : 'Action'}
                  </p>
                  <p className="text-sm text-gray-300">{step.description}</p>
                  {step.target && (
                    <p className="text-xs text-gray-500 mt-1">→ {step.target}</p>
                  )}
                  {step.query && (
                    <p className="text-xs text-gray-500 mt-1">Query: "{step.query}"</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-6 py-4 border-t border-gray-700/50 flex items-center justify-end gap-3">
            <button
              onClick={() => {
                setGeneratedPlan(null);
                setPlanError(null);
                setIsGeneratingPlan(false);
                if (ipcRenderer) {
                  ipcRenderer.send('automation:ended');
                }
              }}
              className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={startPlanExecution}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <Play className="w-4 h-4" />
              Start Automation
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show plan generation error
  if (isComputerUseMode && planError && !automationStarted) {
    return (
      <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 w-auto max-w-2xl">
        <div className="bg-gray-800/95 backdrop-blur-xl border border-red-500/30 rounded-xl shadow-2xl p-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-lg font-medium text-white mb-2">Plan Generation Failed</p>
              <p className="text-sm text-gray-300 mb-4">{planError}</p>
              <button
                onClick={() => {
                  setPlanError(null);
                  generatePlan();
                }}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // In Computer Use mode, always show compact floating card during automation
  // Entire window is click-through for visibility only - doesn't block automation
  if (isComputerUseMode && status !== 'completed' && status !== 'error') {
    return (
      <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 w-auto max-w-2xl pointer-events-none">
        <div 
          ref={cardRef}
          className="bg-gray-800/90 backdrop-blur-xl border border-blue-500/30 rounded-xl shadow-2xl pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {/* Compact Header with AI Reasoning */}
          <div className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {isCapturingScreenshot ? (
                  <Camera className="w-5 h-5 text-green-400 animate-pulse" />
                ) : (
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {/* <p className="text-sm font-medium text-white">
                    {goal}
                  </p> */}
                  <span className="text-xs text-gray-400">
                    {isCapturingScreenshot ? '📸 Capturing screenshot...' : `Actions ${currentStepIndex + 1}`}
                  </span>
                </div>
                {/* Show clarification questions if present, otherwise show reasoning */}
                {clarificationQuestions.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs font-medium text-yellow-300 mb-2">
                      ⚠️ Clarification Needed
                    </p>
                    {clarificationQuestions.map((q, idx) => (
                      <div key={q.id} className="bg-gray-900/50 rounded-lg p-3 border border-yellow-500/30">
                        <p className="text-sm text-gray-200 mb-2">
                          <span className="text-yellow-400 font-medium">Q{idx + 1}:</span> {q.question}
                        </p>
                        <p className="text-xs text-gray-400 italic">
                          Type your answer in the prompt bar below and press Enter to continue
                        </p>
                      </div>
                    ))}
                  </div>
                ) : currentReasoning ? (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-blue-300 mb-1">
                      AI Thinking {currentActionType && `• ${currentActionType}`}
                    </p>
                    {/* <p className="text-sm text-gray-200 leading-relaxed">
                      {currentReasoning}
                    </p> */}
                    {currentTiming && (
                      <div className="mt-2 flex gap-3 text-xs text-gray-400">
                        {currentTiming.llmDecisionMs && (
                          <span>🧠 LLM: {(currentTiming.llmDecisionMs / 1000).toFixed(2)}s</span>
                        )}
                        {currentTiming.totalProcessingMs && (
                          <span>⚙️ Backend: {(currentTiming.totalProcessingMs / 1000).toFixed(2)}s</span>
                        )}
                        {currentTiming.timeSinceLastActionMs && (
                          <span>⚡ Frontend: {(currentTiming.timeSinceLastActionMs / 1000).toFixed(2)}s</span>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full panel view for non-Computer Use mode or when completed/error
  return (
    <div className={`fixed inset-0 flex items-center justify-center pointer-events-none z-50 transition-opacity duration-200 ${
      isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
    }`}>
      <div
        ref={cardRef}
        className={`bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl w-full h-full max-h-[80vh] flex flex-col ${
          isVisible ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
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
              {isComputerUseMode 
                ? `Action ${currentStepIndex + 1}` 
                : `Step ${currentStepIndex + 1} of ${totalSteps}`
              }
            </span>
            {!isComputerUseMode && (
              <span className="text-sm text-gray-400">
                {Math.round(progress)}%
              </span>
            )}
          </div>
          {!isComputerUseMode && (
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
          )}
          
          {/* AI Reasoning Display (Computer Use mode) */}
          {isComputerUseMode && currentReasoning && status === 'running' && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg animate-in fade-in duration-200">
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 mt-0.5">
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-blue-300 mb-1">
                    AI Thinking {currentActionType && `• ${currentActionType}`}
                  </p>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {currentReasoning}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action History or Steps */}
        <div className="border-b border-gray-700/50 flex-1 overflow-y-auto">
          {/* Toggle Button */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-700/50">
            <button
              onClick={() => setShowAllSteps(!showAllSteps)}
              className="flex-1 flex items-center justify-between hover:bg-gray-800/50 transition-colors rounded px-2 py-1"
            >
              <span className="text-sm text-gray-300">
                {showAllSteps ? 'Hide' : 'Show'} all {isComputerUseMode ? `actions (${actionHistory.length})` : `steps (${totalSteps})`}
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

          {/* Action History (Computer Use Mode) or Steps List (Static Plan Mode) */}
          {showAllSteps && (
            <div className="px-6 pb-4">
              {isComputerUseMode ? (
                /* Action History Display */
                <div className="space-y-2">
                  {actionHistory.map((action) => (
                    <div
                      key={`action-${action.iteration}-${action.timestamp}`}
                      className={`rounded-lg transition-colors ${
                        action.status === 'failed' ? 'bg-red-500/5 border border-red-500/20' :
                        'bg-gray-800/30 border border-gray-700/30'
                      }`}
                    >
                      <div className="flex items-start gap-3 p-3">
                        {/* Status Icon */}
                        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                          {action.status === 'completed' ? (
                            <CheckCircle className="w-5 h-5 text-green-400" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-red-400" />
                          )}
                        </div>

                        {/* Action Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-gray-500">
                              Action {action.iteration}
                            </span>
                            <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                              action.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                              'bg-blue-500/20 text-blue-300'
                            }`}>
                              {action.type}
                            </span>
                          </div>
                          <p className={`text-sm leading-relaxed ${
                            action.status === 'failed' ? 'text-red-300' : 'text-gray-300'
                          }`}>
                            {action.reasoning}
                          </p>
                          {action.error && (
                            <div className="mt-2 bg-red-900/20 border border-red-500/30 rounded p-2">
                              <p className="text-xs font-medium text-red-300 mb-1">Error:</p>
                              <p className="text-xs text-red-400 font-mono">
                                {action.error}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {actionHistory.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <p className="text-sm">No actions recorded yet</p>
                    </div>
                  )}
                </div>
              ) : (
                /* Steps List Display */
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
              )}
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
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-green-300 text-sm font-medium mb-2">
                  Automation completed successfully!
                </p>
                
                {/* Display completion result (comparison verdicts, summaries, etc.) */}
                {completionResult && completionResult.reason && (
                  <div className="mt-3 p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg">
                    <p className="text-xs font-medium text-gray-400 mb-2">Result Summary:</p>
                    <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                      {completionResult.reason}
                    </p>
                  </div>
                )}
                
                {/* Display tagged screenshots if available */}
                {completionResult && completionResult.screenshots && Object.keys(completionResult.screenshots).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-400 mb-2">Captured Screenshots:</p>
                    <div className="space-y-2">
                      {Object.entries(completionResult.screenshots).map(([tag, screenshot]: [string, any]) => (
                        <div key={tag} className="p-2 bg-gray-800/50 border border-gray-700/50 rounded">
                          <p className="text-xs text-gray-400 mb-1">{tag}</p>
                          <img 
                            src={typeof screenshot === 'string' ? screenshot : screenshot.base64} 
                            alt={tag}
                            className="w-full rounded border border-gray-600/30"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
