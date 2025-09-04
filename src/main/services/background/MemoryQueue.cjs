/**
 * Memory Queue System
 * Handles async enqueueing of conversation turns for background processing
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class MemoryQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.queuePath = options.queuePath || path.join(require('os').tmpdir(), 'thinkdrop-memory-queue.json');
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.batchSize = options.batchSize || 10;
    this.batchTimeoutMs = options.batchTimeoutMs || 3000;
    
    this.queue = [];
    this.processing = false;
    this.batchTimer = null;
    
    // Load existing queue from disk
    this.loadQueue();
    
    // Start processing
    this.startProcessing();
  }

  /**
   * Enqueue a conversation turn for memory storage
   * @param {Object} turn - Turn data
   * @param {string} turn.turnId - Unique turn identifier
   * @param {string} turn.sessionId - Session identifier
   * @param {string} turn.userMessage - User's message
   * @param {string} turn.aiResponse - AI's response
   * @param {number} turn.timestamp - Turn timestamp
   * @param {string} turn.pipeline - Pipeline used for response
   */
  enqueue(turn) {
    if (this.queue.length >= this.maxQueueSize) {
      console.warn('[MEMORY-QUEUE] Queue full, dropping oldest item');
      this.queue.shift();
    }

    const queueItem = {
      ...turn,
      enqueuedAt: Date.now(),
      retries: 0,
      maxRetries: 3
    };

    this.queue.push(queueItem);
    this.saveQueue();
    
    console.log(`[MEMORY-QUEUE] Enqueued turn ${turn.turnId} (queue size: ${this.queue.length})`);
    
    // Trigger batch processing if we hit batch size
    if (this.queue.length >= this.batchSize) {
      this.processBatch();
    } else {
      // Set timer for batch processing
      this.resetBatchTimer();
    }
  }

  /**
   * Start the processing loop
   */
  startProcessing() {
    if (this.processing) return;
    
    this.processing = true;
    console.log('[MEMORY-QUEUE] Started processing');
    
    // Process any existing items
    if (this.queue.length > 0) {
      this.processBatch();
    }
  }

  /**
   * Stop processing
   */
  stopProcessing() {
    this.processing = false;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    console.log('[MEMORY-QUEUE] Stopped processing');
  }

  /**
   * Process a batch of items
   */
  async processBatch() {
    if (!this.processing || this.queue.length === 0) return;

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Get batch items
    const batchSize = Math.min(this.batchSize, this.queue.length);
    const batch = this.queue.splice(0, batchSize);
    
    console.log(`[MEMORY-QUEUE] Processing batch of ${batch.length} items`);

    try {
      // Emit batch for processing by worker
      this.emit('batch', batch);
      
      // Save updated queue
      this.saveQueue();
      
    } catch (error) {
      console.error('[MEMORY-QUEUE] Batch processing error:', error);
      
      // Re-queue failed items with retry logic
      const retriableItems = batch.filter(item => {
        item.retries++;
        return item.retries <= item.maxRetries;
      });
      
      if (retriableItems.length > 0) {
        console.log(`[MEMORY-QUEUE] Re-queuing ${retriableItems.length} failed items`);
        this.queue.unshift(...retriableItems);
        this.saveQueue();
      }
    }

    // Schedule next batch if items remain
    if (this.queue.length > 0) {
      this.resetBatchTimer();
    }
  }

  /**
   * Reset the batch timer
   */
  resetBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.batchTimeoutMs);
  }

  /**
   * Load queue from disk
   */
  loadQueue() {
    try {
      if (fs.existsSync(this.queuePath)) {
        const data = fs.readFileSync(this.queuePath, 'utf8');
        this.queue = JSON.parse(data) || [];
        console.log(`[MEMORY-QUEUE] Loaded ${this.queue.length} items from disk`);
      }
    } catch (error) {
      console.warn('[MEMORY-QUEUE] Failed to load queue from disk:', error.message);
      this.queue = [];
    }
  }

  /**
   * Save queue to disk
   */
  saveQueue() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.queuePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.queuePath, JSON.stringify(this.queue, null, 2));
    } catch (error) {
      console.warn('[MEMORY-QUEUE] Failed to save queue to disk:', error.message);
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      batchSize: this.batchSize,
      batchTimeoutMs: this.batchTimeoutMs
    };
  }

  /**
   * Clear the queue
   */
  clear() {
    this.queue = [];
    this.saveQueue();
    console.log('[MEMORY-QUEUE] Queue cleared');
  }
}

module.exports = MemoryQueue;
