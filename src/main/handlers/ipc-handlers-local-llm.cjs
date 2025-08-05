// IPC Handlers Part 3: Screenshot, System Health, and Legacy LLM Handlers
// To be combined with ipc-handlers.cjs

// Import broadcast function from main IPC handlers
// const { broadcastOrchestrationUpdate } = require('./ipc-handlers.cjs');

// Import IntentParser for fast path classification
const NaturalLanguageIntentParser = require('../services_new/utils/IntentParser.cjs');

// Initialize IntentParser instance (will be initialized once during setup)
let intentParser = null;

// ========================================
// LEGACY LLM COMPATIBILITY HANDLERS
// ========================================

function setupLocalLLMHandlers(ipcMain, coreAgent, windows) {
  // Initialize IntentParser for fast path classification
  if (!intentParser) {
    try {
      intentParser = new NaturalLanguageIntentParser();
      // Initialize embeddings asynchronously (non-blocking)
      intentParser.initializeEmbeddings().catch(err => {
        console.warn('⚠️ IntentParser embeddings initialization failed:', err.message);
      });
      console.log('✅ IntentParser initialized for fast path classification');
    } catch (error) {
      console.error('❌ Failed to initialize IntentParser:', error.message);
    }
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

      // ULTRA-FAST PATH: Try IntentParser pattern matching first
      if (intentParser) {
        try {
          console.log('⚡ ULTRA-FAST PATH: Trying IntentParser pattern matching...');
          
          // Use IntentParser's pattern matching directly (no LLM call)
          const patternScores = intentParser.calculatePatternScores(prompt.toLowerCase());
          const highestScore = Math.max(...Object.values(patternScores));
          
          if (highestScore > 0) {
            const bestIntent = Object.entries(patternScores)
              .reduce((a, b) => patternScores[a[0]] > patternScores[b[0]] ? a : b)[0];
            
            console.log(`✅ ULTRA-FAST: Pattern match found - ${bestIntent} (score: ${highestScore})`);
            
            // Create result structure matching Phi3Agent output
            intentResult = {
              success: true,
              result: {
                intentData: {
                  primaryIntent: bestIntent,
                  intents: [{ intent: bestIntent, confidence: 0.9, reasoning: 'Pattern-based classification' }],
                  entities: [],
                  requiresMemoryAccess: ['memory_store', 'memory_retrieve', 'memory_update', 'memory_delete'].includes(bestIntent),
                  requiresExternalData: false,
                  captureScreen: bestIntent === 'command' && /screenshot|capture|screen/.test(prompt.toLowerCase()),
                  suggestedResponse: intentParser.getFallbackResponse(bestIntent, prompt),
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
        console.log('✅ Background orchestration completed:', result);
        console.log('🔍 [DEBUG] Background orchestration result structure:', {
          hasResult: !!result,
          hasResponse: !!(result && result.response),
          resultKeys: result ? Object.keys(result) : 'null',
          responseValue: result ? result.response : 'undefined'
        });
        
        // Broadcast orchestration update to frontend if result contains response
        if (result && result.response && windows) {
          console.log('📡 Broadcasting orchestration update to frontend...');
          global.broadcastOrchestrationUpdate({
            type: 'orchestration-complete',
            response: result.response,
            handledBy: result.handledBy,
            method: result.method,
            timestamp: result.timestamp
          }, windows);
        } else {
          console.log('⚠️ No orchestration update broadcast - missing result.response or windows');
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