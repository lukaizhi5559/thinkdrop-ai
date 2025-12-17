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
  logger.error('stdout error:', err);
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors - they happen when output pipe is broken
    return;
  }
  logger.error('stderr error:', err);
});

// Handle uncaught exceptions that might be related to logging
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors
    return;
  }
  logger.error('Uncaught Exception:', err);
  // Don't exit the process for EPIPE errors
  if (err.code !== 'EPIPE') {
    process.exit(1);
  }
});

// Handle unhandled promise rejections (e.g., from database corruption)
process.on('unhandledRejection', (reason, promise) => {
  // Check if it's a database corruption error
  if (reason && reason.message && reason.message.includes('Corrupt database')) {
    logger.warn('⚠️  Unhandled database corruption error (non-fatal):', reason.message);
    // Don't crash - database errors are logged but shouldn't kill the app
    return;
  }
  logger.error('Unhandled Promise Rejection:', reason);
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
const { registerAutomationHandlers } = require('./handlers/ipc-handlers-automation.cjs');

const logger = require('./logger.cjs');
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

// COMMENTED OUT: Old renderer window - using new overlay system instead
function createOverlayWindow() {
  logger.debug('⏭️  Skipping old renderer window - using overlay system');
  return;
  
  /* const primaryDisplay = screen.getPrimaryDisplay();
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
    logger.debug('✅ Main overlay window shown (index.html loaded)');
  });
  
  // Handle load errors
  overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error('❌ [MAIN WINDOW] Failed to load:', errorDescription, 'URL:', validatedURL);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    logger.debug('✅ [MAIN WINDOW] index.html loaded successfully');
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
  } */
}

// REMOVED: createChatMessagesWindow - now handled within unified overlayWindow
// Chat messages functionality is now integrated into the main overlay interface

// REMOVED: createMemoryDebuggerWindow - now handled within unified overlayWindow
// Memory debugger functionality is now integrated into the main overlay interface

// REMOVED: createInsightWindow - now handled within unified overlayWindow
// Insight functionality is now integrated into the main overlay interface

// Three-window overlay system
let ghostOverlayWindow = null;      // Full-screen, click-through for ghost mouse & visual cues
let promptOverlayWindow = null;     // Small, interactive for prompt bar
let intentOverlayWindow = null;     // Dynamic, interactive for intent UIs (results, guides, etc.)
let chatOverlayWindow = null;       // Chat window for conversation history

/**
 * Create ghost overlay window - full-screen, click-through
 * Used for: visual overlays, highlights, ghost pointer, web search results
 */
function createGhostOverlay() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  ghostOverlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    hasShadow: false,
    focusable: false, // Ghost layer doesn't need focus
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Explicitly disable shadow
  ghostOverlayWindow.setHasShadow(false);
  
  if (process.platform === 'darwin') {
    ghostOverlayWindow.setWindowButtonVisibility(false);
    ghostOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    ghostOverlayWindow.setAlwaysOnTop(true, 'floating', 1);
  }

  // CRITICAL: Enable click-through with mouse event forwarding
  // This requires accessibility permission on macOS
  try {
    ghostOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
    logger.debug('✅ [GHOST OVERLAY] Click-through enabled');
  } catch (error) {
    logger.warn('⚠️  [GHOST OVERLAY] Could not enable click-through (accessibility permission needed):', error.message);
  }

  // Load ghost overlay HTML (for results, highlights, etc.)
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    ghostOverlayWindow.loadURL('http://localhost:5173/src/overlay/index.html');
    ghostOverlayWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    ghostOverlayWindow.loadFile(path.join(__dirname, '../dist-renderer/overlay.html'));
  }

  ghostOverlayWindow.webContents.on('did-finish-load', () => {
    logger.debug('✅ [GHOST OVERLAY] Ghost overlay loaded');
  });

  ghostOverlayWindow.on('closed', () => {
    ghostOverlayWindow = null;
  });

  global.ghostOverlayWindow = ghostOverlayWindow;
  logger.debug('✅ Ghost overlay window created (click-through)');
  return ghostOverlayWindow;
}

