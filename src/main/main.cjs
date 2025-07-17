// Entry point for Thinkdrop AI Electron overlay app
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
require('dotenv').config(); // Load .env variables

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

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const windowWidth = width / 2;
  const windowHeight = Math.min(height - 40, 70); // Use almost full height with minimal margin


  overlayWindow = new BrowserWindow({
    width: Math.min(width - 40, 400), // Responsive width with max limit
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
  initializeServices();
  
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
      const { AgentOrchestrator } = await import('./services_new/AgentOrchestrator.js');
      
      // Initialize DuckDB for agent memory storage
      console.log('🗄️ Initializing DuckDB database for agent memory...');
      const duckdb = require('duckdb');
      const path = require('path');
      const projectRoot = path.dirname(path.dirname(__dirname)); // Go up from src/main to project root
      const dbPath = path.join(projectRoot, 'data', 'agent_memory.duckdb');
      
      console.log(`📁 Database path: ${dbPath}`);
      
      // Create a new database connection
      const db = new duckdb.Database(dbPath);
      const database = db.connect();
      
      console.log('✅ DuckDB connection established');
      
      coreAgent = new AgentOrchestrator({
        llmClient: null, // Will be set when needed
        database: database, // Pass the initialized database
        logger: console,
        apiConfig: {
          baseURL: process.env.BIBSCRIP_BASE_URL || 'http://localhost:3001',
          apiKey: process.env.BIBSCRIP_API_KEY
        }
      });
      
      // Initialize the CoreAgent
      await coreAgent.initialize();

      
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

// IPC handlers for overlay control
ipcMain.handle('toggle-overlay', () => {
  toggleOverlay();
});

ipcMain.handle('hide-overlay', () => {
  if (overlayWindow) {
    overlayWindow.hide();
    isOverlayVisible = false;
  }
});

ipcMain.handle('show-overlay', () => {
  if (overlayWindow) {
    overlayWindow.show();
    overlayWindow.focus();
    isOverlayVisible = true;
    isGloballyVisible = true;
  }
});

ipcMain.handle('hide-all-windows', () => {
  // Hide all ThinkDrop AI windows
  if (overlayWindow) {
    overlayWindow.hide();
  }
  if (chatWindow) {
    chatWindow.hide();
  }
  if (chatMessagesWindow) {
    chatMessagesWindow.hide();
  }
  if (insightWindow && !global.isOrchestrationActive) {
    insightWindow.hide();
    visibleWindows.push('insightWindow');
  } else if (insightWindow && global.isOrchestrationActive) {
    console.log('🛡️ Protecting insight window during orchestration - not hiding in hide-all-windows');
  }
  if (memoryDebuggerWindow) {
    console.log('🔍 hide-all-windows hiding Memory Debugger');
    memoryDebuggerWindow.hide();
  }
  isOverlayVisible = false;
  isChatVisible = false;
  isInsightVisible = false;
  isMemoryDebuggerVisible = false;
  isGloballyVisible = false;
});

ipcMain.handle('show-all-windows', () => {
  // Show overlay window (chat windows will be shown when needed)
  if (overlayWindow) {
    overlayWindow.show();
    overlayWindow.focus();
    isOverlayVisible = true;
    isGloballyVisible = true;
  }
  // Restore previously visible windows
  if (visibleWindows.includes('insightWindow') && insightWindow) {
    insightWindow.show();
    insightWindow.focus();
    isInsightVisible = true;
    visibleWindows = visibleWindows.filter((window) => window !== 'insightWindow');
  }
  if (visibleWindows.includes('chatWindow') && chatWindow) {
    chatWindow.show();
    isChatVisible = true;
    visibleWindows = visibleWindows.filter((window) => window !== 'chatWindow');
  }
  if (visibleWindows.includes('chatMessagesWindow') && chatMessagesWindow) {
    chatMessagesWindow.show();
    visibleWindows = visibleWindows.filter((window) => window !== 'chatMessagesWindow');
  }
  if (visibleWindows.includes('memoryDebuggerWindow') && memoryDebuggerWindow) {
    memoryDebuggerWindow.show();
    isMemoryDebuggerVisible = true;
    visibleWindows = visibleWindows.filter((window) => window !== 'memoryDebuggerWindow');
  }
});

ipcMain.handle('get-global-visibility', () => {
  return isGloballyVisible;
});

// IPC handlers for chat window control
ipcMain.handle('toggle-chat', () => {
  toggleChat();
});

ipcMain.handle('show-chat', () => {
  // Redirect to unified ChatMessages window
  if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
    createChatMessagesWindow();
  } else {
    chatMessagesWindow.show();
    chatMessagesWindow.focus();
  }
});

ipcMain.handle('hide-chat', () => {
  // Redirect to unified ChatMessages window
  if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
    chatMessagesWindow.hide();
    visibleWindows = visibleWindows.filter((window) => window !== 'chatMessagesWindow');
  }
});

