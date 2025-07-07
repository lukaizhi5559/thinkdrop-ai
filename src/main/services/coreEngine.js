/**
 * Core Engine - Agent Coordinator and Core Services Provider
 * Manages agent initialization, provides screenshot services, and handles IPC communication
 */
import { EventEmitter } from 'events';
import { clipboard } from 'electron';
import BackendIntegrationService from './backendIntegration.js';
import ScreenshotAgent from './screenshotAgent.js';
import LocalLLMAgent from './LocalLLMAgent.js';

class CoreEngine extends EventEmitter {
  constructor() {
    super();
    this.lastClipboardContent = '';
    this.screenshotInterval = null;
    
    // Agent coordination
    this.localLLMAgent = new LocalLLMAgent();
    this.isLocalLLMReady = false;
    
    // Core services
    this.screenshotAgent = new ScreenshotAgent(this);
    this.isScreenshotAgentReady = false;
    
    // Backend integration
    this.backendIntegration = BackendIntegrationService;
    
    // System status
    this.isInitialized = false;
  }

  /**
   * Initialize all core agents and services
   */
  async initializeAll() {
    try {
      console.log('🚀 Initializing Core Engine and Agents...');
      
      // Initialize LocalLLMAgent
      this.isLocalLLMReady = await this.initializeLocalLLMAgent();
      
      // Initialize Screenshot Agent
      this.isScreenshotAgentReady = await this.initializeScreenshotAgent();
      
      this.isInitialized = this.isLocalLLMReady && this.isScreenshotAgentReady;
      
      if (this.isInitialized) {
        console.log('✅ Core Engine initialized successfully');
        this.emit('core-engine-ready');
      } else {
        console.warn('⚠️ Core Engine initialization incomplete');
        this.emit('core-engine-partial');
      }
      
      return this.isInitialized;
      
    } catch (error) {
      console.error('❌ Core Engine initialization failed:', error);
      this.emit('core-engine-failed', error);
      return false;
    }
  }

  /**
   * Initialize LocalLLMAgent
   */
  async initializeLocalLLMAgent() {
    try {
      console.log('🧠 Initializing LocalLLMAgent...');
      
      const isReady = await this.localLLMAgent.initialize();
      
      if (isReady) {
        console.log('✅ LocalLLMAgent ready');
      } else {
        console.warn('⚠️ LocalLLMAgent not ready');
      }
      
      return isReady;
      
    } catch (error) {
      console.error('❌ Failed to initialize LocalLLMAgent:', error);
      return false;
    }
  }

  /**
   * Route high-level tasks to LocalLLMAgent orchestration
   */
  async executeTask(taskDescription, options = {}) {
    try {
      if (!this.isLocalLLMReady) {
        throw new Error('LocalLLMAgent not ready');
      }
      
      console.log(`🎯 Routing task to LocalLLMAgent: "${taskDescription}"`);
      
      // Route through LocalLLMAgent orchestration
      const result = await this.localLLMAgent.orchestrate({
        userInput: taskDescription,
        context: {
          source: 'coreEngine',
          options
        }
      });
      
      this.emit('task-completed', result);
      return result;
      
    } catch (error) {
      console.error('❌ Task execution failed:', error);
      const errorResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      
      this.emit('task-failed', errorResult);
      return errorResult;
    }
  }

  /**
   * Initialize screenshot agent
   */
  async initializeScreenshotAgent() {
    try {
      console.log('📸 Initializing screenshot agent...');
      
      this.isScreenshotAgentReady = await this.screenshotAgent.initialize();
      
      if (this.isScreenshotAgentReady) {
        console.log('✅ Screenshot agent ready');
      } else {
        console.warn('⚠️ Screenshot agent not ready');
      }
      
      return this.isScreenshotAgentReady;
      
    } catch (error) {
      console.error('❌ Failed to initialize screenshot agent:', error);
      this.isScreenshotAgentReady = false;
      return false;
    }
  }

  /**
   * Capture and analyze screenshot
   */
  async captureScreenshot(options = {}) {
    try {
      if (!this.isScreenshotAgentReady) {
        console.warn('⚠️ Screenshot agent not ready, initializing...');
        await this.initializeScreenshotAgent();
      }
      
      return await this.screenshotAgent.captureAndAnalyze(options);
      
    } catch (error) {
      console.error('❌ Screenshot capture failed:', error);
      throw error;
    }
  }

  /**
   * Process screenshot with specific intent
   */
  async processScreenshotRequest(intent, options = {}) {
    try {
      if (!this.isScreenshotAgentReady) {
        console.warn('⚠️ Screenshot agent not ready, initializing...');
        await this.initializeScreenshotAgent();
      }
      
      return await this.screenshotAgent.processRequest(intent, options);
      
    } catch (error) {
      console.error('❌ Screenshot processing failed:', error);
      throw error;
    }
  }

  /**
   * Get clipboard content for agent context
   */
  getClipboardContent() {
    try {
      const currentContent = clipboard.readText();
      
      if (currentContent !== this.lastClipboardContent) {
        this.lastClipboardContent = currentContent;
        this.emit('clipboard-changed', currentContent);
      }
      
      return currentContent;
      
    } catch (error) {
      console.error('❌ Failed to read clipboard:', error);
      return '';
    }
  }

  /**
   * Emergency stop all agents and services
   */
  async emergencyStop() {
    try {
      console.log('🚨 Emergency stop triggered!');
      
      // Stop LocalLLMAgent if running
      if (this.isLocalLLMReady) {
        await this.localLLMAgent.emergencyStop();
      }
      
      // Clear any intervals
      if (this.screenshotInterval) {
        clearInterval(this.screenshotInterval);
        this.screenshotInterval = null;
      }
      
      console.log('✅ Emergency stop completed');
      this.emit('emergency-stop-completed');
      
    } catch (error) {
      console.error('❌ Emergency stop failed:', error);
      this.emit('emergency-stop-failed', error);
    }
  }

  /**
   * Get comprehensive system status
   */
  getSystemStatus() {
    return {
      coreEngine: {
        initialized: this.isInitialized,
        hasScreenMonitoring: !!this.screenshotInterval
      },
      localLLMAgent: {
        ready: this.isLocalLLMReady,
        status: this.isLocalLLMReady ? this.localLLMAgent.getHealth() : null
      },
      screenshotAgent: {
        ready: this.isScreenshotAgentReady,
        status: this.screenshotAgent ? this.screenshotAgent.getStatus() : null
      },
      backendIntegration: {
        connected: this.backendIntegration ? this.backendIntegration.isConnected() : false
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Cleanup all resources
   */
  async cleanup() {
    try {
      console.log('🧹 Cleaning up Core Engine...');
      
      await this.emergencyStop();
      
      // Cleanup screenshot agent
      if (this.screenshotAgent) {
        await this.screenshotAgent.cleanup();
      }
      
      console.log('✅ Core Engine cleanup completed');
      
    } catch (error) {
      console.error('❌ Core Engine cleanup failed:', error);
    }
  }
}

export default CoreEngine;
