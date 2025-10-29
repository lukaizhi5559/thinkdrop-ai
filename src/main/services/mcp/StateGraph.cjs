/**
 * StateGraph - Graph-based workflow orchestration
 * 
 * Manages stateful multi-step workflows with:
 * - Nodes: Individual processing steps
 * - Edges: Routing logic between nodes
 * - State: Shared context across the workflow
 * - Trace: Execution history for debugging
 */

class StateGraph {
  constructor(nodes = {}, edges = {}) {
    this.nodes = nodes;
    this.edges = edges;
    this.startNode = edges.start || 'start';
  }

  /**
   * Execute the graph workflow
   * @param {Object} initialState - Starting state
   * @returns {Object} Final state with trace
   */
  async execute(initialState) {
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
        console.warn(`⚠️ [STATEGRAPH] Possible infinite loop detected at node: ${currentNode}`);
        state.error = `Infinite loop detected at node: ${currentNode}`;
        break;
      }
      visited.add(visitKey);

      // Execute node
      const nodeStartTime = Date.now();
      console.log(`🔄 [STATEGRAPH] Executing node: ${currentNode}`);

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

        console.log(`✅ [STATEGRAPH] Node ${currentNode} completed in ${duration}ms`);

        // Update state
        Object.assign(state, updatedState);

        // Determine next node
        const nextNode = this._getNextNode(currentNode, state);
        console.log(`➡️  [STATEGRAPH] Routing: ${currentNode} → ${nextNode}`);

        currentNode = nextNode;

      } catch (error) {
        console.error(`❌ [STATEGRAPH] Node ${currentNode} failed:`, error.message);

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

    console.log(`🏁 [STATEGRAPH] Workflow completed in ${state.elapsedMs}ms (${iterations} iterations)`);

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
    console.warn(`⚠️ [STATEGRAPH] Invalid edge for node ${currentNode}`);
    return 'end';
  }

  /**
   * Capture a snapshot of relevant state for tracing
   * @param {Object} state - Current state
   * @returns {Object} State snapshot
   */
  _captureStateSnapshot(state) {
    return {
      intent: state.intent,
      memoriesCount: state.memories?.length || 0,
      filteredMemoriesCount: state.filteredMemories?.length || 0,
      contextDocsCount: state.contextDocs?.length || 0,
      hasAnswer: !!state.answer,
      needsRetry: state.needsRetry,
      error: state.error
    };
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
