/**
 * MCP Agent Orchestrator - Private Mode
 * 
 * Lean orchestrator for private mode that dynamically routes to MCP services.
 * Replaces the 2600+ line monolithic orchestrator with clean, service-based architecture.
 * 
 * Flow:
 * 1. Parse intent via phi4 MCP
 * 2. Route to appropriate service(s)
 * 3. Generate response via phi4 MCP
 */

const MCPClient = require('./MCPClient.cjs');
const MCPConfigManager = require('./MCPConfigManager.cjs');

class AgentOrchestrator {
  constructor() {
    this.mcpClient = new MCPClient(MCPConfigManager);
    console.log('🎯 MCP AgentOrchestrator initialized');
  }

  /**
   * Main entry point: Process message in private mode
   * @param {string} message - User message
   * @param {object} context - Context (sessionId, userId, etc.)
   * @returns {Promise<object>} Orchestration result
   */
  async processMessage(message, context = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`\n🎯 [ORCHESTRATOR] Processing: "${message}"`);
      console.log(`📋 [ORCHESTRATOR] Context:`, { sessionId: context.sessionId, userId: context.userId });

      // Step 1: Parse intent via phi4
      const intent = await this.parseIntent(message, context);
      console.log(`🧠 [ORCHESTRATOR] Intent:`, intent);

      // Step 2: Route based on intent type
      const result = await this.routeIntent(intent, message, context);

      // Step 3: Add timing
      result.elapsedMs = Date.now() - startTime;
      console.log(`✅ [ORCHESTRATOR] Complete in ${result.elapsedMs}ms`);

