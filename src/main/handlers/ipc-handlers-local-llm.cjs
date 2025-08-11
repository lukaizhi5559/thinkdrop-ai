// IPC Handlers Part 3: Screenshot, System Health, and Legacy LLM Handlers
// To be combined with ipc-handlers.cjs

// Import broadcast function from main IPC handlers
// const { broadcastOrchestrationUpdate } = require('./ipc-handlers.cjs');

// Import IntentParser factory for centralized parser management
const parserFactory = require('../services_new/utils/IntentParserFactory.cjs');

// Configure parser preferences (can be changed at runtime)
parserFactory.configure({
  useHybrid: true,   // Best: TensorFlow.js + USE + Compromise + Natural
  useFast: false,    // Good: Natural + Compromise only
  useOriginal: false // Fallback: Original heavy parser
});

// Parser instance (managed by factory)
let currentParser = null;

// ========================================
// THIN IPC HANDLERS - BUSINESS LOGIC MOVED TO ORCHESTRATOR
// ========================================

// ========================================
// LEGACY LLM COMPATIBILITY HANDLERS
// ========================================

function setupLocalLLMHandlers(ipcMain, coreAgent, windows) {
  // Initialize IntentParser using factory
  if (!currentParser) {
    parserFactory.getParser().then(parser => {
      currentParser = parser;
      const config = parserFactory.getConfig();
      const parserType = config.useHybrid ? 'Hybrid' : (config.useFast ? 'Fast' : 'Original');
      console.log(`✅ ${parserType}IntentParser initialized via factory`);
    }).catch(err => {
      console.error('❌ Failed to initialize parser via factory:', err.message);
    });
  }

  // Legacy LLM health check - routes to unified agent system
  ipcMain.handle('llm-get-health', async () => {
    try {
      // Return health status compatible with legacy LocalLLMContext expectations
      const health = {
        status: coreAgent && coreAgent.initialized ? 'ready' : 'initializing',
        agents: coreAgent ? Object.keys(coreAgent.agents || {}).length : 0,
        database: coreAgent && coreAgent.database ? 'connected' : 'disconnected',
        lastActivity: new Date().toISOString()
      };
      
      return { success: true, data: health };
    } catch (error) {
      console.error('❌ LLM health check error:', error);
      return { success: false, error: error.message };
    }
  });

  // Fast local LLM query handler with intent classification - returns both response and intentClassificationPayload
  ipcMain.handle('llm-query-local', async (event, prompt, options = {}) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      console.log('🚀 [SEMANTIC-FIRST] Local LLM with enhanced semantic-first processing:', prompt.substring(0, 50) + '...');
      console.log('🎯 [SEMANTIC-FIRST] Options received:', {
        preferSemanticSearch: options.preferSemanticSearch,
        enableIntentClassification: options.enableIntentClassification,
        useAgentOrchestration: options.useAgentOrchestration
      });

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP 0: NER-FIRST ROUTING - Smart routing based on entities
      ////////////////////////////////////////////////////////////////////////
      let routingDecision = null;
      if (currentParser && currentParser.routeWithNER) {
        try {
          console.log('🎯 NER-FIRST: Using entity-based routing for optimal performance...');
          routingDecision = await currentParser.routeWithNER(prompt);
          if (routingDecision) {
            console.log(`✅ NER Routing: ${routingDecision.primaryIntent} | Semantic: ${routingDecision.needsSemanticSearch} | Orchestration: ${routingDecision.needsOrchestration}`);
          } else {
            console.log('🤔 NER Routing: Abstained - falling back to semantic search');
          }
        } catch (error) {
          console.warn('⚠️ NER routing failed, using fallback:', error.message);
        }
      }

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP 1: CONDITIONAL SEMANTIC SEARCH - Only when NER suggests it
      ////////////////////////////////////////////////////////////////////////
      if (!routingDecision || routingDecision.needsSemanticSearch) {
        console.log('🔍 NER suggests semantic search - checking memories...');
        const semanticResponse = await coreAgent.trySemanticSearchFirst(prompt, options);
        if (semanticResponse) {
          return semanticResponse;
        }
      } else {
        console.log('⚡ NER routing: Skipping semantic search - not needed for this query type');
      }

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP 1.5: EARLY QUESTION HANDLER - Direct LLM for general knowledge
      ////////////////////////////////////////////////////////////////////////
      const directQuestionResponse = await coreAgent.tryDirectQuestionFirst(prompt, routingDecision, options);
      if (directQuestionResponse) {
        return directQuestionResponse;
      }

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP 2: SIMPLIFIED INTENT ASSIGNMENT - Use NER routing result
      ////////////////////////////////////////////////////////////////////////
      let intentResult;

      // NER-FIRST SIMPLIFIED PATH: Use routing decision if available
      if (routingDecision) {
        console.log(`✅ NER-FIRST: Using routing decision - ${routingDecision.primaryIntent} (confidence: ${routingDecision.confidence})`);
        
        // Create result structure using NER routing decision
        intentResult = {
          success: true,
          result: {
            intentData: {
              primaryIntent: routingDecision.primaryIntent,
              intents: [{ intent: routingDecision.primaryIntent, confidence: routingDecision.confidence, reasoning: routingDecision.reasoning }],
              entities: routingDecision.entities || {},
              requiresMemoryAccess: ['memory_store', 'memory_retrieve', 'memory_update', 'memory_delete', 'question'].includes(routingDecision.primaryIntent),
              requiresExternalData: false,
              captureScreen: (routingDecision.primaryIntent === 'command' && /screenshot|capture|screen/.test(prompt.toLowerCase())) || 
                            (routingDecision.primaryIntent === 'question' && /what.*see.*screen|what.*on.*screen|describe.*screen|analyze.*screen/.test(prompt.toLowerCase())),
              suggestedResponse: currentParser?.getSuggestedResponse ? currentParser.getSuggestedResponse(routingDecision.primaryIntent, prompt) : 'I\'ll help you with that using my local capabilities.',
              sourceText: prompt,
              chainOfThought: {
                step1_analysis: routingDecision.reasoning,
                step2_reasoning: `NER-based routing (confidence: ${(routingDecision.confidence * 100).toFixed(1)}%)`,
                step3_consistency: 'Entity-driven classification'
              }
            }
          }
        };
      } else {
        // FALLBACK PATH: Use Phi3Agent classification if NER routing failed
        console.log('🎯 FALLBACK: NER routing unavailable, using Phi3Agent classification...');
        intentResult = await coreAgent.executeAgent('Phi3Agent', {
          action: 'classify-intent',
          message: prompt,
          options: {
            temperature: 0.1,
            maxTokens: 500
          }
        }, {
          source: 'fast_local_llm_intent',
          timestamp: new Date().toISOString()
        });
      }

      let intentClassificationPayload;
      let quickResponse;

      if (intentResult.success && intentResult.result && intentResult.result.intentData) {
        // Phi3Agent already returns the complete intentClassificationPayload structure
        const { intentData } = intentResult.result;
        console.log('✅ Intent classification successful:', intentData.primaryIntent);
        

        quickResponse = intentData.suggestedResponse || 'I\'ll help you with that using my local capabilities.';
        
        // Use the complete structure from Phi3Agent - no manual building needed
        intentClassificationPayload = {
          ...intentData,
          timestamp: new Date().toISOString(),
          context: {
            source: 'local_phi3_classification',
            sessionId: `local-session-${Date.now()}`,
            model: 'phi4-mini:latest'
          }
        };
      } else {
        console.warn('⚠️ Intent classification failed, using fallback');
        quickResponse = 'I\'ll help you with that question using my local capabilities.';
        
        // Simple fallback - let Phi3Agent handle this too
        intentClassificationPayload = {
          primaryIntent: 'question',
          intents: [{ intent: 'question', confidence: 0.7, reasoning: 'Fallback' }],
          entities: [],
          requiresMemoryAccess: false,
          requiresExternalData: false,
          captureScreen: false,
          suggestedResponse: quickResponse,
          sourceText: prompt,
          timestamp: new Date().toISOString(),
          context: {
            source: 'local_phi3_fallback',
            sessionId: `local-session-${Date.now()}`,
            model: 'phi4-mini:latest'
          }
        };
      }

      ////////////////////////////////////////////////////////////////////////
      // STEP 3: CONDITIONAL ORCHESTRATION - Only when NER suggests it's needed
      ////////////////////////////////////////////////////////////////////////
      if (!routingDecision || routingDecision.needsOrchestration) {
        console.log('🔄 Step 3: Triggering background orchestration (NER suggests needed)...');
        // Don't await this - let it run in background
        coreAgent.handleLocalOrchestration(prompt, intentClassificationPayload, {
          source: 'fast_local_llm_background',
          timestamp: new Date().toISOString()
        }).then(result => {
        // Background orchestration completed
        
        // Broadcast orchestration update to frontend if result contains response
        console.log('🔍 [DEBUG] Checking broadcast conditions:');
        console.log('  - result exists:', !!result);
        console.log('  - result.response exists:', !!(result && result.response));
        console.log('  - windows exists:', !!windows);
        console.log('  - global.broadcastOrchestrationUpdate exists:', !!global.broadcastOrchestrationUpdate);
        
        if (result && result.response && windows) {
          console.log('📡 [BROADCAST] Broadcasting orchestration update to frontend...');
          
          const updateData = {
            type: 'orchestration-complete',
            response: result.response,
            handledBy: result.handledBy,
            method: result.method,
            timestamp: result.timestamp
          };
          
          console.log('📡 [BROADCAST] Update data:', updateData);
          console.log('📡 [BROADCAST] Calling from LOCAL-LLM handler - Stack trace:', new Error().stack);
          
          if (global.broadcastOrchestrationUpdate) {
            global.broadcastOrchestrationUpdate(updateData, windows);
            console.log('✅ [BROADCAST] Successfully called global.broadcastOrchestrationUpdate from LOCAL-LLM');
          } else {
            console.error('❌ [BROADCAST] global.broadcastOrchestrationUpdate is not defined!');
          }
          
          console.log('🎉 [RESULTS FOR QUERY] result', result, quickResponse);
        } else {
          console.log('⚠️ No orchestration update broadcast - missing result.response or windows');
          if (!result) console.log('  - Missing result');
          if (result && !result.response) console.log('  - Missing result.response');
          if (!windows) console.log('  - Missing windows parameter');
        }
        }).catch(error => {
          console.warn('⚠️ Background orchestration failed:', error.message);
        });
      } else {
        console.log('⚡ NER routing: Skipping orchestration - not needed for this query type');
      }
      
      console.log('🎉 [FAST PATH] Complete: Response + Intent Classification ready');
      
      return {
        success: true,
        data: quickResponse, // For immediate chat display
        intentClassificationPayload: intentClassificationPayload // For background orchestration
      };
      
    } catch (error) {
      console.error('❌ Fast local LLM query error:', error);
      return { success: false, error: error.message };
    }
  });

  // Legacy LLM orchestration handler - routes to unified agent system
  ipcMain.handle('llm-orchestrate', async (event, userInput, context = {}) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      // Route legacy orchestration through unified agent orchestration
      const intentPayload = {
        type: 'command',
        message: userInput,
        context,
        source: 'legacy_orchestration'
      };
      
      const result = await coreAgent.ask(intentPayload);
      return { success: true, data: result };
    } catch (error) {
      console.error('❌ Legacy LLM orchestration error:', error);
      return { success: false, error: error.message };
    }
  });

  // Legacy cached agents handler - returns empty for now
  ipcMain.handle('llm-get-cached-agents', async () => {
    return { success: true, data: [] };
  });

  // Legacy communications handler - returns empty for now
  ipcMain.handle('llm-get-communications', async (event, limit = 10) => {
    return { success: true, data: [] };
  });

  // Legacy cache clear handler - no-op for now
  ipcMain.handle('llm-clear-cache', async () => {
    return { success: true };
  });

  // Legacy local LLM health check - routes to unified agent system
  ipcMain.handle('local-llm:health', async () => {
    try {
      // Return health status compatible with legacy LocalLLMContext expectations
      const health = {
        status: coreAgent && coreAgent.initialized ? 'ready' : 'initializing',
        agents: coreAgent ? Object.keys(coreAgent.agents || {}).length : 0,
        database: coreAgent && coreAgent.database ? 'connected' : 'disconnected',
        lastActivity: new Date().toISOString()
      };
      
      return { success: true, data: health };
    } catch (error) {
      console.error('❌ Local LLM health check error:', error);
      return { success: false, error: error.message };
    }
  });

  // Legacy local LLM process message handler - redirected to new fast path
  ipcMain.handle('local-llm:process-message', async (event, message) => {
    try {
      console.log('🔄 Legacy handler redirecting to new fast path...');
      
      // Extract message text
      const messageText = message.text || message;
      
      // Redirect to the new llmQueryLocal handler to avoid dual processing
      const llmQueryLocalHandler = ipcMain.listeners('llmQueryLocal')[0];
      if (llmQueryLocalHandler) {
        const result = await llmQueryLocalHandler(event, messageText);
        return result;
      } else {
        // Fallback if new handler not found
        console.warn('⚠️ New llmQueryLocal handler not found, using legacy fallback');
        return { 
          success: true, 
          response: 'I\'ll help you with that using my local capabilities.',
          source: 'legacy_fallback'
        };
      }
    } catch (error) {
      console.error('❌ Legacy LLM process message error:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Memory cleanup handler
  ipcMain.handle('cleanup-contaminated-memories', async (event) => {
    try {
      console.log('🧹 Starting contaminated memory cleanup...');
      
      const result = await coreAgent.executeAgent('UserMemoryAgent', {
        action: 'cleanup-contaminated-memories'
      });
      
      if (result.success) {
        console.log(`✅ Cleanup completed: ${result.result.deletedMemories} contaminated memories removed`);
        return {
          success: true,
          deletedMemories: result.result.deletedMemories,
          deletedEntities: result.result.deletedEntities,
          message: result.result.message
        };
      } else {
        throw new Error(result.error || 'Cleanup failed');
      }
    } catch (error) {
      console.error('❌ Memory cleanup failed:', error);
      return { success: false, error: error.message };
    }
  });
}

// Initialize all handlers
function initializeLocalLLMHandlers({
  ipcMain,
  coreAgent,
  windowState,
  windows
}) {
  setupLocalLLMHandlers(ipcMain, coreAgent, windows);
  
  // Start background agent bootstrapping for instant first queries
  setTimeout(() => {
    if (coreAgent && typeof coreAgent.bootstrapCriticalAgents === 'function') {
      coreAgent.bootstrapCriticalAgents();
    } else {
      console.log('⚠️ CoreAgent not available - skipping background bootstrapping');
    }
  }, 1000); // Small delay to let main initialization complete first
}

module.exports = {
  initializeLocalLLMHandlers,
  setupLocalLLMHandlers
};