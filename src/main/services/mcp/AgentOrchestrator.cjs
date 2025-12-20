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
const executeCommandNode = require('./nodes/executeCommand.cjs');
const visionNode = require('./nodes/vision.cjs');
const screenIntelligenceNode = require('./nodes/screenIntelligence.cjs');
// Overlay system nodes
const selectOverlayVariantNode = require('./nodes/selectOverlayVariant.cjs');
const overlayOutputNode = require('./nodes/overlayOutput.cjs');

const logger = require('./../../logger.cjs');
class AgentOrchestrator {
  constructor() {
    this.mcpClient = new MCPClient(MCPConfigManager);
    this.memoryServiceHealthy = false;
    this.stateGraph = null; // Will be initialized on first use
    
    // Trace storage for performance monitoring
    this.traceHistory = [];
    this.maxTraceHistory = 100; // Keep last 100 traces
    
    logger.debug('🎯 MCP AgentOrchestrator initialized (StateGraph Edition)');
    
    // Run health check on initialization (async, non-blocking)
    this.checkMemoryServiceHealth().catch(err => {
      logger.warn('⚠️ [ORCHESTRATOR] Memory service health check failed:', err.message);
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
      logger.debug('🔧 [ORCHESTRATOR] Building StateGraph with intent-based routing...');
    }

    // Create nodes with mcpClient bound
    const nodes = {
      // Early coreference resolution (before intent parsing)
      earlyResolveReferences: (state) => resolveReferencesNode({ ...state, mcpClient: this.mcpClient }),
      
      // Router node
      parseIntent: (state) => parseIntentNode({ ...state, mcpClient: this.mcpClient }),
      
      // Memory store subgraph
      storeMemory: (state) => storeMemoryNode({ ...state, mcpClient: this.mcpClient }),
      
      // Command execution subgraph
      executeCommand: (state) => executeCommandNode({ ...state, mcpClient: this.mcpClient }),
      
      // Screen intelligence subgraph (primary screen analysis)
      screenIntelligence: (state) => screenIntelligenceNode({ ...state, mcpClient: this.mcpClient }),
      
      // Vision processing subgraph (fallback for screen intelligence failures)
      vision: (state) => visionNode({ ...state, mcpClient: this.mcpClient }),
      
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
          logger.debug('⏭️  [NODE:RESOLVE_REFERENCES] Skipping - already resolved early, no new context');
          return state;
        }
        
        // Re-resolve if we have new context (web search results, memories)
        // The fresh context might help resolve references better
        if (hasNewContext) {
          logger.debug('🔄 [NODE:RESOLVE_REFERENCES] Re-resolving with new context (web/memory results)');
        }
        
        return resolveReferencesNode({ ...state, mcpClient: this.mcpClient });
      },
      
      // Parallel execution nodes
      parallelWebAndMemory: async (state) => {
        // Check if query mentions screen-related keywords that might benefit from screen context
        // NOTE: This is a TEMPORARY fallback until Phase 3 multi-intent support
        // Being overly inclusive to avoid false negatives - false positives are acceptable
        const queryLower = (state.message || '').toLowerCase();
        const screenKeywords = [
          // Screen references
          'on my screen', 'on the screen', 'on this screen', 'on screen',
          'my screen', 'the screen', 'this screen',
          'what i see', 'what im seeing', "what i'm seeing", 'what i am seeing',
          'looking at', 'viewing', 'seeing', 'visible',
          
          // Code references
          'my code', 'this code', 'the code', 'my script', 'this script', 'the script',
          'my function', 'this function', 'the function',
          'my class', 'this class', 'the class',
          'my component', 'this component', 'the component',
          'my file', 'this file', 'the file',
          'my program', 'this program', 'the program',
          'my app', 'this app', 'the app',
          'my implementation', 'this implementation', 'the implementation',
          'my logic', 'this logic', 'the logic',
          'my method', 'this method', 'the method',
          
          // Styling references
          'my css', 'this css', 'the css',
          'my styles', 'this style', 'the style',
          'my styling', 'this styling', 'the styling',
          'my html', 'this html', 'the html',
          'my layout', 'this layout', 'the layout',
          
          // Error references
          'this error', 'the error', 'error message', 'error code',
          'this bug', 'the bug', 'this issue', 'the issue',
          'this problem', 'the problem', 'this warning', 'the warning',
          'this exception', 'the exception',
          
          // Content references
          'this page', 'the page', 'this website', 'the website',
          'this email', 'the email', 'this message', 'the message',
          'this text', 'the text', 'this document', 'the document',
          
          // Action verbs that imply screen content
          'debug this', 'fix this', 'correct this', 'improve this',
          'check this', 'review this', 'analyze this', 'explain this',
          'translate this', 'rewrite this', 'polish this', 'optimize this',
          
          // Questions about visible content
          'what does this', 'what is this', 'what are these',
          'why does this', 'why is this', 'why are these',
          'how does this', 'how is this', 'how are these',
          'where is this', 'where are these'
        ];
        
        // More specific check: must match keyword AND be at start of sentence or after punctuation
        // This prevents false positives like "in the world" matching "in the"
        const needsScreenContext = screenKeywords.some(keyword => {
          // Check if keyword appears as a distinct phrase (not part of a larger phrase)
          const regex = new RegExp(`(^|[.!?]\\s+)${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
          return regex.test(queryLower);
        });
        
        if (needsScreenContext && state.intent?.type === 'question') {
          logger.debug('🎯 [NODE:PARALLEL] Question mentions screen content - capturing screen context first...');
          try {
            // Capture screen context before parallel execution
            const screenState = await screenIntelligenceNode({ ...state, mcpClient: this.mcpClient });
            // Merge screen context into state
            state = { ...state, ...screenState };
            logger.debug('✅ [NODE:PARALLEL] Screen context captured, proceeding with web search + memory retrieval');
          } catch (error) {
            logger.warn('⚠️  [NODE:PARALLEL] Failed to capture screen context, continuing without it:', error.message);
          }
        }
        
        logger.debug('🔄 [NODE:PARALLEL] Running webSearch + retrieveMemory in parallel...');
        return await this.stateGraph.executeParallel(['webSearch', 'retrieveMemory'], state);
      },
      parallelSanitizeAndFilter: async (state) => {
        logger.debug('🔄 [NODE:PARALLEL] Running sanitizeWeb + filterMemory in parallel...');
        return await this.stateGraph.executeParallel(['sanitizeWeb', 'filterMemory'], state);
      },
      parallelScreenAndMemory: async (state) => {
        logger.debug('🔄 [NODE:PARALLEL] Running screenIntelligence + retrieveMemory in parallel...');
        return await this.stateGraph.executeParallel(['screenIntelligence', 'retrieveMemory'], state);
      },
      parallelCommandAndMemory: async (state) => {
        logger.debug('🔄 [NODE:PARALLEL] Running executeCommand + retrieveMemory in parallel...');
        return await this.stateGraph.executeParallel(['executeCommand', 'retrieveMemory'], state);
      },
      parallelScreenFilterMemory: async (state) => {
        logger.debug('🔄 [NODE:PARALLEL] Running filterMemory + resolveReferences after screen intelligence...');
        // Filter memory results, then resolve references
        const filteredState = await filterMemoryNode({ ...state, mcpClient: this.mcpClient });
        return await resolveReferencesNode({ ...filteredState, mcpClient: this.mcpClient });
      },
      parallelCommandFilterMemory: async (state) => {
        logger.debug('🔄 [NODE:PARALLEL] Running filterMemory + resolveReferences after command execution...');
        // Filter memory results, then resolve references
        const filteredState = await filterMemoryNode({ ...state, mcpClient: this.mcpClient });
        return await resolveReferencesNode({ ...filteredState, mcpClient: this.mcpClient });
      },
      
      // Shared answer/validate/store tail
      answer: (state) => answerNode({ ...state, mcpClient: this.mcpClient }),
      validateAnswer: validateAnswerNode,
      storeConversation: (state) => storeConversationNode({ ...state, mcpClient: this.mcpClient }),
      
      // Overlay system nodes
      selectOverlayVariant: selectOverlayVariantNode,
      overlayOutput: overlayOutputNode
    };

    // Define edges with intent-based routing
    const edges = {
      start: 'earlyResolveReferences',
      earlyResolveReferences: 'parseIntent',
      
      // Router: Route based on intent type
      parseIntent: (state) => {
        const intentType = state.intent?.type || 'general_query';
        const useOnlineMode = state.useOnlineMode || false;
        logger.debug(`🎯 [STATEGRAPH:ROUTER] Intent: ${intentType} → Routing to subgraph (Online: ${useOnlineMode})`);
        console.log(`🎯 [STATEGRAPH:ROUTER] Intent: ${intentType} → Routing to subgraph (Online: ${useOnlineMode})`);
        // Memory store: save information
        if (intentType === 'memory_store') {
          return 'storeMemory';
        }
        
        // 🌐 ONLINE MODE: Skip web search, online LLMs have up-to-date knowledge
        if (useOnlineMode) {
          logger.debug('🌐 [STATEGRAPH:ROUTER] Online mode active - skipping web search, using online LLM');
          
          // Screen Intelligence: Primary screen analysis with memory context
          // Vision intent now routes to screen intelligence first, falls back to vision service if needed
          if (intentType === 'screen_intelligence') {
            logger.debug('🎯 [STATEGRAPH:ROUTER] Screen analysis intent detected - running with memory context');
            return 'parallelScreenAndMemory'; // ⚡ PARALLEL: screenIntelligence + retrieveMemory
          }
          
          // Command Automate: Complex UI automation with memory context for personalization
          if (intentType === 'command_automate') {
            logger.debug('🤖 [STATEGRAPH:ROUTER] Command automation intent detected - running with memory context');
            return 'parallelCommandAndMemory'; // ⚡ PARALLEL: executeCommand + retrieveMemory
          }
          
          // Simple Commands: Direct execution without memory (faster)
          if (intentType === 'command_execute' || intentType === 'command_guide') {
            logger.debug(`⚡ [STATEGRAPH:ROUTER] Command intent detected (${intentType}) - routing to executeCommand`);
            return 'executeCommand';
          }
          
          // For greetings, skip memory retrieval
          if (intentType === 'greeting') {
            return 'answer';
          }
          
          // For all other intents, retrieve memory but skip web search
          return 'retrieveMemory';
        }
        
        // 🔒 PRIVATE MODE: Use web search for time-sensitive queries
        logger.debug(`⚡ [STATEGRAPH:ROUTER] intent detected in Private Mode (${intentType}) - routing`);

        // Screen Intelligence: Requires online mode for optimal performance
        if (intentType === 'screen_intelligence') {
          logger.warn('🔒 [STATEGRAPH:ROUTER] Screen intelligence requires online mode - blocking in private mode');
          // Set error state and route to overlay system
          state.answer = '🔒 **Screen Intelligence is only available in Online Mode**\n\nThis feature requires real-time screen analysis capabilities that work best with online services. Please switch to Online Mode to use screen intelligence features.';
          state.intentContext = state.intentContext || {};
          state.intentContext.intent = 'screen_intelligence';
          state.intentContext.uiVariant = 'error';
          state.intentContext.slots = {
            error: 'private_mode_blocked',
            errorMessage: 'Screen intelligence requires online mode',
            query: state.message
          };
          return 'selectOverlayVariant'; // Route to overlay system to display error
        }
        
        // Commands: Requires online mode for execution safety and interpretation
        if (intentType === 'command_automate' || intentType === 'command_guide') {
          logger.warn(`🔒 [STATEGRAPH:ROUTER] Command execution requires online mode - blocking in private mode (${intentType})`);
          // Set error state and route to overlay system
          state.answer = '🔒 **Command Execution is only available in Online Mode**\n\nFor security and optimal performance, command execution features require online mode. Please switch to Online Mode to execute system commands.';
          state.intentContext = state.intentContext || {};
          state.intentContext.intent = intentType;
          state.intentContext.uiVariant = 'error';
          state.intentContext.slots = {
            error: 'private_mode_blocked',
            errorMessage: 'Command execution requires online mode',
            query: state.message
          };
          return 'selectOverlayVariant'; // Route to overlay system to display error
        }

        if (intentType === 'command_execute') {
            return 'executeCommand';
        }
        
        // Web search: time-sensitive queries, factual questions, and general knowledge
        // These should always try web search first, fallback to LLM if offline/no results
        if (intentType === 'web_search' || intentType === 'question' || intentType === 'general_knowledge') {
          return 'parallelWebAndMemory'; // ⚡ PARALLEL: webSearch + retrieveMemory
        }
        
        // Greeting: quick response, no memory needed
        if (intentType === 'greeting') {
          return 'answer'; // Skip memory retrieval for greetings
        }
        
        // Memory_retrieve and unknowns: standard path (retrieve from memory only)
        return 'retrieveMemory';
      },
      
      // Memory store subgraph (route through overlay system to display answer)
      storeMemory: 'selectOverlayVariant',
      
      // Screen intelligence subgraph (primary screen analysis - now uses fast DuckDB queries)
      screenIntelligence: (state) => {
        // If screen intelligence failed, fallback to vision service
        if (state.screenIntelligenceError) {
          logger.debug('⚠️  [STATEGRAPH:FALLBACK] Screen intelligence failed, falling back to vision service');
          return 'vision';
        }
        // If screen intelligence already generated an answer (from vision API), skip answer node
        if (state.answer) {
          logger.debug('✅ [STATEGRAPH:SCREEN_INTELLIGENCE] Answer already generated by vision API, skipping LLM');
          return 'selectOverlayVariant';
        }
        // Screen intelligence succeeded, proceed to answer
        // Note: Predictive cache is generated in background by main.cjs when screen data is cached
        return 'answer';
      },
      
      // Vision processing subgraph (fallback only)
      vision: (state) => {
        // Vision node adds visual context to state as fallback
        // Always proceed to answer node to interpret visual content
        return 'answer';
      },
      
      // Command execution subgraph
      executeCommand: (state) => {
        // If command execution requested retry with different intent, route to that intent
        if (state.retryWithIntent === 'screen_intelligence') {
          logger.debug('🔄 [STATEGRAPH:RETRY] Command failed, retrying as screen_intelligence');
          return 'screenIntelligence';
        }
        // If command_execute already has an answer, skip LLM
        if (state.answer) {
          logger.debug('✅ [STATEGRAPH:COMMAND] Answer already generated, skipping LLM');
          return 'end'; // Don't generate answer, just return confirmation details
        }
        // If command_automate generated a plan OR Computer Use mode, route to overlay system
        if (state.intent?.type === 'command_automate' && 
            (state.intentContext?.slots?.automationPlan || state.intentContext?.slots?.mode === 'computer-use-streaming')) {
          logger.debug('🤖 [STATEGRAPH:COMMAND] Automation plan/Computer Use mode detected, routing to overlay system');
          return 'selectOverlayVariant';
        }
        // If command service already interpreted output, skip answer node
        if (state.answer) {
          logger.debug('✅ [STATEGRAPH:COMMAND] Answer already generated, skipping LLM');
          return 'end';
        }
        // Otherwise, generate answer with LLM
        return 'answer';
      },
      
      // Web search subgraph with parallel execution
      parallelWebAndMemory: 'parallelSanitizeAndFilter', // ⚡ PARALLEL: sanitizeWeb + filterMemory
      parallelSanitizeAndFilter: 'resolveReferences',
      
      // Screen intelligence subgraph with parallel memory retrieval
      parallelScreenAndMemory: 'parallelScreenFilterMemory', // ⚡ PARALLEL: screenIntelligence + retrieveMemory
      parallelScreenFilterMemory: (state) => {
        // Debug: Check if intentContext exists
        logger.debug('🔍 [STATEGRAPH:PARALLEL_SCREEN] Checking state after parallel execution:', {
          hasAnswer: !!state.answer,
          hasIntentContext: !!state.intentContext,
          intent: state.intentContext?.intent,
          slotsKeys: state.intentContext?.slots ? Object.keys(state.intentContext.slots) : []
        });
        
        // If screen intelligence already generated an answer (from vision API), skip answer node
        if (state.answer) {
          logger.debug('✅ [STATEGRAPH:PARALLEL_SCREEN] Answer already generated by vision API, skipping LLM');
          return 'selectOverlayVariant';
        }
        return 'answer';
      },
      
      // Command automation subgraph with parallel memory retrieval
      parallelCommandAndMemory: 'parallelCommandFilterMemory', // ⚡ PARALLEL: executeCommand + retrieveMemory
      parallelCommandFilterMemory: (state) => {
        // Debug: Log state for troubleshooting
        logger.debug('🔍 [STATEGRAPH:PARALLEL_COMMAND] Checking routing condition:', {
          intentType: state.intent?.type,
          hasIntentContext: !!state.intentContext,
          hasSlots: !!state.intentContext?.slots,
          slotsKeys: state.intentContext?.slots ? Object.keys(state.intentContext.slots) : [],
          mode: state.intentContext?.slots?.mode,
          hasAutomationPlan: !!state.intentContext?.slots?.automationPlan,
          hasAnswer: !!state.answer
        });
        
        // If command_automate generated a plan OR Computer Use mode, route to overlay system
        if (state.intent?.type === 'command_automate' && 
            (state.intentContext?.slots?.automationPlan || state.intentContext?.slots?.mode === 'computer-use-streaming')) {
          logger.debug('🤖 [STATEGRAPH:PARALLEL_COMMAND] Automation plan/Computer Use mode detected, routing to overlay system');
          return 'selectOverlayVariant';
        }
        // If command already has an answer, skip LLM
        if (state.answer) {
          logger.debug('✅ [STATEGRAPH:PARALLEL_COMMAND] Answer already generated, skipping LLM');
          return 'selectOverlayVariant';
        }
        return 'answer';
      },
      
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
          logger.debug(`🔍 [STATEGRAPH:WEB_SEARCH_NEEDED] LLM needs web search, routing to webSearch node`);
          // For streaming mode, we need to send a follow-up message
          if (isStreaming && state.streamCallback) {
            // Send a message that we're now searching
            state.streamCallback('\n\n🔍 Searching online for that information...\n\n');
          }
          return 'webSearch'; // Perform web search then retry answer
        }
        
        // 🌐 Log if web search was requested but skipped due to online mode
        if (state.shouldPerformWebSearch && useOnlineMode) {
          logger.debug(`⏭️  [STATEGRAPH:WEB_SEARCH_SKIPPED] Online mode active - skipping web search request`);
        }
        
        // PRIORITY 2: Retry logic for other validation failures
        // BUT: Don't retry if streaming (causes double responses in UI)
        if (state.needsRetry && (state.retryCount || 0) < 2 && !isStreaming) {
          logger.debug(`🔄 [STATEGRAPH:RETRY] Validation failed, retrying (attempt ${state.retryCount + 1})`);
          return 'answer'; // Retry answer generation
        }
        if (state.needsRetry && isStreaming) {
          logger.debug(`⏭️  [STATEGRAPH:RETRY] Skipping retry for streaming mode (would cause double response)`);
        }
        // Otherwise, proceed to overlay variant selection
        return 'selectOverlayVariant';
      },
      webSearch: 'sanitizeWeb', // After web search, sanitize and re-answer
      sanitizeWeb: 'answer', // Go back to answer with web results
      
      // Overlay system flow: selectVariant → overlayOutput → storeConversation → end
      selectOverlayVariant: 'overlayOutput',
      overlayOutput: 'storeConversation',
      storeConversation: 'end'
    };

    this.stateGraph = new StateGraph(nodes, edges);
    if (DEBUG) {
      logger.debug('✅ [ORCHESTRATOR] StateGraph built with 3 subgraphs (memory_store, web_search, retrieve/general)');
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
      logger.debug(`\n🔄 [ORCHESTRATOR:GRAPH] Processing with StateGraph: "${message}"`);
      logger.debug(`🌊 [ORCHESTRATOR:GRAPH] Streaming enabled: ${!!onStreamToken}`);
      logger.debug(`🌐 [ORCHESTRATOR:GRAPH] Online mode: ${useOnlineMode ? 'ENABLED (fallback to private)' : 'DISABLED'}`);
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
          conversationHistory, // Include for context-aware cache key
          ...context // Include all other context properties (e.g., bypassConfirmation)
        },
        streamCallback: onStreamToken, // Pass streaming callback to answer node
        useOnlineMode, // 🌐 Pass online mode flag to answer node
        
        // Overlay system: intent context for UI-driven workflows
        intentContext: {
          intent: null,      // Will be set by parseIntent node
          slots: {},         // Data filled by graph nodes
          uiVariant: null    // Will be set by selectOverlayVariant node
        },
        overlayPayload: null // Will be set by overlayOutput node
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
        requiresConfirmation: finalState.requiresConfirmation || false,
        confirmationDetails: finalState.confirmationDetails || null,
        geminiWarning: finalState.geminiWarning || null, // Include Gemini configuration warning
        // Guide fields for GuideOverlay
        guideMode: finalState.guideMode || false,
        guideId: finalState.guideId,
        guideSteps: finalState.guideSteps,
        guideTotalSteps: finalState.guideTotalSteps,
        guideCode: finalState.guideCode,
        guideRecoveries: finalState.guideRecoveries,
        guideMetadata: finalState.guideMetadata,
        elapsedMs: finalState.elapsedMs,
        trace: finalState.trace, // Full execution trace for debugging
        // Overlay system payload
        overlayPayload: finalState.overlayPayload || null,
        debug: {
          iterations: finalState.iterations,
          failedNode: finalState.failedNode,
          error: finalState.error
        }
      };

    } catch (error) {
      logger.error(`❌ [ORCHESTRATOR:GRAPH] Error:`, error.message);
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
      logger.debug('🏥 [ORCHESTRATOR] Checking memory service health...');
      
      const healthResult = await this.mcpClient.callService('user-memory', 'memory.health-check', {});
      
      if (healthResult.status === 'healthy') {
        logger.debug('✅ [ORCHESTRATOR] Memory service healthy');
        logger.debug(`📊 [ORCHESTRATOR] Embedding coverage: ${healthResult.database?.embeddingCoverage || 'unknown'}`);
        logger.debug(`📊 [ORCHESTRATOR] Total memories: ${healthResult.database?.totalMemories || 0}`);
        this.memoryServiceHealthy = true;
      } else {
        logger.warn('⚠️ [ORCHESTRATOR] Memory service degraded:', healthResult.message);
        this.memoryServiceHealthy = false;
      }

      // Check embedding coverage
      const embeddingCoverage = healthResult.database?.embeddingCoverage;
      if (embeddingCoverage && embeddingCoverage !== '100%') {
        logger.warn(`⚠️ [ORCHESTRATOR] Embedding coverage is ${embeddingCoverage}, should be 100%`);
      }

    } catch (error) {
      logger.error('❌ [ORCHESTRATOR] Memory service health check failed:', error.message);
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
    logger.debug('🧹 [ORCHESTRATOR] Trace history cleared');
  }

  /**
   * Process overlay event (user interaction from overlay UI)
   * Re-enters state graph with updated intent context, bypassing parseIntent
   * @param {object} overlayEvent - Event from overlay UI
   * @returns {Promise<object>} Orchestration result with overlay payload
   */
  async processOverlayEvent(overlayEvent) {
    const { intent, slots, conversationId, bypassParseIntent } = overlayEvent;
    
    if (DEBUG) {
      logger.debug(`📨 [ORCHESTRATOR:OVERLAY] Processing overlay event:`, {
        intent,
        uiActionId: overlayEvent.uiActionId,
        sourceComponent: overlayEvent.sourceComponent,
        bypassParseIntent
      });
    }

    try {
      // Build the graph (cached after first call)
      const graph = this._buildStateGraph();

      // Dynamically import intent registry
      const { getIntentDescriptor } = await import('../../../intents/registry.js');
      const descriptor = getIntentDescriptor(intent);
      
      if (!descriptor) {
        throw new Error(`No descriptor found for intent: ${intent}`);
      }

      if (!descriptor.allowBypassParseIntent && bypassParseIntent) {
        logger.warn(`⚠️  [ORCHESTRATOR:OVERLAY] Intent ${intent} does not allow bypass, but bypassParseIntent=true`);
      }

      // Create state with pre-populated intent context
      const initialState = {
        reqId: `req_overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        message: slots.subject || overlayEvent.uiActionId || 'overlay_event',
        context: {
          sessionId: conversationId,
          userId: 'overlay_user',
          timestamp: new Date().toISOString(),
        },
        
        // Pre-populate intent context (bypass parseIntent)
        intent: {
          type: intent,
          confidence: 1.0,
          entities: slots.entities || [],
          requiresMemory: false
        },
        intentContext: {
          intent,
          slots,
          uiVariant: null
        },
        overlayPayload: null,
        correlationId: overlayEvent.correlationId
      };

      // Execute from intent's entry node (bypass parseIntent)
      const entryNode = descriptor.entryNode;
      logger.debug(`🎯 [ORCHESTRATOR:OVERLAY] Entering graph at: ${entryNode}`);
      
      const finalState = await graph.execute(initialState, null, entryNode);

      // Format result
      return {
        success: finalState.success,
        overlayPayload: finalState.overlayPayload,
        response: finalState.answer || null,
        elapsedMs: finalState.elapsedMs,
        trace: finalState.trace,
        debug: {
          iterations: finalState.iterations,
          failedNode: finalState.failedNode,
          error: finalState.error
        }
      };

    } catch (error) {
      logger.error(`❌ [ORCHESTRATOR:OVERLAY] Error processing overlay event:`, error.message);
      return {
        success: false,
        error: error.message,
        overlayPayload: null
      };
    }
  }
}

module.exports = AgentOrchestrator;
