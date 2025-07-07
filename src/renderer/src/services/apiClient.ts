/**
 * Backend API Client for ThinkDrop AI
 * Handles all communication with the backend API for agents, orchestration, and memory
 */

// Types based on frontend-example patterns
export interface AgentExecutionConfig {
  timeout?: number;
  retries?: number;
  sandbox?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  injectSecrets?: boolean;
}

export interface AgentExecutionResult {
  success: boolean;
  error?: string;
  logs: ExecutionLog[];
  duration: number;
  metadata?: Record<string, any>;
  injectedSecrets?: string[];
}

export interface ExecutionLog {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: any;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  parameters: AgentParameter[];
  dependencies: string[];
  execution_target: 'frontend' | 'backend';
  requires_database: boolean;
  database_type?: string;
  code: string;
  config: Record<string, any>;
  secrets?: Record<string, any>;
  orchestrator_metadata: Record<string, any>;
  memory?: Record<string, any>;
  capabilities: string[];
  created_at: string;
  updated_at: string;
  version: string;
}

export interface AgentParameter {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: any;
  description: string;
}

export interface OrchestrationRequest {
  request: string;
  userId?: string;
  enrichWithUserContext?: boolean;
  context?: Record<string, any>;
}

export interface OrchestrationResult {
  status: 'success' | 'error' | 'partial';
  next_steps?: string[];
  plan_summary?: string;
  estimated_success_rate?: number;
  clarification_questions?: string[];
  response?: string;
  handledBy?: string;
  sessionId?: string;
  data?: any;
}

export interface IntentResult {
  confidence: number;
  entities: Record<string, any>;
  requirements: string[];
  suggested_agents: string[];
  clarification_needed: boolean;
}

export interface AgentGenerationResult {
  status: 'success' | 'error' | 'reused';
  agent?: Agent;
  confidence?: number;
  reused?: boolean;
  similarityScore?: number;
  matchDetails?: Record<string, any>;
  optimization?: Record<string, any>;
  llm_metadata?: Record<string, any>;
  issues?: string[];
}

export interface BatchAgentRequest {
  requests: string[];
  userId?: string;
  context?: Record<string, any>;
}

export interface BatchAgentResult {
  results: AgentGenerationResult[];
  summary: {
    total: number;
    successful: number;
    reused: number;
    failed: number;
  };
}

// API Client Error Class
export class BibscripAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'BibscripAPIError';
  }
}

// Main API Client Class
class BackendAPIClient {
  private baseUrl: string;
  private timeout: number;
  private apiKey?: string;
  private jwtToken?: string;

  constructor(baseUrl: string = 'http://localhost:3000', timeout: number = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = timeout;
  }

  // Authentication
  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  setJwtToken(token: string) {
    this.jwtToken = token;
  }

