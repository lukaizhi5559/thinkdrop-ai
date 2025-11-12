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
      // 📋 SELECTION DETECTION: Check for recently selected text
      let selectionContext = null;
      let augmentedMessage = message;
      
      if (global.selectionDetector) {
        selectionContext = await global.selectionDetector.getSelectionWithContext();
        
        if (selectionContext) {
          console.log('📋 [SELECTION] Detected selection:', {
            preview: selectionContext.text.substring(0, 100),
            sourceApp: selectionContext.sourceApp,
            windowTitle: selectionContext.windowTitle,
            age: selectionContext.age
          });
          
          // Augment message with selection context
          augmentedMessage = `${message}\n\n[Selected text from ${selectionContext.sourceApp}${selectionContext.windowTitle ? ` - ${selectionContext.windowTitle}` : ''}]:\n"${selectionContext.text}"`;
          
          // Send selection info to renderer for UI indicator
          event.sender.send('private-mode:selection-detected', {
            preview: selectionContext.text.substring(0, 100),
            sourceApp: selectionContext.sourceApp,
            windowTitle: selectionContext.windowTitle,
            fullText: selectionContext.text
          });
        }
      }
      
      console.log(`\n🔒 [PRIVATE-MODE] Processing: "${augmentedMessage.substring(0, 200)}..."`);
      
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
      
      // Streaming token callback to forward tokens from answer node to renderer
      const onStreamToken = (token) => {
        try {
          event.sender.send('private-mode:stream-token', {
            token,
            timestamp: new Date().toISOString()
          });
        } catch (err) {
          console.warn('⚠️ [PRIVATE-MODE] Failed to send stream token:', err.message);
        }
      };
      
      // 🌐 Extract online mode flag from context
      const useOnlineMode = context.useOnlineMode || false;
      
      console.log(`🌐 [PRIVATE-MODE] Online mode: ${useOnlineMode ? 'ENABLED (will fallback to private)' : 'DISABLED'}`);
      
      // 🔄 Use StateGraph for all routing (intent-based subgraphs)
      // Extract highlighted text from renderer context or selection detector
      const highlightedText = context.highlightedText || selectionContext?.text;
      
      console.log('📋 [PRIVATE-MODE] Highlighted text sources:');
      console.log('   - context.highlightedText:', context.highlightedText ? `"${context.highlightedText.substring(0, 50)}..."` : 'undefined');
      console.log('   - selectionContext?.text:', selectionContext?.text ? `"${selectionContext.text.substring(0, 50)}..."` : 'undefined');
      console.log('   - Final highlightedText:', highlightedText ? `"${highlightedText.substring(0, 50)}..."` : 'undefined');
      
      const result = await orch.processMessageWithGraph(augmentedMessage, {
        sessionId: context.sessionId,
        userId: context.userId || 'default_user',
        timestamp: new Date().toISOString(),
        useOnlineMode, // 🌐 Pass online mode flag
        hasSelection: !!selectionContext, // 📋 Flag for selection-aware routing
        selectionContext: selectionContext, // 📋 Full selection context
        originalMessage: message, // 📋 Original message without selection
        highlightedText: highlightedText, // 📋 Highlighted text for coreference
        metadata: {
          hasHighlightedText: context.metadata?.hasHighlightedText || !!highlightedText,
          ...context.metadata
        },
        ...context
      }, onProgress, onStreamToken);

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

  /**
   * Get workflow traces for performance monitoring
   */
  ipcMain.handle('mcp:workflow:traces', async (event, { limit = 50, includeCache = true, sessionId = null }) => {
    try {
      const orch = getOrchestrator();
      
      const traces = orch.getWorkflowTraces({
        limit,
        includeCache,
        sessionId
      });

      return {
        success: true,
        traces
      };
    } catch (error) {
      console.error('❌ [IPC:WORKFLOW] Failed to get traces:', error.message);
      return {
        success: false,
        error: error.message,
        traces: []
      };
    }
  });

  /**
   * Clear workflow trace history
   */
  ipcMain.handle('mcp:workflow:clear-traces', async (event) => {
    try {
      const orch = getOrchestrator();
      orch.clearTraceHistory();

      return {
        success: true,
        message: 'Trace history cleared'
      };
    } catch (error) {
      console.error('❌ [IPC:WORKFLOW] Failed to clear traces:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Check for highlighted text (called when chat window opens)
   * Returns selection context without sending a message
   */
  ipcMain.handle('selection:check', async (event) => {
    try {
      console.log('📋 [SELECTION:CHECK] Checking for highlighted text...');
      
      if (!global.selectionDetector) {
        console.warn('⚠️  [SELECTION:CHECK] Selection detector not initialized');
        return null;
      }
      
      // Get selection with full context
      const selectionContext = await global.selectionDetector.getSelectionWithContext();
      
      if (selectionContext) {
        console.log('📋 [SELECTION:CHECK] Found selection:', {
          preview: selectionContext.text.substring(0, 100),
          sourceApp: selectionContext.sourceApp,
          method: selectionContext.method
        });
        
        return {
          preview: selectionContext.text.substring(0, 100),
          sourceApp: selectionContext.sourceApp,
          windowTitle: selectionContext.windowTitle,
          fullText: selectionContext.text,
          method: selectionContext.method
        };
      }
      
      console.log('📋 [SELECTION:CHECK] No selection detected');
      return null;
      
    } catch (error) {
      console.error('❌ [SELECTION:CHECK] Failed:', error);
      return null;
    }
  });

  /**
   * Clear persisted selection (called after message is sent)
   */
  ipcMain.on('selection:clear', (event) => {
    try {
      if (global.selectionDetector) {
        global.selectionDetector.clearPersistedSelection();
      }
    } catch (error) {
      console.error('❌ [SELECTION:CLEAR] Failed:', error);
    }
  });

  console.log('✅ Private mode IPC handlers registered');
}

module.exports = {
  registerPrivateModeHandlers,
  getOrchestrator
};
