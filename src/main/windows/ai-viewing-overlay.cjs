const { BrowserWindow, screen } = require('electron');
const path = require('path');

let overlayWindow = null;

/**
 * Create combined overlay window (replaces hotkey-toast.html)
 * Shows:
 * 1. Persistent AI viewing indicator (bottom center)
 * 2. Temporary hotkey toast messages (above indicator)
 */
function createAIViewingOverlay() {
  if (overlayWindow) {
    console.log('👁️  [OVERLAY] Window already exists');
    return overlayWindow;
  }

  console.log('👁️  [OVERLAY] Creating combined overlay window...');

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    show: false,
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.cjs'),
      backgroundThrottling: false
    }
  });

  // Make window click-through (overlay has pointer-events: none)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, 'floating', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Load the React app
  console.log('👁️  [OVERLAY] NODE_ENV:', process.env.NODE_ENV);
  if (process.env.NODE_ENV === 'development') {
    // Development: Load from Vite dev server
    const url = 'http://localhost:5173/src/overlay/ai-viewing-indicator.html';
    console.log('👁️  [OVERLAY] Loading from Vite dev server:', url);
    overlayWindow.loadURL(url);
    
    // Open DevTools in development
    overlayWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: Load from built files
    const htmlPath = path.join(__dirname, '../../dist-renderer/ai-viewing-indicator.html');
    console.log('👁️  [OVERLAY] Loading from file:', htmlPath);
    overlayWindow.loadFile(htmlPath);
  }

  // Handle load errors
  overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('❌ [OVERLAY] Failed to load:', errorDescription, 'URL:', validatedURL);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('✅ [OVERLAY] Content loaded successfully');
  });

  // Show window (it's transparent, so only overlay content will be visible)
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive();
    console.log('👁️  [OVERLAY] Window ready and shown');
  });

  // Handle window close
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    console.log('👁️  [OVERLAY] Window closed');
  });

  console.log('👁️  [OVERLAY] Window created');
  return overlayWindow;
}

/**
 * Get the combined overlay window
 */
function getAIViewingOverlay() {
  return overlayWindow;
}

/**
 * Show combined overlay
 */
function showAIViewingOverlay() {
  if (!overlayWindow) {
    createAIViewingOverlay();
  } else if (!overlayWindow.isDestroyed()) {
    // Send message to renderer to show all UI elements
    overlayWindow.webContents.send('show-overlay-ui');
    console.log('👁️  [OVERLAY] Sent show-overlay-ui to renderer');
  }
}

/**
 * Hide combined overlay
 */
function hideAIViewingOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Send message to renderer to hide all UI elements
    overlayWindow.webContents.send('hide-overlay-ui');
    console.log('👻 [OVERLAY] Sent hide-overlay-ui to renderer');
  }
}

/**
 * Send active window update to overlay (for AI viewing indicator)
 * @param {object} data - Window data {windowName, app, url, windowId}
 */
function sendActiveWindowUpdate(data) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('active-window-update', data);
    console.log('👁️  [OVERLAY] Sent active-window-update:', data.windowName || data.app);
  }
}

/**
 * Show hotkey toast message
 * @param {string|object} messageOrOptions - Message string or options object
 * @param {object} options - Optional settings (if messageOrOptions is a string)
 */
function showHotkeyToast(messageOrOptions, options = {}) {
  console.log('🍞 [OVERLAY] showHotkeyToast called:', messageOrOptions, options);

  if (!overlayWindow) {
    console.log('🍞 [OVERLAY] Creating window first...');
    createAIViewingOverlay();
  }

  // Normalize to data object
  let data;
  if (typeof messageOrOptions === 'string') {
    data = {
      message: messageOrOptions,
      persistent: options.persistent !== false,
      duration: options.duration || 3000
    };
  } else {
    data = messageOrOptions;
  }

  // Wait for window to be ready
  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', () => {
      overlayWindow.webContents.send('show-hotkey-toast', data);
      console.log('🍞 [OVERLAY] Sent show-hotkey-toast (after load):', data);
    });
  } else {
    overlayWindow.webContents.send('show-hotkey-toast', data);
    console.log('🍞 [OVERLAY] Sent show-hotkey-toast:', data);
  }
}

module.exports = {
  createAIViewingOverlay,
  getAIViewingOverlay,
  showAIViewingOverlay,
  hideAIViewingOverlay,
  sendActiveWindowUpdate,
  showHotkeyToast
};
