// Entry point for Thinkdrop AI Electron overlay app
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
require('dotenv').config(); // Load .env variables

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

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  overlayWindow = new BrowserWindow({
    width: Math.min(width - 40, 400), // Responsive width with max limit
    height: 80, // Proper height for toolbar with padding
    minHeight: 80, // Minimum height for toolbar
    x: 20, // Small margin from left
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
  
  chatMessagesWindow = new BrowserWindow({
    width: Math.min(width - 40, 500), // Responsive width  
    height: Math.min(height - 40, 400), // Increased initial height for better usability
    minHeight: 250, // Minimum height to show header + some messages
    maxHeight: Math.min(height - 40, 600), // Maximum height
    x: Math.floor((width - 500) / 2), // Center horizontally
    y: Math.floor(height * 0.2), // Position higher on screen
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
  
  memoryDebuggerWindow = new BrowserWindow({
    width: Math.min(width - 40, 400), // Compact width for debugging interface
    height: Math.min(height - 40, 600), // Taller for memory data
    minHeight: 400, // Minimum height for debugging interface
    maxHeight: Math.min(height - 40, 800), // Maximum height
    x: Math.floor((width - 400) / 2), // Center horizontally
    y: Math.floor(height * 0.15), // Position higher on screen
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
  if (!chatWindow) {
    createChatWindow();
  } else if (isChatVisible) {
    chatWindow.hide();
    isChatVisible = false;
  } else {
    chatWindow.show();
    chatWindow.focus();
    isChatVisible = true;
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

// Initialize core engine and services
let coreEngine = null;
let agentDispatcher = null;
let llmRouter = null;
let localLLMAgent = null;

async function initializeServices() {
  try {
    // Import services dynamically to handle ES modules
    const CoreEngine = (await import('./services/coreEngine.js')).default;
    const AgentDispatcher = (await import('./services/agentDispatcher.js')).default;
    const LLMRouter = (await import('./services/llmRouter.js')).default;
    
    // Initialize services
    coreEngine = new CoreEngine();
    agentDispatcher = new AgentDispatcher();
    llmRouter = new LLMRouter();
    
    // Initialize CoreEngine (which includes LocalLLMAgent)
    await coreEngine.initializeAll();
    
    // Use LocalLLMAgent from coreEngine instead of creating a separate instance
    localLLMAgent = coreEngine.localLLMAgent;
    
    // Set up event listeners
    coreEngine.on('audioData', (data) => {
      if (overlayWindow) {
        overlayWindow.webContents.send('transcript-update', data);
      }
    });
    
    coreEngine.on('clipboardChange', async (content) => {
      if (overlayWindow) {
        overlayWindow.webContents.send('clipboard-change', content);
        
        // Process clipboard content through agents
        try {
          const result = await agentDispatcher.processInput({
            type: 'clipboard',
            content,
            context: { timestamp: new Date().toISOString() }
          });
          overlayWindow.webContents.send('agent-response', result);
        } catch (error) {
          console.error('Agent processing error:', error);
        }
      }
    });
    
    coreEngine.on('screenTextDetected', async (ocrResult) => {
      if (overlayWindow) {
        overlayWindow.webContents.send('screen-text-detected', ocrResult);
        
        // Process OCR text through agents if significant
        if (ocrResult.text.length > 50) {
          try {
            const result = await agentDispatcher.processInput({
              type: 'screen',
              content: ocrResult.text,
              context: { confidence: ocrResult.confidence }
            });
            overlayWindow.webContents.send('agent-response', result);
          } catch (error) {
            console.error('Agent processing error:', error);
          }
        }
      }
    });
    
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
  if (!chatWindow) {
    createChatWindow();
  } else {
    chatWindow.show();
    chatWindow.focus();
    isChatVisible = true;
    }
});

ipcMain.handle('hide-chat', () => {
  if (chatWindow) {
    chatWindow.hide();
    isChatVisible = false;
    visibleWindows = visibleWindows.filter((window) => window !== 'chatWindow');
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
  
  // Process message through LocalLLMAgent orchestration
  try {
    if (localLLMAgent && localLLMAgent.isInitialized) {
      console.log('🧠 Processing message through LocalLLMAgent:', message.text);
      
      const orchestrationResult = await localLLMAgent.orchestrateAgents(message.text, {
        source: 'chat',
        timestamp: message.timestamp
      });
      
      // Send AI response to chat messages window
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        text: orchestrationResult.message || 'I processed your request successfully.',
        sender: 'ai',
        timestamp: new Date().toISOString(),
        metadata: {
          agentsUsed: orchestrationResult.agentsUsed || [],
          executionTime: orchestrationResult.executionTime || 0
        }
      };
      
      chatMessagesWindow.webContents.send('chat-message', aiMessage);
      
    } else {
      console.warn('⚠️ LocalLLMAgent not available, sending fallback response');
      
      // Fallback response when LocalLLMAgent is not ready
      const fallbackMessage = {
        id: (Date.now() + 1).toString(),
        text: 'LocalLLMAgent is initializing. Please try again in a moment.',
        sender: 'ai',
        timestamp: new Date().toISOString()
      };
      
      chatMessagesWindow.webContents.send('chat-message', fallbackMessage);
    }
    
  } catch (error) {
    console.error('❌ Chat message processing error:', error);
    
    // Send error response to chat
    const errorMessage = {
      id: (Date.now() + 2).toString(),
      text: `Sorry, I encountered an error processing your request: ${error.message}`,
      sender: 'ai',
      timestamp: new Date().toISOString(),
      isError: true
    };
    
    chatMessagesWindow.webContents.send('chat-message', errorMessage);
  }
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

// IPC handlers for core engine
ipcMain.handle('start-audio-capture', async () => {
  if (coreEngine) {
    coreEngine.startAudioCapture();
    return { success: true };
  }
  return { success: false, error: 'Core engine not available' };
});

ipcMain.handle('stop-audio-capture', async () => {
  if (coreEngine) {
    coreEngine.stopAudioCapture();
    return { success: true };
  }
  return { success: false, error: 'Core engine not available' };
});

ipcMain.handle('start-clipboard-monitoring', async () => {
  if (coreEngine) {
    coreEngine.startClipboardMonitoring();
    return { success: true };
  }
  return { success: false, error: 'Core engine not available' };
});

ipcMain.handle('stop-clipboard-monitoring', async () => {
  if (coreEngine) {
    coreEngine.stopClipboardMonitoring();
    return { success: true };
  }
  return { success: false, error: 'Core engine not available' };
});

ipcMain.handle('start-screen-monitoring', async () => {
  if (coreEngine) {
    coreEngine.startScreenMonitoring();
    return { success: true };
  }
  return { success: false, error: 'Core engine not available' };
});

ipcMain.handle('stop-screen-monitoring', async () => {
  if (coreEngine) {
    coreEngine.stopScreenMonitoring();
    return { success: true };
  }
  return { success: false, error: 'Core engine not available' };
});

// IPC handlers for screenshot agent
ipcMain.handle('capture-screenshot', async (event, options = {}) => {
  if (coreEngine) {
    try {
      const result = await coreEngine.captureScreenshot(options);
      return { success: true, data: result };
    } catch (error) {
      console.error('Screenshot capture error:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Core engine not available' };
});

ipcMain.handle('process-screenshot-request', async (event, intent, options = {}) => {
  if (coreEngine) {
    try {
      const result = await coreEngine.processScreenshotRequest(intent, options);
      return { success: true, data: result };
    } catch (error) {
      console.error('Screenshot request processing error:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Core engine not available' };
});

ipcMain.handle('initialize-screenshot-agent', async () => {
  if (coreEngine) {
    try {
      const result = await coreEngine.initializeScreenshotAgent();
      return { success: result };
    } catch (error) {
      console.error('Screenshot agent initialization error:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Core engine not available' };
});

// IPC handlers for agent processing
ipcMain.handle('process-input', async (event, inputData) => {
  if (agentDispatcher) {
    try {
      const result = await agentDispatcher.processInput(inputData);
      return result;
    } catch (error) {
      console.error('Agent processing error:', error);
      return { error: error.message };
    }
  }
  
  // Fallback to simulated response
  return {
    requestId: `sim_${Date.now()}`,
    agents: ['summarizer'],
    results: [{
      summary: `Simulated response for: "${inputData.content.substring(0, 50)}..."`,
      simulated: true,
      timestamp: new Date().toISOString()
    }]
  };
});

// System health check
ipcMain.handle('get-system-health', async () => {
  const health = {
    coreEngine: coreEngine ? 'ready' : 'not_available',
    agentDispatcher: agentDispatcher ? 'ready' : 'not_available',
    llmRouter: llmRouter ? 'ready' : 'not_available',
    localLLMAgent: localLLMAgent ? 'ready' : 'not_available',
    services: {
      audio: coreEngine?.isRecording || false,
      clipboard: coreEngine?.clipboardWatcher ? true : false,
      screen: coreEngine?.screenshotInterval ? true : false
    }
  };
  
  if (agentDispatcher) {
    try {
      health.webhooks = await agentDispatcher.healthCheck();
    } catch (error) {
      health.webhooks = { error: error.message };
    }
  }
  
  if (llmRouter) {
    try {
      health.llmProviders = await llmRouter.healthCheck();
    } catch (error) {
      health.llmProviders = { error: error.message };
    }
  }
  
  if (localLLMAgent) {
    try {
      health.localLLMAgent = await localLLMAgent.getHealthStatus();
    } catch (error) {
      health.localLLMAgent = { error: error.message };
    }
  }
  
  return health;
});

// LocalLLMAgent IPC handlers
ipcMain.handle('llm-orchestrate', async (event, userInput, context = {}) => {
  if (localLLMAgent && localLLMAgent.isInitialized) {
    try {
      const result = await localLLMAgent.orchestrateAgents(userInput, context);
      return { success: true, data: result };
    } catch (error) {
      console.error('LocalLLMAgent orchestration error:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'LocalLLMAgent not available' };
});

ipcMain.handle('llm-query-local', async (event, prompt, options = {}) => {
  if (localLLMAgent && localLLMAgent.localLLMAvailable) {
    try {
      const result = await localLLMAgent.queryLocalLLM(prompt, options);
      return { success: true, data: result };
    } catch (error) {
      console.error('Local LLM query error:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Local LLM not available' };
});

ipcMain.handle('llm-get-health', async () => {
  if (localLLMAgent) {
    try {
      const health = await localLLMAgent.getHealthStatus();
      return { success: true, data: health };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'LocalLLMAgent not available' };
});

ipcMain.handle('llm-get-cached-agents', async () => {
  if (localLLMAgent && localLLMAgent.database) {
    try {
      const agents = localLLMAgent.database.prepare('SELECT * FROM cached_agents ORDER BY last_accessed DESC').all();
      return { success: true, data: agents };
    } catch (error) {
      console.error('Error fetching cached agents:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'LocalLLMAgent database not available' };
});

ipcMain.handle('llm-get-communications', async (event, limit = 50) => {
  if (localLLMAgent && localLLMAgent.database) {
    try {
      const communications = localLLMAgent.database.prepare(
        'SELECT * FROM agent_communications ORDER BY timestamp DESC LIMIT ?'
      ).all(limit);
      return { success: true, data: communications };
    } catch (error) {
      console.error('Error fetching communications:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'LocalLLMAgent database not available' };
});

ipcMain.handle('llm-clear-cache', async () => {
  if (localLLMAgent && localLLMAgent.database) {
    try {
      localLLMAgent.database.prepare('DELETE FROM cached_agents WHERE source != "default"').run();
      localLLMAgent.agentCache.clear();
      return { success: true, message: 'Agent cache cleared' };
    } catch (error) {
      console.error('Error clearing cache:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'LocalLLMAgent database not available' };
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
