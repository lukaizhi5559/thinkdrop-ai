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
      
      console.log('🚀 [FAST PATH] Local LLM with intent classification:', prompt.substring(0, 50) + '...');

      let intentResult;

      // ULTRA-FAST PATH: Try parser classification first
      if (currentParser) {
        try {
          const config = parserFactory.getConfig();
          const parserName = config.useDistilBert ? 'DistilBertIntentParser' : 
                            (config.useHybrid ? 'HybridIntentParser' : 
                            (config.useFast ? 'FastIntentParser' : 'IntentParser'));
          console.log(`⚡ ULTRA-FAST PATH: Trying ${parserName} classification...`);
          
          // Handle DistilBERT parser differently (uses parse() method)
          if (config.useDistilBert && currentParser.constructor.name === 'DistilBertIntentParser') {
            console.log('🎯 Using DistilBERT parser.parse() method...');
            const parseResult = await currentParser.parse(prompt);
            
            if (parseResult && parseResult.confidence >= 0.4) {
              console.log(`✅ ULTRA-FAST: DistilBERT classification - ${parseResult.intent} (confidence: ${(parseResult.confidence * 100).toFixed(1)}%)`);
              
              // Create result structure matching Phi3Agent output
              intentResult = {
                success: true,
                result: {
                  intentData: {
                    primaryIntent: parseResult.intent,
                    intents: [{ intent: parseResult.intent, confidence: parseResult.confidence, reasoning: parseResult.reasoning }],
                    entities: parseResult.entities || [],
                    requiresMemoryAccess: ['memory_store', 'memory_retrieve', 'memory_update', 'memory_delete', 'question'].includes(parseResult.intent),
                    requiresExternalData: false,
                    captureScreen: (parseResult.intent === 'command' && /screenshot|capture|screen/.test(prompt.toLowerCase())) || 
                                  (parseResult.intent === 'question' && /what.*see.*screen|what.*on.*screen|describe.*screen|analyze.*screen/.test(prompt.toLowerCase())),
                    suggestedResponse: parseResult.suggestedResponse,
                    sourceText: prompt,
                    chainOfThought: {
                      step1_analysis: parseResult.reasoning,
                      step2_reasoning: `DistilBERT confidence: ${(parseResult.confidence * 100).toFixed(1)}%`,
                      step3_consistency: 'DistilBERT semantic classification'
                    }
                  }
                }
              };
            }
          } else if (currentParser.calculatePatternScores) {
            // Use pattern matching for other parsers (Hybrid, Fast, Original)
            const patternScores = currentParser.calculatePatternScores(prompt.toLowerCase());
            const highestScore = Math.max(...Object.values(patternScores));
          
            if (highestScore > 0) {
            // Apply same smart tie-breaking logic as IntentParser
            const intentPriority = {
              'memory_retrieve': 4,
              'memory_store': 3,
              'command': 2,
              'question': 1,
              'greeting': 0
            };
            
            const bestIntent = Object.entries(patternScores)
              .sort((a, b) => {
                const scoreA = patternScores[a[0]];
                const scoreB = patternScores[b[0]];
                
                // If scores are different, pick higher score
                if (scoreA !== scoreB) {
                  return scoreB - scoreA;
                }
                
                // If scores are equal, use priority (memory_retrieve > question)
                return (intentPriority[b[0]] || 0) - (intentPriority[a[0]] || 0);
              })[0][0];
            
            console.log(`✅ ULTRA-FAST: Pattern match found - ${bestIntent} (score: ${highestScore})`);
            
            // Extract entities using the parser
            let extractedEntities = [];
            try {
              extractedEntities = currentParser.extractEntities(prompt);
            } catch (entityError) {
              console.warn('⚠️ Entity extraction failed in fast path:', entityError.message);
              extractedEntities = [];
            }
            
            // Create result structure matching Phi3Agent output
            intentResult = {
              success: true,
              result: {
                intentData: {
                  primaryIntent: bestIntent,
                  intents: [{ intent: bestIntent, confidence: 0.9, reasoning: 'Pattern-based classification' }],
                  entities: extractedEntities,
                  requiresMemoryAccess: ['memory_store', 'memory_retrieve', 'memory_update', 'memory_delete', 'question'].includes(bestIntent),
                  requiresExternalData: false,
                  captureScreen: (bestIntent === 'command' && /screenshot|capture|screen/.test(prompt.toLowerCase())) || 
                                (bestIntent === 'question' && /what.*see.*screen|what.*on.*screen|describe.*screen|analyze.*screen/.test(prompt.toLowerCase())),
                  suggestedResponse: currentParser.getFallbackResponse(bestIntent, prompt),
                  sourceText: prompt,
                  chainOfThought: {
                    step1_analysis: `Pattern-based detection for ${bestIntent}`,
                    step2_reasoning: `High-confidence pattern match (score: ${highestScore})`,
                    step3_consistency: 'Ultra-fast pattern classification'
                  }
                }
              }
            };
            }
          }
        } catch (error) {
          console.warn('⚠️ IntentParser fast path failed:', error.message);
        }
      }

      // FALLBACK PATH: Use full Phi3Agent classification if pattern matching failed
      if (!intentResult) {
        console.log('🎯 FALLBACK: Using full Phi3Agent classification...');
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
            model: 'phi3:mini'
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
            model: 'phi3:mini'
          }
        };
      }

      // Step 2: Trigger background orchestration (non-blocking)
      console.log('🔄 Step 2: Triggering background orchestration...');
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
}

module.exports = {
  initializeLocalLLMHandlers,
  setupLocalLLMHandlers
};