/**
 * StateGraph - Graph-based workflow orchestration
 * 
 * Manages stateful multi-step workflows with:
 * - Nodes: Individual processing steps
 * - Edges: Routing logic between nodes
 * - State: Shared context across the workflow
 * - Trace: Execution history for debugging
 */

// Conditional logging based on environment variable
const logger = require('./../../logger.cjs');
const DEBUG = process.env.DEBUG_STATEGRAPH === 'true';

class StateGraph {
  constructor(nodes = {}, edges = {}) {
    this.nodes = nodes;
    this.edges = edges;
    this.startNode = edges.start || 'start';
    
    // Caching layer for repeated queries
    this.cache = new Map();
    this.cacheStats = { hits: 0, misses: 0 };
    this.cacheTTL = 300000; // 5 minutes
  }

  /**
   * Execute the graph workflow
   * @param {Object} initialState - Starting state
   * @param {Function} onProgress - Optional callback for progress updates (nodeName, state, duration)
   * @returns {Object} Final state with trace
   */
  async execute(initialState, onProgress = null) {
    // CACHE DISABLED: Same query can have different contexts (e.g., different highlighted text)
    // Caching causes issues where the same message with different context returns stale results
    
    // const cacheKey = this._generateCacheKey(initialState);
    // const cached = this.cache.get(cacheKey);
    // if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
    //   this.cacheStats.hits++;
    //   logger.debug(`✅ [STATEGRAPH:CACHE] Cache hit! (${this.cacheStats.hits} hits, ${this.cacheStats.misses} misses)`);
    //   if (onProgress && typeof onProgress === 'function') {
    //     try {
    //       await onProgress('cached', cached.result, 0, 'cached');
    //     } catch (err) {
    //       logger.warn('⚠️ [STATEGRAPH] Progress callback error:', err.message);
    //     }
    //   }
    //   return { ...cached.result, fromCache: true, cacheAge: Date.now() - cached.timestamp };
    // }
    
    this.cacheStats.misses++;
    if (DEBUG) {
      logger.debug(`⚠️ [STATEGRAPH:CACHE] Cache disabled - executing workflow (${this.cacheStats.hits} hits, ${this.cacheStats.misses} misses)`);
    }
    
    const state = {
      ...initialState,
      trace: [],
      startTime: Date.now(),
      currentNode: this.startNode
    };

    let currentNode = this.startNode;
    const visited = new Set();
    const maxIterations = 50; // Prevent infinite loops
    let iterations = 0;

    while (currentNode && currentNode !== 'end' && iterations < maxIterations) {
      iterations++;

      // Check for infinite loops
      const visitKey = `${currentNode}_${iterations}`;
      if (visited.has(visitKey) && iterations > 10) {
        logger.warn(`⚠️ [STATEGRAPH] Possible infinite loop detected at node: ${currentNode}`);
        state.error = `Infinite loop detected at node: ${currentNode}`;
        break;
      }
      visited.add(visitKey);

      // Execute node
      const nodeStartTime = Date.now();
      if (DEBUG) {
        logger.debug(`🔄 [STATEGRAPH] Executing node: ${currentNode}`);
      }

      // Call progress callback before node execution
      if (onProgress && typeof onProgress === 'function') {
        try {
          await onProgress(currentNode, state, 0, 'started');
        } catch (err) {
          logger.warn('⚠️ [STATEGRAPH] Progress callback error:', err.message);
        }
      }

      try {
        const nodeFunction = this.nodes[currentNode];
        if (!nodeFunction) {
          throw new Error(`Node not found: ${currentNode}`);
        }

        // Capture input state for trace
        const inputSnapshot = this._captureStateSnapshot(state);

        // Execute node
        const updatedState = await nodeFunction(state);

        // Capture output state for trace
        const outputSnapshot = this._captureStateSnapshot(updatedState);

        // Record trace
        const duration = Date.now() - nodeStartTime;
        updatedState.trace.push({
          node: currentNode,
          duration,
          timestamp: new Date().toISOString(),
          input: inputSnapshot,
          output: outputSnapshot,
          success: true
        });

        if (DEBUG) {
          logger.debug(`✅ [STATEGRAPH] Node ${currentNode} completed in ${duration}ms`);
        }

        // Update state
        Object.assign(state, updatedState);

        // Call progress callback after node completion
        if (onProgress && typeof onProgress === 'function') {
          try {
            await onProgress(currentNode, state, duration, 'completed');
          } catch (err) {
            logger.warn('⚠️ [STATEGRAPH] Progress callback error:', err.message);
          }
        }

        // Early intent response: Send contextual message immediately after parseIntent
        if (currentNode === 'parseIntent' && state.intent?.type && onProgress) {
          try {
            // Load shared IntentResponses utility (decoupled from any specific MCP service)
            const IntentResponses = require('../utils/IntentResponses.cjs');
            
            // Get intent-specific early message
            const earlyMessage = IntentResponses.getSuggestedResponse(
              state.intent.type, 
              state.message
            );
            
            // Send early response to UI immediately (before slow operations start)
            await onProgress('earlyResponse', { 
              ...state,
              earlyMessage,
              intentType: state.intent.type 
            }, 0, 'early');
            
            if (DEBUG) {
              logger.debug(`💬 [STATEGRAPH] Early response sent: "${earlyMessage}"`);
            }
          } catch (err) {
            logger.warn('⚠️ [STATEGRAPH] Early response error:', err.message);
          }
        }

        // Determine next node
        const nextNode = this._getNextNode(currentNode, state);
        if (DEBUG) {
          logger.debug(`➡️  [STATEGRAPH] Routing: ${currentNode} → ${nextNode}`);
        }

        currentNode = nextNode;

      } catch (error) {
        logger.error(`❌ [STATEGRAPH] Node ${currentNode} failed:`, error.message);

        // Record error in trace
        state.trace.push({
          node: currentNode,
          duration: Date.now() - nodeStartTime,
          timestamp: new Date().toISOString(),
          error: error.message,
          success: false
        });

        state.error = error.message;
        state.failedNode = currentNode;
        break;
      }
    }

    // Finalize state
    state.elapsedMs = Date.now() - state.startTime;
    state.iterations = iterations;
    state.success = !state.error;

    if (DEBUG) {
      logger.debug(`🏁 [STATEGRAPH] Workflow completed in ${state.elapsedMs}ms (${iterations} iterations)`);
    }

    // CACHE DISABLED: Don't store results
    // if (state.success && state.answer) {
    //   this.cache.set(cacheKey, {
    //     result: state,
    //     timestamp: Date.now()
    //   });
    //   this._cleanupCache();
    //   if (DEBUG) {
    //     logger.debug(`💾 [STATEGRAPH:CACHE] Result cached (${this.cache.size} entries)`);
    //   }
    // }

    return state;
  }

