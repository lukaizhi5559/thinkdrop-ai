/**
 * Window Tracker - Lightweight window change detection
 * Tracks active window/tab changes and notifies main thread
 * Replaces VirtualScreenDOM (analysis now handled by ScreenWatcher service)
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('./../logger.cjs');
const execAsync = promisify(exec);

// AppleScript commands for getting browser URLs
const BROWSER_URL_SCRIPTS = {
  'Google Chrome': `tell application "Google Chrome" to get URL of active tab of front window as string`,
  'Chrome': `tell application "Google Chrome" to get URL of active tab of front window as string`,
  'Safari': `tell application "Safari" to return URL of front document as string`,
  'Firefox': `tell application "Firefox" to return URL of front window`,
  'Brave Browser': `tell application "Brave Browser" to get URL of active tab of front window as string`,
  'Brave': `tell application "Brave Browser" to get URL of active tab of front window as string`,
  'Microsoft Edge': `tell application "Microsoft Edge" to get URL of active tab of front window as string`,
  'Edge': `tell application "Microsoft Edge" to get URL of active tab of front window as string`,
  'Arc': `tell application "Arc" to get URL of active tab of front window as string`,
  'Vivaldi': `tell application "Vivaldi" to return URL of active tab of front window`
};

// AppleScript commands for getting browser tab titles
const BROWSER_TITLE_SCRIPTS = {
  'Google Chrome': `tell application "Google Chrome" to get title of active tab of front window as string`,
  'Chrome': `tell application "Google Chrome" to get title of active tab of front window as string`,
  'Safari': `tell application "Safari" to return name of front document as string`,
  'Firefox': `tell application "Firefox" to return name of front window`,
  'Brave Browser': `tell application "Brave Browser" to get title of active tab of front window as string`,
  'Brave': `tell application "Brave Browser" to get title of active tab of front window as string`,
  'Microsoft Edge': `tell application "Microsoft Edge" to get title of active tab of front window as string`,
  'Edge': `tell application "Microsoft Edge" to get title of active tab of front window as string`,
  'Arc': `tell application "Arc" to get title of active tab of front window as string`,
  'Vivaldi': `tell application "Vivaldi" to return name of active tab of front window`
};

const FOCUS_CHECK_INTERVAL = 500; // Check window focus every 500ms

class WindowTracker {
  constructor() {
    this.activeWindow = null;
    this.windowListener = null;
  }

  /**
   * Get browser URL using AppleScript (macOS only)
   */
  async getBrowserURL(appName) {
    const script = BROWSER_URL_SCRIPTS[appName];
    if (!script) return null;
    
    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      return stdout.trim() || null;
    } catch (error) {
      logger.debug(`[TRACKER] ❌ AppleScript error for ${appName}:`, error.message);
      return null;
    }
  }

  /**
   * Get browser tab title using AppleScript (macOS only)
   */
  async getBrowserTabTitle(appName) {
    const script = BROWSER_TITLE_SCRIPTS[appName];
    if (!script) return null;
    
    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      return stdout.trim() || null;
    } catch (error) {
      logger.debug(`[TRACKER] ❌ Tab title error for ${appName}:`, error.message);
      return null;
    }
  }

  /**
   * Start the window tracker
   */
  async start() {
    logger.debug('[TRACKER] 👁️  Starting Window Tracker...');
    this.startFocusWatcher();
    logger.debug('[TRACKER] ✅ Window Tracker started');
  }

  /**
   * Watch for window focus changes using node-window-manager
   */
  async startFocusWatcher() {
    logger.debug('[TRACKER] 🔍 Starting active window listener...');
    
    try {
      const windowManagerModule = await import('node-window-manager');
      const windowManager = windowManagerModule.windowManager || windowManagerModule.default?.windowManager;
      
      if (!windowManager) {
        throw new Error('Could not load windowManager from node-window-manager');
      }
      
      logger.debug('[TRACKER] 📦 Using node-window-manager for window detection');
      
      let lastWindowPath = null;
      let lastUrl = null;
      
      const checkActiveWindow = async () => {
        try {
          windowManager.requestAccessibility();
          const activeWindow = windowManager.getActiveWindow();
          
          if (!activeWindow) return;
          
          const currentPath = activeWindow.path || '';
          const appMatch = currentPath ? currentPath.match(/([^/\\]+)\.(app|exe)$/i) : null;
          const app = appMatch ? appMatch[1] : (currentPath ? currentPath.split(/[/\\]/).pop() : 'Unknown') || 'Unknown';
          
          // For browsers, check URL changes
          let currentUrl = null;
          if (BROWSER_URL_SCRIPTS[app]) {
            currentUrl = await this.getBrowserURL(app);
          }
          
          const windowChanged = currentPath !== lastWindowPath;
          const urlChanged = currentUrl && currentUrl !== lastUrl;
          
          if (windowChanged || urlChanged) {
            lastWindowPath = currentPath;
            lastUrl = currentUrl;
            
            logger.debug('[TRACKER] 🔔 Window changed detected!');
            
            let title = activeWindow.getTitle ? activeWindow.getTitle() : (activeWindow.title || '');
            
            // For browsers, get the actual tab title via AppleScript
            if (BROWSER_TITLE_SCRIPTS[app]) {
              const tabTitle = await this.getBrowserTabTitle(app);
              if (tabTitle) {
                title = tabTitle;
                logger.debug(`[TRACKER] 📑 Using browser tab title: "${title}"`);
              }
            }
            
            let url = currentUrl;
            if (url) {
              logger.debug(`[TRACKER] 🌐 URL: ${url}`);
            }
            
            // Create unique window ID
            const windowId = url 
              ? `${app}-${url}`.substring(0, 150)
              : `${app}-${title}`.substring(0, 100);
            
            logger.debug(`[TRACKER] 🆔 WindowId: ${windowId}`);
            
            if (windowId !== this.activeWindow) {
              // Skip ThinkDrop AI (Electron)
              const isThinkDropAI = app.toLowerCase().includes('electron') || 
                                   app.toLowerCase().includes('thinkdrop') ||
                                   title.toLowerCase().includes('thinkdrop');
              
              if (isThinkDropAI) {
                logger.debug(`[TRACKER] ⏭️  Skipping ThinkDrop AI window (${app})`);
                this.activeWindow = windowId;
                return;
              }
              
              logger.debug(`[TRACKER] 🔄 Window/tab changed: ${app}${url ? ` - ${url}` : ` - ${title}`}`);
              
              // Show window change toast
              let displayText = title;
              if (url) {
                try {
                  displayText = new URL(url).hostname;
                } catch (e) {
                  displayText = url.substring(0, 50);
                }
              }
              this.showWindowChangeToast(app, displayText);
              
              this.activeWindow = windowId;
              
              // Notify main thread of active window change
              try {
                const { parentPort } = require('worker_threads');
                if (parentPort) {
                  parentPort.postMessage({
                    type: 'activeWindowUpdate',
                    windowId,
                    app,
                    title,
                    url
                  });
                  logger.debug(`📤 [TRACKER] Sent activeWindowUpdate: ${windowId}`);
                }
              } catch (error) {
                logger.warn(`⚠️  [TRACKER] Failed to send activeWindowUpdate:`, error.message);
              }
            }
          }
        } catch (error) {
          logger.error('[TRACKER] ❌ Error checking active window:', error);
        }
      };
      
      // Start polling
      this.windowListener = setInterval(checkActiveWindow, FOCUS_CHECK_INTERVAL);
      
      // Run immediately once
      checkActiveWindow();
      
      logger.debug('[TRACKER] ✅ Active window listener started (polling every 500ms)');
    } catch (error) {
      logger.error('[TRACKER] ❌ Failed to start window listener:', error);
      throw error;
    }
  }

  /**
   * Show window change toast
   */
  showWindowChangeToast(app, title) {
    const isWorker = typeof process !== 'undefined' && process.env.WORKER_THREAD === 'true';
    
    if (isWorker) {
      try {
        const { parentPort } = require('worker_threads');
        if (parentPort) {
          parentPort.postMessage({
            type: 'showWindowChangeToast',
            app,
            title
          });
          logger.debug(`📤 [TRACKER] Sent showWindowChangeToast: ${app} - ${title}`);
        }
      } catch (error) {
        logger.debug(`[TRACKER] 📢 Window changed: ${app} - ${title}`);
      }
    } else {
      try {
        const { showHotkeyToast } = require('../windows/hotkey-toast-overlay.cjs');
        const message = `<div style="text-align: center;">
          <strong>${app}</strong>${title ? `<br><span style="opacity: 0.8;">${title}</span>` : ''}
        </div>`;
        showHotkeyToast(message, { persistent: false, duration: 2000 });
        logger.debug(`🍞 [TRACKER] Showing window change toast: ${app}`);
      } catch (error) {
        logger.debug(`📢 Window changed: ${app} - ${title}`);
      }
    }
  }

  /**
   * Stop the window tracker
   */
  stop() {
    if (this.windowListener) {
      clearInterval(this.windowListener);
      this.windowListener = null;
      logger.debug('[TRACKER] 🛑 Window tracker stopped');
    }
  }
}

module.exports = WindowTracker;
