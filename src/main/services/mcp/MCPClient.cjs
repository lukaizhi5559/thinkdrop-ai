/**
 * MCP Client - HTTP client for calling MCP services
 * 
 * Provides dynamic service communication based on MCP registry.
 * Supports both core services and custom external services.
 */

const fetch = require('node-fetch');

class MCPClient {
  constructor(configManager) {
    this.configManager = configManager;
  }

  /**
   * Call any MCP service dynamically
   * @param {string} serviceName - Service name from registry
   * @param {string} action - Action to perform (e.g., 'memory.store')
   * @param {object} payload - Request payload
   * @returns {Promise<object>} Service response
   */
  async callService(serviceName, action, payload) {
    const startTime = Date.now();
    
    try {
      // 0. Wait for config manager to be initialized
      if (!this.configManager.isInitialized || !this.configManager.isInitialized()) {
        console.log(`⏳ [MCP] Waiting for config manager initialization...`);
        // Wait up to 5 seconds for initialization
        const maxWait = 5000;
        const checkInterval = 100;
        let waited = 0;
        
        while ((!this.configManager.isInitialized || !this.configManager.isInitialized()) && waited < maxWait) {
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          waited += checkInterval;
        }
        
        if (!this.configManager.isInitialized || !this.configManager.isInitialized()) {
          throw new Error(`Config manager not initialized after ${maxWait}ms`);
        }
        console.log(`✅ [MCP] Config manager ready after ${waited}ms`);
      }
      
      // 1. Get service from registry
      const service = this.configManager.getService(serviceName);
      if (!service) {
        throw new Error(`Service not found in registry: ${serviceName}`);
      }

      // 2. Check if service is enabled
      if (!service.enabled) {
        throw new Error(`Service is disabled: ${serviceName}`);
      }

      // 3. Check if action is supported
      if (!service.actions.includes(action)) {
        throw new Error(`Action not supported by ${serviceName}: ${action}. Available: ${service.actions.join(', ')}`);
      }

      // 4. Check rate limit (if needed)
      await this.checkRateLimit(serviceName);

      // 5. Build request URL
      // Keep dots in action name: memory.store -> /memory.store
      let url = `${service.endpoint}/${action}`;

      console.log(`📡 MCP Call: ${serviceName}.${action} -> ${url}`);
      console.log(`🔑 API Key: ${service.apiKey ? service.apiKey.substring(0, 10) + '...' : 'MISSING'}`);

      // 6. Build MCP protocol request
      const requestId = this.generateRequestId();
      const mcpRequest = {
        version: 'mcp.v1',
        service: serviceName,
        action: action,
        requestId: requestId,
        payload: payload
      };

      console.log(`📦 MCP Request:`, JSON.stringify(mcpRequest, null, 2));

      // 7. Make HTTP request with IPv4/IPv6 fallback
      let response;
      let lastError;
      
      // Try original URL first
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': service.apiKey,
            'X-Service-Name': 'thinkdrop-ai',
            'X-Request-ID': requestId
          },
          body: JSON.stringify(mcpRequest),
          timeout: 30000
        });
        console.log(`📥 Response status: ${response.status} ${response.statusText}`);
      } catch (error) {
        lastError = error;
        console.log(`⚠️ First attempt failed: ${error.message}`);
        
        // If it's a connection error and URL uses localhost, try IPv4 explicitly
        if (error.message.includes('ECONNREFUSED') && url.includes('localhost')) {
          const ipv4Url = url.replace('localhost', '127.0.0.1');
          console.log(`🔄 Retrying with IPv4: ${ipv4Url}`);
          
          try {
            response = await fetch(ipv4Url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': service.apiKey,
                'X-Service-Name': 'thinkdrop-ai',
                'X-Request-ID': requestId
              },
              body: JSON.stringify(mcpRequest),
              timeout: 30000
            });
            console.log(`✅ IPv4 retry succeeded: ${response.status} ${response.statusText}`);
            
            // Update service endpoint to use IPv4 for future calls
            service.endpoint = service.endpoint.replace('localhost', '127.0.0.1');
            console.log(`💾 Updated service endpoint to: ${service.endpoint}`);
          } catch (ipv4Error) {
            console.log(`❌ IPv4 retry also failed: ${ipv4Error.message}`);
            throw lastError; // Throw original error
          }
        } else {
          throw error;
        }
      }

      const duration = Date.now() - startTime;

      // 7. Handle response
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Service error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      // 8. Log successful call
      await this.logServiceCall(serviceName, action, payload, true, duration, null);

      console.log(`✅ MCP Success: ${serviceName}.${action} (${duration}ms)`);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log failed call
      await this.logServiceCall(serviceName, action, payload, false, duration, error.message);

      console.error(`❌ MCP Error: ${serviceName}.${action} - ${error.message}`);
      
      throw error;
    }
  }

  /**
   * Check rate limit for service
   */
  async checkRateLimit(serviceName) {
    const service = this.configManager.getService(serviceName);
    if (!service.rateLimit) return; // No limit

    // Get recent calls in last minute
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    
    // DatabaseManager uses query() instead of all()
    const recentCalls = await this.configManager.db.query(`
      SELECT COUNT(*) as count 
      FROM service_call_audit 
      WHERE to_service = ? 
        AND timestamp > ?
        AND success = 1
    `, [serviceName, oneMinuteAgo]);

    const callCount = recentCalls[0]?.count || 0;

    if (callCount >= service.rateLimit) {
      throw new Error(`Rate limit exceeded for ${serviceName}: ${service.rateLimit} requests/minute`);
    }
  }

  /**
   * Log service call to audit table
   */
  async logServiceCall(serviceName, action, payload, success, durationMs, errorMessage) {
    try {
      const audit = {
        id: this.generateId(),
        from_service: 'thinkdrop-ai',
        to_service: serviceName,
        action: action,
        payload: JSON.stringify(payload),
        success: success ? 1 : 0,
        error_message: errorMessage,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
        trace_id: this.generateRequestId()
      };

      await this.configManager.db.run(`
        INSERT INTO service_call_audit 
        (id, from_service, to_service, action, payload, success, error_message, duration_ms, timestamp, trace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        audit.id,
        audit.from_service,
        audit.to_service,
        audit.action,
        audit.payload,
        audit.success,
        audit.error_message,
        audit.duration_ms,
        audit.timestamp,
        audit.trace_id
      ]);
    } catch (error) {
      console.error('Failed to log service call:', error);
      // Don't throw - logging failure shouldn't break the main flow
    }
  }

  // ============================================
  // Convenience Methods for Core Services
  // ============================================

  /**
   * User Memory Service - Store memory
   */
  async storeMemory(content, tags = [], metadata = {}) {
    return this.callService('user-memory', 'memory.store', {
      text: content,  // Service expects 'text', not 'content'
      tags,
      metadata,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * User Memory Service - Retrieve memories
   */
  async retrieveMemories(query, limit = 10, filters = {}) {
    return this.callService('user-memory', 'memory.retrieve', {
      query,
      limit,
      filters
    });
  }

  /**
   * User Memory Service - Query/Search memories
   */
  async queryMemories(query, options = {}) {
    return this.callService('user-memory', 'memory.search', {  // Service uses 'memory.search', not 'memory.query'
      query,
      ...options
    });
  }

  /**
   * User Memory Service - Delete memory
   */
  async deleteMemory(memoryId) {
    return this.callService('user-memory', 'memory.delete', {
      id: memoryId
    });
  }

  /**
   * User Memory Service - Update memory
   */
  async updateMemory(memoryId, updates) {
    return this.callService('user-memory', 'memory.update', {
      id: memoryId,
      ...updates
    });
  }

  /**
   * User Memory Service - List memories
   */
  async listMemories(options = {}) {
    return this.callService('user-memory', 'memory.list', options);
  }

  /**
   * User Memory Service - Get stats
   */
  async getMemoryStats() {
    return this.callService('user-memory', 'memory.stats', {});
  }

  /**
   * Web Search Service - Search web
   */
  async searchWeb(query, options = {}) {
    return this.callService('web-search', 'search.web', {
      query,
      ...options
    });
  }

  /**
   * Web Search Service - Search news
   */
  async searchNews(query, options = {}) {
    return this.callService('web-search', 'search.news', {
      query,
      ...options
    });
  }

  /**
   * Web Search Service - Extract content
   */
  async extractContent(url) {
    return this.callService('web-search', 'content.extract', {
      url
    });
  }

  /**
   * Phi4 Service - Parse intent
   */
  async parseIntent(message, context = {}) {
    return this.callService('phi4', 'intent.parse', {
      message,
      context
    });
  }

  /**
   * Phi4 Service - Extract entities
   */
  async extractEntities(text) {
    return this.callService('phi4', 'entity.extract', {
      text
    });
  }

  /**
   * Phi4 Service - General answer
   */
  async getAnswer(question, context = {}) {
    return this.callService('phi4', 'general.answer', {
      query: question, // Service expects 'query' not 'question'
      context
    });
  }

  /**
   * Phi4 Service - Generate embedding
   */
  async generateEmbedding(text) {
    return this.callService('phi4', 'embedding.generate', {
      text
    });
  }

  /**
   * Phi4 Service - List parsers
   */
  async listParsers() {
    return this.callService('phi4', 'parser.list', {});
  }

  // ============================================
  // Generic Methods for Custom Services
  // ============================================

  /**
   * Execute any action on any service
   * @param {string} serviceName - Service name
   * @param {string} action - Action name
   * @param {object} payload - Request payload
   */
  async execute(serviceName, action, payload) {
    return this.callService(serviceName, action, payload);
  }

  /**
   * Get service info from registry
   */
  getServiceInfo(serviceName) {
    return this.configManager.getService(serviceName);
  }

  /**
   * List all available services
   */
  listServices() {
    return this.configManager.getAllServices();
  }

  /**
   * List enabled services only
   */
  listEnabledServices() {
    return this.configManager.getEnabledServices();
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Generate unique ID
   */
  generateId() {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate request ID for tracing
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get service health
   */
  async checkServiceHealth(serviceName) {
    const service = this.configManager.getService(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    try {
      const startTime = Date.now();
      const response = await fetch(`${service.endpoint}/health`, {
        method: 'GET',
        timeout: 5000
      });

      const duration = Date.now() - startTime;

      return {
        service: serviceName,
        status: response.ok ? 'healthy' : 'degraded',
        responseTime: duration,
        statusCode: response.status,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        service: serviceName,
        status: 'down',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Check health of all services
   */
  async checkAllServicesHealth() {
    const services = this.configManager.getEnabledServices();
    const healthChecks = await Promise.allSettled(
      services.map(service => this.checkServiceHealth(service.name))
    );

    return healthChecks.map((result, index) => ({
      service: services[index].name,
      ...(result.status === 'fulfilled' ? result.value : { status: 'error', error: result.reason.message })
    }));
  }

  // ============================================================
  // CONVERSATION SERVICE CONVENIENCE METHODS
  // ============================================================

  /**
   * Create a new conversation session
   */
  async createSession(options = {}) {
    return this.callService('conversation', 'session.create', options);
  }

  /**
   * List all conversation sessions
   */
  async listSessions(options = {}) {
    return this.callService('conversation', 'session.list', options);
  }

  /**
   * Get a specific session
   */
  async getSession(sessionId) {
    return this.callService('conversation', 'session.get', { sessionId });
  }

  /**
   * Update a session
   */
  async updateSession(sessionId, updates) {
    return this.callService('conversation', 'session.update', { sessionId, ...updates });
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId) {
    return this.callService('conversation', 'session.delete', { sessionId });
  }

  /**
   * Switch active session
   */
  async switchSession(sessionId) {
    return this.callService('conversation', 'session.switch', { sessionId });
  }

  /**
   * Add a message to a session
   */
  async addMessage(sessionId, text, sender, metadata = {}) {
    return this.callService('conversation', 'message.add', {
      sessionId,
      text,
      sender,
      metadata
    });
  }

  /**
   * List messages in a session
   */
  async listMessages(sessionId, options = {}) {
    return this.callService('conversation', 'message.list', {
      sessionId,
      ...options
    });
  }

  /**
   * Get a specific message
   */
  async getMessage(messageId) {
    return this.callService('conversation', 'message.get', { messageId });
  }

  /**
   * Update a message
   */
  async updateMessage(messageId, updates) {
    return this.callService('conversation', 'message.update', { messageId, ...updates });
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId) {
    return this.callService('conversation', 'message.delete', { messageId });
  }
}

module.exports = MCPClient;
