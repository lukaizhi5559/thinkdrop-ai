// Entry point for Thinkdrop AI Electron overlay app
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
require('dotenv').config(); // Load .env variables

let overlayWindow = null;
let chatWindow = null;
let chatMessagesWindow = null;
let insightWindow = null;
let isOverlayVisible = true;
let isChatVisible = false;
let isInsightVisible = false;
let isGloballyVisible = true; // Global visibility state for all windows

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
    width: 420, // Fixed width as specified in the UI plan
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
  
  // Development: Open DevTools
  if (process.env.NODE_ENV === 'development') {
    insightWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
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
    }
    if (chatMessagesWindow) {
      chatMessagesWindow.hide();
    }
    if (insightWindow) {
      insightWindow.hide();
    }
    isOverlayVisible = false;
    isChatVisible = false;
    isInsightVisible = false;
    isGloballyVisible = false;
  } else {
    // Show overlay window (chat windows will be shown when needed)
    overlayWindow.show();
    overlayWindow.focus();
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
  
  // Initialize core services (disabled for demo)
  // initializeServices();
  
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
  isOverlayVisible = false;
  isChatVisible = false;
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
  }
});

ipcMain.handle('hide-insight', () => {
  if (insightWindow) {
    insightWindow.hide();
    isInsightVisible = false;
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
});

ipcMain.handle('hide-chat-messages', () => {
  if (chatMessagesWindow) {
    chatMessagesWindow.hide();
  }
});

// IPC handlers for chat messaging system
ipcMain.handle('send-chat-message', (event, message) => {
  // Ensure only one chat messages window exists
  if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
    createChatMessagesWindow();
  }
  
  // Show the chat messages window
  chatMessagesWindow.show();
  chatMessagesWindow.focus();
  
  // Send the message to the chat messages window
  const chatMessage = {
    id: Date.now().toString(),
    text: message.text,
    sender: 'user',
    timestamp: message.timestamp
  };
  
  chatMessagesWindow.webContents.send('chat-message', chatMessage);
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
  
  return health;
});