  /**
   * Get the next node based on edges configuration
   * @param {string} currentNode - Current node name
   * @param {Object} state - Current state
   * @returns {string} Next node name
   */
  _getNextNode(currentNode, state) {
    const edge = this.edges[currentNode];

    // No edge defined = end
    if (!edge) {
      return 'end';
    }

    // Static edge (string)
    if (typeof edge === 'string') {
      return edge;
    }

    // Dynamic edge (function)
    if (typeof edge === 'function') {
      return edge(state);
    }

    // Invalid edge
    logger.warn(`⚠️ [STATEGRAPH] Invalid edge for node ${currentNode}`);
    return 'end';
  }

  /**
   * Execute multiple nodes in parallel
   * @param {Array<string>} nodeNames - Node names to execute
   * @param {Object} state - Current state
   * @param {Function} onProgress - Optional progress callback
   * @returns {Object} Merged state from all nodes
   */
  async executeParallel(nodeNames, state, onProgress = null) {
    logger.debug(`⚡ [STATEGRAPH:PARALLEL] Executing ${nodeNames.length} nodes in parallel: ${nodeNames.join(', ')}`);
    
    const promises = nodeNames.map(async (nodeName) => {
      const nodeFunction = this.nodes[nodeName];
      
      if (!nodeFunction) {
        throw new Error(`Node not found: ${nodeName}`);
      }
      
      const nodeStartTime = Date.now();
      
      // Call progress callback before node execution
      if (onProgress && typeof onProgress === 'function') {
        try {
          await onProgress(nodeName, state, 0, 'started');
        } catch (err) {
          logger.warn('⚠️ [STATEGRAPH] Progress callback error:', err.message);
        }
      }
      
      try {
        const inputSnapshot = this._captureStateSnapshot(state);
        const result = await nodeFunction(state);
        const duration = Date.now() - nodeStartTime;
        const outputSnapshot = this._captureStateSnapshot(result);
        
        logger.debug(`✅ [STATEGRAPH:PARALLEL] Node ${nodeName} completed in ${duration}ms`);
        
        // Call progress callback after completion
        if (onProgress && typeof onProgress === 'function') {
          try {
            await onProgress(nodeName, result, duration, 'completed');
          } catch (err) {
            logger.warn('⚠️ [STATEGRAPH] Progress callback error:', err.message);
          }
        }
        
        return { 
          success: true, 
          nodeName, 
          result, 
          duration,
          trace: {
            node: nodeName,
            duration,
            timestamp: new Date().toISOString(),
            input: inputSnapshot,
            output: outputSnapshot,
            success: true
          }
        };
        
      } catch (error) {
        const duration = Date.now() - nodeStartTime;
        logger.error(`❌ [STATEGRAPH:PARALLEL] Node ${nodeName} failed:`, error.message);
        
        return { 
          success: false, 
          nodeName, 
          error: error.message,
          duration,
          trace: {
            node: nodeName,
            duration,
            timestamp: new Date().toISOString(),
            error: error.message,
            success: false
          }
        };
      }
    });
    
    const results = await Promise.all(promises);
    
    // Merge all results into state
    const mergedState = { ...state };
    const parallelTraces = [];
    
    for (const { success, nodeName, result, error, trace } of results) {
      parallelTraces.push(trace);
      
      if (success) {
        // Merge successful result into state
        Object.assign(mergedState, result);
      } else {
        logger.warn(`⚠️ [STATEGRAPH:PARALLEL] Skipping failed parallel node: ${nodeName}`);
        mergedState.parallelErrors = mergedState.parallelErrors || [];
        mergedState.parallelErrors.push({ nodeName, error });
      }
    }
    
    // Add all parallel traces to state
    mergedState.trace = mergedState.trace || [];
    mergedState.trace.push(...parallelTraces);
    
    const totalDuration = Math.max(...results.map(r => r.duration));
    logger.debug(`⚡ [STATEGRAPH:PARALLEL] All nodes completed in ${totalDuration}ms (parallel)`);
    
    return mergedState;
  }

