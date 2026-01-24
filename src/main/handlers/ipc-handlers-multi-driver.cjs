/**
 * Multi-Driver Automation IPC Handlers
 * 
 * Handles IPC communication for Playwright, Desktop (AX/UIA), and Vision drivers
 */

const { ipcMain } = require('electron');
const logger = require('../logger.cjs');

// Playwright will be initialized lazily
let playwright = null;
let browser = null;
let page = null;

// Desktop accessibility (platform-specific)
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

/**
 * Initialize Playwright driver
 */
async function initializePlaywright() {
  if (playwright) {
    return { success: true };
  }

  try {
    logger.info('🌐 [PLAYWRIGHT] Initializing Playwright');
    
    // Lazy load Playwright
    playwright = require('playwright');
    
    // Connect to user's existing browser via CDP
    // This allows us to control the browser they're already using
    try {
      // Try to connect to Chrome DevTools Protocol on default port
      browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
      logger.info('✅ [PLAYWRIGHT] Connected to existing browser via CDP');
      
      // Get the default context (existing browser context)
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const context = contexts[0];
        const pages = context.pages();
        
        // Use the first page or create a new one if none exist
        if (pages.length > 0) {
          page = pages[0];
          logger.info(`📄 [PLAYWRIGHT] Using existing page: ${await page.title()}`);
        } else {
          page = await context.newPage();
          logger.info('📄 [PLAYWRIGHT] Created new page in existing context');
        }
      } else {
        // Shouldn't happen with CDP, but handle it
        page = await browser.newPage();
        logger.warn('⚠️ [PLAYWRIGHT] No contexts found, created new page');
      }
    } catch (cdpError) {
      logger.warn('⚠️ [PLAYWRIGHT] Could not connect via CDP, launching headless browser:', cdpError.message);
      // Fallback: launch headless browser
      browser = await playwright.chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled']
      });
      page = await browser.newPage();
    }
    
    logger.info('✅ [PLAYWRIGHT] Initialized successfully');
    return { success: true };
  } catch (error) {
    logger.error('❌ [PLAYWRIGHT] Initialization failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize Desktop driver (Accessibility APIs)
 */
async function initializeDesktop() {
  try {
    logger.info('🖥️ [DESKTOP] Initializing Desktop driver');
    
    if (isMac) {
      // macOS Accessibility API
      // TODO: Implement using node-mac-permissions or custom native module
      logger.info('📱 [DESKTOP] macOS Accessibility API ready');
    } else if (isWindows) {
      // Windows UIAutomation
      // TODO: Implement using windows-uiautomation or ffi-napi
      logger.info('🪟 [DESKTOP] Windows UIAutomation ready');
    } else {
      logger.warn('⚠️ [DESKTOP] Platform not supported');
      return { success: false, error: 'Platform not supported' };
    }
    
    return { success: true };
  } catch (error) {
    logger.error('❌ [DESKTOP] Initialization failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Register all multi-driver IPC handlers
 */
function registerMultiDriverHandlers() {
  logger.info('🚦 [MULTI-DRIVER] Registering IPC handlers');

  // ============================================================================
  // PLAYWRIGHT HANDLERS
  // ============================================================================

  ipcMain.handle('playwright:initialize', async () => {
    return await initializePlaywright();
  });

  ipcMain.handle('playwright:cleanup', async () => {
    try {
      if (page) {
        await page.close();
        page = null;
      }
      if (browser) {
        await browser.close();
        browser = null;
      }
      playwright = null;
      logger.info('✅ [PLAYWRIGHT] Cleanup complete');
      return { success: true };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Cleanup failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:check-availability', async () => {
    return { available: playwright !== null && page !== null };
  });

  ipcMain.handle('playwright:find-element', async (event, { selector }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      logger.info('🔍 [PLAYWRIGHT] Finding element:', selector);

      let locator;
      if (selector.css) {
        locator = page.locator(selector.css);
      } else if (selector.xpath) {
        locator = page.locator(`xpath=${selector.xpath}`);
      } else if (selector.text) {
        locator = page.getByText(selector.text);
      } else if (selector.role) {
        locator = page.getByRole(selector.role);
      } else if (selector.testId) {
        locator = page.getByTestId(selector.testId);
      } else {
        return { success: false, error: 'No valid selector provided' };
      }

      // Check if element exists
      const count = await locator.count();
      if (count === 0) {
        return { success: false, error: 'Element not found' };
      }

      // Get bounding box
      const box = await locator.first().boundingBox();
      
      return {
        success: true,
        element: {
          bounds: box || { x: 0, y: 0, width: 0, height: 0 },
          metadata: { count }
        }
      };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Find element failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:find-elements', async (event, { selector }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      logger.info('🔍 [PLAYWRIGHT] Finding elements:', selector);

      let locator;
      if (selector.css) {
        locator = page.locator(selector.css);
      } else if (selector.text) {
        locator = page.getByText(selector.text);
      } else {
        return { success: false, error: 'No valid selector provided' };
      }

      const count = await locator.count();
      const elements = [];

      for (let i = 0; i < count; i++) {
        const box = await locator.nth(i).boundingBox();
        if (box) {
          elements.push({
            bounds: box,
            metadata: { index: i }
          });
        }
      }

      return { success: true, elements };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Find elements failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:click', async (event, { selector }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      logger.info('🖱️ [PLAYWRIGHT] Clicking element');

      let locator;
      if (selector.css) {
        locator = page.locator(selector.css);
      } else if (selector.text) {
        locator = page.getByText(selector.text);
      } else if (selector.role) {
        locator = page.getByRole(selector.role);
      } else {
        return { success: false, error: 'No valid selector provided' };
      }

      await locator.first().click();
      logger.info('✅ [PLAYWRIGHT] Click successful');
      
      return { success: true };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Click failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:type', async (event, { selector, text }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      logger.info('⌨️ [PLAYWRIGHT] Typing text');

      let locator;
      if (selector.css) {
        locator = page.locator(selector.css);
      } else if (selector.role) {
        locator = page.getByRole(selector.role);
      } else {
        return { success: false, error: 'No valid selector provided' };
      }

      await locator.first().fill(text);
      logger.info('✅ [PLAYWRIGHT] Type successful');
      
      return { success: true };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Type failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:get-value', async (event, { selector }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      let locator;
      if (selector.css) {
        locator = page.locator(selector.css);
      } else {
        return { success: false, error: 'No valid selector provided' };
      }

      const value = await locator.first().inputValue();
      return { success: true, value };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Get value failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:wait-for-element', async (event, { selector, timeout }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      logger.info('⏳ [PLAYWRIGHT] Waiting for element');

      let locator;
      if (selector.css) {
        locator = page.locator(selector.css);
      } else if (selector.text) {
        locator = page.getByText(selector.text);
      } else {
        return { success: false, error: 'No valid selector provided' };
      }

      await locator.first().waitFor({ timeout });
      const box = await locator.first().boundingBox();

      return {
        success: true,
        element: {
          bounds: box || { x: 0, y: 0, width: 0, height: 0 }
        }
      };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Wait for element failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:navigate', async (event, { url }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      logger.info('🌐 [PLAYWRIGHT] Navigating to:', url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      logger.info('✅ [PLAYWRIGHT] Navigation successful');
      
      return { success: true };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Navigation failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('playwright:execute-script', async (event, { script, args }) => {
    try {
      if (!page) {
        return { success: false, error: 'Playwright not initialized' };
      }

      const value = await page.evaluate(script, ...args);
      return { success: true, value };
    } catch (error) {
      logger.error('❌ [PLAYWRIGHT] Script execution failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================================
  // DESKTOP HANDLERS (Accessibility APIs)
  // ============================================================================

  ipcMain.handle('desktop:initialize', async () => {
    return await initializeDesktop();
  });

  ipcMain.handle('desktop:cleanup', async () => {
    logger.info('✅ [DESKTOP] Cleanup complete');
    return { success: true };
  });

  ipcMain.handle('desktop:check-availability', async () => {
    return { available: isMac || isWindows };
  });

  ipcMain.handle('desktop:find-element', async (event, { selector }) => {
    try {
      logger.info('🔍 [DESKTOP] Finding element:', selector);

      if (!isMac) {
        logger.warn('⚠️ [DESKTOP] Only macOS supported currently');
        return { success: false, error: 'Desktop driver only supports macOS currently' };
      }

      // Check accessibility permissions
      const macAccessibility = require('../automation/macos-accessibility.cjs');
      const hasPermissions = await macAccessibility.checkAccessibilityPermissions();
      
      if (!hasPermissions) {
        logger.error('❌ [DESKTOP] Accessibility permissions not granted');
        return { 
          success: false, 
          error: 'Accessibility permissions required. Please grant in System Preferences > Security & Privacy > Privacy > Accessibility' 
        };
      }

      let element = null;

      // Try different search strategies based on selector
      if (selector.axRole && selector.axTitle) {
        // Search by role and title (most specific)
        element = await macAccessibility.findElementByRoleAndTitle(selector.axRole, selector.axTitle);
      } else if (selector.axRole) {
        // Search by role only (get first match)
        const elements = await macAccessibility.findElementsByRole(selector.axRole);
        element = elements.length > 0 ? elements[0] : null;
      } else if (selector.axTitle) {
        // Search by title using deep search
        element = await macAccessibility.searchUIHierarchy({
          axRole: 'AX',  // Match any role
          axTitle: selector.axTitle
        });
      }

      if (!element) {
        logger.warn('⚠️ [DESKTOP] Element not found');
        return { success: false, error: 'Element not found in accessibility tree' };
      }

      logger.info('✅ [DESKTOP] Element found:', element.bounds);
      return { success: true, element };
    } catch (error) {
      logger.error('❌ [DESKTOP] Find element failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('desktop:find-elements', async (event, { selector }) => {
    try {
      logger.info('🔍 [DESKTOP] Finding multiple elements:', selector);

      if (!isMac) {
        return { success: false, error: 'Desktop driver only supports macOS currently' };
      }

      const macAccessibility = require('../automation/macos-accessibility.cjs');
      const hasPermissions = await macAccessibility.checkAccessibilityPermissions();
      
      if (!hasPermissions) {
        return { 
          success: false, 
          error: 'Accessibility permissions required' 
        };
      }

      let elements = [];

      if (selector.axRole) {
        elements = await macAccessibility.findElementsByRole(selector.axRole);
      }

      logger.info(`✅ [DESKTOP] Found ${elements.length} elements`);
      return { success: true, elements };
    } catch (error) {
      logger.error('❌ [DESKTOP] Find elements failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('desktop:get-value', async (event, { selector }) => {
    try {
      logger.info('📖 [DESKTOP] Getting element value:', selector);

      if (!isMac) {
        return { success: false, error: 'Desktop driver only supports macOS currently' };
      }

      const macAccessibility = require('../automation/macos-accessibility.cjs');
      const hasPermissions = await macAccessibility.checkAccessibilityPermissions();
      
      if (!hasPermissions) {
        return { 
          success: false, 
          error: 'Accessibility permissions required' 
        };
      }

      const value = await macAccessibility.getElementValue(
        selector.axRole || 'AXTextField',
        selector.axTitle || ''
      );

      logger.info('✅ [DESKTOP] Got value:', value);
      return { success: true, value };
    } catch (error) {
      logger.error('❌ [DESKTOP] Get value failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================================
  // TARGET DETECTION
  // ============================================================================

  ipcMain.handle('automation:detect-target', async () => {
    try {
      // Get active window info
      const windowManager = require('node-window-manager');
      const activeWindow = windowManager.getActiveWindow();

      if (!activeWindow) {
        return {
          success: true,
          target: { type: 'unknown', confidence: 0 }
        };
      }

      const title = activeWindow.getTitle();
      const processName = activeWindow.path ? activeWindow.path.split('/').pop() : '';

      // Detect if it's a browser
      const browserProcesses = ['chrome', 'firefox', 'safari', 'edge', 'brave'];
      const isBrowser = browserProcesses.some(name => 
        processName.toLowerCase().includes(name)
      );

      if (isBrowser) {
        return {
          success: true,
          target: {
            type: 'web',
            appName: processName,
            title,
            confidence: 0.9
          }
        };
      }

      // Desktop app
      return {
        success: true,
        target: {
          type: 'desktop',
          appName: processName,
          title,
          hasAccessibility: isMac || isWindows,
          confidence: 0.8
        }
      };
    } catch (error) {
      logger.error('❌ [DETECT] Target detection failed:', error);
      return {
        success: true,
        target: { type: 'unknown', confidence: 0 }
      };
    }
  });

  // ============================================================================
  // VISION HANDLERS (Reuse existing vision API)
  // ============================================================================

  ipcMain.handle('vision:find-element', async (event, { screenshot, description }) => {
    // This should call your existing Vision API
    // For now, delegate to existing automation:find-element
    logger.info('👁️ [VISION] Finding element with vision');
    
    // TODO: Call existing vision service
    return { 
      success: false, 
      error: 'Vision driver uses existing automation:find-element IPC' 
    };
  });

  ipcMain.handle('vision:find-elements', async (event, { screenshot, description }) => {
    logger.info('👁️ [VISION] Finding elements with vision');
    return { success: false, error: 'Not yet implemented' };
  });

  logger.info('✅ [MULTI-DRIVER] IPC handlers registered');
}

module.exports = {
  registerMultiDriverHandlers,
  initializePlaywright,
  initializeDesktop
};
