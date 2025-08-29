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

  // Main IPC handler for new pipeline with routing and 3-stage progressive search
  ipcMain.handle('llm-query', async (event, prompt, options = {}) => {
    const startTime = Date.now();
    
    try {
      if (!coreAgent || !coreAgent.initialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }

      console.log(`🎯 [NEW-PIPELINE] Starting query: "${prompt.substring(0, 50)}..."`);

      // Step 1: Routing classification
      const routingStartTime = Date.now();
      const routingResult = await classifyQuery(prompt);
      const routingTime = Date.now() - routingStartTime;
      
      console.log(`🔍 [ROUTING] Classification: ${routingResult.classification} (${routingTime}ms)`);

      // Handle non-context queries (GENERAL, MEMORY, COMMAND)
      if (['GENERAL', 'MEMORY', 'COMMAND'].includes(routingResult.classification)) {
        return await handleNonContextPipeline(routingResult.classification, prompt, { sessionId: options.currentSessionId || options.sessionId }, startTime);
      }

      // Handle context queries with 3-stage progressive search
      if (routingResult.classification === 'CONTEXT') {
        console.log('🎯 [CONTEXT-PIPELINE] Starting 3-stage progressive search...');
        
        // Stage 1: Current conversation scope
        console.log('📍 [STAGE-1] Current conversation scope...');
        const stage1Result = await handleCurrentScope(prompt, { sessionId: options.currentSessionId || options.sessionId });
        if (stage1Result && stage1Result.success) {
          console.log('✅ [STAGE-1] Success - returning current scope result');
          return {
            success: true,
            response: stage1Result.response,
            pipeline: 'stage1_current_scope',
            timing: { total: Date.now() - startTime }
          };
        }

        // Stage 2: Session-scoped semantic search
        console.log('📍 [STAGE-2] Session-scoped semantic search...');
        const stage2Result = await handleSessionScope(prompt, { sessionId: options.currentSessionId || options.sessionId });
        // Return successful stage 2 result if available
        if (stage2Result && stage2Result.success) {
          console.log('✅ [CONTEXT-PIPELINE] Returning Stage 2 result with conversation messages');
          return {
            success: true,
            response: stage2Result.response,
            pipeline: 'stage2_session_scope',
            timing: { total: Date.now() - startTime }
          };
        }

        // Stage 3: Cross-session semantic search if still no results
        if (!stage1Result || !stage1Result.success) {
          console.log('📍 [STAGE-3] Cross-session semantic search...');
          // Temporarily disabled due to executeAgent context issues
          console.log('⚠️ [STAGE-3] Skipped - using Stage 1-2 results');
        }

        // All stages failed - fallback to general knowledge
        console.log('⚠️ [FALLBACK] All context stages failed - using general knowledge');
        return await handleGeneralKnowledge(prompt, { sessionId: options.sessionId }, startTime);
      }

      // Default fallback
      return await handleGeneralKnowledge(prompt, { sessionId: options.sessionId }, startTime);

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
      let filteredMessages = recentMessages.data.messages.filter(msg => msg.text !== prompt);
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
      
      if (bestSimilarity < requiredSimilarity) {
        console.log(`⚠️ [CURRENT-SCOPE] Semantic similarity ${bestSimilarity.toFixed(3)} below threshold ${requiredSimilarity}, will try session scope`);
        return null;
      }
      
      const messages = relevantScoredMessages
        .map(item => `${item.message.sender}: ${item.message.text}`)
        .join('\n');
      
      console.log('🔍 [CURRENT-SCOPE] Final formatted messages:', messages);

      if (!messages.trim()) {
        console.warn('⚠️ [CURRENT-SCOPE] No valid conversation context');
        return null;
      }

      // Generate response using current conversation context
      const phiPrompt = `You are ThinkDrop AI. Answer based on the recent conversation.

RECENT CONVERSATION:
${messages}

CURRENT QUESTION: ${prompt}

Answer based on what was just discussed. Be specific and accurate.`;

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: phiPrompt,
        options: { timeout: 5000, maxTokens: 120, temperature: 0.2 }
      });

      if (result.success && result.response) {
        return { success: true, response: result.response };
      }

      return null;

    } catch (error) {
      console.error('❌ [CURRENT-SCOPE] Error:', error.message);
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

      // Perform cross-session semantic search (no sessionId filter for broader scope)
      console.log('🔍 [SESSION-SCOPE] Searching across all sessions...');
      const searchResult = await userMemoryAgent.execute({
        action: 'memory-semantic-search',
        query: prompt,
        limit: 30,
        minSimilarity: 0.26
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
        const currentSessionMessages = contextData.filter(msg => msg.session_id === currentSessionId);
        const otherSessionMessages = contextData.filter(msg => msg.session_id !== currentSessionId);
        
        // Mix current session (up to 2) + other sessions (up to 3) = max 5 total
        const prioritizedMessages = [
          ...currentSessionMessages.slice(0, 2),
          ...otherSessionMessages.slice(0, 3)
        ].slice(0, 5);
        
        contextSnippets = prioritizedMessages.map((msg, i) => {
          const sender = msg.sender === 'user' ? 'You' : 'AI';
          const text = (msg.text || '').slice(0, 150);
          const isCurrentSession = msg.session_id === currentSessionId;
          const prefix = isCurrentSession ? 'Recent' : 'Previous';
          return `${prefix} - ${sender}: ${text}${(msg.text || '').length > 150 ? '...' : ''}`;
        });
        
        console.log(`🔍 [SESSION-SCOPE] Using ${currentSessionMessages.length} current + ${Math.min(3, otherSessionMessages.length)} other session messages`);
      } else {
        // Memory format
        const topSimilarity = contextData[0].similarity;
        if (topSimilarity < 0.28) {
          console.warn('⚠️ [SESSION-SCOPE] Similarity too low');
          return null;
        }
        contextSnippets = contextData.slice(0, 3).map((m, i) => {
          const text = (m.source_text || '').slice(0, 220);
          return `Memory ${i + 1} (${Math.round((m.similarity || 0) * 100)}%): ${text}${(m.source_text || '').length > 220 ? '...' : ''}`;
        });
      }

      // Generate response using context
      const phiPrompt = `You are ThinkDrop AI. Use relevant history to answer.

RELEVANT HISTORY:
${contextSnippets.join('\n\n')}

QUESTION: ${prompt}

Answer in 2-4 sentences, focused and specific.`;

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: phiPrompt,
        options: { timeout: 5000, maxTokens: 120, temperature: 0.2 }
      });

      if (result.success && result.response) {
        return { success: true, response: result.response };
      }

      return null;

    } catch (error) {
      console.error('❌ [SESSION-SCOPE] Error:', error.message);
      return null;
    }
  }

  // Stage 3: Cross-session semantic search with current session prioritization
  async function handleCrossSessionScope(prompt, context) {
    try {
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
        minSimilarity: 0.32
      }, {
        database: coreAgent.context?.database || coreAgent.database,
        embedder: coreAgent.getAgent('SemanticEmbeddingAgent'),
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
      const phiPrompt = `You are ThinkDrop AI. Answer based on the MOST RECENT conversation context.

RECENT CONVERSATION:
${contextItems.join('\n\n')}

CURRENT QUESTION: ${prompt}

Answer based on what was just said in this conversation. Be specific and accurate. Do not reference old conversations or make up details.`;

      const result = await phi3Agent.execute({
        action: 'query-phi3-fast',
        prompt: phiPrompt,
        options: { timeout: 5000, maxTokens: 120, temperature: 0.2 }
      });

      if (result.success && result.response) {
        return { success: true, response: result.response };
      }

      return null;

    } catch (error) {
      console.error('❌ [CROSS-SESSION] Error:', error.message);
      return null;
    }
  }

  // Hybrid classification: zero-shot primary + keyword confidence boosting
  async function classifyQuery(prompt) {
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
      
      // Stage 2: For lower confidence, check if keywords can boost confidence
      const keywords = {
        CONTEXT: [
          'what did i', 'what did you', 'what were we', 'earlier you', 'earlier i',
          'before you', 'before i', 'previous', 'recap', 'summarize our',
          'tell me what i said', 'remind me what', 'what was our'
        ],
        MEMORY: [
          'remember that', 'remember this', 'store this', 'store that',
          'save this', 'save that', 'keep this', 'keep that', 'note this',
          'note that', 'don\'t forget', 'make a note'
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

  // Zero-shot classification using transformers.js (copied from working IntentParser.cjs)
  async function classifyWithZeroShot(prompt) {
    try {
      // Initialize zero-shot classifier if not already done
      if (!global.zeroShotClassifier) {
        const { pipeline } = await import('@xenova/transformers');
        
        // Use a more accessible model that works offline
        console.log('🔄 [ZERO-SHOT] Loading zero-shot classifier (DistilBERT)...');
        global.zeroShotClassifier = await pipeline(
          'zero-shot-classification',
          'Xenova/distilbert-base-uncased-mnli'
        );
        console.log('✅ [ZERO-SHOT] Zero-shot classifier loaded');
      }
      
      // Define candidate labels for intent classification
      const candidateLabels = [
        'asking about previous conversations, messages, or what was discussed before',
        'wanting to remember, store, or save information for later',
        'requesting to write, create, generate, or build something',
        'asking a general question that needs a direct answer'
      ];
      
      // Map labels back to our categories
      const labelMap = {
        'asking about previous conversations, messages, or what was discussed before': 'CONTEXT',
        'wanting to remember, store, or save information for later': 'MEMORY',
        'requesting to write, create, generate, or build something': 'COMMAND',
        'asking a general question that needs a direct answer': 'GENERAL'
      };

      const result = await global.zeroShotClassifier(prompt, candidateLabels);
      
      if (result && result.labels && result.scores) {
        const topLabel = result.labels[0];
        const topScore = result.scores[0];
        const classification = labelMap[topLabel] || 'GENERAL';

        console.log(`🧠 [ZERO-SHOT] "${prompt}" -> ${classification} (confidence: ${topScore.toFixed(3)})`);
        return { classification, confidence: topScore };
      }
      
    } catch (error) {
      console.error('❌ [ZERO-SHOT] Error:', error.message);
      console.log('🔄 [ZERO-SHOT] Falling back to heuristics...');
      return classifyWithHeuristics(prompt);
    }
  }

  // Simple heuristic fallback
  function classifyWithHeuristics(prompt) {
    const queryLower = prompt.toLowerCase();
    
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

  async function classifyNonContextQuery(prompt) {
    // Simple classification for non-context queries
    if (prompt.toLowerCase().includes('remember') || prompt.toLowerCase().includes('store')) {
      return 'MEMORY';
    }
    return 'GENERAL';
  }

  // Non-context query handlers
  async function handleNonContextPipeline(queryType, prompt, context, startTime) {
    console.log(`🎯 [NONCONTEXT-PIPELINE] Handling ${queryType} query...`);
    
    switch (queryType) {
      case 'GENERAL':
        return await handleGeneralKnowledge(prompt, context, startTime);
      case 'MEMORY':
        return await handleMemoryStore(prompt, context, startTime);
      case 'COMMAND':
        return await handleCommand(prompt, context, startTime);
      default:
        return await handleGeneralKnowledge(prompt, context, startTime);
    }
  }

  // Ultra-fast general knowledge handler
  async function handleGeneralKnowledge(prompt, context, startTime) {
    const llmStartTime = Date.now();
    console.log('⚡ [GENERAL-ULTRA-FAST] Starting chunked response...');
    
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

      if (result.success && result.response) {
        return {
          success: true,
          response: result.response,
          pipeline: 'general_knowledge_ultra_fast',
          timing: { llm: llmTime, total: totalTime }
        };
      }

      throw new Error('No response from Phi3');

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

  // Handle memory store requests
  async function handleMemoryStore(prompt, context, startTime) {
    console.log('💾 [MEMORY-STORE] Processing information storage...');
    
    try {
      const userMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
      if (!userMemoryAgent) {
        throw new Error('UserMemoryAgent not available');
      }

      const storeResult = await userMemoryAgent.execute({
        action: 'memory-store',
        text: prompt,
        tags: ['user_input', 'stored_via_pipeline'],
        metadata: {
          pipeline: 'memory_store',
          sessionId: context.sessionId,
          timestamp: new Date().toISOString()
        }
      }, {
        database: coreAgent.context?.database || coreAgent.database,
        embedder: coreAgent.getAgent('SemanticEmbeddingAgent'),
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

  // Handle command/action requests
  async function handleCommand(prompt, context, startTime) {
    console.log('⚡ [COMMAND] Processing action request...');
    
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
        console.log(`✅ [COMMAND] Action response generated (${totalTime}ms)`);
        return {
          success: true,
          response: result.response,
          pipeline: 'command',
          timing: { total: totalTime }
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