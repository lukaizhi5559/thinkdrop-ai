// IPC Handlers for ThinkDrop AI Electron App
// Extracted from main.cjs for better code organization

const { ipcMain, BrowserWindow, screen } = require('electron');

const logger = require('./../logger.cjs');
// Initialize IPC handlers with window references and state
function initializeIPCHandlers({
  overlayWindow,
  coreAgent,
  localLLMAgent,
  windowState,
  windowCreators
}) {

  // Destructure window state
  let {
    isGloballyVisible,
    isOverlayVisible,
  } = windowState;

  // Destructure window creators
  const {
    toggleOverlay,
  } = windowCreators;

  // ========================================
  // LOCAL LLM FALLBACK HANDLERS
  // ========================================


  // ========================================
  // OVERLAY WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('toggle-overlay', () => {
    toggleOverlay();
  });
  
  // FAB button toggle overlay handler
  ipcMain.handle('fab:toggle-overlay', () => {
    logger.debug('🎯 [FAB] Toggle overlay triggered from FAB button');
    toggleOverlay();
  });
  
  // Guide window handlers
  const { getGuideWindow, showGuideWindow, hideGuideWindow } = require('../windows/guide-window.cjs');
  
  ipcMain.on('guide:show', (event, guideData) => {
    logger.debug('📚 [GUIDE] Show guide window with data:', guideData);
    const guideWindow = getGuideWindow();
    if (guideWindow && !guideWindow.isDestroyed()) {
      // Send guide data to React-based guide window
      guideWindow.webContents.send('guide:show', guideData);
      // Show the window
      showGuideWindow();
    }
  });
  
  ipcMain.on('guide:execute', async (event, data) => {
    logger.debug('🎯 [GUIDE] Execute guide requested:', data);
    
    // Execute guide via MCP command service
    try {
      const mcpClient = global.mcpClient;
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }
      
      const result = await mcpClient.callService(
        'command',
        'command.guide.execute',
        {
          guideId: data.guideId,
          fromStep: data.fromStep
        },
        { timeout: 300000 } // 5 minutes for execution
      );
      
      logger.debug('✅ [GUIDE] Execution result:', result);
      
      // Send result back to guide window
      const guideWindow = getGuideWindow();
      if (guideWindow && !guideWindow.isDestroyed()) {
        guideWindow.webContents.send('guide:execution-result', result);
      }
    } catch (error) {
      logger.error('❌ [GUIDE] Execution error:', error);
      const guideWindow = getGuideWindow();
      if (guideWindow && !guideWindow.isDestroyed()) {
        guideWindow.webContents.send('guide:execution-result', { 
          success: false, 
          error: error.message 
        });
      }
    }
  });
  
  ipcMain.on('guide:abort', async (event, data) => {
    logger.debug('🛑 [GUIDE] Abort guide requested:', data);
    
    // Abort guide via MCP command service
    try {
      const mcpClient = global.mcpClient;
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }
      
      await mcpClient.callService(
        'command',
        'command.guide.execute',
        {
          guideId: data.guideId,
          abort: true
        },
        { timeout: 10000 } // 10 seconds for abort
      );
      
      logger.debug('✅ [GUIDE] Abort successful');
    } catch (error) {
      logger.error('❌ [GUIDE] Abort error:', error);
    }
  });
  
  ipcMain.on('guide:close', () => {
    logger.debug('❌ [GUIDE] Close guide window');
    hideGuideWindow();
  });

  ipcMain.handle('hide-overlay', () => {
    if (overlayWindow) {
      overlayWindow.hide();
      windowState.isOverlayVisible = false;
    }
  });

  ipcMain.handle('show-overlay', () => {
    if (overlayWindow) {
      overlayWindow.show();
      overlayWindow.focus();
      windowState.isOverlayVisible = true;
      windowState.isGloballyVisible = true;
    }
  });

  ipcMain.handle('get-global-visibility', () => {
    return windowState.isGloballyVisible;
  });

  // ========================================
  // UNIFIED WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('toggle-chat', () => {
    // Chat functionality now handled by unified overlay React components
    logger.debug('Chat toggle handled by unified interface');
  });

  ipcMain.handle('show-chat', () => {
    // Chat functionality now handled by unified overlay React components
    logger.debug('Show chat handled by unified interface');
  });

  ipcMain.handle('hide-chat', () => {
    // Chat functionality now handled by unified overlay React components
    logger.debug('Hide chat handled by unified interface');
  });

  ipcMain.handle('toggle-chat-messages', () => {
    // Chat messages functionality now handled by unified overlay React components
    logger.debug('Chat messages toggle handled by unified interface');
  });

  ipcMain.handle('show-chat-messages', () => {
    // Chat messages functionality now handled by unified overlay React components
    logger.debug('Show chat messages handled by unified interface');
  });

  ipcMain.handle('hide-chat-messages', () => {
    // Chat messages functionality now handled by unified overlay React components
    logger.debug('Hide chat messages handled by unified interface');
  });

  // ========================================
  // INSIGHT WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('show-insight', () => {
    // Insight functionality now handled by unified overlay React components
    logger.debug('Show insight handled by unified interface');
  });

  ipcMain.handle('hide-insight', () => {
    // Insight functionality now handled by unified overlay React components
    logger.debug('Hide insight handled by unified interface');
  });

  // ========================================
  // MEMORY DEBUGGER WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('show-memory-debugger', () => {
    // Memory debugger functionality now handled by unified overlay React components
    logger.debug('Show memory debugger handled by unified interface');
  });

  ipcMain.handle('hide-memory-debugger', () => {
    // Memory debugger functionality now handled by unified overlay React components
    logger.debug('Hide memory debugger handled by unified interface');
  });

  // ========================================
  // CHAT MESSAGING SYSTEM HANDLERS
  // ========================================

  ipcMain.handle('send-chat-message', async (event, message) => {
    // This handler is deprecated - follow-up questions now regenerate insights
    // instead of sending to chat
    logger.debug('⚠️ [IPC] send-chat-message called but deprecated');
  });

  ipcMain.handle('adjust-chat-messages-height', (event, height) => {
    // Height adjustment now handled by unified overlay React components
  });

  ipcMain.handle('focus-chat-input', () => {
    // Focus management now handled by unified overlay React components
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.focus();
      overlayWindow.webContents.focus();
    }
  });

  ipcMain.handle('notify-message-loaded', () => {
    // Message loading notifications now handled by unified overlay React components
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('message-loaded');
    }
  });

  // ========================================
  // AGENT ORCHESTRATION HANDLERS
  // ========================================

  // External link handler
  ipcMain.handle('open-external-link', async (event, url) => {
    const { shell } = require('electron');
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      logger.error('❌ Failed to open external link:', error);
      return { success: false, error: error.message };
    }
  });

  // Direct agent execution handler
  ipcMain.handle('agent-execute', async (event, request) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      const result = await coreAgent.executeAgent(request.agentName, {
        action: request.action,
        message: request.message,
        input: request.input,
        options: request.options,
        ...request
      });
      
      return result;
    } catch (error) {
      logger.error('❌ Agent execution failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Unified IPC handler for all agent operations (Memory, InsightView, Messages, etc.)
  // Routes through AgentOrchestrator.ask() for unified agent execution
  ipcMain.handle('agent-orchestrate', async (event, intentPayload) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      logger.debug('🎯 Unified agent orchestration received:', intentPayload);
      
      // Check if this is a local LLM fallback request
      if (intentPayload.intent === 'local_llm_fallback' || intentPayload.context?.source === 'local_fallback') {
        logger.debug('🤖 Routing to local LLM fallback orchestration');
        const result = await coreAgent.handleLocalOrchestration(
          intentPayload.message, 
          intentPayload.context || {},
          false // Backend is disconnected
        );
        logger.debug('✅ Local LLM orchestration completed:', result);
        logger.debug('🔍 [DEBUG] Orchestration result structure:', {
          hasResult: !!result,
          hasResponse: !!(result && result.response),
          resultKeys: result ? Object.keys(result) : 'null',
          responseValue: result ? result.response : 'undefined'
        });
        
        // Broadcast orchestration update to frontend if result contains response
        if (result && result.response) {
          broadcastOrchestrationUpdate({
            type: 'orchestration-complete',
            response: result.response,
            handledBy: result.handledBy,
            method: result.method,
            timestamp: result.timestamp
          }, windows);
        }
        
        return result; // Return result directly (already has success/error structure)
      }
      
      // DEPRECATED: WebSocket backend response storage (removed in Phase 3 cleanup)
      if (intentPayload.intent === 'websocket_backend_response') {
        logger.warn('⚠️ websocket_backend_response intent deprecated - handler removed in Phase 3 cleanup');
        // TODO: Implement MCP-compatible WebSocket response storage if needed
        return { success: false, error: 'WebSocket backend response handler deprecated' };
      }

      // DEPRECATED: WebSocket context extraction (removed in Phase 3 cleanup)
      if (intentPayload.intent === 'extract_websocket_context') {
        logger.warn('⚠️ extract_websocket_context intent deprecated - handler removed in Phase 3 cleanup');
        // TODO: Implement MCP-compatible context extraction if needed
        return { success: false, error: 'WebSocket context extraction handler deprecated' };
      }

      // Route all other requests through AgentOrchestrator.ask()
      // AgentOrchestrator will handle:
      // 1. Agent validation and security checks
      // 2. Intent routing via switch statement (greeting, memory_store, command, question)
      // 3. Agent execution and result return
      const result = await coreAgent.ask(intentPayload);
      
      logger.debug('✅ Unified agent orchestration completed:', result);
      return { success: true, data: result };
    } catch (error) {
      logger.error('❌ Unified agent orchestration error:', error);
      return { success: false, error: error.message };
    }
  });

  // Continue in next part due to length...
  return {
    // Export functions that need to be accessible
    broadcastOrchestrationUpdate,
    sendClarificationRequest
  };
}