// IPC handlers for insight window control
ipcMain.handle('show-insight', () => {
  if (!insightWindow) {
    createInsightWindow();
  } else {
    insightWindow.show();
    insightWindow.focus();
    isInsightVisible = true;
    visibleWindows.push('insightWindow');
  }
});

ipcMain.handle('hide-insight', () => {
  if (insightWindow) {
    insightWindow.hide();
    isInsightVisible = false;
    visibleWindows = visibleWindows.filter((window) => window !== 'insightWindow');
  }
});

ipcMain.handle('show-chat-messages', () => {
  // Ensure only one chat messages window exists
  if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
    chatMessagesWindow.show();
    chatMessagesWindow.focus();
    return;
  }
  
  // Create new window if needed
  if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
    createChatMessagesWindow();
  }
  
  // Show the chat messages window
  chatMessagesWindow.show();
  chatMessagesWindow.focus();
  visibleWindows.push('chatMessagesWindow');
});

ipcMain.handle('hide-chat-messages', () => {
  if (chatMessagesWindow) {
    chatMessagesWindow.hide();
    visibleWindows = visibleWindows.filter((window) => window !== 'chatMessagesWindow');
  }
});

// IPC handlers for memory debugger window control
ipcMain.handle('show-memory-debugger', () => {
  // Ensure only one memory debugger window exists
  if (memoryDebuggerWindow && !memoryDebuggerWindow.isDestroyed()) {
    memoryDebuggerWindow.show();
    memoryDebuggerWindow.focus();
    return;
  }
  
  // Create new window if needed
  if (!memoryDebuggerWindow || memoryDebuggerWindow.isDestroyed()) {
    createMemoryDebuggerWindow();
  }
  
  // Show the memory debugger window
  console.log('🔍 Showing Memory Debugger window');
  memoryDebuggerWindow.show();
  memoryDebuggerWindow.focus();
  visibleWindows.push('memoryDebuggerWindow');
});

ipcMain.handle('hide-memory-debugger', () => {
  console.log('🔍 hide-memory-debugger IPC called');
  if (memoryDebuggerWindow) {
    memoryDebuggerWindow.hide();
    visibleWindows = visibleWindows.filter((window) => window !== 'memoryDebuggerWindow');
  }
});

// IPC handlers for chat messaging system
ipcMain.handle('send-chat-message', async (event, message) => {
  // Ensure only one chat messages window exists
  if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
    createChatMessagesWindow();
  }
  
  // Show the chat messages window
  chatMessagesWindow.show();
  chatMessagesWindow.focus();
  
  // Send the user message to the chat messages window
  const userMessage = {
    id: Date.now().toString(),
    text: message.text,
    sender: 'user',
    timestamp: message.timestamp
  };
  
  chatMessagesWindow.webContents.send('chat-message', userMessage);
  
  // Local LLM orchestration temporarily disabled - using WebSocket streaming only
  console.log('📡 WebSocket streaming mode active - local LLM orchestration disabled');
  
  // Note: WebSocket streaming responses are handled directly in ChatMessages.tsx
  // The frontend WebSocket integration will handle all AI responses via streaming
});

ipcMain.handle('adjust-chat-messages-height', (event, height) => {
  if (chatMessagesWindow) {
    const currentBounds = chatMessagesWindow.getBounds();
    chatMessagesWindow.setBounds({
      ...currentBounds,
      height: Math.max(height, 100) // Minimum height of 100px
    });
  }
});

