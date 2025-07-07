/**
 * Core Engine - Handles audio capture, clipboard monitoring, and screen capture
 */
const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');
const { mouse, keyboard, Key, screen } = require('@nut-tree-fork/nut-js');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { EventEmitter } = require('events');
const record = require('node-record-lpcm16');
const clipboard = require('electron').clipboard;
const uiIndexerDaemon = require('./uiIndexerDaemon');
const desktopAutomationService = require('./desktopAutomationService');
const BackendIntegrationService = require('./backendIntegration');
const ScreenshotAgent = require('./screenshotAgent');

class CoreEngine extends EventEmitter {
  constructor() {
    super();
    this.isRecording = false;
    this.recording = null;
    this.ocrWorker = null;
    this.lastClipboardContent = '';
    this.screenshotInterval = null;
    this.uiIndexer = uiIndexerDaemon;
    this.isUIIndexerRunning = false;
    this.desktopAutomation = desktopAutomationService;
    this.isDesktopAutomationReady = false;
    this.screenshotAgent = new ScreenshotAgent(this);
    this.isScreenshotAgentReady = false;
  }

  // Audio capture and STT
  startAudioCapture() {
    if (this.isRecording) return;
    
    console.log('[AUDIO] Starting audio capture...');
    this.isRecording = true;

    const recording = record.record({
      sampleRateHertz: 16000,
      threshold: 0,
      verbose: false,
      recordProgram: 'rec',
      silence: '1.0',
    });

    recording.stream()
      .on('data', (chunk) => {
        this.emit('audioData', chunk);
      })
      .on('error', (err) => {
        console.error('[ERROR] Audio recording error:', err);
        this.emit('audioError', err);
      });

    this.recording = recording;
  }

