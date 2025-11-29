/**
 * Overlay IPC Handlers
 * 
 * Handles communication between overlay window and main process:
 * - overlay:event → User interaction from overlay (button clicks, choices)
 * - overlay:update → Send new overlay payload to overlay window
 */

const { ipcMain, BrowserWindow } = require('electron');
const logger = require('../logger.cjs');

let overlayWindow = null;
let orchestrator = null;

/**
 * Initialize overlay IPC handlers
 * @param {AgentOrchestrator} agentOrchestrator - The orchestrator instance
 */
function initializeOverlayIPC(agentOrchestrator) {
  orchestrator = agentOrchestrator;
  
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
      logger.error('❌ [OVERLAY:IPC] Error handling overlay event:', error);
    }
  });
  
  // Handle overlay ready signal
  ipcMain.on('overlay:ready', (event) => {
    logger.debug('✅ [OVERLAY:IPC] Overlay window ready');
    overlayWindow = BrowserWindow.fromWebContents(event.sender);
  });
  
  // Handle mouse event forwarding control
  ipcMain.on('overlay:set-ignore-mouse-events', (event, ignore, options) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.setIgnoreMouseEvents(ignore, options || { forward: true });
    }
  });

  // Handle window dragging - no IPC needed, we'll enable it in window config
  // Dragging is handled by setting the window as movable and using -webkit-app-region CSS

  // Handle dynamic window height resize when textarea expands
  ipcMain.on('overlay:resize-height', (event, newHeight) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      const { screen } = require('electron');
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.workAreaSize;
      
      // Cap max window height at 50% of screen height
      const maxWindowHeight = Math.floor(height * 0.5);
      const constrainedHeight = Math.min(newHeight, maxWindowHeight);
      
      const currentBounds = window.getBounds();
      const heightDiff = constrainedHeight - currentBounds.height;
      
      // Adjust y position to keep window anchored at bottom
      const newY = Math.max(10, currentBounds.y - heightDiff); // Don't go above 10px from top
      
      window.setBounds({ 
        x: currentBounds.x, 
        y: newY, 
        width: currentBounds.width, 
        height: constrainedHeight 
      }, true);
    }
  });

  // Handle prompt bar expand/collapse - move window position and set click-through
  ipcMain.on('overlay:set-expanded', (event, isExpanded) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      const { screen } = require('electron');
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.workAreaSize;
      
      const promptBarWidth = Math.floor(width * 0.6); // 60% width
      const x = Math.floor((width - promptBarWidth) / 2);
      
      if (isExpanded) {
        // Expanded: show full prompt bar (120px height - exact fit)
        const promptBarHeight = 120;
        const y = height - promptBarHeight - 5;
        
        // Animate the window resize with smooth transition
        window.setBounds({ x, y, width: promptBarWidth, height: promptBarHeight }, true);
        
        // Disable click-through - entire window is interactive
        window.setIgnoreMouseEvents(false);
      } else {
        // Collapsed: only show arrow button (60px height, positioned at very bottom)
        const collapsedHeight = 60;
        const y = height - collapsedHeight;
        
        // Animate the window resize with smooth transition
        window.setBounds({ x, y, width: promptBarWidth, height: collapsedHeight }, true);
        
        // Enable click-through with forward, but we'll use setIgnoreMouseEvents with a region
        // to keep only the arrow button clickable
        window.setIgnoreMouseEvents(true, { forward: true });
      }
      
      logger.debug(`📍 [OVERLAY] Window ${isExpanded ? 'expanded' : 'collapsed'}`);
    }
  });
  
  // Handle clickable region updates
  ipcMain.on('overlay:update-clickable-regions', (event, regions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      logger.debug(`📍 [OVERLAY:IPC] Updating ${regions.length} clickable regions`);
      
      if (regions.length > 0) {
        // Create a shape that defines clickable areas
        // Everything outside these regions will be click-through
        const { screen } = require('electron');
        const display = screen.getPrimaryDisplay();
        const { width, height } = display.workAreaSize;
        
        // For now, if we have regions, disable click-through entirely
        // and let CSS pointer-events handle it
        window.setIgnoreMouseEvents(false);
        
        // Store regions for potential future use
        window._clickableRegions = regions;
      } else {
        // No regions, enable full click-through
        window.setIgnoreMouseEvents(true, { forward: true });
      }
    }
  });
  
  logger.debug('✅ [OVERLAY:IPC] Overlay IPC handlers initialized');
}

/**
 * Send overlay payload to overlay window
 * @param {object} payload - Overlay payload from graph
 */
function sendOverlayUpdate(payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    logger.warn('⚠️  [OVERLAY:IPC] No overlay window available for update');
    return;
  }
  
  logger.debug('📤 [OVERLAY:IPC] Sending overlay update:', {
    intent: payload.intent,
    uiVariant: payload.uiVariant,
    conversationId: payload.conversationId
  });
  
  overlayWindow.webContents.send('overlay:update', payload);
}

/**
 * Check if overlay window exists and is ready
 * @returns {boolean}
 */
function isOverlayReady() {
  return overlayWindow !== null && !overlayWindow.isDestroyed();
}

module.exports = {
  initializeOverlayIPC,
  sendOverlayUpdate,
  isOverlayReady
};
