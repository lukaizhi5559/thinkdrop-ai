/**
 * Compact Automation Progress Component
 * 
 * Minimal, inline automation progress display designed to fit within ResultsWindow
 * Matches the clean, modern styling of PromptCaptureBox and ResultsWindow
 */

import { useEffect, useState, useRef } from 'react';
import { OverlayPayload } from '../../../../types/overlay-intents';
import { OmniParserStatus, AUTOMATION_MODE } from '../../services/communicationAgent';
import { getCommunicationAgent } from '../../services/communicationAgentSingleton';
import { ComputerUseClient } from '../../automation/ComputerUseClient';

const ipcRenderer = (window as any).electron?.ipcRenderer;

interface ClarificationQuestion {
  id: string;
  question: string;
  type?: 'text' | 'choice';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

interface CompactAutomationProgressProps {
  payload: OverlayPayload;
  omniParserStatus: OmniParserStatus | null;
  onEvent: (event: any) => void;
}

interface AutomationStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
}

export default function CompactAutomationProgress({ payload, omniParserStatus, onEvent }: CompactAutomationProgressProps) {
  const [status, setStatus] = useState<'generating' | 'ready' | 'executing' | 'completed' | 'failed'>('generating');
  const [steps, setSteps] = useState<AutomationStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clarificationQuestions, setClarificationQuestions] = useState<ClarificationQuestion[]>([]);
  const [currentReasoning, setCurrentReasoning] = useState<string>('');
  const [displayedReasoning, setDisplayedReasoning] = useState<string>('');
  const [isStreamingReasoning, setIsStreamingReasoning] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<any>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  
  const computerUseClientRef = useRef<ComputerUseClient | null>(null);
  const clarificationResolveRef = useRef<((answers: Record<string, string>) => void) | null>(null);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const goal = payload.slots?.goal;
  const wsUrl = payload.slots?.wsUrl;
  const backendUrl = payload.slots?.backendUrl || 'http://localhost:4000';
  
  // Stream reasoning text character by character
  useEffect(() => {
    if (!currentReasoning) {
      setDisplayedReasoning('');
      setIsStreamingReasoning(false);
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
      return;
    }
    
    // If reasoning changed, start streaming
    if (currentReasoning !== displayedReasoning) {
      setIsStreamingReasoning(true);
      let charIndex = 0;
      
      // Clear any existing interval
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
      }
      
      // Stream characters at ~50ms per character (20 chars/sec)
      streamingIntervalRef.current = setInterval(() => {
        if (charIndex < currentReasoning.length) {
          setDisplayedReasoning(currentReasoning.slice(0, charIndex + 1));
          charIndex++;
        } else {
          setIsStreamingReasoning(false);
          if (streamingIntervalRef.current) {
            clearInterval(streamingIntervalRef.current);
            streamingIntervalRef.current = null;
          }
        }
      }, 30); // 30ms = ~33 chars/sec for smooth streaming
    }
    
    return () => {
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
    };
  }, [currentReasoning]);
  const apiKey = payload.slots?.apiKey || 'test-api-key-123';
  const screenshot = payload.slots?.screenshot;
  const context = payload.slots?.context;

  // Generate plan on mount
  useEffect(() => {
    console.log('🤖 [COMPACT_AUTOMATION] Initializing with payload:', payload);
    
    const mode = payload.slots?.mode;
    
    if (mode === 'intent-driven') {
      // Start plan generation immediately
      generatePlan();
    } else {
      setStatus('generating');
    }
  }, []);
  
  // Listen for clarification answers
  useEffect(() => {
    if (!ipcRenderer) return;

    const handleClarificationAnswer = (_event: any, data: { answer: string; questionId?: string }) => {
      console.log('✅ [COMPACT_AUTOMATION] Received clarification answer:', data);
      
      if (clarificationResolveRef.current && clarificationQuestions.length > 0) {
        const answers: Record<string, string> = {};
        clarificationQuestions.forEach((q) => {
          answers[q.id] = data.answer;
        });
        
        console.log('📤 [COMPACT_AUTOMATION] Resolving clarification with answers:', answers);
        clarificationResolveRef.current(answers);
        clarificationResolveRef.current = null;
        setClarificationQuestions([]);
      } else if (!clarificationResolveRef.current && clarificationQuestions.length > 0) {
        console.log('📋 [COMPACT_AUTOMATION] Plan generation clarification - regenerating plan');
        setClarificationQuestions([]);
        generatePlan({ [clarificationQuestions[0].id]: data.answer });
      }
    };

    ipcRenderer.on('prompt-bar:clarification-answer', handleClarificationAnswer);

    return () => {
      if (ipcRenderer.removeListener) {
        ipcRenderer.removeListener('prompt-bar:clarification-answer', handleClarificationAnswer);
      }
    };
  }, [clarificationQuestions]);

  // Generate plan via API
  const generatePlan = async (clarificationAnswers?: Record<string, string>) => {
    console.log('🎯 [COMPACT_AUTOMATION] Generating plan for:', goal);
    setIsGeneratingPlan(true);
    setPlanError(null);
    setStatus('generating');
    
    try {
      // Strip data URL prefix from screenshot if present
      let screenshotBase64 = screenshot;
      if (screenshotBase64 && screenshotBase64.startsWith('data:')) {
        const base64Index = screenshotBase64.indexOf('base64,');
        if (base64Index !== -1) {
          screenshotBase64 = screenshotBase64.substring(base64Index + 7);
        }
      }
      
      const requestBody: any = {
        command: goal,
        intent: 'command_automate',
        context: {
          screenshot: screenshotBase64 ? { base64: screenshotBase64, mimeType: 'image/png' } : undefined,
          activeApp: context?.activeApp,
          activeUrl: context?.activeUrl,
          os: 'darwin'
        }
      };
      
      if (clarificationAnswers) {
        requestBody.clarificationAnswers = clarificationAnswers;
      }
      
      console.log('📡 [COMPACT_AUTOMATION] Calling plan API:', `${backendUrl}/api/nutjs/plan`);
      
      const response = await fetch(`${backendUrl}/api/nutjs/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Plan API failed: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log('✅ [COMPACT_AUTOMATION] Plan generated:', result);
      
      // Check if clarification is needed
      if (result.needsClarification && result.clarificationQuestions) {
        console.log('❓ [COMPACT_AUTOMATION] Plan needs clarification');
        setClarificationQuestions(result.clarificationQuestions);
        
        if (ipcRenderer && result.clarificationQuestions.length > 0) {
          const questionsText = result.clarificationQuestions
            .map((q: any, idx: number) => `Q${idx + 1}: ${q.question || q.text}`)
            .join('\n\n');
          
          ipcRenderer.send('clarification:activate', {
            question: questionsText,
            stepDescription: 'Plan Generation',
            stepIndex: 0,
            questionId: result.clarificationQuestions[0].id,
            intent: 'command_automate'
          });
        }
        
        setIsGeneratingPlan(false);
        setStatus('ready');
        return;
      }
      
      // Plan generated successfully - show preview with Start button
      setGeneratedPlan(result.plan);
      setIsGeneratingPlan(false);
      setStatus('ready');
      
    } catch (error: any) {
      console.error('❌ [COMPACT_AUTOMATION] Plan generation failed:', error);
      setPlanError(error.message);
      setIsGeneratingPlan(false);
      setStatus('failed');
      setError(`Plan generation failed: ${error.message}`);
    }
  };
  
  // Execute plan using MCP command.prompt-anywhere (sequential intent execution)
  const executeWithMCP = async (plan: any) => {
    console.log('🚀 [COMPACT_AUTOMATION] Starting MCP-based execution');
    console.log('📋 [COMPACT_AUTOMATION] Mode: COMMAND_MCP');
    
    // Hide PromptCaptureBox to prevent keystroke interference
    if (ipcRenderer) {
      console.log('👻 [COMPACT_AUTOMATION] Hiding PromptCaptureBox window');
      ipcRenderer.send('prompt-capture:hide');
    }
    
    setStatus('executing');
    setSteps([]);
    setError(null);
    
    const commAgent = getCommunicationAgent();
    
    await commAgent.executeWithMCP(plan, {
      onIntentStart: (intent: any, index: number) => {
        console.log(`🎯 [COMPACT_AUTOMATION] Intent ${index + 1} started:`, intent.description);
        
        const stepId = `intent_${index}`;
        setSteps(prev => [...prev, {
          id: stepId,
          description: intent.description || intent.action || 'Processing...',
          status: 'running'
        }]);
      },
      onIntentComplete: (intent: any, index: number, result: any) => {
        console.log(`✅ [COMPACT_AUTOMATION] Intent ${index + 1} completed`);
        
        const stepId = `intent_${index}`;
        setSteps(prev => prev.map(s => 
          s.id === stepId ? { ...s, status: 'completed' } : s
        ));
      },
      onIntentError: (intent: any, index: number, error: string) => {
        console.error(`❌ [COMPACT_AUTOMATION] Intent ${index + 1} failed:`, error);
        
        const stepId = `intent_${index}`;
        setSteps(prev => prev.map(s => 
          s.id === stepId ? { ...s, status: 'failed', result: error } : s
        ));
      },
      onComplete: (result: any) => {
        console.log('🎉 [COMPACT_AUTOMATION] All intents completed');
        setStatus('completed');
        
        // Show PromptCaptureBox again
        if (ipcRenderer) {
          console.log('👁️ [COMPACT_AUTOMATION] Showing PromptCaptureBox window');
          ipcRenderer.send('prompt-capture:show');
          ipcRenderer.send('automation:ended');
          
        
        }
        
        onEvent({ type: 'completed', result });
      },
      onError: (error: string) => {
        console.error('❌ [COMPACT_AUTOMATION] MCP execution failed:', error);
        setStatus('failed');
        setError(error);
        
        // Show PromptCaptureBox again on error
        if (ipcRenderer) {
          console.log('👁️ [COMPACT_AUTOMATION] Showing PromptCaptureBox window after error');
          ipcRenderer.send('prompt-capture:show');
        }
        
        onEvent({ type: 'failed', error });
      }
    });
  };

  // Execute plan using ComputerUseClient (WebSocket-based)
  const executeWithComputerUse = (plan: any) => {
    if (!wsUrl) {
      setError('Missing WebSocket URL');
      setStatus('failed');
      return;
    }

    console.log('🌐 [COMPACT_AUTOMATION] Starting Computer Use execution');
    
    // Hide PromptCaptureBox to prevent keystroke interference
    if (ipcRenderer) {
      console.log('👻 [COMPACT_AUTOMATION] Hiding PromptCaptureBox window');
      ipcRenderer.send('prompt-capture:hide');
    }
    
    setStatus('executing');
    
    const client = new ComputerUseClient(wsUrl);
    computerUseClientRef.current = client;

    const callbacks = {
      onIntentStart: (intent: any, index: number) => {
        console.log(`� [COMPACT_AUTOMATION] Intent ${index + 1} started:`, intent.description);
        
        const stepId = `intent_${index}`;
        setSteps(prev => [...prev, {
          id: stepId,
          description: intent.description || intent.action || 'Processing...',
          status: 'running'
        }]);
      },
      onIntentComplete: (intent: any, index: number) => {
        console.log(`✅ [COMPACT_AUTOMATION] Intent ${index + 1} completed`);
        
        const stepId = `intent_${index}`;
        setSteps(prev => prev.map(s => 
          s.id === stepId ? { ...s, status: 'completed' } : s
        ));
      },
      onIntentFailed: (intent: any, index: number, error: string) => {
        console.error(`❌ [COMPACT_AUTOMATION] Intent ${index + 1} failed:`, error);
        
        const stepId = `intent_${index}`;
        setSteps(prev => prev.map(s => 
          s.id === stepId ? { ...s, status: 'failed', result: error } : s
        ));
      },
      onAction: (action: any, iteration: number) => {
        console.log('🎬 [COMPACT_AUTOMATION] Action', iteration, ':', action.type);
        
        // Update current reasoning for display
        if (action.reasoning) {
          setCurrentReasoning(action.reasoning);
        }
      },
      onClarificationNeeded: async (questions: ClarificationQuestion[], iteration: number) => {
        console.log('❓ [COMPACT_AUTOMATION] Clarification needed:', questions);
        
        return new Promise<Record<string, string>>((resolve) => {
          setClarificationQuestions(questions);
          clarificationResolveRef.current = resolve;
          
          if (ipcRenderer && questions.length > 0) {
            ipcRenderer.send('prompt-bar:request-clarification', {
              question: questions.map((q, idx) => `Q${idx + 1}: ${q.question}`).join('\n\n'),
              stepDescription: 'Computer Use Automation',
              stepIndex: iteration,
              questionId: questions[0].id
            });
          }
        });
      },
      onComplete: (result: any) => {
        console.log('✅ [COMPACT_AUTOMATION] Automation completed:', result);
        setStatus('completed');
        setCurrentReasoning('');
        
        // Show PromptCaptureBox again
        if (ipcRenderer) {
          console.log('👁️ [COMPACT_AUTOMATION] Showing PromptCaptureBox window');
          ipcRenderer.send('prompt-capture:show');
          ipcRenderer.send('automation:ended');
        }
      },
      onError: (error: string) => {
        console.error('❌ [COMPACT_AUTOMATION] Error:', error);
        setStatus('failed');
        setError(error);
        setCurrentReasoning('');
        
        // Show PromptCaptureBox again on error
        if (ipcRenderer) {
          console.log('👁️ [COMPACT_AUTOMATION] Showing PromptCaptureBox window after error');
          ipcRenderer.send('prompt-capture:show');
        }
      }
    };

    // Execute plan with ComputerUseClient using intent-based flow
    client.executeWithIntents(plan, screenshot, context, callbacks).catch((error) => {
      console.error('❌ [COMPACT_AUTOMATION] Execution failed:', error);
      setStatus('failed');
      setError(error.message);
    })
  };

  const renderStatusHeader = () => {
    const statusConfig = {
      generating: {
        icon: '⚙️',
        text: 'Generating Plan...',
        color: '#60a5fa'
      },
      ready: {
        icon: '✅',
        text: 'Automation Plan Ready',
        color: '#34d399'
      },
      executing: {
        icon: '▶️',
        text: 'Executing Automation...',
        color: '#60a5fa'
      },
      completed: {
        icon: '✅',
        text: 'Automation Completed',
        color: '#34d399'
      },
      failed: {
        icon: '❌',
        text: 'Automation Failed',
        color: '#f87171'
      }
    };

    const config = statusConfig[status];

    return (
      <div className="flex items-center gap-2 mb-3">
        <span style={{ fontSize: '16px' }}>{config.icon}</span>
        <span 
          className="text-sm font-medium"
          style={{ color: config.color }}
        >
          {config.text}
        </span>
      </div>
    );
  };

  const renderSteps = () => {
    if (steps.length === 0) {
      return (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span>Analyzing your request...</span>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-400 mb-2">
          {steps.filter(s => s.status === 'completed').length} / {steps.length} tasks done
        </div>
        {steps.map((step, _index) => (
          <div 
            key={step.id}
            className="flex items-start gap-2"
          >
            {/* Status indicator */}
            <div className="flex-shrink-0 mt-1">
              {step.status === 'completed' && (
                <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </div>
              )}
              {step.status === 'running' && (
                <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              )}
              {step.status === 'failed' && (
                <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                  <span className="text-white text-xs">✕</span>
                </div>
              )}
              {step.status === 'pending' && (
                <div 
                  className="w-4 h-4 rounded-full"
                  style={{ 
                    backgroundColor: 'rgba(156, 163, 175, 0.3)',
                    border: '1px solid rgba(156, 163, 175, 0.5)'
                  }}
                />
              )}
            </div>

            {/* Step description */}
            <div className="flex-1 min-w-0">
              <div 
                className="text-sm leading-relaxed"
                style={{ 
                  color: step.status === 'pending' ? '#9ca3af' : '#e5e7eb'
                }}
              >
                {step.description}
              </div>
              {step.result && (
                <div className="text-xs text-gray-500 mt-1">
                  {step.result}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Show plan generation loading state
  if (isGeneratingPlan) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <span style={{ fontSize: '16px' }}>⚙️</span>
          <span className="text-sm font-medium" style={{ color: '#60a5fa' }}>
            Generating Plan...
          </span>
        </div>
        
        {/* Show OmniParser warmup status during plan generation */}
        {omniParserStatus && !omniParserStatus.isWarm && (
          <div 
            className="flex items-center gap-2 p-2 rounded-lg text-xs mb-2"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderLeft: '3px solid #ef4444'
            }}
          >
            <div 
              className="w-2 h-2 rounded-full animate-pulse"
              style={{
                backgroundColor: '#ef4444',
                boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)'
              }}
            />
            <span style={{ color: '#fca5a5' }}>
              ⏳ Vision System Warming Up... This may take a minute
            </span>
          </div>
        )}
        
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span>Analyzing your request...</span>
        </div>
      </div>
    );
  }

  // Show plan generation error
  if (planError) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <span style={{ fontSize: '16px' }}>❌</span>
          <span className="text-sm font-medium" style={{ color: '#f87171' }}>
            Plan Generation Failed
          </span>
        </div>
        <div 
          className="p-3 rounded-lg text-sm"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            borderLeft: '3px solid #f87171',
            color: '#fca5a5'
          }}
        >
          {planError}
        </div>
        <button
          onClick={() => {
            setPlanError(null);
            generatePlan();
          }}
          className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Show plan preview with Start button
  if (generatedPlan && status === 'ready') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <span style={{ fontSize: '16px' }}>✅</span>
          <span className="text-sm font-medium" style={{ color: '#34d399' }}>
            Automation Plan Ready
          </span>
        </div>
        
        <div className="text-xs text-gray-400 mb-2">
          {generatedPlan.steps?.length || 0} steps • Estimated time: {Math.ceil((generatedPlan.steps?.length || 0) * 3)}s
        </div>

        {/* OmniParser Warmup Status */}
        {omniParserStatus && (
          <div 
            className="flex items-center gap-2 p-2 rounded-lg text-xs mb-2"
            style={{
              backgroundColor: omniParserStatus.isWarm ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              borderLeft: `3px solid ${omniParserStatus.isWarm ? '#22c55e' : '#ef4444'}`
            }}
          >
            <div 
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: omniParserStatus.isWarm ? '#22c55e' : '#ef4444',
                boxShadow: omniParserStatus.isWarm ? '0 0 8px rgba(34, 197, 94, 0.6)' : '0 0 8px rgba(239, 68, 68, 0.6)'
              }}
            />
            <span style={{ color: omniParserStatus.isWarm ? '#86efac' : '#fca5a5' }}>
              {omniParserStatus.isWarm ? (
                `Vision System Ready • ${Math.floor(omniParserStatus.nextWarmupInSeconds / 60)}m ${(omniParserStatus.nextWarmupInSeconds % 60).toFixed(2)}s until cooldown`
              ) : (
                '⏳ Vision System Warming Up... Please wait'
              )}
            </span>
          </div>
        )}

        {/* Plan steps preview */}
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {generatedPlan.steps?.slice(0, 5).map((step: any, idx: number) => (
            <div key={step.id || idx} className="flex gap-2 text-sm">
              <span className="text-gray-500">{idx + 1}.</span>
              <span className="text-gray-300">{step.description || step.action}</span>
            </div>
          ))}
          {generatedPlan.steps?.length > 5 && (
            <div className="text-xs text-gray-500 italic">
              +{generatedPlan.steps.length - 5} more steps...
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => {
              if (AUTOMATION_MODE === 'COMMAND_MCP') {
                executeWithMCP(generatedPlan);
              } else {
                executeWithComputerUse(generatedPlan);
              }
            }}
            disabled={!omniParserStatus?.isWarm}
            className="flex-1 px-3 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: omniParserStatus?.isWarm ? '#3b82f6' : '#6b7280',
              cursor: omniParserStatus?.isWarm ? 'pointer' : 'not-allowed'
            }}
            title={!omniParserStatus?.isWarm ? 'Waiting for Vision System to warm up...' : 'Start automation'}
          >
            {omniParserStatus?.isWarm ? 'Start Automation' : 'Warming Up...'}
          </button>
          <button
            onClick={() => {
              setGeneratedPlan(null);
              setPlanError(null);
              setStatus('generating');
              onEvent({ type: 'cancelled' });
            }}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Show execution progress
  return (
    <div className="space-y-3">
      {renderStatusHeader()}
      
      {error && (
        <div 
          className="p-3 rounded-lg text-sm"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            borderLeft: '3px solid #f87171',
            color: '#fca5a5'
          }}
        >
          {error}
        </div>
      )}

      {/* LLM-generated clarification questions */}
      {clarificationQuestions.length > 0 && (
        <div className="space-y-3">
          {clarificationQuestions.map((q, idx) => (
            <div 
              key={q.id}
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'rgba(251, 191, 36, 0.1)',
                borderLeft: '3px solid #fbbf24'
              }}
            >
              <div className="flex items-start gap-2">
                <span className="text-yellow-400 flex-shrink-0">❓</span>
                <div className="flex-1">
                  <div className="text-xs font-medium text-yellow-300 mb-1">
                    Question {idx + 1}/{clarificationQuestions.length}
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-300 mb-2">
                    {q.question}
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-1">
                    <span>💬</span>
                    <span>Please answer in the prompt bar below</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Current reasoning display with streaming effect */}
      {currentReasoning && status === 'executing' && (
        <div 
          className="p-3 rounded-lg text-sm"
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderLeft: '3px solid rgba(59, 130, 246, 0.5)',
            color: '#93c5fd'
          }}
        >
          <div className="flex items-start gap-2">
            <span className="text-blue-400 flex-shrink-0">💭</span>
            <div className="flex-1">
              <div className="text-xs font-medium text-blue-300 mb-1">Reasoning:</div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {displayedReasoning}
                {isStreamingReasoning && (
                  <span className="inline-block w-1 h-4 ml-0.5 bg-blue-400 animate-pulse" />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {renderSteps()}

      {/* Goal/Task description */}
      {payload.slots?.goal && (
        <div 
          className="mt-4 p-3 rounded-lg text-xs"
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderLeft: '3px solid rgba(59, 130, 246, 0.5)',
            color: '#9ca3af'
          }}
        >
          <div className="font-medium text-blue-400 mb-1">Task:</div>
          {payload.slots.goal}
        </div>
      )}
    </div>
  );
}
