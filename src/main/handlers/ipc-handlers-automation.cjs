/**
 * IPC Handlers for Automation Capabilities
 * 
 * Handles automation commands from the frontend interpreter
 * Executes NutJS primitives for desktop automation
 */

const { ipcMain, shell } = require('electron');
const logger = require('../logger.cjs');

// Try to load libnut for native automation (built from source)
let libnut = null;
try {
  libnut = require('libnut');
  logger.info('✅ [IPC:AUTOMATION] libnut loaded successfully - native automation enabled');
} catch (error) {
  logger.warn('⚠️ [IPC:AUTOMATION] libnut not available, falling back to MCP:', error.message);
}

// We'll use the command service via MCP for actual NutJS execution
// This keeps the automation logic centralized
let mcpClient = null;
let overlayManager = null;

// Guard to prevent concurrent replan requests
let replanInProgress = false;

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
        
        // First, check if the app is actually installed
        try {
          const { stdout: checkResult } = await execAsync(
            `osascript -e 'tell application "System Events" to get name of every application process' | grep -i "${appName}"`
          );
          logger.debug(`🔍 [IPC:AUTOMATION] App check result:`, checkResult.trim());
        } catch (checkError) {
          // App might not be running, try to check if it exists at all
          logger.warn(`⚠️ [IPC:AUTOMATION] App "${appName}" not currently running, attempting to launch...`);
        }
        
        // Try to activate the app
        const { stdout, stderr } = await execAsync(`osascript -e 'tell application "${appName}" to activate'`);
        
        if (stderr) {
          logger.error(`❌ [IPC:AUTOMATION] AppleScript stderr:`, stderr);
          event.reply('automation:focus-app:result', { 
            success: false, 
            error: `Failed to focus "${appName}": ${stderr}` 
          });
          return;
        }
        
        logger.debug(`✅ [IPC:AUTOMATION] Successfully activated "${appName}"`);
        
        // Wait for app focus to settle and prevent keyboard event leakage
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verify the app is actually focused
        const { stdout: frontmostApp } = await execAsync(
          `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
        );
        const actualApp = frontmostApp.trim();
        logger.debug(`🎯 [IPC:AUTOMATION] Frontmost app after focus: "${actualApp}"`);
        
        if (!actualApp.toLowerCase().includes(appName.toLowerCase())) {
          logger.warn(`⚠️ [IPC:AUTOMATION] Expected "${appName}" but got "${actualApp}"`);
        }
        
        event.reply('automation:focus-app:result', { success: true, actualApp });
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

  // Check if app is in fullscreen mode
  ipcMain.on('automation:check-fullscreen', async (event, { appName }) => {
    logger.debug('🔍 [IPC:AUTOMATION] Check fullscreen for:', appName);
    
    try {
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // AppleScript to check if frontmost window is fullscreen
        const script = `
          tell application "System Events"
            tell process "${appName}"
              if exists (window 1) then
                get value of attribute "AXFullScreen" of window 1
              else
                return false
              end if
            end tell
          end tell
        `;
        
        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        const isFullscreen = stdout.trim() === 'true';
        
        logger.debug(`✅ [IPC:AUTOMATION] ${appName} fullscreen status: ${isFullscreen}`);
        event.reply('automation:check-fullscreen:result', { 
          success: true, 
          isFullscreen 
        });
      } else {
        event.reply('automation:check-fullscreen:result', { 
          success: false, 
          error: 'Fullscreen check not implemented for this platform' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Check fullscreen error:', error.message);
      event.reply('automation:check-fullscreen:result', { 
        success: false, 
        error: error.message,
        isFullscreen: false
      });
    }
  });

  // Quit app handler
  ipcMain.on('automation:quit-app', async (event, { appName }) => {
    logger.debug('🚪 [IPC:AUTOMATION] Quit app:', appName);
    
    try {
      // For macOS, use AppleScript to quit app
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        await execAsync(`osascript -e 'tell application "${appName}" to quit'`);
        
        logger.debug(`✅ [IPC:AUTOMATION] Successfully quit ${appName}`);
        event.reply('automation:quit-app:result', { success: true });
      } else {
        // For other platforms, we'd need platform-specific logic
        event.reply('automation:quit-app:result', { 
          success: false, 
          error: 'Quit app not implemented for this platform' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Quit app error:', error.message);
      event.reply('automation:quit-app:result', { 
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
   * Fullscreen the active application using native libnut
   */
  ipcMain.on('automation:fullscreen', async (event) => {
    logger.info('🖥️ [IPC:AUTOMATION] Fullscreen requested');
    
    if (!libnut) {
      event.reply('automation:fullscreen:result', { 
        success: false, 
        error: 'libnut not available' 
      });
      return;
    }
    
    try {
      const platform = process.platform;
      
      // macOS: Ctrl+Cmd+F for presentation mode (fullscreen without menubar)
      // Windows/Linux: F11 for fullscreen
      if (platform === 'darwin') {
        logger.debug('🖥️ [IPC:AUTOMATION] Pressing Ctrl+Cmd+F for macOS presentation mode');
        // Use keyTap with modifiers array (same format as native-hotkey handler)
        libnut.keyTap('f', ['control', 'command']);
      } else {
        logger.debug('🖥️ [IPC:AUTOMATION] Pressing F11 for Windows/Linux fullscreen');
        libnut.keyTap('f11');
      }
      
      logger.info('✅ [IPC:AUTOMATION] Fullscreen hotkey sent successfully');
      event.reply('automation:fullscreen:result', { success: true });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Fullscreen error:', error.message);
      event.reply('automation:fullscreen:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Click at specific coordinates using native libnut
   */
  ipcMain.on('automation:click', async (event, { x, y }) => {
    logger.info(`🖱️ [IPC:AUTOMATION:NATIVE] Click requested at (${x}, ${y})`);
    
    if (!libnut) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] libnut not available');
      event.reply('automation:click:result', { 
        success: false, 
        error: 'libnut not available' 
      });
      return;
    }
    
    try {
      // CRITICAL: Blur all Electron windows to prevent focus stealing
      logger.debug(`🔍 [IPC:AUTOMATION:NATIVE] Blurring all Electron windows before click`);
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.blur();
        }
      });
      
      // Small delay to ensure focus transfer completes
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Move mouse to target position
      logger.debug(`🖱️ [IPC:AUTOMATION:NATIVE] Moving mouse to (${x}, ${y})`);
      libnut.moveMouse(x, y);
      
      // Small delay to ensure mouse movement completes
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Click at the position
      logger.debug(`🖱️ [IPC:AUTOMATION:NATIVE] Clicking at (${x}, ${y})`);
      libnut.mouseClick();
      
      logger.info(`✅ [IPC:AUTOMATION:NATIVE] Click successful at (${x}, ${y})`);
      event.reply('automation:click:result', { success: true });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Click error:', error.message);
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
      const { desktopCapturer, screen } = require('electron');
      const displays = screen.getAllDisplays();
      const primaryDisplay = displays[0];
      
      // Capture full screen
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: primaryDisplay.bounds.width,
          height: primaryDisplay.bounds.height
        }
      });
      
      if (sources.length > 0) {
        const screenshot = sources[0].thumbnail.toDataURL();
        logger.debug('✅ [IPC:AUTOMATION] Screenshot captured successfully', {
          size: screenshot.length
        });
        event.reply('screenshot:captured', screenshot);
      } else {
        logger.error('❌ [IPC:AUTOMATION] No screen sources found');
        event.reply('screenshot:error', 'No screen sources found');
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Screenshot error:', error.message);
      event.reply('screenshot:error', error.message);
    }
  });

  /**
   * Handle replanning request after step failure
   */
  ipcMain.on('automation:replan-needed', async (event, context) => {
    // CRITICAL: Check if replan already in progress to prevent concurrent requests
    if (replanInProgress) {
      logger.warn('⚠️  [IPC:AUTOMATION] Replan already in progress, blocking concurrent request');
      event.reply('automation:replan-result', {
        success: false,
        error: 'Replan already in progress'
      });
      return;
    }
    
    // Mark replan as in progress
    replanInProgress = true;
    logger.info('🔒 [IPC:AUTOMATION] Replan lock acquired');
    
    const hasScreenshot = !!context.context?.screenshot;
    const screenshotSize = hasScreenshot && typeof context.context.screenshot === 'string' 
      ? context.context.screenshot.length 
      : 0;
    
    logger.info('🔄 [IPC:AUTOMATION] Replanning needed:', {
      planId: context.planId,
      failedStepId: context.context?.failedStepId,
      failedStepIndex: context.context?.failedStepIndex,
      error: context.context?.error,
      hasScreenshot: hasScreenshot,
      screenshotSize: screenshotSize
    });
    
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }

      // Call command service to generate new plan with context
      // Note: Frontend sends { planId, previousPlan, context: {...} }
      const replanContext = context.context || context; // Handle both nested and flat structure
      
      const result = await mcpClient.callService(
        'command',
        'command.automate',
        {
          command: context.previousPlan.goal,
          intent: 'command_automate',
          previousPlan: context.previousPlan,
          feedback: {
            reason: 'failure',
            message: `Step ${replanContext.failedStepIndex + 1} failed: ${replanContext.error}. Failed step: ${replanContext.failedStepDescription}`,
            stepId: replanContext.failedStepId
          },
          context: {
            os: process.platform,
            isReplanning: true,
            requestPartialPlan: replanContext.requestPartialPlan || false,
            failedStepIndex: replanContext.failedStepIndex,
            screenshot: replanContext.screenshot  // ← Now correctly accessing nested screenshot
          }
        },
        { timeout: 60000 }
      );

      // Check if backend needs clarification (questions present)
      if (result.success && result.questions && result.questions.length > 0) {
        logger.info('❓ [IPC:AUTOMATION] Backend needs clarification during replan', {
          questionCount: result.questions.length,
          questions: result.questions
        });
        
        // Release replan lock - waiting for user input
        replanInProgress = false;
        logger.info('🔓 [IPC:AUTOMATION] Replan lock released - waiting for clarification');
        
        // Forward clarification questions to prompt window
        const { BrowserWindow } = require('electron');
        const promptWindow = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Prompt'));
        
        if (promptWindow) {
          // Send first question to prompt bar
          const firstQuestion = result.questions[0];
          promptWindow.webContents.send('prompt-bar:request-clarification', {
            question: firstQuestion.text,
            questionId: firstQuestion.id,
            questionType: firstQuestion.type,
            choices: firstQuestion.choices,
            stepIndex: context.failedStepIndex,
            stepDescription: context.failedStepDescription,
            allQuestions: result.questions
          });
          
          logger.info('✅ [IPC:AUTOMATION] Clarification questions forwarded to prompt window');
          
          // Notify renderer that we're waiting for clarification
          event.reply('automation:replan-result', {
            success: true,
            needsClarification: true,
            questions: result.questions
          });
        } else {
          logger.error('❌ [IPC:AUTOMATION] Prompt window not found for clarification');
          event.reply('automation:replan-result', {
            success: false,
            error: 'Cannot show clarification questions - prompt window not found'
          });
        }
      } else if (result.success && result.plan) {
        logger.info('✅ [IPC:AUTOMATION] Replanning successful, new plan generated');
        
        // Release replan lock - plan generated successfully
        replanInProgress = false;
        logger.info('🔓 [IPC:AUTOMATION] Replan lock released - plan generated');
        
        // Send new plan back to renderer
        event.reply('automation:replan-result', {
          success: true,
          newPlan: result.plan
        });
      } else {
        logger.error('❌ [IPC:AUTOMATION] Replanning failed:', result.error);
        
        // Release replan lock on failure
        replanInProgress = false;
        logger.info('🔓 [IPC:AUTOMATION] Replan lock released - replan failed');
        
        event.reply('automation:replan-result', {
          success: false,
          error: result.error || 'Failed to generate new plan'
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Replan error:', error.message);
      
      // Release replan lock on exception
      replanInProgress = false;
      logger.info('🔓 [IPC:AUTOMATION] Replan lock released - exception occurred');
      
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
      stepIndex: context.stepIndex,
      senderWindowTitle: event.sender.getTitle ? event.sender.getTitle() : 'unknown',
      allWindowTitles: BrowserWindow.getAllWindows().map(w => w.getTitle())
    });
    
    // Forward to prompt window
    const { BrowserWindow } = require('electron');
    const promptWindow = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Prompt'));
    
    if (promptWindow) {
      logger.info('✅ [IPC:AUTOMATION] Found prompt window, forwarding clarification request');
      promptWindow.webContents.send('prompt-bar:request-clarification', context);
      logger.info('✅ [IPC:AUTOMATION] Clarification request forwarded to prompt window');
    } else {
      logger.error('❌ [IPC:AUTOMATION] Prompt window not found');
      logger.error('❌ [IPC:AUTOMATION] Available windows:', BrowserWindow.getAllWindows().map(w => ({
        title: w.getTitle(),
        id: w.id
      })));
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
    if (overlayManager?.promptWindow && !overlayManager.promptWindow.isDestroyed()) {
      logger.debug('📤 [IPC:AUTOMATION] Sending automation:state to PromptBar: isRunning=true');
      overlayManager.promptWindow.webContents.send('automation:state', {
        hasAutomation: true,
        isVisible: false,
        isRunning: true
      });
    } else {
      logger.warn('⚠️ [IPC:AUTOMATION] PromptBar window not available');
    }
  });

  /**
   * Handle automation completed successfully - notify PromptBar
   */
  ipcMain.on('automation:completed', (event) => {
    logger.debug('✅ [IPC:AUTOMATION] Automation completed successfully, notifying PromptBar');
    
    // Forward to all overlay windows (especially PromptBar)
    if (overlayManager?.promptWindow && !overlayManager.promptWindow.isDestroyed()) {
      logger.debug('📤 [IPC:AUTOMATION] Sending automation:state to PromptBar: isRunning=false');
      overlayManager.promptWindow.webContents.send('automation:state', {
        hasAutomation: true,
        isVisible: true, // Keep visible to show completion
        isRunning: false // Stop recording icon
      });
    }
  });

  /**
   * Handle automation ended - notify PromptBar
   */
  ipcMain.on('automation:ended', (event) => {
    logger.debug('⏹️  [IPC:AUTOMATION] Automation ended, notifying PromptBar');
    
    // Forward to all overlay windows (especially PromptBar)
    if (overlayManager?.promptWindow && !overlayManager.promptWindow.isDestroyed()) {
      logger.debug('📤 [IPC:AUTOMATION] Sending automation:state to PromptBar: isRunning=false');
      overlayManager.promptWindow.webContents.send('automation:state', {
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

  /**
   * Native libnut automation handlers (fast, local)
   */
  
  // Native mouse click
  ipcMain.on('automation:native-click', async (event, { x, y }) => {
    logger.debug(`🖱️ [IPC:AUTOMATION:NATIVE] Click at (${x}, ${y})`);
    
    if (!libnut) {
      event.reply('automation:native-click:result', { 
        success: false, 
        error: 'libnut not available' 
      });
      return;
    }
    
    try {
      libnut.moveMouse(x, y);
      await new Promise(resolve => setTimeout(resolve, 50));
      libnut.mouseClick();
      
      logger.debug(`✅ [IPC:AUTOMATION:NATIVE] Click successful at (${x}, ${y})`);
      event.reply('automation:native-click:result', { success: true });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Click error:', error.message);
      event.reply('automation:native-click:result', { 
        success: false, 
        error: error.message 
      });
    }
  });
  
  // Native keyboard typing
  ipcMain.on('automation:native-type', async (event, { text }) => {
    logger.debug(`⌨️ [IPC:AUTOMATION:NATIVE] Type text: "${text.substring(0, 50)}..."`);
    
    if (!libnut) {
      event.reply('automation:native-type:result', { 
        success: false, 
        error: 'libnut not available' 
      });
      return;
    }
    
    try {
      // CRITICAL: Blur all Electron windows to ensure target app has focus
      logger.debug(`🔍 [IPC:AUTOMATION:NATIVE] Blurring all Electron windows before typing`);
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.blur();
        }
      });
      
      // Longer delay to ensure focus transfer completes and input field is ready
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Click at current mouse position to ensure focus (in case input field lost focus)
      logger.debug(`🖱️ [IPC:AUTOMATION:NATIVE] Clicking at current position to ensure focus`);
      const mousePos = libnut.getMousePos();
      libnut.mouseClick();
      
      // Small delay after click
      await new Promise(resolve => setTimeout(resolve, 100));
      
      libnut.typeString(text);
      
      logger.debug(`✅ [IPC:AUTOMATION:NATIVE] Text typed successfully`);
      event.reply('automation:native-type:result', { success: true });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Type error:', error.message);
      event.reply('automation:native-type:result', { 
        success: false, 
        error: error.message 
      });
    }
  });
  
  // Native keyboard shortcut
  ipcMain.on('automation:native-hotkey', async (event, { key, modifiers }) => {
    logger.debug(`⌨️ [IPC:AUTOMATION:NATIVE] Hotkey: ${modifiers?.join('+')}+${key}`);
    
    if (!libnut) {
      event.reply('automation:native-hotkey:result', { 
        success: false, 
        error: 'libnut not available' 
      });
      return;
    }
    
    try {
      // Ensure modifiers is an array
      const mods = Array.isArray(modifiers) ? modifiers : [];
      
      // CRITICAL: Do NOT blur Electron windows if this is Cmd+Q
      // We want to quit the target app, not Electron
      // const isCmdQ = mods.includes('command') && key.toLowerCase() === 'q';
      
      // if (!isCmdQ) {
      //   // Blur all Electron windows to ensure target app has focus
      //   logger.debug(`🔍 [IPC:AUTOMATION:NATIVE] Blurring all Electron windows before hotkey`);
      //   const { BrowserWindow } = require('electron');
      //   const windows = BrowserWindow.getAllWindows();
      //   windows.forEach(win => {
      //     if (win && !win.isDestroyed()) {
      //       win.blur();
      //     }
      //   });
        
      //   // Small delay to ensure focus transfer completes
      //   await new Promise(resolve => setTimeout(resolve, 100));
      // } else {
      //   logger.debug(`⚠️ [IPC:AUTOMATION:NATIVE] Cmd+Q detected - NOT blurring Electron windows to avoid quitting Electron`);
      // }
      
      // Map common key names to libnut key codes (only keys that need translation)
      // libnut uses different key names on different platforms
      const isMac = process.platform === 'darwin';
      
      const keyMap = {
        // Enter key: 'return' on macOS, 'enter' on Windows/Linux
        'enter': isMac ? 'return' : 'enter',
        
        // Escape shorthand
        'esc': 'escape'
      };
      
      const normalizedKey = key.toLowerCase();
      const libnutKey = keyMap[normalizedKey] || normalizedKey;
      
      // Log for debugging
      logger.debug(`⌨️ [IPC:AUTOMATION:NATIVE] Key: "${key}" -> "${libnutKey}", Modifiers: [${mods.join(', ')}]`);
      
      // Press the key with modifiers
      if (mods.length > 0) {
        libnut.keyTap(libnutKey, mods);
      } else {
        libnut.keyTap(libnutKey);
      }
      
      logger.debug(`✅ [IPC:AUTOMATION:NATIVE] Hotkey pressed successfully`);
      event.reply('automation:native-hotkey:result', { success: true });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Hotkey error:', error.message);
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Key:', key, 'Modifiers:', modifiers);
      event.reply('automation:native-hotkey:result', { 
        success: false, 
        error: error.message 
      });
    }
  });
  
  // Test native automation
  ipcMain.on('automation:native-test', async (event) => {
    logger.info('🧪 [IPC:AUTOMATION:NATIVE] Running native automation test');
    
    if (!libnut) {
      event.reply('automation:native-test:result', { 
        success: false, 
        error: 'libnut not available' 
      });
      return;
    }
    
    try {
      const screenSize = libnut.getScreenSize();
      const currentPos = libnut.getMousePos();
      
      logger.info('📐 [IPC:AUTOMATION:NATIVE] Screen size:', screenSize);
      logger.info('🖱️ [IPC:AUTOMATION:NATIVE] Current mouse:', currentPos);
      
      event.reply('automation:native-test:result', { 
        success: true,
        screenSize,
        currentPos
      });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Test error:', error.message);
      event.reply('automation:native-test:result', { 
        success: false, 
        error: error.message 
      });
    }
  });
  
  // Capture screen for OCR
  ipcMain.on('automation:capture-screen', async (event) => {
    logger.debug('📸 [IPC:AUTOMATION:NATIVE] Capturing screen for OCR');
    
    try {
      // CRITICAL: Blur all Electron windows before capture to prevent focus stealing
      logger.debug('🔍 [IPC:AUTOMATION:NATIVE] Blurring all Electron windows before screenshot');
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.blur();
        }
      });
      
      // Small delay to ensure focus transfer completes
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const { screen, desktopCapturer } = require('electron');
      
      // Get primary display
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      
      // Capture screen using Electron's desktopCapturer
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      });
      
      if (!sources || sources.length === 0) {
        throw new Error('No screen sources available');
      }
      
      // Get the first screen source (primary display)
      const screenshot = sources[0].thumbnail.toDataURL();
      
      logger.debug('✅ [IPC:AUTOMATION:NATIVE] Screen captured successfully');
      event.reply('automation:capture-screen:result', { 
        success: true,
        screenshot: screenshot
      });
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Screen capture error:', error.message);
      event.reply('automation:capture-screen:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  logger.debug('✅ [IPC:AUTOMATION] Automation IPC handlers registered');
}

module.exports = { registerAutomationHandlers };
