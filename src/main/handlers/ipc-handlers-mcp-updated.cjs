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

  // ============================================
  // Core Service Handlers
  // ============================================

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
   * List memories via MCP (UserMemory service)
   */
  ipcMain.handle('mcp:memory:list', async (event, { options = {} }) => {
    try {
      const client = getMCPClient();
      const result = await client.listMemories(options);

      return {
        success: true,
        data: result,
        source: 'mcp'
      };
    } catch (error) {
      console.error('❌ Memory list failed, using fallback:', error.message);
      
      try {
        const agents = getFallbackAgents();
        const result = await agents.userMemory.listMemories(options);
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
   * Web search via MCP (WebSearch service)
   */
  ipcMain.handle('mcp:web:search', async (event, { query, options = {} }) => {
    try {
      const client = getMCPClient();
      const result = await client.searchWeb(query, options);

      return {
        success: true,
        data: result,
        source: 'mcp'
      };
    } catch (error) {
      console.error('❌ Web search failed, using fallback:', error.message);
      
      try {
        const agents = getFallbackAgents();
        const result = await agents.webSearch.search(query, options);
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

  // ============================================
  // Generic Service Call Handler
  // ============================================

  /**
   * Execute any action on any service
   */
  ipcMain.handle('mcp:service:call', async (event, { serviceName, action, payload }) => {
    try {
      const client = getMCPClient();
      const result = await client.execute(serviceName, action, payload);

      return {
        success: true,
        data: result,
        source: 'mcp'
      };
    } catch (error) {
      console.error(`❌ Service call failed: ${serviceName}.${action}`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // ============================================
  // Service Management Handlers
  // ============================================

  /**
   * List all services
   */
  ipcMain.handle('mcp:services:list', async (event) => {
    try {
      const services = MCPConfigManager.getAllServices();
      return {
        success: true,
        data: services
      };
    } catch (error) {
      console.error('❌ Failed to list services:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Get service by name
   */
  ipcMain.handle('mcp:services:get', async (event, { serviceName }) => {
    try {
      const service = MCPConfigManager.getService(serviceName);
      if (!service) {
        return {
          success: false,
          error: `Service not found: ${serviceName}`
        };
      }
      return {
        success: true,
        data: service
      };
    } catch (error) {
      console.error('❌ Failed to get service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Add custom service
   */
  ipcMain.handle('mcp:services:add', async (event, serviceConfig) => {
    try {
      await MCPConfigManager.addService(serviceConfig);
      return {
        success: true,
        message: `Service added: ${serviceConfig.name}`
      };
    } catch (error) {
      console.error('❌ Failed to add service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Update service
   */
  ipcMain.handle('mcp:services:update', async (event, { serviceName, updates }) => {
    try {
      await MCPConfigManager.updateService(serviceName, updates);
      return {
        success: true,
        message: `Service updated: ${serviceName}`
      };
    } catch (error) {
      console.error('❌ Failed to update service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Remove service
   */
  ipcMain.handle('mcp:services:remove', async (event, { serviceName }) => {
    try {
      await MCPConfigManager.removeService(serviceName);
      return {
        success: true,
        message: `Service removed: ${serviceName}`
      };
    } catch (error) {
      console.error('❌ Failed to remove service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Enable/disable service
   */
  ipcMain.handle('mcp:services:toggle', async (event, { serviceName, enabled }) => {
    try {
      if (enabled) {
        await MCPConfigManager.enableService(serviceName);
      } else {
        await MCPConfigManager.disableService(serviceName);
      }
      return {
        success: true,
        message: `Service ${enabled ? 'enabled' : 'disabled'}: ${serviceName}`
      };
    } catch (error) {
      console.error('❌ Failed to toggle service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // ============================================
  // Health & Monitoring Handlers
  // ============================================

  /**
   * Check service health
   */
  ipcMain.handle('mcp:health:check', async (event, { serviceName }) => {
    try {
      const client = getMCPClient();
      const health = await client.checkServiceHealth(serviceName);
      return {
        success: true,
        data: health
      };
    } catch (error) {
      console.error('❌ Health check failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Check all services health
   */
  ipcMain.handle('mcp:health:check-all', async (event) => {
    try {
      const client = getMCPClient();
      const healthChecks = await client.checkAllServicesHealth();
      return {
        success: true,
        data: healthChecks
      };
    } catch (error) {
      console.error('❌ Health check all failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Get service call audit logs
   */
  ipcMain.handle('mcp:audit:logs', async (event, { serviceName = null, limit = 100 }) => {
    try {
      let query = 'SELECT * FROM service_call_audit';
      const params = [];
      
      if (serviceName) {
        query += ' WHERE to_service = ?';
        params.push(serviceName);
      }
      
      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);
      
      const logs = await MCPConfigManager.db.all(query, params);
      
      return {
        success: true,
        data: logs
      };
    } catch (error) {
      console.error('❌ Failed to get audit logs:', error);
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
