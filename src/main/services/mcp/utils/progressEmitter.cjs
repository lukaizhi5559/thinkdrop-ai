/**
 * Progress Emitter Utility
 * 
 * Helper for StateGraph nodes to emit step-level progress updates
 * Converts node-level execution into human-readable step descriptions
 */

const logger = require('./../../../logger.cjs');

class ProgressEmitter {
  /**
   * Emit a step-level progress update
   * @param {Function} onProgress - Progress callback from StateGraph
   * @param {string} nodeName - Current node name
   * @param {string} stepDescription - Human-readable step description
   * @param {Object} state - Current state
   * @param {Object} metadata - Additional metadata
   */
  static async emitStep(onProgress, nodeName, stepDescription, state, metadata = {}) {
    if (!onProgress || typeof onProgress !== 'function') {
      return;
    }

    try {
      await onProgress(nodeName, {
        ...state,
        stepDescription,
        stepMetadata: metadata
      }, 0, 'step');
    } catch (err) {
      logger.warn('⚠️ [PROGRESS_EMITTER] Failed to emit step:', err.message);
    }
  }

  /**
   * Generate step description based on node and state
   * @param {string} nodeName - Node name
   * @param {Object} state - Current state
   * @returns {string} Human-readable description
   */
  static generateStepDescription(nodeName, state) {
    const intent = state.intent?.type;
    const message = state.message;

    switch (nodeName) {
      case 'parseIntent':
        return 'Understanding your request...';
      
      case 'retrieveMemory':
        return 'Searching through your memories...';
      
      case 'filterMemory':
        return 'Finding relevant information...';
      
      case 'resolveReferences':
        return 'Resolving references in your message...';
      
      case 'webSearch':
        return 'Searching the web for current information...';
      
      case 'sanitizeWeb':
        return 'Processing search results...';
      
      case 'answer':
        if (intent === 'command_automate') {
          return 'Creating automation plan...';
        } else if (intent === 'screen_intelligence') {
          return 'Analyzing your screen...';
        } else if (intent === 'web_search') {
          return 'Formulating answer from search results...';
        }
        return 'Generating response...';
      
      case 'validateAnswer':
        return 'Validating response quality...';
      
      case 'storeConversation':
        return 'Saving conversation...';
      
      case 'storeMemory':
        return 'Storing information in memory...';
      
      case 'executeCommand':
        if (intent === 'command_automate') {
          return 'Preparing automation...';
        }
        return 'Executing command...';
      
      case 'screenIntelligence':
        return 'Analyzing screen content...';
      
      case 'vision':
        return 'Processing visual information...';
      
      case 'selectOverlayVariant':
        return 'Preparing response display...';
      
      case 'overlayOutput':
        return 'Finalizing response...';
      
      // Parallel nodes
      case 'parallelWebAndMemory':
        return 'Searching web and memories simultaneously...';
      
      case 'parallelSanitizeAndFilter':
        return 'Processing results...';
      
      case 'parallelScreenAndMemory':
        return 'Analyzing screen and retrieving context...';
      
      case 'parallelCommandAndMemory':
        return 'Preparing automation with personalized context...';
      
      default:
        return `Processing: ${nodeName}...`;
    }
  }

  /**
   * Emit progress for a specific action within a node
   * @param {Function} onProgress - Progress callback
   * @param {string} nodeName - Node name
   * @param {string} action - Action description (e.g., "Calling web search API")
   * @param {Object} state - Current state
   */
  static async emitAction(onProgress, nodeName, action, state) {
    if (!onProgress || typeof onProgress !== 'function') {
      return;
    }

    try {
      await onProgress(nodeName, {
        ...state,
        actionDescription: action
      }, 0, 'action');
    } catch (err) {
      logger.warn('⚠️ [PROGRESS_EMITTER] Failed to emit action:', err.message);
    }
  }
}

module.exports = ProgressEmitter;
