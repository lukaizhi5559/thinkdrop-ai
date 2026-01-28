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
        messagePreview: message?.substring(0, 50)
      });

      try {
        // Update session state to 'running'
        this.updateSessionState(sessionId, {
          status: 'running',
          message,
          startTime: Date.now()
        });

        // Import orchestrator dynamically to avoid circular deps
        const AgentOrchestrator = require('./mcp/AgentOrchestrator.cjs');
        const orchestrator = new AgentOrchestrator();

        // Create progress callback that forwards to frontend
        const onProgress = async (nodeName, state, duration, status) => {
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
          this.broadcastToRenderers('worker:progress', progressUpdate);
        };

        // Create stream callback for LLM tokens
        const onStreamToken = (token) => {
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
    windows.forEach(win => {
      if (win && !win.isDestroyed()) {
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
