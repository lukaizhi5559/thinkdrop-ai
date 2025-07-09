import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, HelpCircle, CheckCircle, Clock, ChevronDown, ChevronRight, Sparkles, Settings, Play, Pause, XCircle, Droplet, MessageSquare } from 'lucide-react';
import { OrchestrationWorkflow, OrchestrationUpdate } from './types/orchestration';

interface InsightData {
  summary: string[];
  introduction: string[];
  actions: Array<{
    text: string;
    priority: 'high' | 'normal' | 'low';
    icon: string;
  }>;
  contextFeed: string[];
  followUps: string[];
}





interface CollapsiblePanelProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  icon?: React.ReactNode;
}

function CollapsiblePanel({ title, children, defaultExpanded = true, icon }: CollapsiblePanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center space-x-3">
          {icon && <div className="text-white/70">{icon}</div>}
          <span className="text-white/90 font-medium text-sm">{title}</span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-white/50" />
        ) : (
          <ChevronRight className="w-4 h-4 text-white/50" />
        )}
      </button>
      {isExpanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

export default function InsightWindow() {
  const [insightData, setInsightData] = useState<InsightData>({
    summary: [
      "System mentions 'Regulation' and 'now'",
    ],
    introduction: [
      "System mentions 'Regulation' and 'now'",
      "AI systems decide medical care, loans, and job interviews, often without oversight.",
      "The tech industry advocates for unmonitored AI decision-making.",
      "Powerful companies mounting unprecedented lobbying efforts.",
    ],
    actions: [
      {
        text: "Address objection: AI systems deciding critical human opportunities raises ethical concerns",
        priority: 'high',
        icon: '⚠️'
      },
      {
        text: "Address objection: AI systems deciding often illegally without oversight",
        priority: 'high', 
        icon: '⚠️'
      },
      {
        text: "Could state lawmakers be barred from regulating artificial intelligence?",
        priority: 'normal',
        icon: '❓'
      },
      {
        text: "What should I say next?",
        priority: 'low',
        icon: '✨'
      },
      {
        text: "Suggest follow-up questions",
        priority: 'low',
        icon: '💬'
      }
    ],
    contextFeed: [
      "Screen: Discussion about AI regulation and oversight",
      "Audio: Mentions of 'regulation', 'now', 'AI systems'",
      "Context: Debate about AI decision-making in critical areas",
    ],
    followUps: [
      "What are the specific ethical concerns with AI decision-making?",
      "How can we ensure proper oversight of AI systems?",
      "What role should state lawmakers play in AI regulation?",
      "Are there examples of AI systems making decisions without proper oversight?",
    ]
  });

  const [orchestrationWorkflow, setOrchestrationWorkflow] = useState<OrchestrationWorkflow | null>(null);
  const [backendOrchestrationData, setBackendOrchestrationData] = useState<any>(null);
  const [clarificationResponse, setClarificationResponse] = useState<string>('');
  const [isLoading] = useState(false);

  useEffect(() => {
    console.log('🚀 FRONTEND: Setting up InsightWindow event listeners');
    console.log('🚀 FRONTEND: window.electronAPI exists:', !!window.electronAPI);
    console.log('🚀 FRONTEND: onInsightOrchestrationUpdate exists:', !!window.electronAPI?.onInsightOrchestrationUpdate);
    
    // Set up event listeners for insights updates
    if (window.electronAPI?.onInsightUpdate) {
      console.log('🚀 FRONTEND: Setting up insight update listener');
      window.electronAPI.onInsightUpdate((_: any, data: any) => {
        console.log('🚀 FRONTEND: Received insight update:', data);
        setInsightData(data);
      });
    }

    // Set up event listeners for orchestration updates using safe channel
    // DEBUGGING VERSION - Testing IPC reception
    if (window.electronAPI?.onInsightOrchestrationUpdate) {
      console.log('🚀 FRONTEND: Setting up orchestration update listener on insight-orchestration-update channel');
      
      const handler = (_: any, data: OrchestrationUpdate) => {
        console.log('🎯 FRONTEND: *** RECEIVED ORCHESTRATION UPDATE ***', data.type);
        console.log('🎯 FRONTEND: Full data:', data);
        console.log('🎯 FRONTEND: Timestamp:', new Date().toISOString());
        
        // Only handle workflow_started for now to test
        if (data.type === 'workflow_started' && data.workflow) {
          console.log('🔍 MINIMAL: Setting workflow_started data');
          try {
            setOrchestrationWorkflow(data.workflow);
            // Test: Only set backend data if it exists
            if (data.result && (data.result.task_breakdown || data.result.agents)) {
              console.log('🔍 MINIMAL: Setting backend orchestration data');
              setBackendOrchestrationData(data.result);
            }
            console.log('🔍 MINIMAL: State updates completed successfully');
          } catch (error) {
            console.error('🔍 MINIMAL: Error in state update:', error);
          }
        }
        
        // FIXED: Safe handling of workflow_completed event
        if (data.type === 'workflow_completed') {
          console.log('🟢 FIXED: Processing workflow_completed event');
          
          try {
            // First: setOrchestrationWorkflow (safe)
            setOrchestrationWorkflow(prev => {
              if (!prev) return null;
              return { ...prev, status: 'completed' as const, endTime: data.timestamp };
            });
            console.log('🟢 FIXED: setOrchestrationWorkflow completed successfully');
            
            // Second: SAFE setBackendOrchestrationData with data sanitization
            if (data.result && (data.result.task_breakdown || data.result.agents)) {
              console.log('🟢 FIXED: Sanitizing backend orchestration data...');
              
              // Create a SAFE, sanitized version of the data
              const safeBackendData = {
                plan_summary: data.result.plan_summary || 'Backend orchestration completed',
                task_breakdown: Array.isArray(data.result.task_breakdown) 
                  ? data.result.task_breakdown.slice(0, 10) // Limit to first 10 items
                  : [],
                agents: Array.isArray(data.result.agents) 
                  ? data.result.agents.slice(0, 10) // Limit to first 10 items
                  : [],
                dependencies: Array.isArray(data.result.dependencies) 
                  ? data.result.dependencies.slice(0, 5) // Limit to first 5 items
                  : [],
                risks: Array.isArray(data.result.risks) 
                  ? data.result.risks.slice(0, 5) // Limit to first 5 items
                  : [],
                estimated_success_rate: data.result.estimated_success_rate || 0,
                execution_time_estimate: data.result.execution_time_estimate || 'Unknown'
              };
              
              console.log('🟢 FIXED: Setting SAFE backend orchestration data...');
              setBackendOrchestrationData(safeBackendData);
              console.log('🟢 FIXED: setBackendOrchestrationData completed successfully');
            }
            
          } catch (error) {
            console.error('🟢 FIXED: Error in workflow_completed handler:', error);
            // Don't crash the component - just log the error
          }
          
          console.log('🟢 FIXED: workflow_completed handler finished - panel should stay visible');
        }
        
        // Log other events but don't process them yet
        if (data.type !== 'workflow_started' && data.type !== 'workflow_completed') {
          console.log(`🔍 MINIMAL: Ignoring ${data.type} event for now`);
        }
      };
      
      // Actually register the handler
      window.electronAPI.onInsightOrchestrationUpdate(handler);
      console.log('🚀 FRONTEND: Orchestration update handler registered successfully');
    } else {
      console.error('🚀 FRONTEND: onInsightOrchestrationUpdate not available!');
    }

    // Set up clarification request listener
    if (window.electronAPI?.onClarificationRequest) {
      window.electronAPI.onClarificationRequest((_event: any, request: any) => {
        console.log('Received clarification request:', request);
        // Update the current workflow step with clarification request using functional update
        setOrchestrationWorkflow((prev: OrchestrationWorkflow | null) => {
          if (!prev) return null;
          const updatedSteps = [...prev.steps];
          const currentStep = updatedSteps[prev.currentStepIndex];
          if (currentStep) {
            currentStep.status = 'waiting_clarification';
            currentStep.clarificationRequest = request;
          }
          return { ...prev, steps: updatedSteps, status: 'paused' };
        });
      });
    }

    console.log('InsightWindow event listeners set up complete');
    
    // Cleanup listeners on unmount
    return () => {
      console.log('Cleaning up InsightWindow event listeners');
      // Event listeners will be cleaned up automatically when component unmounts
    };
  }, []); // Empty dependency array - only run once on mount

  const handleClose = () => {
    console.log('InsightWindow handleClose called - user clicked X button');
    console.trace('InsightWindow close stack trace');
    if (window.electronAPI?.hideInsight) {
      window.electronAPI.hideInsight();
    }
  };

  const handleSuggestNext = async () => {
    // Simulate API call for suggestion
    setTimeout(() => {
      // In real implementation, this would trigger the chat window with a suggestion
      if (window.electronAPI?.showChat) {
        window.electronAPI.showChat();
      }
    }, 1000);
  };

  const handleSuggestFollowup = async () => {
    // Simulate API call for follow-up suggestions
    setTimeout(() => {
      // In real implementation, this would trigger the chat window with follow-up questions
      if (window.electronAPI?.showChat) {
        window.electronAPI.showChat();
      }
    }, 1000);
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return <AlertTriangle className="w-3 h-3 text-red-400" />;
      case 'normal':
        return <HelpCircle className="w-3 h-3 text-yellow-400" />;
      case 'low':
        return <Sparkles className="w-3 h-3 text-blue-400" />;
      default:
        return <HelpCircle className="w-3 h-3 text-gray-400" />;
    }
  };



  const getWorkflowStatusIcon = (status: string) => {
    switch (status) {
      case 'planning':
        return <Settings className="w-4 h-4 text-blue-400 animate-spin" />;
      case 'executing':
        return <Play className="w-4 h-4 text-green-400" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-400" />;
      case 'pending':
      case 'running':
        return <Play className="w-4 h-4 text-blue-400" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const handleClarificationSubmit = (response: string) => {
    console.log('Submitting clarification response:', response);
    // Send clarification response back to backend
    // In real implementation, this would send the response via IPC
    if (window.electronAPI?.submitClarificationResponse) {
      window.electronAPI.submitClarificationResponse('', response);
    }
  };

  const formatDuration = (startTime: string | number, endTime?: string | number) => {
    const start = typeof startTime === 'string' ? new Date(startTime).getTime() : startTime;
    const end = endTime ? (typeof endTime === 'string' ? new Date(endTime).getTime() : endTime) : Date.now();
    const duration = end - start;
    
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    return `${(duration / 60000).toFixed(1)}m`;
  };

  return (
    <div className="w-full h-screen flex flex-col bg-gray-900/95">
      {/* Draggable Header */}
      <div
        className="flex items-center space-x-2 p-4 pb-2 border-b border-white/10 cursor-move flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-6 h-6 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
          <Droplet className="w-3 h-3 text-white" />
        </div>
        <span className="text-white/90 font-medium text-sm">Live Insights</span>
        <div className="flex-1" />
        <span className="text-white/50 text-xs">Drag to move</span>
        <button
          onClick={handleClose}
          className="h-6 w-6 p-0 text-white/50 hover:text-white/90 hover:bg-white/10 bg-transparent border-none cursor-pointer flex items-center justify-center"
          style={{ 
            WebkitAppRegion: 'no-drag',
            minHeight: 0, // Important for flex child to shrink
            maxHeight: '100%'
          } as React.CSSProperties}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Content Container - Takes up remaining space and scrolls */}
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ 
          WebkitAppRegion: 'no-drag',
          minHeight: 0,
          maxHeight: '100%'
        } as React.CSSProperties}
      >
        {/* Backend Orchestration Data Panel */}
        {backendOrchestrationData && (
          <CollapsiblePanel 
            title={`Drop Workflow - ${backendOrchestrationData.task_breakdown?.length || 0} Steps`}
            defaultExpanded={true}
            icon={<Droplet className="w-4 h-4" />}
          >
            <div className="space-y-4">
              {/* Workflow Summary */}
              {backendOrchestrationData.plan_summary && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <h4 className="text-blue-400 text-sm font-medium mb-2">Workflow Summary</h4>
                  <p className="text-white/80 text-sm leading-relaxed">{backendOrchestrationData.plan_summary}</p>
                </div>
              )}

              {/* Task Breakdown */}
              {backendOrchestrationData.task_breakdown && (
                <div className="space-y-2">
                  <h4 className="text-white/90 text-sm font-medium mb-3 flex items-center">
                    <Clock className="w-4 h-4 mr-2" />
                    Task Breakdown ({backendOrchestrationData.task_breakdown.length} Steps)
                  </h4>
                  {backendOrchestrationData.task_breakdown.map((task: any) => (
                    <div key={task.step} className="flex items-start space-x-3 p-3 bg-white/5 rounded-lg border border-white/10">
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <span className="text-white/40 text-xs font-mono w-6">{task.step}</span>
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h5 className="text-white/90 text-sm font-medium">{task.agent_needed}</h5>
                          <span className="text-white/60 text-xs bg-white/10 px-2 py-1 rounded">
                            Drop #{task.step}
                          </span>
                        </div>
                        <p className="text-white/70 text-xs mt-1 leading-relaxed">{task.description}</p>
                        {task.inputs && task.inputs.length > 0 && (
                          <div className="mt-2">
                            <span className="text-white/50 text-xs">Inputs: </span>
                            <span className="text-white/60 text-xs">{task.inputs.join(', ')}</span>
                          </div>
                        )}
                        {task.outputs && task.outputs.length > 0 && (
                          <div className="mt-1">
                            <span className="text-white/50 text-xs">Outputs: </span>
                            <span className="text-white/60 text-xs">{task.outputs.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Agents Panel */}
              {backendOrchestrationData.agents && (
                <div className="space-y-2">
                  <h4 className="text-white/90 text-sm font-medium mb-3 flex items-center">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Required Drops ({backendOrchestrationData.agents.length})
                  </h4>
                  {backendOrchestrationData.agents.map((agent: any, index: number) => (
                    <div key={index} className="flex items-start space-x-3 p-3 bg-white/5 rounded-lg border border-white/10">
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h5 className="text-white/90 text-sm font-medium">{agent.name}</h5>
                        <p className="text-white/70 text-xs mt-1 leading-relaxed">{agent.description}</p>
                        {agent.capabilities && (
                          <div className="mt-2">
                            <span className="text-white/50 text-xs">Capabilities: </span>
                            <span className="text-white/60 text-xs">{agent.capabilities.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Dependencies */}
              {backendOrchestrationData.dependencies && backendOrchestrationData.dependencies.length > 0 && (
                <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                  <h4 className="text-orange-400 text-sm font-medium mb-2 flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Dependencies
                  </h4>
                  <div className="space-y-1">
                    {backendOrchestrationData.dependencies.map((dep: string, index: number) => (
                      <p key={index} className="text-white/80 text-sm">• {dep}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Risks */}
              {backendOrchestrationData.risks && backendOrchestrationData.risks.length > 0 && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <h4 className="text-red-400 text-sm font-medium mb-2 flex items-center">
                    <XCircle className="w-4 h-4 mr-2" />
                    Risks & Considerations
                  </h4>
                  <div className="space-y-1">
                    {backendOrchestrationData.risks.map((risk: string, index: number) => (
                      <p key={index} className="text-white/80 text-sm">• {risk}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Data Flow */}
              {backendOrchestrationData.data_flow && (
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <h4 className="text-purple-400 text-sm font-medium mb-2">Drop Flow</h4>
                  <p className="text-white/80 text-sm font-mono">{backendOrchestrationData.data_flow}</p>
                </div>
              )}
            </div>
          </CollapsiblePanel>
        )}

        {/* Current Summary Panel */}
        <CollapsiblePanel 
          title="Current Summary" 
          defaultExpanded={true}
          icon={<MessageSquare className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.summary.map((item, index) => (
              <div key={index} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-teal-400 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-white/70 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Orchestration Status Panel */}
        {orchestrationWorkflow && (
          <CollapsiblePanel 
            title="Orchestration Status" 
            defaultExpanded={true}
            icon={<Settings className="w-4 h-4" />}
          >
            <div className="space-y-4">
              {/* Workflow Header */}
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                <div className="flex items-center space-x-3">
                  {getWorkflowStatusIcon(orchestrationWorkflow.status)}
                  <div>
                    <h3 className="text-white/90 font-medium text-sm">{orchestrationWorkflow.id}</h3>
                    <p className="text-white/60 text-xs">
                      {orchestrationWorkflow.status === 'running' && 'In Progress'}
                      {orchestrationWorkflow.status === 'completed' && 'Completed'}
                      {orchestrationWorkflow.status === 'failed' && 'Failed'}
                      {orchestrationWorkflow.status === 'paused' && 'Paused'}
                      {orchestrationWorkflow.status === 'awaiting_clarification' && 'Awaiting Clarification'}
                      {orchestrationWorkflow.startTime && ` • ${formatDuration(orchestrationWorkflow.startTime, orchestrationWorkflow.endTime)}`}
                    </p>
                  </div>
                </div>
                <div className="text-white/60 text-xs">
                  {orchestrationWorkflow.steps.length} steps
                </div>
              </div>

              {/* Clarification Questions */}
              {orchestrationWorkflow.status === 'awaiting_clarification' && orchestrationWorkflow.questions && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <h4 className="text-yellow-400 text-sm font-medium mb-2 flex items-center">
                    <HelpCircle className="w-4 h-4 mr-2" />
                    Clarification Needed
                  </h4>
                  <div className="space-y-2 mb-3">
                    {orchestrationWorkflow.questions.map((clarificationRequest, index) => (
                      <p key={index} className="text-white/80 text-sm">{clarificationRequest.question}</p>
                    ))}
                  </div>
                  {orchestrationWorkflow.clarificationId && (
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={clarificationResponse}
                        onChange={(e) => setClarificationResponse(e.target.value)}
                        placeholder="Your response..."
                        className="flex-1 bg-white/10 border border-white/20 rounded px-3 py-2 text-white text-sm placeholder-white/50 focus:outline-none focus:border-white/40"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      />
                      <button
                        onClick={() => handleClarificationSubmit(clarificationResponse)}
                        disabled={!clarificationResponse.trim()}
                        className="bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        Send
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CollapsiblePanel>
        )}

        {/* Introduction Panel */}
        <CollapsiblePanel 
          title="Introduction" 
          defaultExpanded={true}
          icon={<MessageSquare className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.introduction.map((item, index) => (
              <div key={index} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-white/70 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Actions Panel */}
        <CollapsiblePanel 
          title="Actions" 
          defaultExpanded={true}
          icon={<AlertTriangle className="w-4 h-4" />}
        >
          <div className="space-y-3">
            {insightData.actions.map((action, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {getPriorityIcon(action.priority)}
                  <span className="text-sm">{action.icon}</span>
                </div>
                <p className="text-white/80 text-sm leading-relaxed flex-1">{action.text}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Context Feed Panel */}
        <CollapsiblePanel 
          title="Context Feed" 
          defaultExpanded={false}
          icon={<HelpCircle className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.contextFeed.map((item, index) => (
              <div key={index} className="p-2 bg-white/5 rounded border border-white/10">
                <p className="text-white/60 text-xs leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Suggested Questions Panel */}
        <CollapsiblePanel 
          title="Suggested Questions" 
          defaultExpanded={false}
          icon={<Sparkles className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.followUps.map((question, index) => (
              <div key={index} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-white/70 text-sm leading-relaxed">{question}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>
      </div>

      {/* Footer Actions */}
      <div 
        className="p-4 border-t border-white/10 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex space-x-3">
          <button
            onClick={handleSuggestNext}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-blue-500 to-teal-500 hover:from-blue-600 hover:to-teal-600 text-white text-sm py-2 rounded-lg disabled:opacity-50"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {isLoading ? 'Thinking...' : 'What should I say next?'}
          </button>
          <button
            onClick={handleSuggestFollowup}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white text-sm py-2 rounded-lg disabled:opacity-50"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Suggest follow-up
          </button>
        </div>
      </div>
    </div>
  );
}