// Helper functions for orchestration updates
function broadcastOrchestrationUpdate(updateData, windows) {
  logger.debug('📡 [BROADCAST-FUNC] Broadcasting to windows:', Object.keys(windows || {}));
  
  // Send to all available windows, not just overlayWindow
  const { overlayWindow } = windows;
  const windowList = [overlayWindow].filter(Boolean);
  
  logger.debug('📡 [BROADCAST-FUNC] Valid windows found:', windowList.length);
  
  windowList.forEach((window, index) => {
    if (window && !window.isDestroyed()) {
      logger.debug(`📡 [BROADCAST-FUNC] Sending to window ${index + 1}:`, window.constructor.name);
      window.webContents.send('orchestration-update', updateData);
      logger.debug(`✅ [BROADCAST-FUNC] Successfully sent to window ${index + 1}`);
    } else {
      logger.warn(`⚠️ [BROADCAST-FUNC] Window ${index + 1} is destroyed or null`);
    }
  });
  
  if (windowList.length === 0) {
    logger.error('❌ [BROADCAST-FUNC] No valid windows found to broadcast to!');
  }
}

function sendClarificationRequest(clarificationData, windows) {
  const { overlayWindow, insightWindow } = windows;
  const windowList = [overlayWindow, insightWindow];
  
  windowList.forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('clarification-request', clarificationData);
    }
  });
}

module.exports = {
  initializeIPCHandlers,
  broadcastOrchestrationUpdate,
  sendClarificationRequest
};