  // Private helper for making requests
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };

    // Add authentication headers
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    if (this.jwtToken) {
      headers['Authorization'] = `Bearer ${this.jwtToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new BibscripAPIError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        );
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text() as unknown as T;
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof BibscripAPIError) {
        throw error;
      }
      throw new BibscripAPIError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Connection Testing
  async testConnection(): Promise<boolean> {
    try {
      await this.makeRequest('/api/health');
      return true;
    } catch {
      return false;
    }
  }

  async getHealthStatus(): Promise<Record<string, any>> {
    return this.makeRequest('/api/health');
  }

  // Agent Management
  async getAgents(): Promise<Agent[]> {
    return this.makeRequest('/api/agents');
  }

  async getAgent(name: string): Promise<Agent> {
    return this.makeRequest(`/api/agents/${encodeURIComponent(name)}`);
  }

  async createAgent(request: string, context?: Record<string, any>): Promise<AgentGenerationResult> {
    return this.makeRequest('/api/agents/generate', {
      method: 'POST',
      body: JSON.stringify({ request, context })
    });
  }

  async updateAgent(name: string, updates: Partial<Agent>): Promise<Agent> {
    return this.makeRequest(`/api/agents/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  }

  async deleteAgent(name: string): Promise<void> {
    await this.makeRequest(`/api/agents/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
  }

  // Batch Agent Operations
  async batchGenerateAgents(request: BatchAgentRequest): Promise<BatchAgentResult> {
    return this.makeRequest('/api/agents/batch-generate', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  async batchGenerateWithProgress(
    request: BatchAgentRequest,
    onProgress?: (progress: { completed: number; total: number; current?: string }) => void
  ): Promise<BatchAgentResult> {
    // For now, implement without streaming - can be enhanced later
    const result = await this.batchGenerateAgents(request);
    if (onProgress) {
      onProgress({ completed: result.results.length, total: result.results.length });
    }
    return result;
  }

  // Agent Execution
  async executeAgent(
    name: string,
    parameters: Record<string, any>,
    config?: AgentExecutionConfig
  ): Promise<AgentExecutionResult> {
    return this.makeRequest(`/api/agents/${encodeURIComponent(name)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ parameters, config })
    });
  }

  // Orchestration
  async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    return this.makeRequest('/api/agents/orchestrate', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  async parseIntent(text: string, context?: Record<string, any>): Promise<IntentResult> {
    return this.makeRequest('/api/agents/intent/parse', {
      method: 'POST',
      body: JSON.stringify({ text, context })
    });
  }

  // Agent Communications
  async getAgentCommunications(filters?: {
    agentName?: string;
    timeRange?: { start: string; end: string };
    logLevel?: string;
  }): Promise<ExecutionLog[]> {
    const params = new URLSearchParams();
    if (filters?.agentName) params.append('agent', filters.agentName);
    if (filters?.timeRange?.start) params.append('start', filters.timeRange.start);
    if (filters?.timeRange?.end) params.append('end', filters.timeRange.end);
    if (filters?.logLevel) params.append('level', filters.logLevel);

    const queryString = params.toString();
    const endpoint = `/api/agents/communications${queryString ? `?${queryString}` : ''}`;
    
    return this.makeRequest(endpoint);
  }

  async logAgentCommunication(log: ExecutionLog): Promise<void> {
    await this.makeRequest('/api/agents/communications', {
      method: 'POST',
      body: JSON.stringify(log)
    });
  }

  // Configuration Management
  async getConfig(): Promise<Record<string, any>> {
    return this.makeRequest('/api/config');
  }

  async updateConfig(config: Record<string, any>): Promise<Record<string, any>> {
    return this.makeRequest('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
  }

  // Memory Management (UserMemoryAgent integration)
  async getUserMemories(userId: string, filters?: {
    tags?: string[];
    timeRange?: { start: string; end: string };
  }): Promise<any[]> {
    const params = new URLSearchParams();
    params.append('userId', userId);
    if (filters?.tags) {
      filters.tags.forEach(tag => params.append('tags', tag));
    }
    if (filters?.timeRange?.start) params.append('start', filters.timeRange.start);
    if (filters?.timeRange?.end) params.append('end', filters.timeRange.end);

    return this.makeRequest(`/api/memory/user?${params.toString()}`);
  }

  async addUserMemory(userId: string, memory: {
    content: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }): Promise<any> {
    return this.makeRequest('/api/memory/user', {
      method: 'POST',
      body: JSON.stringify({ userId, ...memory })
    });
  }

  async forgetUserMemory(userId: string, memoryId: string): Promise<void> {
    await this.makeRequest(`/api/memory/user/${memoryId}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId })
    });
  }

  async queryUserMemory(userId: string, query: string): Promise<any[]> {
    return this.makeRequest('/api/memory/user/query', {
      method: 'POST',
      body: JSON.stringify({ userId, query })
    });
  }
}

// Singleton instance
const apiClient = new BackendAPIClient();

export default apiClient;
export { BackendAPIClient };
