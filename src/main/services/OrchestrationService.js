/**
 * OrchestrationService - Handles backend orchestration API integration
 * Delegates complex multi-step workflows to the backend via centralized apiClient
 * 
 * @deprecated - This service now delegates to apiClient.js for centralized API management
 */

import apiClient from './apiClient.js';

class OrchestrationService {
  constructor(apiKey, baseURL) {
    // Configure the centralized API client
    if (apiKey) {
      apiClient.setApiKey(apiKey);
    }
    if (baseURL && baseURL !== apiClient.baseUrl) {
      // Note: baseURL changes would require creating a new apiClient instance
      console.warn('⚠️ OrchestrationService baseURL differs from apiClient. Using apiClient baseURL:', apiClient.baseUrl);
    }
  }

  /**
   * Orchestrate a user request via backend API
   * @param {string} request - Natural language description of what to orchestrate
   * @param {Object} options - Additional orchestration options
   * @returns {Promise<Object>} Orchestration result
   */
  async orchestrate(request, options = {}) {
    // Delegate to centralized apiClient
    return await apiClient.orchestrate(request, options);
  }

  /**
   * Submit clarification response to continue orchestration
   * @param {string} clarificationId - ID of the clarification request
   * @param {Object} responses - User responses to clarification questions
   * @returns {Promise<Object>} Orchestration continuation result
   */
  async submitClarificationResponse(clarificationId, responses) {
    // Delegate to centralized apiClient
    return await apiClient.submitClarificationResponse(clarificationId, responses);
  }

  /**
   * Get orchestration service health status
   * @returns {Promise<Object>} Health status
   */
  async getHealth() {
    // Delegate to centralized apiClient
    return await apiClient.getHealthStatus();
  }

  /**
   * Parse user intent for orchestration routing
   * @param {string} message - User message to parse
   * @returns {Promise<Object>} Intent parsing result
   */
  async parseIntent(message) {
    // Delegate to centralized apiClient
    return await apiClient.parseIntent(message);
  }
}

export default OrchestrationService;
