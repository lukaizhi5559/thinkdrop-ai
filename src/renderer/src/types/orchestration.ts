// Orchestration workflow types for Thinkdrop AI frontend

export interface ClarificationRequest {
  id: string;
  question: string;
  type: 'choice' | 'confirmation' | 'text';
  options?: string[];
  required?: boolean;
  context?: Record<string, any>;
}

export interface WorkflowStep {
  id: string;
  agent: string;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_clarification';
  startTime?: string;
  endTime?: string;
  result?: any;
  error?: string;
  clarificationRequest?: ClarificationRequest;
  metadata?: Record<string, any>;
}

export interface OrchestrationWorkflow {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'awaiting_clarification';
  userInput: string;
  intent: string;
  steps: WorkflowStep[];
  currentStepIndex: number;
  startTime: string;
  endTime?: string;
  result?: any;
  error?: string;
  clarificationId?: string;
  questions?: ClarificationRequest[];
  metadata?: Record<string, any>;
}

export interface OrchestrationUpdate {
  type: 'workflow_started' | 'workflow_completed' | 'workflow_failed' | 'workflow_paused' | 'workflow_resumed' | 'step_started' | 'step_completed' | 'step_failed' | 'clarification_requested' | 'clarification_submitted' | 'clarification_needed';
  workflowId: string;
  stepId?: string;
  data?: any;
  workflow?: OrchestrationWorkflow;
  result?: any;
  error?: string;
  clarificationId?: string;
  questions?: ClarificationRequest[];
  fallbackIntent?: string;
  executionTime?: number;
  timestamp: string;
}

export interface ClarificationResponse {
  stepId: string;
  response: string | boolean;
  timestamp: string;
}

// Note: Window interface extension is handled in App.tsx to avoid conflicts

export {};