// Focus management between chat windows
ipcMain.handle('focus-chat-input', () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    chatWindow.webContents.focus();
  }
});

ipcMain.handle('notify-message-loaded', () => {
  // Notify chat input window that a message was loaded
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('message-loaded');
  }
  
  // Optionally blur the chat messages window
  if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
    chatMessagesWindow.blur();
  }
});

// ========================================
// IPC HANDLERS FOR DYNAMIC AGENT OPERATIONS
// ========================================

// Unified IPC handler for all agent operations (Memory, InsightView, Messages, etc.)
// Routes through AgentOrchestrator.ask() for unified agent execution
ipcMain.handle('agent-orchestrate', async (event, intentPayload) => {
  try {
    if (!coreAgent || !coreAgent.isInitialized) {
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    console.log('🎯 Unified agent orchestration received:', intentPayload);
    
    // Route all requests through AgentOrchestrator.ask()
    // AgentOrchestrator will handle:
    // 1. Agent validation and security checks
    // 2. Intent routing via switch statement (greeting, memory_store, command, question)
    // 3. Agent execution and result return
    const result = await coreAgent.ask(intentPayload);
    
    console.log('✅ Unified agent orchestration completed:', result);
    return { success: true, data: result };
  } catch (error) {
    console.error('❌ Unified agent orchestration error:', error);
    return { success: false, error: error.message };
  }
});

// Note: Legacy handlers above provide compatibility layer for existing UI components
// TODO: Migrate all UI components to use unified agent-orchestrate handler

// Note: Removed specific workflow handlers - CoreAgent handles all scenarios dynamically
// The "Give me a response to this email" scenario is handled through:
// 1. User message → agent-orchestrate → CoreAgent.ask()
// 2. CoreAgent dynamically determines needed agents (ScreenCapture, Memory, etc.)
// 3. Results flow to WebSocket streaming for ChatMessage/InsightView display

// Legacy IPC handlers removed - functionality will be re-implemented using new agent architecture as needed

// Legacy screenshot IPC handlers removed - functionality available through agent-screenshot handler using new agent architecture

// Direct memory query handler for fast MemoryDebugger access (bypasses agent orchestration)
ipcMain.handle('query-memories-direct', async (event, options = {}) => {
  try {
    console.log('🔍 Direct memory query received:', options);
    const { limit = 50, offset = 0, searchQuery = null } = options;
    
    // Check if coreAgent is initialized
    if (!coreAgent) {
      console.log('❌ CoreAgent is null');
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    if (!coreAgent.isInitialized) {
      console.log('❌ CoreAgent not initialized');
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    console.log('✅ CoreAgent available and initialized');
    
    // Try to get database connection directly from coreAgent
    let db = null;
    
    // First try to get database from coreAgent directly
    if (coreAgent.database) {
      db = coreAgent.database;
      console.log('✅ Using database from coreAgent.database');
    } else if (coreAgent.orchestrator && coreAgent.orchestrator.db) {
      db = coreAgent.orchestrator.db;
      console.log('✅ Using database from coreAgent.orchestrator.db');
    } else {
      console.log('❌ No database connection found in coreAgent');
      console.log('CoreAgent keys:', Object.keys(coreAgent));
      if (coreAgent.orchestrator) {
        console.log('Orchestrator keys:', Object.keys(coreAgent.orchestrator));
      }
      return { success: false, error: 'Database connection not available' };
    }
    
    // Check available tables first (DuckDB syntax)
    try {
      const tables = await new Promise((resolve, reject) => {
        db.all("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'", (err, rows) => {
          if (err) {
            // Fallback to SHOW TABLES for DuckDB
            db.all("SHOW TABLES", (err2, rows2) => {
              if (err2) reject(err2);
              else resolve(rows2 || []);
            });
          } else {
            resolve(rows || []);
          }
        });
      });
      console.log('📋 Available tables:', tables);
    } catch (err) {
      console.log('⚠️ Could not list tables:', err.message);
    }
    
    // Use the table that we know exists
    const tableName = 'memory';
    console.log(`✅ Using table: ${tableName}`);
    
    // Build queries - DuckDB compatible with correct column names
    const query = searchQuery 
      ? `SELECT * FROM ${tableName} WHERE (source_text LIKE '%${searchQuery}%' OR suggested_response LIKE '%${searchQuery}%' OR backend_memory_id LIKE '%${searchQuery}%') ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
      : `SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    
    const countQuery = searchQuery
      ? `SELECT COUNT(*) as total FROM ${tableName} WHERE (source_text LIKE '%${searchQuery}%' OR suggested_response LIKE '%${searchQuery}%' OR backend_memory_id LIKE '%${searchQuery}%')`
      : `SELECT COUNT(*) as total FROM ${tableName}`;
    
    console.log('🔍 Executing query:', query);
    
    // Execute queries with DuckDB async API
    const memories = await new Promise((resolve, reject) => {
      db.all(query, (err, rows) => {
        if (err) {
          console.error('❌ Query error:', err);
          reject(err);
        } else {
          console.log(`✅ Query returned ${rows ? rows.length : 0} rows`);
          resolve(rows || []);
        }
      });
    });
    
    const countResult = await new Promise((resolve, reject) => {
      db.all(countQuery, (err, rows) => {
        if (err) {
          console.error('❌ Count query error:', err);
          reject(err);
        } else {
          const total = rows && rows[0] ? rows[0].total : 0;
          resolve({ total });
        }
      });
    });
    
    const total = countResult?.total || 0;
    
    console.log(`📊 Direct memory query: ${memories.length} memories loaded (${offset}-${offset + memories.length} of ${total})`);
    
    return {
      success: true,
      data: {
        memories,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + memories.length < total
        }
      }
    };
  } catch (error) {
    console.error('❌ Direct memory query error:', error);
    return { success: false, error: error.message };
  }
});

// Direct memory delete handler for fast MemoryDebugger delete operations
ipcMain.handle('delete-memory-direct', async (event, memoryId) => {
  try {
    console.log('🗑️ Direct memory delete requested for ID:', memoryId);
    
    // Check if coreAgent is initialized
    if (!coreAgent || !coreAgent.isInitialized) {
      console.log('❌ CoreAgent not initialized for delete operation');
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    // Get database connection
    let db = null;
    if (coreAgent.database) {
      db = coreAgent.database;
      console.log('🔗 Delete using coreAgent.database connection');
      console.log('🔍 Database connection object:', typeof db, db.constructor?.name);
    } else if (coreAgent.orchestrator && coreAgent.orchestrator.db) {
      db = coreAgent.orchestrator.db;
      console.log('🔗 Delete using coreAgent.orchestrator.db connection');
      console.log('🔍 Database connection object:', typeof db, db.constructor?.name);
    } else {
      console.log('❌ No database connection found for delete operation');
      return { success: false, error: 'Database connection not available' };
    }
    
    // Test database connection with a simple query first
    try {
      const testQuery = 'SELECT 1 as test';
      const testResult = await db.all(testQuery);
      console.log('🔍 Database connection test successful:', testResult);
    } catch (testError) {
      console.error('❌ Database connection test failed:', testError.message);
      return { success: false, error: 'Database connection not working' };
    }
    
    // First, verify the specific record exists before delete
    const recordExistsQuery = `SELECT backend_memory_id, source_text FROM memory WHERE backend_memory_id = ? LIMIT 1`;
    const recordBefore = await db.all(recordExistsQuery, [memoryId]);
    console.log('🔍 Record before delete:', recordBefore.length > 0 ? 'EXISTS' : 'NOT FOUND');
    if (recordBefore.length > 0) {
      console.log('📝 Record details:', { id: recordBefore[0].backend_memory_id, text: recordBefore[0].source_text?.substring(0, 50) + '...' });
    } else {
      console.log('⚠️ WARNING: Record to delete does not exist in database!');
      return { success: false, error: 'Record not found in database' };
    }
    
    // Check total count before delete
    const countBeforeQuery = `SELECT COUNT(*) as total FROM memory`;
    const countBefore = await db.all(countBeforeQuery);
    console.log('📊 Count query result:', countBefore);
    const totalBefore = countBefore && countBefore[0] ? Number(countBefore[0].total) : 0;
    console.log('📊 Total records before delete:', totalBefore);
    
    // Delete from memory table using the correct ID column
    const deleteQuery = `DELETE FROM memory WHERE backend_memory_id = ?`;
    console.log('🔍 Executing delete query:', deleteQuery, 'with ID:', memoryId);
    
    // Use DuckDB's async API for delete operations
    const result = await db.all(deleteQuery, [memoryId]);
    console.log('🔍 Delete query result:', result);
    
    // Try to commit the transaction explicitly (DuckDB might need this)
    try {
      await db.all('COMMIT;');
      console.log('🔍 Transaction committed');
    } catch (commitErr) {
      console.log('🔍 No explicit transaction to commit (auto-commit mode)');
    }
    
    // Add a small delay to ensure the delete is fully processed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check total count after delete
    const countAfterQuery = `SELECT COUNT(*) as total FROM memory`;
    const countAfter = await db.all(countAfterQuery);
    const totalAfter = countAfter && countAfter[0] ? Number(countAfter[0].total) : 0;
    console.log('📊 Total records after delete:', totalAfter);
    
    // For DuckDB DELETE operations, we need to check if the operation succeeded
    // by querying if the record still exists
    const checkQuery = `SELECT COUNT(*) as count FROM memory WHERE backend_memory_id = ?`;
    const checkResult = await db.all(checkQuery, [memoryId]);
    const recordExists = checkResult && checkResult[0] ? Number(checkResult[0].count) > 0 : false;
    
    console.log(`🔍 Record check after delete - exists: ${recordExists}`);
    console.log(`📊 Records deleted: ${totalBefore - totalAfter}`);
    console.log(`📊 Remaining records: ${totalAfter}`);
    
    // Show which record was actually deleted for debugging
    if (!recordExists && totalBefore > totalAfter) {
      console.log(`✅ Confirmed: Memory ${memoryId} was successfully deleted from database`);
    }
    
    const deletedCount = recordExists ? 0 : 1; // If record doesn't exist, it was deleted
    
    if (deletedCount > 0) {
      console.log(`✅ Successfully deleted memory with ID: ${memoryId}`);
      return { success: true, deletedCount: deletedCount };
    } else {
      console.log(`⚠️ No memory found with ID: ${memoryId}`);
      return { success: false, error: 'Memory not found' };
    }
    
  } catch (error) {
    console.error('❌ Direct memory delete error:', error);
    return { success: false, error: error.message };
  }
});

// Legacy agent processing IPC handler removed - functionality available through new agent architecture

// Open screenshot window
ipcMain.handle('open-screenshot-window', async (event, imageData) => {
  const { screen } = require('electron');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  // Calculate window size - make it large enough to show the screenshot clearly
  const windowWidth = Math.min(screenWidth * 0.8, 1200); // 80% of screen width, max 1200px
  const windowHeight = Math.min(screenHeight * 0.8, 900); // 80% of screen height, max 900px
  
  // Position at the center-top of the screen
  const x = Math.floor((screenWidth - windowWidth) / 2);
  const y = 20; // 20px from the top
  
  const screenshotWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,                                                                                                                    
    alwaysOnTop: true,
    frame: false,  // Chromeless window
    transparent: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,  // Don't show in taskbar
    webPreferences: {
      webSecurity: false,  // Allow file:// URLs
      nodeIntegration: false,
      contextIsolation: true,
      allowRunningInsecureContent: true  // Allow local file access
    }
  });
  
  try {
    // Create a temporary file for the screenshot to avoid URL length limits
    const tempDir = os.tmpdir();
    const tempFileName = `screenshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
    const tempFilePath = path.join(tempDir, tempFileName);
    
    let imageBuffer;
    
    if (typeof imageData === 'string') {
      // Extract base64 data from data URL if present
      const base64Data = imageData.startsWith('data:') 
        ? imageData.split(',')[1] 
        : imageData;
      
      console.log('Screenshot window - extracted base64 length:', base64Data.length);
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (imageData instanceof Uint8Array || Array.isArray(imageData)) {
      imageBuffer = Buffer.from(imageData);
    } else {
      throw new Error('Unsupported image data type');
    }
    
    // Write the image buffer to temporary file
    fs.writeFileSync(tempFilePath, imageBuffer);
    console.log('Screenshot window - wrote temp file:', tempFilePath);
    
    // Use file:// URL instead of data URL to avoid length limits
    const fileUrl = `file://${tempFilePath}`;
    const imageUrl = fileUrl;
    console.log('Screenshot window - using file URL:', imageUrl);
    
    // Create HTML content with file URL
    const htmlContent = `
      <html>
        <head>
          <title>Memory Snapshot</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #0a0a0a;
              color: white;
              overflow: hidden;
              height: 100vh;
              display: flex;
              flex-direction: column;
            }
            .header {
              background: rgba(20, 20, 20, 0.95);
              padding: 8px 16px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              backdrop-filter: blur(10px);
              -webkit-app-region: drag;
            }
            .title {
              font-size: 14px;
              font-weight: 500;
              color: #e0e0e0;
            }
            .close-btn {
              background: rgba(255, 59, 48, 0.8);
              border: none;
              border-radius: 50%;
              width: 20px;
              height: 20px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 12px;
              color: white;
              transition: background 0.2s;
              -webkit-app-region: no-drag;
            }
            .close-btn:hover {
              background: rgba(255, 59, 48, 1);
            }
            .image-container {
              flex: 1;
              display: flex;
              justify-content: center;
              align-items: center;
              padding: 16px;
              background: #0a0a0a;
            }
            img { 
              max-width: 100%; 
              max-height: 100%; 
              object-fit: contain;
              border-radius: 8px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">Memory Snapshot</div>
            <button class="close-btn" onclick="window.close()" title="Close">×</button>
          </div>
          <div class="image-container">
            <img src="${imageUrl}" alt="Memory Snapshot" 
                 onload="console.log('✅ Image loaded successfully', this.naturalWidth, 'x', this.naturalHeight)" 
                 onerror="console.error('❌ Image failed to load', this.src)" />
          </div>
          <script>
            console.log('🔍 Screenshot window HTML loaded');
            console.log('🔍 Image src:', '${imageUrl}');
            console.log('🔍 Image src length:', '${imageUrl}'.length);
            
            // Test file access
            const img = document.querySelector('img');
            if (img) {
              img.onload = function() {
                console.log('✅ Image loaded successfully:', this.naturalWidth, 'x', this.naturalHeight);
              };
              img.onerror = function(e) {
                console.error('❌ Image failed to load:', e);
                console.error('❌ Image src:', this.src);
                console.error('❌ Error details:', e.type, e.message);
              };
            }
            
            // Test if file exists by trying to fetch it
            fetch('${imageUrl}')
              .then(response => {
                console.log('🔍 Fetch response:', response.status, response.statusText);
                return response.blob();
              })
              .then(blob => {
                console.log('🔍 File blob size:', blob.size, 'bytes');
                console.log('🔍 File blob type:', blob.type);
              })
              .catch(err => {
                console.error('❌ Fetch failed:', err);
              });
            
            // Add click handler to close window
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                window.close();
              }
            });
            
            // Clean up temp file when window closes
            window.addEventListener('beforeunload', () => {
              // Note: We'll clean up the temp file in the main process
            });
          </script>
        </body>
      </html>
    `;
    // Load the HTML content
    screenshotWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))
      .catch(error => {
        console.error('Failed to load screenshot window with data URL, trying alternative method:', error);
        
        // Alternative: use webContents.loadURL with a simpler approach
        const simpleHtml = `
          <html>
            <head>
              <title>Memory Screenshot</title>
              <style>
                body { margin: 0; background: #0a0a0a; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
                img { max-width: 100%; max-height: 100%; object-fit: contain; }
              </style>
            </head>
            <body>
              <img src="${imageUrl}" alt="Screenshot" onload="console.log('Image loaded')" onerror="console.error('Image failed')" />
            </body>
          </html>
        `;
        
        return screenshotWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(simpleHtml));
      });
    
    // Add error handling for the window
    screenshotWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Screenshot window failed to load:', errorCode, errorDescription);
    });
    
    screenshotWindow.webContents.on('did-finish-load', () => {
      console.log('Screenshot window loaded successfully');
    });
    
    // Clean up temp file when window is closed
    screenshotWindow.on('closed', () => {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log('Screenshot window - cleaned up temp file:', tempFilePath);
        }
      } catch (err) {
        console.error('Screenshot window - failed to clean up temp file:', err);
      }
    });
    
    // Don't auto-open DevTools in production
    // screenshotWindow.webContents.openDevTools();
    
    console.log('Screenshot window - returning success: true');
    return { success: true };
    
  } catch (error) {
    console.error('Screenshot window - error:', error);
    return { success: false, error: error.message };
  }
});