/**
 * Create prompt overlay window - small, interactive
 * Used for: prompt bar, user input
 */
function createPromptOverlay() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const promptWidth = Math.floor(width * 0.6); // 60% of screen width
  const promptHeight = 100; // Compact height to match actual content (p-3 + header py-1 mb-1 + input + status)
  const x = Math.floor((width - promptWidth) / 2);
  const y = height - promptHeight; // Flush to bottom, no margin

  promptOverlayWindow = new BrowserWindow({
    width: promptWidth,
    height: promptHeight,
    minHeight: 80,
    maxHeight: Math.floor(height * 0.5), // Max 50% of screen height
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false, // Keep fixed size to prevent blocking
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    hasShadow: false,
    focusable: true, // Prompt window needs focus for input
    acceptFirstMouse: true,
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  promptOverlayWindow.setHasShadow(false);
  
  if (process.platform === 'darwin') {
    promptOverlayWindow.setWindowButtonVisibility(false);
    promptOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    promptOverlayWindow.setAlwaysOnTop(true, 'floating', 2); // Higher than ghost layer
  }

  // NO setIgnoreMouseEvents - this window is interactive!

  // Load prompt HTML
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    promptOverlayWindow.loadURL('http://localhost:5173/src/overlay/index.html?mode=prompt');
    promptOverlayWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    promptOverlayWindow.loadFile(path.join(__dirname, '../dist-renderer/overlay.html'));
  }

  promptOverlayWindow.webContents.on('did-finish-load', () => {
    logger.debug('✅ [PROMPT OVERLAY] Prompt overlay loaded');
  });

  promptOverlayWindow.on('closed', () => {
    promptOverlayWindow = null;
  });

  global.promptOverlayWindow = promptOverlayWindow;
  logger.debug('✅ Prompt overlay window created (interactive)');
  return promptOverlayWindow;
}

/**
 * Create intent overlay window - dynamic, interactive
 * Used for: web search results, command guides, any intent UI with interaction
 * This window is DYNAMIC - can resize and reposition based on context
 */
function createIntentOverlay() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Start with compact size for loading indicator, will resize dynamically for results
  const initialWidth = Math.floor(width * 0.6); // 60% of screen width
  // const initialWidth = 400; // Compact for loading message
  const initialHeight = 120; // Just enough for loading indicator
  
  intentOverlayWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 200, // Minimum for small UI cards
    minHeight: 200,
    maxWidth: Math.floor(width * 0.9), // Max 90% of screen
    maxHeight: Math.floor(height * 0.9),
    x: Math.floor((width - initialWidth) / 2), // Center horizontally
    y: Math.floor((height - initialHeight) / 2), // Center vertically - component will reposition as needed
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true, // CRITICAL: Allow dynamic resizing
    movable: true, // CRITICAL: Allow repositioning to follow ghost mouse
    minimizable: false,
    maximizable: false,
    closable: true,
    hasShadow: false,
    focusable: true, // Intent window needs focus for interaction
    acceptFirstMouse: true,
    show: false, // Start hidden
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  intentOverlayWindow.setHasShadow(false);
  
  if (process.platform === 'darwin') {
    intentOverlayWindow.setWindowButtonVisibility(false);
    intentOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    intentOverlayWindow.setAlwaysOnTop(true, 'floating', 3); // Highest layer
  }

  // NO setIgnoreMouseEvents - this window is interactive!

  // Load intent HTML
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    intentOverlayWindow.loadURL('http://localhost:5173/src/overlay/index.html?mode=intent');
    intentOverlayWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    intentOverlayWindow.loadFile(path.join(__dirname, '../dist-renderer/overlay.html'));
  }

  intentOverlayWindow.webContents.on('did-finish-load', () => {
    logger.debug('✅ [INTENT OVERLAY] Intent overlay loaded');
  });

  intentOverlayWindow.on('closed', () => {
    intentOverlayWindow = null;
  });

  global.intentOverlayWindow = intentOverlayWindow;
  logger.debug('✅ Intent overlay window created (interactive, hidden)');
  return intentOverlayWindow;
}

/**
 * Create chat overlay window - conversation history
 * Used for: viewing conversation transcript, managing conversations
 * Positioned above PromptBar, same width, fills remaining height
 */
