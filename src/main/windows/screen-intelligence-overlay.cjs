/**
 * Screen Intelligence Overlay Window
 * 
 * Transparent, always-on-top window that shows visual feedback:
 * - Element highlights with labels
 * - Discovery mode (all elements)
 * - Toast notifications
 * - Step-by-step guides
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

let overlayWindow = null;

/**
 * Create the screen intelligence overlay window
 */
function createScreenIntelligenceOverlay() {
  if (overlayWindow) {
    return overlayWindow;
  }

  // Get the display where the cursor is currently located
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = currentDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
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
    enableLargerThanScreen: true,
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

  // Initially make window click-through (pass clicks to underlying windows)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // Set window level to float above everything - 'floating' is sufficient for panel windows
  overlayWindow.setAlwaysOnTop(true, 'floating', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Handle mouse events from renderer - toggle click-through based on panel hover
  overlayWindow.webContents.on('ipc-message', (event, channel, isOverPanel) => {
    if (channel === 'overlay:set-clickable') {
      overlayWindow.setIgnoreMouseEvents(!isOverPanel, { forward: true });
    }
  });

  // Load the overlay HTML
  const overlayPath = path.join(__dirname, '../../overlay/screen-intelligence.html');
  overlayWindow.loadFile(overlayPath);

  // Hide by default
  overlayWindow.hide();

  // Handle window close
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  console.log('✅ Screen Intelligence overlay window created');

  return overlayWindow;
}

/**
 * Show element highlights
 */
function showHighlights(elements, duration = 3000) {
  if (!overlayWindow) {
    createScreenIntelligenceOverlay();
  }

  console.log(`🎨 [OVERLAY] Showing highlights: ${elements.length} elements, duration: ${duration}ms`);
  overlayWindow.showInactive(); // Show without stealing focus
  console.log(`🎨 [OVERLAY] Window shown, isVisible: ${overlayWindow.isVisible()}`);
  
  overlayWindow.webContents.send('screen-intelligence:show-highlights', {
    elements,
    duration
  });

  // Auto-hide after duration
  if (duration > 0) {
    console.log(`⏰ [OVERLAY] Setting auto-hide timer for ${duration}ms`);
    setTimeout(() => {
      console.log(`⏰ [OVERLAY] Auto-hide timer triggered`);
      hideOverlay();
    }, duration);
  } else {
    console.log(`✅ [OVERLAY] No auto-hide - overlay will stay visible`);
  }
}

/**
 * Show discovery mode (all elements)
 */
function showDiscoveryMode(elements) {
  if (!overlayWindow) {
    createScreenIntelligenceOverlay();
  }

  // Update overlay position to current display before showing
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = currentDisplay.bounds;
  overlayWindow.setBounds({ x, y, width, height });

  overlayWindow.showInactive(); // Show without stealing focus
  overlayWindow.webContents.send('screen-intelligence:show-discovery', {
    elements
  });
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info', duration = 3000) {
  if (!overlayWindow) {
    createScreenIntelligenceOverlay();
  }

  overlayWindow.showInactive(); // Show without stealing focus
  overlayWindow.webContents.send('screen-intelligence:show-toast', {
    message,
    type,
    duration
  });

  // Auto-hide after duration
  setTimeout(() => {
    overlayWindow.webContents.send('screen-intelligence:hide-toast');
  }, duration);
}

/**
 * Show action guide (step-by-step)
 */
function showActionGuide(guide) {
  if (!overlayWindow) {
    createScreenIntelligenceOverlay();
  }

  overlayWindow.showInactive(); // Show without stealing focus
  overlayWindow.webContents.send('screen-intelligence:show-guide', guide);
}

/**
 * Clear all overlays
 */
function clearOverlays() {
  if (overlayWindow) {
    overlayWindow.webContents.send('screen-intelligence:clear-all');
  }
}

/**
 * Hide overlay window
 */
function hideOverlay() {
  console.log(`🙈 [OVERLAY] hideOverlay() called`);
  console.trace('hideOverlay call stack');
  if (overlayWindow) {
    overlayWindow.webContents.send('screen-intelligence:clear-all');
    overlayWindow.hide();
    console.log(`🙈 [OVERLAY] Window hidden`);
  }
}

/**
 * Destroy overlay window
 */
function destroyOverlay() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

/**
 * Get overlay window instance
 */
function getOverlayWindow() {
  return overlayWindow;
}

/**
 * Update overlay for multi-display
 */
function updateOverlayForDisplay(displayId) {
  if (!overlayWindow) return;

  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find(d => d.id === displayId) || screen.getPrimaryDisplay();
  
  const { x, y, width, height } = targetDisplay.bounds;
  
  overlayWindow.setBounds({ x, y, width, height });
}

module.exports = {
  createScreenIntelligenceOverlay,
  showHighlights,
  showDiscoveryMode,
  showToast,
  showActionGuide,
  clearOverlays,
  hideOverlay,
  destroyOverlay,
  getOverlayWindow,
  updateOverlayForDisplay
};
