// IPC Handlers Part 3: Screenshot, System Health, and Legacy LLM Handlers
// To be combined with ipc-handlers.cjs

// Import broadcast function from main IPC handlers
// const { broadcastOrchestrationUpdate } = require('./ipc-handlers.cjs');

// Import IntentParser factory for centralized parser management
const parserFactory = require('../services/utils/IntentParserFactory.cjs');
const IntentResponses = require('../services/utils/IntentResponses.cjs');
const { storeTurn } = require('../services/background/AsyncMemoryStorage.cjs');

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

function setupLocalLLMHandlers(ipcMain,coreAgent, windows) {
  console.log('🚀 Setting up Local LLM IPC handlers...');
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

  // Helper function to broadcast thinking updates
  function broadcastThinkingUpdate(message, sessionId) {
    if (global.mainWindow && global.mainWindow.webContents) {
      global.mainWindow.webContents.send('thinking-indicator-update', {
        message,
        sessionId,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Helper function to compute cosine similarity between two embeddings
  function computeCosineSimilarity(embedding1, embedding2) {
    if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
      return 0;
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }
    
    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
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

  // Main IPC handler for new pipeline with Phi3Agent classification and hybrid routing
  ipcMain.handle('llm-query', async (event, prompt, options = {}) => {
    const startTime = Date.now();
    
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }

      console.log(`🎯 [MAIN-PIPELINE] Starting query: "${prompt.substring(0, 50)}..."`);
      console.log('🔧 [OPTIONS]:', JSON.stringify(options, null, 2));

      // Check if we should use provided intent classification or skip classification
      let intentClassificationPayload;
      let queryType;

      if (options.skipIntentClassification && options.intentClassificationPayload) {
        console.log('⏭️ [INTENT] Using provided intent classification payload');
        intentClassificationPayload = options.intentClassificationPayload;
        queryType = options.forceQueryType || intentClassificationPayload.queryType;
      } else if (options.forceQueryType) {
        console.log('🎯 [INTENT] Using forced queryType:', options.forceQueryType);
        queryType = options.forceQueryType;
        intentClassificationPayload = {
          primaryIntent: queryType.toLowerCase(),
          queryType: queryType,
          requiresExternalData: false,
          requiresMemoryAccess: queryType === 'MEMORY',
          captureScreen: false,
          routingHint: 'local'
        };
      } else {
        console.log('🔒 [OFFLINE-MODE] Using local LLM knowledge base only...');
        
        // Simple classification for offline mode
        intentClassificationPayload = {
          primaryIntent: 'question',
          requiresExternalData: false,
          requiresMemoryAccess: false,
          captureScreen: false,
          routingHint: 'conversation'
        };
      }

      // If we have a specific queryType, route to handleNonContextPipeline
      if (queryType === 'MEMORY' || queryType === 'COMMAND') {
        console.log(`🚀 [PIPELINE] Routing ${queryType} to handleNonContextPipeline`);
        const context = {
          sessionId: options.sessionId,
          userId: options.userId || 'default',
          source: 'intent_classification_trigger',
          intentClassificationPayload: intentClassificationPayload
        };
        
        return await handleNonContextPipeline(queryType, prompt, context, startTime);
      }

      // TODO: Uncomment below for online mode with external search
      /*
      ////////////////////////////////////////////////////////////////////////
      // STEP 1: PHI3AGENT INTENT CLASSIFICATION
      ////////////////////////////////////////////////////////////////////////
      
      console.log('🧠 Step 1: Phi3Agent intent classification...');
      let intentClassificationPayload = null;
      
      try {
        const phi3Agent = coreAgent.getLoadedAgent('Phi3Agent');
        if (!phi3Agent) {
          throw new Error('Phi3Agent not available');
        }
        
        // Check if Phi3Agent is ready (wait up to 5 seconds)
        let isReady = false;
        for (let i = 0; i < 10; i++) {
          try {
            const availabilityCheck = await phi3Agent.execute({ action: 'check-availability' });
            console.log(`🔍 DEBUG: Phi3Agent availability check ${i+1}/10:`, availabilityCheck);
            if (availabilityCheck && availabilityCheck.success && availabilityCheck.available === true) {
              isReady = true;
              console.log('✅ DEBUG: Phi3Agent is ready for classification');
              break;
            }
          } catch (e) {
            console.log(`⚠️ DEBUG: Phi3Agent availability check ${i+1}/10 failed:`, e.message);
          }
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
        }
        
        if (!isReady) {
          throw new Error('Phi3Agent not ready after 5 seconds');
        }
        
        const classificationResult = await phi3Agent.execute({ 
          action: 'classify-intent',
          message: prompt 
        }, { 
          sessionId: options.currentSessionId || options.sessionId 
        });
        
        if (classificationResult && classificationResult.success && classificationResult.intentData) {
          intentClassificationPayload = classificationResult.intentData;
          console.log(`✅ [PHI3-CLASSIFICATION] Intent: ${intentClassificationPayload.primaryIntent}, External: ${intentClassificationPayload.requiresExternalData}, Routing: ${intentClassificationPayload.routingHint}`);
        } else {
          throw new Error('Invalid classification result');
        }
      } catch (error) {
        console.warn('⚠️ [PHI3-CLASSIFICATION] Failed, using fallback:', error.message);
        
        // Fallback to simple classification
        intentClassificationPayload = {
          primaryIntent: 'question',
          requiresExternalData: false,
          requiresMemoryAccess: false,
          captureScreen: false,
          routingHint: 'conversation'
        };
      }

      ////////////////////////////////////////////////////////////////////////
      // STEP 2: SMART ROUTING - Use hybrid routing for external data queries
      ////////////////////////////////////////////////////////////////////////
      broadcastThinkingUpdate(IntentResponses.getThinkingMessage('routing'), options.sessionId);
      
      // Check if Phi3Agent classification indicates external data is needed
      const needsExternalData = intentClassificationPayload.requiresExternalData;
      const routingHint = intentClassificationPayload.routingHint;
      
      console.log(`🎯 [ROUTING-DECISION] requiresExternalData: ${needsExternalData}, routingHint: ${routingHint}`);
      
      if (needsExternalData && (routingHint === 'external_only' || routingHint === 'hybrid')) {
        console.log('🚀 [DIRECT-SEARCH] Query needs external data - using direct WebSearchAgent + LLM summarization...');
        
        // Direct approach: WebSearchAgent -> get articles -> LLM summarize
        try {
          // Step 1: Get news articles using WebSearchAgent
          console.log('📰 [DIRECT-SEARCH] Fetching articles from WebSearchAgent...');
          const WebSearchAgent = require('../services/agents/WebSearchAgent.cjs');
          const Phi3Agent = require('../services/agents/Phi3Agent.cjs');
          
          const searchResult = await WebSearchAgent.search(prompt, { 
            maxResults: 5 
          });
          
          if (searchResult.success && searchResult.articles.length > 0) {
            // Format articles for summarization
            const articlesText = searchResult.articles.map((article, index) => 
              `${index + 1}. **${article.title}**\n   Source: ${article.source?.name || 'Unknown'}\n   URL: ${article.url}\n   Published: ${article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : 'Unknown'}\n   ${article.description || article.content?.substring(0, 200) + '...' || 'No description available'}`
            ).join('\n\n');
            
            const summaryPrompt = `Based on the following news articles about "${prompt}", provide a comprehensive summary that includes the key points, recent developments, and important details. Include article titles and sources in your response.

${articlesText}

Please provide a well-structured summary that helps the user understand the current situation regarding their query.`;

            console.log(`📝 Sending ${searchResult.articles.length} articles to Phi3Agent for summarization`);
            
            const summaryResult = await Phi3Agent.execute({
              action: 'query-phi3-fast',
              prompt: summaryPrompt,
              options: {
                temperature: 0.3,
                max_tokens: 800,
                timeout: 15000
              }
            });
            
            if (summaryResult.success) {
              console.log(`✅ Phi3Agent summarization successful`);
              return {
                success: true,
                data: summaryResult.response,
                articles: searchResult.articles,
                source: 'websearch_llm_summary',
                timestamp: new Date().toISOString()
              };
            } else {
              console.log(`⚠️ Phi3Agent summarization failed, returning formatted articles`);
              // Fallback to formatted article list
              const fallbackResponse = `Here are the latest articles I found about "${prompt}":\n\n${articlesText}`;
              return {
                success: true,
                data: fallbackResponse,
                articles: searchResult.articles,
                source: 'websearch_formatted',
                timestamp: new Date().toISOString()
              };
            }
          } else {
            console.log(`❌ WebSearchAgent returned no articles, providing informative response`);
            // Instead of falling back to old pipeline, provide a helpful response
            return {
              success: true,
              data: `I wasn't able to find recent news articles about "${prompt}" at the moment. This could be due to query optimization or temporary API limitations. You might try rephrasing your question or asking about a more specific topic.`,
              source: 'no_results_fallback',
              timestamp: new Date().toISOString()
            };
          }
        } catch (error) {
          console.error('❌ [DIRECT-SEARCH] Direct search failed:', error.message);
          console.log('🔄 [DIRECT-SEARCH] Falling back to old pipeline...');
        }
      }
      */

      ////////////////////////////////////////////////////////////////////////
      // STEP 3: FALLBACK TO OLD PIPELINE FOR NON-EXTERNAL QUERIES
      ////////////////////////////////////////////////////////////////////////
      
      console.log('🔄 [FALLBACK] Using old pipeline for conversational/memory queries...');
      broadcastThinkingUpdate(IntentResponses.getThinkingMessage('routing'), options.sessionId);
      
      // Use old routing classification for fallback
      const routingStartTime = Date.now();
      const routingResult = await classifyQuery(prompt, { sessionId: options.currentSessionId || options.sessionId });
      const routingTime = Date.now() - routingStartTime;
      
      console.log(`🔍 [OLD-ROUTING] Classification: ${routingResult.classification} (${routingTime}ms)`);

      // Handle non-context queries (GENERAL, MEMORY, COMMAND)
      if (['GENERAL', 'MEMORY', 'COMMAND'].includes(routingResult.classification)) {
        const result = await handleNonContextPipeline(routingResult.classification, prompt, { sessionId: options.currentSessionId || options.sessionId }, startTime);
        
        // Transform response format for NEW pipeline compatibility
        if (result && result.success && result.response) {
          // Store conversation turn asynchronously
          try {
            await storeTurn(
              { sessionId: options.sessionId, userId: 'user', conversationId: options.conversationId },
              prompt,
              result.response,
              result.pipeline || 'main_pipeline'
            );
          } catch (error) {
            console.warn('⚠️ [ASYNC-MEMORY] Failed to store turn:', error.message);
          }
        
          return {
            success: true,
            data: result.response, // NEW pipeline expects response in 'data' field
            pipeline: result.pipeline,
            timing: result.timing
          };
        }
        
        return result;
      }

      // Route based on classification
      if (routingResult.classification === 'CONTEXT') {
        console.log('🎯 [SIMPLE-CONTEXT] Using recent conversation context...');
        broadcastThinkingUpdate(IntentResponses.getThinkingMessage('conversation_search'), options.sessionId);
        
        const simpleContextResult = await handleSimpleContext(prompt, { sessionId: options.currentSessionId || options.sessionId }, coreAgent);
        if (simpleContextResult?.success) {
          console.log('✅ [SIMPLE-CONTEXT] Successfully answered using recent messages');
          
          // Store conversation turn asynchronously
          try {
            await storeTurn(
              { sessionId: options.sessionId, userId: 'user', conversationId: options.conversationId },
              prompt,
              simpleContextResult.response,
              'simple_context'
            );
          } catch (error) {
            console.warn('⚠️ [ASYNC-MEMORY] Failed to store turn:', error.message);
          }
          
          return {
            success: true,
            data: simpleContextResult.response,
            pipeline: 'simple_context',
            timing: { total: Date.now() - startTime }
          };
        }

        // Stage 3: Cross-session semantic search (broader scope)
        console.log('📍 [STAGE-3] Cross-session semantic search...');
        broadcastThinkingUpdate(IntentResponses.getThinkingMessage('cross_session_search'), options.sessionId);
        const stage3Result = await handleCrossSessionScope(prompt, { sessionId: options.currentSessionId || options.sessionId });
        if (stage3Result && stage3Result.success) {
          console.log('✅ [CONTEXT-PIPELINE] Stage 3 successful - returning cross-session result');
          
          // Store conversation turn asynchronously
          try {
            await storeTurn(
              { sessionId: options.sessionId, userId: 'user', conversationId: options.conversationId },
              prompt,
              stage3Result.response,
              'stage3_cross_session'
            );
          } catch (error) {
            console.warn('⚠️ [ASYNC-MEMORY] Failed to store turn:', error.message);
          }
          
          return {
            success: true,
            data: stage3Result.response, // NEW pipeline expects response in 'data' field
            pipeline: 'stage3_cross_session',
            timing: { total: Date.now() - startTime }
          };
        }

        // All stages failed - fallback to general knowledge
        console.log('⚠️ [FALLBACK] All context stages failed - using general knowledge');
        broadcastThinkingUpdate(IntentResponses.getThinkingMessage('response_generation'), options.sessionId);
        const fallbackResult = await handleGeneralKnowledge(prompt, { sessionId: options.sessionId }, startTime);
        // Transform fallback response format for NEW pipeline compatibility
        if (fallbackResult && fallbackResult.success && fallbackResult.response) {
          return {
            success: true,
            data: fallbackResult.response, // NEW pipeline expects response in 'data' field
            pipeline: fallbackResult.pipeline,
            timing: fallbackResult.timing
          };
        }
        return fallbackResult;
      }

      // Default fallback
      const fallbackResult = await handleGeneralKnowledge(prompt, { sessionId: options.sessionId }, startTime);
      // Transform fallback response format for NEW pipeline compatibility
      if (fallbackResult && fallbackResult.success && fallbackResult.response) {
        return {
          success: true,
          data: fallbackResult.response, // NEW pipeline expects response in 'data' field
          pipeline: fallbackResult.pipeline,
          timing: fallbackResult.timing
        };
      }
      return fallbackResult;

    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`❌ [NEW-PIPELINE] Critical error after ${totalTime}ms:`, error.message);
      
      return {
        success: false,
        error: error.message,
        pipeline: 'critical_error',
        timing: { total: totalTime }
      };
    }
  });

  // Helper functions for the 3-stage progressive search pipeline

  // Helper function: Semantic similarity calculation
  function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      console.log(`⚠️ [COSINE] Invalid vectors: A=${!!vecA}, B=${!!vecB}, lengthA=${vecA?.length}, lengthB=${vecB?.length}`);
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i];
      const b = vecB[i];
      
      // Check for non-numeric values
      if (typeof a !== 'number' || typeof b !== 'number' || isNaN(a) || isNaN(b)) {
        console.log(`⚠️ [COSINE] Non-numeric values at index ${i}: a=${a} (${typeof a}), b=${b} (${typeof b})`);
        return 0;
      }
      
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      console.log(`⚠️ [COSINE] Zero magnitude vectors: normA=${normA}, normB=${normB}`);
      return 0;
    }
    
    const similarity = dotProduct / denominator;
    console.log(`🔢 [COSINE] Similarity: ${similarity.toFixed(6)} (dot=${dotProduct.toFixed(3)}, normA=${Math.sqrt(normA).toFixed(3)}, normB=${Math.sqrt(normB).toFixed(3)})`);
    return similarity;
  }

  // Helper function: Find semantically relevant recent messages
  async function findRelevantRecentMessages(prompt, recentMessages, coreAgent, limit = 3) {
    try {
      // Generate embedding for the query
      const semanticAgent = coreAgent.getAgent('SemanticEmbeddingAgent');
      if (!semanticAgent) {
        console.warn('⚠️ [SEMANTIC-FILTER] SemanticEmbeddingAgent not available, falling back to recency');
        return recentMessages.slice(-limit).map(msg => ({
          message: msg,
          semanticScore: 0,
          recencyScore: 1,
          combinedScore: 0.3
        }));
      }

      const queryResult = await semanticAgent.execute({
        action: 'generate-embedding',
        text: prompt
      });

      if (!queryResult.success || !queryResult.embedding) {
        console.warn('⚠️ [SEMANTIC-FILTER] Failed to generate query embedding, falling back to recency');
        return recentMessages.slice(-limit).map(msg => ({
          message: msg,
          semanticScore: 0,
          recencyScore: 1,
          combinedScore: 0.3
        }));
      }

      const queryEmbedding = queryResult.embedding;
      console.log('🧠 [SEMANTIC-FILTER] Generated query embedding');

      // Score each message by semantic similarity + recency
      const scoredMessages = recentMessages.map((msg, index) => {
        // Recency score: more recent = higher score
        const recencyScore = (recentMessages.length - index) / recentMessages.length;
        
        // Semantic score: use stored embedding if available
        let semanticScore = 0;
        let messageEmbedding = null;
        
        if (msg.embedding) {
          if (Array.isArray(msg.embedding)) {
            messageEmbedding = msg.embedding;
          } else if (typeof msg.embedding === 'string') {
            // Parse comma-separated string back to array of floats
            try {
              // Check if string starts with array literal format [...]
              let embeddingStr = msg.embedding;
              if (embeddingStr.startsWith('[') && embeddingStr.endsWith(']')) {
                // Remove brackets and parse
                embeddingStr = embeddingStr.slice(1, -1);
              }
              
              messageEmbedding = embeddingStr.split(',').map(x => {
                const val = parseFloat(x.trim());
                return isNaN(val) ? 0 : val; // Replace NaN with 0
              });
              
              console.log(`🔧 [SEMANTIC-FILTER] Parsed string embedding to array (${messageEmbedding.length} dimensions)`);
              
              // Debug: Check first few values
              const firstFew = messageEmbedding.slice(0, 5);
              const hasNaN = messageEmbedding.some(x => isNaN(x));
              const nanCount = messageEmbedding.filter(x => isNaN(x)).length;
              console.log(`🔍 [SEMANTIC-FILTER] First 5 values: [${firstFew.join(', ')}], hasNaN: ${hasNaN}, nanCount: ${nanCount}`);
              
              if (hasNaN) {
                console.log(`🔍 [SEMANTIC-FILTER] Raw embedding string sample: "${msg.embedding.substring(0, 100)}..."`);
              }
            } catch (error) {
              console.warn(`⚠️ [SEMANTIC-FILTER] Failed to parse embedding string:`, error);
            }
          }
          
          if (messageEmbedding && Array.isArray(messageEmbedding) && messageEmbedding.length > 0) {
            semanticScore = cosineSimilarity(queryEmbedding, messageEmbedding);
          }
        }
        
        // Combined score: 70% semantic, 30% recency
        const combinedScore = (semanticScore * 0.7) + (recencyScore * 0.3);
        
        console.log(`📊 [SEMANTIC-FILTER] ${msg.sender}: "${msg.text.substring(0, 30)}..." - Semantic: ${semanticScore.toFixed(3)}, Recency: ${recencyScore.toFixed(3)}, Combined: ${combinedScore.toFixed(3)}`);
        
        return {
          message: msg,
          semanticScore,
          recencyScore,
          combinedScore
        };
      });

      // Sort by combined score and return top N with scores
      const topScoredMessages = scoredMessages
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, limit);

      console.log(`🎯 [SEMANTIC-FILTER] Selected ${topScoredMessages.length} most relevant messages`);
      return topScoredMessages;

    } catch (error) {
      console.error('❌ [SEMANTIC-FILTER] Error in semantic filtering:', error);
      // Return messages in the same format as successful case
      return recentMessages.slice(-limit).map(msg => ({
        message: msg,
        semanticScore: 0,
        recencyScore: 1,
        combinedScore: 0.3
      }));
    }
  }

  // Helper function: Handle current conversation scope (Stage 1)
  async function handleCurrentScope(prompt, context) {
    try {
      const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
      const phi3Agent = coreAgent.getAgent('Phi3Agent');
      
      if (!conversationAgent || !phi3Agent) {
        console.warn('⚠️ [CURRENT-SCOPE] Required agents not available');
        return null;
      }

      // Get recent messages from current session
      const sessionId = context.sessionId;
      console.log(`🔍 [CURRENT-SCOPE] Debug context:`, JSON.stringify(context, null, 2));
      console.log(`🔍 [CURRENT-SCOPE] Session ID from context:`, context.sessionId);
      if (!sessionId) {
        console.warn('⚠️ [CURRENT-SCOPE] No session ID provided');
        return null;
      }
      
      console.log(`🔍 [CURRENT-SCOPE] Using session ID: ${sessionId}`);

      const recentMessages = await conversationAgent.execute({
        action: 'message-list',
        sessionId: sessionId,
        limit: 8,
        offset: 0,
        direction: 'DESC'  // Get most recent messages first
      });

      if (!recentMessages?.success || !recentMessages?.data?.messages?.length) {
        console.warn('⚠️ [CURRENT-SCOPE] No recent messages found');
        console.log('🔍 [CURRENT-SCOPE] Debug - recentMessages result:', JSON.stringify(recentMessages, null, 2));
        return null;
      }
      
      console.log(`✅ [CURRENT-SCOPE] Found ${recentMessages.data.messages.length} recent messages`);
      console.log('🔍 [CURRENT-SCOPE] Raw messages:', recentMessages.data.messages.map(m => `${m.sender}: ${m.text.substring(0, 50)}...`));

      // Intelligent semantic filtering of recent messages
      let filteredMessages = recentMessages.data.messages.filter(msg => {
        // Ensure message object exists and has required properties
        if (!msg || typeof msg !== 'object') return false;
        if (!msg.text || typeof msg.text !== 'string') return false;
        if (!msg.sender || typeof msg.sender !== 'string') return false;
        return msg.text !== prompt;
      });
      console.log('🔍 [CURRENT-SCOPE] After filtering current prompt:', filteredMessages.map(m => `${m.sender}: ${m.text.substring(0, 50)}...`));
      
      // Use semantic similarity to find most relevant messages
      const relevantScoredMessages = await findRelevantRecentMessages(prompt, filteredMessages, coreAgent);
      
      // Check if the best semantic similarity is high enough for Stage 1
      const bestSimilarity = relevantScoredMessages.length > 0 ? relevantScoredMessages[0].semanticScore : 0;
      console.log(`🎯 [CURRENT-SCOPE] Best semantic similarity: ${bestSimilarity.toFixed(3)}`);
      
      // Use semantic classification to detect if query likely needs cross-session search
      const needsCrossSessionSearch = await detectCrossSessionIntent(prompt);
      
      const requiredSimilarity = needsCrossSessionSearch ? 0.65 : 0.35;
      console.log(`🔍 [CURRENT-SCOPE] Query needs cross-session search: ${needsCrossSessionSearch}, required similarity: ${requiredSimilarity}`);
      
      // Lower threshold for context-aware queries since we already know they need context
      const contextAwareThreshold = 0.4; // Much lower threshold for context-aware queries
      
      if (bestSimilarity >= contextAwareThreshold) {
        console.log(`✅ [CURRENT-SCOPE] Found relevant context (similarity: ${bestSimilarity.toFixed(3)} >= ${contextAwareThreshold})`);
        
        // Build context from selected messages
        const selectedMessages = relevantScoredMessages.slice(0, 3);
        const contextText = selectedMessages
          .map(msg => `${msg.message.sender}: ${msg.message.text}`)
          .join('\n');
        
        console.log(`🎯 [CURRENT-SCOPE] Using context:\\n${contextText}`);
        
        return {
          success: true,
          context: contextText,
          messages: selectedMessages,
          source: 'current-conversation',
          similarity: bestSimilarity
        };
      }
      
      console.log(`⚠️ [CURRENT-SCOPE] Semantic similarity ${bestSimilarity.toFixed(3)} below context-aware threshold ${contextAwareThreshold}, will try session scope`);
      return null;
      
    } catch (error) {
      console.error('❌ [CURRENT-SCOPE] Error:', error.message);
      return null;
    }
  }

  // Helper function to clean LLM responses from system prompt contamination
  function cleanLLMResponse(response) {
    if (!response) return response;
    
    // Remove system prompt patterns that leak into responses
    let cleaned = response
      // Remove "You are ThinkDrop AI" system prompts
      .replace(/You are ThinkDrop AI[^.]*\./g, '')
      // Remove "--- End ---" markers
      .replace(/---\s*End\s*---/gi, '')
      // Remove system prompt blocks between markers
      .replace(/<\|system\|>[\s\S]*?<\|end\|>/g, '')
      // Remove any remaining system role indicators
      .replace(/\[SYSTEM\][\s\S]*?\[\/SYSTEM\]/gi, '')
      // Clean up extra whitespace and newlines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
    
    return cleaned;
  }
  // Simple Context: Just use recent messages from current session
  async function handleSimpleContext(prompt, context, coreAgent) {
    try {
      const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
      const phi3Agent = coreAgent.getAgent('Phi3Agent');
      
      if (!conversationAgent || !phi3Agent) {
        console.warn('⚠️ [SIMPLE-CONTEXT] Required agents not available');
        return null;
      }

      console.log('🔍 [SIMPLE-CONTEXT] Getting recent messages...');

      // Get recent messages from current session
      const recentMessages = await conversationAgent.execute({
        action: 'message-list',
        sessionId: context.sessionId,
        limit: 8, // Get more messages for better context
        direction: 'DESC' // Get newest messages first
      }, coreAgent.context);

      if (!recentMessages?.success || !recentMessages?.data?.messages?.length) {
        console.warn('⚠️ [SIMPLE-CONTEXT] No recent messages found');
        return null;
      }

      // Format context messages (keep it simple)
      const contextMessages = recentMessages.data.messages
        .filter(msg => msg && msg.text && msg.sender && msg.text.trim() !== prompt.trim())
        .slice(0, 6) // Use last 6 messages
        .reverse()
        .map(msg => `${msg.sender}: ${msg.text}`)
        .join('\n');

      if (!contextMessages.trim()) {
        console.warn('⚠️ [SIMPLE-CONTEXT] No valid context messages');
        return null;
      }

      console.log(`🎯 [SIMPLE-CONTEXT] Using conversation context (${recentMessages.data.messages.length} messages)`);

      // Generate response using conversation context
      const phiPrompt = `You are ThinkDrop AI. Answer the user's question using the recent conversation context.

RECENT CONVERSATION:
${contextMessages}

CURRENT QUESTION: ${prompt}

INSTRUCTIONS:
1. First, check if the conversation context contains enough information to answer the question
2. If the question refers to numbered items (first, second, third, etc.) and the context discusses a topic but doesn't contain the full sequence, use your general knowledge to provide the specific answer
3. For example, if discussing "miracles in John's Gospel" and asked "what was the second miracle," provide the actual second miracle from John's Gospel even if only the first was mentioned in the conversation
4. Be specific and informative, connecting the answer to the conversation topic

Answer the question directly and helpfully:`;

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: phiPrompt,
        options: { timeout: 6000, maxTokens: 150, temperature: 0.2 }
      });

      if (result.success && result.response) {
        const cleanedResponse = cleanLLMResponse(result.response);
        console.log('✅ [SIMPLE-CONTEXT] Generated response using recent messages');
        return { 
          success: true, 
          response: cleanedResponse,
          source: 'simple-context'
        };
      }

      return null;

    } catch (error) {
      console.error('❌ [SIMPLE-CONTEXT] Error:', error.message);
      return null;
    }
  }
  async function evaluateContextSufficiency(prompt, contextMessages, response, phi3Agent, sessionId = null) {
    try {
      // Notify user that we're evaluating context sufficiency
      if (sessionId) {
        const thinkingMessage = IntentResponses.getThinkingMessage('context_evaluation');
        broadcastThinkingUpdate(thinkingMessage, sessionId);
      }
      
      const evaluationPrompt = `You are evaluating if a response adequately answers a user's question. Be STRICT in your evaluation.

CONVERSATION CONTEXT:
${contextMessages}

USER QUESTION: ${prompt}

AI RESPONSE: ${response}

EVALUATION TASK:
Determine if the AI response directly and relevantly answers the user's specific question.

KEY CHECKS:
1. TOPIC MATCH: Does the response address the same topic as the question?
2. DIRECT ANSWER: Does the response provide the specific information requested?
3. RELEVANCE: Is the response about what the user actually asked?

MARK AS INSUFFICIENT IF:
- Response talks about a completely different topic than the question
- Response references unrelated previous conversations instead of answering
- Response is vague, deflects, or says "I don't know"
- Follow-up questions where only partial info exists (e.g., asking "second" when only "first" discussed)
- Response doesn't match the question's intent or subject matter

MARK AS SUFFICIENT IF:
- Response directly answers the specific question asked
- Response provides relevant information on the correct topic
- Response addresses what the user is actually seeking

EXAMPLE:
Question: "what was the second miracle?"
Bad Response: "The second message I mentioned was about presidents" → INSUFFICIENT (wrong topic)
Good Response: "The second miracle was healing the official's son" → SUFFICIENT (correct topic)

Respond with ONLY: "INSUFFICIENT" or "SUFFICIENT"`;

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: evaluationPrompt,
        options: { timeout: 4000, maxTokens: 15, temperature: 0.1 }
      });

      if (result.success && result.response) {
        const evaluation = result.response.trim().toUpperCase();
        const isInsufficient = evaluation.includes('INSUFFICIENT');
        
        console.log(`🔍 [CONTEXT-EVALUATION] Question: "${prompt.substring(0, 50)}..."`);
        console.log(`🔍 [CONTEXT-EVALUATION] Response: "${response.substring(0, 80)}..."`);
        console.log(`🔍 [CONTEXT-EVALUATION] Evaluation: ${evaluation} -> ${isInsufficient ? 'NEEDS FALLBACK' : 'CONTEXT OK'}`);
        
        return isInsufficient;
      }

      // Fallback to basic heuristics if LLM evaluation fails
      console.warn('⚠️ [CONTEXT-EVALUATION] LLM evaluation failed, using basic heuristics');
      return (
        response.toLowerCase().includes('no information') ||
        response.toLowerCase().includes('cannot determine') ||
        response.toLowerCase().includes('not discussed')
      );

    } catch (error) {
      console.error('❌ [CONTEXT-EVALUATION] Error:', error.message);
      // Conservative fallback - assume context is sufficient to avoid unnecessary fallbacks
      return false;
    }
  }

  // Knowledge fallback for contextual questions that need external knowledge
  async function attemptKnowledgeFallback(prompt, contextHistory, phi3Agent) {
    try {
      console.log('🔄 [KNOWLEDGE-FALLBACK] Attempting hybrid context+knowledge response...');
      
      // Extract context from conversation to understand what topic we're discussing
      const contextAnalysisPrompt = `Based on this conversation context, what topic or subject is being discussed?

CONVERSATION CONTEXT:
${contextHistory}

CURRENT QUESTION: ${prompt}

Identify the main topic/subject being discussed (e.g., "Gospel of John miracles", "React programming", "cooking recipes", etc.). Respond with just the topic in 2-4 words.`;

      const topicResult = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: contextAnalysisPrompt,
        options: { timeout: 3000, maxTokens: 20, temperature: 0.1 }
      });

      let topic = 'the topic';
      if (topicResult.success && topicResult.response) {
        topic = topicResult.response.trim().toLowerCase();
        console.log(`🔍 [KNOWLEDGE-FALLBACK] Identified topic: "${topic}"`);
      }

      // Generate response using both context and general knowledge
      const hybridPrompt = `You are ThinkDrop AI. Answer this question using both the conversation context and your general knowledge.

CONVERSATION CONTEXT:
${contextHistory}

CURRENT QUESTION: ${prompt}

ANALYSIS:
The conversation shows we've been discussing ${topic}. The user is asking "${prompt}" which appears to be a follow-up question referencing a numbered item from our discussion.

INSTRUCTIONS:
1. Look at the conversation context to understand what topic we were discussing
2. If the question contains numbered references (first, second, third, fourth, etc.), connect it to the topic
3. Use your knowledge about ${topic} to provide the specific information requested
4. For example: if discussing "miracles in John's Gospel" and asked "what was the fourth one", provide the fourth miracle from John's Gospel

Answer directly and specifically, using your knowledge to provide the requested information while acknowledging the conversation context.`;

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: hybridPrompt,
        options: { timeout: 8000, maxTokens: 200, temperature: 0.3 }
      });

      if (result.success && result.response) {
        console.log('✅ [KNOWLEDGE-FALLBACK] Generated hybrid response');
        return { 
          success: true, 
          response: cleanLLMResponse(result.response),
          source: 'hybrid-context-knowledge'
        };
      }

      return null;
    } catch (error) {
      console.error('❌ [KNOWLEDGE-FALLBACK] Error:', error.message);
      return null;
    }
  }

  // Stage 2: Session-scoped semantic search
  async function handleSessionScope(prompt, context) {
    try {
      const userMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
      const phi3Agent = coreAgent.getAgent('Phi3Agent');
      
      if (!userMemoryAgent || !phi3Agent) {
        console.warn('⚠️ [SESSION-SCOPE] Required agents not available');
        return null;
      }

      // Send thinking indicator update
      broadcastThinkingUpdate("Checking other conversations", context.sessionId);

      // Perform cross-session semantic search (no sessionId filter for broader scope)
      console.log('🔍 [SESSION-SCOPE] Searching across all sessions...');
      const searchResult = await userMemoryAgent.execute({
        action: 'memory-semantic-search',
        query: prompt,
        limit: 30,
        minSimilarity: 0.12
        // No sessionId - search across all sessions
      }, {
        database: coreAgent.context?.database || coreAgent.database,
        embedder: coreAgent.getAgent('SemanticEmbeddingAgent'),
        executeAgent: (agentName, action, context) => coreAgent.executeAgent(agentName, action, context)
      });

      // Handle both memory results and conversation message results
      let contextData = null;
      let contextType = 'unknown';

      if (searchResult?.success) {
        // Safe logging without BigInt serialization issues
        console.log(`🔍 [SESSION-SCOPE] Search result keys:`, Object.keys(searchResult));
        if (searchResult.results) {
          console.log(`🔍 [SESSION-SCOPE] Direct results count:`, searchResult.results.length);
        }
        if (searchResult.result) {
          console.log(`🔍 [SESSION-SCOPE] Result object keys:`, Object.keys(searchResult.result));
        }
        
        // Check for conversation messages (from logs: "Found 20 conversation messages")
        if (searchResult.result?.conversationMessages?.length) {
          contextData = searchResult.result.conversationMessages;
          contextType = 'conversation';
          console.log(`✅ [SESSION-SCOPE] Found ${contextData.length} conversation messages across sessions`);
        }
        // Check for memory results
        else if (searchResult.result?.results?.length) {
          contextData = searchResult.result.results;
          contextType = 'memory';
          console.log(`✅ [SESSION-SCOPE] Found ${contextData.length} memory results across sessions`);
        }
        // Check for direct results array (alternative structure)
        else if (searchResult.results?.length) {
          contextData = searchResult.results;
          contextType = 'conversation';
          console.log(`✅ [SESSION-SCOPE] Found ${contextData.length} messages in direct results`);
        }
        // Check for any other data structures
        else {
          console.log(`⚠️ [SESSION-SCOPE] Unknown result structure, keys:`, Object.keys(searchResult));
          if (searchResult.result) {
            console.log(`⚠️ [SESSION-SCOPE] Result object keys:`, Object.keys(searchResult.result));
          }
        }
      }

      if (!contextData?.length) {
        console.warn('⚠️ [SESSION-SCOPE] No relevant context found');
        return null;
      }

      // Build context snippets based on type
      let contextSnippets;
      if (contextType === 'conversation') {
        // Prioritize current session messages, then other sessions
        const currentSessionId = context.sessionId;
        // Sort all messages by similarity score and take the most relevant ones
        const sortedByRelevance = contextData.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        
        // Take top 8 most relevant messages regardless of session
        const prioritizedMessages = sortedByRelevance.slice(0, 8);
        
        // Validate messages have required fields
        const validMessages = prioritizedMessages.filter(msg => {
          const hasText = msg.text && msg.text.trim().length > 0;
          const hasSender = msg.sender && (msg.sender === 'user' || msg.sender === 'ai' || msg.sender === 'assistant');
          if (!hasText || !hasSender) {
            console.warn(`⚠️ [SESSION-SCOPE] Skipping invalid message: text="${msg.text}", sender="${msg.sender}"`);
            return false;
          }
          return true;
        });
        
        if (validMessages.length === 0) {
          console.warn('⚠️ [SESSION-SCOPE] No valid messages after filtering');
          return null;
        }
        
        contextSnippets = validMessages.map((msg, i) => {
          const sender = msg.sender === 'user' ? 'You' : 'AI';
          const text = (msg.text || '').trim().slice(0, 150);
          const isCurrentSession = msg.session_id === currentSessionId;
          const prefix = isCurrentSession ? 'Recent' : 'Previous';
          const sessionInfo = msg.session_title ? ` [${msg.session_title}]` : '';
          return `${prefix}${sessionInfo} - ${sender}: ${text}${(msg.text || '').length > 150 ? '...' : ''}`;
        });
        
        console.log(`🔍 [SESSION-SCOPE] Using ${validMessages.length} valid messages (filtered from ${prioritizedMessages.length})`);
        console.log(`[DEBUG] [SESSION-SCOPE] Context snippets being sent to LLM:`);
        contextSnippets.forEach((snippet, i) => {
          console.log(`  ${i + 1}: ${snippet.substring(0, 100)}...`);
        });
      } else {
        // Memory format
        const topSimilarity = contextData[0].similarity;
        console.log(`[DEBUG] [SESSION-SCOPE] Top similarity: ${topSimilarity.toFixed(4)}, threshold: 0.12`);
        if (topSimilarity < 0.12) {
          console.warn('⚠️ [SESSION-SCOPE] Similarity too low');
          return null;
        }
        contextSnippets = contextData.slice(0, 5).map((m, i) => {
          const text = (m.source_text || '').slice(0, 300);
          const sessionInfo = m.sessionTitle ? ` [${m.sessionTitle}]` : '';
          return `Memory ${i + 1} (${Math.round((m.similarity || 0) * 100)}%)${sessionInfo}: ${text}${(m.source_text || '').length > 300 ? '...' : ''}`;
        });
        
        console.log(`[DEBUG] [SESSION-SCOPE] Context snippets being sent to LLM:`);
        contextSnippets.forEach((snippet, i) => {
          console.log(`  ${i + 1}: ${snippet.substring(0, 100)}...`);
        });
      }

      // Validate context snippets before sending to LLM
      if (!contextSnippets || contextSnippets.length === 0) {
        console.warn('⚠️ [SESSION-SCOPE] No context snippets to send to LLM');
        return null;
      }

      // Filter out empty or invalid snippets
      const validSnippets = contextSnippets.filter(snippet => 
        snippet && typeof snippet === 'string' && snippet.trim().length > 0
      );

      if (validSnippets.length === 0) {
        console.warn('⚠️ [SESSION-SCOPE] No valid context snippets after filtering');
        return null;
      }

      const contextHistory = validSnippets.join('\n\n');
      console.log(`[DEBUG] [SESSION-SCOPE] Final context history length: ${contextHistory.length} chars`);

      // Generate response using context
      const phiPrompt = `Based ONLY on the conversation history provided below, answer the question. Reference which conversation/session the topic was discussed in if found.

CONVERSATION HISTORY:
${contextHistory}

QUESTION: ${prompt}

Answer in 1-2 sentences using ONLY the information from the conversation history above. If you find the topic in the history, mention when/where it was discussed. Do not make up or invent any conversations that are not shown.`;

      console.log(`[DEBUG] [SESSION-SCOPE] Sending prompt to LLM (${phiPrompt.length} chars)`);
      
      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: phiPrompt,
        options: { timeout: 5000, maxTokens: 120, temperature: 0.2 }
      });

      console.log(`[DEBUG] [SESSION-SCOPE] LLM result:`, {
        success: result.success,
        responseLength: result.response ? result.response.length : 0,
        response: result.response ? result.response.substring(0, 200) + '...' : 'null'
      });

      if (result.success && result.response) {
        const cleanedResponse = cleanLLMResponse(result.response);
        console.log(`[DEBUG] [SESSION-SCOPE] Cleaned response: "${cleanedResponse}"`);
        
        // Use semantic analysis to determine if context is insufficient
        const hasInsufficientContext = await evaluateContextSufficiency(
          prompt, 
          contextHistory, 
          cleanedResponse, 
          phi3Agent,
          context.sessionId
        );
        
        if (hasInsufficientContext) {
          console.warn(`⚠️ [SESSION-SCOPE] Insufficient context detected - attempting knowledge fallback`);
          console.warn(`⚠️ [SESSION-SCOPE] Context preview: ${contextHistory.substring(0, 300)}...`);
          
          // Try knowledge fallback for contextual questions that need external knowledge
          const knowledgeFallback = await attemptKnowledgeFallback(prompt, contextHistory, phi3Agent);
          if (knowledgeFallback?.success) {
            console.log('✅ [SESSION-SCOPE] Knowledge fallback successful');
            return knowledgeFallback;
          }
        }
        
        return { success: true, response: cleanedResponse };
      }

      console.warn('⚠️ [SESSION-SCOPE] LLM execution failed or returned empty response');
      return null;

    } catch (error) {
      console.error('❌ [SESSION-SCOPE] Error:', error.message);
      return null;
    }
  }

  // Stage 3: Cross-session semantic search with current session prioritization
  async function handleCrossSessionScope(prompt, context) {
    try {
      console.log('🔍 [CROSS-SESSION-SCOPE] Processing cross-session query...');
      broadcastThinkingUpdate(IntentResponses.getThinkingMessage('cross_session_search'), context.sessionId);
      
      const userMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
      const phi3Agent = coreAgent.getAgent('Phi3Agent');
      
      if (!userMemoryAgent || !phi3Agent) {
        console.warn('⚠️ [CROSS-SESSION] Required agents not available');
        return null;
      }

      // Perform cross-session semantic search (no sessionId filter)
      const searchResult = await userMemoryAgent.execute({
        action: 'memory-semantic-search',
        query: prompt,
        limit: 60,
        minSimilarity: 0.12
      }, {
        database: coreAgent.context?.database || coreAgent.database,
        executeAgent: (agentName, action, context) => coreAgent.executeAgent(agentName, action, context)
      });

      if (!searchResult?.success) {
        console.warn('⚠️ [CROSS-SESSION] Search failed');
        return null;
      }

      // Handle both memory results and conversation message results
      let contextItems = [];
      if (searchResult.result?.results?.length) {
        // Memory results with similarity scores
        const memories = searchResult.result.results;
        const topSimilarity = memories[0].similarity;
        
        // Check if similarity is sufficient for cross-session
        if (topSimilarity < 0.34) {
          console.warn('⚠️ [CROSS-SESSION] Similarity too low');
          return null;
        }

        contextItems = memories.slice(0, 3).map((m, i) => {
          const text = (m.source_text || '').slice(0, 220);
          return `Memory ${i + 1} (${Math.round((m.similarity || 0) * 100)}%): ${text}${(m.source_text || '').length > 220 ? '...' : ''}`;
        });
      } else if (searchResult.results?.length) {
        // Conversation message results - prioritize current session
        console.log(`✅ [CROSS-SESSION] Found ${searchResult.results.length} conversation messages`);
        
        const currentSessionId = context.sessionId;
        const currentSessionMessages = searchResult.results.filter(msg => msg.session_id === currentSessionId);
        const otherMessages = searchResult.results.filter(msg => msg.session_id !== currentSessionId);
        
        // Use current session messages first, then fill with other recent messages
        const prioritizedMessages = [
          ...currentSessionMessages.slice(-3), // Last 3 from current session
          ...otherMessages.slice(0, 2) // Top 2 from other sessions
        ].slice(0, 5);
        
        contextItems = prioritizedMessages.map((msg, i) => {
          const sender = msg.sender === 'user' ? 'You' : 'AI';
          const text = (msg.text || '').slice(0, 200);
          const isCurrentSession = msg.session_id === currentSessionId;
          const prefix = isCurrentSession ? 'Recent' : 'Previous';
          return `${prefix} - ${sender}: ${text}${(msg.text || '').length > 200 ? '...' : ''}`;
        });
      } else {
        console.warn('⚠️ [CROSS-SESSION] No relevant memories or messages found');
        return null;
      }

      // Generate response using cross-session context
      const phiPrompt = `Based ONLY on the conversation history provided below, answer the question. Reference which conversation/session the topic was discussed in if found.

CONVERSATION HISTORY:
${contextItems.join('\n\n')}

QUESTION: ${prompt}

Answer in 1-2 sentences using ONLY the information from the conversation history above. If you find the topic in the history, mention when/where it was discussed. Do not make up or invent any conversations that are not shown.`;

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: phiPrompt,
        options: { timeout: 5000, maxTokens: 120, temperature: 0.2 }
      });

      if (result.success && result.response) {
        const cleanedResponse = cleanLLMResponse(result.response);
        return { success: true, response: cleanedResponse };
      }

      return null;

    } catch (error) {
      console.error('❌ [CROSS-SESSION] Error:', error.message);
      return null;
    }
  }

  // Hybrid classification: zero-shot primary + keyword confidence boosting + context awareness
  async function classifyQuery(prompt, context) {
    try {
      const queryLower = prompt.toLowerCase().trim();
      
      // Stage 1: Primary zero-shot classification
      console.log('🧠 [CLASSIFICATION] Using zero-shot classification...');
      const zeroShotResult = await classifyWithZeroShot(prompt);
      
      if (zeroShotResult && zeroShotResult.confidence > 0.7) {
        // High confidence zero-shot result, use it directly
        console.log(`✅ [CLASSIFICATION] High confidence zero-shot: ${zeroShotResult.classification} (${zeroShotResult.confidence.toFixed(3)})`);
        return zeroShotResult;
      }
      
      // Stage 1.5: For low confidence classifications, check if we need conversation context
      if (zeroShotResult && zeroShotResult.confidence < 0.5 && context?.sessionId) {
        console.log(`🔍 [CLASSIFICATION] Medium-low confidence (${zeroShotResult.confidence.toFixed(3)}), checking conversation context...`);
        const contextAwareResult = await classifyWithConversationContext(prompt, context, zeroShotResult);
        if (contextAwareResult) {
          return contextAwareResult;
        }
      }
      
      // Stage 2: For lower confidence, check if keywords can boost confidence
      const keywords = {
        CONTEXT: [
          'what did i', 'what did you', 'what were we', 'earlier you', 'earlier i',
          'before you', 'before i', 'previous', 'recap', 'summarize our',
          'tell me what i said', 'remind me what', 'what was our'
        ],
        MEMORY: [
          // Memory retrieval patterns
          'do i have', 'am i', 'did i', 'have i', 'was i', 'will i',
          'my meeting', 'my appointment', 'my schedule', 'my calendar',
          'tell me about', 'what about', 'remind me', 'check if',
          'meeting tomorrow', 'meeting today', 'appointment tomorrow',
          'scheduled for', 'planned for', 'working on', 'project with',
          // Conversational memory patterns
          'have we', 'did we', 'have you', 'did you', 'we talked', 'we discussed',
          'we chatted', 'we mentioned', 'you mentioned', 'i mentioned',
          'talked about', 'discussed about', 'chatted about', 'mentioned about',
          'conversation about', 'discussion about', 'chat about'
        ],
        COMMAND: [
          'write a', 'write me', 'create a', 'create me', 'generate a',
          'generate me', 'build a', 'build me', 'make a', 'make me',
          'code a', 'draft a', 'compose a', 'design a', 'develop a'
        ]
      };

      // Check if keywords align with zero-shot prediction
      let keywordMatch = null;
      for (const [category, keywordList] of Object.entries(keywords)) {
        for (const keyword of keywordList) {
          if (queryLower.includes(keyword)) {
            keywordMatch = category;
            console.log(`🎯 [KEYWORD-BOOST] Found keyword "${keyword}" -> ${category}`);
            break;
          }
        }
        if (keywordMatch) break;
      }

      if (keywordMatch && zeroShotResult && keywordMatch === zeroShotResult.classification) {
        // Keywords align with zero-shot, boost confidence
        console.log(`🚀 [CLASSIFICATION] Keyword-boosted confidence: ${zeroShotResult.classification}`);
        return { ...zeroShotResult, confidence: Math.min(0.95, zeroShotResult.confidence + 0.2) };
      } else if (keywordMatch && zeroShotResult && zeroShotResult.confidence < 0.5) {
        // Low confidence zero-shot, strong keyword match - use keyword
        console.log(`🎯 [CLASSIFICATION] Low confidence zero-shot (${zeroShotResult.confidence.toFixed(3)}), using keyword: ${keywordMatch}`);
        return { classification: keywordMatch, confidence: 0.8 };
      } else if (zeroShotResult) {
        // Check if this looks like a knowledge question that was misclassified
        const knowledgePatterns = [
          /^(is|are|what|how|why|when|where|which|can|does|do|will|would)\s+/i,
          /\b(only|best|better|different|alternative|option|language|technology|framework)\b/i,
          /\?\s*$/
        ];
        
        const looksLikeKnowledge = knowledgePatterns.some(pattern => pattern.test(prompt));
        
        if (looksLikeKnowledge && zeroShotResult.classification === 'COMMAND' && zeroShotResult.confidence < 0.4) {
          console.log(`🔄 [CLASSIFICATION] Knowledge question misclassified as COMMAND, correcting to GENERAL`);
          return { classification: 'GENERAL', confidence: 0.7 };
        }
        
        // Use zero-shot result even with moderate confidence
        console.log(`🧠 [CLASSIFICATION] Using zero-shot: ${zeroShotResult.classification} (${zeroShotResult.confidence.toFixed(3)})`);
        return zeroShotResult;
      }

      // Stage 3: Fallback to heuristics
      console.log('🔄 [CLASSIFICATION] Falling back to heuristics...');
      return classifyWithHeuristics(prompt);
      
    } catch (error) {
      console.error('❌ [ROUTING] Classification error:', error.message);
      return { classification: 'GENERAL' };
    }
  }

  // Context-aware classification for ambiguous queries
  async function classifyWithConversationContext(prompt, context, fallbackResult) {
    try {
      console.log(`🔍 [CONTEXT-AWARE] Starting context-aware classification for: "${prompt}"`);
      console.log(`🔍 [CONTEXT-AWARE] Fallback result: ${fallbackResult.classification} (${fallbackResult.confidence.toFixed(3)})`);
      
      const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
      if (!conversationAgent) {
        console.log('❌ [CONTEXT-AWARE] No ConversationSessionAgent available');
        return null;
      }

      // Get recent messages from current session for context
      console.log(`📋 [CONTEXT-AWARE] Fetching messages for session: ${context.sessionId}`);
      const recentMessages = await conversationAgent.execute({
        action: 'message-list',
        sessionId: context.sessionId,
        limit: 8,
        offset: 0,
        direction: 'DESC'
      });

      console.log(`📨 [CONTEXT-AWARE] Retrieved ${recentMessages?.data?.messages?.length || 0} messages`);
      if (!recentMessages?.success || !recentMessages?.data?.messages?.length) {
        console.log('❌ [CONTEXT-AWARE] No messages retrieved');
        return null;
      }

      // Filter and format context messages, excluding noise messages
      const contextMessages = recentMessages.data.messages
        .filter(msg => {
          // Ensure message object exists and has required properties
          if (!msg || typeof msg !== 'object') return false;
          if (!msg.text || typeof msg.text !== 'string' || msg.text.trim() === '') return false;
          if (!msg.sender || typeof msg.sender !== 'string') return false;
          if (msg.text.trim() === prompt.trim()) return false;
          
          // Filter out generic system messages that add noise to classification
          const isNoiseMessage = /Information stored successfully|I don't have|I cannot|Sorry, I/i.test(msg.text.trim());
          return !isNoiseMessage;
        })
        .slice(0, 4)
        .reverse()
        .map(msg => `${msg.sender}: ${msg.text}`)
        .join('\n');

      console.log(`💬 [CONTEXT-AWARE] Context messages built (${contextMessages.split('\n').length} lines):`);
      console.log(contextMessages);

      if (!contextMessages.trim()) {
        console.log('❌ [CONTEXT-AWARE] No context messages after filtering');
        return null;
      }

      // Use zero-shot classification with conversation context
      if (!global.zeroShotClassifier) {
        const { pipeline } = await import('@xenova/transformers');
        global.zeroShotClassifier = await pipeline(
          'zero-shot-classification',
          'Xenova/distilbert-base-uncased-mnli'
        );
      }

      const contextualPrompt = `Recent conversation:
${contextMessages}

Current question: ${prompt}`;

      const candidateLabels = [
        'asking about previous conversations, messages, or what was discussed before',
        'wanting to remember, store, or save information for later',
        'requesting to write, create, generate, or build something',
        'asking a general question that needs a direct answer'
      ];

      const result = await global.zeroShotClassifier(contextualPrompt, candidateLabels);
      
      if (result && result.labels && result.scores) {
        const topLabel = result.labels[0];
        const topScore = result.scores[0];
        
        const labelMap = {
          'asking about previous conversations, messages, or what was discussed before': 'CONTEXT',
          'wanting to remember, store, or save information for later': 'MEMORY',
          'requesting to write, create, generate, or build something': 'COMMAND',
          'asking a general question that needs a direct answer': 'GENERAL'
        };
        
        const classification = labelMap[topLabel] || 'GENERAL';
        
        console.log(`📊 [CONTEXT-AWARE] Classification: ${classification}, confidence: ${topScore.toFixed(3)}`);
        const confidenceImprovement = result.scores[0] - fallbackResult.confidence;
        console.log(`📈 [CONTEXT-AWARE] Improvement needed varies by type, achieved: +${confidenceImprovement.toFixed(3)}`);
        
        // Enhanced acceptance criteria with pronoun detection and context hints
        const hasPronounReference = /\b(they|them|their|it|its|this|that|these|those)\b/i.test(prompt);
        const hasContextualWords = /\b(also|too|additionally|furthermore|moreover|what about|how about)\b/i.test(prompt);
        const isFollowUpQuestion = hasPronounReference || hasContextualWords;
        
        console.log(`🔍 [CONTEXT-AWARE] Pronoun reference: ${hasPronounReference}`);
        console.log(`🔍 [CONTEXT-AWARE] Contextual words: ${hasContextualWords}`);
        console.log(`🔍 [CONTEXT-AWARE] Follow-up question: ${isFollowUpQuestion}`);
        
        // Check for cross-session query patterns
        const isCrossSessionQuery = /\b(when did we|have we|did we|we discussed|we talked|we chatted|before|previously|earlier|past|any.*we|what.*we.*discuss|tell me about.*our)\b/i.test(prompt);
        
        // Determine acceptance criteria:
        // 1. Query is a follow-up question (pronouns/contextual words) - force CONTEXT classification
        // 2. Cross-session query patterns - force CONTEXT classification
        // 3. Context-aware result is CONTEXT with reasonable confidence (>0.25 for cross-session, >0.30 for others)
        // 4. Non-CONTEXT with significant improvement (+0.15) to avoid noise
        const contextThreshold = isCrossSessionQuery ? 0.25 : 0.30;
        const shouldAccept = (isFollowUpQuestion) ||
                            (isCrossSessionQuery) ||
                            (classification === 'CONTEXT' && result.scores[0] > contextThreshold) ||
                            (classification !== 'CONTEXT' && confidenceImprovement >= 0.15);
        
        // Override classification for follow-up questions
        let finalClassification = classification;
        let finalConfidence = topScore;
        
        if ((isFollowUpQuestion || isCrossSessionQuery) && classification !== 'CONTEXT') {
          console.log(`🔄 [CONTEXT-AWARE] Overriding ${classification} -> CONTEXT for ${isCrossSessionQuery ? 'cross-session query' : 'follow-up question'}`);
          finalClassification = 'CONTEXT';
          finalConfidence = Math.max(0.75, topScore); // Boost confidence for context queries
        }
        
        console.log(`🎯 [CONTEXT-AWARE] Acceptance criteria:`);
        console.log(`  - Follow-up question: ${isFollowUpQuestion ? '✅' : '❌'}`);
        console.log(`  - Cross-session query: ${isCrossSessionQuery ? '✅' : '❌'}`);
        console.log(`  - CONTEXT >${contextThreshold}: ${classification === 'CONTEXT' && result.scores[0] > contextThreshold ? '✅' : '❌'}`);
        console.log(`  - Non-CONTEXT +0.15: ${classification !== 'CONTEXT' && confidenceImprovement >= 0.15 ? '✅' : '❌'}`);
        
        if (shouldAccept) {
          console.log(`🧠 [CONTEXT-AWARE] "${prompt}" -> ${finalClassification} (confidence: ${finalConfidence.toFixed(3)}, improved from ${fallbackResult.confidence.toFixed(3)})`);
          return { classification: finalClassification, confidence: finalConfidence };
        } else {
          console.log(`⚠️ [CONTEXT-AWARE] Rejected: ${classification} classification doesn't meet criteria`);
        }
      }
      
      return null;
    } catch (error) {
      console.error('❌ [CONTEXT-AWARE] Error:', error.message);
      return null;
    }
  }

  // Semantic detection for cross-session intent
  async function detectCrossSessionIntent(prompt) {
    try {
      // Initialize zero-shot classifier if not already done
      if (!global.zeroShotClassifier) {
        const { pipeline } = await import('@xenova/transformers');
        global.zeroShotClassifier = await pipeline(
          'zero-shot-classification',
          'Xenova/distilbert-base-uncased-mnli'
        );
      }
      
      const candidateLabels = [
        'asking about something mentioned or discussed in previous conversations',
        'asking about current conversation or recent messages only'
      ];
      
      const result = await global.zeroShotClassifier(prompt, candidateLabels);
      
      if (result && result.labels && result.scores) {
        const topLabel = result.labels[0];
        const topScore = result.scores[0];
        const needsCrossSession = topLabel.includes('previous conversations') && topScore > 0.6;
        
        console.log(`🧠 [CROSS-SESSION-DETECT] "${prompt}" -> ${needsCrossSession ? 'CROSS-SESSION' : 'CURRENT'} (confidence: ${topScore.toFixed(3)})`);
        return needsCrossSession;
      }
      
      return false;
    } catch (error) {
      console.error('❌ [CROSS-SESSION-DETECT] Error:', error.message);
      // Fallback to conservative approach - assume current session only
      return false;
    }
  }

  // Robust heuristic gates with high precision patterns
  function heuristicVote(prompt) {
    const p = prompt.trim().toLowerCase();
    
    // MEMORY: requires explicit storage verb + object cue (high precision)
    const hasStorageVerb = /\b(remember|save|store|note|bookmark|log|keep)\b/i.test(p);
    const hasMemoryObject = /\b(this|that|it|for later|to memory|in mind)\b/i.test(p);
    const isContextQuestion = /\b(do you remember|remember what (you|we|i) said)\b/i.test(p);
    
    if (hasStorageVerb && hasMemoryObject && !isContextQuestion) {
      return { label: 'MEMORY', score: 0.9, reason: 'explicit-storage' };
    }

    const isQuestion = /[?]/.test(p) || /\b(what|when|where|who|how|why)\b/.test(p);

    // Enhanced conversational memory patterns for better detection
    const hasConversationalMemoryRef = (
      /\b(have\s+we|did\s+we|have\s+you|did\s+you)\b.*\b(talk|discuss|chat|mention|cover)\b/i.test(p) ||
      /\b(we\s+talked|we\s+discussed|we\s+chatted|we\s+mentioned)\b/i.test(p) ||
      /\b(talked\s+about|discussed\s+about|chatted\s+about|mentioned\s+about)\b/i.test(p) ||
      /\b(conversation\s+about|discussion\s+about|chat\s+about)\b/i.test(p)
    );

    // CONTEXT: references to prior conversation (check before MEMORY patterns)
    const hasPriorConvoRef = (
      /\b(what|when|where|who|how)\s+(did|was|were|have)\s+(we|you|i)\b/i.test(p) ||
      /\b(earlier|before|previously|yesterday|last time|ago)\b/i.test(p) ||
      /\b(previous|prior|recent)\s+(conversation|discussion|chat|message|question|topic)\b/i.test(p) ||
      /\b(repeat|again)\b/i.test(p) ||
      /\bmy\s+(previous|prior|last)\s+(question|message)\b/i.test(p) ||
      // Implicit conversation references
      /\bwe\s+(talked|discussed|decided|concluded|picked|chose)\b/i.test(p) ||
      /\b(do\s+you\s+remember|remember\s+(what|when|where|who|how))\b/i.test(p) ||
      /\b(which\s+(option|choice|steps?)\s+(did\s+we|you\s+gave?))\b/i.test(p) ||
      /\b(what\s+did\s+i\s+say|tell\s+me\s+what\s+i\s+asked)\b/i.test(p) ||
      /\b(remind\s+me\s+what\s+we|recap\s+what\s+we|paste\s+the\s+steps)\b/i.test(p) ||
      /\bin\s+this\s+(thread|chat|conversation)\b/i.test(p) ||
      /\b(last\s+time\s+here|at\s+the\s+start\s+of\s+this)\b/i.test(p) ||
      /\bi\s+wish\s+we\s+(had|chose|picked|decided|chosen)\b/i.test(p) ||
      // Common conversational follow-ups
      /\b(was\s+there\s+any\s+other|were\s+there\s+any\s+other|any\s+other|what\s+about\s+other)\b/i.test(p) ||
      /\b(regarding|about|concerning)\s+\w+/i.test(p) ||
      /\b(what\s+was\s+the\s+(first|second|third|fourth|fifth|next|last))\b/i.test(p) ||
      /\b(the\s+(first|second|third|fourth|fifth|next|last)\s+one)\b/i.test(p)
    );
    const hasConversationQuery = /\b(what (did|was)|repeat|again)\b/i.test(p);
    
    // Check for conversational memory patterns first (higher priority)
    if (hasConversationalMemoryRef && isQuestion) {
      return { label: 'MEMORY', score: 0.85, reason: 'conversational-memory-query' };
    }

    // Exclude hypothetical/future queries to reduce false positives
    const isHypothetical = /\b(should|could|would|might|if|suppose|imagine|what if)\b/i.test(p);
    const isFutureOriented = /\b(will|shall|going to|next|future|plan to|want to)\b/i.test(p);
    
    if ((hasPriorConvoRef || hasConversationQuery) && (isQuestion || /\bi\s+wish\s+we\b/i.test(p)) && !isHypothetical && !isFutureOriented) {
      return { label: 'CONTEXT', score: 0.8, reason: 'prior-convo-question' };
    }

    // Strong MEMORY patterns for personal data retrieval (check after CONTEXT)
    const hasPersonalInfoQuery = (
      /\b(what|when|where|who|how)\s+(is|are|was|were)\s+my\b/i.test(p) ||
      /\bmy\s+(favorite|best|preferred|phone|address|email|birthday|age|style|type|preference|meeting|appointment|class|network|contact|license|deadline)\b/i.test(p) ||
      /\b(do\s+i\s+have|am\s+i|is\s+my)\b/i.test(p) ||
      /\bwhat\s+(is|are)\s+my\s+(learning|communication|personality|work)\s+(style|type|preference)\b/i.test(p) ||
      /\b(what('s|s)?\s+my\s+(favorite|preferred|best))\b/i.test(p) ||
      // Personal settings and preferences
      /\b(which|what)\s+\w+\s+do\s+i\s+(use|prefer|keep|have)\b/i.test(p) ||
      // More specific "which X do I use" patterns
      /\bwhich\s+(keyboard|layout|tool|app|software|browser|editor)\s+do\s+i\s+use\b/i.test(p) ||
      /\bwhich\s+keyboard\s+layout\s+do\s+i\s+use\b/i.test(p) ||
      // "Do I usually/normally/typically" patterns
      /\bdo\s+i\s+(usually|normally|typically|often)\b/i.test(p) ||
      // "Help me remember" + personal info
      /\bhelp\s+me\s+remember.*\bmy\b/i.test(p) ||
      // "Remind me" + personal schedule/info (not conversation)
      /\bremind\s+me\s+(my|when\s+is\s+my|what\s+is\s+my)\b/i.test(p) ||
      // Implicit personal reminders without "my"
      /\bremind\s+me\s+\w+\s+(time|meeting|appointment|class|deadline)\b/i.test(p) ||
      // Direct "remind me X" for personal info
      /\bremind\s+me\s+(meeting|appointment|class|deadline|time)\b/i.test(p) ||
      // Handle non-question MEMORY requests
      /\bremind\s+me\s+my\s+\w+\s+(time|meeting|appointment|class|deadline)\b/i.test(p)
    );

    // Exclude conversation references from MEMORY patterns
    if (hasPersonalInfoQuery && (isQuestion || /\bremind\s+me\b/i.test(p)) && !hasPriorConvoRef) {
      return { label: 'MEMORY', score: 0.85, reason: 'personal-info-query' };
    }
    
    // COMMAND: requires action verb (not questions about actions) OR preference statements
    const hasActionVerb = /\b(write|generate|create|build|make|compose|produce|draft|code|implement|design)\b/i.test(p);
    const isActionQuestion = /\b(can you|could you|please|would you)\s+(write|generate|create|build|make)/i.test(p);
    // Hedged commands ("could you, uh, make it")
    const hasHedgedCommand = /\b(could\s+you.*make|help\s+me.*\w+|can\s+you.*\w+)\b/i.test(p) && !/\?/.test(p);
    
    // Enhanced preference patterns for personal statements that should be stored
    const hasPreferenceStatement = (
      // "X is my favorite/best/preferred Y" patterns
      /\b\w+\s+is\s+my\s+(favorite|best|preferred)\b/i.test(p) ||
      // "I love/like/prefer X" patterns  
      /\b(i|my)\s+(love|like|prefer|adore|enjoy|dislike|hate)\s+\w+/i.test(p) ||
      // "X are my favorite" patterns (handles "Cat are me favorite")
      /\b\w+\s+are?\s+(my|me)\s+(favorite|best|preferred)\b/i.test(p) ||
      // Color/animal preference patterns
      /\b(red|blue|green|yellow|orange|purple|pink|black|white|gray|grey|brown|cat|dog|bird|fish)\s+(is|are)\s+(my|me|the)?\s*(favorite|best|preferred)\b/i.test(p) ||
      // Opinion statements
      /\b(i\s+think|i\s+believe|in\s+my\s+opinion)\b/i.test(p) ||
      // Comparative opinion statements (X are/is better/worse/faster/etc)
      /\b\w+\s+(are?|is)\s+(better|worse|faster|slower|stronger|weaker|more|less)\b/i.test(p) ||
      // Symbol comparisons (>, <, etc.)
      /\b\w+\s*[><]\s*\w+/i.test(p) ||
      // Learning and interest preferences
      /\b(i\s+want\s+to\s+(learn|study|understand|start\s+learning)|i\s+am\s+interested\s+in)\b/i.test(p) ||
      // General opinion patterns
      /\b\w+\s+(are?|is)\s+(amazing|terrible|great|awful|beautiful|ugly|good|bad)\b/i.test(p) ||
      // "My [adjective] X is Y" patterns (e.g., "My least favorite UI is cluttered ones")
      /\bmy\s+(least\s+)?(favorite|preferred|best|worst)\s+\w+\s+(is|are)\b/i.test(p) ||
      // "X calms/helps/makes me Y" patterns
      /\b\w+\s+(calms?|helps?|makes?)\s+me\b/i.test(p)
    );
    
    if (hasActionVerb && (isActionQuestion || !isQuestion)) {
      return { label: 'COMMAND', score: 0.7, reason: 'action-verb' };
    }
    
    if (hasHedgedCommand) {
      return { label: 'COMMAND', score: 0.75, reason: 'hedged-command' };
    }
    
    if (hasPreferenceStatement && !isQuestion) {
      return { label: 'COMMAND', score: 0.8, reason: 'preference-statement' };
    }
    
    // GENERAL: Enhanced factual knowledge patterns
    const hasGeneralKnowledgeQuery = (
      // Geography, science, history patterns
      /\b(what('s|s)?\s+(the\s+)?(capital|largest|smallest|population|area|distance))\b/i.test(p) ||
      /\b(how\s+many\s+(planets|countries|states|continents|oceans))\b/i.test(p) ||
      /\b(who\s+(wrote|invented|discovered|created|founded))\b/i.test(p) ||
      /\b(when\s+did\s+(world\s+war|the\s+civil\s+war|\w+\s+end|\w+\s+start))\b/i.test(p) ||
      /\b(what\s+is\s+(photosynthesis|gravity|democracy|capitalism))\b/i.test(p) ||
      // Biblical/religious knowledge
      /\b(gospel|bible|jesus|christ|miracle|scripture|verse)\b/i.test(p) ||
      // Recipe/cooking knowledge
      /\b(how\s+(do\s+you\s+)?make|recipe\s+for|ingredients\s+for)\b/i.test(p) ||
      // General "tell me about" patterns
      /\b(tell\s+me\s+about|explain|describe)\s+(?!my|our|we|us)\w+/i.test(p)
    );
    
    const hasQuestionMarkers = /(\?|\b(who|what|when|where|why|how|which)\b|\blist\b|\btell me about\b|\bexplain\b|\btypes of\b|\bkinds of\b)/i.test(p);
    const hasLearningIntent = /\b(can you (list|tell|explain)|i (love|like).*(and can you|tell me))\b/i.test(p);
    
    if (hasGeneralKnowledgeQuery && isQuestion) {
      return { label: 'GENERAL', score: 0.8, reason: 'factual-knowledge-query' };
    }
    
    if (hasQuestionMarkers || hasLearningIntent) {
      return { label: 'GENERAL', score: 0.65, reason: 'qa-signals' };
    }
    
    return { label: null, score: 0.0, reason: 'none' };
  }
  
  // Ensemble decision logic combining heuristics and zero-shot
  function decideEnsemble({ rule, zsc }) {
    const RULE_STRONG = rule.score >= 0.8;
    const RULE_MEDIUM = rule.score >= 0.65;
    const MODEL_STRONG = zsc.top >= 0.65 && zsc.margin >= 0.15;
    
    // Strong heuristic rule always wins (high precision patterns)
    if (RULE_STRONG) {
      console.log(`🎯 [ENSEMBLE] Strong heuristic: ${rule.label} (${rule.score.toFixed(3)}) - ${rule.reason}`);
      return rule.label;
    }
    
    // Both agree → take it even if not individually strong
    if (rule.label && rule.label === zsc.label) {
      console.log(`🎯 [ENSEMBLE] Rule+Model agree: ${zsc.label} (rule: ${rule.score.toFixed(3)}, model: ${zsc.top.toFixed(3)})`);
      return zsc.label;
    }
    
    // Medium heuristic rule beats uncertain model
    if (RULE_MEDIUM && zsc.top < 0.6) {
      console.log(`🎯 [ENSEMBLE] Medium rule beats weak model: ${rule.label} (rule: ${rule.score.toFixed(3)}, model: ${zsc.top.toFixed(3)})`);
      return rule.label;
    }
    
    // Model is confident and has good margin → trust model
    if (MODEL_STRONG) {
      console.log(`🎯 [ENSEMBLE] Model confident: ${zsc.label} (${zsc.top.toFixed(3)}, margin: ${zsc.margin.toFixed(3)})`);
      return zsc.label;
    }
    
    // Model has reasonable confidence → trust model
    if (zsc.top >= 0.55) {
      console.log(`🎯 [ENSEMBLE] Model reasonably confident: ${zsc.label} (${zsc.top.toFixed(3)})`);
      return zsc.label;
    }
    
    // Default to safe fallback
    console.log(`🎯 [ENSEMBLE] Uncertain, defaulting to GENERAL (rule: ${rule.label || 'none'}, model: ${zsc.label})`);
    return 'GENERAL';
  }

  // Robust zero-shot classification with ensemble logic
  async function classifyWithZeroShot(prompt) {
    try {
      broadcastThinkingUpdate(IntentResponses.getThinkingMessage('intent_classification'), null);
      
      // Initialize zero-shot classifier if not already done
      if (!global.zeroShotClassifier) {
        const { pipeline } = await import('@xenova/transformers');
        
        console.log('🔄 [ZERO-SHOT] Loading zero-shot classifier (BART MNLI)...');
        global.zeroShotClassifier = await pipeline(
          'zero-shot-classification',
          'Xenova/bart-large-mnli'
        );
        console.log('✅ [ZERO-SHOT] Zero-shot classifier loaded');
      }
      
                                             // Optimized labels for best classification performance
      const candidateLabels = [
        'asking about previous conversation messages',
        'asking about personal stored information',
        'sharing a preference or opinion',
        'asking factual questions about the world, history, science, or general topics'
      ];
      
      const labelMap = {
        'asking about previous conversation messages': 'CONTEXT',
        'asking about personal stored information': 'MEMORY',
        'sharing a preference or opinion': 'COMMAND',
        'asking factual questions about the world, history, science, or general topics': 'GENERAL'
      };

      // Get heuristic vote first
      const rule = heuristicVote(prompt);
      console.log(`🔍 [HEURISTIC] Rule result: ${JSON.stringify(rule)}`);
      
      // Run zero-shot with multi-label and hypothesis template
      const result = await global.zeroShotClassifier(prompt, candidateLabels, {
        multi_label: true,
        hypothesis_template: 'The user is {}.'
      });
      
      if (result && result.labels && result.scores) {
        // Calculate top score and margin
        const pairs = result.labels.map((lbl, i) => ({ 
          lbl, 
          score: result.scores[i],
          classification: labelMap[lbl] || 'GENERAL'
        })).sort((a, b) => b.score - a.score);
        
        const zscTop = pairs[0]?.score ?? 0;
        const zscMargin = (pairs[0]?.score ?? 0) - (pairs[1]?.score ?? 0);
        const zscLabel = pairs[0]?.classification ?? 'GENERAL';
        
        // Use ensemble decision
        const finalClassification = decideEnsemble({ 
          rule, 
          zsc: { label: zscLabel, top: zscTop, margin: zscMargin }
        });
        
        console.log(`🧠 [ZERO-SHOT] "${prompt}" -> ${finalClassification} (top: ${zscTop.toFixed(3)}, margin: ${zscMargin.toFixed(3)})`);
        return { classification: finalClassification, confidence: zscTop, source: 'ensemble' };
      }
      
    } catch (error) {
      console.error('❌ [ZERO-SHOT] Error:', error.message);
      console.log('🔄 [ZERO-SHOT] Falling back to heuristics...');
      
      // Fallback to heuristic vote or safe default
      const rule = heuristicVote(prompt);
      const fallbackClassification = rule.label || 'GENERAL';
      return { classification: fallbackClassification, confidence: 0.4, source: 'fallback' };
    }
  }

  // Simple heuristic fallback
  function classifyWithHeuristics(prompt) {
    const queryLower = prompt.toLowerCase();
    
    // Enhanced patterns for better conversational memory detection
    const conversationalMemoryPatterns = [
      /\b(have we|did we|have you|did you)\b.*\b(talk|discuss|chat|mention|cover)\b/i,
      /\b(we talked|we discussed|we chatted|we mentioned)\b/i,
      /\b(talked about|discussed about|chatted about|mentioned about)\b/i,
      /\b(conversation about|discussion about|chat about)\b/i,
      /\b(before|previously|earlier)\b.*\b(talk|discuss|chat|mention)\b/i
    ];
    
    // Check for conversational memory patterns first
    if (conversationalMemoryPatterns.some(pattern => pattern.test(prompt))) {
      console.log(`🔍 [HEURISTIC] Rule result: {"label":"MEMORY","score":0.8,"reason":"conversational-memory-pattern"}`);
      return { classification: 'MEMORY', confidence: 0.8, reason: 'conversational-memory-pattern' };
    }
    
    // Basic patterns as fallback
    if (queryLower.includes('what') && (queryLower.includes('say') || queryLower.includes('talk'))) {
      return { classification: 'CONTEXT' };
    }
    if (queryLower.includes('remember') || queryLower.includes('store')) {
      return { classification: 'MEMORY' };
    }
    if (queryLower.startsWith('write') || queryLower.startsWith('create') || queryLower.startsWith('make')) {
      return { classification: 'COMMAND' };
    }
    
    console.log(`🔄 [HEURISTIC] "${prompt}" -> GENERAL (fallback)`);
    return { classification: 'GENERAL' };
  }


  // Non-context query handlers
  async function handleNonContextPipeline(queryType, prompt, context, startTime) {
    console.log(`🎯 [NONCONTEXT-PIPELINE] Handling ${queryType} query...`);
    
    switch (queryType) {
      case 'GENERAL':
        return await handleGeneralKnowledge(prompt, context, startTime);
      case 'MEMORY':
        return await handleMemoryQuery(prompt, context, startTime);
      case 'COMMAND':
        return await handleCommand(prompt, context, startTime);
      default:
        return await handleGeneralKnowledge(prompt, context, startTime);
    }
  }

  // WebSocket Backend Integration - Direct Pipeline Access
  async function handleWebSocketBackendResponse(websocketResponse, originalPrompt, originalContext) {
    console.log('🌐 [WEBSOCKET-BACKEND] Processing response from online backend...');
    
    const { data, queryType, memoryTurn, pipeline, timing } = websocketResponse;
    const startTime = Date.now() - (timing?.total || 0);
    
    // Store conversation turn in local memory (async)
    try {
      await storeTurn(
        {
          sessionId: memoryTurn.sessionId,
          userId: memoryTurn.context.userId,
          conversationId: memoryTurn.context.conversationId,
          messageId: memoryTurn.context.messageId
        },
        memoryTurn.userMessage,
        memoryTurn.aiResponse,
        `websocket_${pipeline}`
      );
      console.log('✅ [WEBSOCKET-BACKEND] Stored conversation turn from online backend');
    } catch (error) {
      console.warn('⚠️ [WEBSOCKET-BACKEND] Failed to store turn:', error.message);
    }
    
    // Return response in local system format
    return {
      success: true,
      data: data,
      pipeline: `websocket_${pipeline}`,
      timing: {
        total: timing?.total || 0,
        websocket: true
      },
      source: 'websocket_backend',
      queryType: queryType
    };
  }

  // Export the function for external access
  handleWebSocketBackendResponseExport = handleWebSocketBackendResponse;

  // Extract recent context for WebSocket backend
  async function extractRecentContextForBackend(sessionId, messageCount = 8) {
    // This integrates with conversation signals to get recent messages
    try {
      console.log(`🔍 [WEBSOCKET-CONTEXT] Extracting ${messageCount} recent messages for session: ${sessionId}`);
      
      const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
      if (conversationAgent) {
        // Get recent messages from the session
        const recentMessages = await conversationAgent.execute({
          action: 'message-list',
          sessionId: sessionId, // Fixed: use sessionId parameter instead of context.sessionId
          limit: messageCount, // Get more messages for better context
          direction: 'DESC', // Get newest messages first
          includeMetadata: true
        }, coreAgent.context);
        
        if (recentMessages.success && recentMessages.messages) { // Fixed: use recentMessages instead of result
          console.log(`✅ [WEBSOCKET-CONTEXT] Retrieved ${recentMessages.messages.length} recent messages`);
          
          // Format messages for WebSocket backend context
          const contextMessages = recentMessages.messages.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.text,
            timestamp: msg.timestamp,
            messageId: msg.id
          }));
          
          return contextMessages;
        } else {
          console.log('⚠️ [WEBSOCKET-CONTEXT] No messages found or query failed');
          return [];
        }
      } else {
        console.log('⚠️ [WEBSOCKET-CONTEXT] ConversationSessionAgent not available');
        return [];
      }
    } catch (error) {
      console.warn('⚠️ [WEBSOCKET-BACKEND] Failed to extract context:', error.message);
      return [];
    }
  }

  // Export the function for external access
  extractRecentContextForBackendExport = extractRecentContextForBackend;

  // Ultra-fast general knowledge handler
  async function handleGeneralKnowledge(prompt, context, startTime) {
    const llmStartTime = Date.now();
    console.log('⚡ [GENERAL-ULTRA-FAST] Starting chunked response...');
    broadcastThinkingUpdate(IntentResponses.getThinkingMessage('response_generation'), context.sessionId);
    
    try {
      const phi3Agent = coreAgent.getAgent('Phi3Agent');
      if (!phi3Agent) {
        throw new Error('Phi3Agent not available');
      }

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: `${prompt}`,
        options: { 
          timeout: 1500,
          maxTokens: 40,
          temperature: 0.0,
          stop: [".", "!", "?", "\n"]
        }
      });

      const llmTime = Date.now() - llmStartTime;
      const totalTime = Date.now() - startTime;
      
      console.log(`⚡ [GENERAL-ULTRA-FAST] Response in ${llmTime}ms (total: ${totalTime}ms)`);
      console.log('🔍 [DEBUG] Phi3Agent result:', {
        success: result.success,
        responseType: typeof result.response,
        responseValue: result.response,
        responseLength: result.response ? result.response.length : 0
      });

      if (result.success && result.response && result.response.trim().length > 0) {
        return {
          success: true,
          response: result.response,
          pipeline: 'general_knowledge_ultra_fast',
          timing: { llm: llmTime, total: totalTime }
        };
      }

      throw new Error(`No valid response from Phi3: ${JSON.stringify(result)}`);

    } catch (error) {
      console.error('❌ [GENERAL-ULTRA-FAST] Error:', error.message);
      return {
        success: false,
        error: error.message,
        pipeline: 'general_knowledge_failed',
        timing: { total: Date.now() - startTime }
      };
    }
  }

  // Handle memory queries (retrieval only - all messages are auto-stored)
  async function handleMemoryQuery(prompt, context, startTime) {
    console.log('🧠 [MEMORY-RETRIEVE] Searching across all conversations...');
    
    // Log intent classification payload if available
    if (context.intentClassificationPayload) {
      console.log('🎯 [MEMORY-RETRIEVE] Using intent classification payload:', JSON.stringify(context.intentClassificationPayload, null, 2));
    }
    
    broadcastThinkingUpdate(IntentResponses.getThinkingMessage('memory_retrieve'), context.sessionId);
    
    try {
      return await handleMemoryRetrieve(prompt, context, startTime);
    } catch (error) {
      const totalTime = Date.now() - startTime;
      
      // Handle reclassification requests
      if (error.message === 'RECLASSIFY_AS_GENERAL') {
        console.log('🔄 [MEMORY-RETRIEVE] Reclassifying as GENERAL knowledge query...');
        return await handleGeneralKnowledge(prompt, context, startTime);
      }
      
      console.error(`❌ [MEMORY-RETRIEVE] Error:`, error.message);
      return { 
        success: false, 
        error: error.message,
        pipeline: 'memory_retrieve',
        timing: { total: totalTime }
      };
    }
  }

  // Classify whether query is for storage or retrieval
  async function classifyMemoryIntent(prompt) {
    broadcastThinkingUpdate(IntentResponses.getThinkingMessage('intent_classification'), null);
    
    // Factual/general knowledge patterns - should NOT be treated as memory queries
    const factualPatterns = [
      /^(can you list|list the|what are the|tell me about|explain|describe)/i,
      /^(how many|how do|what is|what are|who is|who are|where is|where are)/i,
      /^(i love .* and can you|i like .* and can you)/i, // "I love X and can you..." = factual question
      /(types of|kinds of|species of|varieties of)/i,
      /(in the world|on earth|that exist)/i
    ];
    
    // Check if this is a factual question first
    for (const pattern of factualPatterns) {
      if (pattern.test(prompt)) {
        console.log('🔍 [MEMORY-INTENT] Detected factual question - should be GENERAL, not MEMORY');
        // Return null to indicate this shouldn't be handled by MEMORY pipeline at all
        throw new Error('RECLASSIFY_AS_GENERAL');
      }
    }
    
    // Storage patterns - user wants to store information
    const storagePatterns = [
      /^(remember|note|save|store|keep in mind|don't forget)/i,
      /^(i have|i'm|i am|my|i like|i prefer|i need|i want)(?!.*(and can you|and tell me))/i, // exclude factual questions
      /(appointment|meeting|schedule|deadline|reminder).*\d/i, // with numbers/dates
      /^(add|create|record|log)/i
    ];
    
    // Retrieval patterns - user wants to find personal information
    const retrievalPatterns = [
      /^(do i have|did i|have i|when is my|what is my|where is my)/i,
      /^(find my|search my|show me my)/i,
      /^(what.*appointment|when.*meeting|any.*schedule)/i,
      /^(what did i|when did i|where did i|how did i)/i // personal history
    ];
    
    // Check storage patterns first
    for (const pattern of storagePatterns) {
      if (pattern.test(prompt)) {
        console.log('🔍 [MEMORY-INTENT] Detected storage intent');
        return true;
      }
    }
    
    // Check retrieval patterns
    for (const pattern of retrievalPatterns) {
      if (pattern.test(prompt)) {
        console.log('🔍 [MEMORY-INTENT] Detected retrieval intent');
        return false;
      }
    }
    
    // Default to retrieval for ambiguous cases (safer)
    console.log('🔍 [MEMORY-INTENT] Ambiguous - defaulting to retrieval');
    return false;
  }

  // Handle memory storage requests
  async function handleMemoryStore(prompt, context, startTime) {
    console.log('💾 [MEMORY-STORE] Processing information storage...');
    broadcastThinkingUpdate(IntentResponses.getThinkingMessage('memory_store'), context.sessionId);
    
    try {
      const userMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
      if (!userMemoryAgent) {
        throw new Error('UserMemoryAgent not available');
      }

      const storeResult = await userMemoryAgent.execute({
        action: 'memory-store',
        sourceText: prompt,
        suggestedResponse: null,
        primaryIntent: 'user_storage',
        metadata: {
          pipeline: 'memory_store',
          sessionId: context.sessionId,
          timestamp: new Date().toISOString(),
          source: 'direct_query'
        }
      }, {
        database: coreAgent.context?.database || coreAgent.database,
        executeAgent: (agentName, action, context) => coreAgent.executeAgent(agentName, action, context)
      });

      const totalTime = Date.now() - startTime;

      if (storeResult.success) {
        console.log(`✅ [MEMORY-STORE] Information stored successfully (${totalTime}ms)`);
        return {
          success: true,
          response: 'Information stored successfully in your memory.',
          pipeline: 'memory_store',
          timing: { total: totalTime }
        };
      } else {
        throw new Error(storeResult.error || 'Failed to store information');
      }

    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`❌ [MEMORY-STORE] Error:`, error.message);
      return { 
        success: false, 
        error: error.message,
        pipeline: 'memory_store',
        timing: { total: totalTime }
      };
    }
  }

  // Helper function to deduplicate and clean memory texts
  function deduplicateAndCleanMemoryTexts(memoryTexts, query) {
    const seen = new Set();
    const cleaned = [];
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    
    for (const text of memoryTexts) {
      // Skip AI responses that are just memory summaries themselves
      if (text.startsWith('Based on your memories:') || text.startsWith('Based on our conversation history:')) {
        // Extract the actual content from these responses
        const lines = text.split('\n').filter(line => line.trim());
        for (const line of lines) {
          if (line.match(/^\d+\.\s+/) && !line.includes('Based on')) {
            const content = line.replace(/^\d+\.\s+/, '').trim();
            if (content && !seen.has(content.toLowerCase())) {
              // Check if content is relevant to the query
              const isRelevant = queryTerms.some(term => content.toLowerCase().includes(term));
              if (isRelevant || queryTerms.length === 0) {
                seen.add(content.toLowerCase());
                cleaned.push(content);
              }
            }
          }
        }
      } else {
        // Regular text - check for duplicates and relevance
        const normalized = text.toLowerCase().trim();
        if (!seen.has(normalized)) {
          const isRelevant = queryTerms.length === 0 || queryTerms.some(term => normalized.includes(term));
          if (isRelevant) {
            seen.add(normalized);
            cleaned.push(text.trim());
          }
        }
      }
    }
    
    return cleaned.slice(0, 5); // Limit to top 5 most relevant
  }

  // Handle memory retrieval requests
  async function handleMemoryRetrieve(prompt, context, startTime) {
    console.log('🔍 [MEMORY-RETRIEVE] Searching memories...');
    broadcastThinkingUpdate(IntentResponses.getThinkingMessage('memory_retrieve'), context.sessionId);
    
    try {
      const userMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
      if (!userMemoryAgent) {
        throw new Error('UserMemoryAgent not available');
      }

      // Extract search parameters from intent classification payload if available
      let searchQuery = prompt;
      let searchLimit = 10;
      let minSimilarity = 0.6;
      let searchSessionId = null; // Search across all sessions by default
      
      if (context.intentClassificationPayload) {
        const payload = context.intentClassificationPayload;
        console.log('🎯 [MEMORY-RETRIEVE] Enhancing search with intent classification data');
        
        // Use entities from intent classification to enhance search query
        if (payload.entities && payload.entities.length > 0) {
          const entityTerms = payload.entities.map(e => e.text || e.value).filter(Boolean);
          if (entityTerms.length > 0) {
            searchQuery = `${prompt} ${entityTerms.join(' ')}`;
            console.log('🔍 [MEMORY-RETRIEVE] Enhanced query with entities:', searchQuery);
          }
        }
        
        // Adjust search parameters based on intent confidence and type
        if (payload.confidence && payload.confidence > 0.8) {
          minSimilarity = 0.5; // Lower threshold for high-confidence classifications
          searchLimit = 15; // Get more results for high-confidence queries
        }
        
        // Use suggested response context if available
        if (payload.suggestedResponse && payload.suggestedResponse.includes('memory')) {
          console.log('🎯 [MEMORY-RETRIEVE] Intent suggests memory-focused search');
          minSimilarity = 0.4; // Even lower threshold when intent is clearly memory-focused
        }
      }

      // HYBRID SEARCH STRATEGY: Try stored memories first, then conversation history
      let searchResult = null;
      let searchType = 'unknown';
      
      // STEP 1: Try entity-aware search on stored memories (if we have entities)
      if (context.intentClassificationPayload?.entities && context.intentClassificationPayload.entities.length > 0) {
        const entities = context.intentClassificationPayload.entities.map(e => e.value || e.text).filter(Boolean);
        console.log(`🎯 [MEMORY-RETRIEVE] STEP 1: Trying entity-aware search on stored memories with entities: [${entities.join(', ')}]`);
        
        try {
          searchResult = await userMemoryAgent.execute({
            action: 'memory-semantic-search-with-entities',
            query: searchQuery,
            entities: entities,
            limit: searchLimit,
            minSimilarity: minSimilarity,
            sessionId: searchSessionId
          }, {
            database: coreAgent.context?.database || coreAgent.database,
            executeAgent: (agentName, action, context) => coreAgent.executeAgent(agentName, action, context)
          });
          
          // Handle different response structures for entity search
          const entityResults = searchResult.result?.results || searchResult.results;
          if (searchResult.success && entityResults && entityResults.length > 0) {
            console.log(`✅ [MEMORY-RETRIEVE] STEP 1 SUCCESS: Found ${entityResults.length} stored memories with entities`);
            searchResult.results = entityResults; // Normalize the structure
            searchType = 'stored_memories_with_entities';
          } else {
            console.log('🔄 [MEMORY-RETRIEVE] STEP 1: No entity-aware results, continuing to step 2...');
          }
        } catch (error) {
          console.log('⚠️ [MEMORY-RETRIEVE] STEP 1 ERROR:', error.message);
        }
      }
      
      // STEP 2: If no entity results, try conversation history search
      if (!searchResult || !searchResult.success || !searchResult.results || searchResult.results.length === 0) {
        console.log(`🎯 [MEMORY-RETRIEVE] STEP 2: Searching conversation history (query: "${searchQuery}", limit: ${searchLimit}, minSimilarity: ${minSimilarity})...`);
        
        searchResult = await userMemoryAgent.execute({
          action: 'memory-semantic-search',
          query: searchQuery,
          limit: searchLimit,
          minSimilarity: minSimilarity,
          sessionId: searchSessionId
        }, {
          database: coreAgent.context?.database || coreAgent.database,
          executeAgent: (agentName, action, context) => coreAgent.executeAgent(agentName, action, context)
        });
        
        if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
          console.log(`✅ [MEMORY-RETRIEVE] STEP 2 SUCCESS: Found ${searchResult.results.length} conversation messages`);
          searchType = 'conversation_history';
        } else {
          console.log('🔄 [MEMORY-RETRIEVE] STEP 2: No conversation results, trying lower threshold...');
          
          // STEP 3: Try with lower threshold as final fallback
          searchResult = await userMemoryAgent.execute({
            action: 'memory-semantic-search',
            query: prompt,
            limit: 10,
            minSimilarity: 0.3, // Lower threshold
            sessionId: context.sessionId // Try current session first
          }, {
            database: coreAgent.context?.database || coreAgent.database,
            executeAgent: (agentName, action, context) => coreAgent.executeAgent(agentName, action, context)
          });
          
          if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
            console.log(`✅ [MEMORY-RETRIEVE] STEP 3 SUCCESS: Found ${searchResult.results.length} results with lower threshold`);
            searchType = 'conversation_history_low_threshold';
          }
        }
      }

      const totalTime = Date.now() - startTime;

      if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
        console.log(`✅ [MEMORY-RETRIEVE] Found ${searchResult.results.length} relevant memories (${totalTime}ms)`);
        
        // Format the response based on found memories or conversation messages
        const memories = searchResult.results.slice(0, 5); // Top 5 most relevant
        
        // Handle both stored memories and conversation messages
        const memoryTexts = memories.map((m, index) => {
          console.log(`🔍 [MEMORY-DEBUG] Processing memory item ${index + 1}:`, {
            hasSourceText: !!m.source_text,
            hasText: !!m.text,
            hasMessageText: !!m.message_text,
            hasContent: !!m.content,
            sender: m.sender,
            source: m.source,
            similarity: m.similarity,
            keys: Object.keys(m),
            sourceTextLength: m.source_text ? m.source_text.length : 0,
            textLength: m.text ? m.text.length : 0
          });
          
          // For stored memories: use source_text or text
          if (m.source_text && m.source_text.trim()) {
            console.log(`✅ [MEMORY-DEBUG] Using source_text for item ${index + 1}: "${m.source_text.substring(0, 100)}..."`);
            return m.source_text.trim();
          }
          if (m.text && m.text.trim()) {
            console.log(`✅ [MEMORY-DEBUG] Using text for item ${index + 1}: "${m.text.substring(0, 100)}..."`);
            return m.text.trim();
          }
          // For conversation messages: use message_text or content
          if (m.message_text && m.message_text.trim()) {
            const formatted = `${m.sender}: ${m.message_text.trim()}`;
            console.log(`✅ [MEMORY-DEBUG] Using message_text for item ${index + 1}: "${formatted.substring(0, 100)}..."`);
            return formatted;
          }
          if (m.content && m.content.trim()) {
            const formatted = `${m.sender || 'Unknown'}: ${m.content.trim()}`;
            console.log(`✅ [MEMORY-DEBUG] Using content for item ${index + 1}: "${formatted.substring(0, 100)}..."`);
            return formatted;
          }
          
          console.log(`⚠️ [MEMORY-DEBUG] No usable text found in memory item ${index + 1} - all text fields are empty or missing`);
          return null;
        }).filter(Boolean);
        
        console.log(`🔍 [MEMORY-DEBUG] Extracted ${memoryTexts.length} memory texts from ${memories.length} items`);
        
        if (memoryTexts.length > 0) {
          // Deduplicate and clean memory texts
          const cleanedTexts = deduplicateAndCleanMemoryTexts(memoryTexts, searchQuery);
          console.log(`🧹 [MEMORY-DEBUG] After deduplication: ${cleanedTexts.length} unique items from ${memoryTexts.length} original`);
          
          if (cleanedTexts.length === 0) {
            console.log(`⚠️ [MEMORY-DEBUG] All texts were filtered out during deduplication`);
            return {
              success: true,
              response: `I searched through our conversation history but couldn't find any specific discussions about "${searchQuery}". Would you like me to search for related topics or help you with something else?`,
              searchType: searchType,
              resultsCount: 0,
              timing: { total: Date.now() - startTime }
            };
          }
          
          // Generate LLM response based on retrieved memories
          console.log(`🤖 [MEMORY-LLM] Generating response using Phi3 for query: "${searchQuery}"`);
          
          const memoryContext = cleanedTexts.map((text, i) => `${i + 1}. ${text}`).join('\n');
          const llmPrompt = `Based on the following conversation history and memories, please answer the user's question: "${searchQuery}"

Relevant conversation history:
${memoryContext}

Please provide a direct, helpful answer to the user's question. If the conversation history shows we have discussed the topics they're asking about, mention what was discussed. If not, clearly state that we haven't discussed those topics.`;

          let response;
          try {
            const phi3Agent = coreAgent.getAgent('Phi3Agent');
            if (phi3Agent) {
              console.log(`🤖 [MEMORY-LLM] Using Phi3Agent to generate response`);
              const llmResult = await phi3Agent.execute({
                action: 'query-phi3-fast',
                prompt: llmPrompt,
                options: {
                  maxTokens: 300,
                  temperature: 0.7
                }
              }, context);
              
              if (llmResult.success && llmResult.response) {
                response = llmResult.response.trim();
                console.log(`✅ [MEMORY-LLM] Generated LLM response: "${response.substring(0, 100)}..."`);
              } else {
                console.log(`⚠️ [MEMORY-LLM] LLM generation failed, falling back to list format`);
                response = `Based on our conversation history:\n\n${cleanedTexts.map((text, i) => `${i + 1}. ${text}`).join('\n')}`;
              }
            } else {
              console.log(`⚠️ [MEMORY-LLM] Phi3Agent not available, falling back to list format`);
              response = `Based on our conversation history:\n\n${cleanedTexts.map((text, i) => `${i + 1}. ${text}`).join('\n')}`;
            }
          } catch (error) {
            console.error(`❌ [MEMORY-LLM] Error generating LLM response:`, error.message);
            response = `Based on our conversation history:\n\n${cleanedTexts.map((text, i) => `${i + 1}. ${text}`).join('\n')}`;
          }
          
          console.log(`🔍 [MEMORY-DEBUG] Final response constructed:`, response?.substring(0, 100) + '...');
          
          const result = {
            success: true,
            response: response,
            pipeline: 'memory_retrieve',
            timing: { total: totalTime },
            memories: memories,
            searchType: searchType,
            hybridSearchUsed: true
          };
          
          console.log(`🔍 [MEMORY-DEBUG] Returning result with response field:`, !!result.response);
          return result;
        } else {
          console.log(`⚠️ [MEMORY-DEBUG] No memory texts extracted, memoryTexts.length: ${memoryTexts.length}`);
        }
      }

      // No relevant memories found
      console.log(`⚠️ [MEMORY-RETRIEVE] No relevant memories found (${totalTime}ms)`);
      return {
        success: true,
        response: "I couldn't find any relevant information in your memories for that query.",
        pipeline: 'memory_retrieve_empty',
        timing: { total: totalTime }
      };

    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`❌ [MEMORY-RETRIEVE] Error:`, error.message);
      return { 
        success: false, 
        error: error.message,
        pipeline: 'memory_retrieve',
        timing: { total: totalTime }
      };
    }
  }

  // Handle command/action requests
  async function handleCommand(prompt, context, startTime) {
    console.log('⚡ [COMMAND] Processing action request...');
    broadcastThinkingUpdate(IntentResponses.getThinkingMessage('command'), context.sessionId);
    
    try {
      const phi3Agent = coreAgent.getAgent('Phi3Agent');
      if (!phi3Agent) {
        throw new Error('Phi3Agent not available');
      }

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: `You are ThinkDrop AI. The user is requesting an action. Provide helpful guidance.

User request: ${prompt}

Respond concisely with actionable guidance.`,
        options: { 
          timeout: 8000, 
          maxTokens: 120, 
          temperature: 0.2
        }
      });

      const totalTime = Date.now() - startTime;

      if (result.success && result.response) {
        // Clean the response to remove any system prompt contamination
        const cleanedResponse = cleanLLMResponse(result.response);
        console.log(`✅ [COMMAND] Generated response for command request`);
        return {
          success: true,
          response: cleanedResponse,
          source: 'command',
          contextUsed: 0
        };
      } else {
        throw new Error('Failed to generate command response');
      }

    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`❌ [COMMAND] Error:`, error.message);
      return { 
        success: false, 
        error: error.message,
        pipeline: 'command',
        timing: { total: totalTime }
      };
    }
  }

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
            const allMessages = recentMessages.data.messages.filter(msg => {
              // Ensure message object exists and has required properties
              if (!msg || typeof msg !== 'object') return false;
              if (!msg.text || typeof msg.text !== 'string') return false;
              if (!msg.sender || typeof msg.sender !== 'string') return false;
              return msg.text !== prompt;
            });
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
        
        // Ensure responseText is never undefined or null
        if (responseText === undefined || responseText === null || responseText === '') {
          responseText = 'I found some information for you.';
          console.log('⚠️ [STAGED-SEARCH] ResponseText was undefined/null, using fallback');
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
      broadcastThinkingUpdate(IntentResponses.getThinkingMessage('question'), options.sessionId);
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
      broadcastThinkingUpdate(IntentResponses.getThinkingMessage('intent_classification'), options.sessionId);
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

      // Note: Hybrid routing logic is now implemented in the main llm-query handler
      
      // Fallback to background orchestration for other cases
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
          
          // Ensure responseText is never undefined or null
          if (responseText === undefined || responseText === null || responseText === '') {
            responseText = 'I found some information for you.';
            console.log('⚠️ [BROADCAST] ResponseText was undefined/null, using fallback');
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

// Export functions for external access
let handleWebSocketBackendResponseExport = null;
let extractRecentContextForBackendExport = null;

module.exports = {
  initializeLocalLLMHandlers,
  setupLocalLLMHandlers,
  get handleWebSocketBackendResponse() {
    return handleWebSocketBackendResponseExport;
  },
  get extractRecentContextForBackend() {
    return extractRecentContextForBackendExport;
  }
};