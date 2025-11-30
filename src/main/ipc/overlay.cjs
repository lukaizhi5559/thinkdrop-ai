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
let orchestrator = null;

/**
 * Initialize overlay IPC handlers
 * @param {AgentOrchestrator} agentOrchestrator - The orchestrator instance
 */
function initializeOverlayIPC(agentOrchestrator) {
  orchestrator = agentOrchestrator;
  
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
      // Process event through orchestrator
      const result = await orchestrator.processOverlayEvent(overlayEvent);
      
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

    logger.debug('📏 [OVERLAY:IPC] Resizing prompt window:', { width, height });
    
    // Keep width the same, only adjust height
    const currentBounds = promptWindow.getBounds();
    const newWidth = width || currentBounds.width;
    const newHeight = height;
    
    // Calculate the bottom edge of the current window
    const currentBottom = currentBounds.y + currentBounds.height;
    
    // Keep the bottom edge at the same position, adjust Y to accommodate new height
    const newY = currentBottom - newHeight;
    
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
  
  // Show the intent window when sending payload
  if (!intentWindow.isVisible()) {
    intentWindow.show();
    logger.debug('👁️  [OVERLAY:IPC] Showing intent window');
  }
  
  intentWindow.webContents.send('overlay:update', payload);
}

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
  isOverlayReady
};