      return result;

    } catch (error) {
      console.error(`❌ [ORCHESTRATOR] Error:`, error.message);
      return {
        success: false,
        error: error.message,
        response: "I encountered an error processing your request. Please try again.",
        elapsedMs: Date.now() - startTime
      };
    }
  }

  /**
   * Process pre-classified intent from backend (online mode)
   * @param {object} intentData - Intent classification from backend
   * @param {string} userMessage - Original user message
   * @param {object} context - Context (sessionId, etc.)
   * @returns {Promise<object>} Processing result
   */
  async processBackendIntent(intentData, userMessage, context = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`\n🎯 [ORCHESTRATOR] Processing backend intent: "${intentData.intent}"`);
      console.log(`📊 [ORCHESTRATOR] Confidence: ${intentData.confidence}, Query type: ${intentData.queryType}`);

      // Convert backend intent format to internal format
      const intent = {
        type: intentData.intent || intentData.primaryIntent || 'general_query',
        confidence: intentData.confidence || 0.8,
        queryType: intentData.queryType,
        requiresMemory: intentData.requiresMemoryAccess || false,
        requiresExternalData: intentData.requiresExternalData || false,
        suggestedResponse: intentData.suggestedResponse
      };

      // Route based on intent type (memory storage, web search, etc.)
      const result = await this.routeIntent(intent, userMessage, context);

      // Add timing
      result.elapsedMs = Date.now() - startTime;
      console.log(`✅ [ORCHESTRATOR] Backend intent processed in ${result.elapsedMs}ms`);

      return result;

    } catch (error) {
      console.error(`❌ [ORCHESTRATOR] Backend intent error:`, error.message);
      return {
        success: false,
        action: 'backend_intent_failed',
        error: error.message,
        response: "I had trouble processing that intent."
      };
    }
  }

  /**
   * Parse intent via phi4 service
   */
  async parseIntent(message, context) {
    try {
      const result = await this.mcpClient.parseIntent(message, {
        sessionId: context.sessionId,
        userId: context.userId
      });

      // Handle different response formats
      if (result.intent) {
        return result.intent;
      } else if (result.primaryIntent) {
        return {
          type: result.primaryIntent,
          confidence: result.confidence || 0.8,
          entities: result.entities || [],
          requiresMemory: result.requiresMemoryAccess || false
        };
      } else {
        // Fallback format
        return {
          type: result.type || 'general_query',
          confidence: result.confidence || 0.5,
          entities: result.entities || [],
          requiresMemory: false
        };
      }
    } catch (error) {
      console.error('❌ Intent parsing failed:', error.message);
      // Fallback to general query
      return {
        type: 'general_query',
        confidence: 0.5,
        entities: [],
        requiresMemory: false
      };
    }
  }

  /**
   * Route based on intent type
   */
  async routeIntent(intent, message, context) {
    const intentType = intent.type || intent.primaryIntent || 'general_query';

    switch (intentType.toLowerCase()) {
      // Memory operations
      case 'memory_store':
      case 'store_memory':
      case 'remember':
        return await this.handleMemoryStore(message, intent, context);

      case 'memory_retrieve':
      case 'retrieve_memory':
      case 'memory_query':
      case 'recall':
        return await this.handleMemoryRetrieve(message, intent, context);

      // Web search
      case 'web_search':
      case 'search':
      case 'lookup':
        return await this.handleWebSearch(message, intent, context);

      // Commands & actions
      case 'command':
      case 'action':
      case 'execute':
        return await this.handleCommand(message, intent, context);

      // Scheduling
      case 'schedule':
      case 'reminder':
      case 'calendar':
        return await this.handleScheduling(message, intent, context);

      // General queries (default)
      case 'general_query':
      case 'question':
      case 'general':
      case 'greeting':
      case 'chitchat':
      default:
        return await this.handleGeneralQuery(message, intent, context);
    }
  }

  /**
   * Handle memory storage
   */
  async handleMemoryStore(message, intent, context) {
    console.log('💾 [MEMORY_STORE] Storing memory...');

    try {
      // Extract entities if not already present
      let entities = intent.entities || [];
      if (entities.length === 0) {
        const entityResult = await this.mcpClient.extractEntities(message);
        entities = entityResult.entities || [];
      }

      // Store memory via user-memory service
      const storeResult = await this.mcpClient.storeMemory(
        message,
        intent.tags || ['user_input'],
        {
          entities: entities,
          sessionId: context.sessionId,
          userId: context.userId,
          source: 'private_mode',
          intent: intent.type,
          confidence: intent.confidence
        }
      );

      console.log('✅ [MEMORY_STORE] Memory stored:', storeResult.memoryId);

      // Generate confirmation response via phi4
      const response = await this.mcpClient.getAnswer(
        `Confirm that you've remembered: "${message}"`,
        {
          action: 'memory_stored',
          memoryId: storeResult.memoryId
        }
      );

      return {
        success: true,
        action: 'memory_stored',
        data: {
          memoryId: storeResult.memoryId,
          entities: entities,
          stored: true
        },
        response: response.answer || "Got it! I'll remember that."
      };

    } catch (error) {
      console.error('❌ [MEMORY_STORE] Error:', error.message);
      return {
        success: false,
        action: 'memory_store_failed',
        error: error.message,
        response: "I had trouble storing that memory. Please try again."
      };
    }
  }

  /**
   * Handle memory retrieval
   */
  async handleMemoryRetrieve(message, intent, context) {
    console.log('🔍 [MEMORY_RETRIEVE] Searching memories...');

    try {
      // Search memories via user-memory service
      const searchResult = await this.mcpClient.queryMemories(message, {
        limit: 5,
        sessionId: context.sessionId,
        userId: context.userId,
        minSimilarity: 0.3
      });

      const memories = searchResult.results || searchResult.memories || [];
      console.log(`✅ [MEMORY_RETRIEVE] Found ${memories.length} memories`);

      if (memories.length === 0) {
        return {
          success: true,
          action: 'memory_retrieved',
          data: { memories: [], count: 0 },
          response: "I don't have any memories matching that query."
        };
      }

      // Generate response with memory context via phi4
      const response = await this.mcpClient.getAnswer(
        message,
        {
          memories: memories.map(m => ({
            text: m.text || m.content,
            similarity: m.similarity,
            timestamp: m.timestamp || m.created_at
          })),
          action: 'memory_retrieved'
        }
      );

      return {
        success: true,
        action: 'memory_retrieved',
        data: {
          memories: memories,
          count: memories.length
        },
        response: response.answer || this.formatMemories(memories)
      };

    } catch (error) {
      console.error('❌ [MEMORY_RETRIEVE] Error:', error.message);
      return {
        success: false,
        action: 'memory_retrieve_failed',
        error: error.message,
        response: "I had trouble searching memories. Please try again."
      };
    }
  }

  /**
   * Handle web search
   */
  async handleWebSearch(message, intent, context) {
    console.log('🌐 [WEB_SEARCH] Searching web...');

    try {
      // Extract search query
      const query = this.extractSearchQuery(message, intent);

      // Search via web-search service
      const searchResult = await this.mcpClient.searchWeb(query, {
        maxResults: 5,
        language: 'en'
      });

      const results = searchResult.results || [];
      console.log(`✅ [WEB_SEARCH] Found ${results.length} results`);

      if (results.length === 0) {
        return {
          success: true,
          action: 'web_search',
          data: { results: [], count: 0 },
          response: "I couldn't find any results for that search."
        };
      }

      // Generate response with search results via phi4
      const response = await this.mcpClient.getAnswer(
        message,
        {
          searchResults: results.map(r => ({
            title: r.title,
            snippet: r.snippet || r.description,
            url: r.url
          })),
          action: 'web_search'
        }
      );

      return {
        success: true,
        action: 'web_search',
        data: {
          results: results,
          count: results.length,
          query: query
        },
        response: response.answer || this.formatSearchResults(results)
      };

    } catch (error) {
      console.error('❌ [WEB_SEARCH] Error:', error.message);
      return {
        success: false,
        action: 'web_search_failed',
        error: error.message,
        response: "I had trouble searching the web. Please try again."
      };
    }
  }

  /**
   * Handle general query
   */
  async handleGeneralQuery(message, intent, context) {
    console.log('💬 [GENERAL_QUERY] Processing query...');

    try {
      // Fetch conversation history for context
      let conversationHistory = [];
      if (context.sessionId) {
        console.log('📜 [GENERAL_QUERY] Fetching conversation history...');
        try {
          const historyResult = await this.mcpClient.listMessages(context.sessionId, {
            limit: 10,
            direction: 'DESC'
          });
          
          const messages = historyResult.data?.messages || historyResult.messages || [];
          // Reverse to get chronological order (oldest first)
          conversationHistory = messages.reverse().map(m => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text || m.content
          }));
          console.log(`✅ [GENERAL_QUERY] Loaded ${conversationHistory.length} messages from history`);
        } catch (histError) {
          console.warn('⚠️ [GENERAL_QUERY] Could not fetch conversation history:', histError.message);
        }
      }

      // Check if needs memory context
      let memories = [];
      if (intent.requiresMemory || intent.requiresMemoryAccess) {
        console.log('📚 [GENERAL_QUERY] Fetching memory context...');
        const searchResult = await this.mcpClient.queryMemories(message, {
          limit: 3,
          sessionId: context.sessionId,
          userId: context.userId
        });
        memories = searchResult.results || searchResult.memories || [];
        console.log(`✅ [GENERAL_QUERY] Found ${memories.length} relevant memories`);
      }

      // Generate answer via phi4 with conversation history
      const response = await this.mcpClient.getAnswer(
        message,
        {
          conversationHistory: conversationHistory,
          memories: memories.map(m => ({
            text: m.text || m.content,
            similarity: m.similarity
          })),
          sessionId: context.sessionId,
          userId: context.userId
        }
      );

      return {
        success: true,
        action: 'general_query',
        data: {
          memories: memories,
          memoryCount: memories.length
        },
        response: response.data?.answer || response.answer || "I'm not sure how to answer that."
      };

    } catch (error) {
      console.error('❌ [GENERAL_QUERY] Error:', error.message);
      return {
        success: false,
        action: 'general_query_failed',
        error: error.message,
        response: "I had trouble processing your query. Please try again."
      };
    }
  }

  /**
   * Extract search query from message
   */
  extractSearchQuery(message, intent) {
    // Remove common search prefixes
    let query = message
      .replace(/^(search for|search|find|look up|google)\s+/i, '')
      .trim();

    // Use entities if available
    if (intent.entities && intent.entities.length > 0) {
      const entityTexts = intent.entities.map(e => e.text || e.entity).filter(Boolean);
      if (entityTexts.length > 0) {
        query = entityTexts.join(' ');
      }
    }

    return query;
  }

  /**
   * Format memories for display
   */
  formatMemories(memories) {
    if (memories.length === 0) {
      return "I don't have any memories matching that.";
    }

    const formatted = memories
      .slice(0, 3)
      .map((m, i) => `${i + 1}. ${m.text || m.content}`)
      .join('\n');

    return `Here's what I remember:\n${formatted}`;
  }

  /**
   * Format search results for display
   */
  formatSearchResults(results) {
    if (results.length === 0) {
      return "I couldn't find any results.";
    }

    const formatted = results
      .slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet || r.description}`)
      .join('\n\n');

    return `Here's what I found:\n\n${formatted}`;
  }

  /**
   * Handle system commands
   */
  async handleCommand(message, intent, context) {
    console.log('⚙️ [COMMAND] Processing command...');

    try {
      // Extract command type from entities
      const commandType = intent.entities?.find(e => e.type === 'command')?.value || 'unknown';
      
      console.log(`🔧 [COMMAND] Command type: ${commandType}`);

      // For now, route to general query with command context
      // TODO: Add specific command handlers (screenshot, system info, etc.)
      const response = await this.mcpClient.getAnswer(
        message,
        {
          commandType: commandType,
          isCommand: true,
          sessionId: context.sessionId,
          userId: context.userId
        }
      );

      return {
        success: true,
        action: 'command',
        data: {
          commandType: commandType,
          executed: false // Not yet implemented
        },
        response: response.data?.answer || response.answer || "Command processing is not yet fully implemented."
      };

    } catch (error) {
      console.error('❌ [COMMAND] Error:', error.message);
      return {
        success: false,
        action: 'command_failed',
        error: error.message,
        response: "I had trouble processing that command."
      };
    }
  }

  /**
   * Handle scheduling/reminders
   */
  async handleScheduling(message, intent, context) {
    console.log('📅 [SCHEDULING] Processing scheduling request...');

    try {
      // Extract time/date entities
      const timeEntities = intent.entities?.filter(e => 
        e.type === 'time' || e.type === 'date' || e.type === 'datetime'
      ) || [];

      console.log(`⏰ [SCHEDULING] Found ${timeEntities.length} time entities`);

      // For now, route to general query with scheduling context
      // TODO: Add actual scheduling functionality via MCP service
      const response = await this.mcpClient.getAnswer(
        message,
        {
          isScheduling: true,
          timeEntities: timeEntities,
          sessionId: context.sessionId,
          userId: context.userId
        }
      );

      return {
        success: true,
        action: 'scheduling',
        data: {
          timeEntities: timeEntities,
          scheduled: false // Not yet implemented
        },
        response: response.data?.answer || response.answer || "Scheduling functionality is not yet fully implemented."
      };

    } catch (error) {
      console.error('❌ [SCHEDULING] Error:', error.message);
      return {
        success: false,
        action: 'scheduling_failed',
        error: error.message,
        response: "I had trouble processing that scheduling request."
      };
    }
  }

  /**
   * Execute custom MCP service action
   * For future extensibility
   */
  async executeCustomAction(serviceName, action, payload, context) {
    console.log(`🔧 [CUSTOM] Executing ${serviceName}.${action}...`);

    try {
      const result = await this.mcpClient.execute(serviceName, action, payload);

      return {
        success: true,
        action: `${serviceName}.${action}`,
        data: result,
        response: result.response || result.answer || "Action completed successfully."
      };

    } catch (error) {
      console.error(`❌ [CUSTOM] Error:`, error.message);
      return {
        success: false,
        action: `${serviceName}.${action}_failed`,
        error: error.message,
        response: "I had trouble executing that action."
      };
    }
  }
}

module.exports = AgentOrchestrator;
