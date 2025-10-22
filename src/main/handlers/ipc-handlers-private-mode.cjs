/**
 * IPC Handlers for Private Mode
 * 
 * Routes private mode requests to MCP AgentOrchestrator.
 * Handles all local processing without backend WebSocket.
 */

const { ipcMain } = require('electron');
const AgentOrchestrator = require('../services/mcp/AgentOrchestrator.cjs');

// Orchestrator instance
let orchestrator = null;

/**
 * Get orchestrator (lazy load)
 */
function getOrchestrator() {
  if (!orchestrator) {
    orchestrator = new AgentOrchestrator();
    console.log('✅ Private mode orchestrator initialized');
  }
  return orchestrator;
}

/**
 * Register private mode IPC handlers
 */
function registerPrivateModeHandlers() {
  console.log('🔌 Registering private mode IPC handlers...');

  /**
   * Main private mode handler
   * Processes user message through MCP orchestration
   */
  ipcMain.handle('private-mode:process', async (event, { message, context = {} }) => {
    console.log('\n🔒🔒🔒 [PRIVATE-MODE] Handler called! 🔒🔒🔒');
    console.log('📥 [PRIVATE-MODE] Received message:', message);
    console.log('📥 [PRIVATE-MODE] Received context:', JSON.stringify(context, null, 2));
    
    try {
      console.log(`\n🔒 [PRIVATE-MODE] Processing: "${message}"`);
      
      const orch = getOrchestrator();
      console.log('🎯 [PRIVATE-MODE] Orchestrator obtained:', !!orch);
      
      const result = await orch.processMessage(message, {
        sessionId: context.sessionId,
        userId: context.userId || 'default_user',
        timestamp: new Date().toISOString(),
        ...context
      });

      console.log(`✅ [PRIVATE-MODE] Success: ${result.action}`);
      console.log('📤 [PRIVATE-MODE] Returning result:', JSON.stringify(result, null, 2));

      return {
        success: result.success !== false,
        ...result
      };

    } catch (error) {
      console.error('❌ [PRIVATE-MODE] Error:', error);
      console.error('❌ [PRIVATE-MODE] Error stack:', error.stack);
      return {
        success: false,
        error: error.message,
        response: "I encountered an error processing your request."
      };
    }
  });

  /**
   * Parse intent only (for UI feedback)
   */
  ipcMain.handle('private-mode:parse-intent', async (event, { message, context = {} }) => {
    try {
      const orch = getOrchestrator();
      const intent = await orch.parseIntent(message, context);

      return {
        success: true,
        intent: intent
      };

    } catch (error) {
      console.error('❌ [PRIVATE-MODE] Intent parsing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Execute custom MCP action
   */
  ipcMain.handle('private-mode:execute-action', async (event, { serviceName, action, payload, context = {} }) => {
    try {
      const orch = getOrchestrator();
      const result = await orch.executeCustomAction(serviceName, action, payload, context);

      return {
        success: result.success !== false,
        ...result
      };

    } catch (error) {
      console.error('❌ [PRIVATE-MODE] Custom action error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Health check for private mode
   */
  ipcMain.handle('private-mode:health', async (event) => {
    try {
      const orch = getOrchestrator();
      
      // Check all MCP services
      const health = await orch.mcpClient.checkAllServicesHealth();

      return {
        success: true,
        orchestrator: 'ready',
        services: health
      };

    } catch (error) {
      console.error('❌ [PRIVATE-MODE] Health check error:', error);
      return {
        success: false,
        orchestrator: 'error',
        error: error.message
      };
    }
  });

  console.log('✅ Private mode IPC handlers registered');
}

module.exports = {
  registerPrivateModeHandlers,
  getOrchestrator
};
