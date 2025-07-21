// Entry point for Thinkdrop AI Electron overlay app
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config(); // Load .env variables

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

// Import modularized IPC handlers
const { initializeIPCHandlers } = require('./handlers/ipc-handlers.cjs');
const { setupMemoryHandlers } = require('./handlers/ipc-handlers-memory.cjs');
const { initializeHandlers: initializeHandlersPart3 } = require('./handlers/ipc-handlers-screenshot.cjs');
const { setupOrchestrationWorkflowHandlers } = require('./handlers/ipc-handlers-orchestration.cjs');

// CoreAgent (AgentOrchestrator) will be imported dynamically due to ES module

let overlayWindow = null;
let chatWindow = null;
let chatMessagesWindow = null;
let insightWindow = null;
let memoryDebuggerWindow = null;
let isGloballyVisible = true;
let isOverlayVisible = true;
let isChatVisible = false;
let isInsightVisible = false;
let isMemoryDebuggerVisible = false;
let isOrchestrationActive = false; // Prevent window hiding during orchestration
let visibleWindows = [];

// CoreAgent instance for dynamic agent management
let coreAgent = null; // AgentOrchestrator instance
let localLLMAgent = null; // Local LLM agent instance

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const windowWidth = width / 2;
  const windowHeight = Math.min(height - 40, 70); // Use almost full height with minimal margin


  overlayWindow = new BrowserWindow({
    width: Math.min(width - 40, 300), // Responsive width with max limit
    height: windowHeight, // Proper height for toolbar with padding
    minHeight: 30, // Minimum height for toolbar
    maxHeight: 40,
    x: windowWidth - 200, // Small margin from left
    y: 20, // Position at top of screen
    frame: false, // Remove window frame completely
    transparent: true, // Transparent background
    alwaysOnTop: true, // Always stay on top
    skipTaskbar: true, // Don't show in taskbar
    resizable: false,
    movable: true, // Allow dragging
    minimizable: false,
    maximizable: false,
    closable: false, // Prevent close button
    focusable: true,
    // Remove titleBarStyle to ensure no macOS controls
    hasShadow: false, // No shadow for cleaner look
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

  // Set window level to float above all apps (similar to Cluely)
  overlayWindow.setAlwaysOnTop(true, 'floating', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  overlayWindow.loadURL(
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:5173'
      : `file://${path.join(__dirname, '../../dist-renderer/index.html')}`
  );

  // Make overlay click-through when not in focus (like Cluely)
  overlayWindow.setIgnoreMouseEvents(false);
  
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

// Create chat messages window (floating window for displaying messages)
function createChatMessagesWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const windowWidth = Math.min(width - 40, 375);
  const windowHeight = height - 10; // Use almost full height with minimal margin

  const x = width - windowWidth - 10; // 10px margin from right
  const y = 5; // 5px margin from top for minimal constraint
  
  chatMessagesWindow = new BrowserWindow({
    width: windowWidth, // Responsive width  
    height: windowHeight, // Use calculated full height
    minWidth: 250, // Minimum width for usability
    maxWidth: width - 20, // Maximum width with margin
    minHeight: windowHeight - 20, // Fixed height - no height resizing
    maxHeight: windowHeight, // Fixed height - no height resizing
    x: x, // Position from right edge
    y: y, // Position from top with minimal margin
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    alwaysOnBottom: true,
    skipTaskbar: true,
    resizable: true, // Allow resizing (width only due to height constraints)
    movable: true, // Allow dragging
    minimizable: false,
    maximizable: false,
    closable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  // Set window level to float above all apps
  chatMessagesWindow.setAlwaysOnTop(true, 'floating', 1);
  chatMessagesWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Constrain dragging to horizontal only (prevent vertical movement)
  const fixedHeight = windowHeight; // Store the fixed height
  const fixedWidth = windowWidth; // Store the fixed width
    
  // Constrain resizing to width only (prevent height changes)
  chatMessagesWindow.on('resize', () => {
    if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
      const [currentWidth, currentHeight] = chatMessagesWindow.getSize();
      if (currentHeight !== fixedHeight && currentWidth !== fixedWidth) {
        // Reset height if it changed, keep width
        // chatMessagesWindow.setSize(currentWidth, fixedHeight);
        chatMessagesWindow.setMinimumSize(currentWidth - 20, currentHeight - 20);
      }
    }
  });
  
  // Load the messages window
  const messagesUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173?mode=messages'
    : `file://${path.join(__dirname, '../../dist-renderer/index.html')}?mode=messages`;
  
  chatMessagesWindow.loadURL(messagesUrl);
  
  // Hide window instead of closing
  chatMessagesWindow.on('close', (event) => {
    if (chatMessagesWindow && !app.isQuiting) {
      event.preventDefault();
      chatMessagesWindow.hide();
    }
  });
  
  // Clean up window reference when destroyed
  chatMessagesWindow.on('closed', () => {
    chatMessagesWindow = null;
  });
  
  return chatMessagesWindow;
}

// Create memory debugger window (floating window for debugging user memories)
function createMemoryDebuggerWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const windowWidth = Math.min(width - 40, 500);
  const windowHeight = Math.min(height - 40, 600); // Use almost full height with minimal margin

  const x = 5; // 10px margin from right
  const y = 100; // 5px margin from top for minimal constraint
  
  memoryDebuggerWindow = new BrowserWindow({
    width: windowWidth, // Compact width for debugging interface
    height: windowHeight, // Taller for memory data
    minHeight: 400, // Minimum height for debugging interface
    maxHeight: Math.min(height - 40, 800), // Maximum height
    x: x, // Center horizontally
    y: y, // Position higher on screen
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  // Set window level to float above all apps
  memoryDebuggerWindow.setAlwaysOnTop(true, 'floating', 1);
  memoryDebuggerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Load the memory debugger window
  const memoryUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173?mode=memory'
    : `file://${path.join(__dirname, '../../dist-renderer/index.html')}?mode=memory`;
  
  memoryDebuggerWindow.loadURL(memoryUrl);
  
  // Hide window instead of closing
  memoryDebuggerWindow.on('close', (event) => {
    if (memoryDebuggerWindow && !app.isQuiting) {
      event.preventDefault();
      memoryDebuggerWindow.hide();
    }
  });
  
  // Clean up window reference when destroyed
  memoryDebuggerWindow.on('closed', () => {
    memoryDebuggerWindow = null;
  });
  
  return memoryDebuggerWindow;
}

// Create insight window (floating window for displaying contextual insights)
function createInsightWindow() {
  if (insightWindow) {
    insightWindow.show();
    insightWindow.focus();
    isInsightVisible = true;
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  insightWindow = new BrowserWindow({
    width: Math.min(width - 40, 500), // Compact width for debugging interface
    height: Math.min(height - 100, 600), // Max height 600px with margin
    x: width - 440, // Position on the right side with margin
    y: 50, // Position from top
    frame: false, // Remove window frame completely
    transparent: true, // Transparent background
    alwaysOnTop: true, // Always stay on top
    skipTaskbar: true, // Don't show in taskbar
    resizable: true, // Allow resizing as specified in UI plan
    movable: true, // Allow dragging
    minimizable: false,
    maximizable: false,
    closable: false, // Prevent close button
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  // Set window level to float above all apps
  insightWindow.setAlwaysOnTop(true, 'floating', 1);
  insightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Load the insight window with mode parameter
  const insightUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173?mode=insight'
    : `file://${path.join(__dirname, '../../dist-renderer/index.html')}?mode=insight`;
  
  insightWindow.loadURL(insightUrl);
  
  // Hide window instead of closing
  insightWindow.on('close', (event) => {
    if (insightWindow && !app.isQuiting) {
      event.preventDefault();
      insightWindow.hide();
      isInsightVisible = false;
    }
  });
  
  // Clean up window reference when destroyed
  insightWindow.on('closed', () => {
    insightWindow = null;
  });
  
  // DevTools can be opened manually if needed for debugging
  // Removed automatic opening to prevent unwanted console popup
  
  isInsightVisible = true;
  return insightWindow;
}

function toggleOverlay() {
  if (!overlayWindow) return;
  
  if (isGloballyVisible) {
    // Hide all windows
    overlayWindow.hide();
    if (chatWindow) {
      chatWindow.hide();
      visibleWindows.push('chatWindow');
    }
    if (chatMessagesWindow) {
      chatMessagesWindow.hide();
      visibleWindows.push('chatMessagesWindow');
    }
    if (insightWindow && !global.isOrchestrationActive) {
      insightWindow.hide();
      visibleWindows.push('insightWindow');
    } else if (insightWindow && global.isOrchestrationActive) {
      console.log('🛡️ Protecting insight window during orchestration - not hiding');
    }
    if (memoryDebuggerWindow) {
      memoryDebuggerWindow.hide();
      visibleWindows.push('memoryDebuggerWindow');
    }
    isOverlayVisible = false;
    isChatVisible = false;
    isInsightVisible = false;
    isGloballyVisible = false;
  } else {
    // Show overlay window (chat windows will be shown when needed)
    overlayWindow.show();
    overlayWindow.focus();

    if (visibleWindows.includes('chatMessagesWindow')) {
      chatMessagesWindow.show();
      visibleWindows = visibleWindows.filter((window) => window !== 'chatMessagesWindow');
    }
    if (visibleWindows.includes('insightWindow')) {
      insightWindow.show();
      visibleWindows = visibleWindows.filter((window) => window !== 'insightWindow');
    }
    if (visibleWindows.includes('chatWindow')) {
      chatWindow.show();
      visibleWindows =visibleWindows.filter((window) => window !== 'chatWindow');
    }
    if (visibleWindows.includes('memoryDebuggerWindow')) {
      memoryDebuggerWindow.show();
      visibleWindows =visibleWindows.filter((window) => window !== 'memoryDebuggerWindow');
    }
    isOverlayVisible = true;
    isGloballyVisible = true;
  }
}

function toggleChat() {
  // Since ChatWindow is merged into ChatMessages, use the unified window
  if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
    createChatMessagesWindow();
  } else if (chatMessagesWindow.isVisible()) {
    chatMessagesWindow.hide();
  } else {
    chatMessagesWindow.show();
    chatMessagesWindow.focus();
  }
}

app.whenReady().then(() => {
  createOverlayWindow();
  
  // Initialize core services including LocalLLMAgent
  initializeServices().then(() => {
    // Verify CoreAgent is properly initialized before setting up IPC handlers
    if (!coreAgent || !coreAgent.initialized) {
      console.log('⚠️ Warning: CoreAgent not fully initialized. Waiting 1 second before setting up IPC handlers...');
      // Add a small delay to ensure CoreAgent is ready
      return new Promise(resolve => setTimeout(() => {
        console.log('🔔 Delayed IPC handler setup. CoreAgent status:', 
          coreAgent ? `initialized=${coreAgent.initialized}` : 'null');
        resolve();
      }, 1000));
    } else {
      console.log('✅ CoreAgent properly initialized, proceeding with IPC handlers setup');
      return Promise.resolve();
    }
  }).then(() => {
    // Setup IPC handlers after CoreAgent is initialized
    setupIPCHandlers();
  }).catch(error => {
    console.error('❌ Error during initialization sequence:', error);
    // Setup IPC handlers anyway to allow basic functionality
    setupIPCHandlers();
  });
  
  // Register global shortcut to show/hide overlay (like Cluely's Cmd+Shift+Space)
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    toggleOverlay();
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

// Initialize new services_new architecture only

async function initializeServices() {
  try {
    // Initialize CoreAgent (AgentOrchestrator) for dynamic agent management
    console.log('🧠 Initializing CoreAgent (AgentOrchestrator)...');
    try {
      // Dynamic import for ES module compatibility
      const { AgentOrchestrator } = await import('./services_new/agents_new/AgentOrchestrator.js');
      
      // Initialize DuckDB for agent memory storage using DatabaseManager
      console.log('🗄️ Initializing DuckDB database for agent memory...');
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
      
      console.log(`📁 Database path: ${dbPath}`);
      
      // Import and initialize DatabaseManager
      const { default: databaseManager } = await import('./services_new/utils/DatabaseManager.js');
      await databaseManager.initialize(dbPath);
      
      console.log('✅ DatabaseManager connection established');
      
      coreAgent = new AgentOrchestrator();
      
      // Initialize the CoreAgent
      await coreAgent.initialize({
        llmClient: null, // Will be set when needed
        database: databaseManager, // Pass the DatabaseManager instance
        apiConfig: {
          baseURL: process.env.BIBSCRIP_BASE_URL || 'http://localhost:3001',
          apiKey: process.env.BIBSCRIP_API_KEY
        }
      });

      console.log('✅ CoreAgent initialized - ready for dynamic agent creation');
    } catch (error) {
      console.error('❌ Failed to initialize CoreAgent:', error);
    }
    
    // Legacy event listeners removed - functionality will be re-implemented using new agent architecture as needed
    
    console.log('✅ All services initialized successfully');
  } catch (error) {
    console.error('❌ Service initialization error:', error);
    // Continue without services for demo mode
  }
}

// Setup IPC handlers using modularized files
function setupIPCHandlers() {
  // Window state object for passing to IPC handlers
  const windowState = {
    isGloballyVisible,
    isOverlayVisible,
    isChatVisible,
    isInsightVisible,
    isMemoryDebuggerVisible,
    isOrchestrationActive,
    visibleWindows
  };

  // Window creators object for passing to IPC handlers
  const windowCreators = {
    createChatMessagesWindow,
    createInsightWindow,
    createMemoryDebuggerWindow,
    toggleOverlay,
    toggleChat
  };
  
  // Windows object for passing to IPC handlers
  const windows = {
    overlayWindow,
    chatWindow,
    chatMessagesWindow,
    insightWindow,
    memoryDebuggerWindow
  };
  
  // Initialize all IPC handlers from modularized files
  const { broadcastOrchestrationUpdate: broadcastUpdate, sendClarificationRequest: sendClarification } = 
    initializeIPCHandlers({
      overlayWindow,
      chatWindow,
      chatMessagesWindow,
      insightWindow,
      memoryDebuggerWindow,
      coreAgent,
      localLLMAgent,
      windowState,
      windowCreators
    });
  
  // Setup memory handlers
  setupMemoryHandlers(ipcMain, coreAgent);
  
  // Initialize screenshot, system health, and legacy LLM handlers
  initializeHandlersPart3({
    ipcMain,
    coreAgent,
    windowState,
    windows
  });
  
  // Setup orchestration workflow handlers
  const { broadcastOrchestrationUpdate: broadcastWorkflowUpdate, sendClarificationRequest: sendWorkflowClarification } = 
    setupOrchestrationWorkflowHandlers(ipcMain, localLLMAgent, windows);
  
  // Store the broadcast and clarification functions for use elsewhere
  global.broadcastOrchestrationUpdate = broadcastWorkflowUpdate || broadcastUpdate;
  global.sendClarificationRequest = sendWorkflowClarification || sendClarification;
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
