/**
 * Selection Overlay Window
 * 
 * Shows a floating ThinkDrop button underneath selected text system-wide
 * Appears when text is selected in any application
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const logger = require('./../logger.cjs');
let selectionOverlayWindow = null;
let hideTimeout = null;

/**
 * Create the selection overlay window
 */
function createSelectionOverlay() {
  if (selectionOverlayWindow) {
    return selectionOverlayWindow;
  }

  // Create a small, transparent window for the floating button
  selectionOverlayWindow = new BrowserWindow({
    width: 80,
    height: 50,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false, // Don't steal focus
    show: false, // Don't show on creation
    hasShadow: false,
    // CRITICAL: Use panel type to appear over fullscreen apps
    type: 'panel',
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.cjs'),
      backgroundThrottling: false // Keep animations smooth
    }
  });

  // Initially make window clickable (not click-through)
  selectionOverlayWindow.setIgnoreMouseEvents(false);

  // Set window level to float above everything
  selectionOverlayWindow.setAlwaysOnTop(true, 'floating', 1);
  selectionOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Handle click events from renderer
  selectionOverlayWindow.webContents.on('ipc-message', (event, channel, data) => {
    if (channel === 'selection-overlay:clicked') {
      handleSelectionButtonClick();
    } else if (channel === 'selection-overlay:mouse-enter') {
      // Cancel hide timeout when hovering
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
    } else if (channel === 'selection-overlay:mouse-leave') {
      // Start hide timeout when leaving
      startHideTimeout();
    }
  });

  // Load the selection overlay HTML
  const overlayPath = path.join(__dirname, '../../overlay/selection-overlay.html');
  selectionOverlayWindow.loadFile(overlayPath);

  // Hide by default
  selectionOverlayWindow.hide();

  // Handle window close
  selectionOverlayWindow.on('closed', () => {
    selectionOverlayWindow = null;
  });

  logger.debug('✅ Selection overlay window created');
  return selectionOverlayWindow;
}

/**
 * Show the floating ThinkDrop button at specified coordinates
 */
function showSelectionButton(x, y, selectedText) {
  if (!selectionOverlayWindow) {
    createSelectionOverlay();
  }

  // Position the button underneath the selection
  const buttonX = Math.max(0, x - 40); // Center the 80px button
  const buttonY = y + 10; // 10px below selection

  // Ensure button stays on screen
  const displays = screen.getAllDisplays();
  const currentDisplay = screen.getDisplayNearestPoint({ x: buttonX, y: buttonY });
  const { width: screenWidth, height: screenHeight } = currentDisplay.bounds;
  
  const finalX = Math.min(buttonX, screenWidth - 80);
  const finalY = Math.min(buttonY, screenHeight - 50);

  // Position and show the window
  selectionOverlayWindow.setPosition(finalX, finalY);
  selectionOverlayWindow.showInactive(); // Show without stealing focus

  // Send selection data to renderer
  selectionOverlayWindow.webContents.send('selection-overlay:show', {
    selectedText: selectedText.substring(0, 100), // Preview
    fullText: selectedText
  });

  logger.debug(`🎯 [SELECTION_OVERLAY] Showing button at (${finalX}, ${finalY}) for text: "${selectedText.substring(0, 50)}..."`);

  // Auto-hide after 5 seconds unless hovered
  startHideTimeout();
}

/**
 * Start the auto-hide timeout
 */
function startHideTimeout() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
  }
  
  hideTimeout = setTimeout(() => {
    hideSelectionButton();
  }, 5000); // Hide after 5 seconds
}

/**
 * Hide the selection button
 */
function hideSelectionButton() {
  if (selectionOverlayWindow) {
    selectionOverlayWindow.hide();
    logger.debug('🙈 [SELECTION_OVERLAY] Button hidden');
  }
  
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
}

/**
 * Handle when the ThinkDrop button is clicked
 */
async function handleSelectionButtonClick() {
  logger.debug('🎯 [SELECTION_OVERLAY] ThinkDrop button clicked!');
  
  // Hide the button immediately
  hideSelectionButton();
  
  // Trigger the same functionality as Cmd+Option+A
  if (global.selectionDetector) {
    await global.selectionDetector.captureSelectionWithNutJS();
    
    // Show main ThinkDrop window
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows.find(win => win.webContents.getURL().includes('index.html'));
    
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

/**
 * Destroy selection overlay window
 */
function destroySelectionOverlay() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
  
  if (selectionOverlayWindow) {
    selectionOverlayWindow.close();
    selectionOverlayWindow = null;
  }
}

/**
 * Get selection overlay window instance
 */
function getSelectionOverlayWindow() {
  return selectionOverlayWindow;
}

module.exports = {
  createSelectionOverlay,
  showSelectionButton,
  hideSelectionButton,
  destroySelectionOverlay,
  getSelectionOverlayWindow
};
