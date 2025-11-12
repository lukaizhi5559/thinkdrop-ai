const { BrowserWindow, screen } = require('electron');
const path = require('path');

let toastWindow = null;

/**
 * Create hotkey toast overlay window
 */
function createHotkeyToastOverlay() {
  if (toastWindow) {
    console.log('🍞 [HOTKEY TOAST] Window already exists');
    return toastWindow;
  }

  console.log('🍞 [HOTKEY TOAST] Creating overlay window...');

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
      console.log('🍞 [HOTKEY TOAST] Clickable:', isClickable);
    }
  });

  // Load the toast HTML
  const toastPath = path.join(__dirname, '../../overlay/hotkey-toast.html');
  toastWindow.loadFile(toastPath);

  // Show window (it's transparent, so only toast will be visible)
  toastWindow.once('ready-to-show', () => {
    toastWindow.showInactive();
    console.log('🍞 [HOTKEY TOAST] Window ready and shown');
  });

  // Handle window close
  toastWindow.on('closed', () => {
    toastWindow = null;
    console.log('🍞 [HOTKEY TOAST] Window closed');
  });

  console.log('🍞 [HOTKEY TOAST] Window created');
  return toastWindow;
}

/**
 * Show hotkey hint toast
 */
function showHotkeyToast(message) {
  console.log('🍞 [HOTKEY TOAST] showHotkeyToast called:', message);

  if (!toastWindow) {
    console.log('🍞 [HOTKEY TOAST] Creating window first...');
    createHotkeyToastOverlay();
  }

  // Wait for window to be ready
  if (toastWindow.webContents.isLoading()) {
    console.log('🍞 [HOTKEY TOAST] Window loading, waiting...');
    toastWindow.webContents.once('did-finish-load', () => {
      console.log('🍞 [HOTKEY TOAST] Window loaded, sending message');
      toastWindow.webContents.send('show-hotkey-toast', message);
    });
  } else {
    console.log('🍞 [HOTKEY TOAST] Window ready, sending message');
    toastWindow.webContents.send('show-hotkey-toast', message);
  }
}

/**
 * Destroy toast window
 */
function destroyHotkeyToast() {
  if (toastWindow) {
    toastWindow.destroy();
    toastWindow = null;
    console.log('🍞 [HOTKEY TOAST] Window destroyed');
  }
}

module.exports = {
  createHotkeyToastOverlay,
  showHotkeyToast,
  destroyHotkeyToast
};
