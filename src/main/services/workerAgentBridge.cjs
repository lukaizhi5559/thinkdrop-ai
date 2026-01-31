/**
 * Worker Agent Bridge
 * 
 * Bridges Worker Agent (StateGraph) progress to frontend
 * Enables Communication Agent to monitor Worker execution
 */

const { ipcMain, BrowserWindow } = require('electron');
const logger = require('./../logger.cjs');

class WorkerAgentBridge {
  constructor() {
    this.activeSessions = new Map();
    this.sessionStates = new Map();
    this.setupIpcHandlers();
  }

  /**
   * Update session state
   * @param {string} sessionId - Session ID
   * @param {Object} stateUpdate - State update
   */
  updateSessionState(sessionId, stateUpdate) {
    const currentState = this.sessionStates.get(sessionId) || {
      status: 'idle',
      progress: [],
      lastUpdate: Date.now()
    };

    const newState = {
      ...currentState,
      ...stateUpdate,
      lastUpdate: Date.now()
    };

    this.sessionStates.set(sessionId, newState);
    logger.debug('📊 [WORKER_BRIDGE] Session state updated', {
      sessionId,
      status: newState.status
    });

    return newState;
  }

  /**
   * Setup IPC handlers for Worker Agent communication
   */
  setupIpcHandlers() {
    // Handle requests from frontend to start Worker Agent
    ipcMain.handle('worker:execute', async (event, request) => {
      const { sessionId, message, context } = request;
      
      logger.info('🔧 [WORKER_BRIDGE] Received execution request', {
        sessionId,
        messagePreview: message?.substring(0, 50),
        hasMessage: !!message,
        messageType: typeof message
      });

      // Validate message
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        const error = 'Invalid or empty message provided to worker:execute';
        logger.error('❌ [WORKER_BRIDGE] Validation failed', {
          sessionId,
          message,
          messageType: typeof message
        });
        throw new Error(error);
      }

      try {
        // Update session state to 'running'
        this.updateSessionState(sessionId, {
          status: 'running',
          message,
          startTime: Date.now()
        });

        // 💾 CRITICAL: Store user message to conversation service BEFORE executing StateGraph
        // This ensures the StateGraph's retrieveMemory node can fetch conversation history
        // that includes the current user message for context-aware responses
        try {
          const { getMCPClient } = require('./mcp/mcpClient.cjs');
          const mcpClient = getMCPClient();
          
          logger.debug('💾 [WORKER_BRIDGE] Storing user message to conversation service', {
            sessionId,
            messagePreview: message.substring(0, 50),
            userId: context.userId || 'default_user'
          });
          
          await mcpClient.callService('conversation', 'message.add', {
            sessionId: sessionId,
            text: message,
            sender: 'user',
            metadata: {
              timestamp: new Date().toISOString(),
              userId: context.userId || 'default_user'
            }
          });
          
          logger.debug('✅ [WORKER_BRIDGE] User message stored successfully');
        } catch (storeError) {
          // Don't fail execution if storage fails - log warning and continue
          logger.warn('⚠️ [WORKER_BRIDGE] Failed to store user message (non-critical):', storeError.message);
        }

        // Import orchestrator dynamically to avoid circular deps
        const AgentOrchestrator = require('./mcp/AgentOrchestrator.cjs');
        const orchestrator = new AgentOrchestrator();

        // Create progress callback that forwards to frontend
        const onProgress = async (nodeName, state, duration, status) => {
          logger.debug('📊 [WORKER_BRIDGE] Progress callback invoked', {
            sessionId,
            nodeName,
            status,
            hasStepDescription: !!state.stepDescription,
            hasActionDescription: !!state.actionDescription
          });

          const progressUpdate = {
            sessionId,
            nodeName,
            status,
            duration,
            stepDescription: state.stepDescription,
            actionDescription: state.actionDescription,
            intentType: state.intent?.type,
            currentNode: nodeName,
            timestamp: Date.now()
          };

          // Update session state with latest progress
          this.updateSessionState(sessionId, {
            currentNode: nodeName,
            currentStep: state.stepDescription,
            latestProgress: progressUpdate
          });

          // Send to all renderer windows
          logger.debug('📡 [WORKER_BRIDGE] Broadcasting progress to renderers', {
            channel: 'worker:progress',
            windowCount: BrowserWindow.getAllWindows().length
          });
          this.broadcastToRenderers('worker:progress', progressUpdate);
        };

        // Create stream callback for LLM tokens
        const onStreamToken = (token) => {
          logger.debug('💬 [WORKER_BRIDGE] Stream token callback invoked', {
            sessionId,
            tokenLength: token?.length || 0
          });
          this.broadcastToRenderers('worker:stream-token', {
            sessionId,
            token,
            timestamp: Date.now()
          });
        };

        // Execute with StateGraph
        const result = await orchestrator.processMessageWithGraph(
          message,
          context,
          onProgress,
          onStreamToken
        );

        // Update session state to 'completed'
        this.updateSessionState(sessionId, {
          status: 'completed',
          result,
          endTime: Date.now()
        });

        // If StateGraph generated an overlay payload, broadcast it to ResultsWindow
        if (result.overlayPayload) {
          logger.debug('📤 [WORKER_BRIDGE] Broadcasting overlay payload to ResultsWindow', {
            intent: result.overlayPayload.intent,
            variant: result.overlayPayload.uiVariant
          });
          
          // Send overlay:update to all renderer windows (including ResultsWindow)
          this.broadcastToRenderers('overlay:update', result.overlayPayload);
        }

        // Broadcast completion
        this.broadcastToRenderers('worker:completed', {
          sessionId,
          result,
          timestamp: Date.now()
        });

        return result;

      } catch (error) {
        logger.error('❌ [WORKER_BRIDGE] Execution failed', {
          error: error.message,
          sessionId
        });

        // Update session state to 'error'
        this.updateSessionState(sessionId, {
          status: 'error',
          error: error.message,
          endTime: Date.now()
        });

        // Broadcast error
        this.broadcastToRenderers('worker:error', {
          sessionId,
          error: error.message,
          timestamp: Date.now()
        });

        throw error;
      }
    });

