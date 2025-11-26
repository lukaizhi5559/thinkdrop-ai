/**
 * Guide Window
 * Separate Electron window for displaying interactive guides
 */

const { BrowserWindow } = require('electron');
const path = require('path');

const logger = require('./../logger.cjs');
let guideWindow = null;

function createGuideWindow() {
  if (guideWindow) {
    logger.debug('⚠️ Guide window already exists');
    return guideWindow;
  }

  logger.debug('🎯 Initializing Guide Window...');

  // Get screen dimensions for bottom-center positioning
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  const windowWidth = 800;
  const windowHeight = 350;
  const x = Math.floor((screenWidth - windowWidth) / 2);
  const y = screenHeight - windowHeight - 20; // 20px from bottom

  guideWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: true,
    show: false, // Start hidden
    backgroundColor: '#00000000',
    hasShadow: false, // No window shadow
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

  // Hide window buttons on macOS
  if (process.platform === 'darwin') {
    guideWindow.setWindowButtonVisibility(false);
  }

  // Load React app with guide mode
  guideWindow.loadURL(
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:5173?mode=guide'
      : `file://${path.join(__dirname, '../../dist-renderer/index.html')}?mode=guide`
  );

  // Debug logging
  guideWindow.webContents.on('did-finish-load', () => {
    logger.debug('✅ [GUIDE] Page loaded successfully');
  });

  guideWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    logger.debug(`[GUIDE Console] ${message}`);
  });

  // Handle window close
  guideWindow.on('closed', () => {
    logger.debug('🔴 Guide window closed');
    guideWindow = null;
  });

  logger.debug('✅ Guide Window created');
  
  return guideWindow;
}

function getGuideWindow() {
  return guideWindow;
}

function showGuideWindow() {
  if (guideWindow) {
    guideWindow.show();
    guideWindow.focus();
  }
}

function hideGuideWindow() {
  if (guideWindow) {
    guideWindow.hide();
  }
}

function closeGuideWindow() {
  if (guideWindow) {
    guideWindow.close();
    guideWindow = null;
  }
}

module.exports = {
  createGuideWindow,
  getGuideWindow,
  showGuideWindow,
  hideGuideWindow,
  closeGuideWindow
};
