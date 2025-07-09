/**
 * Backend API Client for ThinkDrop AI
 * Handles all communication with the backend API for agents, orchestration, and memory
 * Converted from TypeScript for use in main process
 */

// API Client Error Class
class BibscripAPIError extends Error {
  constructor(message, statusCode, details) {
    super(message);
    this.name = 'BibscripAPIError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Main API Client Class
class BackendAPIClient {
  constructor(baseUrl = process.env.BIBSCRIP_BASE_URL, timeout = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = timeout;
    this.apiKey = null;
    this.jwtToken = null;
  }

  // Authentication
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  setJwtToken(token) {
    this.jwtToken = token;
  }

  // Private helper for making requests
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

  // Connection Testing
  async testConnection() {
    try {
      await this.makeRequest('/api/health');
      return true;
    } catch {
      return false;
    }
  }

  async getHealthStatus() {
    return this.makeRequest('/api/health');
  }

  // Intent Parsing - Key method for improved intent detection flow
  async parseIntent(text, context = {}) {
    try {
      console.log('🔍 Calling backend intent parsing API...');
      const result = await this.makeRequest('/api/agents/intent/parse', {
        method: 'POST',
        body: JSON.stringify({ request: text, context })
      });
      
      console.log('✅ Backend intent parsing successful:', result);
      return {
        success: true,
        intent: result.intent,
        category: result.category,
        confidence: result.confidence,
        entities: result.entities || {},
        requiresExternalData: result.requiresExternalData || false
      };
    } catch (error) {
      console.warn('⚠️ Backend intent parsing failed:', error.message);
      return {
        success: false,
        error: error.message,
        fallback: true
      };
    }
  }

  // Orchestration - Enhanced version from OrchestrationService
  async orchestrate(request, options = {}) {
    const payload = {
      request: typeof request === 'string' ? request : request.request,
      requirements: options.requirements || [],
      availableServices: options.availableServices || [],
      enrichWithUserContext: options.enrichWithUserContext || false,
      userId: options.userId || null
    };

    console.log('🚀 Sending orchestration request to backend:', {
      request: payload.request,
      hasRequirements: payload.requirements.length > 0,
      hasServices: payload.availableServices.length > 0,
      enrichWithContext: payload.enrichWithUserContext
    });

    try {
      const response = await this.makeRequest('/api/agents/orchestrate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const result = response;
      console.log('✅ Backend orchestration response:', result.status);

      // Handle different response types
      switch (result.status) {
        case 'success':
          console.log('🎯 Backend orchestration data:', {
            agents: result.agents?.length || 0,
            workflow: result.workflow?.steps?.length || 0,
            processingTime: result.processingTime,
            userContext: result.userContext ? 'present' : 'none'
          });
          console.log('📋 Full orchestration result:', JSON.stringify(result, null, 2));

          return {
            success: true,
            data: result,
            agents: result.agents || [],
            workflow: result.workflow || {},
            processingTime: result.processingTime || 0
          };
        
        case 'clarification_needed':
          return {
            success: false,
            needsClarification: true,
            questions: result.questions || [],
            clarificationId: result.clarificationId,
            analysis: result.analysis || {}
          };
        
        case 'validation_error':
          return {
            success: false,
            error: result.error || 'Validation failed',
            issues: result.issues || []
          };
        
        default:
          return {
            success: true,
            data: result
          };
      }
    } catch (error) {
      console.error('❌ Orchestration API error:', error.message);
      
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        return {
          success: false,
          error: 'Backend orchestration service is not available',
          fallback: true
        };
      }
      
      return {
        success: false,
        error: error.message,
        statusCode: error.statusCode
      };
    }
  }

  // Submit clarification response for a pending orchestration
  async submitClarification(clarificationId, answers) {
    try {
      const response = await this.makeRequest('/api/agents/orchestrate/clarify', {
        method: 'POST',
        body: JSON.stringify({ clarificationId, answers })
      });

      return {
        success: true,
        data: response
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get orchestration service health status
  async getHealth() {
    try {
      const response = await this.makeRequest('/api/agents/health', {
        method: 'GET',
        timeout: 5000
      });

      return {
        success: true,
        status: response.status,
        services: response.services || {}
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        available: false
      };
    }
  }

  // Agent Management
  async getAgents() {
    return this.makeRequest('/api/agents');
  }

  async getAgent(name) {
    return this.makeRequest(`/api/agents/${encodeURIComponent(name)}`);
  }

  async executeAgent(name, parameters, config) {
    return this.makeRequest(`/api/agents/${encodeURIComponent(name)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ parameters, config })
    });
  }
}

// Singleton instance
const apiClient = new BackendAPIClient();

export default apiClient;
export { BackendAPIClient, BibscripAPIError };
