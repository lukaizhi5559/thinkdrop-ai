/**
 * MCP Agent Orchestrator - StateGraph Edition
 * 
 * Clean orchestrator using StateGraph for intent-based routing.
 * All business logic moved to nodes for better testability and maintainability.
 * 
 * Architecture:
 * 1. StateGraph handles all routing (intent-based subgraphs)
 * 2. Nodes contain business logic (memory, search, answer, etc.)
 * 3. Edges define conditional routing (retry, intent-based, etc.)
 * 
 * Subgraphs:
 * - memory_store: parseIntent → storeMemory → end
 * - web_search: parseIntent → webSearch → sanitizeWeb → retrieveMemory → filterMemory → answer → validate → store → end
 * - retrieve/general: parseIntent → retrieveMemory → filterMemory → answer → validate → store → end
 */

const MCPClient = require('./MCPClient.cjs');
const MCPConfigManager = require('./MCPConfigManager.cjs');
const StateGraph = require('./StateGraph.cjs');

// Conditional logging based on environment variable
const DEBUG = process.env.DEBUG_STATEGRAPH === 'true';

// Import node implementations
const parseIntentNode = require('./nodes/parseIntent.cjs');
const retrieveMemoryNode = require('./nodes/retrieveMemory.cjs');
const filterMemoryNode = require('./nodes/filterMemory.cjs');
const resolveReferencesNode = require('./nodes/resolveReferences.cjs');
const answerNode = require('./nodes/answer.cjs');
const validateAnswerNode = require('./nodes/validateAnswer.cjs');
const storeConversationNode = require('./nodes/storeConversation.cjs');
// Intent-specific nodes
const webSearchNode = require('./nodes/webSearch.cjs');
const sanitizeWebNode = require('./nodes/sanitizeWeb.cjs');
const storeMemoryNode = require('./nodes/storeMemory.cjs');

class AgentOrchestrator {
  constructor() {
    this.mcpClient = new MCPClient(MCPConfigManager);
    this.memoryServiceHealthy = false;
    this.stateGraph = null; // Will be initialized on first use
    
    // Trace storage for performance monitoring
    this.traceHistory = [];
    this.maxTraceHistory = 100; // Keep last 100 traces
    
    console.log('🎯 MCP AgentOrchestrator initialized (StateGraph Edition)');
    
    // Run health check on initialization (async, non-blocking)
    this.checkMemoryServiceHealth().catch(err => {
      console.warn('⚠️ [ORCHESTRATOR] Memory service health check failed:', err.message);
    });
  }

