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
let resultsWindow = null; // Clean results window styled like PromptCaptureBox
let chatWindow = null;    // Main chat window (overlayWindow)
let orchestrator = null;

// Web search state
let webSearchState = {
  hasResults: false,
  isVisible: true
};

// Screen intelligence state
let screenIntelligenceState = {
  hasResults: false,
  isVisible: true
};

// Command execute state
let commandExecuteState = {
  hasResults: false,
  isVisible: true
};

// Chat window state
let chatWindowState = {
  isVisible: false
};

// Automation state
let automationState = {
  hasAutomation: false,
  isVisible: true,
  isRunning: false
};

// General results state (for prompt capture results window)
let resultsState = {
  hasResults: false
};

// Online mode (Live Mode) state - source of truth in main process
let onlineModeState = false;

// Toggle lock to prevent rapid successive toggles
let chatToggleLock = false;

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
  if (windows.results) resultsWindow = windows.results;
  if (windows.chat) chatWindow = windows.chat;
  
  // NOTE: Web search requests now handled by private-mode:process with overlayMode flag
  // This eliminates duplication and reuses existing orchestrator logic
  
  // Handle overlay events (user interactions)
  ipcMain.on('overlay:event', async (_event, overlayEvent) => {
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
  
  // Handle private mode error from intent window and forward to ghost window for banner
  ipcMain.on('overlay:private-mode-error', (event, data) => {
    logger.debug('🚨 [OVERLAY:IPC] Private mode error received from intent window:', data);
    
    // Forward to ghost window where banner is rendered
    if (ghostWindow && !ghostWindow.isDestroyed()) {
      ghostWindow.webContents.send('overlay:private-mode-error', data);
      logger.debug('✅ [OVERLAY:IPC] Forwarded private mode error to ghost window for banner');
    } else {
      logger.warn('⚠️  [OVERLAY:IPC] Ghost window not available to show banner');
    }
  });
  
  // Handle enable live mode from banner and forward to prompt window
  ipcMain.on('banner:enable-live-mode', (event) => {
    logger.debug('🔄 [OVERLAY:IPC] Enable live mode requested from banner');
    
    // Forward to prompt window where connection toggle is
    if (promptWindow && !promptWindow.isDestroyed()) {
      promptWindow.webContents.send('banner:enable-live-mode');
      logger.debug('✅ [OVERLAY:IPC] Forwarded enable live mode to prompt window');
    } else {
      logger.warn('⚠️  [OVERLAY:IPC] Prompt window not available to toggle connection');
    }
  });

  // Online mode (Live Mode): set + broadcast to all overlay windows
  ipcMain.on('online-mode:set', (_event, enabled) => {
    onlineModeState = !!enabled;
    logger.debug(`🌐 [OVERLAY:IPC] Online mode set to: ${onlineModeState}`);

    const broadcast = (win) => {
      if (win && !win.isDestroyed()) {
        logger.debug(`🌐 [OVERLAY:IPC] Broadcasting online-mode:changed (${onlineModeState}) to window`);
        win.webContents.send('online-mode:changed', onlineModeState);
      } else {
        logger.debug(`🌐 [OVERLAY:IPC] Skipping broadcast (window missing or destroyed)`);
      }
    };

    broadcast(promptWindow);
    broadcast(ghostWindow);
    broadcast(intentWindow);
    broadcast(chatWindow);
  });

  // Online mode (Live Mode): get current state
  ipcMain.handle('online-mode:get', async () => {
    logger.debug(`🌐 [OVERLAY:IPC] online-mode:get -> ${onlineModeState}`);
    return { enabled: onlineModeState };
  });
  
  // Handle mouse event forwarding control
  ipcMain.on('overlay:set-ignore-mouse-events', (event, ignore, options) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.setIgnoreMouseEvents(ignore, options || { forward: true });
    }
  });
  
  // Handle ghost overlay click-through toggle (for banner interaction)
  ipcMain.on('ghost-overlay:set-clickthrough', (event, clickthrough) => {
    if (!ghostWindow || ghostWindow.isDestroyed()) {
      logger.warn('⚠️  [OVERLAY:IPC] Ghost window not available');
      return;
    }
    
    logger.debug(`🖱️  [OVERLAY:IPC] Setting ghost window click-through: ${clickthrough}`);
    ghostWindow.setIgnoreMouseEvents(clickthrough, { forward: true });
  });

  // Show/hide results window when prompt capture starts/stops
  ipcMain.on('prompt-capture:show-results', () => {
    if (!resultsWindow || resultsWindow.isDestroyed()) {
      logger.warn('⚠️  [OVERLAY:IPC] Results window not available');
      return;
    }
    
    logger.debug('�️  [OVERLAY:IPC] Showing results window (fixed at bottom-right)');
    if (!resultsWindow.isVisible()) {
      resultsWindow.show();
    }
  });
  
  ipcMain.on('prompt-capture:hide-results', () => {
    if (!resultsWindow || resultsWindow.isDestroyed()) {
      return;
    }
    
    logger.debug('� [OVERLAY:IPC] Hiding results window');
    if (resultsWindow.isVisible()) {
      resultsWindow.hide();
    }
  });

  // Handle resizing results window based on content
  ipcMain.on('results-window:resize', (event, { width, height }) => {
    if (!resultsWindow || resultsWindow.isDestroyed()) {
      return;
    }
    
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const margin = 20;
    
    // Clamp width and height to min/max bounds
    const minWidth = 400;
    const maxWidth = 600;
    const minHeight = 100;
    const maxHeight = 600;
    
    const newWidth = Math.min(Math.max(width, minWidth), maxWidth);
    const newHeight = Math.min(Math.max(height, minHeight), maxHeight);
    
    // Reposition to keep window at bottom-right
    const newX = screenWidth - newWidth - margin;
    const newY = screenHeight - newHeight - margin;
    
    logger.debug(`📏 [OVERLAY:IPC] Resizing results window to: ${newWidth}x${newHeight}`);
    resultsWindow.setBounds({
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    });
  });

  // Handle closing results window
  ipcMain.on('results-window:close', () => {
    if (resultsWindow && !resultsWindow.isDestroyed()) {
      logger.debug('❌ [OVERLAY:IPC] Closing results window');
      resultsWindow.hide();
      
      // Clear results state
      resultsState.hasResults = false;
      
      // Don't clear overlay state - PromptCaptureBox may still be active
      // Overlay state will be cleared when prompt capture is cancelled
    }
  });

  // Forward automation events to ghost window for visual effects
  ipcMain.on('automation:started', () => {
    if (ghostWindow && !ghostWindow.isDestroyed()) {
      logger.debug('🤖 [OVERLAY:IPC] Forwarding automation:started to ghost window');
      ghostWindow.webContents.send('automation:started');
    }
    
    // Update automation state to running
    automationState.isRunning = true;
    logger.debug('🏃 [OVERLAY:IPC] Automation started - setting isRunning=true');
    
    // Notify PromptBar of state change
    if (promptWindow && !promptWindow.isDestroyed()) {
      promptWindow.webContents.send('automation:state', automationState);
    }
    
    // Make intent window click-through during automation
    if (intentWindow && !intentWindow.isDestroyed()) {
      logger.debug('🖱️ [OVERLAY:IPC] Setting intent window to ignore mouse events during automation');
      intentWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  ipcMain.on('automation:ended', () => {
    if (ghostWindow && !ghostWindow.isDestroyed()) {
      logger.debug('✅ [OVERLAY:IPC] Forwarding automation:ended to ghost window');
      ghostWindow.webContents.send('automation:ended');
    }
    
    // Update automation state to not running
    automationState.isRunning = false;
    logger.debug('🛑 [OVERLAY:IPC] Automation ended - setting isRunning=false');
    
    // Notify PromptBar of state change
    if (promptWindow && !promptWindow.isDestroyed()) {
      promptWindow.webContents.send('automation:state', automationState);
    }
    
    // Restore intent window click handling after automation
    if (intentWindow && !intentWindow.isDestroyed()) {
      logger.debug('🖱️ [OVERLAY:IPC] Restoring intent window mouse events after automation');
      intentWindow.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on('ghost:mouse-move', (event, data) => {
    if (ghostWindow && !ghostWindow.isDestroyed()) {
      logger.debug(`👻 [OVERLAY:IPC] Forwarding ghost:mouse-move to ghost window: (${data.x}, ${data.y})`);
      ghostWindow.webContents.send('ghost:mouse-move', data);
    } else {
      logger.warn('⚠️ [OVERLAY:IPC] Ghost window not available for mouse-move');
    }
  });

  ipcMain.on('ghost:mouse-click', (event, data) => {
    if (ghostWindow && !ghostWindow.isDestroyed()) {
      logger.debug(`🖱️ [OVERLAY:IPC] Forwarding ghost:mouse-click to ghost window: (${data.x}, ${data.y})`);
      ghostWindow.webContents.send('ghost:mouse-click', data);
    } else {
      logger.warn('⚠️ [OVERLAY:IPC] Ghost window not available for mouse-click');
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
  ipcMain.on('overlay:resize-prompt', (_event, { width, height, animate = false }) => {
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

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const screenHeight = primaryDisplay.workAreaSize.height;
    
    const currentBounds = intentWindow.getBounds();
    const newWidth = width || currentBounds.width;
    const newHeight = height || currentBounds.height;
    
    // Keep the bottom edge flush to the bottom of the screen
    const newY = screenHeight - newHeight;
    
    intentWindow.setBounds({
      x: currentBounds.x,
      y: newY,
      width: newWidth,
      height: newHeight
    }, animate);
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
 * Send overlay payload to ghost window (new floating results) and intent window (legacy)
 * @param {object} payload - Overlay payload from graph
 */
function sendOverlayUpdate(payload) {
  logger.debug('📤 [OVERLAY:IPC] Sending overlay update:', {
    intent: payload.intent,
    uiVariant: payload.uiVariant,
    conversationId: payload.conversationId
  });
  
  // NEW: Send to ghost window for floating results display
  logger.debug('🔍 [OVERLAY:IPC] Ghost window check:', {
    exists: !!ghostWindow,
    isDestroyed: ghostWindow ? ghostWindow.isDestroyed() : 'N/A',
    hasWebContents: ghostWindow ? !!ghostWindow.webContents : 'N/A'
  });
  
  if (ghostWindow && !ghostWindow.isDestroyed()) {
    logger.debug('📤 [OVERLAY:IPC] Sending to ghost window...');
    
    // SOLUTION: Temporarily disable click-through to allow IPC, then re-enable
    try {
      // 1. Disable click-through temporarily
      ghostWindow.setIgnoreMouseEvents(false);
      logger.debug('� [OVERLAY:IPC] Temporarily disabled click-through for IPC');
      
      // 2. Send IPC event normally (Electron's native, reliable IPC)
      ghostWindow.webContents.send('overlay:update', payload);
      logger.debug('✅ [OVERLAY:IPC] Sent overlay:update via native IPC');
      
      // 3. Re-enable click-through immediately (next tick to ensure IPC is sent)
      setImmediate(() => {
        if (ghostWindow && !ghostWindow.isDestroyed()) {
          ghostWindow.setIgnoreMouseEvents(true, { forward: true });
          logger.debug('🔒 [OVERLAY:IPC] Re-enabled click-through');
        }
      });
    } catch (err) {
      logger.error('❌ [OVERLAY:IPC] Failed to send to ghost window:', err);
      // Ensure click-through is restored even on error
      if (ghostWindow && !ghostWindow.isDestroyed()) {
        ghostWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    }
  } else {
    logger.warn('⚠️  [OVERLAY:IPC] Ghost window not available for update');
  }
  
  // Send updates to results window (loading and results states)
  if (resultsWindow && !resultsWindow.isDestroyed()) {
    if (payload.uiVariant === 'loading' || payload.uiVariant === 'results') {
      logger.debug(`📤 [OVERLAY:IPC] Sending ${payload.uiVariant} state to results window`);
      
      // Send the payload (loading or results)
      resultsWindow.webContents.send('overlay:update', payload);
      
      if (payload.uiVariant === 'results') {
        // Mark that we have results
        resultsState.hasResults = true;
        
        // Send prompt text to results window for header display
        const promptText = payload.slots?.subject || payload.slots?.query || 'Results';
        resultsWindow.webContents.send('results-window:set-prompt', promptText);
        logger.debug('📝 [OVERLAY:IPC] Sent prompt text to results window:', promptText);
        
        // Notify PromptBar based on intent
        if (payload.intent === 'screen_intelligence') {
          notifyScreenIntelligenceResults();
        }
      }
    }
  }
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
 * Handle intent window hide request
 * Hides the intent window when user clicks close button
 */
ipcMain.on('intent-window:hide', (event) => {
  logger.debug('👻 [OVERLAY:IPC] Intent window hide requested');
  
  if (!intentWindow || intentWindow.isDestroyed()) {
    logger.warn('⚠️  [OVERLAY:IPC] Intent window not available');
    return;
  }
  
  intentWindow.hide();
  logger.debug('✅ [OVERLAY:IPC] Intent window hidden');
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
  
  logger.debug('📊 [OVERLAY:IPC] Web search results available, notifying PromptBar');
  
  // 🎯 CONDITIONAL DISPLAY: Only show intent window if chat window is NOT visible
  if (chatWindowState.isVisible) {
    logger.debug('💬 [OVERLAY:IPC] Chat window is open - keeping results in chat, not showing intent overlay');
    webSearchState.isVisible = false;
  } else {
    logger.debug('🚫 [OVERLAY:IPC] Chat window closed - showing web search intent overlay');
    webSearchState.isVisible = true;
    screenIntelligenceState.isVisible = false;
    commandExecuteState.isVisible = false;
  }
  
  // Notify prompt window of all state changes
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('web-search:state', webSearchState);
    promptWindow.webContents.send('chat-window:state', chatWindowState);
    promptWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
    promptWindow.webContents.send('command-execute:state', commandExecuteState);
  }
  
  // Notify intent window to hide other intent components
  if (intentWindow && !intentWindow.isDestroyed()) {
    intentWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
    intentWindow.webContents.send('command-execute:state', commandExecuteState);
  }
}

/**
 * Notify that automation is in progress
 * Called when sending overlay update with automation_progress
 */
function notifyAutomationProgress() {
  automationState.hasAutomation = true;
  
  logger.debug('📊 [OVERLAY:IPC] Automation in progress, notifying PromptBar');
  
  // 🎯 CONDITIONAL DISPLAY: Only show intent window if chat window is NOT visible
  if (chatWindowState.isVisible) {
    logger.debug('💬 [OVERLAY:IPC] Chat window is open - keeping automation in chat, not showing intent overlay');
    automationState.isVisible = false;
  } else {
    logger.debug('🚫 [OVERLAY:IPC] Chat window closed - showing automation intent overlay');
    automationState.isVisible = true;
    webSearchState.isVisible = false;
    screenIntelligenceState.isVisible = false;
    commandExecuteState.isVisible = false;
  }
  
  // Notify prompt window of all state changes
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('automation:state', automationState);
    promptWindow.webContents.send('chat-window:state', chatWindowState);
    promptWindow.webContents.send('web-search:state', webSearchState);
    promptWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
    promptWindow.webContents.send('command-execute:state', commandExecuteState);
  }
  
  // Notify intent window to hide other intent components
  if (intentWindow && !intentWindow.isDestroyed()) {
    intentWindow.webContents.send('web-search:state', webSearchState);
    intentWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
    intentWindow.webContents.send('command-execute:state', commandExecuteState);
  }
}

/**
 * Handle automation toggle from PromptBar
 */
ipcMain.on('automation:toggle', (event) => {
  logger.debug('🔄 [OVERLAY:IPC] Automation toggle requested');
  
  // Toggle visibility
  automationState.isVisible = !automationState.isVisible;
  
  logger.debug(`📊 [OVERLAY:IPC] Automation visibility: ${automationState.isVisible}`);
  
  // Notify PromptBar of state change
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('automation:state', automationState);
  }
  
  // Notify Intent window of visibility change
  if (intentWindow && !intentWindow.isDestroyed()) {
    intentWindow.webContents.send('automation:set-visibility', automationState.isVisible);
    
    // Hide or show the window
    if (automationState.isVisible) {
      intentWindow.show();
    } else {
      intentWindow.hide();
    }
  }
});

/**
 * Handle screen intelligence toggle from PromptBar or ScreenIntelligenceResults
 */
ipcMain.on('screen-intelligence:toggle', (event) => {
  logger.debug('🔄 [OVERLAY:IPC] Screen intelligence toggle requested');
  
  // Toggle visibility
  screenIntelligenceState.isVisible = !screenIntelligenceState.isVisible;
  
  logger.debug(`📊 [OVERLAY:IPC] Screen intelligence visibility: ${screenIntelligenceState.isVisible}`);
  
  // Notify PromptBar of state change
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
  }
  
  // Notify Intent window of visibility change
  if (intentWindow && !intentWindow.isDestroyed()) {
    intentWindow.webContents.send('screen-intelligence:set-visibility', screenIntelligenceState.isVisible);
    
    // Hide or show the window
    if (screenIntelligenceState.isVisible) {
      intentWindow.show();
    } else {
      intentWindow.hide();
    }
  }
});

/**
 * Notify that screen intelligence results are available
 * Called when sending overlay update with screen intelligence results
 */
function notifyScreenIntelligenceResults() {
  screenIntelligenceState.hasResults = true;
  
  logger.debug('📊 [OVERLAY:IPC] Screen intelligence results available, notifying PromptBar');
  
  // 🎯 CONDITIONAL DISPLAY: Only show intent window if chat window is NOT visible
  if (chatWindowState.isVisible) {
    logger.debug('💬 [OVERLAY:IPC] Chat window is open - keeping results in chat, not showing intent overlay');
    screenIntelligenceState.isVisible = false;
  } else {
    logger.debug('🚫 [OVERLAY:IPC] Chat window closed - showing screen intelligence intent overlay');
    screenIntelligenceState.isVisible = true;
    webSearchState.isVisible = false;
    commandExecuteState.isVisible = false;
  }
  
  // Notify prompt window of all state changes
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
    promptWindow.webContents.send('chat-window:state', chatWindowState);
    promptWindow.webContents.send('web-search:state', webSearchState);
    promptWindow.webContents.send('command-execute:state', commandExecuteState);
  }
  
  // Notify intent window to hide other intent components
  if (intentWindow && !intentWindow.isDestroyed()) {
    intentWindow.webContents.send('web-search:state', webSearchState);
    intentWindow.webContents.send('command-execute:state', commandExecuteState);
  }
}

/**
 * Notify that command execute results are available
 * Called when sending overlay update with command execution results
 */
function notifyCommandExecuteResults() {
  commandExecuteState.hasResults = true;
  
  logger.debug('📊 [OVERLAY:IPC] Command execute results available, notifying PromptBar');
  
  // 🎯 CONDITIONAL DISPLAY: Only show intent window if chat window is NOT visible
  if (chatWindowState.isVisible) {
    logger.debug('💬 [OVERLAY:IPC] Chat window is open - keeping results in chat, not showing intent overlay');
    commandExecuteState.isVisible = false;
  } else {
    logger.debug('🚫 [OVERLAY:IPC] Chat window closed - showing command execute intent overlay');
    commandExecuteState.isVisible = true;
    webSearchState.isVisible = false;
    screenIntelligenceState.isVisible = false;
  }
  
  // Notify prompt window of all state changes
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('command-execute:state', commandExecuteState);
    promptWindow.webContents.send('chat-window:state', chatWindowState);
    promptWindow.webContents.send('web-search:state', webSearchState);
    promptWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
  }
  
  // Notify intent window to hide other intent components
  if (intentWindow && !intentWindow.isDestroyed()) {
    intentWindow.webContents.send('web-search:state', webSearchState);
    intentWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
  }
}

/**
 * Handle chat window toggle from PromptBar or UnifiedInterface
 */
ipcMain.on('chat-window:toggle', (event) => {
  // Prevent rapid successive toggles (debounce 300ms)
  if (chatToggleLock) {
    logger.debug('⏭️  [OVERLAY:IPC] Chat window toggle ignored (locked)');
    return;
  }
  
  chatToggleLock = true;
  setTimeout(() => { chatToggleLock = false; }, 300);
  
  logger.debug('🔄 [OVERLAY:IPC] Chat window toggle requested');
  
  // Get current window visibility state before toggling
  const wasVisible = chatWindowState.isVisible;
  
  // Toggle visibility
  chatWindowState.isVisible = !chatWindowState.isVisible;
  
  logger.debug(`📊 [OVERLAY:IPC] Chat window visibility: ${wasVisible} → ${chatWindowState.isVisible}`);
  
  // 🎯 MUTUAL EXCLUSION: If chat window is opening, hide all intent windows
  if (chatWindowState.isVisible && !wasVisible) {
    logger.debug('🚫 [OVERLAY:IPC] Chat window opening - hiding all intent windows');
    webSearchState.isVisible = false;
    screenIntelligenceState.isVisible = false;
    commandExecuteState.isVisible = false;
    
    // Notify intent window to hide all intent components
    if (intentWindow && !intentWindow.isDestroyed()) {
      intentWindow.webContents.send('web-search:state', webSearchState);
      intentWindow.webContents.send('screen-intelligence:state', screenIntelligenceState);
      intentWindow.webContents.send('command-execute:state', commandExecuteState);
    }
  }
  
  // Notify PromptBar of state change
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.webContents.send('chat-window:state', chatWindowState);
  }
  
  // Notify ChatWindow component of state change (only if state actually changed)
  if (chatWindow && !chatWindow.isDestroyed() && wasVisible !== chatWindowState.isVisible) {
    chatWindow.webContents.send('chat-window:state', chatWindowState);
  }
  
  // Hide or show the window (only if state actually changed)
  if (chatWindow && !chatWindow.isDestroyed()) {
    const isCurrentlyVisible = chatWindow.isVisible();
    
    if (chatWindowState.isVisible && !isCurrentlyVisible) {
      // Only show/focus if window is actually hidden
      logger.debug('👁️  [OVERLAY:IPC] Showing chat window (was hidden)');
      chatWindow.show();
      chatWindow.focus();
    } else if (!chatWindowState.isVisible && isCurrentlyVisible) {
      // Only hide if window is actually visible
      logger.debug('🙈 [OVERLAY:IPC] Hiding chat window (was visible)');
      chatWindow.hide();
    } else {
      logger.debug(`⏭️  [OVERLAY:IPC] Chat window already in desired state (visible: ${isCurrentlyVisible}), skipping show/hide`);
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
 * Handle message added notification - forward to chat window
 */
ipcMain.on('conversation:message-added', (event, data) => {
  logger.debug('📨 [OVERLAY:IPC] Message added notification:', data);
  
  // Forward to chat window to reload messages
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('conversation:message-added', data);
    logger.debug('✅ [OVERLAY:IPC] Forwarded message-added to chat window');
  }
});

/**
 * Handle processing started notification - forward to chat window
 */
ipcMain.on('conversation:processing-started', (event, data) => {
  logger.debug('💭 [OVERLAY:IPC] Processing started notification:', data);
  
  // Forward to chat window to show thinking indicator
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('conversation:processing-started', data);
    logger.debug('✅ [OVERLAY:IPC] Forwarded processing-started to chat window');
  }
});

/**
 * Handle processing complete notification - forward to chat window
 */
ipcMain.on('conversation:processing-complete', (event, data) => {
  logger.debug('✅ [OVERLAY:IPC] Processing complete notification:', data);
  
  // Forward to chat window to hide thinking indicator
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('conversation:processing-complete', data);
    logger.debug('✅ [OVERLAY:IPC] Forwarded processing-complete to chat window');
  }
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

/**
 * Check if chat window is currently visible
 * @returns {boolean}
 */
function isChatWindowVisible() {
  return chatWindowState.isVisible;
}

function getResultsWindow() {
  return resultsWindow;
}

function getGhostWindow() {
  return ghostWindow;
}

function hasResults() {
  return resultsState.hasResults;
}

function setOnlineMode(enabled) {
  onlineModeState = !!enabled;
  logger.debug(`🌐 [OVERLAY:IPC] Online mode programmatically set to: ${onlineModeState}`);

  const broadcast = (win) => {
    if (win && !win.isDestroyed()) {
      logger.debug(`🌐 [OVERLAY:IPC] Broadcasting online-mode:changed (${onlineModeState}) to window`);
      win.webContents.send('online-mode:changed', onlineModeState);
    }
  };

  broadcast(promptWindow);
  broadcast(ghostWindow);
  broadcast(intentWindow);
  broadcast(chatWindow);
}

module.exports = {
  initializeOverlayIPC,
  sendOverlayUpdate,
  notifyWebSearchResults,
  notifyScreenIntelligenceResults,
  notifyCommandExecuteResults,
  isOverlayReady,
  isChatWindowVisible,
  getResultsWindow,
  getGhostWindow,
  hasResults,
  setOnlineMode
};
