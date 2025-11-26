/**
 * FAB (Floating Action Button) Window
 * 
 * A small, always-on-top window that displays the ThinkDrop FAB button
 * at the bottom-right corner of the screen. Independent of the overlay window.
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const logger = require('./../logger.cjs');
let fabWindow = null;

/**
 * Create the FAB window
 */
function createFABWindow() {
  if (fabWindow) {
    return fabWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // FAB button size and position
  const fabSize = 80; // 80x80px for the button + padding
  const margin = 32; // Distance from screen edges

  fabWindow = new BrowserWindow({
    width: fabSize,
    height: fabSize,
    x: screenWidth - fabSize - margin,
    y: screenHeight - fabSize - margin,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true, // Need to be focusable to receive clicks
    hasShadow: false,
    backgroundColor: '#00000000',
    opacity: 1.0,
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'customButtonsOnHover',
      vibrancy: null,
      visualEffectState: 'inactive'
    }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.cjs'),
      devTools: process.env.NODE_ENV === 'development',
      backgroundThrottling: false,
      offscreen: false
    }
  });

  // Explicitly set background color to fully transparent
  fabWindow.setBackgroundColor('#00000000');
  
  // Hide window buttons (macOS)
  if (process.platform === 'darwin') {
    fabWindow.setWindowButtonVisibility(false);
  }

  // Load FAB HTML
  const fabHtmlPath = path.join(__dirname, '../../renderer/fab.html');
  fabWindow.loadFile(fabHtmlPath);
  
  // After page loads, set click-through for transparent areas
  fabWindow.webContents.on('did-finish-load', () => {
    // Make transparent areas click-through but keep button clickable
    // This is handled by CSS pointer-events
    fabWindow.setIgnoreMouseEvents(false);
  });

  // Keep window always on top
  fabWindow.setAlwaysOnTop(true, 'floating', 1);
  fabWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Handle window close
  fabWindow.on('closed', () => {
    fabWindow = null;
  });

  // Debug: Log when page finishes loading
  fabWindow.webContents.on('did-finish-load', () => {
    logger.debug('✅ [FAB] Page loaded successfully');
  });

  // Debug: Log console messages from FAB window
  fabWindow.webContents.on('console-message', (event, level, message) => {
    logger.debug(`[FAB Console] ${message}`);
  });

  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    logger.debug('✅ FAB Window created at:', {
      x: screenWidth - fabSize - margin,
      y: screenHeight - fabSize - margin,
      size: fabSize,
      preload: path.join(__dirname, '../preload.cjs')
    });
  }

  return fabWindow;
}

/**
 * Show the FAB window
 */
function showFAB() {
  if (fabWindow) {
    fabWindow.show();
  } else {
    createFABWindow();
  }
}

/**
 * Hide the FAB window
 */
function hideFAB() {
  if (fabWindow) {
    fabWindow.hide();
  }
}

/**
 * Toggle FAB visibility
 */
function toggleFAB() {
  if (fabWindow && fabWindow.isVisible()) {
    hideFAB();
  } else {
    showFAB();
  }
}

/**
 * Destroy the FAB window
 */
function destroyFAB() {
  if (fabWindow) {
    fabWindow.close();
    fabWindow = null;
  }
}

/**
 * Get the FAB window instance
 */
function getFABWindow() {
  return fabWindow;
}

/**
 * Update FAB state (executing, active, etc.)
 */
function updateFABState(state) {
  if (fabWindow && fabWindow.webContents) {
    fabWindow.webContents.send('fab:update-state', state);
  }
}

module.exports = {
  createFABWindow,
  showFAB,
  hideFAB,
  toggleFAB,
  destroyFAB,
  getFABWindow,
  updateFABState
};
