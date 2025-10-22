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

// MCP Client instance
let mcpClient = null;

// Lazy-loaded fallback agents (only if MCP fails)
let fallbackAgents = null;

/**
 * Get fallback agents (lazy load)
 */
function getFallbackAgents() {
  if (!fallbackAgents) {
    const UserMemoryAgent = require('../services/agents/UserMemoryAgent.cjs');
    const WebSearchAgent = require('../services/agents/WebSearchAgent.cjs');
    const FastIntentParser = require('../services/utils/FastIntentParser.cjs');
    
    fallbackAgents = {
      userMemory: new UserMemoryAgent(),
      webSearch: new WebSearchAgent(),
      intentParser: new FastIntentParser()
    };
    
    console.log('⚠️ Loaded fallback agents (MCP unavailable)');
  }
  return fallbackAgents;
}

/**
 * Get MCP client (lazy load)
 */
function getMCPClient() {
  if (!mcpClient) {
    mcpClient = new MCPClient(MCPConfigManager);
    console.log('✅ MCP Client initialized');
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
    console.log('✅ MCP system initialized');
  } catch (error) {
    console.warn('⚠️ MCP initialization failed, will use local fallback:', error.message);
  }
}

/**
 * Register all MCP IPC handlers
 */
function registerMCPHandlers() {
  console.log('🔌 Registering MCP IPC handlers...');

  // Initialize MCP on startup (use global database)
  // Support both MCP mode (global.databaseManager) and full mode (global.coreAgent.context.database)
  const database = global.databaseManager || global.coreAgent?.context?.database;
  
  if (database) {
    initializeMCPSystem(database);
  } else {
    console.warn('⚠️ Database not available yet, MCP will initialize when database is ready');
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
      console.error('❌ Intent parsing failed, using fallback:', error.message);
      
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
      console.error('❌ Memory store failed, using fallback:', error.message);
      
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
      console.error('❌ Memory query failed, using fallback:', error.message);
      
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
      console.error('❌ Memory retrieve failed, using fallback:', error.message);
      
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
      console.error('❌ Memory update failed:', error);
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
      console.error('❌ Memory delete failed:', error);
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
      console.error('❌ Memory list failed:', error);
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
      console.error('❌ Web search failed:', error);
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
      console.error('❌ News search failed:', error);
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
      console.error('❌ Question answering failed:', error);
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
      console.error('❌ Entity extraction failed:', error);
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
      console.error('❌ Embedding generation failed:', error);
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
      console.error('❌ Failed to get MCP status:', error);
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
      console.error('❌ Failed to get service health:', error);
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
      console.error('❌ Failed to reset metrics:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  console.log('✅ MCP IPC handlers registered');
}

module.exports = {
  registerMCPHandlers,
  initializeMCPSystem
};
