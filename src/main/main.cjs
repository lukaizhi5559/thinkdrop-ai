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
  
  overlayWindow = new BrowserWindow({
    width: Math.min(width - 40, 400), // Responsive width with max limit
    height: 80, // Proper height for toolbar with padding
    minHeight: 80, // Minimum height for toolbar
    x: 5, // Small margin from left
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

function createChatWindow() {
  if (chatWindow) {
    chatWindow.show();
    chatWindow.focus();
    isChatVisible = true;
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  chatWindow = new BrowserWindow({
    width: Math.min(width - 80, 800), // Max width 800px with margins
    height: Math.min(height - 40, 95),
    x: Math.floor((width - Math.min(width - 80, 800)) / 2), // Center horizontally
    y: height - 120, // Position at bottom with margin
    frame: false, // Remove window frame completely
    transparent: true, // Transparent background
    alwaysOnTop: true, // Always stay on top
    skipTaskbar: true, // Don't show in taskbar
    resizable: false,
    movable: true, // Ensure window is movable
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
  chatWindow.setAlwaysOnTop(true, 'floating', 1);
  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Load the same app but with a chat parameter
  const chatUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173?mode=chat'
    : `file://${path.join(__dirname, '../../dist-renderer/index.html')}?mode=chat`;
  
  chatWindow.loadURL(chatUrl);
  
  // Hide window instead of closing 
  chatWindow.on('close', (event) => {
    if (chatWindow && !app.isQuiting) {
      event.preventDefault();
      chatWindow.hide();
      isChatVisible = false;
    }
  });

  isChatVisible = true;
}

// Create chat messages window (floating window for displaying messages)
function createChatMessagesWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const windowWidth = Math.min(width - 40, 500);
  const windowHeight = height - 10; // Use almost full height with minimal margin

  const x = width - windowWidth - 10; // 10px margin from right
  const y = 5; // 5px margin from top for minimal constraint
  
  chatMessagesWindow = new BrowserWindow({
    width: windowWidth, // Responsive width  
    height: windowHeight, // Use calculated full height
    minHeight: windowHeight, // Minimum height to show header + some messages
    x: x, // Position from right edge
    y: y, // Position from top with minimal margin
    frame: false,
    transparent: true,
    // alwaysOnTop: true,
    alwaysOnBottom: true,
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
  chatMessagesWindow.setAlwaysOnTop(true, 'floating', 1);
  chatMessagesWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
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
  globalShortcut.register('CommandOrControl+Q', () => {
    app.isQuiting = true;
    app.quit();
  });
  
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
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'agent_memory.duckdb');
      
      console.log(`📁 Database path: ${dbPath}`);
      
      // Create a new database connection
      const db = new duckdb.Database(dbPath);
      const database = new duckdb.Connection(db);
      
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
  memoryDebuggerWindow.show();
  memoryDebuggerWindow.focus();
  visibleWindows.push('memoryDebuggerWindow');
});

ipcMain.handle('hide-memory-debugger', () => {
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
// Routes through AgentOrchestrator.ask() with AgentSandbox validation for non-default agents
ipcMain.handle('agent-orchestrate', async (event, intentPayload) => {
  try {
    if (!coreAgent || !coreAgent.isInitialized) {
      return { success: false, error: 'CoreAgent not initialized' };
    }
    
    console.log('🎯 Unified agent orchestration received:', intentPayload);
    
    // Route all requests through AgentOrchestrator.ask()
    // AgentOrchestrator will handle:
    // 1. AgentSandbox validation for non-default agents
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

// Legacy agent processing IPC handler removed - functionality available through new agent architecture

// Open screenshot window
ipcMain.handle('open-screenshot-window', async (event, imageData) => {
  const screenshotWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: true,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  // Convert the image data to a proper format
  let htmlContent;
  let imageUrl;
  
  console.log('Screenshot window - data type:', typeof imageData);
  console.log('Screenshot window - is array:', Array.isArray(imageData));
  console.log('Screenshot window - first few bytes:', imageData?.slice ? imageData.slice(0, 20) : 'N/A');
  
  if (typeof imageData === 'string') {
    // Already base64 or data URL
    imageUrl = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`;
  } else if (imageData instanceof Uint8Array || Array.isArray(imageData)) {
    // Convert to Buffer for easier handling
    const buffer = Buffer.from(imageData);
    
    // Check if it looks like a PNG/JPEG header (binary image data)
    const isPNG = buffer.length > 8 && 
                  buffer[0] === 0x89 && buffer[1] === 0x50 && 
                  buffer[2] === 0x4E && buffer[3] === 0x47;
    const isJPEG = buffer.length > 3 && 
                   buffer[0] === 0xFF && buffer[1] === 0xD8 && 
                   buffer[2] === 0xFF;
    
    if (isPNG || isJPEG) {
      // It's binary image data
      console.log('Detected binary image data (PNG/JPEG)');
      const base64 = buffer.toString('base64');
      imageUrl = `data:image/${isPNG ? 'png' : 'jpeg'};base64,${base64}`;
    } else {
      // Try to interpret as string
      try {
        const possibleString = buffer.toString('utf8');
        
        // Check if it's a data URL string
        if (possibleString.startsWith('data:image')) {
          console.log('Detected data URL string in buffer');
          imageUrl = possibleString;
        } else if (possibleString.match(/^[A-Za-z0-9+/]+=*$/)) {
          // Looks like base64
          console.log('Detected base64 string in buffer');
          imageUrl = `data:image/png;base64,${possibleString}`;
        } else {
          // Unknown format, treat as binary
          console.log('Unknown format, treating as binary');
          const base64 = buffer.toString('base64');
          imageUrl = `data:image/png;base64,${base64}`;
        }
      } catch (err) {
        // If string conversion fails, treat as binary
        console.log('String conversion failed, treating as binary');
        const base64 = buffer.toString('base64');
        imageUrl = `data:image/png;base64,${base64}`;
      }
    }
  } else {
    console.error('Unknown screenshot data type:', typeof imageData);
    return { success: false, error: 'Invalid image data type' };
  }
  
  htmlContent = `
    <html>
      <head>
        <title>Memory Screenshot</title>
        <style>
          body { 
            margin: 0; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            background: #1a1a1a; 
          }
          img { 
            max-width: 100%; 
            max-height: 100%; 
            object-fit: contain; 
          }
        </style>
      </head>
      <body>
        <img src="${imageUrl}" alt="Memory Screenshot" />
      </body>
    </html>
  `;
  
  screenshotWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  
  return { success: true };
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
