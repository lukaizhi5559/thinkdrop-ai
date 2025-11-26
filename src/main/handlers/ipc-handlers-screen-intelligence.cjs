/**
 * IPC Handlers for Screen Intelligence Overlay
 * 
 * Connects the screen-intelligence MCP service to the Electron overlay window
 */

const { ipcMain } = require('electron');
const logger = require('./../logger.cjs');
const {
  createScreenIntelligenceOverlay,
  showHighlights,
  showDiscoveryMode,
  showToast,
  showActionGuide,
  clearOverlays,
  hideOverlay,
  getOverlayWindow
} = require('../windows/screen-intelligence-overlay.cjs');

/**
 * Register all screen intelligence IPC handlers
 */
function registerScreenIntelligenceHandlers() {
  logger.debug('📡 Registering Screen Intelligence IPC handlers...');

  // Initialize overlay window
  ipcMain.handle('screen-intelligence:init', async () => {
    try {
      createScreenIntelligenceOverlay();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize screen intelligence overlay:', error);
      return { success: false, error: error.message };
    }
  });

  // Show element highlights
  ipcMain.handle('screen-intelligence:show-highlights', async (event, data) => {
    try {
      const { elements, duration = 3000 } = data;
      showHighlights(elements, duration);
      return { success: true };
    } catch (error) {
      logger.error('Failed to show highlights:', error);
      return { success: false, error: error.message };
    }
  });

  // Highlight a single element (from Vision Panel)
  ipcMain.on('screen-intelligence:highlight', (event, elementData) => {
    try {
      // Convert single element to array format for showHighlights
      const elements = [{
        bounds: elementData.bounds,
        role: elementData.role,
        label: elementData.label || elementData.value,
        confidence: elementData.confidence || 1.0
      }];
      showHighlights(elements, 5000); // Show for 5 seconds
    } catch (error) {
      logger.error('Failed to highlight element:', error);
    }
  });

  // Show discovery mode
  ipcMain.handle('screen-intelligence:show-discovery', async (event, data) => {
    try {
      const { elements } = data;
      showDiscoveryMode(elements);
      return { success: true };
    } catch (error) {
      logger.error('Failed to show discovery mode:', error);
      return { success: false, error: error.message };
    }
  });

  // Show toast notification
  ipcMain.handle('screen-intelligence:show-toast', async (event, data) => {
    try {
      const { message, type = 'info', duration = 3000 } = data;
      showToast(message, type, duration);
      return { success: true };
    } catch (error) {
      logger.error('Failed to show toast:', error);
      return { success: false, error: error.message };
    }
  });

  // Show action guide
  ipcMain.handle('screen-intelligence:show-guide', async (event, data) => {
    try {
      showActionGuide(data);
      return { success: true };
    } catch (error) {
      logger.error('Failed to show action guide:', error);
      return { success: false, error: error.message };
    }
  });

  // Clear all overlays
  ipcMain.handle('screen-intelligence:clear', async () => {
    try {
      clearOverlays();
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear overlays:', error);
      return { success: false, error: error.message };
    }
  });

  // Hide overlay window
  ipcMain.handle('screen-intelligence:hide', async () => {
    try {
      hideOverlay();
      return { success: true };
    } catch (error) {
      logger.error('Failed to hide overlay:', error);
      return { success: false, error: error.message };
    }
  });

  // Get overlay status
  ipcMain.handle('screen-intelligence:status', async () => {
    try {
      const window = getOverlayWindow();
      return {
        success: true,
        isVisible: window ? window.isVisible() : false,
        isInitialized: window !== null
      };
    } catch (error) {
      logger.error('Failed to get overlay status:', error);
      return { success: false, error: error.message };
    }
  });

  // Refresh screen capture (clear cache and force new analysis)
  ipcMain.handle('screen-intelligence:refresh', async () => {
    try {
      const vdom = global.virtualScreenDOM;
      if (vdom && vdom.clearCache) {
        vdom.clearCache();
        logger.debug('🔄 [SCREEN_INTELLIGENCE] Cache cleared - next query will trigger fresh analysis');
      }
      return { success: true };
    } catch (error) {
      logger.error('Failed to refresh screen intelligence:', error);
      return { success: false, error: error.message };
    }
  });

  logger.debug('✅ Screen Intelligence IPC handlers registered');
}

module.exports = {
  registerScreenIntelligenceHandlers
};
