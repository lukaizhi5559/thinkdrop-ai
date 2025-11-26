/**
 * Virtual Screen DOM - In-memory cache for screen intelligence
 * Automatically analyzes windows on focus change and caches results for instant queries
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

// Cache configuration
const CACHE_CONFIG = {
  ACTIVE_WINDOW_TTL: 5 * 60 * 1000,      // 5 minutes for active window
  BACKGROUND_WINDOW_TTL: 2 * 60 * 1000,   // 2 minutes for background windows
  STALE_THRESHOLD: 10 * 60 * 1000,        // 10 minutes - force re-analysis
  MAX_CACHED_WINDOWS: 5,                   // Keep only 5 most recent windows
  CLEANUP_INTERVAL: 60 * 1000,             // Cleanup every minute
  FOCUS_CHECK_INTERVAL: 500                // Check window focus every 500ms
};

// ⚙️  ANALYSIS METHOD CONFIGURATION
// Set this to control which analysis method to use:
//   'auto'  - Intelligent selection based on app type (RECOMMENDED)
//   'nutjs' - Always use NutJS text capture (fast, text-selectable content only)
//   'ocr'   - Always use OCR/Tesseract (slower, works with images/PDFs)
const ANALYSIS_METHOD = process.env.SCREEN_ANALYSIS_METHOD || 'auto';

class VirtualScreenDOM {
  constructor(requestAnalysisCallback = null) {
    this.cache = new Map(); // windowId -> screenData
    this.activeWindow = null;
    this.cleanupInterval = null;
    this.windowListener = null;
    this.isAnalyzing = false;
    this.requestAnalysisCallback = requestAnalysisCallback; // Callback to request analysis from main thread
    this.debugMode = process.env.DEBUG_VIRTUAL_DOM_SCREEN === 'true'; // Debug flag for toasts
    this.analysisMethod = ANALYSIS_METHOD; // Analysis method preference
    logger.debug(`[WORKER] 🐛 Debug mode: ${this.debugMode} (env: ${process.env.DEBUG_VIRTUAL_DOM_SCREEN})`);
    logger.debug(`[WORKER] 🤖 Analysis method: ${this.analysisMethod}`);
  }

  /**
   * Get browser URL using AppleScript (macOS only)
   * @param {string} appName - Name of the browser application
   * @returns {Promise<string|null>} URL or null if not a browser or error
   */
  async getBrowserURL(appName) {
    const script = BROWSER_URL_SCRIPTS[appName];
    if (!script) {
      logger.debug(`[WORKER] ⚠️  No AppleScript for ${appName}`);
      return null; // Not a supported browser
    }
    
    // logger.debug(`[WORKER] 📜 Running AppleScript for ${appName}...`);
    // logger.debug(`[WORKER] 📜 Script: ${script}`);
    
    try {
      const { stdout, stderr } = await execAsync(`osascript -e '${script}'`);
      const url = stdout.trim();
      
      if (stderr) {
        logger.debug(`[WORKER] ⚠️  AppleScript stderr: ${stderr}`);
      }
      
      // logger.debug(`[WORKER] 📜 AppleScript stdout: "${url}"`);
      return url || null;
    } catch (error) {
      // Browser might not be running or AppleScript failed
      logger.debug(`[WORKER] ❌ AppleScript error for ${appName}:`, error.message);
      logger.debug(`[WORKER] ❌ Error code: ${error.code}`);
      return null;
    }
  }

  /**
   * Get browser tab title using AppleScript (macOS only)
   * @param {string} appName - Name of the browser application
   * @returns {Promise<string|null>} Tab title or null if not a browser or error
   */
  async getBrowserTabTitle(appName) {
    const script = BROWSER_TITLE_SCRIPTS[appName];
    if (!script) {
      logger.debug(`[WORKER] ⚠️  No tab title script for ${appName}`);
      return null; // Not a supported browser
    }
    
    // logger.debug(`[WORKER] 📜 Getting tab title for ${appName}...`);
    
    try {
      const { stdout, stderr } = await execAsync(`osascript -e '${script}'`);
      const tabTitle = stdout.trim();
      
      if (stderr) {
        logger.debug(`[WORKER] ⚠️  AppleScript stderr: ${stderr}`);
      }
      
      // logger.debug(`[WORKER] 📜 Tab title: "${tabTitle}"`);
      return tabTitle || null;
    } catch (error) {
      // Browser might not be running or AppleScript failed
      logger.debug(`[WORKER] ❌ AppleScript error for ${appName}:`, error.message);
      return null;
    }
  }

  /**
   * Start the virtual DOM system
   */
  async start() {
    logger.debug('[WORKER] 👁️  Starting Virtual Screen DOM...');
    
    // Start periodic cleanup
    this.startCleanup();
    
    // Start watching for window focus changes
    this.startFocusWatcher();
    
    logger.debug('[WORKER] ✅ Virtual Screen DOM started');
  }

  /**
   * Watch for window focus changes using node-window-manager directly
   */
  async startFocusWatcher() {
    logger.debug('[WORKER] 🔍 Starting active window listener...');
    
    try {
      // Dynamic import for ES module - get windowManager directly
      const windowManagerModule = await import('node-window-manager');
      const windowManager = windowManagerModule.windowManager || windowManagerModule.default?.windowManager;
      
      if (!windowManager) {
        throw new Error('Could not load windowManager from node-window-manager');
      }
      
      logger.debug('[WORKER] 📦 Using node-window-manager directly for better control');
      
      // Poll for active window changes every 500ms
      let lastWindowPath = null;
      let lastUrl = null; // Track URL for browsers
      
      const checkActiveWindow = async () => {
        try {
          // Force refresh window list to get current state
          windowManager.requestAccessibility();
          
          // Get the active window directly (more reliable than iterating)
          const activeWindow = windowManager.getActiveWindow();
          
          if (!activeWindow) {
            logger.debug('[WORKER] ⚠️  No active window found');
            return;
          }
          
          const currentPath = activeWindow.path || '';
          
          // Extract app name to check if it's a browser
          const appMatch = currentPath ? currentPath.match(/([^/\\]+)\.(app|exe)$/i) : null;
          const app = appMatch ? appMatch[1] : (currentPath ? currentPath.split(/[/\\]/).pop() : 'Unknown') || 'Unknown';
          
          // For browsers, also check URL changes
          let currentUrl = null;
          if (BROWSER_URL_SCRIPTS[app]) {
            currentUrl = await this.getBrowserURL(app);
          }
          
          // Process if window changed OR if URL changed (for browsers)
          const windowChanged = currentPath !== lastWindowPath;
          const urlChanged = currentUrl && currentUrl !== lastUrl;
          
          if (windowChanged || urlChanged) {
            lastWindowPath = currentPath;
            lastUrl = currentUrl;
            
            // Log only when window actually changes
            logger.debug(`[WORKER] 👁️  Active window: ${activeWindow.getTitle ? activeWindow.getTitle() : 'Unknown'}`);
            
            logger.debug('[WORKER] 🔔 Window changed detected!');
            
            // Get window details
            let title = activeWindow.getTitle ? activeWindow.getTitle() : (activeWindow.title || '');
            const path = activeWindow.path || '';
            
            // Extract app name from path
            const appMatch = path.match(/([^/\\]+)\.(app|exe)$/i);
            const app = appMatch ? appMatch[1] : path.split(/[/\\]/).pop() || 'Unknown';
            
            logger.debug(`[WORKER] 🔍 App detected: "${app}" (path: ${path})`);
            logger.debug(`[WORKER] 🔍 Is browser? ${!!BROWSER_URL_SCRIPTS[app]}`);
            
            // For browsers, get the actual tab title via AppleScript
            if (BROWSER_TITLE_SCRIPTS[app]) {
              const tabTitle = await this.getBrowserTabTitle(app);
              if (tabTitle) {
                title = tabTitle;
                logger.debug(`[WORKER] 📑 Using browser tab title: "${title}"`);
              }
            }
            
            // Use the URL we already fetched (or fetch if not a browser)
            let url = currentUrl;
            if (url) {
              logger.debug(`[WORKER] 🌐 URL: ${url}`);
            }
            
            // Create unique window ID (include URL for browsers to detect tab changes)
            const windowId = url 
              ? `${app}-${url}`.substring(0, 150) // Use URL for browsers
              : `${app}-${title}`.substring(0, 100); // Use title for other apps
            
            logger.debug(`[WORKER] 🆔 WindowId: ${windowId}`);
            logger.debug(`[WORKER] 🆔 Previous activeWindow: ${this.activeWindow}`);
            logger.debug(`[WORKER] 🆔 WindowId changed? ${windowId !== this.activeWindow}`);
            
            if (windowId !== this.activeWindow && !this.isAnalyzing) {
              // CRITICAL: Skip ThinkDrop AI (Electron) - we never want to analyze it
              const isThinkDropAI = app.toLowerCase().includes('electron') || 
                                   app.toLowerCase().includes('thinkdrop') ||
                                   title.toLowerCase().includes('thinkdrop');
              
              if (isThinkDropAI) {
                logger.debug(`[WORKER] ⏭️  Skipping ThinkDrop AI window (${app})`);
                // Still update activeWindow to track it, but don't analyze
                this.activeWindow = windowId;
                return;
              }
              
              logger.debug(`[WORKER] 🔄 Window/tab changed: ${app}${url ? ` - ${url}` : ` - ${title}`}`);
              
              // Show hotkey toast for window change (using simple toast overlay)
              // For browsers, show URL domain; for others, show title
              let displayText = title;
              if (url) {
                try {
                  displayText = new URL(url).hostname;
                } catch (e) {
                  displayText = url.substring(0, 50); // Fallback to truncated URL
                }
              }
              this.showWindowChangeToast(app, displayText);
              
              this.activeWindow = windowId;
              
              // 🆕 Notify main thread of active window change
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
                  logger.debug(`📤 [WORKER] Sent activeWindowUpdate: ${windowId}`);
                }
              } catch (error) {
                logger.warn(`⚠️  [WORKER] Failed to send activeWindowUpdate:`, error.message);
              }
              
              // DISABLED: Pre-scanning causes too many issues
              // - Race conditions (window switches before analysis completes)
              // - Stale cache (content changes within same window)
              // - Wasted resources (analyzing windows user doesn't ask about)
              // 
              // NEW APPROACH: Only analyze on-demand when user asks a question
              // The screenIntelligence node will check cache and request fresh analysis if needed
              logger.debug(`[WORKER] 📊 Window tracked, analysis will happen on-demand only`);
            }
          }
        } catch (error) {
          logger.error('[WORKER] ❌ Error checking active window:', error);
        }
      };
      
      // Start polling
      this.windowListener = setInterval(checkActiveWindow, 500);
      
      // Run immediately once
      checkActiveWindow();
      
      logger.debug('[WORKER] ✅ Active window listener started (polling every 500ms)');
    } catch (error) {
      logger.error('[WORKER] ❌ Failed to start window listener:', error);
      throw error;
    }
  }

  /**
   * Intelligently select analysis method based on content type
   * @param {string} app - Application name
   * @param {string} url - URL (for browsers)
   * @param {string} title - Window title
   * @returns {string} 'auto', 'nutjs', or 'ocr'
   */
  selectAnalysisMethod(app, url, title) {
    // 🎯 Check global configuration first
    if (this.analysisMethod !== 'auto') {
      logger.debug(`[WORKER] ⚙️  Using configured method: ${this.analysisMethod}`);
      return this.analysisMethod;
    }

    // 🤖 Auto-selection based on content type
    const appLower = app.toLowerCase();
    const urlLower = (url || '').toLowerCase();
    const titleLower = (title || '').toLowerCase();

    // Use OCR for PDFs
    if (urlLower.includes('.pdf') || titleLower.includes('.pdf')) {
      logger.debug(`[WORKER] 📄 PDF detected → OCR`);
      return 'ocr';
    }

    // Use OCR for image files
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    if (imageExtensions.some(ext => urlLower.includes(ext) || titleLower.includes(ext))) {
      logger.debug(`[WORKER] 🖼️  Image detected → OCR`);
      return 'ocr';
    }

    // Use OCR for specific apps (non-text-selectable content)
    const ocrApps = ['preview', 'acrobat', 'vlc', 'quicktime', 'photos', 'photoshop', 'figma', 'sketch', 'zoom', 'teams'];
    if (ocrApps.some(ocrApp => appLower.includes(ocrApp))) {
      logger.debug(`[WORKER] 📱 ${app} detected → OCR`);
      return 'ocr';
    }

    // Use NutJS for web browsers (text-selectable)
    const browsers = ['chrome', 'safari', 'firefox', 'edge', 'brave', 'arc', 'vivaldi'];
    if (browsers.some(browser => appLower.includes(browser))) {
      logger.debug(`[WORKER] 🌐 Browser detected → NutJS`);
      return 'nutjs';
    }

    // Use NutJS for text editors and IDEs
    const textApps = ['code', 'vscode', 'sublime', 'atom', 'notepad', 'textedit', 'terminal'];
    if (textApps.some(textApp => appLower.includes(textApp))) {
      logger.debug(`[WORKER] 📝 Text app detected → NutJS`);
      return 'nutjs';
    }

    // Default to auto (let HybridAnalyzer decide)
    logger.debug(`[WORKER] ⚡ Default → auto`);
    return 'auto';
  }

  /**
   * Get contextual message for window analysis
   * @param {string} windowId - Window identifier
   * @param {string} phase - 'start', 'success', or 'error'
   * @returns {string} Contextual message
   */
  getContextualMessage(windowId, phase) {
    // Extract app name and title from windowId (format: "AppName-title")
    const parts = windowId.split('-');
    const rawAppName = parts[0] || 'screen';
    const title = parts.slice(1).join('-') || '';
    
    // Blacklist of generic/unhelpful app names
    const blacklist = ['electron', 'node', 'python', 'java', 'helper', 'stable'];
    
    // Check if app name is blacklisted (case-insensitive)
    const isBlacklisted = blacklist.some(blocked => 
      rawAppName.toLowerCase().includes(blocked.toLowerCase())
    );
    
    // If blacklisted, try to extract meaningful name from title
    let displayName = 'screen';
    if (isBlacklisted) {
      // Try to extract app name from title (e.g., "thinkdrop-ai — llm.js" → "thinkdrop-ai")
      const titleMatch = title.match(/^([^—\-]+)/);
      if (titleMatch) {
        displayName = titleMatch[1].trim();
      }
    } else {
      displayName = rawAppName;
    }
    
    // Clean up display name (remove "Google" prefix, ".app" suffix, etc.)
    displayName = displayName
      .replace(/^Google\s+/i, '')
      .replace(/\.app$/i, '')
      .trim();
    
    // Capitalize first letter
    displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
    
    // Generate message based on phase
    if (phase === 'start') {
      return `Analyzing ${displayName}...`;
    }
    
    if (phase === 'success') {
      return `${displayName} analyzed`;
    }
    
    if (phase === 'error') {
      return `Failed to analyze ${displayName}`;
    }
    
    return 'Analyzing screen...';
  }

  /**
   * Analyze the current window and cache results
   * @param {string} windowId - Optional window ID to analyze (if not provided, gets current)
   */
  async analyzeCurrentWindow(windowId = null) {
    if (this.isAnalyzing) {
      logger.debug('⏳ Analysis already in progress, skipping...');
      return;
    }

    this.isAnalyzing = true;

    try {
      // Use provided windowId or get current if not provided
      if (!windowId) {
        windowId = await this.getCurrentWindowId();
      }
      const startTime = Date.now();

      logger.debug(`🔍 Analyzing window: ${windowId}`);
      
      // Show contextual "analyzing" message
      this.showToast(this.getContextualMessage(windowId, 'start'), 'info', 2000);

      // Get screen-intelligence service info from MCP
      const MCPConfigManager = require('./mcp/MCPConfigManager.cjs');
      const serviceInfo = MCPConfigManager.getService('screen-intelligence');

      if (!serviceInfo || !serviceInfo.apiKey) {
        throw new Error('Screen Intelligence service not configured');
      }

      // Fetch elements from MCP service
      const response = await fetch(`${serviceInfo.endpoint}/screen/describe`, {
        method: 'POST',
        headers: {
          'x-api-key': serviceInfo.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          showOverlay: false,
          includeHidden: false
        })
      });

      if (!response.ok) {
        throw new Error(`MCP service returned ${response.status}`);
      }

      const data = await response.json();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      if (data.elements && data.elements.length > 0) {
        // Cache the results
        await this.cacheAnalysis(data, windowId);
        
        const contextMessage = this.getContextualMessage(windowId, 'success');
        const message = `✓ ${contextMessage} (${data.elements.length} elements, ${duration}s)`;
        logger.debug(`✅ ${message}`);
        this.showToast(contextMessage, 'success', 1500);
        
        // 🆕 Generate Page Insight automatically after successful analysis
        this.generatePageInsight(data, windowId).catch(err => {
          logger.warn('⚠️ Failed to generate Page Insight:', err.message);
        });
      } else {
        logger.debug('⚠️  No elements found');
        this.showToast('No elements found', 'warning', 2000);
      }

    } catch (error) {
      logger.error('❌ Analysis failed:', error.message);
      const contextMessage = this.getContextualMessage(windowId || 'screen', 'error');
      this.showToast(contextMessage, 'error', 2000);
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * Show window change toast (simple hotkey-style toast)
   */
  showWindowChangeToast(app, title) {
    const isWorker = typeof process !== 'undefined' && process.env.WORKER_THREAD === 'true';
    
    if (isWorker) {
      // Worker thread - send to main thread
      try {
        const { parentPort } = require('worker_threads');
        if (parentPort) {
          parentPort.postMessage({
            type: 'showWindowChangeToast',
            app,
            title
          });
          logger.debug(`📤 [WORKER] Sent showWindowChangeToast: ${app} - ${title}`);
        }
      } catch (error) {
        logger.debug(`[WORKER] 📢 Window changed: ${app} - ${title}`);
      }
    } else {
      // Main thread - show hotkey toast directly
      try {
        const { showHotkeyToast } = require('../windows/hotkey-toast-overlay.cjs');
        const message = `<div style="text-align: center;">
          <strong>${app}</strong>${title ? `<br><span style="opacity: 0.8;">${title}</span>` : ''}
        </div>`;
        showHotkeyToast(message, { persistent: false, duration: 2000 });
        logger.debug(`🍞 [MAIN] Showing window change toast: ${app}`);
      } catch (error) {
        logger.debug(`📢 Window changed: ${app} - ${title}`);
      }
    }
  }

  /**
   * Show toast notification (for screen intelligence overlay)
   * In worker thread: sends message to main thread if debug mode enabled
   * In main thread: shows toast directly
   */
  showToast(message, type, duration) {
    // Check if we're in a worker thread
    const isWorker = typeof process !== 'undefined' && process.env.WORKER_THREAD === 'true';
    logger.debug(`[WORKER] 🐛 showToast called: isWorker=${isWorker}, debugMode=${this.debugMode}, message="${message}"`);
    
    if (isWorker) {
      // Worker thread - send to main thread if debug mode
      if (this.debugMode && this.requestAnalysisCallback) {
        // Use the same callback mechanism to send toast requests
        try {
          const { parentPort } = require('worker_threads');
          if (parentPort) {
            parentPort.postMessage({
              type: 'showToast',
              message,
              toastType: type,
              duration
            });
          }
        } catch (error) {
          logger.debug(`[WORKER] 📢 Toast (debug): ${message}`);
        }
      } else if (this.debugMode) {
        logger.debug(`[WORKER] 📢 Toast (debug): ${message}`);
      }
    } else {
      // Main thread - show toast directly
      try {
        const { showToast } = require('../windows/screen-intelligence-overlay.cjs');
        showToast(message, type, duration);
      } catch (error) {
        logger.debug(`📢 Toast: ${message}`);
      }
    }
  }

  /**
   * Periodic cleanup of stale cache entries
   */
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CACHE_CONFIG.CLEANUP_INTERVAL);
  }

  /**
   * Remove stale entries and enforce max cache size
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;

    // Remove stale entries
    for (const [windowId, data] of this.cache.entries()) {
      const age = now - data.timestamp;
      const isActive = windowId === this.activeWindow;
      const ttl = isActive ? CACHE_CONFIG.ACTIVE_WINDOW_TTL : CACHE_CONFIG.BACKGROUND_WINDOW_TTL;

      if (age > ttl) {
        this.cache.delete(windowId);
        removed++;
        logger.debug(`🗑️  Removed stale cache for ${windowId} (age: ${Math.round(age / 1000)}s)`);
      }
    }

    // Enforce max cache size (keep most recent)
    if (this.cache.size > CACHE_CONFIG.MAX_CACHED_WINDOWS) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => b[1].timestamp - a[1].timestamp);
      
      const toRemove = entries.slice(CACHE_CONFIG.MAX_CACHED_WINDOWS);
      toRemove.forEach(([windowId]) => {
        this.cache.delete(windowId);
        removed++;
      });
    }

    if (removed > 0) {
      logger.debug(`🧹 Cleanup: Removed ${removed} entries, ${this.cache.size} remaining`);
    }
  }

  /**
   * Cache screen analysis results
   */
  async cacheAnalysis(data, windowId = null) {
    if (!windowId) {
      windowId = await this.getCurrentWindowId();
    }

    const screenData = {
      windowId,
      timestamp: Date.now(),
      elements: data.elements || [],
      windowInfo: data.windowsAnalyzed?.[0] || {},
      elementCount: data.elements?.length || 0,
      visionText: data.visionText || '', // Include vision text for semantic cache
      visionData: data.visionData || null, // Include full vision data
      strategy: data.strategy || 'unknown',
      // Build region index for fast spatial queries
      regions: this.buildRegionIndex(data.elements || [])
    };

    this.cache.set(windowId, screenData);
    this.activeWindow = windowId;

    logger.debug(`✅ [WORKER] Cached ${screenData.elementCount} elements for ${windowId}`);
    
    // Note: cacheUpdate is sent by cacheAnalysisResult() to avoid duplication
    
    return screenData;
  }

  /**
   * Build region index for fast spatial queries
   */
  buildRegionIndex(elements) {
    const regions = {
      upper_left: [], upper_center: [], upper_right: [],
      middle_left: [], middle_center: [], middle_right: [],
      lower_left: [], lower_center: [], lower_right: []
    };

    // Assume screen dimensions (can be made dynamic)
    const screenWidth = 1920;
    const screenHeight = 1080;

    elements.forEach(el => {
      if (!el.bounds) return;

      const x = el.bounds.x + el.bounds.width / 2;
      const y = el.bounds.y + el.bounds.height / 2;

      const horizontal = x < screenWidth / 3 ? 'left' 
                       : x > (2 * screenWidth / 3) ? 'right' 
                       : 'center';
      const vertical = y < screenHeight / 3 ? 'upper'
                     : y > (2 * screenHeight / 3) ? 'lower'
                     : 'middle';

      const region = `${vertical}_${horizontal}`;
      if (regions[region]) {
        regions[region].push(el);
      }
    });

    return regions;
  }

  /**
   * Query cached data
   */
  queryCached(windowId = null, query = 'all') {
    const targetWindow = windowId || this.activeWindow;
    const cached = this.cache.get(targetWindow);

    if (!cached) {
      logger.debug('❌ Cache miss');
      return null;
    }

    const age = Date.now() - cached.timestamp;
    
    // Check if stale
    if (age > CACHE_CONFIG.STALE_THRESHOLD) {
      logger.debug(`⚠️  Cache stale (${Math.round(age / 1000)}s old)`);
      return null;
    }

    logger.debug(`✅ Cache hit (${Math.round(age / 1000)}s old)`);
    return cached;
  }

  /**
   * Get current window ID
   */
  async getCurrentWindowId() {
    try {
      const { stdout: app } = await execAsync(`
        osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'
      `);
      
      const appName = app.trim();
      
      // Try to get window title - different approach for different apps
      let title = 'main'; // Default stable title instead of timestamp
      
      try {
        if (appName === 'Google Chrome' || appName === 'Chromium') {
          // For Chrome, get URL from active tab
          const { stdout: url } = await execAsync(`
            osascript -e 'tell application "Google Chrome" to get URL of active tab of front window'
          `);
          title = url.trim();
        } else if (appName === 'Safari') {
          const { stdout: url } = await execAsync(`
            osascript -e 'tell application "Safari" to get URL of current tab of front window'
          `);
          title = url.trim();
        } else if (appName.includes('Code') || appName === 'Windsurf' || appName === 'Cursor') {
          // For code editors (VS Code, Windsurf, Cursor), always use 'main'
          // Window titles change frequently (file names) and aren't useful for caching
          // Plus they're often unavailable during fullscreen transitions
          title = 'main';
        } else {
          // For other apps, try to get window title
          const { stdout: windowTitle } = await execAsync(`
            osascript -e 'tell application "System Events" to get title of front window of first application process whose frontmost is true'
          `);
          title = windowTitle.trim() || 'main';
        }
      } catch (titleError) {
        // If we can't get title/URL, use stable 'main' identifier
        // This prevents creating new IDs every 500ms
        title = 'main';
      }

      return `${appName}-${title}`;
    } catch (error) {
      return `unknown-main`;
    }
  }

  /**
   * Get cache stats
   */
  getStats() {
    const stats = {
      totalCached: this.cache.size,
      activeWindow: this.activeWindow,
      isAnalyzing: this.isAnalyzing,
      entries: []
    };

    for (const [windowId, data] of this.cache.entries()) {
      const age = Math.round((Date.now() - data.timestamp) / 1000);
      stats.entries.push({
        windowId,
        elementCount: data.elementCount,
        ageSeconds: age,
        isActive: windowId === this.activeWindow
      });
    }

    return stats;
  }

  /**
   * Generate Page Insight from screen analysis data
   * @param {Object} data - Screen analysis data
   * @param {string} windowId - Window identifier
   */
  async generatePageInsight(data, windowId) {
    try {
      // Extract OCR text from elements
      const fullTextElement = data.elements?.find(el => el.role === 'full_text_content');
      const ocrText = fullTextElement?.value || '';
      
      if (!ocrText || ocrText.length < 50) {
        logger.debug('⏭️ [VIRTUAL_DOM] Skipping Page Insight - insufficient OCR text');
        return;
      }
      
      logger.debug('💡 [VIRTUAL_DOM] Generating Page Insight...');
      
      // Get MCP client and insight handlers
      const MCPClient = require('./mcp/MCPClient.cjs');
      const MCPConfigManager = require('./mcp/MCPConfigManager.cjs');
      const mcpClient = new MCPClient(MCPConfigManager);
      const { sendInsightLoading, sendInsightUpdate, sendInsightError } = require('../handlers/ipc-handlers-insight.cjs');
      const insightNode = require('./mcp/nodes/insight.cjs');
      
      // Send loading state
      sendInsightLoading(true);
      
      // Extract window title
      const windowTitle = data.windowsAnalyzed?.[0]?.title || windowId || 'Current Page';
      
      // Generate insight
      const state = await insightNode({
        mcpClient,
        ocrText,
        windowTitle,
        insightType: 'page',
        message: windowTitle
      });
      
      if (state.insights) {
        logger.debug(`✅ [VIRTUAL_DOM] Page Insight generated: ${state.insights.links.length} links`);
        sendInsightUpdate(state.insights);
      } else {
        sendInsightError('No insights generated');
      }
    } catch (error) {
      logger.error('❌ [VIRTUAL_DOM] Page Insight generation failed:', error);
      const { sendInsightError } = require('../handlers/ipc-handlers-insight.cjs');
      sendInsightError(error.message);
    }
  }

  /**
   * Normalize plain text for LLM consumption
   * Converts to pipe-separated format for better queryability
   * @param {string} text - Raw plain text
   * @returns {string} Pipe-separated text optimized for LLM queries
   */
  normalizePlainText(text) {
    if (!text) return '';
    
    // Split into lines and clean each
    const lines = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      // Remove common UI noise patterns
      .filter(line => !line.match(/^\[\d+\]\s*$/)) // Remove standalone [0] markers
      .map(line => {
        // Clean up [0] prefixes but keep the text
        return line.replace(/^\[\d+\]\s*/, '');
      })
      .filter(line => line.length > 0);
    
    // Simple pipe-separated format: join all lines with pipes
    // This makes it easy for LLM to parse and query
    return lines.join(' | ');
  }

  /**
   * Cache analysis result from main thread
   * @param {Object} analysisData - Screen analysis data from MCP service
   */
  cacheAnalysisResult(analysisData) {
    if (!analysisData || !analysisData.windowId) {
      logger.warn('[WORKER] ⚠️  Cannot cache analysis: missing windowId');
      return;
    }
    
    // Extract and normalize plainText.content for LLM
    let plainTextClean = '';
    if (analysisData.plainText?.content) {
      plainTextClean = this.normalizePlainText(analysisData.plainText.content);
      logger.debug(`[WORKER] 🧹 Normalized plain text: ${plainTextClean.length} chars (from ${analysisData.plainText.content.length})`);
    }
    
    // Extract app name and title for easy LLM access
    const windowInfo = analysisData.windowInfo || {};
    const appName = windowInfo.app || 'Unknown';
    const windowTitle = windowInfo.title || windowInfo.url || '';
    const isBrowser = !!(windowInfo.url);
    
    const cacheEntry = {
      ...analysisData,
      plainTextClean, // Add normalized text for LLM
      // Add explicit app and title fields for LLM context
      appName,
      windowTitle,
      isBrowser,
      activeWindowContext: {
        app: appName,
        title: windowTitle,
        url: windowInfo.url || null,
        isBrowser,
        displayName: isBrowser 
          ? `${appName}: ${windowTitle}` 
          : appName
      },
      timestamp: Date.now()
    };
    
    this.cache.set(analysisData.windowId, cacheEntry);
    logger.debug(`[WORKER] ✅ Cached analysis for ${analysisData.windowId}`);
    logger.debug(`[WORKER] 🪟 Active window context: ${cacheEntry.activeWindowContext.displayName}`);
    
    // 🆕 Send cache update to main thread for semantic cache
    try {
      const { parentPort } = require('worker_threads');
      if (parentPort) {
        parentPort.postMessage({
          type: 'cacheUpdate',
          windowId: analysisData.windowId,
          data: cacheEntry,
          timestamp: cacheEntry.timestamp
        });
        logger.debug(`📤 [WORKER] Sent cacheUpdate to main thread for ${analysisData.windowId}`);
      }
    } catch (error) {
      logger.warn(`⚠️  [WORKER] Failed to send cacheUpdate:`, error.message);
    }
    
    // Enforce max cache size
    if (this.cache.size > CACHE_CONFIG.MAX_CACHED_WINDOWS) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      logger.debug(`[WORKER] 🗑️  Removed oldest cache entry: ${oldestKey}`);
    }
  }

  /**
   * Stop the virtual DOM system
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.windowListener) {
      // Clear the polling interval
      clearInterval(this.windowListener);
    }
    this.cache.clear();
    logger.debug('[WORKER] 🛑 Virtual Screen DOM stopped');
  }
}

module.exports = VirtualScreenDOM;
