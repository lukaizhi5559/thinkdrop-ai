// Entry point for Thinkdrop AI Electron overlay app
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Load environment variables FIRST before any other setup
require('dotenv').config(); // Load .env variables

// Force WASM-only execution for all transformers to prevent ONNX runtime issues
process.env.ONNXJS_LOG_LEVEL = 'error';
process.env.TRANSFORMERS_CACHE = path.join(__dirname, '../../models');
process.env.HF_HUB_DISABLE_TELEMETRY = '1';
// Disable ONNX runtime entirely
process.env.ONNXRUNTIME_DISABLE = '1';

// Handle EPIPE errors gracefully to prevent process crashes
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors - they happen when output pipe is broken
    return;
  }
  console.error('stdout error:', err);
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors - they happen when output pipe is broken
    return;
  }
  console.error('stderr error:', err);
});

// Handle uncaught exceptions that might be related to logging
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors
    return;
  }
  console.error('Uncaught Exception:', err);
  // Don't exit the process for EPIPE errors
  if (err.code !== 'EPIPE') {
    process.exit(1);
  }
});

// Handle unhandled promise rejections (e.g., from database corruption)
process.on('unhandledRejection', (reason, promise) => {
  // Check if it's a database corruption error
  if (reason && reason.message && reason.message.includes('Corrupt database')) {
    console.warn('⚠️  Unhandled database corruption error (non-fatal):', reason.message);
    // Don't crash - database errors are logged but shouldn't kill the app
    return;
  }
  console.error('Unhandled Promise Rejection:', reason);
  // Log but don't crash for promise rejections
});

// Import modularized IPC handlers
const { initializeIPCHandlers } = require('./handlers/ipc-handlers.cjs');
// DEPRECATED - Only used in non-MCP mode (commented out to prevent import errors from deleted files)
// const { setupMemoryHandlers } = require('./handlers/ipc-handlers-memory.cjs');
// const { initializeHandlers: initializeHandlersPart3 } = require('./handlers/ipc-handlers-screenshot.cjs');
// const { setupOrchestrationWorkflowHandlers } = require('./handlers/ipc-handlers-orchestration.cjs');
// const { initializeLocalLLMHandlers } = require('./handlers/ipc-handlers-local-llm.cjs');
const { setupConversationHandlers } = require('./handlers/ipc-handlers-conversation.cjs');
const { setupDatabaseNotificationHandlers } = require('./handlers/ipc-handlers-database-notifications.cjs');
const { registerMCPHandlers } = require('./handlers/ipc-handlers-mcp.cjs');
const { registerPrivateModeHandlers } = require('./handlers/ipc-handlers-private-mode.cjs');
const { setupMCPMemoryHandlers } = require('./handlers/ipc-handlers-mcp-memory.cjs');
const { setupGeminiOAuthHandlers } = require('./handlers/ipc-handlers-gemini-oauth.cjs');
const { setupVisionOAuthHandlers } = require('./handlers/ipc-handlers-vision-oauth.cjs');
const { registerScreenIntelligenceHandlers } = require('./handlers/ipc-handlers-screen-intelligence.cjs');
const { registerInsightHandlers } = require('./handlers/ipc-handlers-insight.cjs');
const { setupInsightHistoryHandlers } = require('./handlers/ipc-handlers-insight-history.cjs');

// CoreAgent (AgentOrchestrator) will be imported dynamically due to ES module

let overlayWindow = null;
// Unified window approach - removed separate window variables
// let chatWindow = null;
// let chatMessagesWindow = null;
// let insightWindow = null;
// let memoryDebuggerWindow = null;
let isGloballyVisible = true;
let isOverlayVisible = true;
// Window visibility states now managed by React state in unified interface
let isOrchestrationActive = false; // Prevent window hiding during orchestration
let visibleWindows = [];

