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
      
      // Progress callback to stream updates to renderer
      const onProgress = async (nodeName, state, duration, status) => {
        try {
          // Handle early intent response (Phase 1 optimization)
          if (status === 'early' && nodeName === 'earlyResponse') {
            console.log('💬 [PRIVATE-MODE] Sending early intent response to renderer:', state.earlyMessage);
            event.sender.send('private-mode:early-response', {
              message: state.earlyMessage,
              intentType: state.intentType,
              timestamp: new Date().toISOString()
            });
            return;
          }
          
          // Send regular progress update to renderer
          event.sender.send('private-mode:progress', {
            node: nodeName,
            status: status, // 'started', 'completed', or 'early'
            duration: duration,
            timestamp: new Date().toISOString(),
            hasAnswer: !!state.answer,
            contextDocsCount: state.contextDocs?.length || 0,
            intentType: state.intent?.type
          });
        } catch (err) {
          console.warn('⚠️ [PRIVATE-MODE] Failed to send progress update:', err.message);
        }
      };
      
      // 🔄 Use StateGraph for all routing (intent-based subgraphs)
      const result = await orch.processMessageWithGraph(message, {
        sessionId: context.sessionId,
        userId: context.userId || 'default_user',
        timestamp: new Date().toISOString(),
        ...context
      }, onProgress);

      console.log(`✅ [PRIVATE-MODE] Success: ${result.action}`);
      console.log(`📊 [PRIVATE-MODE] Trace: ${result.trace?.length || 0} nodes executed`);
      
      // Optional: Log trace for debugging
      if (process.env.DEBUG_TRACE === 'true' && result.trace) {
        console.log('📊 [PRIVATE-MODE] Execution trace:');
        result.trace.forEach((step, i) => {
          console.log(`  ${i + 1}. ${step.success ? '✅' : '❌'} ${step.node} (${step.duration}ms)`);
        });
      }
      
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