function createChatOverlay() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Calculate dimensions to match PromptBar width and position above it
  const promptWidth = Math.floor(width * 0.6); // Match PromptBar 60% width
  const promptHeight = 80; // PromptBar height
  const chatHeight = height - promptHeight - 100; // Leave 100px space at bottom for prompt bar
  const x = Math.floor((width - promptWidth) / 2); // Center horizontally
  const y = 10; // Small margin from top
  
  chatOverlayWindow = new BrowserWindow({
    width: promptWidth,
    height: chatHeight,
    minWidth: 400,
    minHeight: 300,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true, // Allow resizing
    movable: true, // Allow dragging
    minimizable: false,
    maximizable: false,
    closable: true,
    hasShadow: false,
    focusable: true,
    acceptFirstMouse: true,
    show: false, // Start hidden
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  chatOverlayWindow.setHasShadow(false);
  
  if (process.platform === 'darwin') {
    chatOverlayWindow.setWindowButtonVisibility(false);
    chatOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    chatOverlayWindow.setAlwaysOnTop(true, 'floating', 2); // Below intent window
  }

  // Load chat HTML
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    chatOverlayWindow.loadURL('http://localhost:5173/src/overlay/index.html?mode=chat');
    chatOverlayWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    chatOverlayWindow.loadFile(path.join(__dirname, '../dist-renderer/overlay.html'));
  }

  chatOverlayWindow.webContents.on('did-finish-load', () => {
    logger.debug('✅ [CHAT OVERLAY] Chat overlay loaded');
  });

  chatOverlayWindow.on('closed', () => {
    chatOverlayWindow = null;
  });

  global.chatOverlayWindow = chatOverlayWindow;
  logger.debug('✅ Chat overlay window created (interactive, hidden)');
  return chatOverlayWindow;
}

function toggleOverlay() {
  if (!overlayWindow) return;
  
  if (isGloballyVisible) {
    // Hide the unified overlay window and three-window overlay system
    overlayWindow.hide();
    isOverlayVisible = false;
    isChatVisible = false;
    isInsightVisible = false;
    isGloballyVisible = false;
    
    // Hide three-window overlay system
    if (ghostOverlayWindow) ghostOverlayWindow.hide();
    if (promptOverlayWindow) promptOverlayWindow.hide();
    if (intentOverlayWindow) intentOverlayWindow.hide();
  } else {
    // Show the unified overlay window and three-window overlay system
    overlayWindow.show();
    overlayWindow.focus();
    isOverlayVisible = true;
    isGloballyVisible = true;
    
    // Show three-window overlay system
    if (ghostOverlayWindow) ghostOverlayWindow.show();
    if (promptOverlayWindow) {
      promptOverlayWindow.show();
      promptOverlayWindow.focus();
    }
    // intentOverlayWindow stays hidden until needed
  }
}

