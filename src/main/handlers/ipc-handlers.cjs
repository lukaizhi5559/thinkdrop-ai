// IPC Handlers for ThinkDrop AI Electron App
// Extracted from main.cjs for better code organization

const { ipcMain, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    isChatVisible,
    isInsightVisible,
    isMemoryDebuggerVisible,
    isOrchestrationActive,
    visibleWindows
  } = windowState;

  // Destructure window creators
  const {
    createChatMessagesWindow,
    createInsightWindow,
    createMemoryDebuggerWindow,
    toggleOverlay,
    toggleChat
  } = windowCreators;

  // ========================================
  // OVERLAY WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('toggle-overlay', () => {
    toggleOverlay();
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

  ipcMain.handle('hide-all-windows', () => {
    // Hide all ThinkDrop AI windows
    if (overlayWindow) {
      overlayWindow.hide();
    }
    // All functionality now handled by unified overlayWindow
    windowState.isOverlayVisible = false;
    windowState.isChatVisible = false;
    windowState.isInsightVisible = false;
    windowState.isMemoryDebuggerVisible = false;
    windowState.isGloballyVisible = false;
  });

  ipcMain.handle('show-all-windows', () => {
    // Show overlay window (chat windows will be shown when needed)
    if (overlayWindow) {
      overlayWindow.show();
      overlayWindow.focus();
      windowState.isOverlayVisible = true;
      windowState.isGloballyVisible = true;
    }
    // Restore previously visible windows
    if (windowState.visibleWindows.includes('insightWindow') && insightWindow) {
      insightWindow.show();
      insightWindow.focus();
      windowState.isInsightVisible = true;
      windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'insightWindow');
    }
    // All window functionality now handled by unified overlayWindow
    // Individual window state is managed by React components
  });

  ipcMain.handle('get-global-visibility', () => {
    return windowState.isGloballyVisible;
  });

  // ========================================
  // UNIFIED WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('toggle-chat', () => {
    // Chat functionality now handled by unified overlay React components
    console.log('Chat toggle handled by unified interface');
  });

  ipcMain.handle('show-chat', () => {
    // Chat functionality now handled by unified overlay React components
    console.log('Show chat handled by unified interface');
  });

  ipcMain.handle('hide-chat', () => {
    // Chat functionality now handled by unified overlay React components
    console.log('Hide chat handled by unified interface');
  });

  ipcMain.handle('toggle-chat-messages', () => {
    // Chat messages functionality now handled by unified overlay React components
    console.log('Chat messages toggle handled by unified interface');
  });

  ipcMain.handle('show-chat-messages', () => {
    // Chat messages functionality now handled by unified overlay React components
    console.log('Show chat messages handled by unified interface');
  });

  ipcMain.handle('hide-chat-messages', () => {
    // Chat messages functionality now handled by unified overlay React components
    console.log('Hide chat messages handled by unified interface');
  });

  // ========================================
  // INSIGHT WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('show-insight', () => {
    // Insight functionality now handled by unified overlay React components
    console.log('Show insight handled by unified interface');
  });

  ipcMain.handle('hide-insight', () => {
    // Insight functionality now handled by unified overlay React components
    console.log('Hide insight handled by unified interface');
  });

  // ========================================
  // MEMORY DEBUGGER WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('show-memory-debugger', () => {
    // Memory debugger functionality now handled by unified overlay React components
    console.log('Show memory debugger handled by unified interface');
  });

  ipcMain.handle('hide-memory-debugger', () => {
    // Memory debugger functionality now handled by unified overlay React components
    console.log('Hide memory debugger handled by unified interface');
  });

  // ========================================
  // CHAT MESSAGING SYSTEM HANDLERS
  // ========================================

  ipcMain.handle('send-chat-message', async (event, message) => {
    // Chat messaging now handled by unified overlay React components
    console.log('Send chat message handled by unified interface');
    
    // Forward to unified overlay window instead
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('chat-message', {
        id: Date.now().toString(),
        text: message.text,
        sender: 'user',
        timestamp: message.timestamp
      });
    }
  });

  ipcMain.handle('adjust-chat-messages-height', (event, height) => {
    // Height adjustment now handled by unified overlay React components
    console.log('Chat height adjustment handled by unified interface');
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

  // Unified IPC handler for all agent operations (Memory, InsightView, Messages, etc.)
  // Routes through AgentOrchestrator.ask() for unified agent execution
  ipcMain.handle('agent-orchestrate', async (event, intentPayload) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      console.log('🎯 Unified agent orchestration received:', intentPayload);
      
      // Check if this is a local LLM fallback request
      if (intentPayload.intent === 'local_llm_fallback' || intentPayload.context?.source === 'local_fallback') {
        console.log('🤖 Routing to local LLM fallback orchestration');
        const result = await coreAgent.handleLocalOrchestration(
          intentPayload.message, 
          intentPayload.context || {},
          false // Backend is disconnected
        );
        console.log('✅ Local LLM orchestration completed:', result);
        return result; // Return result directly (already has success/error structure)
      }
      
      // Route all other requests through AgentOrchestrator.ask()
      // AgentOrchestrator will handle:
      // 1. Agent validation and security checks
      // 2. Intent routing via switch statement (greeting, memory_store, command, question)
      // 3. Agent execution and result return
      const result = await coreAgent.ask(intentPayload);
      
      console.log('✅ Unified agent orchestration completed:', result);
      return { success: true, data: result };
    } catch (error) {
      console.error('❌ Unified agent orchestration error:', error);
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
  const { overlayWindow } = windows;
  const windowList = [overlayWindow];
  
  windowList.forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('orchestration-update', updateData);
    }
  });
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
