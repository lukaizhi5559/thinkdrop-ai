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

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Create a unified window that can expand to show different content
  // Smaller width positioned to upper-right corner as requested
  const windowWidth = Math.min(350, width * 0.3); // 30% of screen width, max 400px (half the previous size)
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
  
  // Initialize all IPC handlers from modularized files
  const { broadcastOrchestrationUpdate: broadcastUpdate, sendClarificationRequest: sendClarification } = 
    initializeIPCHandlers({
      overlayWindow,
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
