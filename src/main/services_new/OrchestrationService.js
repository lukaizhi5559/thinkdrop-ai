/**
 * OrchestrationService - Backend API communication for workflows and agents
 * Handles communication with backend orchestration endpoints
 */

/**
 * BibscripAPIError - Custom error class for API errors
 */
export class BibscripAPIError extends Error {
  constructor(message, statusCode = null, details = null) {
    super(message);
    this.name = 'BibscripAPIError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class OrchestrationService {
  constructor(apiConfig = {}) {
    this.baseUrl = apiConfig.baseUrl || process.env.BIBSCRIP_BASE_URL || 'http://localhost:4000';
    this.timeout = apiConfig.timeout || 30000;
    this.logger = apiConfig.logger || console;
    
    // Authentication properties
    this.apiKey = null;
    this.jwtToken = null;
  }

  // Authentication methods
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  setJwtToken(token) {
    this.jwtToken = token;
  }

  /**
   * Create orchestration workflow
   */
  async createWorkflow(workflowData) {
    try {
      const response = await this.makeRequest('/api/orchestration/workflows', {
        method: 'POST',
        body: JSON.stringify(workflowData)
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to create workflow:', error);
      throw error;
    }
  }

  /**
   * Execute workflow
   */
  async executeWorkflow(workflowId, executionData = {}) {
    try {
      const response = await this.makeRequest(`/api/orchestration/workflows/${workflowId}/execute`, {
        method: 'POST',
        body: JSON.stringify(executionData)
      });
      return response;
    } catch (error) {
      this.logger.error(`Failed to execute workflow ${workflowId}:`, error);
      throw error;
    }
  }

  /**
   * Get workflow status
   */
  async getWorkflow(workflowId) {
    try {
      const response = await this.makeRequest(`/api/orchestration/workflows/${workflowId}`, {
        method: 'GET'
      });
      return response;
    } catch (error) {
      this.logger.error(`Failed to get workflow ${workflowId}:`, error);
      throw error;
    }
  }

  /**
   * Get agent by name or ID
   */
  async getAgent(agentIdentifier) {
    try {
      const response = await this.makeRequest(`/api/agents/${agentIdentifier}`, {
        method: 'GET'
      });
      return response;
    } catch (error) {
      this.logger.error(`Failed to get agent ${agentIdentifier}:`, error);
      throw error;
    }
  }

  /**
   * Search for agents
   */
  async searchAgents(searchParams) {
    try {
      const queryString = new URLSearchParams(searchParams).toString();
      const response = await this.makeRequest(`/api/agents/search?${queryString}`, {
        method: 'GET'
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to search agents:', error);
      throw error;
    }
  }

  /**
   * Find best agent for task
   */
  async findBestAgent(taskData) {
    try {
      const response = await this.makeRequest('/api/drops/find-best', {
        method: 'POST',
        body: JSON.stringify(taskData)
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to find best agent:', error);
      throw error;
    }
  }

  /**
   * Store user memory
   */
  async storeUserMemory(userId, memoryData) {
    try {
      const response = await this.makeRequest(`/api/users/${userId}/memories`, {
        method: 'POST',
        body: JSON.stringify(memoryData)
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to store user memory:', error);
      throw error;
    }
  }

  /**
   * Get user memories
   */
  async getUserMemories(userId, filters = {}) {
    try {
      const queryString = new URLSearchParams(filters).toString();
      const response = await this.makeRequest(`/api/users/${userId}/memories?${queryString}`, {
        method: 'GET'
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to get user memories:', error);
      throw error;
    }
  }

  /**
   * Log workflow execution
   */
  async logWorkflowExecution(workflowId, logData) {
    try {
      const response = await this.makeRequest(`/api/orchestration/workflows/${workflowId}/logs`, {
        method: 'POST',
        body: JSON.stringify(logData)
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to log workflow execution:', error);
      throw error;
    }
  }

  /**
   * Get backend health status
   */
  async getHealth() {
    try {
      const response = await this.makeRequest('/api/health', {
        method: 'GET'
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to get backend health:', error);
      throw error;
    }
  }

  /**
   * Make HTTP request with enhanced authentication and error handling
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
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
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorDetails;
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
          errorDetails = errorData;
        } catch {
          // If we can't parse the error response, use the default message
        }
        
        throw new BibscripAPIError(errorMessage, response.status, errorDetails);
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text();
      }
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new BibscripAPIError('Request timeout', 408);
      }
      
      if (error instanceof BibscripAPIError) {
        throw error;
      }
      
      throw new BibscripAPIError(`Network error: ${error.message}`);
    }
  }

  /**
   * Test connection to backend
   */
  async testConnection() {
    try {
      await this.getHealth();
      return { connected: true, timestamp: new Date().toISOString() };
    } catch (error) {
      return { 
        connected: false, 
        error: error.message, 
        timestamp: new Date().toISOString() 
      };
    }
  }
}