    // Handle pause/resume/cancel requests
    ipcMain.handle('worker:pause', async (event, { sessionId }) => {
      logger.info('⏸️  [WORKER_BRIDGE] Pause requested', { sessionId });
      // TODO: Implement pause logic in StateGraph
      return { success: true, sessionId };
    });

    ipcMain.handle('worker:resume', async (event, { sessionId }) => {
      logger.info('▶️  [WORKER_BRIDGE] Resume requested', { sessionId });
      // TODO: Implement resume logic in StateGraph
      return { success: true, sessionId };
    });

    ipcMain.handle('worker:cancel', async (event, { sessionId }) => {
      logger.info('🛑 [WORKER_BRIDGE] Cancel requested', { sessionId });
      // TODO: Implement cancel logic in StateGraph
      return { success: true, sessionId };
    });

    // Handle status queries (for polling)
    ipcMain.handle('worker:get-status', async (event, { sessionId }) => {
      const state = this.sessionStates.get(sessionId);
      
      if (!state) {
        return { 
          status: 'idle',
          sessionId,
          timestamp: Date.now()
        };
      }

      return {
        ...state,
        sessionId,
        timestamp: Date.now()
      };
    });
  }

  /**
   * Broadcast message to all renderer windows
   * @param {string} channel - IPC channel
   * @param {Object} data - Data to send
   */
  broadcastToRenderers(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    logger.debug(`📡 [WORKER_BRIDGE] Broadcasting to ${windows.length} windows`, {
      channel,
      windowTitles: windows.map(w => w.getTitle())
    });
    
    windows.forEach(win => {
      if (win && !win.isDestroyed()) {
        logger.debug(`  → Sending to: ${win.getTitle()}`);
        win.webContents.send(channel, data);
      }
    });
  }

  /**
   * Track active session
   * @param {string} sessionId - Session ID
   * @param {Object} sessionData - Session data
   */
  trackSession(sessionId, sessionData) {
    this.activeSessions.set(sessionId, {
      ...sessionData,
      startTime: Date.now()
    });
  }

  /**
   * Remove session tracking
   * @param {string} sessionId - Session ID
   */
  removeSession(sessionId) {
    this.activeSessions.delete(sessionId);
  }

  /**
   * Get all active sessions
   * @returns {Array} Active sessions
   */
  getActiveSessions() {
    return Array.from(this.activeSessions.entries()).map(([id, data]) => ({
      sessionId: id,
      ...data
    }));
  }
}

// Singleton instance
const workerAgentBridge = new WorkerAgentBridge();

module.exports = workerAgentBridge;