app.whenReady().then(async () => {
  logger.debug('🚀 App ready - starting initialization sequence...');
  
    // Step 1: Initialize core services FIRST
    logger.debug('🔧 Step 1: Initializing core services...');
    //await initializeServices();
    logger.debug('✅ Step 1: Core services initialized');
    
    // Step 2: Setup IPC handlers AFTER services are ready
    logger.debug('🔧 Step 2: Setting up IPC handlers...');

    createOverlayWindow();
    logger.debug('✅ Step 3: Overlay window created');
    
    // Create combined overlay (AI viewing indicator + hotkey toast)
    logger.debug('👁️  Creating combined overlay...');
    
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
      
      // Create three-window overlay system first
      logger.debug('🔧 Creating ghost overlay window (click-through)...');
      createGhostOverlay();
      
      logger.debug('🔧 Creating prompt overlay window (interactive)...');
      createPromptOverlay();
      
      logger.debug('🔧 Creating intent overlay window (interactive, hidden)...');
      createIntentOverlay();
      
      logger.debug('🔧 Creating chat overlay window (interactive, hidden)...');
      createChatOverlay();
      
      // Initialize overlay IPC handlers with window references
      logger.debug('🔧 Initializing overlay IPC handlers...');
      const { initializeOverlayIPC } = require('./ipc/overlay.cjs');
      initializeOverlayIPC(coreAgent, {
        ghost: ghostOverlayWindow,
        prompt: promptOverlayWindow,
        intent: intentOverlayWindow,
        chat: chatOverlayWindow
      });
      logger.debug('✅ Overlay IPC handlers initialized');
      
      // Show overlay windows by default (since we commented out old renderer)
      logger.debug('🔧 Showing overlay windows...');
      if (ghostOverlayWindow) {
        ghostOverlayWindow.show();
        logger.debug('✅ Ghost overlay shown');
      }
      if (promptOverlayWindow) {
        promptOverlayWindow.show();
        promptOverlayWindow.focus();
        logger.debug('✅ Prompt overlay shown');
      }
    }
  }).catch(async error => {
    logger.error('❌ Error during initialization sequence:', error);
    // Setup IPC handlers anyway to allow basic functionality (only once)
    if (!handlersSetup) {
      handlersSetup = true;
      await setupIPCHandlers();
    }
  });
  
  logger.debug('🎉 Initialization sequence complete!');
  
  // Initialize Window Tracker in Worker Thread (lightweight window change detection)
  logger.debug('🔧 Initializing Window Tracker in worker thread...');
  try {
    const { Worker } = require('worker_threads');
    const path = require('path');
    
    global.windowTracker = new Worker(
      path.join(__dirname, 'workers/window-tracker-worker.cjs')
    );
    
    global.windowTrackerReady = false;
    global.activeWindowId = null; // Track current active window
    global.activeWindowData = null; // Track current active window data (title, app, url)
    
    global.windowTracker.on('message', async (msg) => {
      if (msg.type === 'ready') {
        global.windowTrackerReady = true;
        logger.debug('✅ Window Tracker worker ready');
      } else if (msg.type === 'activeWindowUpdate') {
        // Worker notifying of active window change
        const previousWindowId = global.activeWindowId;
        global.activeWindowId = msg.windowId;
        global.activeWindowData = {
          title: msg.title,
          app: msg.app,
          url: msg.url,
          windowId: msg.windowId
        };
        logger.debug(`🎯 [MAIN] Active window updated: ${msg.windowId}`);
        logger.debug(`   Previous: ${previousWindowId || 'none'}`);
         
      } else if (msg.type === 'error') {
        logger.error('❌ [MAIN] Window Tracker error:', msg.error);
      } else {
        logger.warn('⚠️  [MAIN] Unknown message type from window tracker:', msg.type);
      }
    });
    
    global.windowTracker.on('error', (error) => {
      logger.error('❌ Window Tracker thread error:', error);
      global.windowTrackerReady = false;
    });
    
    global.windowTracker.on('exit', (code) => {
      logger.debug(`⚠️  Window Tracker exited with code ${code}`);
      global.windowTrackerReady = false;
    });
    
    // Initialize the worker
    global.windowTracker.postMessage({ type: 'init' });
    
    logger.debug('✅ Window Tracker worker thread started');
  } catch (error) {
    logger.error('❌ Failed to start Window Tracker worker:', error);
    logger.debug('⚠️  Continuing without window tracking');
  }
  
  // Initialize Selection Detector for context-aware queries
  logger.debug('📋 Initializing Selection Detector...');
  const { getSelectionDetector } = require('./services/selection-detector.cjs');
  global.selectionDetector = getSelectionDetector();
  global.selectionDetector.start();
  logger.debug('✅ Selection Detector initialized');
  
  // Show hotkey hint once on startup (user can dismiss it)
  setTimeout(() => {
    if (global.selectionDetector) {
      logger.debug('🔔 Showing hotkey hint toast...');
      global.selectionDetector.showHotkeyHintOnce();
    }
  }, 3000); // Show after 3 seconds to ensure overlay is ready
  
  // Initialize Selection Overlay for floating ThinkDrop button
  logger.debug('💧 Initializing Selection Overlay...');
  const { createSelectionOverlay } = require('./windows/selection-overlay.cjs');
  createSelectionOverlay();
  logger.debug('✅ Selection Overlay initialized');
  
  // Initialize FAB Window (Floating Action Button)
  // logger.debug('🎯 Initializing FAB Window...');
  // const { createFABWindow, updateFABState } = require('./windows/fab-window.cjs');
  // createFABWindow();
  // global.updateFABState = updateFABState; // Make it globally accessible
  // logger.debug('✅ FAB Window initialized');
  
  // Initialize Guide Window (Interactive Guides)
  logger.debug('🎯 Initializing Guide Window...');
  const { createGuideWindow, showGuideWindow, hideGuideWindow } = require('./windows/guide-window.cjs');
  createGuideWindow();
  global.showGuideWindow = showGuideWindow; // Make it globally accessible
  global.hideGuideWindow = hideGuideWindow;
  logger.debug('✅ Guide Window initialized');
  
  // Register global shortcut to show/hide overlay (like Cluely's Cmd+Shift+Space)
  // DISABLED: Overlay temporarily disabled in favor of "Prompted Anywhere" feature
  // To re-enable: set ENABLE_OVERLAY=true in environment or uncomment below
  const ENABLE_OVERLAY = process.env.ENABLE_OVERLAY === 'true';
  if (ENABLE_OVERLAY) {
    globalShortcut.register('Cmd+Shift+Space', () => {
      toggleOverlay();
      // hideAIViewingOverlay();
    });
    logger.debug('✅ Overlay shortcut (Cmd+Shift+Space) registered');
  } else {
    logger.debug('⏭️  Overlay shortcut disabled (use ENABLE_OVERLAY=true to re-enable)');
  }
  
  // 🎯 Cmd+Option+A to capture selection and show "Ask" interface
  globalShortcut.register('Cmd+Option+A', async () => {
    logger.debug('🎯 [ASK] Cmd+Option+A triggered - capturing selection');
    
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
    logger.debug('🧪 [TEST] Cmd+Option+T triggered - testing floating button');
    
    if (global.selectionDetector) {
      const testText = "This is a test selection for the floating ThinkDrop button!";
      await global.selectionDetector.showFloatingButtonWithEstimatedPosition(testText);
    }
  });
  
  // 🚀 Shift+Cmd+L for "Prompted Anywhere" - AI assistance in any app
  globalShortcut.register('Shift+Cmd+L', async () => {
    logger.debug('🚀 [Prompted Anywhere] Shift+Cmd+L triggered!');
    
    if (global.promptedAnywhereService) {
      await global.promptedAnywhereService.handlePromptAnywhere();
    } else {
      logger.error('❌ [Prompted Anywhere] Service not initialized');
    }
  });
  
  // 🛑 Cancel running automation function (shared by multiple shortcuts)
  const cancelAutomation = async (triggerKey) => {
    logger.debug(`🛑 [Cancel Automation] ${triggerKey} triggered!`);
    
    try {
      const response = await mcpClient.callService(
        'command',
        'command.cancel-automation',
        {},
        { timeout: 5000 }
      );
      
      if (response.success && response.cancelled) {
        logger.debug('✅ [Cancel Automation] Automation cancelled successfully');
      } else {
        logger.debug('ℹ️  [Cancel Automation] No automation was running');
      }
    } catch (error) {
      logger.error('❌ [Cancel Automation] Failed:', error.message);
    }
  };
    
  // 🛑 Shift+Cmd+J to cancel running automation
  globalShortcut.register('Shift+Cmd+J', () => cancelAutomation('Shift+Cmd+J'));
  
  // 🛑 ESC to cancel running automation (intuitive!)
  globalShortcut.register('Escape', () => cancelAutomation('ESC'));
  
  // Screen Intelligence shortcuts
  globalShortcut.register('Cmd+Option+I', async () => {
    logger.debug('🔍 Screen Intelligence: Discovery Mode triggered');
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
          logger.debug('✅ Cached screen analysis');
        }
        
        // Show discovery mode with all elements
        showDiscoveryMode(data.elements);
        showToast(`Analysis complete! Found ${data.elements.length} elements (${duration}s)`, 'success', 3000);
      } else {
        showToast('No elements found', 'warning', 2000);
      }
      
    } catch (error) {
      logger.error('Screen Intelligence error:', error);
      showToast(`Error: ${error.message}`, 'error', 3000);
    }
  });
  
  // Clear screen intelligence overlays
  globalShortcut.register('Cmd+Option+C', () => {
    logger.debug('🧹 Screen Intelligence: Clearing overlays');
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
    logger.debug('🔒 [MCP-MODE] Private mode enabled - skipping local agent initialization');
    logger.debug('🔒 [MCP-MODE] Using MCP services for all AI operations');
    
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
      logger.debug('✅ [MCP-MODE] Database initialized for MCP services only');
      
      // Create minimal coreAgent stub (no conversation agent)
      global.coreAgent = {
        context: { database: databaseManager },
        executeAgent: async (agentName, params) => {
          throw new Error(`Agent ${agentName} not available in MCP mode - use MCP services instead`);
        }
      };
      
      logger.debug('✅ [MCP-MODE] Minimal stub ready - all operations via MCP services');
      
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
      
      logger.debug('✅ [MCP-MODE] Early stub handlers registered');
      
    } catch (error) {
      logger.error('❌ [MCP-MODE] Database initialization failed:', error);
    }
    
    return; // Skip all agent bootstrapping
  }
  
  try {
    // Initialize CoreAgent (AgentOrchestrator) for dynamic agent management
    try {
      logger.debug('🔄 Step 1: Importing AgentOrchestrator...');
      // Dynamic import for ES module compatibility
      const { AgentOrchestrator } = await import('./services/agents/AgentOrchestrator.js');
      logger.debug('✅ Step 1: AgentOrchestrator imported successfully');
      
      logger.debug('🔄 Step 2: Setting up database paths...');
      // Initialize DuckDB for agent memory storage using DatabaseManager
      const path = require('path');
      const fs = require('fs');
      const projectRoot = path.dirname(path.dirname(__dirname)); // Go up from src/main to project root
      const dataDir = path.join(projectRoot, 'data');
      const dbPath = path.join(dataDir, 'agent_memory.duckdb');
      
      // Ensure data directory exists
      if (!fs.existsSync(dataDir)) {
        logger.debug(`📁 Creating data directory: ${dataDir}`);
        fs.mkdirSync(dataDir, { recursive: true });
      }
      logger.debug('✅ Step 2: Database paths configured');
      
      logger.debug('🔄 Step 3: Importing and initializing DatabaseManager...');
      // Import and initialize DatabaseManager
      const { default: databaseManager } = await import('./services/utils/DatabaseManager.js');
      await databaseManager.initialize(dbPath);
      logger.debug('✅ Step 3: DatabaseManager initialized successfully');
      
      logger.debug('🔄 Step 4: Creating AgentOrchestrator instance...');
      coreAgent = new AgentOrchestrator();
      logger.debug('✅ Step 4: AgentOrchestrator instance created');
      
      logger.debug('🔄 Step 5: Initializing CoreAgent...');
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
      logger.debug('✅ Step 5: CoreAgent initialized successfully:', initResult);

      // Initialize performance optimizations
      logger.debug('🔄 Step 6: Initializing performance optimizations...');
      const { optimizationManager } = require('./services/cache/OptimizationManager.cjs');
      await optimizationManager.initialize();
      logger.debug('✅ Step 6: Performance optimizations ready');

      // Start the embedding daemon for automatic background embedding generation
      try {
        logger.debug('🤖 Starting embedding daemon for semantic search...');
        
        // Bootstrap SemanticEmbeddingAgent first
        await coreAgent.ask({
          agent: 'SemanticEmbeddingAgent',
          action: 'bootstrap'
        });
        
        // Bootstrap ConversationSessionAgent to create conversation database tables
        logger.debug('🗣️ Bootstrapping ConversationSessionAgent...');
        await coreAgent.ask({
          agent: 'ConversationSessionAgent',
          action: 'bootstrap'
        });
        
        // Bootstrap WebSearchAgent for hybrid query support
        logger.debug('🔍 Bootstrapping WebSearchAgent...');
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
          logger.debug('✅ Embedding daemon started successfully:', daemonResult.message);
        } else {
          logger.warn('⚠️ Embedding daemon failed to start:', daemonResult.error);
        }
        
      } catch (daemonError) {
        logger.error('❌ Failed to start embedding daemon:', daemonError);
        // Continue without daemon - app should still work
      }

    } catch (error) {
      logger.error('❌ Failed to initialize CoreAgent:', error);
      logger.error('❌ CoreAgent error stack:', error.stack);
      logger.error('❌ CoreAgent error details:', {
        message: error.message,
        name: error.name,
        code: error.code
      });
      // Set coreAgent to null to ensure handlers know it's not available
      coreAgent = null;
    }
    
    // Legacy event listeners removed - functionality will be re-implemented using new agent architecture as needed
    
  } catch (error) {
    logger.error('❌ Service initialization error:', error);
    // Continue without services for demo mode
  }
}

