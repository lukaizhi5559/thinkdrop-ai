// IPC Handlers Part 2: Memory and Screenshot Handlers
// To be combined with ipc-handlers.cjs

// ========================================
// MEMORY QUERY AND DELETE HANDLERS
// ========================================

function setupMemoryHandlers(ipcMain, coreAgent) {
  // Direct memory query handler for fast MemoryDebugger access (bypasses agent orchestration)
  ipcMain.handle('query-memories-direct', async (event, options = {}) => {
    try {
      console.log('🔍 Direct memory query received:', options);
      const { limit = 50, offset = 0, searchQuery = null } = options;
      
      // Check if coreAgent is initialized
      if (!coreAgent) {
        console.log('❌ CoreAgent is null');
        // Return empty results instead of error to avoid UI breaking
        return { 
          success: true, 
          memories: [], 
          total: 0, 
          warning: 'CoreAgent not initialized, returning empty results' 
        };
      }
      
      if (!coreAgent.initialized) {
        console.log('❌ CoreAgent not initialized (property name is "initialized", not "isInitialized")');
        // Return empty results instead of error to avoid UI breaking
        return { 
          success: true, 
          memories: [], 
          total: 0, 
          warning: 'CoreAgent not initialized, returning empty results' 
        };
      }
      
      console.log('✅ CoreAgent available and initialized');
      
      // Try to get database connection directly from coreAgent
      let db = null;
      
      console.log('🔍 Detailed CoreAgent inspection:');
      console.log('CoreAgent keys:', Object.keys(coreAgent));
      
      // Log detailed information about the context object
      if (coreAgent.context) {
        console.log('CoreAgent.context keys:', Object.keys(coreAgent.context));
        if (coreAgent.context.database) {
          console.log('✅ coreAgent.context.database exists');
          console.log('Database type:', typeof coreAgent.context.database);
          console.log('Database methods:', Object.keys(coreAgent.context.database));
        } else {
          console.log('❌ coreAgent.context.database is undefined or null');
        }
      } else {
        console.log('❌ coreAgent.context is undefined or null');
      }
      
      // Try to get database connection from various possible locations
      if (coreAgent.database) {
        db = coreAgent.database;
        console.log('✅ Using database from coreAgent.database');
      } else if (coreAgent.context && coreAgent.context.database) {
        // This is the correct location based on AgentOrchestrator.js implementation
        db = coreAgent.context.database;
        console.log('✅ Using database from coreAgent.context.database');
      } else if (coreAgent.orchestrator && coreAgent.orchestrator.db) {
        db = coreAgent.orchestrator.db;
        console.log('✅ Using database from coreAgent.orchestrator.db');
      } else if (coreAgent.db) {
        db = coreAgent.db;
        console.log('✅ Using database from coreAgent.db');
      } else {
        console.log('❌ No database connection found in coreAgent');
        
        if (coreAgent.orchestrator) {
          console.log('CoreAgent.orchestrator keys:', Object.keys(coreAgent.orchestrator));
        }
        return { success: false, error: 'Database connection not available' };
      }
      
      // Check available tables first (DuckDB syntax)
      try {
        // Use query() instead of all() to match DatabaseManager API
        const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'");
        console.log('📋 Available tables:', tables);
      } catch (err) {
        try {
          // Fallback to SHOW TABLES for DuckDB
          const tables = await db.query("SHOW TABLES");
          console.log('📋 Available tables (fallback):', tables);
        } catch (err2) {
          console.log('⚠️ Could not list tables:', err.message);
        }
      }
      
      // Use the table that we know exists
      const tableName = 'memory';
      console.log(`✅ Using table: ${tableName}`);
      
      // Build queries - DuckDB compatible with correct column names
      const query = searchQuery 
        ? `SELECT * FROM ${tableName} WHERE (source_text LIKE '%${searchQuery}%' OR suggested_response LIKE '%${searchQuery}%' OR backend_memory_id LIKE '%${searchQuery}%') ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        : `SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      
      const countQuery = searchQuery
        ? `SELECT COUNT(*) as total FROM ${tableName} WHERE (source_text LIKE '%${searchQuery}%' OR suggested_response LIKE '%${searchQuery}%' OR backend_memory_id LIKE '%${searchQuery}%')`
        : `SELECT COUNT(*) as total FROM ${tableName}`;
      
      console.log('🔍 Executing query:', query);
      
      // Execute queries with DatabaseManager API using query() instead of all()
      let memories = [];
      try {
        const result = await db.query(query);
        // Ensure we always have an array, even if result is undefined or null
        memories = Array.isArray(result) ? result : [];
        console.log(`✅ Query returned ${memories.length} rows`);
      } catch (err) {
        console.error('❌ Query error:', err);
        // Don't throw, just log the error and continue with empty array
        console.log('✅ Continuing with empty memories array');
      }
      
      // Get total count using query() instead of all()
      let totalCount = 0;
      try {
        const countResult = await db.query(countQuery);
        // Ensure we handle undefined or null results gracefully
        if (countResult && Array.isArray(countResult) && countResult.length > 0 && countResult[0].total !== undefined) {
          totalCount = Number(countResult[0].total);
        } else {
          // If count query returned invalid results, fallback to memories length
          totalCount = memories.length;
          console.log('✅ Using fallback count from memories length');
        }
        console.log(`✅ Total count: ${totalCount}`);
      } catch (err) {
        console.error('❌ Count query error:', err);
        totalCount = memories.length; // Fallback to using the length of memories
        console.log(`✅ Using fallback count after error: ${totalCount}`);
      }
      
      // Ensure memories is always an array
      memories = Array.isArray(memories) ? memories : [];
      console.log(`📊 Direct memory query: ${memories.length} memories loaded (${offset}-${offset + memories.length} of ${totalCount})`);
      
      return {
        success: true,
        data: {
          memories,
          pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + memories.length < totalCount
          }
        }
      };
    } catch (error) {
      console.error('❌ Direct memory query error:', error);
      return { success: false, error: error.message };
    }
  });

  // Direct memory delete handler for fast MemoryDebugger delete operations
  ipcMain.handle('delete-memory-direct', async (event, memoryId) => {
    try {
      console.log('🗑️ Memory delete requested for ID:', memoryId);
      
      // Check if coreAgent is initialized
      if (!coreAgent || !coreAgent.initialized) {
        console.log('❌ CoreAgent not initialized for delete operation');
        return { 
          success: false, 
          error: 'CoreAgent not initialized'
        };
      }
      
      // Create intent payload for memory-delete
      const intentPayload = {
        intents: [{ intent: 'memory-delete', confidence: 0.8 }],
        primaryIntent: 'memory-delete',
        entities: [{ type: 'memoryId', value: memoryId }],
        requiresMemoryAccess: true,
        captureScreen: false,
        sourceText: `Delete memory with ID: ${memoryId}`,
        memoryId: memoryId
      };
      
      console.log('🎯 Passing memory-delete intent to coreAgent.ask():', intentPayload);
      
      // Use coreAgent.ask() pipeline: handler -> ask() -> UserMemoryAgent
      const result = await coreAgent.ask(intentPayload, {
        sessionId: `delete-${Date.now()}`,
        source: 'ipc-handler',
        operation: 'memory-delete'
      });
      
      console.log('🔍 CoreAgent.ask() result:', result);
      
      // Extract success information from the orchestration result
      if (result && result.success) {
        // Check if any step results indicate successful deletion
        const deleteResult = result.intentsProcessed?.find(r => 
          r.agent === 'UserMemoryAgent' && 
          r.action === 'memory-delete' && 
          r.success
        );
        
        if (deleteResult) {
          console.log('✅ Memory successfully deleted via orchestration pipeline');
          return { 
            success: true, 
            deletedCount: 1,
            message: 'Memory deleted successfully'
          };
        }
      }
      
      // Handle failure cases
      const errorMessage = result?.error || 'Memory deletion failed';
      console.log('❌ Memory deletion failed:', errorMessage);
      return { 
        success: false, 
        error: errorMessage 
      };
      
    } catch (error) {
      console.error('❌ Memory delete error:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  setupMemoryHandlers
};
