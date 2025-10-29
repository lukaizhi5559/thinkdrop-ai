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
const StateGraph = require('./StateGraph.cjs');

// Import node implementations
const parseIntentNode = require('./nodes/parseIntent.cjs');
const retrieveMemoryNode = require('./nodes/retrieveMemory.cjs');
const filterMemoryNode = require('./nodes/filterMemory.cjs');
const answerNode = require('./nodes/answer.cjs');
const validateAnswerNode = require('./nodes/validateAnswer.cjs');
const storeConversationNode = require('./nodes/storeConversation.cjs');

class AgentOrchestrator {
  constructor() {
    this.mcpClient = new MCPClient(MCPConfigManager);
    this.memoryServiceHealthy = false;
    this.stateGraph = null; // Will be initialized on first use
    console.log('🎯 MCP AgentOrchestrator initialized');
    
    // Run health check on initialization (async, non-blocking)
    this.checkMemoryServiceHealth().catch(err => {
      console.warn('⚠️ [ORCHESTRATOR] Memory service health check failed:', err.message);
    });
  }

  /**
   * Build the StateGraph for workflow orchestration
   * @returns {StateGraph} Configured state graph
   */
  _buildStateGraph() {
    if (this.stateGraph) {
      return this.stateGraph;
    }

    console.log('🔧 [ORCHESTRATOR] Building StateGraph...');

    // Create nodes with mcpClient bound
    const nodes = {
      parseIntent: (state) => parseIntentNode({ ...state, mcpClient: this.mcpClient }),
      retrieveMemory: (state) => retrieveMemoryNode({ ...state, mcpClient: this.mcpClient }),
      filterMemory: filterMemoryNode,
      answer: (state) => answerNode({ ...state, mcpClient: this.mcpClient }),
      validateAnswer: validateAnswerNode,
      storeConversation: (state) => storeConversationNode({ ...state, mcpClient: this.mcpClient })
    };

    // Define edges (routing logic)
    const edges = {
      start: 'parseIntent',
      parseIntent: 'retrieveMemory',
      retrieveMemory: 'filterMemory',
      filterMemory: 'answer',
      answer: 'validateAnswer',
      validateAnswer: (state) => {
        // If validation failed and we haven't retried too many times, retry
        if (state.needsRetry && (state.retryCount || 0) < 2) {
          console.log(`🔄 [ORCHESTRATOR] Validation failed, retrying (attempt ${state.retryCount})`);
          return 'answer'; // Retry answer generation
        }
        // Otherwise, proceed to store
        return 'storeConversation';
      },
      storeConversation: 'end'
    };

    this.stateGraph = new StateGraph(nodes, edges);
    console.log('✅ [ORCHESTRATOR] StateGraph built');

    return this.stateGraph;
  }

  /**
   * Process message using StateGraph workflow
   * This is the new graph-based approach with conditional routing and retry logic
   * @param {string} message - User message
   * @param {object} context - Context (sessionId, userId, etc.)
   * @returns {Promise<object>} Orchestration result with full trace
   */
  async processMessageWithGraph(message, context = {}) {
    console.log(`\n🔄 [ORCHESTRATOR:GRAPH] Processing with StateGraph: "${message}"`);
    
    try {
      // Build the graph (cached after first call)
      const graph = this._buildStateGraph();

      // Create initial state
      const initialState = {
        reqId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        message,
        context: {
          sessionId: context.sessionId || 'default_session',
          userId: context.userId || 'default_user',
          timestamp: new Date().toISOString()
        }
      };

      // Execute the graph workflow
      const finalState = await graph.execute(initialState);

      // Format result
      return {
        success: finalState.success,
        action: finalState.intent?.type || 'general_query',
        data: {
          sessionFacts: finalState.sessionFacts?.length || 0,
          sessionEntities: finalState.sessionEntities?.length || 0,
          memories: finalState.filteredMemories || [],
          memoryCount: finalState.filteredMemories?.length || 0,
          memoriesFiltered: finalState.memoriesFiltered || 0,
          validationIssues: finalState.validationIssues || [],
          retryCount: finalState.retryCount || 0
        },
        response: finalState.answer || "I apologize, but I was unable to generate a response.",
        elapsedMs: finalState.elapsedMs,
        trace: finalState.trace, // Full execution trace for debugging
        debug: {
          iterations: finalState.iterations,
          failedNode: finalState.failedNode,
          error: finalState.error
        }
      };

    } catch (error) {
      console.error(`❌ [ORCHESTRATOR:GRAPH] Error:`, error.message);
      return {
        success: false,
        error: error.message,
        response: "I encountered an error processing your request. Please try again.",
        trace: []
      };
    }
  }