  stopAudioCapture() {
    if (!this.isRecording) return;
    
    console.log('[AUDIO] Stopping audio capture...');
    this.isRecording = false;
    
    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }
  }

  // Start all monitoring services
  startAll() {
    this.startAudioCapture();
  }

  // Stop all monitoring services
  stopAll() {
    this.stopAudioCapture();
  }

  /**
   * Enhanced stopAll method with UI Indexer
   */
  async stopAllWithVisualAutomation() {
    try {
      console.log('[AUDIO] Stopping all services with visual automation...');
      
      // Stop traditional services
      this.stopAll();
      
      // Stop UI Indexer
      await this.stopUIIndexer();
      
      console.log('✅ All services with visual automation stopped');
      
    } catch (error) {
      console.error('❌ Failed to stop all services with visual automation:', error);
      throw error;
    }
  }

  // ===== HIGH-LEVEL DESKTOP AUTOMATION =====

  /**
   * Initialize desktop automation service
   */
  async initializeDesktopAutomation() {
    try {
      console.log('🚀 Initializing desktop automation service...');
      
      // Check if service is ready
      this.isDesktopAutomationReady = this.desktopAutomation.isReady();
      
      if (this.isDesktopAutomationReady) {
        console.log('✅ Desktop automation service ready');
      } else {
        console.warn('⚠️ Desktop automation service not ready');
      }
      
      return this.isDesktopAutomationReady;
      
    } catch (error) {
      console.error('❌ Failed to initialize desktop automation:', error);
      this.isDesktopAutomationReady = false;
      return false;
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
        await this.initializeScreenshotAgent();
      }
      
      return await this.screenshotAgent.processScreenshotRequest(intent, options);
      
    } catch (error) {
      console.error('❌ Screenshot request processing failed:', error);
      throw error;
    }
  }

  /**
   * Execute high-level task using natural language description
   */
  async executeHighLevelTask(taskDescription, options = {}) {
    try {
      console.log(`🎯 Executing high-level task: "${taskDescription}"`);
      
      // Step 1: Ensure all services are running
      if (!this.isUIIndexerRunning) {
        await this.startUIIndexer(options.backendUrl, options.apiKey);
      }
      
      if (!this.isDesktopAutomationReady) {
        await this.initializeDesktopAutomation();
      }
      
      // Step 2: Get current application context
      const currentApp = await this.getCurrentApp();
      console.log(`📱 Current app: ${currentApp.name} - ${currentApp.windowTitle}`);
      
      // Step 3: Scan UI elements
      const uiScanResult = await this.scanCurrentApp();
      const uiElements = uiScanResult ? uiScanResult.elements : [];
      
      console.log(`📊 Found ${uiElements.length} UI elements for task planning`);
      
      // Step 4: Execute task using desktop automation service
      const executionResult = await this.desktopAutomation.executeTask(
        taskDescription,
        uiElements,
        currentApp,
        {
          timeout: options.timeout || 30000,
          screenshotOnError: options.screenshotOnError !== false,
          screenshotOnSuccess: options.screenshotOnSuccess || false,
          retryFailedActions: options.retryFailedActions !== false,
          maxRetries: options.maxRetries || 2,
          maxActions: options.maxActions || 10,
          allowFallback: options.allowFallback !== false
        }
      );
      
      console.log(`🎯 Task execution completed:`, {
        success: executionResult.success,
        executedActions: executionResult.executedActions,
        totalActions: executionResult.totalActions,
        duration: `${executionResult.duration.toFixed(2)}ms`
      });
      
      // Emit result for frontend
      this.emit('task-completed', executionResult);
      
      return executionResult;
      
    } catch (error) {
      console.error('❌ High-level task execution failed:', error);
      const errorResult = {
        success: false,
        executedActions: 0,
        totalActions: 0,
        error: error.message,
        duration: 0,
        timestamp: new Date().toISOString()
      };
      
      this.emit('task-failed', errorResult);
      return errorResult;
    }
  }

  /**
   * Validate if a task can be completed with current UI state
   */
  async validateTaskFeasibility(taskDescription) {
    try {
      console.log(`🔍 Validating task feasibility: "${taskDescription}"`);
      
      // Ensure UI Indexer is running
      if (!this.isUIIndexerRunning) {
        console.warn('⚠️ UI Indexer not running, starting for validation...');
        await this.startUIIndexer();
      }
      
      // Get current UI elements
      const uiScanResult = await this.scanCurrentApp();
      const uiElements = uiScanResult ? uiScanResult.elements : [];
      
      // Validate with desktop automation service
      const feasibilityResult = await this.desktopAutomation.validateTaskFeasibility(
        taskDescription,
        uiElements
      );
      
      console.log(`📋 Task feasibility result:`, {
        feasible: feasibilityResult.feasible,
        confidence: feasibilityResult.confidence,
        elementCount: uiElements.length
      });
      
      return feasibilityResult;
      
    } catch (error) {
      console.error('❌ Task feasibility validation failed:', error);
      return {
        feasible: false,
        confidence: 0.1,
        reasoning: `Validation failed: ${error.message}`,
        requiredElements: []
      };
    }
  }

  /**
   * Emergency stop all automation
   */
  async emergencyStopAutomation() {
    try {
      console.log('🚨 Emergency stop triggered!');
      
      // Stop desktop automation
      if (this.isDesktopAutomationReady) {
        await this.desktopAutomation.emergencyStop();
      }
      
      // Stop all services
      await this.stopAllWithVisualAutomation();
      
      console.log('✅ Emergency stop completed');
      this.emit('emergency-stop-completed');
      
    } catch (error) {
      console.error('❌ Emergency stop failed:', error);
      this.emit('emergency-stop-failed', error);
    }
  }

  /**
   * Get comprehensive automation status
   */
  getAutomationStatus() {
    return {
      uiIndexer: this.getUIIndexerStatus(),
      desktopAutomation: {
        isReady: this.isDesktopAutomationReady,
        serviceReady: this.desktopAutomation.isReady()
      },
      coreEngine: {
        isRecording: this.isRecording,
        hasScreenMonitoring: !!this.screenshotInterval
      },
      screenshotAgent: {
        isReady: this.isScreenshotAgentReady,
        status: this.screenshotAgent ? this.screenshotAgent.getStatus() : null
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = CoreEngine;
