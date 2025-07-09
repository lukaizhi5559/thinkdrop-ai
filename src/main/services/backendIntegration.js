/**
 * Backend Integration Service - Connects ThinkDrop AI with bibscrip-backend
 * Handles the communication flow: Screenshot + OCR + Task → Backend → Action JSON → Execute
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

class BackendIntegrationService {
  constructor(coreEngine) {
    this.coreEngine = coreEngine;
    this.backendUrl = process.env.BIBSCRIP_BASE_URL || '';
    this.apiKey = process.env.BIBSCRIP_API_KEY || '';
    this.authToken = null;
  }

  /**
   * Initialize connection with bibscrip-backend
   */
  async initialize() {
    try {
      console.log('🔗 Initializing backend integration...');
      
      // Test connection
      const healthCheck = await this.checkBackendHealth();
      if (!healthCheck) {
        throw new Error('Backend health check failed');
      }

      // Authenticate if API key is provided
      if (this.apiKey) {
        await this.authenticate();
      }

      console.log('✅ Backend integration initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize backend integration:', error);
      return false;
    }
  }

  /**
   * Check if bibscrip-backend is healthy and reachable
   */
  async checkBackendHealth() {
    try {
      const response = await axios.get(`${this.backendUrl}/api/health`, {
        timeout: 5000
      });
      
      console.log('✅ Backend health check passed');
      return response.status === 200;
    } catch (error) {
      console.error('❌ Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Authenticate with bibscrip-backend
   */
  async authenticate() {
    try {
      const response = await axios.post(`${this.backendUrl}/api/auth/login`, {
        apiKey: this.apiKey
      });

      this.authToken = response.data.token;
      console.log('✅ Authenticated with backend');
      return true;
    } catch (error) {
      console.error('❌ Authentication failed:', error);
      return false;
    }
  }

  /**
   * Get authorization headers for API requests
   */
  getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  /**
   * Execute a task using the backend planning engine
   */
  async executeTaskWithBackend(taskDescription, options = {}) {
    try {
      console.log(`🎯 Executing task: "${taskDescription}"`);
      
      // Step 1: Capture current screen state
      const screenData = await this.captureScreenState();
      
      // Step 2: Send to backend for action planning
      const actionPlan = await this.requestActionPlan({
        taskDescription,
        ...screenData,
        ...options
      });

      // Step 3: Execute the planned action locally
      const result = await this.coreEngine.executeAction(actionPlan);

      // Step 4: Verify action success (optional)
      if (options.verifySuccess) {
        await this.wait(1000); // Wait for UI to update
        const verificationResult = await this.verifyTaskCompletion(taskDescription);
        result.verified = verificationResult;
      }

      console.log('✅ Task execution completed:', result);
      return result;

    } catch (error) {
      console.error('❌ Task execution failed:', error);
      throw error;
    }
  }

  /**
   * Capture current screen state (screenshot + OCR + context)
   */
  async captureScreenState() {
    try {
      console.log('📸 Capturing screen state...');
      
      // Capture screenshot
      const screenshotPath = await this.coreEngine.captureScreen();
      const screenshotBuffer = fs.readFileSync(screenshotPath);
      const screenshotBase64 = screenshotBuffer.toString('base64');

      // Perform OCR
      const ocrResult = await this.coreEngine.performOCR(screenshotPath);

      // Get screen dimensions
      const screenSize = await this.coreEngine.getScreenSize();

      // Get current mouse position
      const mousePosition = await this.coreEngine.getMousePosition();

      // Clean up temporary screenshot file
      try {
        fs.unlinkSync(screenshotPath);
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup screenshot file:', cleanupError);
      }

      return {
        screenshot: screenshotBase64,
        ocrText: ocrResult.text,
        ocrConfidence: ocrResult.confidence,
        screenSize,
        mousePosition,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Failed to capture screen state:', error);
      throw error;
    }
  }

  /**
   * Request action plan from bibscrip-backend
   */
  async requestActionPlan(requestData) {
    try {
      console.log('🧠 Requesting action plan from backend...');
      
      const response = await axios.post(
        `${this.backendUrl}/api/plan-action`,
        requestData,
        {
          headers: this.getAuthHeaders(),
          timeout: 15000 // 15 second timeout for LLM processing
        }
      );

      const actionPlan = response.data;
      console.log('✅ Received action plan:', actionPlan);
      
      return actionPlan;

    } catch (error) {
      console.error('❌ Failed to get action plan from backend:', error);
      
      // Fallback to simple action if backend fails
      if (error.response?.status === 404) {
        console.log('⚠️ Backend planning endpoint not available, using fallback');
        return this.createFallbackAction(requestData.taskDescription);
      }
      
      throw error;
    }
  }

  /**
   * Create a simple fallback action when backend is unavailable
   */
  createFallbackAction(taskDescription) {
    console.log('🔄 Creating fallback action for:', taskDescription);
    
    // Simple heuristic-based fallback
    if (taskDescription.toLowerCase().includes('click')) {
      return {
        action: 'click',
        target: { x: 500, y: 400 }, // Center-ish of typical screen
        confidence: 0.5,
        reasoning: 'Fallback click action'
      };
    }
    
    return {
      action: 'wait',
      duration: 1000,
      confidence: 1.0,
      reasoning: 'Fallback wait action'
    };
  }

  /**
   * Verify task completion by analyzing screen changes
   */
  async verifyTaskCompletion(originalTask) {
    try {
      console.log('🔍 Verifying task completion...');
      
      const screenData = await this.captureScreenState();
      
      const response = await axios.post(
        `${this.backendUrl}/api/verify-completion`,
        {
          originalTask,
          ...screenData
        },
        {
          headers: this.getAuthHeaders(),
          timeout: 10000
        }
      );

      return response.data;

    } catch (error) {
      console.error('❌ Task verification failed:', error);
      return { success: false, confidence: 0, reasoning: 'Verification failed' };
    }
  }

  /**
   * Execute multi-step automation workflow
   */
  async executeWorkflow(steps, options = {}) {
    try {
      console.log(`🔄 Executing workflow with ${steps.length} steps...`);
      
      const results = [];
      
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        console.log(`📋 Step ${i + 1}/${steps.length}: ${step.description || step.taskDescription}`);
        
        try {
          const result = await this.executeTaskWithBackend(
            step.taskDescription || step.description,
            { ...options, ...step.options }
          );
          
          results.push({
            step: i + 1,
            success: true,
            result
          });

          // Wait between steps if specified
          if (step.waitAfter || options.stepDelay) {
            await this.wait(step.waitAfter || options.stepDelay);
          }

        } catch (stepError) {
          console.error(`❌ Step ${i + 1} failed:`, stepError);
          
          results.push({
            step: i + 1,
            success: false,
            error: stepError.message
          });

          // Stop workflow on failure unless continueOnError is true
          if (!options.continueOnError) {
            break;
          }
        }
      }

      console.log('✅ Workflow execution completed');
      return {
        success: results.every(r => r.success),
        results,
        completedSteps: results.filter(r => r.success).length,
        totalSteps: steps.length
      };

    } catch (error) {
      console.error('❌ Workflow execution failed:', error);
      throw error;
    }
  }

  /**
   * Utility function to wait/pause execution
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default BackendIntegrationService;