  /**
   * Capture a snapshot of relevant state for tracing
   * Only captures essential metrics, not full objects (optimized for performance)
   * @param {Object} state - Current state
   * @returns {Object} State snapshot
   */
  _captureStateSnapshot(state) {
    return {
      intentType: state.intent?.type,
      intentConfidence: state.intent?.confidence,
      memoriesCount: state.memories?.length || 0,
      filteredMemoriesCount: state.filteredMemories?.length || 0,
      contextDocsCount: state.contextDocs?.length || 0,
      hasAnswer: !!state.answer,
      answerLength: state.answer?.length || 0,
      needsRetry: state.needsRetry,
      retryCount: state.retryCount || 0,
      error: state.error
    };
  }

  /**
   * Generate cache key from message, session, and conversation context
   * @param {Object} state - Initial state
   * @returns {string} Cache key
   */
  _generateCacheKey(state) {
    const message = (state.message || '').toLowerCase().trim();
    const sessionId = state.context?.sessionId || 'default';
    
    // Include conversation context to prevent stale responses
    // Use last 5 messages to detect context changes
    const conversationHistory = state.context?.conversationHistory || [];
    const recentMessages = conversationHistory
      .slice(-5)
      .map(msg => `${msg.role}:${(msg.content || '').substring(0, 50)}`)
      .join('|');
    
    // Simple hash of recent context
    const contextHash = this._simpleHash(recentMessages);
    
    const cacheKey = `${sessionId}:${message}:${contextHash}`;
    
    // Always log cache key for debugging context-awareness
    logger.debug(`🔑 [STATEGRAPH:CACHE] Cache key generated:`);
    logger.debug(`   Message: "${message}"`);
    logger.debug(`   Context hash: ${contextHash} (from ${conversationHistory.length} messages)`);
    logger.debug(`   Recent context: ${recentMessages.substring(0, 100)}...`);
    logger.debug(`   Full key: ${cacheKey}`);
    
    return cacheKey;
  }

  /**
   * Simple hash function for context fingerprinting
   * @param {string} str - String to hash
   * @returns {string} Hash
   */
  _simpleHash(str) {
    if (!str) return '0';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Cleanup expired cache entries
   */
  _cleanupCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0 && DEBUG) {
      logger.debug(`🧹 [STATEGRAPH:CACHE] Cleaned ${cleaned} expired entries`);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      size: this.cache.size,
      hitRate: total > 0 ? (this.cacheStats.hits / total * 100).toFixed(2) + '%' : '0%'
    };
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache() {
    this.cache.clear();
    this.cacheStats = { hits: 0, misses: 0 };
    logger.debug('🧹 [STATEGRAPH:CACHE] Cache cleared');
  }

  /**
   * Add a node to the graph
   * @param {string} name - Node name
   * @param {Function} fn - Node function
   */
  addNode(name, fn) {
    this.nodes[name] = fn;
  }

  /**
   * Add an edge to the graph
   * @param {string} from - Source node
   * @param {string|Function} to - Target node or routing function
   */
  addEdge(from, to) {
    this.edges[from] = to;
  }
}

module.exports = StateGraph;