// CoreAgent instance for dynamic agent management
let coreAgent = null; // AgentOrchestrator instance
let localLLMAgent = null; // Local LLM agent instance
let conversationAgent = null; // ConversationSessionAgent instance (MCP mode)

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Create a unified window that can expand to show different content
  // Smaller width positioned to upper-right corner as requested
  const windowWidth = Math.min(450, width * 0.3); // 30% of screen width, max 400px (half the previous size)
  const windowHeight = Math.min(500, height * 0.7); // 70% of screen height, max 600px
  const x = width - windowWidth - 20; // Position to upper-right corner with 20px margin
  const y = 20; // Position near top with 20px margin

  overlayWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 350, // Minimum width for usability
    minHeight: 350, // Minimum height for usability
    maxWidth: 1200, // Maximum width
    maxHeight: 900, // Maximum height
    x: x,
    y: y,
    frame: false, // Remove window frame completely
    transparent: true, // Transparent background
    alwaysOnTop: true, // Always stay on top
    skipTaskbar: true, // Don't show in taskbar
    resizable: true, // Allow resizing for better UX
    movable: true, // Allow dragging
    minimizable: false,
    maximizable: false,
    closable: false, // Prevent close button
    focusable: true,
    hasShadow: true, // Add shadow for better visibility
    // CRITICAL: Prevent fullscreen exit when clicking this window
    fullscreenable: false, // This window cannot go fullscreen
    // CRITICAL: Use panel type which has proper collection behavior for overlays
    type: 'panel', // Panel windows can appear over fullscreen apps
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      backgroundThrottling: false // Keep overlay responsive
    }
  });

  // Explicitly disable shadow using setShadow
  overlayWindow.setHasShadow(false);
  
  // Make overlay window globally accessible for automation
  global.overlayWindow = overlayWindow;

  // CRITICAL: Configure panel window to appear over fullscreen apps
  // Panel windows (NSPanel) automatically have the right collection behavior on macOS
  if (process.platform === 'darwin') {
    overlayWindow.setWindowButtonVisibility(false);
  }
  
  // Set window level - 'floating' is sufficient for panel windows
  // Panel type + floating level + visibleOnFullScreen = appears over fullscreen apps
  overlayWindow.setAlwaysOnTop(true, 'floating', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  overlayWindow.loadURL(
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:5173/src/renderer/index.html'
      : `file://${path.join(__dirname, '../../dist-renderer/index.html')}`
  );

  // Make overlay click-through when not in focus (like Cluely)
  overlayWindow.setIgnoreMouseEvents(false);
  
  // Show overlay window when ready
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();
    isOverlayVisible = true;
    isGloballyVisible = true;
    console.log('✅ Main overlay window shown (index.html loaded)');
  });
  
  // Handle load errors
  overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('❌ [MAIN WINDOW] Failed to load:', errorDescription, 'URL:', validatedURL);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('✅ [MAIN WINDOW] index.html loaded successfully');
  });
  
  // Hide window instead of closing
  overlayWindow.on('close', (event) => {
    if (overlayWindow && !app.isQuiting) {
      event.preventDefault();
      overlayWindow.hide();
      isOverlayVisible = false;
    }
  });

  // Development: Open DevTools
  if (process.env.NODE_ENV === 'development') {
    overlayWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// REMOVED: createChatMessagesWindow - now handled within unified overlayWindow
// Chat messages functionality is now integrated into the main overlay interface

// REMOVED: createMemoryDebuggerWindow - now handled within unified overlayWindow
// Memory debugger functionality is now integrated into the main overlay interface

// REMOVED: createInsightWindow - now handled within unified overlayWindow
// Insight functionality is now integrated into the main overlay interface

function toggleOverlay() {
  if (!overlayWindow) return;
  
  if (isGloballyVisible) {
    // Hide the unified overlay window
    overlayWindow.hide();
    isOverlayVisible = false;
    isChatVisible = false;
    isInsightVisible = false;
    isGloballyVisible = false;
  } else {
    // Show the unified overlay window
    overlayWindow.show();
    overlayWindow.focus();
    isOverlayVisible = true;
    isGloballyVisible = true;
  }
}

app.whenReady().then(async () => {
  console.log('🚀 App ready - starting initialization sequence...');
  
    // Step 1: Initialize core services FIRST
    console.log('🔧 Step 1: Initializing core services...');
    //await initializeServices();
    console.log('✅ Step 1: Core services initialized');
    
    // Step 2: Setup IPC handlers AFTER services are ready
    console.log('🔧 Step 2: Setting up IPC handlers...');

    createOverlayWindow();
    // console.log('✅ Step 3: Overlay window created');
    
    // Create combined overlay (AI viewing indicator + hotkey toast)
    console.log('👁️  Creating combined overlay...');
    const { createAIViewingOverlay, hideAIViewingOverlay } = require('./windows/ai-viewing-overlay.cjs');
    createAIViewingOverlay();
    console.log('✅ Combined overlay created');
    
  // Initialize core services including LocalLLMAgent
  let handlersSetup = false;
  initializeServices().then(() => {
    // Verify CoreAgent is properly initialized before setting up IPC handlers
    if (!coreAgent || !coreAgent.initialized) {
      // Add a small delay to ensure CoreAgent is ready
      return new Promise(resolve => setTimeout(() => {
        resolve();
      }, 1000));
    } else {
      return Promise.resolve();
    }
  }).then(async () => {
    // Setup IPC handlers after CoreAgent is initialized (only once)
    if (!handlersSetup) {
      handlersSetup = true;
      await setupIPCHandlers();
    }
  }).catch(async error => {
    console.error('❌ Error during initialization sequence:', error);
    // Setup IPC handlers anyway to allow basic functionality (only once)
    if (!handlersSetup) {
      handlersSetup = true;
      await setupIPCHandlers();
    }
  });
  
  console.log('🎉 Initialization sequence complete!');
  
  // Initialize Window Tracker in Worker Thread (lightweight window change detection)
  console.log('🔧 Initializing Window Tracker in worker thread...');
  try {
    const { Worker } = require('worker_threads');
    const path = require('path');
    
    global.windowTracker = new Worker(
      path.join(__dirname, 'workers/window-tracker-worker.cjs')
    );
    
    global.windowTrackerReady = false;
    global.activeWindowId = null; // Track current active window
    
    global.windowTracker.on('message', async (msg) => {
      if (msg.type === 'ready') {
        global.windowTrackerReady = true;
        console.log('✅ Window Tracker worker ready');
      } else if (msg.type === 'showWindowChangeToast') {
        // Worker requesting window change toast
        try {
          const { showHotkeyToast } = require('./windows/ai-viewing-overlay.cjs');
          const message = `<div style="text-align: center;">
            <strong>${msg.app}</strong>${msg.title ? `<br><span style="opacity: 0.8;">${msg.title}</span>` : ''}
          </div>`;
          showHotkeyToast(message, { persistent: true, duration: 2000 });
          console.log(`🍞 [MAIN] Window change toast shown: ${msg.app}`);
        } catch (error) {
          console.error('❌ [MAIN] Failed to show window change toast:', error);
        }
      } else if (msg.type === 'activeWindowUpdate') {
        // Worker notifying of active window change
        const previousWindowId = global.activeWindowId;
        global.activeWindowId = msg.windowId;
        console.log(`🎯 [MAIN] Active window updated: ${msg.windowId}`);
        console.log(`   Previous: ${previousWindowId || 'none'}`);
        
        // 👁️  Send active window update to overlay for AI viewing indicator
        try {
          const { sendActiveWindowUpdate } = require('./windows/ai-viewing-overlay.cjs');
          
          // Title is already cleaned by virtualScreenDOM (uses AppleScript for browsers)
          sendActiveWindowUpdate({
            windowName: msg.title || msg.app,
            app: msg.app,
            url: msg.url,
            windowId: msg.windowId
          });
        } catch (error) {
          console.warn('⚠️  [MAIN] Failed to send active-window-update:', error.message);
        }
      } else if (msg.type === 'error') {
        console.error('❌ [MAIN] Window Tracker error:', msg.error);
      } else {
        console.warn('⚠️  [MAIN] Unknown message type from window tracker:', msg.type);
      }
    });
    
    global.windowTracker.on('error', (error) => {
      console.error('❌ Window Tracker thread error:', error);
      global.windowTrackerReady = false;
    });
    
    global.windowTracker.on('exit', (code) => {
      console.log(`⚠️  Window Tracker exited with code ${code}`);
      global.windowTrackerReady = false;
    });
    
    // Initialize the worker
    global.windowTracker.postMessage({ type: 'init' });
    
    console.log('✅ Window Tracker worker thread started');
  } catch (error) {
    console.error('❌ Failed to start Window Tracker worker:', error);
    console.log('⚠️  Continuing without window tracking');
  }
  
  // Initialize Selection Detector for context-aware queries
  console.log('📋 Initializing Selection Detector...');
  const { getSelectionDetector } = require('./services/selection-detector.cjs');
  global.selectionDetector = getSelectionDetector();
  global.selectionDetector.start();
  console.log('✅ Selection Detector initialized');
  
  // Show hotkey hint once on startup (user can dismiss it)
  setTimeout(() => {
    if (global.selectionDetector) {
      console.log('🔔 Showing hotkey hint toast...');
      global.selectionDetector.showHotkeyHintOnce();
    }
  }, 3000); // Show after 3 seconds to ensure overlay is ready
  
  // Initialize Selection Overlay for floating ThinkDrop button
  console.log('💧 Initializing Selection Overlay...');
  const { createSelectionOverlay } = require('./windows/selection-overlay.cjs');
  createSelectionOverlay();
  console.log('✅ Selection Overlay initialized');
  
  // Initialize FAB Window (Floating Action Button)
  // console.log('🎯 Initializing FAB Window...');
  // const { createFABWindow, updateFABState } = require('./windows/fab-window.cjs');
  // createFABWindow();
  // global.updateFABState = updateFABState; // Make it globally accessible
  // console.log('✅ FAB Window initialized');
  
  // Initialize Guide Window (Interactive Guides)
  console.log('🎯 Initializing Guide Window...');
  const { createGuideWindow, showGuideWindow, hideGuideWindow } = require('./windows/guide-window.cjs');
  createGuideWindow();
  global.showGuideWindow = showGuideWindow; // Make it globally accessible
  global.hideGuideWindow = hideGuideWindow;
  console.log('✅ Guide Window initialized');
  
  // Register global shortcut to show/hide overlay (like Cluely's Cmd+Shift+Space)
  // DISABLED: Overlay temporarily disabled in favor of "Prompted Anywhere" feature
  // To re-enable: set ENABLE_OVERLAY=true in environment or uncomment below
  const ENABLE_OVERLAY = process.env.ENABLE_OVERLAY === 'true';
  if (ENABLE_OVERLAY) {
    globalShortcut.register('Cmd+Shift+Space', () => {
      toggleOverlay();
      hideAIViewingOverlay();
    });
    console.log('✅ Overlay shortcut (Cmd+Shift+Space) registered');
  } else {
    console.log('⏭️  Overlay shortcut disabled (use ENABLE_OVERLAY=true to re-enable)');
  }
  
  // 🎯 Cmd+Option+A to capture selection and show "Ask" interface
  globalShortcut.register('Cmd+Option+A', async () => {
    console.log('🎯 [ASK] Cmd+Option+A triggered - capturing selection');
    
    // Capture selection from active window using nut.js
    if (global.selectionDetector) {
      await global.selectionDetector.captureSelectionWithNutJS();
      
      // Show Thinkdrop AI window
      if (overlayWindow) {
        overlayWindow.show();
        overlayWindow.focus();
      }
    }
  });
  
  // 🧪 Cmd+Option+T to test floating button (for debugging)
  globalShortcut.register('Cmd+Option+T', async () => {
    console.log('🧪 [TEST] Cmd+Option+T triggered - testing floating button');
    
    if (global.selectionDetector) {
      const testText = "This is a test selection for the floating ThinkDrop button!";
      await global.selectionDetector.showFloatingButtonWithEstimatedPosition(testText);
    }
  });
  
  // 🚀 Shift+Cmd+L for "Prompted Anywhere" - AI assistance in any app
  globalShortcut.register('Shift+Cmd+L', async () => {
    console.log('🚀 [Prompted Anywhere] Shift+Cmd+L triggered!');
    
    if (global.promptedAnywhereService) {
      await global.promptedAnywhereService.handlePromptAnywhere();
    } else {
      console.error('❌ [Prompted Anywhere] Service not initialized');
    }
  });
  
  // Screen Intelligence shortcuts
  globalShortcut.register('Cmd+Option+I', async () => {
    console.log('🔍 Screen Intelligence: Discovery Mode triggered');
    const { createScreenIntelligenceOverlay, showDiscoveryMode, showToast } = require('./windows/screen-intelligence-overlay.cjs');
    
    try {
      // Initialize overlay if needed (creates window on first call)
      createScreenIntelligenceOverlay();
      
      
      // 1️⃣ Check cache first
      const virtualDOM = global.virtualScreenDOM;
      const cached = virtualDOM?.queryCached(null, 'all');
      
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        // Cache hit - instant response
        const age = Math.round((Date.now() - cached.timestamp) / 1000);
        showToast(`Using cached data (${age}s old)`, 'info', 2000);
        showDiscoveryMode(cached.elements);
        showToast(`Found ${cached.elementCount} elements`, 'success', 2000);
        return;
      }
      
      // 2️⃣ Cache miss - no duplicate toast needed (already shown above)
      showToast('Analyzing screen...', 'info', 4000);
      
      // Get screen-intelligence service info from MCP
      const MCPConfigManager = require('./services/mcp/MCPConfigManager.cjs');
      const serviceInfo = MCPConfigManager.getService('screen-intelligence');
      
      if (!serviceInfo || !serviceInfo.apiKey) {
        throw new Error('Screen Intelligence service not configured');
      }
      
      // Fetch elements from MCP service
      const startTime = Date.now();
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
        // 3️⃣ Cache the results
        if (virtualDOM) {
          await virtualDOM.cacheAnalysis(data);
          console.log('✅ Cached screen analysis');
        }
        
        // Show discovery mode with all elements
        showDiscoveryMode(data.elements);
        showToast(`Analysis complete! Found ${data.elements.length} elements (${duration}s)`, 'success', 3000);
      } else {
        showToast('No elements found', 'warning', 2000);
      }
      
    } catch (error) {
      console.error('Screen Intelligence error:', error);
      showToast(`Error: ${error.message}`, 'error', 3000);
    }
  });
  
  // Clear screen intelligence overlays
  globalShortcut.register('Cmd+Option+C', () => {
    console.log('🧹 Screen Intelligence: Clearing overlays');
    const { clearOverlays, hideOverlay } = require('./windows/screen-intelligence-overlay.cjs');
    clearOverlays();
    hideOverlay();
  });
  
  // Register global shortcut to quit app
  // globalShortcut.register('CommandOrControl+Q', () => {
  //   app.isQuiting = true;
  //   app.quit();
  // });
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow();
    } else if (overlayWindow) {
      overlayWindow.show();
      isOverlayVisible = true;
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// Initialize new services architecture only

async function initializeServices() {
  // 🔒 MCP PRIVATE MODE: Skip heavy initialization if using MCP services
  const USE_MCP_PRIVATE_MODE = process.env.USE_MCP_PRIVATE_MODE === 'true';
  
  if (USE_MCP_PRIVATE_MODE) {
    console.log('🔒 [MCP-MODE] Private mode enabled - skipping local agent initialization');
    console.log('🔒 [MCP-MODE] Using MCP services for all AI operations');
    
    // Only initialize minimal database for conversation persistence
    try {
      const path = require('path');
      const fs = require('fs');
      const projectRoot = path.dirname(path.dirname(__dirname));
      const dataDir = path.join(projectRoot, 'data');
      const dbPath = path.join(dataDir, 'agent_memory.duckdb');
      
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      // Set quiet mode for DatabaseManager in MCP mode
      process.env.DB_QUIET_MODE = 'true';
      
      const { default: databaseManager } = await import('./services/utils/DatabaseManager.js');
      await databaseManager.initialize(dbPath);
      global.databaseManager = databaseManager;
      
      // In MCP mode, conversation persistence is handled by the MCP conversation service
      // No need to bootstrap ConversationSessionAgent here
      console.log('✅ [MCP-MODE] Database initialized for MCP services only');
      
      // Create minimal coreAgent stub (no conversation agent)
      global.coreAgent = {
        context: { database: databaseManager },
        executeAgent: async (agentName, params) => {
          throw new Error(`Agent ${agentName} not available in MCP mode - use MCP services instead`);
        }
      };
      
      console.log('✅ [MCP-MODE] Minimal stub ready - all operations via MCP services');
      
      // Register stub handlers EARLY to prevent frontend errors during initialization
      const { ipcMain } = require('electron');
      
      ipcMain.handle('agent-execute', async (event, params) => {
        return { success: false, error: 'agent-execute not available in MCP mode' };
      });
      
      ipcMain.handle('llm-get-health', async () => {
        return { success: true, mode: 'mcp', services: {} };
      });
      
      ipcMain.handle('llm-get-cached-agents', async () => {
        return { success: true, agents: [] };
      });
      
      ipcMain.handle('llm-get-communications', async () => {
        return { success: true, communications: [] };
      });
      
      console.log('✅ [MCP-MODE] Early stub handlers registered');
      
    } catch (error) {
      console.error('❌ [MCP-MODE] Database initialization failed:', error);
    }
    
    return; // Skip all agent bootstrapping
  }
  
  try {
    // Initialize CoreAgent (AgentOrchestrator) for dynamic agent management
    try {
      console.log('🔄 Step 1: Importing AgentOrchestrator...');
      // Dynamic import for ES module compatibility
      const { AgentOrchestrator } = await import('./services/agents/AgentOrchestrator.js');
      console.log('✅ Step 1: AgentOrchestrator imported successfully');
      
      console.log('🔄 Step 2: Setting up database paths...');
      // Initialize DuckDB for agent memory storage using DatabaseManager
      const path = require('path');
      const fs = require('fs');
      const projectRoot = path.dirname(path.dirname(__dirname)); // Go up from src/main to project root
      const dataDir = path.join(projectRoot, 'data');
      const dbPath = path.join(dataDir, 'agent_memory.duckdb');
      
      // Ensure data directory exists
      if (!fs.existsSync(dataDir)) {
        console.log(`📁 Creating data directory: ${dataDir}`);
        fs.mkdirSync(dataDir, { recursive: true });
      }
      console.log('✅ Step 2: Database paths configured');
      
      console.log('🔄 Step 3: Importing and initializing DatabaseManager...');
      // Import and initialize DatabaseManager
      const { default: databaseManager } = await import('./services/utils/DatabaseManager.js');
      await databaseManager.initialize(dbPath);
      console.log('✅ Step 3: DatabaseManager initialized successfully');
      
      console.log('🔄 Step 4: Creating AgentOrchestrator instance...');
      coreAgent = new AgentOrchestrator();
      console.log('✅ Step 4: AgentOrchestrator instance created');
      
      console.log('🔄 Step 5: Initializing CoreAgent...');
      // Initialize the CoreAgent
      const initResult = await coreAgent.initialize({
        llmClient: null, // Will be set when needed
        database: databaseManager, // Pass the DatabaseManager instance
        apiConfig: {
          baseURL: process.env.BIBSCRIP_BASE_URL || 'http://localhost:3001',
          apiKey: process.env.BIBSCRIP_API_KEY
        }
      });
      
      // Make CoreAgent available globally for IPC handlers AFTER initialization
      global.coreAgent = coreAgent;
      console.log('✅ Step 5: CoreAgent initialized successfully:', initResult);

      // Initialize performance optimizations
      console.log('🔄 Step 6: Initializing performance optimizations...');
      const { optimizationManager } = require('./services/cache/OptimizationManager.cjs');
      await optimizationManager.initialize();
      console.log('✅ Step 6: Performance optimizations ready');

      // Start the embedding daemon for automatic background embedding generation
      try {
        console.log('🤖 Starting embedding daemon for semantic search...');
        
        // Bootstrap SemanticEmbeddingAgent first
        await coreAgent.ask({
          agent: 'SemanticEmbeddingAgent',
          action: 'bootstrap'
        });
        
        // Bootstrap ConversationSessionAgent to create conversation database tables
        console.log('🗣️ Bootstrapping ConversationSessionAgent...');
        await coreAgent.ask({
          agent: 'ConversationSessionAgent',
          action: 'bootstrap'
        });
        
        // Bootstrap WebSearchAgent for hybrid query support
        console.log('🔍 Bootstrapping WebSearchAgent...');
        await coreAgent.ask({
          agent: 'WebSearchAgent',
          action: 'bootstrap'
        });
        
        // Start the embedding daemon with default 10-minute intervals
        const daemonResult = await coreAgent.ask({
          agent: 'EmbeddingDaemonAgent',
          action: 'start-daemon'
        });
        
        if (daemonResult.success) {
          console.log('✅ Embedding daemon started successfully:', daemonResult.message);
        } else {
          console.warn('⚠️ Embedding daemon failed to start:', daemonResult.error);
        }
        
      } catch (daemonError) {
        console.error('❌ Failed to start embedding daemon:', daemonError);
        // Continue without daemon - app should still work
      }

    } catch (error) {
      console.error('❌ Failed to initialize CoreAgent:', error);
      console.error('❌ CoreAgent error stack:', error.stack);
      console.error('❌ CoreAgent error details:', {
        message: error.message,
        name: error.name,
        code: error.code
      });
      // Set coreAgent to null to ensure handlers know it's not available
      coreAgent = null;
    }
    
    // Legacy event listeners removed - functionality will be re-implemented using new agent architecture as needed
    
  } catch (error) {
    console.error('❌ Service initialization error:', error);
    // Continue without services for demo mode
  }
}

// Setup IPC handlers using modularized files
async function setupIPCHandlers() {
  console.log('🔧 Setting up IPC handlers...');
  
  const USE_MCP_PRIVATE_MODE = process.env.USE_MCP_PRIVATE_MODE === 'true';
  
  // Unified window state - UI state now managed by React components
  const windowState = {
    isGloballyVisible,
    isOverlayVisible,
    isOrchestrationActive,
    visibleWindows
  };

  // Simplified window creators for unified approach
  const windowCreators = {
    toggleOverlay
    // Removed separate window creators - now handled by React state
  };
  
  // Unified windows object - only overlayWindow needed
  const windows = {
    overlayWindow
    // Removed separate window references
  };
  
  try {
    // Remove early stub handlers before initializing full handlers
    if (USE_MCP_PRIVATE_MODE) {
      ipcMain.removeHandler('agent-execute');
      ipcMain.removeHandler('llm-get-health');
      ipcMain.removeHandler('llm-get-cached-agents');
      ipcMain.removeHandler('llm-get-communications');
    }
    
    // Initialize all IPC handlers from modularized files
    const { broadcastOrchestrationUpdate: broadcastUpdate, sendClarificationRequest: sendClarification } = 
      initializeIPCHandlers({
        overlayWindow,
        coreAgent,
        localLLMAgent,
        windowState,
        windowCreators
      });
    console.log('✅ Main IPC handlers setup complete');
    
    if (!USE_MCP_PRIVATE_MODE) {
      // DEPRECATED - Setup memory handlers (skip in MCP mode - use MCP user-memory service)
      console.log('⏭️  [DEPRECATED] Skipping memory handlers - removed in Phase 1 cleanup');
      // setupMemoryHandlers(ipcMain, coreAgent);
    } else {
      console.log('⏭️  [MCP-MODE] Skipping memory handlers - using MCP user-memory service');
    }
    
    // DEPRECATED - Initialize screenshot, system health, and legacy LLM handlers
    if (!USE_MCP_PRIVATE_MODE) {
      console.log('⏭️  [DEPRECATED] Skipping screenshot handlers - removed in Phase 1 cleanup');
      // initializeHandlersPart3({ ipcMain, coreAgent, windowState, windows });
    }

    console.log('🔧 Setting up conversation persistence handlers...');
    // In MCP mode, pass conversationAgent directly instead of coreAgent
    const agentForConversation = USE_MCP_PRIVATE_MODE ? conversationAgent : coreAgent;
    setupConversationHandlers(ipcMain, agentForConversation);
    console.log('✅ Conversation persistence handlers setup complete');
    
    // Declare sendWorkflowClarification outside conditional to avoid undefined error
    let sendWorkflowClarification = null;
    
    if (!USE_MCP_PRIVATE_MODE) {
      // DEPRECATED - Skip Local LLM handlers (removed in Phase 1 cleanup)
      console.log('⏭️  [DEPRECATED] Skipping Local LLM handlers - removed in Phase 1 cleanup');
      // initializeLocalLLMHandlers({ ipcMain, coreAgent, windowState, windows });
      
      // DEPRECATED - Setup orchestration workflow handlers (removed in Phase 1 cleanup)
      console.log('⏭️  [DEPRECATED] Skipping orchestration handlers - removed in Phase 1 cleanup');
      // const result = setupOrchestrationWorkflowHandlers(ipcMain, localLLMAgent, windows);
      // sendWorkflowClarification = result.sendClarificationRequest;
    } else {
      console.log('⏭️  [MCP-MODE] Skipping Local LLM handlers - using MCP phi4 service');
      console.log('⏭️  [MCP-MODE] Skipping orchestration workflow handlers - using MCP orchestrator');
    }
    
    if (!USE_MCP_PRIVATE_MODE) {
      // Skip database notification handlers in MCP mode
      console.log('🔧 Setting up database notification handlers...');
      await setupDatabaseNotificationHandlers();
      console.log('✅ Database notification IPC handlers setup complete');
    } else {
      console.log('⏭️  [MCP-MODE] Skipping database notification handlers');
    }
    
    // Initialize MCP client and config manager (used by multiple handlers)
    const MCPClient = require('./services/mcp/MCPClient.cjs');
    const MCPConfigManager = require('./services/mcp/MCPConfigManager.cjs');
    const mcpClient = new MCPClient(MCPConfigManager);
    
    // Initialize Prompted Anywhere service
    console.log('🚀 Initializing Prompted Anywhere service...');
    const { PromptedAnywhereService } = require('./services/promptedAnywhere.cjs');
    global.promptedAnywhereService = new PromptedAnywhereService(mcpClient);
    console.log('✅ Prompted Anywhere service initialized');
    
    // Initialize MCP handlers (microservices)
    console.log('🔧 Setting up MCP handlers...');
    registerMCPHandlers();
    console.log('✅ MCP handlers setup complete');
    
    // Initialize Screen Intelligence handlers
    console.log('🎯 Setting up Screen Intelligence handlers...');
    registerScreenIntelligenceHandlers();
    console.log('✅ Screen Intelligence handlers setup complete');
    
    // Initialize Insight handlers
    console.log('💡 Setting up Insight handlers...');
    registerInsightHandlers(mcpClient);
    console.log('✅ Insight handlers setup complete');
    
    // Initialize Insight History handlers
    console.log('📚 Setting up Insight History handlers...');
    setupInsightHistoryHandlers();
    console.log('✅ Insight History handlers setup complete');
    
    // Initialize MCP Private Mode handlers (NEW orchestrator)
    console.log('🔧 Setting up MCP Private Mode handlers...');
    registerPrivateModeHandlers();
    console.log('✅ MCP Private Mode handlers setup complete');
    
    // Initialize MCP Memory handlers (for Memory Debugger in private mode)
    if (USE_MCP_PRIVATE_MODE) {
      console.log('🔧 Setting up MCP Memory handlers...');
      setupMCPMemoryHandlers(mcpClient);
      console.log('✅ MCP Memory handlers setup complete');
    }
    
    // Initialize Gemini OAuth handlers
    console.log('🔧 Setting up Gemini OAuth handlers...');
    setupGeminiOAuthHandlers(MCPConfigManager.db);
    console.log('✅ Gemini OAuth handlers setup complete');
    
    // Initialize Vision OAuth handlers
    console.log('🔧 Setting up Vision OAuth handlers...');
    setupVisionOAuthHandlers(MCPConfigManager.db, MCPConfigManager);
    console.log('✅ Vision OAuth handlers setup complete');
    
    // Update stub handlers with full MCP service info (already registered early)
    if (USE_MCP_PRIVATE_MODE) {
      console.log('🔧 Updating MCP mode stub handlers with service info...');
      
      // Remove early stubs and replace with full versions
      ipcMain.removeHandler('agent-execute');
      ipcMain.removeHandler('llm-get-health');
      ipcMain.removeHandler('llm-get-cached-agents');
      ipcMain.removeHandler('llm-get-communications');
      
      // Partial stub for agent-execute - only ConversationSessionAgent works
      ipcMain.handle('agent-execute', async (event, params) => {
        // Allow ConversationSessionAgent to work for session management
        if (params.agentName === 'ConversationSessionAgent' && global.coreAgent) {
          try {
            const result = await global.coreAgent.executeAgent(params.agentName, params);
            return result;
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        }
        
        // Block all other agents
        return {
          success: false,
          error: 'agent-execute not available in MCP mode - use private-mode-process instead'
        };
      });
      
      // Full stub for llm-get-health with MCP service info
      ipcMain.handle('llm-get-health', async () => {
        return {
          success: true,
          mode: 'mcp',
          services: {
            'user-memory': { status: 'available', endpoint: 'http://localhost:3001' },
            'phi4': { status: 'available', endpoint: 'http://localhost:3003' },
            'web-search': { status: 'available', endpoint: 'http://localhost:3002' }
          }
        };
      });
      
      // Stub for cached agents
      ipcMain.handle('llm-get-cached-agents', async () => {
        return { success: true, agents: [] };
      });
      
      // Stub for communications
      ipcMain.handle('llm-get-communications', async () => {
        return { success: true, communications: [] };
      });
      
      // Window visibility control for automation
      ipcMain.handle('window-hide', async () => {
        if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
          global.overlayWindow.hide();
          console.log('🙈 [WINDOW] Overlay hidden for automation');
          return { success: true };
        }
        return { success: false, error: 'Window not available' };
      });
      
      ipcMain.handle('window-show', async () => {
        if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
          global.overlayWindow.show();
          console.log('👁️ [WINDOW] Overlay restored after automation');
          return { success: true };
        }
        return { success: false, error: 'Window not available' };
      });
      
      console.log('✅ MCP mode stub handlers updated');
    }
    
    // Initialize main IPC handlers
    console.log('🔧 Setting up main IPC handlers...');
    console.log('✅ Screenshot and system handlers setup complete');
    
    
    // Store the broadcast and clarification functions for use elsewhere
    global.broadcastOrchestrationUpdate = broadcastUpdate;
    global.sendClarificationRequest = sendWorkflowClarification || sendClarification;
    
    console.log('✅ All IPC handlers registered successfully');
    
  } catch (error) {
    console.error('❌ Error setting up IPC handlers:', error);
    throw error;
  }
}

// Window control handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Window visibility handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Chat window control handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Insight window control handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Chat messages window handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Memory debugger window handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Chat messaging system handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// ========================================
// AGENT ORCHESTRATION
// ========================================

// Agent orchestration handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers
// The "Give me a response to this email" scenario is handled through:
// 1. User message → agent-orchestrate → CoreAgent.ask()
// 2. CoreAgent dynamically determines needed agents (ScreenCapture, Memory, etc.)
// 3. Results flow to WebSocket streaming for ChatMessage/InsightView display

// Legacy IPC handlers removed - functionality will be re-implemented using new agent architecture as needed

// Legacy screenshot IPC handlers removed - functionality available through agent-screenshot handler using new agent architecture

// Memory query handlers are now initialized in setupIPCHandlers() using initializeHandlersPart2

// Memory handlers are now initialized in setupIPCHandlers() using initializeHandlersPart2

// All legacy handlers are now initialized in setupIPCHandlers() using initializeHandlersPart3

// Orchestration workflow handlers are now in ipc-handlers-part4.cjs
