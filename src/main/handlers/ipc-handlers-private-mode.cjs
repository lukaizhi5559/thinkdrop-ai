/**
 * IPC Handlers for Private Mode
 * 
 * Routes private mode requests to MCP AgentOrchestrator.
 * Handles all local processing without backend WebSocket.
 */

const { ipcMain } = require('electron');
const AgentOrchestrator = require('../services/mcp/AgentOrchestrator.cjs');
const { sendOverlayUpdate, isChatWindowVisible } = require('../ipc/overlay.cjs');

const logger = require('./../logger.cjs');
// Orchestrator instance
let orchestrator = null;

/**
 * Get orchestrator (lazy load)
 */
function getOrchestrator() {
  if (!orchestrator) {
    orchestrator = new AgentOrchestrator();
    logger.debug('✅ Private mode orchestrator initialized');
  }
  return orchestrator;
}

/**
 * Register private mode IPC handlers
 */
function registerPrivateModeHandlers() {
  logger.debug('🔌 Registering private mode IPC handlers...');

  /**
   * Main private mode handler
   * Processes user message through MCP orchestration
   */
  ipcMain.handle('private-mode:process', async (event, { message, context = {} }) => {
    logger.debug('\n🔒🔒🔒 [PRIVATE-MODE] Handler called! 🔒🔒🔒');
    logger.debug('📥 [PRIVATE-MODE] Received message:', message);
    logger.debug('📥 [PRIVATE-MODE] Received context:', JSON.stringify(context, null, 2));
    
    try {
      // 📋 SELECTION DETECTION: Check for recently selected text
      let selectionContext = null;
      let augmentedMessage = message;
      
      if (global.selectionDetector) {
        selectionContext = await global.selectionDetector.getSelectionWithContext();
        
        if (selectionContext) {
          logger.debug('📋 [SELECTION] Detected selection:', {
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
      
      // Detect overlay mode from context
      const isOverlayMode = context.overlayMode === true;
      
      // Check if chat window is visible
      const chatIsVisible = isChatWindowVisible();
      logger.debug(`💬 [PRIVATE-MODE] Chat window visible: ${chatIsVisible}`);
      
      // Overlay mode: Send initial "Thinking..." loading state to show in prompt capture box
      if (isOverlayMode) {
        logger.debug('📤 [PRIVATE-MODE] Sending initial loading state to overlay (prompt capture box)');
        logger.debug('📤 [PRIVATE-MODE] isOverlayMode:', isOverlayMode, 'chatIsVisible:', chatIsVisible);
        
        const initialPayload = {
          intent: 'web_search',
          uiVariant: 'loading',
          slots: {
            subject: message,
            loadingMessage: 'Thinking...'
          },
          conversationId: context.conversationId || `overlay_${Date.now()}`,
          correlationId: context.correlationId || `overlay_${Date.now()}`
        };
        
        logger.debug('📤 [PRIVATE-MODE] Sending initial payload:', initialPayload);
        sendOverlayUpdate(initialPayload);
        logger.debug('✅ [PRIVATE-MODE] Initial loading state sent');
      }
      
      logger.debug(`\n🔒 [PRIVATE-MODE] Processing: "${augmentedMessage.substring(0, 200)}..."`);
      
      const orch = getOrchestrator();
      logger.debug('🎯 [PRIVATE-MODE] Orchestrator obtained:', !!orch);
      
      // Progress callback to stream updates to renderer
      const onProgress = async (nodeName, state, duration, status) => {
        try {
          // Handle parseIntent completion - send loading state with correct intent
          if (status === 'completed' && nodeName === 'parseIntent' && isOverlayMode) {
            const detectedIntent = state.intent?.type || state.intent || 'question';
            logger.debug(`🎯 [PRIVATE-MODE] parseIntent completed - sending loading state with intent: ${detectedIntent}`);
            
            sendOverlayUpdate({
              intent: detectedIntent,
              uiVariant: 'loading',
              slots: {
                subject: message,
                loadingMessage: 'Thinking...'
              },
              conversationId: context.conversationId || `overlay_${Date.now()}`,
              correlationId: context.correlationId || `overlay_${Date.now()}`
            });
          }
          
          // Handle early intent response (Phase 1 optimization)
          if (status === 'early' && nodeName === 'earlyResponse') {
            logger.debug('💬 [PRIVATE-MODE] Sending early intent response to renderer:', state.earlyMessage);
            
            // Overlay mode: Send updated loading message to intent window
            if (isOverlayMode) {
              sendOverlayUpdate({
                intent: state.intentType || 'web_search',
                uiVariant: 'loading',
                slots: {
                  subject: message,
                  loadingMessage: state.earlyMessage
                },
                conversationId: context.conversationId || `overlay_${Date.now()}`,
                correlationId: context.correlationId || `overlay_${Date.now()}`
              });
            } else if (!isOverlayMode) {
              // Chat mode: Send early response
              event.sender.send('private-mode:early-response', {
                message: state.earlyMessage,
                intentType: state.intentType,
                timestamp: new Date().toISOString()
              });
            }
            return;
          }
          
          // Send regular progress update to renderer (chat mode only)
          if (!isOverlayMode) {
            event.sender.send('private-mode:progress', {
              node: nodeName,
              status: status, // 'started', 'completed', or 'early'
              duration: duration,
              timestamp: new Date().toISOString(),
              hasAnswer: !!state.answer,
              contextDocsCount: state.contextDocs?.length || 0,
              intentType: state.intent?.type
            });
          }
        } catch (err) {
          logger.warn('⚠️ [PRIVATE-MODE] Failed to send progress update:', err.message);
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
          logger.warn('⚠️ [PRIVATE-MODE] Failed to send stream token:', err.message);
        }
      };
      
      // 🌐 Extract online mode flag from context
      const useOnlineMode = context.useOnlineMode || false;
      
      logger.debug(`🌐 [PRIVATE-MODE] Online mode: ${useOnlineMode ? 'ENABLED (will fallback to private)' : 'DISABLED'}`);
      
      // 🔄 Use StateGraph for all routing (intent-based subgraphs)
      // Extract highlighted text from renderer context or selection detector
      const highlightedText = context.highlightedText || selectionContext?.text;
      
      logger.debug('📋 [PRIVATE-MODE] Highlighted text sources:');
      logger.debug('   - context.highlightedText:', context.highlightedText ? `"${context.highlightedText.substring(0, 50)}..."` : 'undefined');
      logger.debug('   - selectionContext?.text:', selectionContext?.text ? `"${selectionContext.text.substring(0, 50)}..."` : 'undefined');
      logger.debug('   - Final highlightedText:', highlightedText ? `"${highlightedText.substring(0, 50)}..."` : 'undefined');
      
      const result = await orch.processMessageWithGraph(augmentedMessage, {
        sessionId: context.sessionId || 'default_session', // Default session if not provided
        userId: context.userId || 'default_user',
        timestamp: new Date().toISOString(),
        useOnlineMode, // 🌐 Pass online mode flag
        overlayMode: isOverlayMode, // 🎯 Request overlay payload if in overlay mode
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

      logger.debug(`✅ [PRIVATE-MODE] Success: ${result.action}`);
      logger.debug(`📊 [PRIVATE-MODE] Trace: ${result.trace?.length || 0} nodes executed`);
      
      // Optional: Log trace for debugging
      if (process.env.DEBUG_TRACE === 'true' && result.trace) {
        logger.debug('📊 [PRIVATE-MODE] Execution trace:');
        result.trace.forEach((step, i) => {
          logger.debug(`  ${i + 1}. ${step.success ? '✅' : '❌'} ${step.node} (${step.duration}ms)`);
        });
      }
      
      // Overlay mode: Send final overlay payload to intent window ONLY if chat is NOT visible
      if (isOverlayMode && result.overlayPayload && !chatIsVisible) {
        logger.debug('📤 [PRIVATE-MODE] Chat closed - sending final results to intent window');
        sendOverlayUpdate(result.overlayPayload);
      } else if (isOverlayMode && result.overlayPayload && chatIsVisible) {
        logger.debug('💬 [PRIVATE-MODE] Chat open - skipping intent overlay, results already in chat');
      }
      
      logger.debug('📤 [PRIVATE-MODE] Returning result:', JSON.stringify(result, null, 2));

      return {
        success: result.success !== false,
        ...result
      };

    } catch (error) {
      logger.error('❌ [PRIVATE-MODE] Error:', error);
      logger.error('❌ [PRIVATE-MODE] Error stack:', error.stack);
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
      logger.error('❌ [PRIVATE-MODE] Intent parsing error:', error);
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
      logger.error('❌ [PRIVATE-MODE] Custom action error:', error);
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
      logger.error('❌ [PRIVATE-MODE] Health check error:', error);
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
      logger.error('❌ [IPC:WORKFLOW] Failed to get traces:', error.message);
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
      logger.error('❌ [IPC:WORKFLOW] Failed to clear traces:', error.message);
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
      logger.debug('📋 [SELECTION:CHECK] Checking for highlighted text...');
      
      if (!global.selectionDetector) {
        logger.warn('⚠️  [SELECTION:CHECK] Selection detector not initialized');
        return null;
      }
      
      // Get selection with full context
      const selectionContext = await global.selectionDetector.getSelectionWithContext();
      
      if (selectionContext) {
        logger.debug('📋 [SELECTION:CHECK] Found selection:', {
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
      
      logger.debug('📋 [SELECTION:CHECK] No selection detected');
      return null;
      
    } catch (error) {
      logger.error('❌ [SELECTION:CHECK] Failed:', error);
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
      logger.error('❌ [SELECTION:CLEAR] Failed:', error);
    }
  });

  logger.debug('✅ Private mode IPC handlers registered');
}

module.exports = {
  registerPrivateModeHandlers,
  getOrchestrator
};
