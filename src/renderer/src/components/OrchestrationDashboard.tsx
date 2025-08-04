import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Play, 
  Pause, 
  Square, 
  RotateCcw, 
  Zap, 
  Clock, 
  CheckCircle, 
  AlertTriangle,
  Plus,
  Trash2,
  Edit3
} from 'lucide-react';

interface WorkflowStep {
  id: string;
  name: string;
  type: 'llm' | 'agent' | 'memory' | 'api' | 'condition';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  duration?: number;
  output?: string;
  error?: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  steps: WorkflowStep[];
  createdAt: string;
  lastRun?: string;
  runCount: number;
}

const OrchestrationDashboard: React.FC = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDescription, setNewWorkflowDescription] = useState('');

  // Initialize with mock workflows
  useEffect(() => {
    const mockWorkflows: Workflow[] = [
      {
        id: 'workflow-1',
        name: 'Content Analysis Pipeline',
        description: 'Analyze user input, generate insights, and update memory',
        status: 'idle',
        createdAt: '2024-01-15T10:00:00Z',
        lastRun: '2024-01-15T14:30:00Z',
        runCount: 12,
        steps: [
          {
            id: 'step-1',
            name: 'Parse User Input',
            type: 'llm',
            status: 'completed',
            duration: 1200,
            output: 'Successfully parsed user query about project status'
          },
          {
            id: 'step-2',
            name: 'Generate Agent Response',
            type: 'agent',
            status: 'completed',
            duration: 2800,
            output: 'Generated comprehensive response with action items'
          },
          {
            id: 'step-3',
            name: 'Update Memory Index',
            type: 'memory',
            status: 'completed',
            duration: 800,
            output: 'Added 3 new memory entries'
          }
        ]
      },
      {
        id: 'workflow-2',
        name: 'Code Review Assistant',
        description: 'Automated code analysis and feedback generation',
        status: 'running',
        createdAt: '2024-01-14T16:20:00Z',
        lastRun: '2024-01-15T15:45:00Z',
        runCount: 8,
        steps: [
          {
            id: 'step-1',
            name: 'Fetch Code Changes',
            type: 'api',
            status: 'completed',
            duration: 500,
            output: 'Retrieved 15 changed files from repository'
          },
          {
            id: 'step-2',
            name: 'Analyze Code Quality',
            type: 'llm',
            status: 'running',
            duration: 0
          },
          {
            id: 'step-3',
            name: 'Generate Feedback',
            type: 'agent',
            status: 'pending'
          },
          {
            id: 'step-4',
            name: 'Post Review Comments',
            type: 'api',
            status: 'pending'
          }
        ]
      },
      {
        id: 'workflow-3',
        name: 'Daily Summary Report',
        description: 'Generate daily activity summary and insights',
        status: 'failed',
        createdAt: '2024-01-13T09:15:00Z',
        lastRun: '2024-01-15T09:00:00Z',
        runCount: 5,
        steps: [
          {
            id: 'step-1',
            name: 'Collect Activity Data',
            type: 'memory',
            status: 'completed',
            duration: 1000,
            output: 'Collected 45 activities from the last 24 hours'
          },
          {
            id: 'step-2',
            name: 'Analyze Patterns',
            type: 'llm',
            status: 'failed',
            error: 'API rate limit exceeded'
          },
          {
            id: 'step-3',
            name: 'Generate Report',
            type: 'agent',
            status: 'skipped'
          }
        ]
      }
    ];

    setWorkflows(mockWorkflows);
  }, []);

  const getStatusIcon = (status: Workflow['status'] | WorkflowStep['status']) => {
    switch (status) {
      case 'idle':
      case 'pending':
        return <Clock className="w-4 h-4 text-gray-500" />;
      case 'running':
        return <Play className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'skipped':
        return <Square className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: Workflow['status'] | WorkflowStep['status']) => {
    switch (status) {
      case 'idle':
      case 'pending':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'running':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'completed':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'failed':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'skipped':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getStepTypeIcon = (type: WorkflowStep['type']) => {
    switch (type) {
      case 'llm':
        return <Zap className="w-3 h-3" />;
      case 'agent':
        return <Settings className="w-3 h-3" />;
      case 'memory':
        return <RotateCcw className="w-3 h-3" />;
      case 'api':
        return <Play className="w-3 h-3" />;
      case 'condition':
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return <Square className="w-3 h-3" />;
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const handleRunWorkflow = (workflowId: string) => {
    setWorkflows(prev => prev.map(workflow => 
      workflow.id === workflowId 
        ? { ...workflow, status: 'running' as const, lastRun: new Date().toISOString() }
        : workflow
    ));
  };

  const handleStopWorkflow = (workflowId: string) => {
    setWorkflows(prev => prev.map(workflow => 
      workflow.id === workflowId 
        ? { ...workflow, status: 'idle' as const }
        : workflow
    ));
  };

  const handleCreateWorkflow = () => {
    if (!newWorkflowName.trim()) return;

    const newWorkflow: Workflow = {
      id: `workflow-${Date.now()}`,
      name: newWorkflowName,
      description: newWorkflowDescription,
      status: 'idle',
      createdAt: new Date().toISOString(),
      runCount: 0,
      steps: []
    };

    setWorkflows(prev => [...prev, newWorkflow]);
    setNewWorkflowName('');
    setNewWorkflowDescription('');
    setIsCreatingWorkflow(false);
  };

  const selectedWorkflowData = workflows.find(w => w.id === selectedWorkflow);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <Settings className="w-5 h-5 text-teal-400" />
          <h3 className="text-lg font-semibold text-white">Orchestration Dashboard</h3>
        </div>
        <button
          onClick={() => setIsCreatingWorkflow(true)}
          className="flex items-center space-x-2 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Workflow</span>
        </button>
      </div>

      <div className="flex-1 flex space-x-6 overflow-hidden">
        {/* Workflows List */}
        <div className="w-1/2 space-y-3 overflow-auto">
          <h4 className="text-sm font-medium text-gray-300 mb-3">Active Workflows</h4>
          
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className={`bg-gray-800/30 border border-gray-700 rounded-lg p-4 cursor-pointer transition-colors ${
                selectedWorkflow === workflow.id ? 'bg-gray-800/60 border-teal-500/50' : 'hover:bg-gray-800/50'
              }`}
              onClick={() => setSelectedWorkflow(workflow.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h5 className="font-medium text-white">{workflow.name}</h5>
                  <p className="text-sm text-gray-400 mt-1">{workflow.description}</p>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(workflow.status)}`}>
                  {getStatusIcon(workflow.status)}
                  <span className="ml-1">{workflow.status.toUpperCase()}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center space-x-4">
                  <span>Steps: {workflow.steps.length}</span>
                  <span>Runs: {workflow.runCount}</span>
                </div>
                <div className="flex items-center space-x-2">
                  {workflow.status === 'running' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStopWorkflow(workflow.id);
                      }}
                      className="p-1 hover:bg-gray-700 rounded text-red-400"
                      title="Stop Workflow"
                    >
                      <Square className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRunWorkflow(workflow.id);
                      }}
                      className="p-1 hover:bg-gray-700 rounded text-green-400"
                      title="Run Workflow"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle edit
                    }}
                    className="p-1 hover:bg-gray-700 rounded text-gray-400"
                    title="Edit Workflow"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {workflow.lastRun && (
                <div className="text-xs text-gray-500 mt-2">
                  Last run: {formatTimestamp(workflow.lastRun)}
                </div>
              )}
            </div>
          ))}

          {isCreatingWorkflow && (
            <div className="bg-gray-800/50 border border-gray-600 rounded-lg p-4">
              <h5 className="font-medium text-white mb-3">Create New Workflow</h5>
              <div className="space-y-3">
                <input
                  type="text"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  placeholder="Workflow name"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-teal-500"
                />
                <textarea
                  value={newWorkflowDescription}
                  onChange={(e) => setNewWorkflowDescription(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 resize-none"
                />
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleCreateWorkflow}
                    className="bg-teal-600 hover:bg-teal-700 text-white px-3 py-1 rounded text-sm transition-colors"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setIsCreatingWorkflow(false);
                      setNewWorkflowName('');
                      setNewWorkflowDescription('');
                    }}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Workflow Details */}
        <div className="w-1/2 overflow-auto">
          {selectedWorkflowData ? (
            <div className="space-y-4">
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                <h4 className="font-medium text-white mb-2">{selectedWorkflowData.name}</h4>
                <p className="text-sm text-gray-400 mb-4">{selectedWorkflowData.description}</p>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">Status:</span>
                    <div className={`inline-flex items-center ml-2 px-2 py-1 rounded-full text-xs border ${getStatusColor(selectedWorkflowData.status)}`}>
                      {getStatusIcon(selectedWorkflowData.status)}
                      <span className="ml-1">{selectedWorkflowData.status.toUpperCase()}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-400">Total Runs:</span>
                    <span className="text-white ml-2">{selectedWorkflowData.runCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Created:</span>
                    <span className="text-white ml-2">{formatTimestamp(selectedWorkflowData.createdAt)}</span>
                  </div>
                  {selectedWorkflowData.lastRun && (
                    <div>
                      <span className="text-gray-400">Last Run:</span>
                      <span className="text-white ml-2">{formatTimestamp(selectedWorkflowData.lastRun)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                <h5 className="font-medium text-white mb-3">Workflow Steps</h5>
                <div className="space-y-3">
                  {selectedWorkflowData.steps.map((step, index) => (
                    <div key={step.id} className="flex items-start space-x-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-xs text-white">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div className="flex items-center space-x-1 text-gray-400">
                              {getStepTypeIcon(step.type)}
                              <span className="text-xs">{step.type}</span>
                            </div>
                            <span className="text-sm font-medium text-white">{step.name}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-gray-500">{formatDuration(step.duration)}</span>
                            <div className={`px-2 py-1 rounded-full text-xs border ${getStatusColor(step.status)}`}>
                              {getStatusIcon(step.status)}
                            </div>
                          </div>
                        </div>
                        {step.output && (
                          <p className="text-xs text-gray-400 mt-1">{step.output}</p>
                        )}
                        {step.error && (
                          <p className="text-xs text-red-400 mt-1">Error: {step.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Settings className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">Select a workflow to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrchestrationDashboard;
