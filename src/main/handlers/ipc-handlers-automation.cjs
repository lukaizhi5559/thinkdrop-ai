/**
 * IPC Handlers for Automation Capabilities
 * 
 * Handles automation commands from the frontend interpreter
 * Executes NutJS primitives for desktop automation
 */

const { ipcMain, shell } = require('electron');
const logger = require('../logger.cjs');

// We'll use the command service via MCP for actual NutJS execution
// This keeps the automation logic centralized
let mcpClient = null;
let overlayManager = null;

/**
 * Register automation IPC handlers
 * @param {Object} client - MCP client instance
 * @param {Object} overlay - Overlay manager instance
 */
function registerAutomationHandlers(client, overlay = null) {
  mcpClient = client;
  overlayManager = overlay;
  
  logger.debug('🤖 [IPC:AUTOMATION] Registering automation IPC handlers');

  /**
   * Focus/activate an application by name
   */
  ipcMain.on('automation:focus-app', async (event, { appName }) => {
    logger.debug('🎯 [IPC:AUTOMATION] Focus app:', appName);
    
    try {
      // For macOS, use AppleScript to activate app
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        await execAsync(`osascript -e 'tell application "${appName}" to activate'`);
        
        event.reply('automation:focus-app:result', { success: true });
      } else {
        // For other platforms, we'd need platform-specific logic
        event.reply('automation:focus-app:result', { 
          success: false, 
          error: 'Focus app not implemented for this platform' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Focus app error:', error.message);
      event.reply('automation:focus-app:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Scroll mouse wheel
   */
  ipcMain.on('automation:scroll', async (event, { amount, direction }) => {
    logger.debug('🖱️  [IPC:AUTOMATION] Scroll:', { amount, direction });

    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service via MCP (same as mouse.click)
      const result = await mcpClient.callService(
        'command',
        'mouse.scroll',
        { amount, direction },
        { timeout: 5000 }
      );

      if (result.success) {
        event.reply('automation:scroll:result', { success: true });
      } else {
        event.reply('automation:scroll:result', {
          success: false,
          error: result.error || 'Failed to scroll'
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Scroll error:', error.message);
      event.reply('automation:scroll:result', {
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Open a URL in the default browser
   */
  ipcMain.on('automation:open-url', async (event, { url }) => {
    logger.debug('🌐 [IPC:AUTOMATION] Open URL:', url);
    
    try {
      await shell.openExternal(url);
      event.reply('automation:open-url:result', { success: true });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Open URL error:', error.message);
      event.reply('automation:open-url:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Type text using keyboard
   */
  ipcMain.on('automation:type-text', async (event, { text, submit }) => {
    logger.debug('⌨️  [IPC:AUTOMATION] Type text:', text.substring(0, 50), 'submit:', submit);
    
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service to execute keyboard typing
      const result = await mcpClient.callService(
        'command',
        'keyboard.type',
        { text, submit },
        { timeout: 10000 }
      );

      if (result.success) {
        event.reply('automation:type-text:result', { success: true });
      } else {
        event.reply('automation:type-text:result', { 
          success: false, 
          error: result.error || 'Failed to type text' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Type text error:', error.message);
      event.reply('automation:type-text:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Press a hotkey combination
   */
  ipcMain.on('automation:hotkey', async (event, { keys }) => {
    logger.debug('🔑 [IPC:AUTOMATION] Press hotkey:', keys);
    
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service to execute hotkey
      const result = await mcpClient.callService(
        'command',
        'keyboard.hotkey',
        { keys },
        { timeout: 5000 }
      );

      if (result.success) {
        event.reply('automation:hotkey:result', { success: true });
      } else {
        event.reply('automation:hotkey:result', { 
          success: false, 
          error: result.error || 'Failed to press hotkey' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Hotkey error:', error.message);
      event.reply('automation:hotkey:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Click at specific coordinates
   */
  ipcMain.on('automation:click', async (event, { x, y }) => {
    logger.debug('🖱️  [IPC:AUTOMATION] Click at:', x, y);
    
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service to execute mouse click
      const result = await mcpClient.callService(
        'command',
        'mouse.click',
        { x, y },
        { timeout: 5000 }
      );

      if (result.success) {
        event.reply('automation:click:result', { success: true });
      } else {
        event.reply('automation:click:result', { 
          success: false, 
          error: result.error || 'Failed to click' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Click error:', error.message);
      event.reply('automation:click:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Invoke a backend skill/API action
   */
  ipcMain.on('automation:skill', async (event, { skill, params }) => {
    logger.debug('🎨 [IPC:AUTOMATION] Invoke skill:', skill, params);
    
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service to execute skill
      const result = await mcpClient.callService(
        'command',
        `skill.${skill}`,
        params,
        { timeout: 30000 }
      );

      if (result.success) {
        event.reply('automation:skill:result', { 
          success: true, 
          data: result.data 
        });
      } else {
        event.reply('automation:skill:result', { 
          success: false, 
          error: result.error || 'Failed to invoke skill' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Skill error:', error.message);
      event.reply('automation:skill:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Find element using Vision API
   */
  ipcMain.on('automation:find-element', async (event, { screenshot, description, strategy }) => {
    logger.info('🔍 [IPC:AUTOMATION] Find element request:', { 
      description, 
      strategy,
      screenshotSize: screenshot?.length || 0 
    });
    
    try {
      // Get screen dimensions for coordinate scaling
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds;
      const scaleFactor = primaryDisplay.scaleFactor;
      
      logger.info('📐 [IPC:AUTOMATION] Screen info:', {
        width: screenWidth,
        height: screenHeight,
        scaleFactor: scaleFactor
      });
      
      // Call Vision API /api/vision/locate endpoint directly
      const axios = require('axios');
      const visionUrl = 'http://localhost:4000/api/vision/locate';
      
      logger.info(`📡 [IPC:AUTOMATION] Calling Vision API: ${visionUrl}`);
      
      const response = await axios.post(visionUrl, {
        screenshot: {
          base64: screenshot.replace(/^data:image\/\w+;base64,/, ''),
          mimeType: 'image/png'
        },
        description: description,
        strategy: strategy || 'vision',
        screenInfo: {
          width: screenWidth,
          height: screenHeight,
          scaleFactor: scaleFactor
        }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.THINKDROP_API_KEY || 'test-api-key-123'
        },
        timeout: 15000
      });

      logger.info('📥 [IPC:AUTOMATION] Vision API response:', {
        success: response.data.success,
        hasCoordinates: !!response.data.coordinates,
        coordinates: response.data.coordinates,
        error: response.data.error,
        reasoning: response.data.reasoning
      });

      if (response.data.success && response.data.coordinates) {
        const coords = response.data.coordinates;
        const confidence = response.data.confidence || 0;
        
        // Check if coordinates are invalid (0, 0) with low confidence
        if (coords.x === 0 && coords.y === 0 && confidence < 0.5) {
          logger.warn(`⚠️  [IPC:AUTOMATION] Element not found - Vision API returned (0, 0) with low confidence (${confidence})`);
          event.reply('automation:find-element:result', {
            success: false,
            error: `Could not locate element: ${description}. Vision API returned (0, 0) with confidence ${confidence}.`
          });
          return;
        }
        
        logger.info(`✅ [IPC:AUTOMATION] Element found at (${coords.x}, ${coords.y}) with confidence ${confidence}`);
        logger.info(`📤 [IPC:AUTOMATION] Sending coordinates to renderer:`, { x: coords.x, y: coords.y, confidence, type: typeof coords.x });
        
        event.reply('automation:find-element:result', {
          success: true,
          coordinates: { x: coords.x, y: coords.y },
          confidence: confidence
        });
      } else {
        logger.warn(`⚠️  [IPC:AUTOMATION] Element not found: ${description}`, {
          reason: response.data.error || response.data.reasoning || 'Unknown'
        });
        event.reply('automation:find-element:result', {
          success: false,
          error: response.data.error || response.data.reasoning || `Could not locate element: ${description}`
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Find element error:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        stack: error.stack
      });
      event.reply('automation:find-element:result', {
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Verify step completion using Vision API
   */
  ipcMain.on('automation:verify-step', async (event, { screenshot, expectedState, stepDescription, verificationStrategy }) => {
    logger.debug('✅ [IPC:AUTOMATION] Verify step:', stepDescription);
    
    try {
      // Validate required fields
      if (!screenshot || !stepDescription) {
        logger.error('❌ [IPC:AUTOMATION] Missing required fields for verification', {
          hasScreenshot: !!screenshot,
          hasStepDescription: !!stepDescription
        });
        event.reply('automation:verify-step:result', {
          success: false,
          error: 'Missing required fields: screenshot and stepDescription'
        });
        return;
      }

      // Call Vision API /api/vision/verify endpoint directly
      const axios = require('axios');
      
      // Build description from stepDescription and expectedState
      const description = expectedState 
        ? `Verify that: ${stepDescription}. Expected state: ${expectedState}`
        : `Verify that: ${stepDescription}`;
      
      logger.debug('📡 [IPC:AUTOMATION] Calling Vision verify API', {
        description,
        screenshotLength: screenshot.length,
        verificationStrategy
      });
      
      const response = await axios.post('http://localhost:4000/api/vision/verify', {
        screenshot: {
          base64: screenshot.replace(/^data:image\/\w+;base64,/, ''),
          mimeType: 'image/png'
        },
        description: description  // Backend expects 'description', not 'stepDescription'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.THINKDROP_API_KEY || 'test-api-key-123'
        },
        timeout: 15000
      });

      if (response.data.success && response.data.verified !== undefined) {
        logger.debug(`✅ [IPC:AUTOMATION] Step verified: ${response.data.verified} (confidence: ${response.data.confidence})`);
        event.reply('automation:verify-step:result', {
          success: true,
          verified: response.data.verified,
          confidence: response.data.confidence,
          reasoning: response.data.reasoning
        });
      } else {
        logger.warn(`⚠️  [IPC:AUTOMATION] Verification inconclusive for: ${stepDescription}`);
        event.reply('automation:verify-step:result', {
          success: false,
          error: 'Verification inconclusive'
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Verify step error:', error.message);
      event.reply('automation:verify-step:result', {
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Capture screenshot
   */
  ipcMain.on('screenshot:capture', async (event) => {
    logger.debug('📸 [IPC:AUTOMATION] Capture screenshot');
    
    try {
      // Hide overlay before screenshot
      if (overlayManager && overlayManager.intentWindow) {
        overlayManager.intentWindow.webContents.send('automation:hide-overlay');
        logger.debug('🙈 [IPC:AUTOMATION] Hiding overlay for screenshot');
        // Wait for overlay to hide
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const { desktopCapturer, screen } = require('electron');
      const displays = screen.getAllDisplays();
      const primaryDisplay = displays[0];
      
      // Capture screenshot using Electron's native API
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: primaryDisplay.bounds.width,
          height: primaryDisplay.bounds.height
        }
      });
      
      if (sources.length > 0) {
        const screenshot = sources[0].thumbnail.toDataURL();
        logger.debug('✅ [IPC:AUTOMATION] Screenshot captured successfully');
        event.reply('screenshot:captured', screenshot);
      } else {
        logger.error('❌ [IPC:AUTOMATION] No screen sources found');
        event.reply('screenshot:error', 'No screen sources found');
      }
      
      // Show overlay after screenshot
      if (overlayManager && overlayManager.intentWindow) {
        overlayManager.intentWindow.webContents.send('automation:show-overlay');
        logger.debug('👁️  [IPC:AUTOMATION] Showing overlay after screenshot');
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Screenshot error:', error.message);
      event.reply('screenshot:error', error.message);
      
      // Make sure to show overlay even on error
      if (overlayManager && overlayManager.intentWindow) {
        overlayManager.intentWindow.webContents.send('automation:show-overlay');
      }
    }
  });

  /**
   * Handle replanning request after step failure
   */
  ipcMain.on('automation:replan-needed', async (event, context) => {
    logger.info('🔄 [IPC:AUTOMATION] Replanning needed:', {
      planId: context.planId,
      failedStepId: context.failedStepId,
      failedStepIndex: context.failedStepIndex,
      error: context.error
    });
    
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service to generate new plan with context
      const result = await mcpClient.callService(
        'command',
        'command.automate',
        {
          command: context.previousPlan.goal,
          intent: 'command_automate',
          previousPlan: context.previousPlan,
          feedback: {
            reason: 'failure',
            message: `Step ${context.failedStepIndex + 1} failed: ${context.error}. Failed step: ${context.failedStepDescription}`,
            stepId: context.failedStepId
          },
          context: {
            os: process.platform,
            isReplanning: true,
            requestPartialPlan: context.requestPartialPlan || false,
            failedStepIndex: context.failedStepIndex,
            screenshot: context.screenshot
          }
        },
        { timeout: 60000 }
      );

      // Command service returns { success, plan } not { success, data: { automationPlan } }
      if (result.success && result.plan) {
        logger.info('✅ [IPC:AUTOMATION] Replanning successful, new plan generated');
        
        // Send new plan back to renderer
        event.reply('automation:replan-result', {
          success: true,
          newPlan: result.plan
        });
      } else {
        logger.error('❌ [IPC:AUTOMATION] Replanning failed:', result.error);
        event.reply('automation:replan-result', {
          success: false,
          error: result.error || 'Failed to generate new plan'
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Replan error:', error.message);
      event.reply('automation:replan-result', {
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Handle clarification request - forward to prompt window
   */
  ipcMain.on('prompt-bar:request-clarification', async (event, context) => {
    logger.info('❓ [IPC:AUTOMATION] Clarification requested:', {
      question: context.question,
      stepIndex: context.stepIndex
    });
    
    // Forward to prompt window
    const { BrowserWindow } = require('electron');
    const promptWindow = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Prompt'));
    
    if (promptWindow) {
      promptWindow.webContents.send('prompt-bar:request-clarification', context);
      logger.info('✅ [IPC:AUTOMATION] Clarification request forwarded to prompt window');
    } else {
      logger.error('❌ [IPC:AUTOMATION] Prompt window not found');
    }
  });

  /**
   * Handle clarification answer - forward to automation window
   */
  ipcMain.on('prompt-bar:clarification-answer', async (event, data) => {
    logger.info('✅ [IPC:AUTOMATION] Clarification answer received:', {
      answer: data.answer,
      stepIndex: data.stepIndex
    });
    
    // Forward to all windows (automation progress will pick it up)
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('prompt-bar:clarification-answer', data);
    });
    
    logger.info('✅ [IPC:AUTOMATION] Clarification answer forwarded to all windows');
  });

  /**
   * Handle clarification cancelled
   */
  ipcMain.on('prompt-bar:clarification-cancelled', async (event) => {
    logger.info('❌ [IPC:AUTOMATION] Clarification cancelled by user');
    
    // Could trigger automation cancellation or auto-replan here
    // For now, just log it
  });

  /**
   * Handle replan with clarification answer
   */
  ipcMain.on('automation:replan-with-clarification', async (event, context) => {
    logger.info('🔄 [IPC:AUTOMATION] Replan with clarification:', {
      planId: context.planId,
      answer: context.clarificationAnswer,
      stepIndex: context.failedStepIndex
    });
    
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service to generate new plan with clarification
      const result = await mcpClient.callService(
        'command',
        'command.automate',
        {
          command: context.previousPlan.goal,
          intent: 'command_automate',
          context: {
            os: process.platform,
            isReplanning: true,
            requestPartialPlan: true,
            failedStepIndex: context.failedStepIndex,
            previousPlan: context.previousPlan,
            clarificationAnswer: context.clarificationAnswer,
            questionId: context.questionId,
            feedback: `User provided clarification: "${context.clarificationAnswer}". Please incorporate this into the plan.`
          }
        },
        { timeout: 60000 }
      );

      // Command service returns { success, plan } not { success, data: { automationPlan } }
      if (result.success && result.plan) {
        logger.info('✅ [IPC:AUTOMATION] Replan with clarification successful');
        
        event.reply('automation:replan-result', {
          success: true,
          newPlan: result.plan
        });
      } else {
        logger.error('❌ [IPC:AUTOMATION] Replan with clarification failed:', result.error);
        event.reply('automation:replan-result', {
          success: false,
          error: result.error || 'Failed to generate new plan'
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Replan with clarification error:', error.message);
      event.reply('automation:replan-result', {
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Handle automation started - notify PromptBar
   */
  ipcMain.on('automation:started', (event) => {
    logger.debug('▶️  [IPC:AUTOMATION] Automation started, notifying PromptBar');
    
    // Forward to all overlay windows (especially PromptBar)
    if (overlayManager?.promptOverlay && !overlayManager.promptOverlay.isDestroyed()) {
      overlayManager.promptOverlay.webContents.send('automation:state', {
        hasAutomation: true,
        isVisible: false,
        isRunning: true
      });
    }
  });

  /**
   * Handle automation ended - notify PromptBar
   */
  ipcMain.on('automation:ended', (event) => {
    logger.debug('⏹️  [IPC:AUTOMATION] Automation ended, notifying PromptBar');
    
    // Forward to all overlay windows (especially PromptBar)
    if (overlayManager?.promptOverlay && !overlayManager.promptOverlay.isDestroyed()) {
      overlayManager.promptOverlay.webContents.send('automation:state', {
        hasAutomation: false,
        isVisible: false,
        isRunning: false
      });
    }
  });

  /**
   * Handle user input needed (trigger replan instead) - DEPRECATED, use clarification flow
   */
  ipcMain.on('automation:user-input-needed', async (event, context) => {
    logger.info('❓ [IPC:AUTOMATION] User input needed (deprecated handler):', {
      planId: context.planId,
      questionId: context.questionId,
      message: context.message
    });
    
    // Auto-trigger replan as fallback
    logger.info('🔄 [IPC:AUTOMATION] Auto-triggering replan due to user input needed');
    
    event.reply('automation:trigger-replan', {
      reason: context.message,
      failedStepId: context.stepId,
      failedStepIndex: context.stepIndex
    });
  });

  logger.debug('✅ [IPC:AUTOMATION] Automation IPC handlers registered');
}

module.exports = { registerAutomationHandlers };
