/**
 * Overlay IPC Handlers
 * 
 * Handles communication between overlay window and main process:
 * - overlay:event → User interaction from overlay (button clicks, choices)
 * - overlay:update → Send new overlay payload to overlay window
 */

const { ipcMain, BrowserWindow } = require('electron');
const logger = require('../logger.cjs');

let ghostWindow = null;   // Full-screen click-through window for ghost mouse & visual cues
let promptWindow = null;  // Small interactive window for prompt bar
let intentWindow = null;  // Dynamic interactive window for intent UIs
let chatWindow = null;    // Main chat window (overlayWindow)
let orchestrator = null;

// Web search state
let webSearchState = {
  hasResults: false,
  isVisible: true
};

// Chat window state
let chatWindowState = {
  isVisible: true
};

/**
 * Initialize overlay IPC handlers
 * @param {AgentOrchestrator} agentOrchestrator - The orchestrator instance
 * @param {object} windows - Window references { ghost, prompt, intent }
 */
function initializeOverlayIPC(agentOrchestrator, windows = {}) {
  orchestrator = agentOrchestrator;
  
  // Store window references
  if (windows.ghost) ghostWindow = windows.ghost;
  if (windows.prompt) promptWindow = windows.prompt;
  if (windows.intent) intentWindow = windows.intent;
  if (windows.chat) chatWindow = windows.chat;
  
  // NOTE: Web search requests now handled by private-mode:process with overlayMode flag
  // This eliminates duplication and reuses existing orchestrator logic
  
  // Handle overlay events (user interactions)
  ipcMain.on('overlay:event', async (event, overlayEvent) => {
    logger.debug('📨 [OVERLAY:IPC] Received overlay event:', {
      type: overlayEvent.type,
      intent: overlayEvent.intent,
      uiActionId: overlayEvent.uiActionId,
      sourceComponent: overlayEvent.sourceComponent
    });
    
    try {
      // Check if orchestrator exists
      if (!orchestrator || typeof orchestrator.processOverlayEvent !== 'function') {
        logger.warn('⚠️  [OVERLAY:IPC] Orchestrator not available, ignoring event');
        return;
      }
      
      // Process event through orchestrator
      const result = await orchestrator.processOverlayEvent(overlayEvent);
      
      if (!result) {
        logger.warn('⚠️  [OVERLAY:IPC] No result from orchestrator');
        return;
      }
      
      if (!result.success) {
        logger.error('❌ [OVERLAY:IPC] Overlay event processing failed:', result.error);
        return;
      }
      
      // Send updated overlay payload back to overlay window
      if (result.overlayPayload) {
        sendOverlayUpdate(result.overlayPayload);
        logger.debug('✅ [OVERLAY:IPC] Sent updated overlay payload');
      } else {
        logger.debug('⏭️  [OVERLAY:IPC] No overlay payload to send');
      }
      
    } catch (error) {
      logger.error('❌ [OVERLAY:IPC] Error handling overlay event:', error.message);
      logger.error('❌ [OVERLAY:IPC] Stack trace:', error.stack);
      // Don't crash, just log the error
    }
  });
  
  // Handle overlay ready signal - determine which window
  ipcMain.on('overlay:ready', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const url = event.sender.getURL();
    
    if (url.includes('mode=prompt')) {
      promptWindow = window;
      logger.debug('✅ [OVERLAY:IPC] Prompt window ready');
    } else if (url.includes('mode=intent')) {
      intentWindow = window;
      logger.debug('✅ [OVERLAY:IPC] Intent window ready');
    } else {
      ghostWindow = window;
      logger.debug('✅ [OVERLAY:IPC] Ghost window ready');
    }
  });
  
  // Handle mouse event forwarding control
  ipcMain.on('overlay:set-ignore-mouse-events', (event, ignore, options) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.setIgnoreMouseEvents(ignore, options || { forward: true });
    }
  });

  // Handle intent window positioning (animate to highlighted item)
  ipcMain.on('overlay:position-intent', (event, { x, y, width, height, animate = true }) => {
    if (!intentWindow || intentWindow.isDestroyed()) {
      logger.warn('⚠️  [OVERLAY:IPC] No intent window to position');
      return;
    }

    logger.debug('📍 [OVERLAY:IPC] Positioning intent window:', { x, y, width, height, animate });

    // Resize if dimensions provided
    if (width && height) {
      intentWindow.setSize(width, height, animate);
    }

    // Reposition if coordinates provided
    if (x !== undefined && y !== undefined) {
      intentWindow.setPosition(x, y, animate);
    }

    // Show if hidden
    if (!intentWindow.isVisible()) {
      intentWindow.show();
    }
  });

  // Handle prompt window resize (for textarea expansion)
  ipcMain.on('overlay:resize-prompt', (event, { width, height, animate = false }) => {
    if (!promptWindow || promptWindow.isDestroyed()) {
      logger.warn('⚠️  [OVERLAY:IPC] No prompt window to resize');
      return;
    }

    // logger.debug('📏 [OVERLAY:IPC] Resizing prompt window:', { width, height });
    
    // Keep width the same, only adjust height
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const screenHeight = primaryDisplay.workAreaSize.height;
    
    const currentBounds = promptWindow.getBounds();
    const newWidth = width || currentBounds.width;
    const newHeight = height;
    
    // Keep the bottom edge flush to the bottom of the screen
    const newY = screenHeight - newHeight;
    
    promptWindow.setBounds({
      x: currentBounds.x,
      y: newY,
      width: newWidth,
      height: newHeight
    }, animate);
  });

  // Handle intent window resize (for dynamic UI cards, dropdowns, etc.)
  ipcMain.on('overlay:resize-intent', (event, { width, height, animate = true }) => {
    if (!intentWindow || intentWindow.isDestroyed()) {
      logger.warn('⚠️  [OVERLAY:IPC] No intent window to resize');
      return;
    }

    logger.debug('📏 [OVERLAY:IPC] Resizing intent window:', { width, height });
    intentWindow.setSize(width, height, animate);
  });

  // Handle ghost window hover data (highlighted items)
  ipcMain.on('overlay:ghost-hover', (event, hoverData) => {
    logger.debug('👻 [OVERLAY:IPC] Ghost hover data:', hoverData);
    
    // Forward hover data to intent window so it can animate to the highlighted item
    if (intentWindow && !intentWindow.isDestroyed()) {
      intentWindow.webContents.send('overlay:ghost-hover-data', hoverData);
    }
  });
  
  logger.debug('✅ [OVERLAY:IPC] Overlay IPC handlers initialized');
}

