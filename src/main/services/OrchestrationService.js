/**
 * OrchestrationService - Handles backend orchestration API integration
 * Delegates complex multi-step workflows to the backend /api/agents/orchestrate endpoint
 */

import axios from 'axios';

class OrchestrationService {
  constructor(apiKey, baseURL = 'http://localhost:4000') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  /**
   * Orchestrate a user request via backend API
   * @param {string} request - Natural language description of what to orchestrate
   * @param {Object} options - Additional orchestration options
   * @returns {Promise<Object>} Orchestration result
   */
  async orchestrate(request, options = {}) {
    const payload = {
      request,
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
      const response = await axios.post(`${this.baseURL}/api/agents/orchestrate`, payload, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      const result = response.data;
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
      
      if (error.code === 'ECONNREFUSED') {
        return {
          success: false,
          error: 'Backend orchestration service is not available',
          fallback: true
        };
      }
      
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Submit clarification response for a pending orchestration
   * @param {string} clarificationId - ID from the clarification_needed response
   * @param {Object} answers - User's answers to clarification questions
   * @returns {Promise<Object>} Updated orchestration result
   */
  async submitClarification(clarificationId, answers) {
    try {
      const response = await axios.post(`${this.baseURL}/api/agents/orchestrate/clarify`, {
        clarificationId,
        answers
      }, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Get orchestration service health status
   * @returns {Promise<Object>} Health status
   */
  async getHealth() {
    try {
      const response = await axios.get(`${this.baseURL}/api/agents/health`, {
        headers: {
          'X-API-Key': this.apiKey
        },
        timeout: 5000
      });

      return {
        success: true,
        status: response.data.status,
        services: response.data.services || {}
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        available: false
      };
    }
  }

  /**
   * Parse user intent for orchestration routing
   * @param {string} message - User message to parse
   * @returns {Promise<Object>} Intent parsing result
   */
  async parseIntent(message) {
    try {
      const response = await axios.post(`${this.baseURL}/api/agents/intent/parse`, {
        message
      }, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        intent: response.data.intent,
        confidence: response.data.confidence,
        requiresOrchestration: response.data.requiresOrchestration || false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        fallback: true
      };
    }
  }
}

export default OrchestrationService;
