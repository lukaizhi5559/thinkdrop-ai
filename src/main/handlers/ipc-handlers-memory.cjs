// IPC Handlers Part 2: Memory and Screenshot Handlers
// To be combined with ipc-handlers.cjs

// ========================================
// MEMORY QUERY AND DELETE HANDLERS
// ========================================

function setupMemoryHandlers(ipcMain, coreAgent) {
  // Direct memory query handler for fast MemoryDebugger access (bypasses agent orchestration)
  ipcMain.handle('query-memories-direct', async (event, options = {}) => {
    try {
      console.log('🔍 Memory query via agent orchestration:', options);
      const { limit = 50, offset = 0, searchQuery = null } = options;
      
      // Check if coreAgent is initialized
      if (!coreAgent) {
        console.log('❌ CoreAgent is null');
        return { 
          success: false, 
          error: 'CoreAgent not initialized'
        };
      }
      
      if (!coreAgent.initialized) {
        console.log('❌ CoreAgent not initialized');
        return { 
          success: false, 
          error: 'CoreAgent not initialized'
        };
      }
      
      console.log('✅ CoreAgent available and initialized');
      
      // Construct intent payload for memory retrieval
      const intentPayload = {
        intents: [{ intent: 'memory-retrieve', confidence: 0.9 }],
        primaryIntent: 'memory-retrieve',
        entities: [
          { type: 'limit', value: limit },
          { type: 'offset', value: offset }
        ],
        requiresMemoryAccess: true,
        captureScreen: false,
        sourceText: searchQuery ? `Retrieve memories matching: ${searchQuery}` : 'Retrieve all memories',
        searchQuery: searchQuery,
        pagination: {
          limit: limit,
          offset: offset
        }
      };
      
      // Add search query as entity if provided
      if (searchQuery) {
        intentPayload.entities.push({ type: 'searchQuery', value: searchQuery });
      }
      
      console.log('🎯 Executing memory-retrieve via AgentOrchestrator.ask()...');
      
      // Use AgentOrchestrator.ask() to route to UserMemoryAgent
      const result = await coreAgent.ask(intentPayload);
      
      console.log('📊 Agent orchestration result:', {
        success: result.success,
        hasData: !!result.data,
        hasMemories: !!(result.data && result.data.memories),
        memoriesCount: result.data && result.data.memories ? result.data.memories.length : 0,
        resultKeys: Object.keys(result || {}),
        resultType: typeof result,
        hasResults: !!(result.results),
        resultsLength: result.results ? result.results.length : 0,
        hasIntentsProcessed: !!(result.intentsProcessed),
        intentsProcessedLength: result.intentsProcessed ? result.intentsProcessed.length : 0
      });
      
      // Debug intentsProcessed structure
      if (result.intentsProcessed && result.intentsProcessed.length > 0) {
        console.log('🔍 IntentsProcessed details:');
        result.intentsProcessed.forEach((intent, index) => {
          console.log(`  Intent ${index + 1}:`, {
            intent: intent.intent,
            success: intent.success,
            hasResult: !!intent.result,
            resultKeys: intent.result ? Object.keys(intent.result) : [],
            hasData: !!(intent.result && intent.result.data),
            dataKeys: intent.result && intent.result.data ? Object.keys(intent.result.data) : []
          });
        });
      }
      
      // Check for intentsProcessed structure (new workflow format)
      if (result.success && result.intentsProcessed && result.intentsProcessed.length > 0) {
        console.log('🔍 Found intentsProcessed structure, extracting memory data...');
        
        // Look for any successful intent with memory data (intent field might be undefined)
        const memoryIntent = result.intentsProcessed.find(intent => {
          // Check if this intent has memory data structure
          const hasMemoryData = intent.success && intent.result && 
            intent.result.data && intent.result.data.memories;
          
          // Also check if intent matches memory-retrieve (if intent field exists)
          const isMemoryIntent = !intent.intent || 
            intent.intent === 'memory-retrieve' || 
            intent.intent === 'memory_retrieve';
          
          return hasMemoryData && isMemoryIntent;
        });
        
        if (memoryIntent && memoryIntent.success && memoryIntent.result) {
          console.log('✅ Found successful intent with memory data');
          
          // Check if the result has the data structure we expect
          if (memoryIntent.result.data && memoryIntent.result.data.memories) {
            console.log('✅ Extracting memory data from intent result');
            return {
              success: true,
              data: memoryIntent.result.data,
              count: memoryIntent.result.count || 0,
              totalCount: memoryIntent.result.totalCount || 0,
              searchQuery: memoryIntent.result.searchQuery,
              source: 'intentsProcessed'
            };
          } else if (memoryIntent.result.success) {
            console.log('✅ Using intent result directly');
            return {
              success: true,
              data: memoryIntent.result,
              source: 'intentsProcessed_direct'
            };
          }
        }
        
        // Fallback: if no memory-specific intent found, try the first successful intent
        const firstSuccessfulIntent = result.intentsProcessed.find(intent => 
          intent.success && intent.result && intent.result.data
        );
        
        if (firstSuccessfulIntent) {
          console.log('✅ Using first successful intent as fallback');
          return {
            success: true,
            data: firstSuccessfulIntent.result.data,
            count: firstSuccessfulIntent.result.count || 0,
            totalCount: firstSuccessfulIntent.result.totalCount || 0,
            searchQuery: firstSuccessfulIntent.result.searchQuery,
            source: 'intentsProcessed_fallback'
          };
        }
      }
      
      // Check if we have workflow-style results (this is the main path for our agent)
      if (result.success && result.results && result.results.length > 0) {
      console.log('🔍 Found workflow-style results, checking structure...');
        
        // Process all workflow results to find the best match
        for (let i = 0; i < result.results.length; i++) {
          const workflowResult = result.results[i];
          
          if (!workflowResult.success) {
            console.log(`⚠️ Step ${i + 1} failed, checking next step...`);
            continue;
          }
          
          // Check for data in the result structure
          if (workflowResult.result && workflowResult.result.data) {
            console.log(`✅ Extracting data from workflow step ${i + 1}`);
            return {
              success: true,
              data: workflowResult.result.data,
              agent: workflowResult.agent,
              action: workflowResult.action,
              count: workflowResult.result.count || 0,
              totalCount: workflowResult.result.totalCount || 0,
              stepIndex: i + 1,
              totalSteps: result.results.length
            };
          }
          
          // Check if workflow completed successfully but without nested data structure
          if (workflowResult.result && workflowResult.result.success) {
            console.log(`✅ Using workflow step ${i + 1} result data`);
            return {
              success: true,
              data: workflowResult.result.data || workflowResult.result,
              agent: workflowResult.agent,
              action: workflowResult.action,
              stepIndex: i + 1,
              totalSteps: result.results.length
            };
          }
        }
        
        // If no step had extractable data, but workflow succeeded, use the first successful step
        const firstSuccessfulStep = result.results.find(step => step.success);
        if (firstSuccessfulStep) {
          console.log('✅ No extractable data found, using first successful step result');
          return {
            success: true,
            data: firstSuccessfulStep.result || {},
            agent: firstSuccessfulStep.agent,
            action: firstSuccessfulStep.action,
            message: 'Workflow completed successfully',
            totalSteps: result.results.length
          };
        }
      }
      
      // Check for direct data result
      if (result.success && result.data) {
        console.log('✅ Using direct data result');
        return result;
      }
      
      // If workflow succeeded but we couldn't extract data, still report success
      if (result.success && result.results && result.results.length > 0) {
        const workflowResult = result.results[0];
        if (workflowResult.success) {
          console.log('✅ Workflow completed successfully, returning result as-is');
          return {
            success: true,
            data: workflowResult.result || {},
            agent: workflowResult.agent,
            action: workflowResult.action,
            message: 'Workflow completed successfully'
          };
        }
      }
      
// Enhanced error reporting for unexpected cases
      const errorDetails = {
        hasError: !!result.error,
        error: result.error,
        hasResults: !!result.results,
        resultsCount: result.results ? result.results.length : 0,
        resultKeys: Object.keys(result || {}),
        firstResultKeys: result.results && result.results[0] ? Object.keys(result.results[0]) : [],
        success: result.success
      };

      // Special handling for otherwise successful workflows
      if (result.success && !result.results && !result.data) {
        console.log('⚠️ Workflow completed with no direct data. Marking as success.');
        return {
          success: true,
          message: 'Workflow completed successfully with no direct data'
        };
      }
      
      console.error('❌ Agent orchestration failed. Debug info:', errorDetails);
      
      // Try to extract more specific error information
      let specificError = 'Memory retrieval failed';
      if (result.results && result.results.length > 0) {
        const firstResult = result.results[0];
        if (!firstResult.success && firstResult.error) {
          specificError = firstResult.error;
        } else if (firstResult.result && firstResult.result.error) {
          specificError = firstResult.result.error;
        }
      }
      
      return {
        success: false,
        error: result.error || specificError,
        debugInfo: errorDetails
      };
      
    } catch (error) {
      console.error('❌ Memory query via orchestration error:', error);
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