/**
 * Send overlay payload to intent window (for interactive results display)
 * @param {object} payload - Overlay payload from graph
 */
function sendOverlayUpdate(payload) {
  if (!intentWindow || intentWindow.isDestroyed()) {
    logger.warn('⚠️  [OVERLAY:IPC] No intent window available for update');
    return;
  }
  
  logger.debug('📤 [OVERLAY:IPC] Sending overlay update to intent window:', {
    intent: payload.intent,
    uiVariant: payload.uiVariant,
    conversationId: payload.conversationId
  });
  
  // If this is a web search or question result, notify PromptBar
  if ((payload.intent === 'web_search' || payload.intent === 'question') && payload.uiVariant === 'results') {
    notifyWebSearchResults();
  }
  
  // Show the intent window when sending payload
  if (!intentWindow.isVisible()) {
    intentWindow.show();
    logger.debug('👁️  [OVERLAY:IPC] Showing intent window');
  }
  
  intentWindow.webContents.send('overlay:update', payload);
}

/**
 * Handle setting intent window mouse ignore state
 * Allows window to be click-through except when hovering over content
 */
ipcMain.on('intent-window:set-ignore-mouse', (event, shouldIgnore) => {
  if (!intentWindow || intentWindow.isDestroyed()) {
    return;
  }
  
  intentWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
});

/**
 * Handle web search toggle from PromptBar or WebSearchResults
 */
ipcMain.on('web-search:toggle', (event) => {
  logger.debug('🔄 [OVERLAY:IPC] Web search toggle requested');
  
  // Toggle visibility
  webSearchState.isVisible = !webSearchState.isVisible;
  
  logger.debug(`📊 [OVERLAY:IPC] Web search visibility: ${webSearchState.isVisible}`);
  
  // Notify PromptBar of state change
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('web-search:state', webSearchState);
  }
  
  // Notify Intent window of visibility change
  if (intentWindow && !intentWindow.isDestroyed()) {
    intentWindow.webContents.send('web-search:set-visibility', webSearchState.isVisible);
    
    // Hide or show the window
    if (webSearchState.isVisible) {
      intentWindow.show();
    } else {
      intentWindow.hide();
    }
  }
});

/**
 * Notify that web search results are available
 * Called when sending overlay update with web search results
 */
function notifyWebSearchResults() {
  webSearchState.hasResults = true;
  webSearchState.isVisible = true;
  
  logger.debug('📊 [OVERLAY:IPC] Web search results available, notifying PromptBar');
  
  // Notify PromptBar that results are available
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('web-search:state', webSearchState);
  }
}

/**
 * Handle chat window toggle from PromptBar or UnifiedInterface
 */
ipcMain.on('chat-window:toggle', (event) => {
  logger.debug('🔄 [OVERLAY:IPC] Chat window toggle requested');
  
  // Toggle visibility
  chatWindowState.isVisible = !chatWindowState.isVisible;
  
  logger.debug(`📊 [OVERLAY:IPC] Chat window visibility: ${chatWindowState.isVisible}`);
  
  // Notify PromptBar of state change
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('chat-window:state', chatWindowState);
  }
  
  // Hide or show the window
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindowState.isVisible) {
      chatWindow.show();
      chatWindow.focus();
    } else {
      chatWindow.hide();
    }
  }
});

/**
 * Get current chat window state
 */
ipcMain.handle('chat-window:get-state', () => {
  return chatWindowState;
});

/**
 * Check if overlay windows exist and are ready
 * @returns {boolean}
 */
function isOverlayReady() {
  return (ghostWindow !== null && !ghostWindow.isDestroyed()) ||
         (promptWindow !== null && !promptWindow.isDestroyed()) ||
         (intentWindow !== null && !intentWindow.isDestroyed());
}

module.exports = {
  initializeOverlayIPC,
  sendOverlayUpdate,
  notifyWebSearchResults,
  isOverlayReady
};
