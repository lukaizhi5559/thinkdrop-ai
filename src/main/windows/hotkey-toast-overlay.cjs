const { BrowserWindow, screen } = require('electron');
const path = require('path');

const logger = require('./../logger.cjs');
let toastWindow = null;

/**
 * Create hotkey toast overlay window
 */
function createHotkeyToastOverlay() {
  if (toastWindow) {
    logger.debug('🍞 [HOTKEY TOAST] Window already exists');
    return toastWindow;
  }

  logger.debug('🍞 [HOTKEY TOAST] Creating overlay window...');

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  toastWindow = new BrowserWindow({
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

  // Make window click-through except for toast
  toastWindow.setIgnoreMouseEvents(true, { forward: true });
  toastWindow.setAlwaysOnTop(true, 'floating', 1);
  toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Handle mouse events from renderer - toggle click-through based on toast hover
  toastWindow.webContents.on('ipc-message', (event, channel, isClickable) => {
    if (channel === 'overlay:set-clickable') {
      toastWindow.setIgnoreMouseEvents(!isClickable, { forward: true });
      logger.debug('🍞 [HOTKEY TOAST] Clickable:', isClickable);
    }
  });

  // Load the toast HTML
  const toastPath = path.join(__dirname, '../../overlay/hotkey-toast.html');
  toastWindow.loadFile(toastPath);

  // TEMPORARY: Open DevTools to see console logs
  toastWindow.webContents.openDevTools({ mode: 'detach' });

  // Show window (it's transparent, so only toast will be visible)
  toastWindow.once('ready-to-show', () => {
    toastWindow.showInactive();
    logger.debug('🍞 [HOTKEY TOAST] Window ready and shown');
  });

  // Handle window close
  toastWindow.on('closed', () => {
    toastWindow = null;
    logger.debug('🍞 [HOTKEY TOAST] Window closed');
  });

  logger.debug('🍞 [HOTKEY TOAST] Window created');
  return toastWindow;
}

/**
 * Show hotkey hint toast
 * @param {string|object} messageOrOptions - Message string or options object
 * @param {object} options - Optional settings (if messageOrOptions is a string)
 */
function showHotkeyToast(messageOrOptions, options = {}) {
  logger.debug('🍞 [HOTKEY TOAST] showHotkeyToast called:', messageOrOptions, options);

  if (!toastWindow) {
    logger.debug('🍞 [HOTKEY TOAST] Creating window first...');
    createHotkeyToastOverlay();
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

  logger.debug('🍞 [HOTKEY TOAST] Sending data:', data);

  // Wait for window to be ready
  if (toastWindow.webContents.isLoading()) {
    logger.debug('🍞 [HOTKEY TOAST] Window loading, waiting...');
    toastWindow.webContents.once('did-finish-load', () => {
      logger.debug('🍞 [HOTKEY TOAST] Window loaded, sending message');
      toastWindow.webContents.send('show-hotkey-toast', data);
    });
  } else {
    logger.debug('🍞 [HOTKEY TOAST] Window ready, sending message');
    toastWindow.webContents.send('show-hotkey-toast', data);
  }
}

/**
 * Destroy toast window
 */
function destroyHotkeyToast() {
  if (toastWindow) {
    toastWindow.destroy();
    toastWindow = null;
    logger.debug('🍞 [HOTKEY TOAST] Window destroyed');
  }
}

module.exports = {
  createHotkeyToastOverlay,
  showHotkeyToast,
  destroyHotkeyToast
};