  /**
   * Build the StateGraph for workflow orchestration with intent-based routing
   * @returns {StateGraph} Configured state graph
   */
  _buildStateGraph() {
    if (this.stateGraph) {
      return this.stateGraph;
    }

    if (DEBUG) {
      console.log('🔧 [ORCHESTRATOR] Building StateGraph with intent-based routing...');
    }

    // Create nodes with mcpClient bound
    const nodes = {
      // Early coreference resolution (before intent parsing)
      earlyResolveReferences: (state) => resolveReferencesNode({ ...state, mcpClient: this.mcpClient }),
      
      // Router node
      parseIntent: (state) => parseIntentNode({ ...state, mcpClient: this.mcpClient }),
      
      // Memory store subgraph
      storeMemory: (state) => storeMemoryNode({ ...state, mcpClient: this.mcpClient }),
      
      // Web search subgraph
      webSearch: (state) => webSearchNode({ ...state, mcpClient: this.mcpClient }),
      sanitizeWeb: sanitizeWebNode,
      
      // Memory retrieve / general query subgraph
      retrieveMemory: (state) => retrieveMemoryNode({ ...state, mcpClient: this.mcpClient }),
      filterMemory: filterMemoryNode,
      resolveReferences: (state) => {
        // Skip if already resolved early and no new context was added
        // This avoids redundant coreference calls when we already resolved before intent parsing
        const hasNewContext = (state.contextDocs && state.contextDocs.length > 0) || 
                              (state.memories && state.memories.length > 0);
        
        if (state.resolvedMessage && !hasNewContext) {
          console.log('⏭️  [NODE:RESOLVE_REFERENCES] Skipping - already resolved early, no new context');
          return state;
        }
        
        // Re-resolve if we have new context (web search results, memories)
        // The fresh context might help resolve references better
        if (hasNewContext) {
          console.log('🔄 [NODE:RESOLVE_REFERENCES] Re-resolving with new context (web/memory results)');
        }
        
        return resolveReferencesNode({ ...state, mcpClient: this.mcpClient });
      },
      
      // Parallel execution nodes
      parallelWebAndMemory: async (state) => {
        console.log('🔄 [NODE:PARALLEL] Running webSearch + retrieveMemory in parallel...');
        return await this.stateGraph.executeParallel(['webSearch', 'retrieveMemory'], state);
      },
      parallelSanitizeAndFilter: async (state) => {
        console.log('🔄 [NODE:PARALLEL] Running sanitizeWeb + filterMemory in parallel...');
        return await this.stateGraph.executeParallel(['sanitizeWeb', 'filterMemory'], state);
      },
      
      // Shared answer/validate/store tail
      answer: (state) => answerNode({ ...state, mcpClient: this.mcpClient }),
      validateAnswer: validateAnswerNode,
      storeConversation: (state) => storeConversationNode({ ...state, mcpClient: this.mcpClient })
    };

    // Define edges with intent-based routing
    const edges = {
      start: 'earlyResolveReferences',
      earlyResolveReferences: 'parseIntent',
      
      // Router: Route based on intent type
      parseIntent: (state) => {
        const intentType = state.intent?.type || 'general_query';
        const useOnlineMode = state.useOnlineMode || false;
        console.log(`🎯 [STATEGRAPH:ROUTER] Intent: ${intentType} → Routing to subgraph (Online: ${useOnlineMode})`);
        
        // Memory store: save information
        if (intentType === 'memory_store' || intentType === 'store_memory' || intentType === 'remember') {
          return 'storeMemory';
        }
        
        // 🌐 ONLINE MODE: Skip web search, online LLMs have up-to-date knowledge
        if (useOnlineMode) {
          console.log('🌐 [STATEGRAPH:ROUTER] Online mode active - skipping web search, using online LLM');
          
          // Commands: system commands (TODO: implement command execution node)
          if (intentType === 'command') {
            console.warn('⚠️ [STATEGRAPH:ROUTER] Command intent not yet implemented, routing to answer');
            return 'answer'; // For now, just answer (future: add command execution node)
          }
          
          // For greetings, skip memory retrieval
          if (intentType === 'greeting') {
            return 'answer';
          }
          
          // For all other intents, retrieve memory but skip web search
          return 'retrieveMemory';
        }
        
        // 🔒 PRIVATE MODE: Use web search for time-sensitive queries
        // Web search: time-sensitive queries, factual questions, and general knowledge
        // These should always try web search first, fallback to LLM if offline/no results
        if (intentType === 'web_search' || intentType === 'search' || intentType === 'lookup' ||
            intentType === 'question' || intentType === 'general_knowledge') {
          return 'parallelWebAndMemory'; // ⚡ PARALLEL: webSearch + retrieveMemory
        }
        
        // Greeting: quick response, no memory needed
        if (intentType === 'greeting') {
          return 'answer'; // Skip memory retrieval for greetings
        }
        
        // Command: system commands (TODO: implement command execution node)
        if (intentType === 'command') {
          console.warn('⚠️ [STATEGRAPH:ROUTER] Command intent not yet implemented, routing to answer');
          return 'answer'; // For now, just answer (future: add command execution node)
        }
        
        // Context, memory_retrieve, and unknowns: standard path (retrieve from memory only)
        return 'retrieveMemory';
      },
      
      // Memory store subgraph (direct to end, already has answer)
      storeMemory: 'end',
      
      // Web search subgraph with parallel execution
      parallelWebAndMemory: 'parallelSanitizeAndFilter', // ⚡ PARALLEL: sanitizeWeb + filterMemory
      parallelSanitizeAndFilter: 'resolveReferences',
      
      // Memory retrieve / general query subgraph (sequential)
      retrieveMemory: 'filterMemory',
      filterMemory: 'resolveReferences',
      resolveReferences: 'answer',
      
      // Shared tail: answer → validate → store
      answer: 'validateAnswer',
      validateAnswer: (state) => {
        const isStreaming = !!state.streamCallback;
        const useOnlineMode = state.useOnlineMode || false;
        
        // PRIORITY 1: Check if LLM requested web search
        // 🌐 SKIP in online mode - online LLMs have up-to-date knowledge
        if (state.shouldPerformWebSearch && !useOnlineMode) {
          console.log(`🔍 [STATEGRAPH:WEB_SEARCH_NEEDED] LLM needs web search, routing to webSearch node`);
          // For streaming mode, we need to send a follow-up message
          if (isStreaming && state.streamCallback) {
            // Send a message that we're now searching
            state.streamCallback('\n\n🔍 Searching online for that information...\n\n');
          }
          return 'webSearch'; // Perform web search then retry answer
        }
        
        // 🌐 Log if web search was requested but skipped due to online mode
        if (state.shouldPerformWebSearch && useOnlineMode) {
          console.log(`⏭️  [STATEGRAPH:WEB_SEARCH_SKIPPED] Online mode active - skipping web search request`);
        }
        
        // PRIORITY 2: Retry logic for other validation failures
        // BUT: Don't retry if streaming (causes double responses in UI)
        if (state.needsRetry && (state.retryCount || 0) < 2 && !isStreaming) {
          console.log(`🔄 [STATEGRAPH:RETRY] Validation failed, retrying (attempt ${state.retryCount + 1})`);
          return 'answer'; // Retry answer generation
        }
        if (state.needsRetry && isStreaming) {
          console.log(`⏭️  [STATEGRAPH:RETRY] Skipping retry for streaming mode (would cause double response)`);
        }
        // Otherwise, proceed to store conversation
        return 'storeConversation';
      },
      webSearch: 'sanitizeWeb', // After web search, sanitize and re-answer
      sanitizeWeb: 'answer', // Go back to answer with web results
      storeConversation: 'end'
    };

    this.stateGraph = new StateGraph(nodes, edges);
    if (DEBUG) {
      console.log('✅ [ORCHESTRATOR] StateGraph built with 3 subgraphs (memory_store, web_search, retrieve/general)');
    }

    return this.stateGraph;
  }