// Setup IPC handlers using modularized files
async function setupIPCHandlers() {
  logger.debug('🔧 Setting up IPC handlers...');
  
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
    logger.debug('✅ Main IPC handlers setup complete');
    
    if (!USE_MCP_PRIVATE_MODE) {
      // DEPRECATED - Setup memory handlers (skip in MCP mode - use MCP user-memory service)
      logger.debug('⏭️  [DEPRECATED] Skipping memory handlers - removed in Phase 1 cleanup');
      // setupMemoryHandlers(ipcMain, coreAgent);
    } else {
      logger.debug('⏭️  [MCP-MODE] Skipping memory handlers - using MCP user-memory service');
    }
    
    // DEPRECATED - Initialize screenshot, system health, and legacy LLM handlers
    if (!USE_MCP_PRIVATE_MODE) {
      logger.debug('⏭️  [DEPRECATED] Skipping screenshot handlers - removed in Phase 1 cleanup');
      // initializeHandlersPart3({ ipcMain, coreAgent, windowState, windows });
    }

    logger.debug('🔧 Setting up conversation persistence handlers...');
    // In MCP mode, pass conversationAgent directly instead of coreAgent
    const agentForConversation = USE_MCP_PRIVATE_MODE ? conversationAgent : coreAgent;
    setupConversationHandlers(ipcMain, agentForConversation);
    logger.debug('✅ Conversation persistence handlers setup complete');
    
    // Declare sendWorkflowClarification outside conditional to avoid undefined error
    let sendWorkflowClarification = null;
    
    if (!USE_MCP_PRIVATE_MODE) {
      // DEPRECATED - Skip Local LLM handlers (removed in Phase 1 cleanup)
      logger.debug('⏭️  [DEPRECATED] Skipping Local LLM handlers - removed in Phase 1 cleanup');
      // initializeLocalLLMHandlers({ ipcMain, coreAgent, windowState, windows });
      
      // DEPRECATED - Setup orchestration workflow handlers (removed in Phase 1 cleanup)
      logger.debug('⏭️  [DEPRECATED] Skipping orchestration handlers - removed in Phase 1 cleanup');
      // const result = setupOrchestrationWorkflowHandlers(ipcMain, localLLMAgent, windows);
      // sendWorkflowClarification = result.sendClarificationRequest;
    } else {
      logger.debug('⏭️  [MCP-MODE] Skipping Local LLM handlers - using MCP phi4 service');
      logger.debug('⏭️  [MCP-MODE] Skipping orchestration workflow handlers - using MCP orchestrator');
    }
    
    if (!USE_MCP_PRIVATE_MODE) {
      // Skip database notification handlers in MCP mode
      logger.debug('🔧 Setting up database notification handlers...');
      await setupDatabaseNotificationHandlers();
      logger.debug('✅ Database notification IPC handlers setup complete');
    } else {
      logger.debug('⏭️  [MCP-MODE] Skipping database notification handlers');
    }
    
    // Initialize MCP client and config manager (used by multiple handlers)
    const MCPClient = require('./services/mcp/MCPClient.cjs');
    const MCPConfigManager = require('./services/mcp/MCPConfigManager.cjs');
    const mcpClient = new MCPClient(MCPConfigManager);
    
    // Initialize Prompted Anywhere service
    logger.debug('🚀 Initializing Prompted Anywhere service...');
    const { PromptedAnywhereService } = require('./services/promptedAnywhere.cjs');
    global.promptedAnywhereService = new PromptedAnywhereService(mcpClient);
    logger.debug('✅ Prompted Anywhere service initialized');
    
    // Initialize MCP handlers (microservices)
    logger.debug('🔧 Setting up MCP handlers...');
    registerMCPHandlers();
    logger.debug('✅ MCP handlers setup complete');
    
    // Initialize Screen Intelligence handlers
    logger.debug('🎯 Setting up Screen Intelligence handlers...');
    registerScreenIntelligenceHandlers();
    logger.debug('✅ Screen Intelligence handlers setup complete');
    
    // Initialize Insight handlers
    logger.debug('💡 Setting up Insight handlers...');
    registerInsightHandlers(mcpClient);
    logger.debug('✅ Insight handlers setup complete');
    
    // Initialize Insight History handlers
    logger.debug('📚 Setting up Insight History handlers...');
    setupInsightHistoryHandlers();
    logger.debug('✅ Insight History handlers setup complete');
    
    // Initialize Automation handlers
    logger.debug('🤖 Setting up Automation handlers...');
    // Create overlay manager object to pass to automation handlers
    const overlayManager = {
      intentOverlay: intentOverlayWindow,
      promptOverlay: promptOverlayWindow,
      ghostOverlay: ghostOverlayWindow,
      sendToIntent: (channel, data) => {
        if (intentOverlayWindow && !intentOverlayWindow.isDestroyed()) {
          intentOverlayWindow.webContents.send(channel, data);
        }
      }
    };
    registerAutomationHandlers(mcpClient, overlayManager);
    logger.debug('✅ Automation handlers setup complete');
    
    // Initialize MCP Private Mode handlers (NEW orchestrator)
    logger.debug('🔧 Setting up MCP Private Mode handlers...');
    registerPrivateModeHandlers();
    logger.debug('✅ MCP Private Mode handlers setup complete');
    
    // Initialize MCP Memory handlers (for Memory Debugger in private mode)
    if (USE_MCP_PRIVATE_MODE) {
      logger.debug('🔧 Setting up MCP Memory handlers...');
      setupMCPMemoryHandlers(mcpClient);
      logger.debug('✅ MCP Memory handlers setup complete');
    }
    
    // Initialize Gemini OAuth handlers
    logger.debug('🔧 Setting up Gemini OAuth handlers...');
    setupGeminiOAuthHandlers(MCPConfigManager.db);
    logger.debug('✅ Gemini OAuth handlers setup complete');
    
    // Initialize Vision OAuth handlers
    logger.debug('🔧 Setting up Vision OAuth handlers...');
    setupVisionOAuthHandlers(MCPConfigManager.db, MCPConfigManager);
    logger.debug('✅ Vision OAuth handlers setup complete');
    
    // Update stub handlers with full MCP service info (already registered early)
    if (USE_MCP_PRIVATE_MODE) {
      logger.debug('🔧 Updating MCP mode stub handlers with service info...');
      
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
          logger.debug('🙈 [WINDOW] Overlay hidden for automation');
          return { success: true };
        }
        return { success: false, error: 'Window not available' };
      });
      
      ipcMain.handle('window-show', async () => {
        if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
          global.overlayWindow.show();
          logger.debug('👁️ [WINDOW] Overlay restored after automation');
          return { success: true };
        }
        return { success: false, error: 'Window not available' };
      });
      
      logger.debug('✅ MCP mode stub handlers updated');
    }
    
    // Initialize main IPC handlers
    logger.debug('🔧 Setting up main IPC handlers...');
    logger.debug('✅ Screenshot and system handlers setup complete');
    
    
    // Store the broadcast and clarification functions for use elsewhere
    global.broadcastOrchestrationUpdate = broadcastUpdate;
    global.sendClarificationRequest = sendWorkflowClarification || sendClarification;
    
    logger.debug('✅ All IPC handlers registered successfully');
    
  } catch (error) {
    logger.error('❌ Error setting up IPC handlers:', error);
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