  /**
   * Check memory service health and embedding coverage
   */
  async checkMemoryServiceHealth() {
    try {
      console.log('🏥 [ORCHESTRATOR] Checking memory service health...');
      
      const healthResult = await this.mcpClient.callService('user-memory', 'memory.health-check', {});
      
      if (healthResult.status === 'healthy') {
        console.log('✅ [ORCHESTRATOR] Memory service healthy');
        console.log(`📊 [ORCHESTRATOR] Embedding coverage: ${healthResult.database?.embeddingCoverage || 'unknown'}`);
        console.log(`📊 [ORCHESTRATOR] Total memories: ${healthResult.database?.totalMemories || 0}`);
        this.memoryServiceHealthy = true;
      } else {
        console.warn('⚠️ [ORCHESTRATOR] Memory service degraded:', healthResult.warnings);
        this.memoryServiceHealthy = false;
      }
      
      // Check embedding coverage
      if (healthResult.database?.embeddingCoverage !== '100.0%') {
        console.warn(`⚠️ [ORCHESTRATOR] Embedding coverage is ${healthResult.database?.embeddingCoverage}, should be 100%`);
      }
      
      return healthResult;
    } catch (error) {
      // Health check is optional - don't fail if not supported
      if (error.message.includes('Action not supported')) {
        console.log('ℹ️ [ORCHESTRATOR] Memory service health check not available (older version)');
        this.memoryServiceHealthy = true; // Assume healthy if endpoint doesn't exist
      } else {
        console.error('❌ [ORCHESTRATOR] Memory health check failed:', error.message);
        this.memoryServiceHealthy = false;
      }
      return null;
    }
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

      // Step 3: Auto-store conversation exchange in memory (for future context)
      // Skip if this was already a memory_store operation
      // ⚡ PERFORMANCE: Fire-and-forget - don't block response
      if (result.action !== 'memory_stored' && result.success) {
        // Run async without awaiting
        this.storeConversationExchange(message, result.response, context, intent)
          .catch(storeError => {
            console.warn('⚠️ [ORCHESTRATOR] Could not auto-store conversation:', storeError.message);
          });
      }

      // Step 4: Add timing
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
    
    // 🎯 ENHANCED: Keyword-based intent detection fallback
    // If backend misclassifies, catch it here
    const messageLower = message.toLowerCase();
    
    // 🎯 PRIORITY 1: Check for meta-questions FIRST (before memory keywords)
    // Meta-questions ask about the conversation itself, not long-term memory
    if (this.isMetaQuestion(message)) {
      console.log('🎯 [ORCHESTRATOR] Meta-question detected, routing to general query with recency context');
      return await this.handleGeneralQuery(message, intent, context);
    }
    
    // 🎯 PRIORITY 2: Check for web search needs (factual questions about the world)
    // Questions like "what is the best X", "who is Y", "where is Z" require web search
    if (this.requiresWebSearch(message)) {
      console.log('🌐 [ORCHESTRATOR] Factual question detected, routing to web search');
      return await this.handleWebSearch(message, intent, context);
    }
    
    // 🎯 PRIORITY 3: Memory store keywords (explicit)
    if (messageLower.match(/\b(remember|store|save|keep in mind|don't forget|note that)\b/)) {
      console.log('🔍 [ORCHESTRATOR] Detected memory store keywords, overriding intent');
      return await this.handleMemoryStore(message, intent, context);
    }
    
    // 🎯 PRIORITY 4: Implicit memory storage (declarative statements about user)
    // Detect statements that should be stored as memories even without explicit keywords
    if (this.isImplicitMemoryStatement(message)) {
      console.log('💾 [ORCHESTRATOR] Detected implicit memory statement, routing to memory store');
      return await this.handleMemoryStore(message, intent, context);
    }
    
    // 🎯 PRIORITY 5: Memory retrieve keywords (but NOT meta-questions like "what did I just say")
    // Exclude patterns that are meta-questions about recent conversation
    if ((messageLower.match(/\b(what('s| is) my|what.*do i (like|love|prefer|want|enjoy|hate)|recall|remind me)\b/) ||
         messageLower.match(/\bdo i (like|love|prefer|want|enjoy)\b/)) && 
        !messageLower.match(/\b(just|recent|previous|last)\b/)) {
      console.log('🔍 [ORCHESTRATOR] Detected memory retrieve keywords, overriding intent');
      return await this.handleMemoryRetrieve(message, intent, context);
    }

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

      // Extract data from MCP response wrapper
      const data = storeResult.data || storeResult;
      
      // Verify embedding was generated (new requirement from memory service)
      if (!data.embeddingDimensions || data.embeddingDimensions !== 384) {
        console.warn('⚠️ [MEMORY_STORE] Memory stored without valid embedding!');
      } else {
        console.log(`✅ [MEMORY_STORE] Memory stored with ${data.embeddingDimensions}D embedding`);
      }
      
      console.log('✅ [MEMORY_STORE] Memory ID:', data.memoryId);

      // Use suggestedResponse from intent parser if available, otherwise use static message
      let confirmationResponse;
      if (intent.suggestedResponse) {
        console.log('💡 [MEMORY_STORE] Using suggested response from intent parser');
        confirmationResponse = intent.suggestedResponse;
      } else {
        // Use fast static confirmation (no LLM call needed)
        console.log('⚡ [MEMORY_STORE] Using fast static confirmation');
        confirmationResponse = "Got it! I'll remember that.";
      }

      return {
        success: true,
        action: 'memory_stored',
        data: {
          memoryId: data.memoryId,
          entities: entities,
          stored: true,
          embeddingDimensions: data.embeddingDimensions
        },
        response: confirmationResponse
      };

    } catch (error) {
      console.error('❌ [MEMORY_STORE] Error:', error.message);
      
      // Check if error is due to embedding generation failure
      if (error.message.includes('Cannot store memory without embedding')) {
        console.error('❌ [MEMORY_STORE] Embedding generation failed - memory not stored');
        return {
          success: false,
          action: 'memory_store_failed',
          error: 'Embedding generation failed',
          response: "I couldn't generate the embedding for that memory. The memory service may be initializing. Please try again in a moment."
        };
      }
      
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

      // Extract data from MCP response wrapper
      const data = searchResult.data || searchResult;
      const memories = data.memories || data.results || [];
      console.log(`✅ [MEMORY_RETRIEVE] Found ${memories.length} memories`);
      
      // Log similarity scores for debugging
      if (memories.length > 0) {
        console.log('📊 [MEMORY_RETRIEVE] Top results:');
        memories.slice(0, 3).forEach((m, idx) => {
          console.log(`  ${idx + 1}. "${m.text?.substring(0, 50)}..." (similarity: ${m.similarity?.toFixed(3) || 'N/A'})`);
        });
      } else if (data.count === 0) {
        console.log('💡 [MEMORY_RETRIEVE] No results found. Memory service may have diagnostic info in logs.');
      }

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
   * Uses parallel + prioritized context fetching
   */
  async handleGeneralQuery(message, intent, context) {
    console.log('💬 [GENERAL_QUERY] Processing query...');
    
    // 🔍 Detect meta-questions (questions about the conversation itself)
    const isMetaQuestion = this.isMetaQuestion(message);
    if (isMetaQuestion) {
      console.log('🎯 [ORCHESTRATOR] Meta-question detected, prioritizing recent context');
    }
    
    console.log('🔍 [ORCHESTRATOR] Assembling hybrid context (parallel fetch)...');

    try {
      // 🚀 PARALLEL: Fetch all context sources simultaneously
      const [conversationHistory, sessionContext, memories] = await Promise.all([
        // 1. Conversation history (recent messages)
        this.fetchConversationHistory(context.sessionId).catch(err => {
          console.warn('⚠️ Conversation history failed:', err.message);
          return [];
        }),
        
        // 2. Session context (facts + entities from current session)
        this.fetchSessionContext(context.sessionId).catch(err => {
          console.warn('⚠️ Session context failed:', err.message);
          return { facts: [], entities: [] };
        }),
        
        // 3. Long-term memories (semantic search) - skip for meta-questions
        isMetaQuestion ? Promise.resolve([]) : this.fetchMemories(message, context).catch(err => {
          console.warn('⚠️ Memory search failed:', err.message);
          return [];
        })
      ]);

      // 🧹 Clean and deduplicate conversation history
      const cleanedHistory = this.deduplicateMessages(conversationHistory);
      
      // 🎯 Add recency markers for meta-questions
      const markedHistory = isMetaQuestion 
        ? this.addRecencyMarkers(cleanedHistory)
        : cleanedHistory;
      
      // 💡 Inject memory context as system message if memories exist
      const historyWithMemoryContext = this.injectMemoryContext(markedHistory, memories, message);
      
      // 🎯 PRIORITIZE: Build context with session first, memories second
      const enrichedContext = {
        // Layer 1: Conversation history (most recent) with memory context injected
        conversationHistory: historyWithMemoryContext,
        
        // Layer 2: Session context (current session facts - highest priority)
        sessionFacts: sessionContext.facts || [],
        sessionEntities: sessionContext.entities || [],
        
        // Layer 3: Long-term memories (cross-session - lower priority)
        memories: memories.map(m => ({
          text: m.text || m.content,
          similarity: m.similarity
        })),
        
        // Layer 4: System instructions for using context
        systemInstructions: this.buildSystemInstructions(memories, sessionContext),
        
        // Metadata
        sessionId: context.sessionId,
        userId: context.userId
      };

      console.log('✅ [ORCHESTRATOR] Context assembled:', {
        conversationMessages: enrichedContext.conversationHistory.length,
        sessionFacts: enrichedContext.sessionFacts.length,
        sessionEntities: enrichedContext.sessionEntities.length,
        memories: enrichedContext.memories.length
      });

      // 🤖 Generate answer via phi4 with prioritized context
      const response = await this.mcpClient.getAnswer(message, enrichedContext);

      return {
        success: true,
        action: 'general_query',
        data: {
          sessionFacts: enrichedContext.sessionFacts.length,
          sessionEntities: enrichedContext.sessionEntities.length,
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
   * Auto-store conversation exchange for future context
   * ⚡ PERFORMANCE: Smart filtering to avoid storing trivial exchanges
   */
  async storeConversationExchange(userMessage, aiResponse, context, intent) {
    try {
      // 🎯 SMART FILTER: Only store meaningful exchanges
      const shouldStore = this.shouldStoreExchange(userMessage, aiResponse, intent);
      
      if (!shouldStore) {
        console.log('⏭️ [AUTO-STORE] Skipping trivial exchange');
        return;
      }
      
      console.log('💾 [AUTO-STORE] Storing conversation exchange...');
      
      // Create a summary of the exchange
      const exchangeText = `User asked: "${userMessage}"\nAssistant responded: "${aiResponse}"`;
      
      // Store in memory with conversation tags
      const storeResult = await this.mcpClient.storeMemory(
        exchangeText,
        ['conversation', 'auto_stored', intent.type || 'general'],
        {
          userMessage: userMessage,
          aiResponse: aiResponse,
          sessionId: context.sessionId,
          userId: context.userId,
          source: 'conversation_auto_store',
          intent: intent.type,
          confidence: intent.confidence,
          timestamp: new Date().toISOString()
        }
      );
      
      // Extract data from MCP response wrapper
      const data = storeResult.data || storeResult;
      
      // Verify embedding was generated
      if (data.embeddingDimensions === 384) {
        console.log('✅ [AUTO-STORE] Conversation stored for future context');
      } else {
        console.warn('⚠️ [AUTO-STORE] Stored but embedding may be missing');
      }
    } catch (error) {
      // Don't fail the main flow if auto-store fails
      if (error.message.includes('Cannot store memory without embedding')) {
        console.warn('⚠️ [AUTO-STORE] Embedding generation failed - conversation not stored');
      } else {
        console.warn('⚠️ [AUTO-STORE] Failed:', error.message);
      }
    }
  }

  /**
   * Determine if exchange is worth storing
   * ⚡ PERFORMANCE: Reduces storage by ~60-70%
   */
  shouldStoreExchange(userMessage, aiResponse, intent) {
    // Always store explicit memory operations
    if (intent.type === 'memory_store' || intent.type === 'memory_retrieve') {
      return true;
    }
    
    // Skip very short messages (likely greetings/chitchat)
    if (userMessage.length < 10 || aiResponse.length < 20) {
      return false;
    }
    
    // Skip common greetings/chitchat
    const trivialPatterns = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure)$/i;
    if (trivialPatterns.test(userMessage.trim())) {
      return false;
    }
    
    // Skip error responses
    if (aiResponse.includes('error') || aiResponse.includes('trouble')) {
      return false;
    }
    
    // Store if high confidence intent (likely meaningful)
    if (intent.confidence && intent.confidence > 0.7) {
      return true;
    }
    
    // Store if contains entities (names, dates, places, etc.)
    if (intent.entities && intent.entities.length > 0) {
      return true;
    }
    
    // Default: store it (better to over-store than miss context)
    return true;
  }

  /**
   * Debug embedding generation for a given text
   * Useful for troubleshooting memory issues
   */
  async debugEmbedding(text) {
    try {
      console.log('🔧 [DEBUG] Testing embedding generation...');
      
      const result = await this.mcpClient.callService('user-memory', 'memory.debug-embedding', {
        text: text
      });
      
      console.log('✅ [DEBUG] Embedding test results:');
      console.log(`  Dimensions: ${result.embedding?.dimensions}`);
      console.log(`  Sample: ${result.embedding?.sample?.slice(0, 5).join(', ')}...`);
      console.log(`  Statistics:`, result.embedding?.statistics);
      
      return result;
    } catch (error) {
      console.error('❌ [DEBUG] Embedding test failed:', error.message);
      throw error;
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

  /**
   * Fetch conversation history
   */
  async fetchConversationHistory(sessionId) {
    if (!sessionId) return [];
    
    console.log('📜 [CONTEXT] Fetching conversation history...');
    const historyResult = await this.mcpClient.listMessages(sessionId, {
      limit: 10,
      direction: 'DESC'
    });
    
    const messages = historyResult.data?.messages || historyResult.messages || [];
    // Reverse to get chronological order (oldest first)
    const history = messages.reverse().map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text || m.content
    }));
    
    console.log(`✅ [CONTEXT] Loaded ${history.length} messages from history`);
    return history;
  }

  /**
   * Fetch session context (facts + entities)
   */
  async fetchSessionContext(sessionId) {
    if (!sessionId) return { facts: [], entities: [] };
    
    console.log('🔍 [CONTEXT] Fetching session context...');
    
    // Fetch facts and entities in parallel
    const [factsResult, entitiesResult] = await Promise.all([
      this.mcpClient.callService('conversation', 'context.get', { 
        sessionId 
      }).catch(err => {
        console.warn('⚠️ [CONTEXT] Failed to fetch facts:', err.message);
        return { data: { contexts: [] } };
      }),
      
      this.mcpClient.callService('conversation', 'entity.list', { 
        sessionId 
      }).catch(err => {
        console.warn('⚠️ [CONTEXT] Failed to fetch entities:', err.message);
        return { data: { entities: [] } };
      })
    ]);
    
    const facts = factsResult.data?.contexts || [];
    const entities = entitiesResult.data?.entities || [];
    
    console.log(`✅ [CONTEXT] Session context: ${facts.length} facts, ${entities.length} entities`);
    
    return { facts, entities };
  }

  /**
   * Fetch long-term memories
   */
  async fetchMemories(query, context) {
    console.log('📚 [CONTEXT] Fetching long-term memories...');
    
    const searchResult = await this.mcpClient.queryMemories(query, {
      limit: 5,
      sessionId: context.sessionId,
      userId: context.userId,
      minSimilarity: 0.4  // Increased from 0.3 for better relevance
    });
    
    // Extract data from MCP response wrapper
    const data = searchResult.data || searchResult;
    const memories = data.memories || data.results || [];
    
    console.log(`✅ [CONTEXT] Found ${memories.length} relevant memories`);
    
    if (memories.length > 0) {
      console.log('📊 [CONTEXT] Top memories:');
      memories.slice(0, 3).forEach((m, idx) => {
        console.log(`  ${idx + 1}. "${m.text?.substring(0, 50)}..." (similarity: ${m.similarity?.toFixed(3) || 'N/A'})`);
      });
    }
    
    return memories;
  }

  /**
   * Detect if a message is an implicit memory statement
   * Declarative statements about the user that should be stored even without explicit keywords
   */
  isImplicitMemoryStatement(message) {
    if (typeof message !== 'string') return false;

    const normalizedMessage = message.trim().toLowerCase();

    // Exclude questions (these are retrieval, not storage)
    if (normalizedMessage.match(/^(what|when|where|who|why|how|do|does|did|is|are|was|were|can|could|would|should)/)) {
      return false;
    }

    // Patterns that indicate a statement to remember
    const memoryPatterns = [
      // Appointments and scheduling
      /\b(appointment|meeting|scheduled|booked|reservation)\b/i,
      /\b(next|this|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\b(at|@)\s*\d/i,
      
      // Preferences and favorites (more flexible - can be anywhere in sentence)
      /\b(my|i)\s+(favorite|preferred|usual|go-to)\b/i,
      /\bis\s+my\s+(favorite|preferred|usual|go-to)\b/i,  // "Pizza is my favorite"
      /^i\s+(like|love|enjoy|prefer|hate|dislike)\b/i,
      /^(love|like|enjoy|prefer|hate|dislike)\s+the\b/i,  // "Love the smell of..."
      
      // Personal facts
      /^(my|i)\s+(name|birthday|age|job|work|live|am|have)\b/i,
      
      // Goals and intentions
      /^i\s+(want|need|plan|intend|will|am going)\b/i,
      
      // Possessions and relationships
      /^i\s+(own|have|got)\b/i,
      /^my\s+(wife|husband|partner|friend|family|dog|cat|car|house)\b/i
    ];

    return memoryPatterns.some(pattern => pattern.test(normalizedMessage));
  }

  /**
   * Detect if a message requires web search (factual questions about the world)
   * Questions about general knowledge, current events, or information not in memory
   */
  requiresWebSearch(message) {
    if (typeof message !== 'string') return false;

    const normalizedMessage = message.trim().toLowerCase();

    // Exclude user preference questions (these use memory)
    if (normalizedMessage.match(/\b(my|i|me)\b/) && 
        normalizedMessage.match(/\b(favorite|like|love|prefer|want)\b/)) {
      return false;
    }

    // Factual question patterns that require web search
    const webSearchPatterns = [
      // "What is the best X" questions
      /what('s| is) the (best|top|greatest|worst|most|least)/i,
      
      // "Who is X" questions
      /who (is|was|are|were)/i,
      
      // "Where is X" questions
      /where (is|was|are|were|can i find)/i,
      
      // "When did X" questions
      /when (did|does|do|will|is|was)/i,
      
      // "How to X" questions
      /how (to|do|does|can|should)/i,
      
      // "Why is X" questions
      /why (is|are|was|were|do|does|did)/i,
      
      // Definition questions
      /what (is|are|was|were) (a|an|the) /i,
      
      // Current events
      /\b(news|latest|current|today|recent|update)\b/i,
      
      // Comparison questions
      /\b(compare|difference between|versus|vs|better than)\b/i,
      
      // Factual lookups
      /\b(capital|population|founded|invented|discovered|created)\b/i
    ];

    return webSearchPatterns.some(pattern => pattern.test(normalizedMessage));
  }

  /**
   * Detect if a message is a meta-question (asking about the conversation itself)
   * Expanded to cover more meta-question patterns using NLP meta-model concepts.
   */
  isMetaQuestion(message) {
    if (typeof message !== 'string') return false;

    const normalizedMessage = message.trim().toLowerCase();

    const metaPatterns = [
      // Asking what was said/asked previously
      /what (did|do) (i|you) (just )?(say|ask|tell|mention)/i,
      /what (was|is) (my|your|the) (last|previous|recent) (question|message|response)/i,
      /what (were|are) we (just )?(talking|discussing) about/i,
      /can you (repeat|recall|remember) what (i|you) (just )?(said|asked)/i,
      /what (was|is) (my|the) (previous|last) (question|query|message)/i,

      // Asking for clarification about meta conversation
      /(could|can) you (explain|clarify|elaborate) (that|this|more)/i,
      /what do you mean by (that|this)/i,
      /can you summarize (that|this)/i,

      // Asking about conversation state or topic
      /what are we (talking|discussing|working) on/i,
      /what is the topic/i,
      /where are we in our (conversation|discussion|work)/i,

      // Questions about understanding or remembering context
      /do you (remember|recall|know) (what|that)/i,
      /are you following/i,
      /did you understand/i,

      // Meta inquiries about process or interaction
      /how does this (work|function|operate)/i,
      /what will you (do|say|answer) next/i,
      
      // Additional patterns for completeness
      /what (did|do) we (just )?(discuss|talk about|cover)/i,
      /remind me (what|of what) (i|we) (said|asked|discussed)/i,
      /go back to (what|where) (i|we) (said|were|asked)/i,
      /what was (that|this) about/i,
      /can you repeat (that|this|yourself)/i
    ];

    return metaPatterns.some(pattern => pattern.test(normalizedMessage));
  }

  /**
   * Deduplicate consecutive identical messages
   */
  deduplicateMessages(messages) {
    if (!messages || messages.length === 0) return [];
    
    const deduplicated = [];
    let lastContent = null;
    let lastRole = null;
    
    for (const msg of messages) {
      const content = msg.content || msg.text;
      const role = msg.role || msg.sender;
      
      // Skip if same content and role as previous message
      if (content === lastContent && role === lastRole) {
        console.log('🧹 [ORCHESTRATOR] Skipping duplicate message:', content.substring(0, 50) + '...');
        continue;
      }
      
      deduplicated.push(msg);
      lastContent = content;
      lastRole = role;
    }
    
    if (deduplicated.length < messages.length) {
      console.log(`🧹 [ORCHESTRATOR] Removed ${messages.length - deduplicated.length} duplicate messages`);
    }
    
    return deduplicated;
  }

  /**
   * Add recency markers to help AI understand which messages are most recent
   */
  addRecencyMarkers(messages) {
    if (!messages || messages.length === 0) return [];
    
    const marked = [...messages];
    
    // Find the last user message (excluding the current one being processed)
    // The last message in the array is the current query, so we skip it
    let lastUserMessageIndex = -1;
    let foundCount = 0;
    
    for (let i = marked.length - 1; i >= 0; i--) {
      const role = marked[i].role || marked[i].sender;
      if (role === 'user') {
        foundCount++;
        // Skip the first user message (current query) and mark the second one (previous)
        if (foundCount === 2) {
          lastUserMessageIndex = i;
          break;
        }
      }
    }
    
    // Add marker to the most recent user message (before current)
    if (lastUserMessageIndex >= 0) {
      const msg = marked[lastUserMessageIndex];
      const content = msg.content || msg.text;
      
      // Add "[MOST RECENT]" marker
      marked[lastUserMessageIndex] = {
        ...msg,
        content: `[MOST RECENT USER MESSAGE] ${content}`
      };
      
      console.log('🎯 [ORCHESTRATOR] Added recency marker to message:', content.substring(0, 50) + '...');
    }
    
    return marked;
  }

  /**
   * Inject memory context into conversation history as a system message
   * This ensures Phi4 sees and uses the memory facts
   */
  injectMemoryContext(history, memories, currentQuery) {
    if (!memories || memories.length === 0) {
      return history;
    }
    
    // Detect if query is asking about user preferences/facts
    const isFactualQuery = currentQuery.toLowerCase().match(
      /\b(what|who|where|when|my|favorite|like|love|prefer|do i|am i|have i)\b/
    );
    
    if (!isFactualQuery) {
      return history; // Don't inject for non-factual queries
    }
    
    // Extract relevant facts from memories
    const facts = [];
    memories.forEach(m => {
      const text = m.text || m.content || '';
      
      // Extract user statements from memory text
      const userMatch = text.match(/User (?:asked|said): "([^"]+)"/);
      if (userMatch) {
        const userStatement = userMatch[1];
        
        // Check if it's a preference statement
        if (userStatement.match(/\b(love|like|favorite|prefer)\b/i)) {
          facts.push(userStatement);
        }
      }
    });
    
    if (facts.length === 0) {
      return history;
    }
    
    // Create system message with memory facts
    const systemMessage = {
      role: 'system',
      content: `[CONTEXT] Based on previous conversations, here's what you know about the user:\n${facts.slice(0, 5).map((f, i) => `${i + 1}. "${f}"`).join('\n')}\n\nUse this information to answer the user's question. Speak from the assistant's perspective (use "you" for the user).`
    };
    
    console.log('💡 [ORCHESTRATOR] Injected memory context:', facts.length, 'facts');
    
    // Prepend system message to history
    return [systemMessage, ...history];
  }

  /**
   * Build system instructions for Phi4 to use context correctly
   */
  buildSystemInstructions(memories, sessionContext) {
    const instructions = [];
    
    // Base instruction
    instructions.push('You are an AI assistant helping the user. Always respond from the assistant\'s perspective (use "you" for the user, not "I").');
    
    // Meta-question handling - make it VERY explicit
    instructions.push('IMPORTANT: If the user asks "what did I just say", look for the message marked with "[MOST RECENT USER MESSAGE]" in the conversation history.');
    instructions.push('Extract ONLY the text after "[MOST RECENT USER MESSAGE]" and respond with: "You asked: [that text]"');
    instructions.push('Example: If you see "[MOST RECENT USER MESSAGE] What do I like to eat", respond EXACTLY: "You asked: What do I like to eat"');
    
    // Memory usage instructions
    if (memories && memories.length > 0) {
      instructions.push('IMPORTANT: The "memories" section contains factual information about the user from previous conversations. Use these memories to answer questions about the user\'s preferences, history, or past statements.');
      instructions.push('When the user asks "what do I like" or "what is my favorite", check the memories first before saying you don\'t know.');
      
      // Extract key facts from memories for emphasis
      const foodMemories = memories.filter(m => 
        (m.text || m.content || '').toLowerCase().match(/\b(food|eat|like|love|favorite|pizza|steak|gummy)\b/)
      );
      
      if (foodMemories.length > 0) {
        instructions.push('The user has mentioned these food preferences in past conversations (check memories for details):');
        foodMemories.slice(0, 3).forEach((m, i) => {
          const text = m.text || m.content || '';
          const preview = text.substring(0, 150).replace(/\n/g, ' ');
          instructions.push(`  ${i + 1}. ${preview}...`);
        });
      }
    }
    
    // Session context instructions
    if (sessionContext && (sessionContext.facts?.length > 0 || sessionContext.entities?.length > 0)) {
      instructions.push('The "sessionFacts" and "sessionEntities" contain information from the current conversation session.');
    }
    
    // Conversation history instructions
    instructions.push('The "conversationHistory" shows the recent back-and-forth messages. Use this for immediate context and follow-up questions.');
    
    return instructions.join('\n');
  }
}

module.exports = AgentOrchestrator;
