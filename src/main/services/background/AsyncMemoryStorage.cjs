/**
 * Async Memory Storage System
 * Orchestrates queue and worker for latency-free memory processing
 */

const MemoryQueue = require('./MemoryQueue.cjs');
const MemoryWorker = require('./MemoryWorker.cjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class AsyncMemoryStorage {
  constructor(options = {}) {
    this.options = {
      queuePath: path.join(require('os').tmpdir(), 'thinkdrop-memory-queue.json'),
      maxWorkers: 1,
      batchSize: 10,
      batchTimeoutMs: 3000,
      ...options
    };
    
    this.queue = null;
    this.worker = null;
    this.initialized = false;
    this.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      startTime: Date.now()
    };
  }

  /**
   * Initialize the async memory storage system
   */
  async initialize() {
    if (this.initialized) return;
    
    console.log('[ASYNC-MEMORY] Initializing async memory storage system...');
    
    try {
      // Initialize queue
      this.queue = new MemoryQueue({
        queuePath: this.options.queuePath,
        batchSize: this.options.batchSize,
        batchTimeoutMs: this.options.batchTimeoutMs
      });
      
      // Initialize worker
      this.worker = new MemoryWorker({
        maxWorkers: this.options.maxWorkers
      });
      
      await this.worker.initialize();
      
      // Connect queue to worker
      this.queue.on('batch', (batch) => {
        this.worker.processBatch(batch);
        this.stats.totalProcessed += batch.length;
      });
      
      this.initialized = true;
      console.log('[ASYNC-MEMORY] Async memory storage system initialized');
      
    } catch (error) {
      console.error('[ASYNC-MEMORY] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Store a conversation turn asynchronously
   * @param {Object} context - Request context
   * @param {string} userMessage - User's message
   * @param {string} aiResponse - AI's response
   * @param {string} pipeline - Pipeline used for response
   */
  async storeTurnAsync(context, userMessage, aiResponse, pipeline = 'unknown') {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const turnId = uuidv4();
    const timestamp = Date.now();
    
    const turn = {
      turnId,
      sessionId: context.sessionId || 'default',
      userMessage,
      aiResponse,
      timestamp,
      pipeline,
      context: {
        userId: context.userId,
        conversationId: context.conversationId,
        messageId: context.messageId
      }
    };
    
    try {
      this.queue.enqueue(turn);
      this.stats.totalEnqueued++;
      
      console.log(`[ASYNC-MEMORY] Enqueued turn ${turnId} for async processing`);
      
      return {
        success: true,
        turnId,
        message: 'Turn queued for background processing'
      };
      
    } catch (error) {
      console.error('[ASYNC-MEMORY] Failed to enqueue turn:', error);
      this.stats.totalFailed++;
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get system status
   */
  getStatus() {
    const queueStatus = this.queue?.getStatus() || {};
    const workerStatus = this.worker?.getStatus() || {};
    
    return {
      initialized: this.initialized,
      queue: queueStatus,
      worker: workerStatus,
      stats: {
        ...this.stats,
        uptime: Date.now() - this.stats.startTime,
        successRate: this.stats.totalEnqueued > 0 
          ? ((this.stats.totalEnqueued - this.stats.totalFailed) / this.stats.totalEnqueued * 100).toFixed(2) + '%'
          : '100%'
      }
    };
  }

  /**
   * Shutdown the system gracefully
   */
  async shutdown() {
    console.log('[ASYNC-MEMORY] Shutting down async memory storage...');
    
    try {
      if (this.queue) {
        this.queue.stopProcessing();
      }
      
      if (this.worker) {
        await this.worker.shutdown();
      }
      
      this.initialized = false;
      console.log('[ASYNC-MEMORY] Shutdown complete');
      
    } catch (error) {
      console.error('[ASYNC-MEMORY] Error during shutdown:', error);
    }
  }

  /**
   * Clear all queued items (for testing/maintenance)
   */
  clearQueue() {
    if (this.queue) {
      this.queue.clear();
      console.log('[ASYNC-MEMORY] Queue cleared');
    }
  }

  /**
   * Force process all queued items immediately
   */
  async forceProcessQueue() {
    if (this.queue) {
      await this.queue.processBatch();
      console.log('[ASYNC-MEMORY] Forced queue processing');
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance of AsyncMemoryStorage
 */
function getInstance(options = {}) {
  if (!instance) {
    instance = new AsyncMemoryStorage(options);
  }
  return instance;
}

/**
 * Store a conversation turn (convenience function)
 */
async function storeTurn(context, userMessage, aiResponse, pipeline) {
  const storage = getInstance();
  return await storage.storeTurnAsync(context, userMessage, aiResponse, pipeline);
}

/**
 * Get system status (convenience function)
 */
function getSystemStatus() {
  const storage = getInstance();
  return storage.getStatus();
}

module.exports = {
  AsyncMemoryStorage,
  getInstance,
  storeTurn,
  getSystemStatus
};
