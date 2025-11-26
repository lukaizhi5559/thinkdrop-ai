/**
 * Window Tracker Worker Thread
 * 
 * Runs WindowTracker in a separate thread to:
 * 1. Detect window/tab changes in the background
 * 2. Track active window context (app, title, URL)
 * 3. Notify main thread of window changes
 * 4. Provide UI feedback via toasts
 * 
 * Benefits:
 * - No UI blocking
 * - Continuous window monitoring
 * - Browser URL/tab tracking via AppleScript
 */

// Mark this as a worker thread
process.env.WORKER_THREAD = 'true';

const { parentPort } = require('worker_threads');
const WindowTracker = require('../services/windowTracker.cjs');

const logger = require('./../logger.cjs');
let tracker = null;
let isInitialized = false;

/**
 * Initialize window tracker
 */
async function initialize() {
  if (isInitialized) return;
  
  try {
    logger.debug('[WORKER] Initializing WindowTracker...');
    
    tracker = new WindowTracker();
    await tracker.start();
    isInitialized = true;
    
    parentPort.postMessage({
      type: 'ready',
      timestamp: Date.now()
    });
    
    logger.debug('[WORKER] WindowTracker initialized successfully');
  } catch (error) {
    logger.error('[WORKER] Failed to initialize WindowTracker:', error);
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  }
}

/**
 * Handle messages from main thread
 */
parentPort.on('message', async (msg) => {
  try {
    switch (msg.type) {
      case 'init':
        await initialize();
        break;
        
      case 'stop':
        if (tracker) {
          tracker.stop();
          logger.debug('[WORKER] WindowTracker stopped');
        }
        break;
        
      default:
        logger.warn('[WORKER] Unknown message type:', msg.type);
    }
  } catch (error) {
    logger.error('[WORKER] Error handling message:', error);
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  }
});

// Handle worker errors
process.on('uncaughtException', (error) => {
  logger.error('[WORKER] Uncaught exception:', error);
  parentPort.postMessage({
    type: 'error',
    error: error.message
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[WORKER] Unhandled rejection at:', promise, 'reason:', reason);
  parentPort.postMessage({
    type: 'error',
    error: String(reason)
  });
});

// Start initialization
logger.debug('[WORKER] Window Tracker Worker started');
