// IPC Handlers for ThinkDrop AI Electron App
// Extracted from main.cjs for better code organization

const { ipcMain, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Initialize IPC handlers with window references and state
function initializeIPCHandlers({
  overlayWindow,
  chatWindow, 
  chatMessagesWindow,
  insightWindow,
  memoryDebuggerWindow,
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
    if (chatWindow) {
      chatWindow.hide();
    }
    if (chatMessagesWindow) {
      chatMessagesWindow.hide();
    }
    if (insightWindow && !global.isOrchestrationActive) {
      insightWindow.hide();
      windowState.visibleWindows.push('insightWindow');
    } else if (insightWindow && global.isOrchestrationActive) {
      console.log('🛡️ Protecting insight window during orchestration - not hiding in hide-all-windows');
    }
    if (memoryDebuggerWindow) {
      console.log('🔍 hide-all-windows hiding Memory Debugger');
      memoryDebuggerWindow.hide();
    }
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
    if (windowState.visibleWindows.includes('chatWindow') && chatWindow) {
      chatWindow.show();
      windowState.isChatVisible = true;
      windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'chatWindow');
    }
    if (windowState.visibleWindows.includes('chatMessagesWindow') && chatMessagesWindow) {
      chatMessagesWindow.show();
      windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'chatMessagesWindow');
    }
    if (windowState.visibleWindows.includes('memoryDebuggerWindow') && memoryDebuggerWindow) {
      memoryDebuggerWindow.show();
      windowState.isMemoryDebuggerVisible = true;
      windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'memoryDebuggerWindow');
    }
  });

  ipcMain.handle('get-global-visibility', () => {
    return windowState.isGloballyVisible;
  });

  // ========================================
  // CHAT WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('toggle-chat', () => {
    toggleChat();
  });

  ipcMain.handle('show-chat', () => {
    // Redirect to unified ChatMessages window
    if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
      createChatMessagesWindow();
    } else {
      chatMessagesWindow.show();
      chatMessagesWindow.focus();
    }
  });

  ipcMain.handle('hide-chat', () => {
    // Redirect to unified ChatMessages window
    if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
      chatMessagesWindow.hide();
      windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'chatMessagesWindow');
    }
  });

  ipcMain.handle('show-chat-messages', () => {
    console.log('🔍 Showing Chat Messages window');
    try {
      // Ensure only one chat messages window exists
      if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
        chatMessagesWindow.show();
        chatMessagesWindow.focus();
        return;
      }
      
      // Create new window if needed
      if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
        // Use the window creator function from main.cjs
        if (typeof windowCreators.createChatMessagesWindow === 'function') {
          chatMessagesWindow = windowCreators.createChatMessagesWindow();
        } else {
          console.error('❌ createChatMessagesWindow function not available');
          return;
        }
      }
      
      // Show the chat messages window if it exists now
      if (chatMessagesWindow) {
        chatMessagesWindow.show();
        chatMessagesWindow.focus();
        windowState.visibleWindows.push('chatMessagesWindow');
      }
    } catch (error) {
      console.error('Error occurred in show-chat-messages handler:', error);
    }
  });

  ipcMain.handle('hide-chat-messages', () => {
    console.log('🔍 hide-chat-messages IPC called');
    try {
      if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
        chatMessagesWindow.hide();
        windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'chatMessagesWindow');
      }
    } catch (error) {
      console.error('Error occurred in hide-chat-messages handler:', error);
    }
  });

  // ========================================
  // INSIGHT WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('show-insight', () => {
    console.log('🔍 Showing Insight window');
    try {
      if (!insightWindow || insightWindow.isDestroyed()) {
        // Use the window creator function from main.cjs
        if (typeof windowCreators.createInsightWindow === 'function') {
          insightWindow = windowCreators.createInsightWindow();
        } else {
          console.error('❌ createInsightWindow function not available');
          return;
        }
      } else {
        insightWindow.show();
        insightWindow.focus();
        windowState.isInsightVisible = true;
        windowState.visibleWindows.push('insightWindow');
      }
    } catch (error) {
      console.error('Error occurred in show-insight handler:', error);
    }
  });

  ipcMain.handle('hide-insight', () => {
    console.log('🔍 hide-insight IPC called');
    try {
      if (insightWindow && !insightWindow.isDestroyed()) {
        insightWindow.hide();
        windowState.isInsightVisible = false;
        windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'insightWindow');
      }
    } catch (error) {
      console.error('Error occurred in hide-insight handler:', error);
    }
  });

  // ========================================
  // MEMORY DEBUGGER WINDOW CONTROL HANDLERS
  // ========================================

  ipcMain.handle('show-memory-debugger', () => {
    console.log('🔍 Showing Memory Debugger window');
    try {
      // Ensure only one memory debugger window exists
      if (memoryDebuggerWindow && !memoryDebuggerWindow.isDestroyed()) {
        memoryDebuggerWindow.show();
        memoryDebuggerWindow.focus();
        return;
      }
      
      // Create new window if needed
      if (!memoryDebuggerWindow || memoryDebuggerWindow.isDestroyed()) {
        // Use the window creator function from main.cjs
        if (typeof windowCreators.createMemoryDebuggerWindow === 'function') {
          memoryDebuggerWindow = windowCreators.createMemoryDebuggerWindow();
        } else {
          console.error('❌ createMemoryDebuggerWindow function not available');
          return;
        }
      }
      
      // Show the memory debugger window if it exists now
      if (memoryDebuggerWindow) {
        memoryDebuggerWindow.show();
        memoryDebuggerWindow.focus();
        windowState.visibleWindows.push('memoryDebuggerWindow');
      }
    } catch (error) {
      console.error('Error occurred in show-memory-debugger handler:', error);
    }
  });

  ipcMain.handle('hide-memory-debugger', () => {
    console.log('🔍 hide-memory-debugger IPC called');
    try {
      if (memoryDebuggerWindow && !memoryDebuggerWindow.isDestroyed()) {
        memoryDebuggerWindow.hide();
        windowState.visibleWindows = windowState.visibleWindows.filter((window) => window !== 'memoryDebuggerWindow');
      }
    } catch (error) {
      console.error('Error occurred in hide-memory-debugger handler:', error);
    }
  });

  // ========================================
  // CHAT MESSAGING SYSTEM HANDLERS
  // ========================================

  ipcMain.handle('send-chat-message', async (event, message) => {
    // Ensure only one chat messages window exists
    if (!chatMessagesWindow || chatMessagesWindow.isDestroyed()) {
      createChatMessagesWindow();
    }
    
    // Show the chat messages window
    chatMessagesWindow.show();
    chatMessagesWindow.focus();
    
    // Send the user message to the chat messages window
    const userMessage = {
      id: Date.now().toString(),
      text: message.text,
      sender: 'user',
      timestamp: message.timestamp
    };
    
    chatMessagesWindow.webContents.send('chat-message', userMessage);
    
    // Local LLM orchestration temporarily disabled - using WebSocket streaming only
    console.log('📡 WebSocket streaming mode active - local LLM orchestration disabled');
    
    // Note: WebSocket streaming responses are handled directly in ChatMessages.tsx
    // The frontend WebSocket integration will handle all AI responses via streaming
  });

  ipcMain.handle('adjust-chat-messages-height', (event, height) => {
    if (chatMessagesWindow) {
      const currentBounds = chatMessagesWindow.getBounds();
      chatMessagesWindow.setBounds({
        ...currentBounds,
        height: Math.max(height, 100) // Minimum height of 100px
      });
    }
  });

  // Focus management between chat windows
  ipcMain.handle('focus-chat-input', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.focus();
      chatWindow.webContents.focus();
    }
  });

  ipcMain.handle('notify-message-loaded', () => {
    // Notify chat input window that a message was loaded
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('message-loaded');
    }
    
    // Optionally blur the chat messages window
    if (chatMessagesWindow && !chatMessagesWindow.isDestroyed()) {
      chatMessagesWindow.blur();
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
  const { overlayWindow, chatWindow, chatMessagesWindow, insightWindow, memoryDebuggerWindow } = windows;
  const windowList = [overlayWindow, chatWindow, chatMessagesWindow, insightWindow, memoryDebuggerWindow];
  
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
