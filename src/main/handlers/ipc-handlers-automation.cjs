/**
 * IPC Handlers for Automation Capabilities
 * 
 * Handles automation commands from the frontend interpreter
 * Executes NutJS primitives for desktop automation
 */

const { ipcMain, shell } = require('electron');
const logger = require('../logger.cjs');

// Load @nut-tree-fork/nut-js for native automation
// We'll load it lazily when needed since it's an ESM module
let nutjs = null;
let nutjsLoading = null;

async function getNutJs() {
  if (nutjs) return nutjs;
  if (nutjsLoading) return nutjsLoading;
  
  nutjsLoading = import('@nut-tree-fork/nut-js')
    .then(module => {
      nutjs = module;
      logger.info('✅ [IPC:AUTOMATION] @nut-tree-fork/nut-js loaded successfully - native automation enabled');
      return nutjs;
    })
    .catch(error => {
      logger.warn('⚠️ [IPC:AUTOMATION] @nut-tree-fork/nut-js not available:', error.message);
      throw error;
    });
  
  return nutjsLoading;
}

// We'll use the command service via MCP for actual NutJS execution
// This keeps the automation logic centralized
let mcpClient = null;
let overlayManager = null;

// Guard to prevent concurrent replan requests
let replanInProgress = false;

// Track cursor visibility state
let cursorHidden = false;

