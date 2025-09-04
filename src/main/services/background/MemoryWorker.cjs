/**
 * Memory Worker - Background processing for conversation turns
 * Handles NER, embedding generation, and storage without blocking UI
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

class MemoryWorker {
  constructor(options = {}) {
    this.workerPath = options.workerPath || path.join(__dirname, 'MemoryWorkerThread.cjs');
    this.maxWorkers = options.maxWorkers || 1;
    this.workers = [];
    this.taskQueue = [];
    this.processing = false;
    
    this.config = {
      rank: { wCos: 0.6, wEnt: 0.2, wSess: 0.1, wRec: 0.1 },
      stageBudgets: { S1: 12, S2: 8, S3: 8, S4: 12 },
      minScore: 0.5,
      recencyHalfLifeDays: 60,
      piiMasking: true,
      ...options.config
    };
  }

  /**
   * Initialize worker threads
   */
  async initialize() {
    console.log('[MEMORY-WORKER] Initializing worker threads...');
    
    for (let i = 0; i < this.maxWorkers; i++) {
      await this.createWorker();
    }
    
    console.log(`[MEMORY-WORKER] Initialized ${this.workers.length} worker threads`);
  }

  /**
   * Create a new worker thread
   */
  async createWorker() {
    try {
      // Force fresh worker creation with timestamp to avoid caching
      const worker = new Worker(this.workerPath, {
        workerData: { 
          config: this.config,
          timestamp: Date.now() // Force fresh initialization
        }
      });

      worker.on('message', (result) => {
        this.handleWorkerMessage(worker, result);
      });

      worker.on('error', (error) => {
        console.error('[MEMORY-WORKER] Worker error:', error);
        this.restartWorker(worker);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[MEMORY-WORKER] Worker exited with code ${code}`);
          this.restartWorker(worker);
        }
      });

      worker.busy = false;
      worker.id = this.workers.length;
      
      this.workers.push(worker);
      
    } catch (error) {
      console.error('[MEMORY-WORKER] Failed to create worker:', error);
    }
  }

  /**
   * Process a batch of conversation turns
   */
  async processBatch(batch) {
    console.log(`[MEMORY-WORKER] Processing batch of ${batch.length} turns`);
    
    // Split batch across available workers
    const availableWorkers = this.workers.filter(w => !w.busy);
    
    if (availableWorkers.length === 0) {
      // Queue the batch for later processing
      this.taskQueue.push(...batch);
      return;
    }

    // Distribute tasks across workers
    const tasksPerWorker = Math.ceil(batch.length / availableWorkers.length);
    
    for (let i = 0; i < availableWorkers.length && i * tasksPerWorker < batch.length; i++) {
      const worker = availableWorkers[i];
      const startIdx = i * tasksPerWorker;
      const endIdx = Math.min(startIdx + tasksPerWorker, batch.length);
      const workerBatch = batch.slice(startIdx, endIdx);
      
      if (workerBatch.length > 0) {
        worker.busy = true;
        worker.postMessage({
          type: 'processBatch',
          batch: workerBatch
        });
      }
    }
  }

  /**
   * Handle message from worker thread
   */
  async handleWorkerMessage(worker, message) {
    const { type, success, error, results, workerId } = message;
    
    if (type === 'batchComplete') {
      worker.busy = false;
      
      if (success) {
        console.log(`[MEMORY-WORKER] Worker ${workerId} completed batch of ${results?.length || 0} items`);
        
        // Store processed memory data in main process
        if (results && results.length > 0) {
          await this.storeProcessedMemories(results);
        }
      } else {
        console.error(`[MEMORY-WORKER] Worker ${workerId} failed:`, error);
      }
      
      // Process queued tasks if any
      this.processQueuedTasks();
    }
  }

  /**
   * Store processed memories in main process database
   */
  async storeProcessedMemories(results) {
    try {
      // Access the coreAgent that's already initialized in main.cjs
      const coreAgent = global.coreAgent;
      
      if (!coreAgent) {
        console.error('[MEMORY-WORKER] CoreAgent not available in global scope');
        return;
      }
      
      for (const result of results) {
        if (result.success && result.processedMemories) {
          console.log(`[MEMORY-WORKER] Storing ${result.processedMemories.length} processed memories for turn ${result.turnId}`);
          
          // Store each processed memory using the initialized coreAgent
          for (const memory of result.processedMemories) {
            try {
              await coreAgent.executeAgent('UserMemoryAgent', {
                action: 'memory-store',
                key: memory.key,
                value: memory.value,
                sourceText: memory.sourceText,
                suggestedResponse: memory.suggestedResponse,
                metadata: memory.metadata
              });
            } catch (storeError) {
              console.error(`[MEMORY-WORKER] Failed to store memory ${memory.key}:`, storeError);
            }
          }
          
          console.log(`[MEMORY-WORKER] Successfully stored memories for turn ${result.turnId}`);
        }
      }
    } catch (error) {
      console.error('[MEMORY-WORKER] Failed to store processed memories:', error);
    }
  }

  /**
   * Process any queued tasks
   */
  processQueuedTasks() {
    if (this.taskQueue.length === 0) return;
    
    const availableWorkers = this.workers.filter(w => !w.busy);
    if (availableWorkers.length === 0) return;
    
    const batchSize = Math.min(10, this.taskQueue.length);
    const batch = this.taskQueue.splice(0, batchSize);
    
    this.processBatch(batch);
  }

  /**
   * Restart a failed worker
   */
  async restartWorker(failedWorker) {
    const index = this.workers.indexOf(failedWorker);
    if (index === -1) return;
    
    try {
      await failedWorker.terminate();
    } catch (error) {
      // Ignore termination errors
    }
    
    this.workers.splice(index, 1);
    await this.createWorker();
    
    console.log('[MEMORY-WORKER] Restarted failed worker');
  }

  /**
   * Shutdown all workers
   */
  async shutdown() {
    console.log('[MEMORY-WORKER] Shutting down workers...');
    
    const shutdownPromises = this.workers.map(async (worker) => {
      try {
        await worker.terminate();
      } catch (error) {
        console.warn('[MEMORY-WORKER] Error terminating worker:', error);
      }
    });
    
    await Promise.all(shutdownPromises);
    this.workers = [];
    
    console.log('[MEMORY-WORKER] All workers shut down');
  }

  /**
   * Get worker status
   */
  getStatus() {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queuedTasks: this.taskQueue.length,
      config: this.config
    };
  }
}

module.exports = MemoryWorker;
