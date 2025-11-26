/**
 * IPC Handlers for MCP (Microservices Context Protocol)
 * 
 * Direct HTTP communication with MCP services via MCPClient.
 * Provides automatic fallback to local agents if MCP unavailable.
 */

const { ipcMain } = require('electron');
const { initializeMCP } = require('../services/mcp/initialize.cjs');
const MCPConfigManager = require('../services/mcp/MCPConfigManager.cjs');
const MCPClient = require('../services/mcp/MCPClient.cjs');

const logger = require('./../logger.cjs');
// MCP Client instance
let mcpClient = null;

// Lazy-loaded fallback agents (only if MCP fails)
let fallbackAgents = null;

/**
 * Get fallback agents (lazy load)
 * DEPRECATED: Fallback agents removed in Phase 2 cleanup - MCP services only
 */
function getFallbackAgents() {
  // Fallback agents no longer available - throw error to force MCP service usage
  throw new Error('Fallback agents not available - MCP services must be running');
}

/**
 * Get MCP client (lazy load)
 */
function getMCPClient() {
  if (!mcpClient) {
    mcpClient = new MCPClient(MCPConfigManager);
    // Expose globally for other IPC handlers (e.g., guide execution)
    global.mcpClient = mcpClient;
    logger.debug('✅ MCP Client initialized');
  }
  return mcpClient;
}

/**
 * Initialize MCP system
 */
async function initializeMCPSystem(database) {
  try {
    await initializeMCP(database);
    // Initialize client after config manager is ready
    getMCPClient();
    logger.debug('✅ MCP system initialized');
  } catch (error) {
    logger.warn('⚠️ MCP initialization failed, will use local fallback:', error.message);
  }
}

/**
 * Register all MCP IPC handlers
 */
