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

/**
 * Register automation IPC handlers
 * @param {Object} client - MCP client instance
 */
function registerAutomationHandlers(client) {
  mcpClient = client;
  
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
   * Capture screenshot
   */
  ipcMain.on('screenshot:capture', async (event) => {
    logger.debug('📸 [IPC:AUTOMATION] Capture screenshot');
    
    try {
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
    } catch (error) {
      logger.error('❌ [IPC:AUTOMATION] Screenshot error:', error.message);
      event.reply('screenshot:error', error.message);
    }
  });

  logger.debug('✅ [IPC:AUTOMATION] Automation IPC handlers registered');
}

module.exports = { registerAutomationHandlers };
