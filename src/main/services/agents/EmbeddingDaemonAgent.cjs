/**
 * EmbeddingDaemonAgent - Background daemon for generating embeddings for memories
 * Runs periodically to ensure all memories have semantic embeddings
 */

const AGENT_FORMAT = {
  name: 'EmbeddingDaemonAgent',
  description: 'Background daemon for generating embeddings for memories without them',
  
  // Agent state
  intervalId: null,
  isRunning: false,
  intervalMinutes: 10, // Default: 10 minutes
  lastRunTime: null,
  stats: {
    totalRuns: 0,
    memoriesProcessed: 0,
    embeddingsGenerated: 0,
    errors: 0
  },
  
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Daemon operation to perform',
        enum: [
          'start-daemon',
          'stop-daemon', 
          'run-once',
          'get-status',
          'set-interval',
          'get-stats'
        ]
      },
      intervalMinutes: {
        type: 'number',
        description: 'Interval in minutes for daemon runs (for set-interval action)',
        minimum: 1,
        maximum: 1440 // Max 24 hours
      }
    },
    required: ['action']
  },
  dependencies: [],
  execution_target: 'backend',
  requires_database: false,
  database_type: undefined,

  // Bootstrap method
  async bootstrap(config, context) {
    console.log('[INFO] EmbeddingDaemonAgent bootstrap completed');
    return { success: true, message: 'EmbeddingDaemonAgent initialized' };
  },

  // Execute method
  async execute(params, context) {
    try {
      const { action, intervalMinutes } = params;
      
      switch (action) {
        case 'start-daemon':
          return await this.startDaemon(context);
          
        case 'stop-daemon':
          return await this.stopDaemon();
          
        case 'run-once':
          return await this.runEmbeddingProcess(context);
          
        case 'get-status':
          return this.getStatus();
          
        case 'set-interval':
          return this.setInterval(intervalMinutes);
          
        case 'get-stats':
          return this.getStats();
          
        default:
          throw new Error('Unknown action: ' + action);
      }
    } catch (error) {
      console.error('[ERROR] EmbeddingDaemonAgent execution failed:', error);
      throw error;
    }
  },

  async startDaemon(context) {
    try {
      if (this.isRunning) {
        return {
          success: true,
          message: 'Daemon is already running',
          status: 'already_running',
          intervalMinutes: this.intervalMinutes
        };
      }

      console.log(`[INFO] Starting embedding daemon with ${this.intervalMinutes}-minute intervals`);
      
      // Run immediately on start
      await this.runEmbeddingProcess(context);
      
      // Set up periodic execution
      const intervalMs = this.intervalMinutes * 60 * 1000;
      this.intervalId = setInterval(async () => {
        try {
          await this.runEmbeddingProcess(context);
        } catch (error) {
          console.error('[ERROR] Embedding daemon periodic run failed:', error);
          this.stats.errors++;
        }
      }, intervalMs);
      
      this.isRunning = true;
      
      console.log(`[SUCCESS] Embedding daemon started with ${this.intervalMinutes}-minute intervals`);
      
      return {
        success: true,
        message: `Daemon started with ${this.intervalMinutes}-minute intervals`,
        status: 'started',
        intervalMinutes: this.intervalMinutes,
        nextRunTime: new Date(Date.now() + intervalMs).toISOString()
      };
      
    } catch (error) {
      console.error('[ERROR] Failed to start embedding daemon:', error);
      throw new Error('Failed to start daemon: ' + error.message);
    }
  },

  async stopDaemon() {
    try {
      if (!this.isRunning) {
        return {
          success: true,
          message: 'Daemon is not running',
          status: 'not_running'
        };
      }

      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      
      this.isRunning = false;
      
      console.log('[INFO] Embedding daemon stopped');
      
      return {
        success: true,
        message: 'Daemon stopped successfully',
        status: 'stopped'
      };
      
    } catch (error) {
      console.error('[ERROR] Failed to stop embedding daemon:', error);
      throw new Error('Failed to stop daemon: ' + error.message);
    }
  },

  async runEmbeddingProcess(context) {
    try {
      const startTime = Date.now();
      this.lastRunTime = new Date().toISOString();
      this.stats.totalRuns++;
      
      console.log('[INFO] Starting embedding generation process...');
      
      // Get core agent for database operations
      if (!context.coreAgent) {
        throw new Error('Core agent not available in context');
      }
      
      const coreAgent = context.coreAgent;
      
      // Get memories without embeddings
      const memoriesResult = await coreAgent.ask({
        agent: 'UserMemoryAgent',
        action: 'memory-search',
        query: '',
        limit: 100,
        filters: {
          missing_embedding: true
        }
      });
      
      if (!memoriesResult.success) {
        throw new Error('Failed to fetch memories: ' + memoriesResult.error);
      }
      
      const memories = memoriesResult.memories || [];
      
      if (memories.length === 0) {
        console.log('[INFO] No memories found without embeddings');
        return {
          success: true,
          message: 'No memories need embeddings',
          processed: 0,
          generated: 0,
          errors: 0,
          duration: Date.now() - startTime,
          timestamp: this.lastRunTime
        };
      }
      
      console.log(`[INFO] Found ${memories.length} memories without embeddings`);
      
      let processed = 0;
      let generated = 0;
      let errors = 0;
      
      // Process memories in batches
      const batchSize = 10;
      for (let i = 0; i < memories.length; i += batchSize) {
        const batch = memories.slice(i, i + batchSize);
        
        try {
          // Extract text content from batch
          const texts = batch.map(memory => {
            if (memory.content) {
              return memory.content;
            } else if (memory.summary) {
              return memory.summary;
            } else {
              return memory.title || 'No content';
            }
          });
          
          // Generate embeddings for batch
          const embeddingResult = await coreAgent.ask({
            agent: 'SemanticSearchAgent',
            action: 'generate-embeddings',
            texts: texts
          });
          
          if (embeddingResult.success && embeddingResult.embeddings) {
            // Update each memory with its embedding
            for (let j = 0; j < batch.length; j++) {
              const memory = batch[j];
              const embedding = embeddingResult.embeddings[j];
              
              try {
                if (embedding && Array.isArray(embedding) && embedding.length > 0) {
                  // Update memory with embedding
                  const updateResult = await coreAgent.ask({
                    agent: 'UserMemoryAgent',
                    action: 'memory-update',
                    id: memory.id,
                    embedding: embedding
                  });
                  
                  if (updateResult.success) {
                    generated++;
                  } else {
                    console.error(`[ERROR] Failed to update memory ${memory.id} with embedding`);
                    errors++;
                  }
                } else {
                  console.error(`[ERROR] Invalid embedding for memory ${memory.id}`);
                  errors++;
                }
                
                processed++;
              } catch (updateError) {
                console.error(`[ERROR] Failed to update memory ${memory.id}:`, updateError);
                errors++;
                processed++;
              }
            }
          } else {
            console.error('[ERROR] Batch embedding generation failed:', embeddingResult.error);
            errors += batch.length;
            processed += batch.length;
          }
          
        } catch (batchError) {
          console.error('[ERROR] Batch processing failed:', batchError);
          errors += batch.length;
          processed += batch.length;
        }
        
        // Small delay between batches to avoid overwhelming the system
        if (i + batchSize < memories.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Update stats
      this.stats.memoriesProcessed += processed;
      this.stats.embeddingsGenerated += generated;
      this.stats.errors += errors;
      
      const duration = Date.now() - startTime;
      
      console.log(`[SUCCESS] Embedding process completed: ${generated}/${processed} embeddings generated in ${duration}ms`);
      
      return {
        success: true,
        message: `Processed ${processed} memories, generated ${generated} embeddings`,
        processed: processed,
        generated: generated,
        errors: errors,
        duration: duration,
        timestamp: this.lastRunTime
      };
      
    } catch (error) {
      console.error('[ERROR] Embedding process failed:', error);
      this.stats.errors++;
      throw new Error('Embedding process failed: ' + error.message);
    }
  },

  getStatus() {
    return {
      success: true,
      status: {
        isRunning: this.isRunning,
        intervalMinutes: this.intervalMinutes,
        lastRunTime: this.lastRunTime,
        nextRunTime: this.isRunning && this.intervalId ? 
          new Date(Date.now() + (this.intervalMinutes * 60 * 1000)).toISOString() : null,
        stats: this.stats
      }
    };
  },

  setInterval(intervalMinutes) {
    try {
      if (intervalMinutes < 1 || intervalMinutes > 1440) {
        throw new Error('Interval must be between 1 and 1440 minutes');
      }
      
      const wasRunning = this.isRunning;
      
      // Stop daemon if running
      if (wasRunning) {
        this.stopDaemon();
      }
      
      // Update interval
      this.intervalMinutes = intervalMinutes;
      
      console.log(`[INFO] Embedding daemon interval set to ${intervalMinutes} minutes`);
      
      return {
        success: true,
        message: `Interval set to ${intervalMinutes} minutes`,
        intervalMinutes: intervalMinutes,
        wasRunning: wasRunning,
        note: wasRunning ? 'Daemon was stopped and needs to be restarted' : 'Daemon was not running'
      };
      
    } catch (error) {
      console.error('[ERROR] Failed to set interval:', error);
      throw new Error('Failed to set interval: ' + error.message);
    }
  },

  getStats() {
    return {
      success: true,
      stats: {
        ...this.stats,
        isRunning: this.isRunning,
        intervalMinutes: this.intervalMinutes,
        lastRunTime: this.lastRunTime,
        uptime: this.isRunning ? 'Running' : 'Stopped'
      }
    };
  }
};

module.exports = { AGENT_FORMAT };