// Shared clarification state for cross-window communication
let clarificationState = {
  active: false,
  question: null,
  stepDescription: null,
  stepIndex: null,
  questionId: null,
  intent: null
};

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
   * Launch an application by name (opens if not running)
   */
  ipcMain.on('automation:launch-app', async (event, { appName }) => {
    logger.debug('🚀 [IPC:AUTOMATION] Launch app:', appName);
    
    try {
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Use 'open -a' to launch or activate app
        await execAsync(`open -a "${appName}"`);
        
        // Wait for app to launch and settle
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        logger.debug(`✅ [IPC:AUTOMATION] Successfully launched "${appName}"`);
        event.reply('automation:launch-app:result', { success: true });
      } else {
        event.reply('automation:launch-app:result', { 
          success: false, 
          error: 'Launch app not implemented for this platform' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Launch app error:', error.message);
      event.reply('automation:launch-app:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Find and focus a window by title pattern
   */
  ipcMain.on('automation:find-window', async (event, { titlePattern }) => {
    logger.debug('🪟 [IPC:AUTOMATION] Find window:', titlePattern);
    
    try {
      const windowManager = require('node-window-manager');
      windowManager.requestAccessibility();
      
      const windows = windowManager.getWindows();
      const regex = new RegExp(titlePattern, 'i');
      
      const found = windows.find(w => {
        try {
          const title = w.getTitle ? w.getTitle() : '';
          return regex.test(title);
        } catch (err) {
          return false;
        }
      });
      
      if (found) {
        found.bringToTop();
        const title = found.getTitle ? found.getTitle() : 'Unknown';
        
        logger.debug(`✅ [IPC:AUTOMATION] Window found and focused: "${title}"`);
        
        // Wait for window to be focused
        await new Promise(resolve => setTimeout(resolve, 300));
        
        event.reply('automation:find-window:result', { 
          success: true, 
          title: title 
        });
      } else {
        logger.warn(`⚠️ [IPC:AUTOMATION] Window not found matching: "${titlePattern}"`);
        event.reply('automation:find-window:result', { 
          success: false, 
          error: `Window not found matching: ${titlePattern}` 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Find window error:', error.message);
      event.reply('automation:find-window:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Focus/activate an application by name
   */
  ipcMain.on('automation:focus-app', async (event, { appName }) => {
    logger.debug('🎯 [IPC:AUTOMATION] Focus app:', appName);
    
    try {
      // For macOS, use Spotlight to launch/focus app (more reliable than AppleScript)
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        logger.info(`� [IPC:AUTOMATION] Using Spotlight to focus "${appName}"`);
        
        // Retry logic to ensure app is actually focused
        const maxRetries = 3;
        let actualApp = '';
        let focusSuccess = false;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          logger.debug(`🎯 [IPC:AUTOMATION] Focus attempt ${attempt}/${maxRetries} for "${appName}"`);
          
          try {
           
            
            // Use Spotlight to launch/focus the app
            // This is more reliable than AppleScript activate because:
            // 1. It's system-level and can't be blocked
            // 2. It handles fuzzy matching
            // 3. It launches apps if not running
            // 4. It works even with modal dialogs open
            
            // Load nutjs module
            const nutjsModule = await getNutJs();
            
            // Open Spotlight (Cmd+Space)
            const { keyboard, Key } = nutjsModule;
            await keyboard.pressKey(Key.LeftCmd);
            await keyboard.type(Key.Space);
            await keyboard.releaseKey(Key.LeftCmd);
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Type app name
            const { keyboard: kb } = nutjsModule;
            await kb.type(appName);
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Press Enter to launch/focus
            const { keyboard: kbd, Key: K } = nutjsModule;
            await kbd.type(K.Enter);
            
            // CRITICAL: Close Spotlight explicitly to prevent interference with subsequent actions
            // Spotlight can stay open briefly after Enter, causing next keypresses to go to Spotlight
            await new Promise(resolve => setTimeout(resolve, 300));
            await kbd.type(K.Escape);
            
            // Wait for app to launch and focus
            const waitTime = attempt === 1 ? 800 : 600;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // Verify the app is actually focused
            const { stdout: frontmostApp } = await execAsync(
              `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
            );
            actualApp = frontmostApp.trim();
            logger.debug(`🔍 [IPC:AUTOMATION] Frontmost app after attempt ${attempt}: "${actualApp}"`);
            
            // Check if correct app is focused (case-insensitive partial match)
            if (actualApp.toLowerCase().includes(appName.toLowerCase()) || 
                appName.toLowerCase().includes(actualApp.toLowerCase())) {
              logger.info(`✅ [IPC:AUTOMATION] Successfully focused "${appName}" via Spotlight (actual: "${actualApp}")`);
              focusSuccess = true;
              break;
            }
            
            logger.warn(`⚠️ [IPC:AUTOMATION] Attempt ${attempt}: Expected "${appName}" but got "${actualApp}", retrying...`);
            
          } catch (error) {
            logger.error(`❌ [IPC:AUTOMATION] Spotlight focus error (attempt ${attempt}):`, error.message);
            if (attempt === maxRetries) {
              event.reply('automation:focus-app:result', { 
                success: false, 
                error: `Failed to focus "${appName}": ${error.message}` 
              });
              return;
            }
          }
        }
        
        if (!focusSuccess) {
          logger.error(`❌ [IPC:AUTOMATION] Failed to focus "${appName}" after ${maxRetries} attempts (got "${actualApp}")`);
          event.reply('automation:focus-app:result', { 
            success: false, 
            error: `Failed to focus "${appName}": wrong app "${actualApp}" is frontmost` 
          });
          return;
        }
        
        event.reply('automation:focus-app:result', { success: true, actualApp });
      } else if (process.platform === 'win32') {
        // For Windows, use Windows Search (Win key)
        logger.info(`🔍 [IPC:AUTOMATION] Using Windows Search to focus "${appName}"`);
        
        try {
          await getNutJs();
        } catch (error) {
          event.reply('automation:focus-app:result', { 
            success: false, 
            error: '@nut-tree-fork/nut-js not available for keyboard automation' 
          });
          return;
        }
        
        const maxRetries = 3;
        let focusSuccess = false;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          logger.debug(`🎯 [IPC:AUTOMATION] Focus attempt ${attempt}/${maxRetries} for "${appName}"`);
          
          try {
            // Press Win key to open Windows Search
            const nutjsWin = await getNutJs();
            const { keyboard: kbWin, Key: KeyWin } = nutjsWin;
            await kbWin.type(KeyWin.LeftSuper); // Win key
            await new Promise(resolve => setTimeout(resolve, 400));
            
            // Type app name or file name
            await kbWin.type(appName);
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Press Enter to launch/focus
            await kbWin.type(KeyWin.Enter);
            
            // CRITICAL: Close Windows Search explicitly to prevent interference
            // Windows Search can stay open briefly after Enter
            await new Promise(resolve => setTimeout(resolve, 300));
            await kbWin.type(KeyWin.Escape); // Close Windows Search
            
            // Wait for app/file to launch and focus
            const waitTime = attempt === 1 ? 1000 : 800;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // On Windows, we assume success if no error occurred
            // (Windows doesn't have easy way to verify frontmost app like macOS)
            logger.info(`✅ [IPC:AUTOMATION] Launched "${appName}" via Windows Search`);
            focusSuccess = true;
            break;
            
          } catch (error) {
            logger.error(`❌ [IPC:AUTOMATION] Windows Search error (attempt ${attempt}):`, error.message);
            if (attempt === maxRetries) {
              event.reply('automation:focus-app:result', { 
                success: false, 
                error: `Failed to focus "${appName}": ${error.message}` 
              });
              return;
            }
          }
        }
        
        if (!focusSuccess) {
          event.reply('automation:focus-app:result', { 
            success: false, 
            error: `Failed to focus "${appName}" after ${maxRetries} attempts` 
          });
          return;
        }
        
        event.reply('automation:focus-app:result', { success: true, actualApp: appName });
      } else {
        // For other platforms (Linux), we'd need platform-specific logic
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
        
        // First, get the actual frontmost app process name to ensure we're checking the right app
        const { stdout: frontmostApp } = await execAsync(
          `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
        );
        const actualProcessName = frontmostApp.trim();
        
        logger.debug(`🔍 [IPC:AUTOMATION] Frontmost app: "${actualProcessName}", requested: "${appName}"`);
        
        // Check if the requested app matches the frontmost app (case-insensitive partial match)
        if (!actualProcessName.toLowerCase().includes(appName.toLowerCase()) && 
            !appName.toLowerCase().includes(actualProcessName.toLowerCase())) {
          logger.warn(`⚠️ [IPC:AUTOMATION] Requested app "${appName}" is not frontmost (actual: "${actualProcessName}")`);
          // Return false since the app isn't even focused
          event.reply('automation:check-fullscreen:result', { 
            success: true, 
            isFullscreen: false,
            actualApp: actualProcessName
          });
          return;
        }
        
        // AppleScript to check if frontmost window is fullscreen using the actual process name
        const script = `
          tell application "System Events"
            tell process "${actualProcessName}"
              if exists (window 1) then
                get value of attribute "AXFullScreen" of window 1
              else
                return false
              end if
            end tell
          end tell
        `;
        
        const { stdout, stderr } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        
        if (stderr) {
          logger.warn(`⚠️ [IPC:AUTOMATION] AppleScript stderr: ${stderr}`);
        }
        
        const isFullscreen = stdout.trim() === 'true';
        
        logger.info(`✅ [IPC:AUTOMATION] ${actualProcessName} fullscreen status: ${isFullscreen}`);
        event.reply('automation:check-fullscreen:result', { 
          success: true, 
          isFullscreen,
          actualApp: actualProcessName
        });
      } else {
        event.reply('automation:check-fullscreen:result', { 
          success: false, 
          error: 'Fullscreen check not implemented for this platform' 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Check fullscreen error:', error.message);
      logger.error('❌ [IPC:AUTOMATION] Error details:', error);
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
    
    try {
      await getNutJs();
    } catch (error) {
      event.reply('automation:fullscreen:result', { 
        success: false, 
        error: '@nut-tree-fork/nut-js not available' 
      });
      return;
    }
    
    try {
      const platform = process.platform;
      
      // macOS: Ctrl+Cmd+F for presentation mode (fullscreen without menubar)
      // Windows/Linux: F11 for fullscreen
      const nutjsFS = await getNutJs();
      const { keyboard: kbFS, Key: KeyFS } = nutjsFS;
      if (platform === 'darwin') {
        logger.debug('🖥️ [IPC:AUTOMATION] Pressing Ctrl+Cmd+F for macOS presentation mode');
        await kbFS.pressKey(KeyFS.LeftControl, KeyFS.LeftCmd);
        await kbFS.type(KeyFS.F);
        await kbFS.releaseKey(KeyFS.LeftControl, KeyFS.LeftCmd);
      } else {
        logger.debug('🖥️ [IPC:AUTOMATION] Pressing F11 for Windows/Linux fullscreen');
        await kbFS.type(KeyFS.F11);
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
    
    try {
      await getNutJs();
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] @nut-tree-fork/nut-js not available');
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
      const nutjsClick = await getNutJs();
      const { mouse } = nutjsClick;
      await mouse.setPosition({ x, y });
      
      // Small delay to ensure mouse movement completes
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Click at the position
      logger.debug(`🖱️ [IPC:AUTOMATION:NATIVE] Clicking at (${x}, ${y})`);
      await mouse.leftClick();
      
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
      
      // Get active window bounds for coordinate offset
      // IMPORTANT: Wait a moment for the browser to become active after overlay is hidden
      // The screenshot capture already hides the overlay, so we wait then get the active window
      let windowBounds = null;
      try {
        // Wait 200ms for window focus to shift from overlay to browser
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const windowManager = require('node-window-manager');
        windowManager.requestAccessibility();
        
        // Get the currently active window (should be browser now)
        const activeWindow = windowManager.getActiveWindow();
        
        if (activeWindow) {
          const title = activeWindow.getTitle ? activeWindow.getTitle() : '';
          const path = activeWindow.path || '';
          
          logger.info('🪟 [IPC:AUTOMATION] Active window:', { 
            title: title.substring(0, 50), 
            path: path.substring(0, 50) 
          });
          
          // Check if it's an Electron/ThinkDrop window
          const isElectron = path.toLowerCase().includes('electron') || 
                            path.toLowerCase().includes('thinkdrop') ||
                            title.toLowerCase().includes('thinkdrop');
          
          if (isElectron) {
            logger.warn('⚠️ [IPC:AUTOMATION] Active window is still Electron overlay');
            logger.warn('⚠️ [IPC:AUTOMATION] Browser may not be focused - using full screen coordinates');
          } else {
            // Get bounds of the active window
            const bounds = activeWindow.getBounds();
            windowBounds = {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height
            };
            logger.info('🪟 [IPC:AUTOMATION] Active window bounds:', windowBounds);
          }
        } else {
          logger.warn('⚠️ [IPC:AUTOMATION] No active window found');
        }
      } catch (error) {
        logger.warn('⚠️ [IPC:AUTOMATION] Failed to get window bounds:', error.message || error);
        logger.warn('⚠️ [IPC:AUTOMATION] Error details:', JSON.stringify(error, null, 2));
        if (error.stack) {
          logger.warn('⚠️ [IPC:AUTOMATION] Error stack:', error.stack);
        }
      }
      
      // Call Vision API /api/vision/locate endpoint directly
      const axios = require('axios');
      const visionUrl = 'http://localhost:4000/api/vision/locate';
      
      logger.info(`📡 [IPC:AUTOMATION] Calling Vision API: ${visionUrl}`);
      logger.info(`📡 [IPC:AUTOMATION] Sending windowBounds:`, windowBounds);
      
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
        },
        windowBounds: windowBounds // Add window bounds for coordinate offset
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
   * Web scraping using Playwright (alternative to Vision API)
   */
  ipcMain.on('automation:web-scrape', async (event, { url, action, params }) => {
    logger.debug('🌐 [IPC:AUTOMATION] Web scrape:', { url, action, params });
    
    let browser = null;
    
    try {
      // Use playwright-extra with stealth plugin to bypass bot detection
      const { chromium } = require('playwright-extra');
      const stealth = require('puppeteer-extra-plugin-stealth')();
      chromium.use(stealth);
      
      logger.debug('🚀 [IPC:AUTOMATION] Launching Chromium browser with stealth mode...');
      
      // Launch browser with stealth mode to bypass Cloudflare
      browser = await chromium.launch({ 
        headless: true,
        timeout: 30000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });
      
      logger.debug('✅ [IPC:AUTOMATION] Browser launched successfully with stealth mode');
      
      const page = await browser.newPage();
      
      // Set realistic user agent
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });
      
      // Set a reasonable viewport
      await page.setViewportSize({ width: 1280, height: 720 });
      
      // Set default timeout for all operations
      page.setDefaultTimeout(30000);
      
      let content = '';
      
      switch (action) {
        case 'navigate':
          logger.debug(`🌐 [IPC:AUTOMATION] Navigating to ${url}`);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(params.waitTime || 2000);
          content = await page.content();
          logger.debug(`✅ [IPC:AUTOMATION] Navigation complete, content length: ${content.length}`);
          break;
          
        case 'search':
          logger.debug(`🌐 [IPC:AUTOMATION] Searching on ${url}`);
          
          try {
            logger.debug(`📍 [IPC:AUTOMATION] Step 1: Navigating to ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Wait a bit for dynamic content to load
            await page.waitForTimeout(2000);
            logger.debug(`✅ [IPC:AUTOMATION] Navigation complete`);
            
            if (params.selector && params.text) {
              logger.debug(`📍 [IPC:AUTOMATION] Step 2: Looking for input field`);
              
              // Try multiple common selectors for search inputs
              const possibleSelectors = [
                params.selector,
                'textarea[placeholder*="Ask"]',
                'textarea[placeholder*="Search"]',
                'input[type="text"]',
                'textarea',
                '[contenteditable="true"]'
              ];
              
              let foundSelector = null;
              for (const selector of possibleSelectors) {
                try {
                  logger.debug(`🔍 [IPC:AUTOMATION] Trying selector: "${selector}"`);
                  await page.waitForSelector(selector, { timeout: 3000, state: 'visible' });
                  foundSelector = selector;
                  logger.debug(`✅ [IPC:AUTOMATION] Found selector: "${selector}"`);
                  break;
                } catch (e) {
                  logger.debug(`❌ [IPC:AUTOMATION] Selector "${selector}" not found, trying next...`);
                }
              }
              
              if (!foundSelector) {
                // Log page content for debugging
                const pageText = await page.textContent('body');
                logger.error(`❌ [IPC:AUTOMATION] No input field found. Page content preview: ${pageText.substring(0, 200)}`);
                throw new Error('Could not find search input field on page');
              }
              
              logger.debug(`📍 [IPC:AUTOMATION] Step 3: Filling input with "${params.text}"`);
              
              // Click to focus first
              await page.click(foundSelector);
              await page.waitForTimeout(500);
              
              // Type the text
              await page.fill(foundSelector, params.text);
              logger.debug(`✅ [IPC:AUTOMATION] Text filled`);
              
              logger.debug(`📍 [IPC:AUTOMATION] Step 4: Pressing Enter`);
              await page.press(foundSelector, 'Enter');
              logger.debug(`✅ [IPC:AUTOMATION] Enter pressed`);
              
              logger.debug(`📍 [IPC:AUTOMATION] Step 5: Waiting ${params.waitTime || 5000}ms for results`);
              await page.waitForTimeout(params.waitTime || 5000);
              logger.debug(`✅ [IPC:AUTOMATION] Wait complete`);
              
              logger.debug(`📍 [IPC:AUTOMATION] Step 6: Extracting text content`);
              // Get text content
              content = await page.textContent('body');
              logger.debug(`✅ [IPC:AUTOMATION] Search complete, content length: ${content.length}`);
            } else {
              throw new Error('Search action requires selector and text parameters');
            }
          } catch (searchError) {
            logger.error(`❌ [IPC:AUTOMATION] Search failed:`, searchError.message);
            throw searchError;
          }
          break;
          
        case 'extract':
          logger.debug(`🌐 [IPC:AUTOMATION] Extracting from ${url}`);
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(params.waitTime || 2000);
          
          if (params.selector) {
            logger.debug(`🔍 [IPC:AUTOMATION] Extracting selector "${params.selector}"`);
            await page.waitForSelector(params.selector, { timeout: 10000 });
            content = await page.textContent(params.selector);
          } else {
            content = await page.textContent('body');
          }
          logger.debug(`✅ [IPC:AUTOMATION] Extraction complete, content length: ${content.length}`);
          break;
          
        case 'click':
          logger.debug(`🌐 [IPC:AUTOMATION] Clicking on ${url}`);
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(params.waitTime || 2000);
          
          if (params.selector) {
            logger.debug(`🖱️ [IPC:AUTOMATION] Clicking selector "${params.selector}"`);
            await page.waitForSelector(params.selector, { timeout: 10000 });
            await page.click(params.selector);
            await page.waitForTimeout(1000);
            content = await page.textContent('body');
            logger.debug(`✅ [IPC:AUTOMATION] Click complete, content length: ${content.length}`);
          } else {
            throw new Error('Click action requires selector parameter');
          }
          break;
          
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      
      await browser.close();
      logger.debug('🔒 [IPC:AUTOMATION] Browser closed');
      
      logger.debug('✅ [IPC:AUTOMATION] Web scrape successful');
      event.reply('automation:web-scrape:result', { 
        success: true, 
        content: content || ''
      });
      
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Web scrape error:', error.message);
      logger.error('❌ [IPC:AUTOMATION] Stack trace:', error.stack);
      
      // Ensure browser is closed even on error
      if (browser) {
        try {
          await browser.close();
          logger.debug('🔒 [IPC:AUTOMATION] Browser closed after error');
        } catch (closeError) {
          logger.error('❌ [IPC:AUTOMATION] Failed to close browser:', closeError.message);
        }
      }
      
      event.reply('automation:web-scrape:result', { 
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
        
        // Save screenshot to disk for debugging
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const screenshotsDir = path.join(os.homedir(), '.thinkdrop', 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
          fs.mkdirSync(screenshotsDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(screenshotsDir, `screenshot-${timestamp}.png`);
        
        // Remove data URL prefix and save as PNG
        const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(screenshotPath, base64Data, 'base64');
        
        logger.info('💾 [IPC:AUTOMATION] Screenshot saved to:', screenshotPath);
        
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
        const promptWindow = overlayManager?.promptWindow || global.promptOverlayWindow;
        
        if (promptWindow && !promptWindow.isDestroyed()) {
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
          logger.error('❌ [IPC:AUTOMATION] Prompt window not found or destroyed for clarification');
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
   * Get clarification state (for PromptBar to check before submitting)
   */
  ipcMain.handle('clarification:get-state', async () => {
    logger.debug('📥 [IPC:AUTOMATION] Clarification state requested:', clarificationState);
    return clarificationState;
  });

  /**
   * Set clarification state (for CommandAutomateProgress to activate clarification mode)
   */
  ipcMain.on('clarification:activate', async (event, context) => {
    const { BrowserWindow } = require('electron');
    
    logger.info('🔔 [IPC:AUTOMATION] Activating clarification mode:', {
      question: context.question,
      stepIndex: context.stepIndex,
      questionId: context.questionId,
      intent: context.intent || 'command_automate'
    });
    
    // Update shared state
    clarificationState = {
      active: true,
      question: context.question,
      stepDescription: context.stepDescription,
      stepIndex: context.stepIndex,
      questionId: context.questionId,
      intent: context.intent || 'command_automate'
    };
    
    logger.info('✅ [IPC:AUTOMATION] Clarification state updated:', clarificationState);
    
    // Broadcast to all windows so PromptBar can update its UI
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('clarification:state-changed', clarificationState);
    });
    
    logger.info('✅ [IPC:AUTOMATION] Clarification state broadcasted to all windows');
  });

  /**
   * Clear clarification state (when clarification is answered or cancelled)
   */
  ipcMain.on('clarification:clear', async () => {
    const { BrowserWindow } = require('electron');
    
    logger.info('🔕 [IPC:AUTOMATION] Clearing clarification mode');
    
    clarificationState = {
      active: false,
      question: null,
      stepDescription: null,
      stepIndex: null,
      questionId: null,
      intent: null
    };
    
    // Broadcast to all windows
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('clarification:state-changed', clarificationState);
    });
    
    logger.info('✅ [IPC:AUTOMATION] Clarification state cleared and broadcasted');
  });

  /**
   * Handle clarification request - forward to prompt window (LEGACY - keeping for backward compatibility)
   */
  ipcMain.on('prompt-bar:request-clarification', async (event, context) => {
    const { BrowserWindow } = require('electron');
    
    logger.info('❓ [IPC:AUTOMATION] Clarification requested (legacy handler):', {
      question: context.question,
      stepIndex: context.stepIndex,
      senderWindowTitle: event.sender.getTitle ? event.sender.getTitle() : 'unknown',
      allWindowTitles: BrowserWindow.getAllWindows().map(w => w.getTitle())
    });
    
    // Use new shared state approach
    clarificationState = {
      active: true,
      question: context.question,
      stepDescription: context.stepDescription,
      stepIndex: context.stepIndex,
      questionId: context.questionId,
      intent: context.intent || 'command_automate'
    };
    
    logger.info('✅ [IPC:AUTOMATION] Clarification state updated via legacy handler');
    
    // Broadcast to all windows
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('clarification:state-changed', clarificationState);
    });
    
    // Also forward to prompt window for backward compatibility
    const promptWindow = overlayManager?.promptWindow || global.promptOverlayWindow;
    
    if (promptWindow && !promptWindow.isDestroyed()) {
      logger.info('✅ [IPC:AUTOMATION] Found prompt window, forwarding clarification request');
      promptWindow.webContents.send('prompt-bar:request-clarification', context);
      logger.info('✅ [IPC:AUTOMATION] Clarification request forwarded to prompt window');
    } else {
      logger.error('❌ [IPC:AUTOMATION] Prompt window not found or destroyed');
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
  
  // Get current mouse position
  ipcMain.on('automation:get-mouse-pos', async (event) => {
    try {
      const nutjsPos = await getNutJs();
      const { mouse: mousePos } = nutjsPos;
      const pos = await mousePos.getPosition();
      event.reply('automation:get-mouse-pos:result', pos);
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Get mouse pos error:', error.message);
      event.reply('automation:get-mouse-pos:result', { x: 0, y: 0 });
    }
  });

  // Native mouse click
  ipcMain.on('automation:native-click', async (event, { x, y }) => {
    logger.debug(`🖱️ [IPC:AUTOMATION:NATIVE] Click at (${x}, ${y})`);
    
    try {
      await getNutJs();
    } catch (error) {
      event.reply('automation:native-click:result', { 
        success: false, 
        error: '@nut-tree-fork/nut-js not available' 
      });
      return;
    }
    
    try {
      // Move mouse to target position
      const nutjsMV = await getNutJs();
      const { mouse: mouseMV } = nutjsMV;
      await mouseMV.setPosition({ x, y });
      
      // Wait longer to ensure mouse position is registered
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Perform the click
      await mouseMV.leftClick();
      
      // Small delay after click to ensure it registers
      await new Promise(resolve => setTimeout(resolve, 100));
      
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
    logger.info(`⌨️ [IPC:AUTOMATION:NATIVE] ========== TYPE TEXT START ==========`);
    logger.info(`⌨️ [IPC:AUTOMATION:NATIVE] Text to type: "${text}"`);
    logger.info(`⌨️ [IPC:AUTOMATION:NATIVE] Text length: ${text.length} characters`);
    
    try {
      await getNutJs();
    } catch (error) {
      logger.error(`❌ [IPC:AUTOMATION:NATIVE] @nut-tree-fork/nut-js not available!`);
      event.reply('automation:native-type:result', { 
        success: false, 
        error: 'libnut not available' 
      });
      return;
    }
    
    logger.info(`✅ [IPC:AUTOMATION:NATIVE] libnut is available`);
    
    try {
      // CRITICAL: Do NOT blur Electron windows when typing into system UI like Spotlight
      // Blurring windows causes Spotlight to lose focus and close/deactivate
      // Spotlight is a system overlay that maintains its own focus independently
      
      // Small delay to ensure the target application/UI is ready to receive input
      logger.info(`⏳ [IPC:AUTOMATION:NATIVE] Waiting 200ms for UI to be ready...`);
      await new Promise(resolve => setTimeout(resolve, 200));
      logger.info(`✅ [IPC:AUTOMATION:NATIVE] Ready to type`);
      
      // CRITICAL: Do NOT click before typing - this causes issues with system search bars
      // like Spotlight on macOS. The search field is already focused after opening with Cmd+Space.
      // Clicking at the current mouse position can close Spotlight or move focus away.
      
      logger.info(`⌨️ [IPC:AUTOMATION:NATIVE] About to type text: "${text}"`);
      const nutjsType = await getNutJs();
      const { keyboard: kbType } = nutjsType;
      await kbType.type(text);
      logger.info(`✅ [IPC:AUTOMATION:NATIVE] Text typing completed`);
      
      logger.info(`✅ [IPC:AUTOMATION:NATIVE] ========== TYPE TEXT SUCCESS ==========`);
      event.reply('automation:native-type:result', { success: true });
    } catch (error) {
      logger.error(`❌ [IPC:AUTOMATION:NATIVE] ========== TYPE TEXT FAILED ==========`);
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Error details:', error);
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Error message:', error.message);
      logger.error('❌ [IPC:AUTOMATION:NATIVE] Error stack:', error.stack);
      event.reply('automation:native-type:result', { 
        success: false, 
        error: error.message 
      });
    }
  });
  
  // Native keyboard shortcut
  ipcMain.on('automation:native-hotkey', async (event, { key, modifiers }) => {
    logger.debug(`⌨️ [IPC:AUTOMATION:NATIVE] Hotkey: ${modifiers?.join('+')}+${key}`);
    
    try {
      await getNutJs();
    } catch (error) {
      event.reply('automation:native-hotkey:result', { 
        success: false, 
        error: '@nut-tree-fork/nut-js not available' 
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
        'esc': 'escape',
        
        // Arrow keys: libnut uses 'down', 'up', 'left', 'right'
        'arrowdown': 'down',
        'arrowup': 'up',
        'arrowleft': 'left',
        'arrowright': 'right'
      };
      
      const normalizedKey = key.toLowerCase();
      const libnutKey = keyMap[normalizedKey] || normalizedKey;
      
      // Log for debugging
      logger.debug(`⌨️ [IPC:AUTOMATION:NATIVE] Key: "${key}" -> "${libnutKey}", Modifiers: [${mods.join(', ')}]`);
      
      // Press the key with modifiers
      const nutjsHK = await getNutJs();
      const { keyboard: kbHK, Key: KeyHK } = nutjsHK;
      if (mods.length > 0) {
        // Map modifier strings to Key constants
        const modKeys = mods.map(m => {
          if (m === 'command' || m === 'cmd') return KeyHK.LeftCmd;
          if (m === 'control' || m === 'ctrl') return KeyHK.LeftControl;
          if (m === 'shift') return KeyHK.LeftShift;
          if (m === 'alt' || m === 'option') return KeyHK.LeftAlt;
          return null;
        }).filter(k => k !== null);
        
        for (const modKey of modKeys) {
          await kbHK.pressKey(modKey);
        }
        await kbHK.type(libnutKey);
        for (const modKey of modKeys.reverse()) {
          await kbHK.releaseKey(modKey);
        }
      } else {
        await kbHK.type(libnutKey);
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
    
    try {
      await getNutJs();
    } catch (error) {
      event.reply('automation:native-test:result', { 
        success: false, 
        error: '@nut-tree-fork/nut-js not available' 
      });
      return;
    }
    
    try {
      const nutjsTest = await getNutJs();
      const { screen: scr, mouse: mouseInfo } = nutjsTest;
      const screenSize = { width: await scr.width(), height: await scr.height() };
      const currentPos = await mouseInfo.getPosition();
      
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

  /**
   * Save screenshot to file
   */
  ipcMain.on('automation:save-screenshot', async (event, { screenshot, filename }) => {
    logger.info(`💾 [IPC:AUTOMATION] Saving screenshot: ${filename}`);
    
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      // Create screenshots directory in ~/.thinkdrop/screenshots/
      const screenshotsDir = path.join(os.homedir(), '.thinkdrop', 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
        logger.debug(`📁 [IPC:AUTOMATION] Created screenshots directory: ${screenshotsDir}`);
      }
      
      // Remove data URL prefix if present
      const base64Data = screenshot.replace(/^data:image\/png;base64,/, '');
      
      // Write file
      const filePath = path.join(screenshotsDir, filename);
      fs.writeFileSync(filePath, base64Data, 'base64');
      
      logger.info(`✅ [IPC:AUTOMATION] Screenshot saved: ${filePath}`);
      
      // Optionally open in Preview (macOS)
      if (process.platform === 'darwin') {
        const { shell } = require('electron');
        shell.openPath(filePath);
        logger.debug(`🖼️ [IPC:AUTOMATION] Opening screenshot in Preview`);
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to save screenshot:', error.message);
    }
  });

  /**
   * OCR Analysis for testing
   */
  ipcMain.on('ocr:analyze', async (event, { screenshot }) => {
    logger.debug('🔍 [IPC:AUTOMATION] OCR analysis requested');
    
    try {
      const axios = require('axios');
      
      // Call OCR API endpoint
      const response = await axios.post('http://localhost:4000/api/vision/ocr', {
        screenshot: {
          base64: screenshot.replace(/^data:image\/\w+;base64,/, ''),
          mimeType: 'image/png'
        }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.THINKDROP_API_KEY || 'test-api-key-123'
        },
        timeout: 30000
      });

      if (response.data.success) {
        logger.debug('✅ [IPC:AUTOMATION] OCR analysis complete', {
          blockCount: response.data.blocks?.length || 0
        });
        event.reply('ocr:result', {
          success: true,
          data: {
            text: response.data.text || '',
            confidence: response.data.confidence || 0,
            blocks: response.data.blocks || []
          }
        });
      } else {
        logger.error('❌ [IPC:AUTOMATION] OCR analysis failed:', response.data.error);
        event.reply('ocr:result', {
          success: false,
          error: response.data.error || 'OCR analysis failed'
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] OCR error:', error.message);
      event.reply('ocr:result', {
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Wait for browser page to finish loading
   * Polls the browser tab's loading state using AppleScript
   */
  ipcMain.on('automation:wait-page-load', async (event, { timeout }) => {
    const startTime = Date.now();
    const maxWait = timeout || 10000;
    
    logger.debug(`⏳ [IPC:AUTOMATION] Waiting for page to load (timeout: ${maxWait}ms)`);
    
    try {
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Check which browser is frontmost
        const getFrontAppScript = `
          tell application "System Events"
            set frontApp to name of first application process whose frontmost is true
          end tell
          return frontApp
        `;
        
        const { stdout: frontApp } = await execAsync(`osascript -e '${getFrontAppScript}'`);
        const browserName = frontApp.trim();
        
        logger.debug(`🌐 [IPC:AUTOMATION] Detected browser: ${browserName}`);
        
        // Poll for page load completion
        let loaded = false;
        let attempts = 0;
        const maxAttempts = Math.floor(maxWait / 200);
        
        while (!loaded && attempts < maxAttempts) {
          try {
            let checkScript = '';
            
            // Chrome/Arc - check if active tab is loading
            if (browserName.includes('Chrome') || browserName.includes('Arc')) {
              checkScript = `
                tell application "${browserName}"
                  if (count of windows) > 0 then
                    tell active tab of front window
                      return loading
                    end tell
                  else
                    return false
                  end if
                end tell
              `;
            }
            // Safari - check document readyState
            else if (browserName.includes('Safari')) {
              checkScript = `
                tell application "Safari"
                  if (count of windows) > 0 then
                    tell front document
                      return do JavaScript "document.readyState !== 'complete'"
                    end tell
                  else
                    return false
                  end if
                end tell
              `;
            }
            // Firefox or other browsers - use progressive delay
            else {
              logger.debug(`⚠️ [IPC:AUTOMATION] Unknown browser "${browserName}", using progressive delay`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              loaded = true;
              break;
            }
            
            if (checkScript) {
              const { stdout: isLoading } = await execAsync(`osascript -e '${checkScript}'`);
              
              if (isLoading.trim() === 'false') {
                loaded = true;
                logger.debug(`✅ [IPC:AUTOMATION] Page loaded after ${Date.now() - startTime}ms`);
              } else {
                await new Promise(resolve => setTimeout(resolve, 200));
                attempts++;
              }
            }
          } catch (error) {
            // If AppleScript fails, assume page is loaded and proceed
            logger.debug(`⚠️ [IPC:AUTOMATION] AppleScript check failed, assuming loaded: ${error.message}`);
            loaded = true;
          }
        }
        
        const duration = Date.now() - startTime;
        
        if (!loaded) {
          logger.warn(`⚠️ [IPC:AUTOMATION] Page load timeout after ${duration}ms, proceeding anyway`);
        }
        
        event.reply('automation:wait-page-load:result', { 
          success: true, 
          duration 
        });
        
      } else if (process.platform === 'win32') {
        // Windows: Use PowerShell to detect browser load state
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Poll for page load completion
        let loaded = false;
        let attempts = 0;
        const maxAttempts = Math.floor(maxWait / 300);
        
        while (!loaded && attempts < maxAttempts) {
          try {
            // Get foreground window title (browsers show "Loading..." or similar in title)
            const psScript = `
              Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                using System.Text;
                public class WindowHelper {
                  [DllImport("user32.dll")]
                  public static extern IntPtr GetForegroundWindow();
                  [DllImport("user32.dll")]
                  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
                  public static string GetActiveWindowTitle() {
                    IntPtr hWnd = GetForegroundWindow();
                    StringBuilder sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, 256);
                    return sb.ToString();
                  }
                }
"@
              [WindowHelper]::GetActiveWindowTitle()
            `;
            
            const { stdout: windowTitle } = await execAsync(`powershell -Command "${psScript}"`, { 
              timeout: 2000 
            });
            
            // Check if title contains loading indicators
            const title = windowTitle.trim().toLowerCase();
            const isLoading = title.includes('loading') || 
                            title.includes('connecting') || 
                            title.includes('waiting');
            
            if (!isLoading) {
              loaded = true;
              logger.debug(`✅ [IPC:AUTOMATION] Page loaded after ${Date.now() - startTime}ms (Windows)`);
            } else {
              await new Promise(resolve => setTimeout(resolve, 300));
              attempts++;
            }
          } catch (error) {
            // If PowerShell fails, assume loaded and proceed
            logger.debug(`⚠️ [IPC:AUTOMATION] PowerShell check failed, assuming loaded: ${error.message}`);
            loaded = true;
          }
        }
        
        const duration = Date.now() - startTime;
        
        if (!loaded) {
          logger.warn(`⚠️ [IPC:AUTOMATION] Page load timeout after ${duration}ms, proceeding anyway (Windows)`);
        }
        
        event.reply('automation:wait-page-load:result', { 
          success: true, 
          duration 
        });
        
      } else {
        // Other platforms: use simple delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        event.reply('automation:wait-page-load:result', { 
          success: true, 
          duration: 2000 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Wait page load error:', error.message);
      event.reply('automation:wait-page-load:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Wait for app window to stabilize after focus
   * Ensures the app window is fully rendered and ready
   */
  ipcMain.on('automation:wait-app-stability', async (event, { appName, timeout }) => {
    const startTime = Date.now();
    const maxWait = timeout || 3000;
    
    logger.debug(`⏳ [IPC:AUTOMATION] Waiting for ${appName} to stabilize (timeout: ${maxWait}ms)`);
    
    try {
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Poll for window stability
        let stable = false;
        let attempts = 0;
        const maxAttempts = Math.floor(maxWait / 300);
        
        while (!stable && attempts < maxAttempts) {
          try {
            const checkStabilityScript = `
              tell application "System Events"
                tell process "${appName}"
                  if (count of windows) > 0 then
                    set frontWin to front window
                    
                    -- Get initial position and size
                    set pos1 to position of frontWin
                    set size1 to size of frontWin
                    
                    delay 0.2
                    
                    -- Check if position/size changed (window is animating)
                    set pos2 to position of frontWin
                    set size2 to size of frontWin
                    
                    if pos1 is equal to pos2 and size1 is equal to size2 then
                      return "stable"
                    else
                      return "animating"
                    end if
                  else
                    return "no_window"
                  end if
                end tell
              end tell
            `;
            
            const { stdout } = await execAsync(`osascript -e '${checkStabilityScript}'`);
            
            if (stdout.includes('stable') || stdout.includes('no_window')) {
              stable = true;
              logger.debug(`✅ [IPC:AUTOMATION] ${appName} stabilized after ${Date.now() - startTime}ms`);
            } else {
              await new Promise(resolve => setTimeout(resolve, 300));
              attempts++;
            }
          } catch (error) {
            // If AppleScript fails, assume stable and proceed
            logger.debug(`⚠️ [IPC:AUTOMATION] Stability check failed, assuming stable: ${error.message}`);
            stable = true;
          }
        }
        
        const duration = Date.now() - startTime;
        
        if (!stable) {
          logger.warn(`⚠️ [IPC:AUTOMATION] App stability timeout after ${duration}ms, proceeding anyway`);
        }
        
        event.reply('automation:wait-app-stability:result', { 
          success: true, 
          duration 
        });
        
      } else if (process.platform === 'win32') {
        // Windows: Use PowerShell to detect window stability
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Poll for window stability
        let stable = false;
        let attempts = 0;
        const maxAttempts = Math.floor(maxWait / 300);
        
        while (!stable && attempts < maxAttempts) {
          try {
            // Get foreground window position and size, check twice for stability
            const psScript = `
              Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                public class WindowHelper {
                  [DllImport("user32.dll")]
                  public static extern IntPtr GetForegroundWindow();
                  
                  [DllImport("user32.dll")]
                  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
                  
                  [StructLayout(LayoutKind.Sequential)]
                  public struct RECT {
                    public int Left;
                    public int Top;
                    public int Right;
                    public int Bottom;
                  }
                  
                  public static string GetWindowBounds() {
                    IntPtr hWnd = GetForegroundWindow();
                    RECT rect;
                    GetWindowRect(hWnd, out rect);
                    return rect.Left + "," + rect.Top + "," + rect.Right + "," + rect.Bottom;
                  }
                }
"@
              $bounds1 = [WindowHelper]::GetWindowBounds()
              Start-Sleep -Milliseconds 200
              $bounds2 = [WindowHelper]::GetWindowBounds()
              if ($bounds1 -eq $bounds2) { "stable" } else { "animating" }
            `;
            
            const { stdout } = await execAsync(`powershell -Command "${psScript}"`, { 
              timeout: 2000 
            });
            
            if (stdout.includes('stable')) {
              stable = true;
              logger.debug(`✅ [IPC:AUTOMATION] ${appName} stabilized after ${Date.now() - startTime}ms (Windows)`);
            } else {
              await new Promise(resolve => setTimeout(resolve, 300));
              attempts++;
            }
          } catch (error) {
            // If PowerShell fails, assume stable and proceed
            logger.debug(`⚠️ [IPC:AUTOMATION] Stability check failed, assuming stable: ${error.message}`);
            stable = true;
          }
        }
        
        const duration = Date.now() - startTime;
        
        if (!stable) {
          logger.warn(`⚠️ [IPC:AUTOMATION] App stability timeout after ${duration}ms, proceeding anyway (Windows)`);
        }
        
        event.reply('automation:wait-app-stability:result', { 
          success: true, 
          duration 
        });
        
      } else {
        // Other platforms: use simple delay
        await new Promise(resolve => setTimeout(resolve, 800));
        event.reply('automation:wait-app-stability:result', { 
          success: true, 
          duration: 800 
        });
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Wait app stability error:', error.message);
      event.reply('automation:wait-app-stability:result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  /**
   * Hide system cursor during automation
   */
  ipcMain.on('automation:hide-cursor', async (event) => {
    try {
      logger.info('👻 [IPC:AUTOMATION] Hiding system cursor');
      
      try {
        await getNutJs();
      } catch (error) {
        logger.warn('⚠️ [IPC:AUTOMATION] @nut-tree-fork/nut-js not available, cannot hide cursor');
        return;
      }
      
      if (cursorHidden) {
        logger.debug('ℹ️ [IPC:AUTOMATION] Cursor already hidden, skipping');
        return;
      }
      
      // Move cursor off-screen (simple, cross-platform approach)
      // Position (0, 0) is typically top-left corner
      const nutjsHide = await getNutJs();
      const { mouse: mouseHide } = nutjsHide;
      await mouseHide.setPosition({ x: 0, y: 0 });
      cursorHidden = true;
      
      logger.info('✅ [IPC:AUTOMATION] System cursor moved off-screen');
      
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to hide cursor:', error.message);
    }
  });

  /**
   * Show system cursor after automation
   */
  ipcMain.on('automation:show-cursor', async (event) => {
    restoreCursor('👁️ [IPC:AUTOMATION] Showing system cursor');
  });

  /**
   * Get active window bounds for coordinate offset (intent-driven mode)
   * CRITICAL: Fixes Vision API coordinate mismatch bug
   */
  ipcMain.handle('automation:get-window-bounds', async (event, params = {}) => {
    const { appName } = params;
    logger.debug('🪟 [IPC:AUTOMATION] Get window bounds for:', appName);
    
    try {
      const windowManager = require('node-window-manager');
      
      // Request accessibility permissions
      try {
        windowManager.requestAccessibility();
      } catch (accessError) {
        logger.warn('⚠️ [IPC:AUTOMATION] Accessibility request failed:', accessError.message);
        // Continue anyway - might still work
      }
      
      // Get the currently active window
      let activeWindow;
      try {
        activeWindow = windowManager.getActiveWindow();
      } catch (getWindowError) {
        logger.warn('⚠️ [IPC:AUTOMATION] Failed to get active window, using default bounds:', getWindowError.message);
        // Return default bounds (full screen) instead of failing
        return { x: 0, y: 0, width: 1920, height: 1080 };
      }
      
      if (!activeWindow) {
        logger.warn('⚠️ [IPC:AUTOMATION] No active window found, using default bounds');
        return { x: 0, y: 0, width: 1920, height: 1080 };
      }
      
      // Safely get window properties
      let title = '';
      let path = '';
      try {
        title = activeWindow.getTitle ? activeWindow.getTitle() : '';
        path = activeWindow.path || '';
      } catch (propError) {
        logger.warn('⚠️ [IPC:AUTOMATION] Failed to get window properties:', propError.message);
      }
      
      logger.debug('🪟 [IPC:AUTOMATION] Active window:', { 
        title: title.substring(0, 50), 
        path: path.substring(0, 50) 
      });
      
      // Check if it's an Electron/ThinkDrop window
      const isElectron = path.toLowerCase().includes('electron') || 
                        path.toLowerCase().includes('thinkdrop') ||
                        title.toLowerCase().includes('thinkdrop');
      
      if (isElectron) {
        logger.warn('⚠️ [IPC:AUTOMATION] Active window is Electron overlay - returning undefined');
        return undefined;
      }
      
      // Get bounds of the active window
      let bounds;
      try {
        bounds = activeWindow.getBounds();
      } catch (boundsError) {
        logger.error('❌ [IPC:AUTOMATION] Failed to get window bounds:', boundsError.message);
        return undefined;
      }
      
      const windowBounds = {
        x: bounds.x || 0,
        y: bounds.y || 0,
        width: bounds.width || 0,
        height: bounds.height || 0
      };
      
      logger.info('🪟 [IPC:AUTOMATION] Window bounds:', windowBounds);
      return windowBounds;
      
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to get window bounds:', error.message);
      logger.error('❌ [IPC:AUTOMATION] Error stack:', error.stack);
      return undefined;
    }
  });

  // ============================================================================
  // FILE SYSTEM OPERATIONS
  // ============================================================================

  const fs = require('fs').promises;
  const path = require('path');
  const os = require('os');

  /**
   * Validate file path to prevent directory traversal attacks
   * @param {string} filePath - Path to validate
   * @returns {Object} { isSafe: boolean, warning: string|null }
   */
  function validatePath(filePath) {
    // Resolve to absolute path
    const resolvedPath = path.resolve(filePath);
    
    // Get user's home directory
    const homeDir = os.homedir();
    
    // Safe paths (no warning needed)
    const safePaths = [
      homeDir,
      path.join(homeDir, 'Desktop'),
      path.join(homeDir, 'Documents'),
      path.join(homeDir, 'Downloads'),
      '/tmp',
      '/var/tmp',
    ];
    
    // Check if path starts with any safe path
    const isSafe = safePaths.some(safePath => resolvedPath.startsWith(safePath));
    
    if (!isSafe) {
      // Path is outside safe directories - return warning but allow
      const warning = `⚠️ Path is outside safe directories (${resolvedPath}). This could affect system files.`;
      logger.warn(warning);
      return { isSafe: false, warning, resolvedPath };
    }
    
    return { isSafe: true, warning: null, resolvedPath };
  }

  /**
   * Read file from disk
   */
  ipcMain.handle('automation:readFile', async (event, { path: filePath, encoding = 'utf8' }) => {
    try {
      const { resolvedPath, warning } = validatePath(filePath);
      
      // Check file size before reading
      const stats = await fs.stat(resolvedPath);
      if (stats.size > 10 * 1024 * 1024) {
        throw new Error('File too large (max 10 MB)');
      }
      
      // Read file
      const content = await fs.readFile(resolvedPath, encoding);
      
      logger.info('✅ [IPC:AUTOMATION] File read:', resolvedPath, `(${stats.size} bytes)`);
      if (warning) logger.warn(warning);
      
      return {
        content,
        size: stats.size,
        warning,
      };
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to read file:', error.message);
      throw new Error(`Failed to read file: ${error.message}`);
    }
  });

  /**
   * Write file to disk
   */
  ipcMain.handle('automation:writeFile', async (event, { path: filePath, content, encoding = 'utf8' }) => {
    try {
      const { resolvedPath, warning } = validatePath(filePath);
      
      // Check content size
      if (content.length > 10 * 1024 * 1024) {
        throw new Error('Content too large (max 10 MB)');
      }
      
      // Ensure parent directory exists
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
      
      // Write file
      await fs.writeFile(resolvedPath, content, encoding);
      const stats = await fs.stat(resolvedPath);
      
      logger.info('✅ [IPC:AUTOMATION] File written:', resolvedPath, `(${stats.size} bytes)`);
      if (warning) logger.warn(warning);
      
      return {
        success: true,
        bytesWritten: stats.size,
        warning,
      };
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to write file:', error.message);
      throw new Error(`Failed to write file: ${error.message}`);
    }
  });

  /**
   * Append to file
   */
  ipcMain.handle('automation:appendFile', async (event, { path: filePath, content }) => {
    try {
      const { resolvedPath, warning } = validatePath(filePath);
      
      // Check content size
      if (content.length > 1 * 1024 * 1024) {
        throw new Error('Content too large for append (max 1 MB)');
      }
      
      // Append to file
      await fs.appendFile(resolvedPath, content, 'utf8');
      
      logger.info('✅ [IPC:AUTOMATION] Content appended:', resolvedPath);
      if (warning) logger.warn(warning);
      
      return {
        success: true,
        warning,
      };
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to append to file:', error.message);
      throw new Error(`Failed to append to file: ${error.message}`);
    }
  });

  /**
   * Check if file exists
   */
  ipcMain.handle('automation:fileExists', async (event, { path: filePath }) => {
    try {
      const { resolvedPath, warning } = validatePath(filePath);
      
      // Check if file exists
      try {
        await fs.access(resolvedPath);
        logger.info('✅ [IPC:AUTOMATION] File exists:', resolvedPath);
        if (warning) logger.warn(warning);
        return { exists: true, warning };
      } catch {
        logger.info('❌ [IPC:AUTOMATION] File not found:', resolvedPath);
        return { exists: false, warning };
      }
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to check file exists:', error.message);
      throw new Error(`Failed to check file exists: ${error.message}`);
    }
  });

  /**
   * List directory contents
   */
  ipcMain.handle('automation:listDirectory', async (event, { path: dirPath }) => {
    try {
      const { resolvedPath, warning } = validatePath(dirPath);
      
      // Read directory
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      
      const files = entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name);
      
      const directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
      
      logger.info('✅ [IPC:AUTOMATION] Directory listed:', resolvedPath, `(${files.length} files, ${directories.length} dirs)`);
      if (warning) logger.warn(warning);
      
      return {
        files,
        directories,
        warning,
      };
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to list directory:', error.message);
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  });

  /**
   * Create directory
   */
  ipcMain.handle('automation:createDirectory', async (event, { path: dirPath }) => {
    try {
      const { resolvedPath, warning } = validatePath(dirPath);
      
      // Create directory (recursive)
      await fs.mkdir(resolvedPath, { recursive: true });
      
      logger.info('✅ [IPC:AUTOMATION] Directory created:', resolvedPath);
      if (warning) logger.warn(warning);
      
      return {
        success: true,
        warning,
      };
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to create directory:', error.message);
      throw new Error(`Failed to create directory: ${error.message}`);
    }
  });

  /**
   * Delete file
   */
  ipcMain.handle('automation:deleteFile', async (event, { path: filePath }) => {
    try {
      const { resolvedPath, warning } = validatePath(filePath);
      
      // Delete file
      await fs.unlink(resolvedPath);
      
      logger.info('✅ [IPC:AUTOMATION] File deleted:', resolvedPath);
      if (warning) logger.warn(warning);
      
      return {
        success: true,
        warning,
      };
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to delete file:', error.message);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  });

  /**
   * Get file stats
   */
  ipcMain.handle('automation:getFileStats', async (event, { path: filePath }) => {
    try {
      const { resolvedPath, warning } = validatePath(filePath);
      
      // Get file stats
      const stats = await fs.stat(resolvedPath);
      
      logger.info('✅ [IPC:AUTOMATION] File stats retrieved:', resolvedPath);
      if (warning) logger.warn(warning);
      
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        warning,
      };
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Failed to get file stats:', error.message);
      throw new Error(`Failed to get file stats: ${error.message}`);
    }
  });

  logger.debug('✅ [IPC:AUTOMATION] Automation IPC handlers registered');
}

/**
 * Restore cursor to center of screen
 * Shared function used by both IPC handler and process exit handlers
 * @param {string} logMessage - Custom log message for context
 */
async function restoreCursor(logMessage = '🔄 [IPC:AUTOMATION] Restoring cursor') {
  try {
    logger.info(logMessage);
    
    try {
      await getNutJs();
    } catch (error) {
      logger.warn('⚠️ [IPC:AUTOMATION] @nut-tree-fork/nut-js not available, cannot restore cursor');
      return;
    }
    
    if (!cursorHidden) {
      logger.debug('ℹ️ [IPC:AUTOMATION] Cursor already visible, skipping');
      return;
    }
    
    // Move cursor to center of screen
    const nutjsShow = await getNutJs();
    const { screen: scrShow, mouse: mouseShow } = nutjsShow;
    const screenWidth = await scrShow.width();
    const screenHeight = await scrShow.height();
    const centerX = Math.floor(screenWidth / 2);
    const centerY = Math.floor(screenHeight / 2);
    
    await mouseShow.setPosition({ x: centerX, y: centerY });
    cursorHidden = false;
    
    logger.info('✅ [IPC:AUTOMATION] System cursor moved to center');
    
  } catch (error) {
    logger.error('❌ [IPC:AUTOMATION] Failed to restore cursor:', error.message);
  }
}

/**
 * Restore cursor on process exit
 * Safety measure to ensure cursor is always visible
 */
function restoreCursorOnExit() {
  restoreCursor('🔄 [IPC:AUTOMATION] Restoring cursor on process exit');
}

// Register process exit handlers
process.on('exit', restoreCursorOnExit);
process.on('SIGINT', () => {
  restoreCursorOnExit();
  process.exit(0);
});
process.on('SIGTERM', () => {
  restoreCursorOnExit();
  process.exit(0);
});
process.on('uncaughtException', (error) => {
  logger.error('❌ [IPC:AUTOMATION] Uncaught exception, restoring cursor:', error.message);
  restoreCursorOnExit();
  process.exit(1);
});

module.exports = { registerAutomationHandlers };