// System health check
ipcMain.handle('get-system-health', async () => {
  const health = {
    coreAgent: coreAgent ? (coreAgent.isInitialized ? 'ready' : 'initializing') : 'not_available',
    windows: {
      overlay: isOverlayVisible,
      chat: isChatVisible,
      insight: isInsightVisible,
      memoryDebugger: isMemoryDebuggerVisible
    }
  };
  
  return health;
});

// Legacy LLM health check - routes to unified agent system
ipcMain.handle('llm-get-health', async () => {
  try {
    // Return health status compatible with legacy LocalLLMContext expectations
    const health = {
      status: coreAgent && coreAgent.isInitialized ? 'ready' : 'initializing',
      agents: coreAgent ? Object.keys(coreAgent.agents || {}).length : 0,
      database: coreAgent && coreAgent.database ? 'connected' : 'disconnected',
      lastActivity: new Date().toISOString()
    };
    
    return { success: true, data: health };
  } catch (error) {
    console.error('❌ LLM health check error:', error);
    return { success: false, error: error.message };
  }
});

// Legacy LocalLLMAgent IPC handlers - minimal compatibility layer for existing UI components
// TODO: Migrate LocalLLMContext to use unified agent-orchestrate handler

// Legacy LLM query handler - routes to unified agent system
ipcMain.handle('llm-query-local', async (event, prompt, options = {}) => {
  try {
    if (!coreAgent || !coreAgent.isInitialized) {
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    // Route legacy LLM queries through unified agent orchestration
    const intentPayload = {
      type: 'question',
      message: prompt,
      options,
      source: 'legacy_llm'
    };
    
    const result = await coreAgent.ask(intentPayload);
    return { success: true, data: result };
  } catch (error) {
    console.error('❌ Legacy LLM query error:', error);
    return { success: false, error: error.message };
  }
});

// Legacy LLM orchestration handler - routes to unified agent system
ipcMain.handle('llm-orchestrate', async (event, userInput, context = {}) => {
  try {
    if (!coreAgent || !coreAgent.isInitialized) {
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    // Route legacy orchestration through unified agent orchestration
    const intentPayload = {
      type: 'command',
      message: userInput,
      context,
      source: 'legacy_orchestration'
    };
    
    const result = await coreAgent.ask(intentPayload);
    return { success: true, data: result };
  } catch (error) {
    console.error('❌ Legacy LLM orchestration error:', error);
    return { success: false, error: error.message };
  }
});

// Legacy cached agents handler - returns empty for now
ipcMain.handle('llm-get-cached-agents', async () => {
  return { success: true, data: [] };
});

// Legacy communications handler - returns empty for now
ipcMain.handle('llm-get-communications', async (event, limit = 10) => {
  return { success: true, data: [] };
});

// Legacy cache clear handler - no-op for now
ipcMain.handle('llm-clear-cache', async () => {
  return { success: true, data: { cleared: true } };
});

// Legacy local LLM health handler - routes to unified system
ipcMain.handle('local-llm:health', async () => {
  try {
    const health = {
      status: coreAgent && coreAgent.isInitialized ? 'ready' : 'initializing',
      agents: coreAgent ? Object.keys(coreAgent.agents || {}).length : 0
    };
    return { success: true, data: health };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Legacy local LLM message processing - routes to unified system
ipcMain.handle('local-llm:process-message', async (event, message) => {
  try {
    if (!coreAgent || !coreAgent.isInitialized) {
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    const intentPayload = {
      type: 'greeting',
      message,
      source: 'legacy_local_llm'
    };
    
    const result = await coreAgent.ask(intentPayload);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Orchestration workflow IPC handlers
ipcMain.handle('submit-clarification-response', async (event, stepId, response) => {
  try {
    console.log(`Submitting clarification response for step ${stepId}:`, response);
    
    // Here we would integrate with the orchestration system to submit the clarification response
    // For now, we'll simulate the response handling
    
    // In a real implementation, this would:
    // 1. Find the workflow step by stepId
    // 2. Submit the clarification response to the orchestration engine
    // 3. Resume the workflow execution
    // 4. Send updates back to the frontend
    
    // Simulate successful submission
    const result = {
      success: true,
      stepId: stepId,
      response: response,
      timestamp: new Date().toISOString()
    };
    
    // Send orchestration update to all renderer processes
    if (insightWindow && !insightWindow.isDestroyed()) {
      insightWindow.webContents.send('orchestration-update', {
        type: 'clarification_submitted',
        stepId: stepId,
        response: response,
        timestamp: result.timestamp
      });
    }
    
    return result;
  } catch (error) {
    console.error('Error submitting clarification response:', error);
    return {
      success: false,
      error: error.message,
      stepId: stepId
    };
  }
});

// Function to broadcast orchestration updates to all windows
function broadcastOrchestrationUpdate(updateData) {
  const windows = [overlayWindow, chatWindow, chatMessagesWindow, insightWindow, memoryDebuggerWindow];
  
  windows.forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('orchestration-update', updateData);
    }
  });
}

// Function to send clarification requests to the frontend
function sendClarificationRequest(clarificationData) {
  const windows = [overlayWindow, insightWindow];
  
  windows.forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('clarification-request', clarificationData);
    }
  });
}

// Additional orchestration workflow IPC handlers
ipcMain.handle('start-orchestration-workflow', async (event, userInput, context = {}) => {
  try {
    console.log('Starting orchestration workflow for:', userInput);
    
    if (!localLLMAgent) {
      throw new Error('LocalLLMAgent not initialized');
    }
    
    // Start orchestration workflow through LocalLLMAgent
    const workflowResult = await localLLMAgent.orchestrateWorkflow(userInput, context);
    
    // Broadcast initial workflow state to frontend
    broadcastOrchestrationUpdate({
      type: 'workflow_started',
      workflow: workflowResult,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      workflow: workflowResult
    };
  } catch (error) {
    console.error('Error starting orchestration workflow:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-orchestration-status', async (event, workflowId) => {
  try {
    if (!localLLMAgent) {
      throw new Error('LocalLLMAgent not initialized');
    }
    
    // Get current workflow status from LocalLLMAgent
    const status = await localLLMAgent.getWorkflowStatus(workflowId);
    
    return {
      success: true,
      status: status
    };
  } catch (error) {
    console.error('Error getting orchestration status:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('pause-orchestration-workflow', async (event, workflowId) => {
  try {
    if (!localLLMAgent) {
      throw new Error('LocalLLMAgent not initialized');
    }
    
    const result = await localLLMAgent.pauseWorkflow(workflowId);
    
    broadcastOrchestrationUpdate({
      type: 'workflow_paused',
      workflowId: workflowId,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      result: result
    };
  } catch (error) {
    console.error('Error pausing orchestration workflow:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('resume-orchestration-workflow', async (event, workflowId) => {
  try {
    if (!localLLMAgent) {
      throw new Error('LocalLLMAgent not initialized');
    }
    
    const result = await localLLMAgent.resumeWorkflow(workflowId);
    
    broadcastOrchestrationUpdate({
      type: 'workflow_resumed',
      workflowId: workflowId,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: true,
      result: result
    };
  } catch (error) {
    console.error('Error resuming orchestration workflow:', error);
    return {
      success: false,
      error: error.message
    };
  }
});