function registerMCPHandlers() {
  logger.debug('🔌 Registering MCP IPC handlers...');

  // Initialize MCP on startup (use global database)
  // Support both MCP mode (global.databaseManager) and full mode (global.coreAgent.context.database)
  const database = global.databaseManager || global.coreAgent?.context?.database;
  
  if (database) {
    initializeMCPSystem(database);
  } else {
    logger.warn('⚠️ Database not available yet, MCP will initialize when database is ready');
  }

  /**
   * Parse intent via MCP (Phi4 service)
   */
  ipcMain.handle('mcp:intent:parse', async (event, { message, context = {} }) => {
    try {
      const client = getMCPClient();
      const result = await client.parseIntent(message, context);

      return {
        success: true,
        data: result,
        source: 'mcp'
      };
    } catch (error) {
      logger.error('❌ Intent parsing failed, using fallback:', error.message);
      
      try {
        const agents = getFallbackAgents();
        const result = await agents.intentParser.parse(message);
        return {
          success: true,
          data: result,
          source: 'local'
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: fallbackError.message
        };
      }
    }
  });

  /**
   * Store memory via MCP (UserMemory service)
   */
  ipcMain.handle('mcp:memory:store', async (event, { content, tags = [], metadata = {} }) => {
    try {
      const client = getMCPClient();
      const result = await client.storeMemory(content, tags, metadata);

      return {
        success: true,
        data: result,
        source: 'mcp'
      };
    } catch (error) {
      logger.error('❌ Memory store failed, using fallback:', error.message);
      
      try {
        const agents = getFallbackAgents();
        const result = await agents.userMemory.storeMemory({ content, tags, metadata });
        return {
          success: true,
          data: result,
          source: 'local'
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: fallbackError.message
        };
      }
    }
  });

  /**
   * Query memories via MCP (UserMemory service)
   */
  ipcMain.handle('mcp:memory:query', async (event, { query, options = {} }) => {
    try {
      const client = getMCPClient();
      const result = await client.queryMemories(query, options);

      return {
        success: true,
        data: result,
        source: 'mcp'
      };
    } catch (error) {
      logger.error('❌ Memory query failed, using fallback:', error.message);
      
      try {
        const agents = getFallbackAgents();
        const result = await agents.userMemory.searchMemories(query, options);
        return {
          success: true,
          data: result,
          source: 'local'
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: fallbackError.message
        };
      }
    }
  });

  /**
   * Retrieve memories via MCP (UserMemory service)
   */
  ipcMain.handle('mcp:memory:retrieve', async (event, { query, limit = 10, filters = {} }) => {
    try {
      const client = getMCPClient();
      const result = await client.retrieveMemories(query, limit, filters);

      return {
        success: true,
        data: result,
        source: 'mcp'
      };
    } catch (error) {
      logger.error('❌ Memory retrieve failed, using fallback:', error.message);
      
      try {
        const agents = getFallbackAgents();
        const result = await agents.userMemory.searchMemories(query, { limit, ...filters });
        return {
          success: true,
          data: result,
          source: 'local'
        };
      } catch (fallbackError) {
        return {
          success: false,
          error: fallbackError.message
        };
      }
    }
  });

  /**
   * Update memory via MCP (UserMemory service)
   */
  ipcMain.handle('mcp:memory:update', async (event, { memoryId, updates, context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.executeMemoryOperation(
        'update',
        { memoryId, updates },
        context,
        async () => {
          // Fallback to local agent
          const agents = getFallbackAgents();
          return await agents.userMemory.updateMemory(memoryId, updates);
        }
      );

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ Memory update failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Delete memory via MCP (UserMemory service)
   */
  ipcMain.handle('mcp:memory:delete', async (event, { memoryId, context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.executeMemoryOperation(
        'delete',
        { memoryId },
        context,
        async () => {
          // Fallback to local agent
          const agents = getFallbackAgents();
          return await agents.userMemory.deleteMemory(memoryId);
        }
      );

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ Memory delete failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * List memories via MCP (UserMemory service)
   */
  ipcMain.handle('mcp:memory:list', async (event, { options = {}, context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.executeMemoryOperation(
        'list',
        options,
        context,
        async () => {
          // Fallback to local agent
          const agents = getFallbackAgents();
          return await agents.userMemory.listMemories(options);
        }
      );

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ Memory list failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Web search via MCP (WebSearch service)
   */
  ipcMain.handle('mcp:web:search', async (event, { query, options = {}, context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.executeWebSearch(
        query,
        options,
        context,
        async () => {
          // Fallback to local agent
          const agents = getFallbackAgents();
          return await agents.webSearch.search(query, options);
        }
      );

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ Web search failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * News search via MCP (WebSearch service)
   */
  ipcMain.handle('mcp:web:news', async (event, { query, options = {}, context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.routeRequest({
        intent: 'COMMAND',
        action: 'web.news',
        payload: { query, ...options },
        context,
        fallbackFn: async () => {
          // Fallback to local agent
          const agents = getFallbackAgents();
          return await agents.webSearch.searchNews(query, options);
        }
      });

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ News search failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Answer question via MCP (Phi4 service)
   */
  ipcMain.handle('mcp:general:answer', async (event, { query, context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.answerQuestion(
        query,
        context,
        async () => {
          // Fallback: return null to signal caller to use existing LLM pipeline
          return null;
        }
      );

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ Question answering failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Extract entities via MCP (Phi4 service)
   */
  ipcMain.handle('mcp:entity:extract', async (event, { text, entityTypes = [], context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.routeRequest({
        intent: 'GENERAL',
        action: 'entity.extract',
        payload: { text, entityTypes },
        context,
        fallbackFn: async () => {
          // Fallback: basic entity extraction
          return { entities: [] };
        }
      });

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ Entity extraction failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Generate embeddings via MCP (Phi4 service)
   */
  ipcMain.handle('mcp:embedding:generate', async (event, { text, model = 'all-MiniLM-L6-v2', context = {} }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      const result = await orchestrator.routeRequest({
        intent: 'GENERAL',
        action: 'embedding.generate',
        payload: { text, model },
        context,
        fallbackFn: async () => {
          // Fallback: return null (caller should handle)
          return null;
        }
      });

      return {
        success: true,
        data: result,
        source: result ? 'mcp' : 'local'
      };
    } catch (error) {
      logger.error('❌ Embedding generation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Get MCP system status
   */
  ipcMain.handle('mcp:system:status', async (event) => {
    try {
      const orchestrator = getMCPOrchestrator();
      
      return {
        success: true,
        data: {
          degradationMode: orchestrator.getDegradationMode(),
          registry: orchestrator.getRegistrySummary(),
          metrics: orchestrator.getMetricsSummary(),
          circuitBreakers: orchestrator.getCircuitBreakerStats()
        }
      };
    } catch (error) {
      logger.error('❌ Failed to get MCP status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Get service health
   */
  ipcMain.handle('mcp:system:health', async (event, { serviceName = null }) => {
    try {
      const orchestrator = getMCPOrchestrator();
      const health = await orchestrator.getServiceHealth(serviceName);
      
      return {
        success: true,
        data: health
      };
    } catch (error) {
      logger.error('❌ Failed to get service health:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Reset MCP metrics
   */
  ipcMain.handle('mcp:system:reset-metrics', async (event) => {
    try {
      const orchestrator = getMCPOrchestrator();
      orchestrator.resetMetrics();
      
      return {
        success: true,
        message: 'Metrics reset successfully'
      };
    } catch (error) {
      logger.error('❌ Failed to reset metrics:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Generic service call - Execute any action on any MCP service
   */
  ipcMain.handle('mcp:service:call', async (event, { serviceName, action, payload }) => {
    try {
      // Special handling for orchestrator service
      if (serviceName === 'orchestrator') {
        const AgentOrchestrator = require('../services/mcp/AgentOrchestrator.cjs');
        const orchestrator = new AgentOrchestrator();
        
        if (action === 'intent.process') {
          // Process pre-classified intent from backend
          const result = await orchestrator.processBackendIntent(
            payload,
            payload.userMessage,
            payload.context
          );
          return {
            success: true,
            data: result
          };
        }
      }
      
      // Default: use MCP client for other services
      const client = getMCPClient();
      const result = await client.callService(serviceName, action, payload);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      logger.error(`❌ Service call failed: ${serviceName}.${action}`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Streaming service call - Execute streaming action with token callbacks
   * Sends tokens back to renderer via IPC events
   */
  ipcMain.handle('mcp:service:call:stream', async (event, { serviceName, action, payload, streamId }) => {
    try {
      logger.debug(`🌊 [IPC:STREAM] Starting stream: ${serviceName}.${action} (streamId: ${streamId})`);
      
      const client = getMCPClient();
      
      // Call streaming service with token callback
      const result = await client.callServiceStream(
        serviceName,
        action,
        payload,
        (token) => {
          // Send each token back to renderer
          event.sender.send(`mcp:stream:token:${streamId}`, { token });
        },
        (progress) => {
          // Send progress events back to renderer
          event.sender.send(`mcp:stream:progress:${streamId}`, progress);
        }
      );

      logger.debug(`✅ [IPC:STREAM] Stream complete: ${streamId}`);
      
      // Send completion event
      event.sender.send(`mcp:stream:done:${streamId}`, result);

      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      logger.error(`❌ [IPC:STREAM] Stream failed: ${serviceName}.${action}`, error.message);
      
      // Send error event
      event.sender.send(`mcp:stream:error:${streamId}`, { error: error.message });
      
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.debug('✅ MCP IPC handlers registered');
}

module.exports = {
  registerMCPHandlers,
  initializeMCPSystem
};
