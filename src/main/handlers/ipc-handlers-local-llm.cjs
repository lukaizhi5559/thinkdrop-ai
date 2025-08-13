// IPC Handlers Part 3: Screenshot, System Health, and Legacy LLM Handlers
// To be combined with ipc-handlers.cjs

// Import broadcast function from main IPC handlers
// const { broadcastOrchestrationUpdate } = require('./ipc-handlers.cjs');

// Import IntentParser factory for centralized parser management
const parserFactory = require('../services/utils/IntentParserFactory.cjs');

// ========================================
// LIGHTWEIGHT IPC HANDLERS - BUSINESS LOGIC IN ORCHESTRATOR
// ========================================

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
      // 🎯 STEP -1: UNIVERSAL CONVERSATION CONTEXT - Get recent messages for chain awareness
      ////////////////////////////////////////////////////////////////////////
      let conversationContext = null;
      let currentSessionId = null; // Track current session for scoping
      try {
        const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
        if (conversationAgent) {
          // First get the current active session
          const sessionsResult = await conversationAgent.execute({
            action: 'session-list',
            limit: 1,
            offset: 0
          });
          
          if (sessionsResult?.success && sessionsResult?.data?.sessions?.length > 0) {
            const currentSession = sessionsResult.data.sessions[0]; // Get most recent session
            const sessionId = currentSession.id;
            currentSessionId = sessionId; // Store for semantic search scoping
            
            console.log(`🔍 [CONTEXT-DEBUG] Using session: ${sessionId}`);
            
            // Now get messages from that session - Human-like context window: 8 messages = ~4 exchange pairs
            const recentMessages = await conversationAgent.execute({
              action: 'message-list',
              sessionId: sessionId,
              limit: 8,
              offset: 0
            });
          
          console.log(`🔍 [CONTEXT-DEBUG] Raw result:`, {
            success: recentMessages?.success,
            hasData: !!recentMessages?.data,
            hasMessages: !!recentMessages?.data?.messages,
            messageCount: recentMessages?.data?.messages?.length || 0
          });
          
          if (recentMessages && recentMessages.data && recentMessages.data.messages && recentMessages.data.messages.length > 0) {
            // Format context messages (exclude current prompt)
            const allMessages = recentMessages.data.messages.filter(msg => msg.text !== prompt);
            console.log(`🔍 [CONTEXT-DEBUG] Filtered ${allMessages.length} messages (excluded current prompt)`);
            console.log(`🔍 [CONTEXT-DEBUG] Raw messages preview:`, allMessages.slice(-4).map(m => `${m.sender}: ${m.text.substring(0, 50)}...`));
            
            // Prioritize recent messages (human recency effect) - ensure chronological order
            const last8Messages = allMessages.slice(-8); // Last 8 messages (4 exchange pairs)
            const contextMessages = last8Messages
              .map((msg, index) => {
                // Add recency indicators for human-like processing (fixed index reference)
                const isVeryRecent = index >= last8Messages.length - 2; // Last 2 messages in this slice
                const prefix = isVeryRecent ? '🔥' : ''; // Mark very recent for AI attention
                return `${prefix}${msg.sender}: ${msg.text}`;
              })
              .join('\n');
            
            console.log(`🔍 [CONTEXT-DEBUG] Generated context (${contextMessages.length} chars):`);
            console.log(`🔍 [CONTEXT-FULL] Complete context:\n${contextMessages}`);
            
            if (contextMessages.trim()) {
              conversationContext = contextMessages;
              console.log(`✅ [CONTEXT] Added ${allMessages.length} messages (~${Math.ceil(allMessages.length/2)} exchange pairs) for human-like conversation awareness`);
            } else {
              console.log(`⚠️ [CONTEXT] Context messages empty after processing`);
            }
          } else {
            console.log(`⚠️ [CONTEXT] No messages found in conversation agent response`);
          }
          } else {
            console.log(`⚠️ [CONTEXT] No active sessions found`);
          }
        }
      } catch (contextError) {
        console.warn('⚠️ [CONTEXT] Failed to get conversation context:', contextError.message);
        // Continue without context - not critical
      }

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP -0.5: QUICK LEARNING GOAL DETECTION - Check if this should be memory_store
      ////////////////////////////////////////////////////////////////////////
      let isLearningGoal = false;
      if (currentParser && currentParser.checkSemanticStorageIntent) {
        try {
          console.log('🔍 [LEARNING-CHECK] Quick learning goal detection for:', prompt);
          const learningCheck = await currentParser.checkSemanticStorageIntent(prompt);
          isLearningGoal = learningCheck.isLearningGoal;
          console.log(`🎯 [LEARNING-CHECK] Result: ${isLearningGoal} (confidence: ${learningCheck.confidence?.toFixed(3) || 'N/A'}, method: ${learningCheck.method})`);
        } catch (error) {
          console.warn('⚠️ Learning goal detection failed:', error.message);
        }
      }

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP -1: STAGED SEMANTIC SEARCH (Current → Session → Cross-Session)
      // Skip for learning goals - they should go to memory storage
      ////////////////////////////////////////////////////////////////////////
      if (!isLearningGoal) {
        const stagedSearchResult = await coreAgent.trySemanticSearchFirst(prompt, options, {
          conversationContext: conversationContext,
          currentSessionId: currentSessionId
        });
        if (stagedSearchResult) {
        // Extract the response text properly to avoid JSON object storage
        let responseText = stagedSearchResult.data?.response || stagedSearchResult.response || stagedSearchResult;
        
        console.log('🔍 [STAGED-SEARCH] Raw response type:', typeof responseText);
        console.log('🔍 [STAGED-SEARCH] Raw response value:', responseText);
        
        // Handle nested response objects recursively
        while (typeof responseText === 'object' && responseText !== null) {
          if (responseText.response) {
            responseText = responseText.response;
            console.log('🔧 [STAGED-SEARCH] Extracted nested response:', responseText);
          } else {
            // If it's an object but no 'response' property, stringify it
            responseText = JSON.stringify(responseText);
            console.log('🔧 [STAGED-SEARCH] Stringified object response:', responseText);
            break;
          }
        }
        
        // Remove surrounding quotes if present
        if (typeof responseText === 'string' && responseText.startsWith('"') && responseText.endsWith('"')) {
          responseText = responseText.slice(1, -1);
          console.log('🔧 [STAGED-SEARCH] Removed surrounding quotes:', responseText);
        }
        
        // Ensure we return a plain string
        const finalResponse = typeof responseText === 'string' ? responseText : String(responseText);
        
        console.log('✅ [STAGED-SEARCH] Final response:', finalResponse);
        
          return { 
            success: true, 
            data: { 
              response: finalResponse
            } 
          };
        }
      }

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
      // 🎯 STEP 0.5: LLM CONVERSATIONAL QUERY OVERRIDE - Fix misclassified queries
      ////////////////////////////////////////////////////////////////////////
      if (routingDecision && (routingDecision.primaryIntent === 'memory_store' || routingDecision.primaryIntent === 'command')) {
        try {
          console.log(`🔍 LLM-CHECK: Verifying if ${routingDecision.primaryIntent} classification is correct...`);
          const classificationResult = await coreAgent.executeAgent('UserMemoryAgent', {
            action: 'classify-conversational-query',
            query: prompt
          });
          
          if (classificationResult.success && classificationResult.result && classificationResult.result.result) {
            const actualResult = classificationResult.result.result;
            const isConversationalQuery = actualResult.isConversational;
            
            if (isConversationalQuery) {
              console.log(`🔄 LLM-OVERRIDE: "${prompt}" is conversational - changing memory_store → memory_retrieve`);
              routingDecision = {
                ...routingDecision,
                primaryIntent: 'memory_retrieve',
                needsSemanticSearch: true,
                needsOrchestration: false,
                method: 'llm_conversational_override'
              };
            } else {
              console.log(`✅ LLM-CONFIRM: "${prompt}" is correctly classified as memory_store`);
            }
          }
        } catch (error) {
          console.warn('⚠️ LLM conversational check failed, keeping NER decision:', error.message);
        }
      }

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP 1: (Disabled) Old single-call semantic path replaced by staged search
      ////////////////////////////////////////////////////////////////////////
      console.log('⏭️  [STAGED] Skipping old STEP 1 semantic path (using staged search)');

      ////////////////////////////////////////////////////////////////////////
      // 🎯 STEP 1.5: EARLY QUESTION HANDLER - Direct LLM for general knowledge
      ////////////////////////////////////////////////////////////////////////
      const directQuestionResponse = await coreAgent.tryDirectQuestionFirst(prompt, routingDecision, {
        ...options,
        conversationContext: conversationContext
      });
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
          
          // Extract response text properly - handle both string and object formats
          let responseText = result.response;
          console.log('🔍 [BROADCAST] Raw result.response type:', typeof result.response);
          console.log('🔍 [BROADCAST] Raw result.response value:', result.response);
          
          // Handle nested response objects recursively
          while (typeof responseText === 'object' && responseText !== null) {
            if (responseText.response) {
              responseText = responseText.response;
              console.log('🔧 [BROADCAST] Extracted nested response:', responseText);
            } else if (responseText.data && responseText.data.response) {
              responseText = responseText.data.response;
              console.log('🔧 [BROADCAST] Extracted data.response:', responseText);
            } else {
              // If it's an object but no 'response' property, stringify it
              responseText = JSON.stringify(responseText);
              console.log('🔧 [BROADCAST] Stringified object response:', responseText);
              break;
            }
          }
          
          // Remove surrounding quotes if present
          if (typeof responseText === 'string' && responseText.startsWith('"') && responseText.endsWith('"')) {
            responseText = responseText.slice(1, -1);
            console.log('🔧 [BROADCAST] Removed surrounding quotes:', responseText);
          }
          
          // Ensure we have a plain string
          responseText = typeof responseText === 'string' ? responseText : String(responseText);
          console.log('✅ [BROADCAST] Final extracted response:', responseText);
          
          const updateData = {
            type: 'orchestration-complete',
            response: responseText,
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

  // ========================================
  // PROGRESSIVE SEARCH HANDLERS
  // ========================================

  // Progressive search handler - three-stage search with intermediate feedback
  ipcMain.handle('local-llm-progressive-search', async (event, { prompt, context = {} }) => {
    try {
      console.log('🔍 [PROGRESSIVE-IPC] Starting progressive search for:', { prompt, context });
      
      if (!coreAgent || !coreAgent.initialized) {
        console.log('❌ [PROGRESSIVE-IPC] CoreAgent not initialized');
        return { success: false, error: 'CoreAgent not initialized' };
      }

      // Extract the actual prompt string - handle nested prompt object
      let actualPrompt = prompt;
      if (typeof prompt === 'object' && prompt.prompt) {
        actualPrompt = prompt.prompt;
        console.log('🔧 [PROGRESSIVE-IPC] Extracted nested prompt:', actualPrompt);
      }
      
      // Extract the actual context - handle nested context object
      let actualContext = context;
      if (typeof prompt === 'object' && prompt.context) {
        actualContext = { ...context, ...prompt.context };
        console.log('🔧 [PROGRESSIVE-IPC] Merged context from prompt object');
      }

      console.log('🔍 [PROGRESSIVE-IPC] Final parameters:', { 
        actualPrompt: typeof actualPrompt === 'string' ? actualPrompt : '[NOT STRING]', 
        contextKeys: Object.keys(actualContext) 
      });

      // Check if coreAgent has the progressive search method
      console.log('🔍 [PROGRESSIVE-IPC] Checking for tryProgressiveSemanticSearch on coreAgent...');
      if (typeof coreAgent.tryProgressiveSemanticSearch !== 'function') {
        console.log('❌ [PROGRESSIVE-IPC] tryProgressiveSemanticSearch method not found on coreAgent');
        console.log('🔍 [PROGRESSIVE-IPC] Available coreAgent methods:', Object.getOwnPropertyNames(coreAgent).filter(name => typeof coreAgent[name] === 'function'));
        return { success: false, error: 'Progressive search method not available' };
      }

      console.log('✅ [PROGRESSIVE-IPC] Found tryProgressiveSemanticSearch on coreAgent');

      // Callback to send intermediate responses to frontend
      const sendIntermediateCallback = async (intermediateResult) => {
        console.log(`📡 [PROGRESSIVE-IPC] Sending intermediate response:`, intermediateResult);
        event.sender.send('progressive-search-intermediate', {
          response: intermediateResult.response,
          continueToNextStage: intermediateResult.continueToNextStage
        });
      };

      // Execute progressive search with corrected parameters
      console.log('🚀 [PROGRESSIVE-IPC] Calling coreAgent.tryProgressiveSemanticSearch...');
      const result = await coreAgent.tryProgressiveSemanticSearch(
        actualPrompt, 
        actualContext, 
        sendIntermediateCallback
      );

      console.log(`✅ [PROGRESSIVE-IPC] Progressive search completed:`, result);
      
      return {
        success: true,
        data: {
          response: result.data?.response || result.response,
          continueToNextStage: result.continueToNextStage
        }
      };

    } catch (error) {
      console.error('❌ [PROGRESSIVE-IPC] Progressive search error:', error);
      console.error('❌ [PROGRESSIVE-IPC] Error stack:', error.stack);
      return { success: false, error: error.message };
    }
  });

  // Individual stage handlers for more granular control (optional)
  ipcMain.handle('local-llm-stage1-search', async (event, { prompt, context = {} }) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }

      const orchestrator = coreAgent.getAgent('AgentOrchestrator');
      if (!orchestrator) {
        return { success: false, error: 'AgentOrchestrator not available' };
      }

      const result = await orchestrator.stageCurrentScope(prompt, context);
      
      if (result?.success) {
        return {
          success: true,
          positive: true,
          data: { response: result.data.response },
          continueToStage2: false
        };
      } else {
        return {
          success: true,
          positive: false,
          data: { response: "I didn't find anything about that in our current conversation, let me check this session's history..." },
          continueToStage2: true
        };
      }

    } catch (error) {
      console.error('❌ Stage 1 search error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('local-llm-stage2-search', async (event, { prompt, context = {} }) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }

      const orchestrator = coreAgent.getAgent('AgentOrchestrator');
      if (!orchestrator) {
        return { success: false, error: 'AgentOrchestrator not available' };
      }

      const stage2 = await orchestrator.stageSemanticMemory(prompt, { sessionId: context.currentSessionId });
      
      if (stage2?.success) {
        const phiPrompt = orchestrator.buildStagedPrompt(prompt, { 
          conversationContext: context.conversationContext, 
          memorySnippets: stage2.data.snippets 
        });
        const resp = await orchestrator.executeAgent('Phi3Agent', {
          action: 'query-phi3-fast',
          prompt: phiPrompt,
          options: { timeout: 12000, maxTokens: 150, temperature: 0.2 }
        });
        
        if (resp.success && resp.result?.response) {
          return {
            success: true,
            positive: true,
            data: { response: resp.result.response },
            continueToStage3: false
          };
        }
      }
      
      return {
        success: true,
        positive: false,
        data: { response: "Apologize, still searching... give me a minute while I check all our previous conversations..." },
        continueToStage3: true
      };

    } catch (error) {
      console.error('❌ Stage 2 search error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('local-llm-stage3-search', async (event, { prompt, context = {} }) => {
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }

      const orchestrator = coreAgent.getAgent('AgentOrchestrator');
      if (!orchestrator) {
        return { success: false, error: 'AgentOrchestrator not available' };
      }

      const stage3 = await orchestrator.stageSemanticMemory(prompt, { sessionId: null });
      
      if (stage3?.success) {
        const phiPrompt = orchestrator.buildStagedPrompt(prompt, { 
          conversationContext: context.conversationContext, 
          memorySnippets: stage3.data.snippets 
        });
        const resp = await orchestrator.executeAgent('Phi3Agent', {
          action: 'query-phi3-fast',
          prompt: phiPrompt,
          options: { timeout: 13000, maxTokens: 160, temperature: 0.2 }
        });
        
        if (resp.success && resp.result?.response) {
          return {
            success: true,
            positive: true,
            data: { response: resp.result.response }
          };
        }
      }
      
      return {
        success: true,
        positive: false,
        data: { response: "I couldn't find any previous discussions about that topic in our conversation history." }
      };

    } catch (error) {
      console.error('❌ Stage 3 search error:', error);
      return { success: false, error: error.message };
    }
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