  /**
   * Process message using StateGraph workflow with intent-based routing
   * @param {string} message - User message
   * @param {object} context - Context (sessionId, userId, useOnlineMode, onlineLLMClient, etc.)
   * @param {Function} onProgress - Optional callback for progress updates
   * @param {Function} onStreamToken - Optional callback for streaming tokens from answer node
   * @returns {Promise<object>} Orchestration result with full trace
   */
  async processMessageWithGraph(message, context = {}, onProgress = null, onStreamToken = null) {
    // 🌐 Extract online mode flag from context
    const useOnlineMode = context.useOnlineMode || false;
    
    if (DEBUG) {
      console.log(`\n🔄 [ORCHESTRATOR:GRAPH] Processing with StateGraph: "${message}"`);
      console.log(`🌊 [ORCHESTRATOR:GRAPH] Streaming enabled: ${!!onStreamToken}`);
      console.log(`🌐 [ORCHESTRATOR:GRAPH] Online mode: ${useOnlineMode ? 'ENABLED (fallback to private)' : 'DISABLED'}`);
    }
    
    try {
      // Build the graph (cached after first call)
      const graph = this._buildStateGraph();

      // Use conversation history from context if provided (caller should fetch BEFORE adding user message)
      const conversationHistory = context.conversationHistory || [];

      // Create initial state with conversation history for cache key generation
      const initialState = {
        reqId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        message,
        context: {
          sessionId: context.sessionId || 'default_session',
          userId: context.userId || 'default_user',
          timestamp: new Date().toISOString(),
          conversationHistory // Include for context-aware cache key
        },
        streamCallback: onStreamToken, // Pass streaming callback to answer node
        useOnlineMode // 🌐 Pass online mode flag to answer node
      };

      // Execute the graph workflow with progress callback
      const finalState = await graph.execute(initialState, onProgress);

      // Store trace for performance monitoring
      this._storeTrace({
        id: initialState.reqId,
        message,
        sessionId: context.sessionId || 'default_session',
        intentType: finalState.intent?.type,
        startTime: finalState.startTime,
        elapsedMs: finalState.elapsedMs,
        iterations: finalState.iterations,
        success: finalState.success,
        trace: finalState.trace,
        error: finalState.error,
        fromCache: finalState.fromCache,
        cacheAge: finalState.cacheAge
      });

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
        console.warn('⚠️ [ORCHESTRATOR] Memory service degraded:', healthResult.message);
        this.memoryServiceHealthy = false;
      }

      // Check embedding coverage
      const embeddingCoverage = healthResult.database?.embeddingCoverage;
      if (embeddingCoverage && embeddingCoverage !== '100%') {
        console.warn(`⚠️ [ORCHESTRATOR] Embedding coverage is ${embeddingCoverage}, should be 100%`);
      }

    } catch (error) {
      console.error('❌ [ORCHESTRATOR] Memory service health check failed:', error.message);
      this.memoryServiceHealthy = false;
    }
  }

  /**
   * Store workflow trace for performance monitoring
   * @private
   */
  _storeTrace(trace) {
    this.traceHistory.unshift(trace); // Add to beginning (most recent first)
    
    // Trim to max size
    if (this.traceHistory.length > this.maxTraceHistory) {
      this.traceHistory = this.traceHistory.slice(0, this.maxTraceHistory);
    }
  }

  /**
   * Get workflow traces for performance monitoring
   * @param {object} options - Query options
   * @returns {Array} Traces
   */
  getWorkflowTraces(options = {}) {
    const {
      limit = 50,
      includeCache = true,
      sessionId = null
    } = options;

    let traces = this.traceHistory;

    // Filter by session if specified
    if (sessionId) {
      traces = traces.filter(t => t.sessionId === sessionId);
    }

    // Filter out cached results if requested
    if (!includeCache) {
      traces = traces.filter(t => !t.fromCache);
    }

    // Limit results
    return traces.slice(0, limit);
  }

  /**
   * Clear trace history
   */
  clearTraceHistory() {
    this.traceHistory = [];
    console.log('🧹 [ORCHESTRATOR] Trace history cleared');
  }
}

module.exports = AgentOrchestrator;
