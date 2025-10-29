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

// Import node implementations
const parseIntentNode = require('./nodes/parseIntent.cjs');
const retrieveMemoryNode = require('./nodes/retrieveMemory.cjs');
const filterMemoryNode = require('./nodes/filterMemory.cjs');
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

    console.log('🔧 [ORCHESTRATOR] Building StateGraph with intent-based routing...');

    // Create nodes with mcpClient bound
    const nodes = {
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
      
      // Shared answer/validate/store tail
      answer: (state) => answerNode({ ...state, mcpClient: this.mcpClient }),
      validateAnswer: validateAnswerNode,
      storeConversation: (state) => storeConversationNode({ ...state, mcpClient: this.mcpClient })
    };

    // Define edges with intent-based routing
    const edges = {
      start: 'parseIntent',
      
      // Router: Route based on intent type
      parseIntent: (state) => {
        const intentType = state.intent?.type || 'general_query';
        console.log(`🎯 [STATEGRAPH:ROUTER] Intent: ${intentType} → Routing to subgraph`);
        
        if (intentType === 'memory_store' || intentType === 'store_memory' || intentType === 'remember') {
          return 'storeMemory';
        }
        if (intentType === 'web_search' || intentType === 'search' || intentType === 'lookup') {
          return 'webSearch';
        }
        // memory_retrieve, general_query, and unknowns go to retrieve path
        return 'retrieveMemory';
      },
      
      // Memory store subgraph (direct to end, already has answer)
      storeMemory: 'end',
      
      // Web search subgraph (now includes memory retrieval for context)
      webSearch: 'sanitizeWeb',
      sanitizeWeb: 'retrieveMemory',
      
      // Memory retrieve / general query subgraph
      retrieveMemory: 'filterMemory',
      filterMemory: 'answer',
      
      // Shared tail: answer → validate → store
      answer: 'validateAnswer',
      validateAnswer: (state) => {
        // Retry logic: if validation failed and we haven't retried too many times
        if (state.needsRetry && (state.retryCount || 0) < 2) {
          console.log(`🔄 [STATEGRAPH:RETRY] Validation failed, retrying (attempt ${state.retryCount + 1})`);
          return 'answer'; // Retry answer generation
        }
        // Otherwise, proceed to store conversation
        return 'storeConversation';
      },
      storeConversation: 'end'
    };

    this.stateGraph = new StateGraph(nodes, edges);
    console.log('✅ [ORCHESTRATOR] StateGraph built with 3 subgraphs (memory_store, web_search, retrieve/general)');

    return this.stateGraph;
  }

  /**
   * Process message using StateGraph workflow
   * This is the main entry point for all message processing
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
}

module.exports = AgentOrchestrator;
