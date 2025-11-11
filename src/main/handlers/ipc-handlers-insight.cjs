/**
 * IPC Handlers for Insight System
 * Manages communication between main process and renderer for Page/Highlight Insights
 */

const { ipcMain, BrowserWindow } = require('electron');

/**
 * Send insight update to renderer
 * @param {Object} insightData - Insight data to send
 */
function sendInsightUpdate(insightData) {
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('insight:update', insightData);
    }
  });
}

/**
 * Send insight loading state to renderer
 * @param {boolean} isLoading - Loading state
 */
function sendInsightLoading(isLoading) {
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('insight:loading', isLoading);
    }
  });
}

/**
 * Send insight error to renderer
 * @param {string} error - Error message
 */
function sendInsightError(error) {
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('insight:error', error);
    }
  });
}

/**
 * Register IPC handlers for insight system
 * @param {Object} mcpClient - MCP client instance
 */
function registerInsightHandlers(mcpClient) {
  console.log('📝 [IPC:INSIGHT] Registering insight IPC handlers');

  // Handle insight refresh request
  ipcMain.on('insight:refresh', async (event) => {
    console.log('🔄 [IPC:INSIGHT] Refresh requested');
    try {
      sendInsightLoading(true);
      
      // Get Virtual Screen DOM from global
      const vdom = global.virtualScreenDOM;
      
      if (!vdom) {
        throw new Error('Virtual Screen DOM not available');
      }
      
      // Clear cache for current window to force fresh analysis
      const currentWindowId = await vdom.getCurrentWindowId();
      vdom.cache.delete(currentWindowId);
      
      // Trigger new analysis which will generate insights
      await vdom.analyzeCurrentWindow(currentWindowId);
      
      console.log('✅ [IPC:INSIGHT] Refresh completed');
      
    } catch (error) {
      console.error('❌ [IPC:INSIGHT] Refresh failed:', error);
      sendInsightError(error.message);
    }
  });

  // Handle insight refresh with custom query (for follow-up questions)
  ipcMain.on('insight:refresh-with-query', async (event, customQuery) => {
    console.log('🔄 [IPC:INSIGHT] Refresh with custom query:', customQuery);
    try {
      sendInsightLoading(true);
      
      // Get Virtual Screen DOM from global
      const vdom = global.virtualScreenDOM;
      
      if (!vdom) {
        throw new Error('Virtual Screen DOM not available');
      }
      
      // Store the custom query in global so insight node can use it
      global.insightCustomQuery = customQuery;
      
      // Clear cache for current window to force fresh analysis
      const currentWindowId = await vdom.getCurrentWindowId();
      vdom.cache.delete(currentWindowId);
      
      // Trigger new analysis which will generate insights with custom query
      await vdom.analyzeCurrentWindow(currentWindowId);
      
      // Clear the custom query after use
      delete global.insightCustomQuery;
      
      console.log('✅ [IPC:INSIGHT] Refresh with query completed');
      
    } catch (error) {
      console.error('❌ [IPC:INSIGHT] Refresh with query failed:', error);
      sendInsightError(error.message);
      delete global.insightCustomQuery;
    }
  });

  // Handle highlight insight request
  ipcMain.on('insight:highlight', async (event, selectedText, context) => {
    console.log('✨ [IPC:INSIGHT] Highlight insight requested:', selectedText?.substring(0, 50));
    try {
      if (!mcpClient) {
        throw new Error('MCP client not available');
      }
      const insightNode = require('../services/mcp/nodes/insight.cjs');
      
      sendInsightLoading(true);
      
      // Generate highlight insight
      const state = await insightNode({
        mcpClient,
        selectedText,
        insightType: 'highlight',
        message: selectedText
      });
      
      if (state.insights) {
        sendInsightUpdate(state.insights);
      } else {
        sendInsightError('No insights found for selected text');
      }
      
    } catch (error) {
      console.error('❌ [IPC:INSIGHT] Highlight insight failed:', error);
      sendInsightError(error.message);
    }
  });

  console.log('✅ [IPC:INSIGHT] Insight IPC handlers registered');
}

module.exports = {
  registerInsightHandlers,
  sendInsightUpdate,
  sendInsightLoading,
  sendInsightError
};
