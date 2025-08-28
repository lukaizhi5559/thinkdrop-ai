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
  ipcMain.handle('llm-query', async (event, prompt, context = {}) => {
    const startTime = Date.now();
    console.log('🚀 [NEW-PIPELINE] Starting ultra-fast pipeline...');
    console.log('🔍 [NEW-PIPELINE-DEBUG] IPC handler llm-query called with prompt:', prompt.substring(0, 50) + '...');
    
    try {
      // TIER 1: Context vs Non-Context routing (ultra-lightweight)
      const routingStartTime = Date.now();
      const contextType = await fastContextRouting(prompt);
      const routingTime = Date.now() - routingStartTime;
      console.log(`⚡ [ROUTING-T1] ${contextType} classification in ${routingTime}ms`);
      
      if (contextType === 'CONTEXT') {
        // Path 1: Progressive search pipeline
        return await handleContextPipeline(prompt, context, startTime);
      } else {
        // Path 2: Non-Context - needs secondary routing
        const subRoutingStartTime = Date.now();
        const queryType = await fastNonContextRouting(prompt);
        const subRoutingTime = Date.now() - subRoutingStartTime;
        console.log(`⚡ [ROUTING-T2] ${queryType} classification in ${subRoutingTime}ms`);
        
        const result = await handleNonContextPipeline(queryType, prompt, context, startTime);
        console.log(`🔍 [PIPELINE-RETURN] Final result:`, { success: result?.success, hasResponse: !!result?.response, responseLength: result?.response?.length });
        return result;
      }
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`❌ [NEW-PIPELINE] Error after ${totalTime}ms:`, error.message);
      return { success: false, error: error.message, timing: { total: totalTime } };
    }

    // Ultra-lightweight Phi4-mini context routing
    async function fastContextRouting(prompt, context) {
      try {
        if (!coreAgent || !coreAgent.initialized) {
          throw new Error('CoreAgent not initialized');
        }

        const phi3Agent = coreAgent.getAgent('Phi3Agent');
        if (!phi3Agent) {
          throw new Error('Phi3Agent not available');
        }

        const routingPrompt = `Classify this query:

"${prompt}"

CONTEXT: References our conversation history or stored memories
- "What did I tell you about my project?"
- "Continue our discussion about..."
- "Remember when I mentioned..."

NONCONTEXT: General knowledge or standalone questions  
- "Who is the president of Canada?"
- "What is the capital of France?"
- "How do I cook pasta?"
- "What's the weather today?"

Answer: CONTEXT or NONCONTEXT`;

        const result = await phi3Agent.execute({
          action: 'query-phi3-routing',
          prompt: routingPrompt,
          options: { 
            timeout: 2000,  // Ultra-fast routing timeout
            maxTokens: 3,   // Minimal tokens for routing
            temperature: 0.0 // Deterministic routing
          }
        });

        if (!result.success) {
          console.warn('⚠️ Routing classification failed, defaulting to NONCONTEXT');
          return 'NONCONTEXT';
        }

        const classification = result.result?.trim()?.toUpperCase()?.replace(/[^A-Z]/g, '');
        console.log(`🎯 Query classified as: ${classification}`);
        
        // Validate classification
        if (classification === 'CONTEXT' || classification === 'NONCONTEXT') {
          return classification;
        } else {
          console.warn(`⚠️ Invalid classification "${classification}", defaulting to NONCONTEXT`);
          return 'NONCONTEXT';
        }
      } catch (error) {
        console.error('❌ Fast context routing failed:', error);
        return 'NONCONTEXT'; // Safe fallback
      }
    }

    // Secondary routing for non-context queries
    async function fastNonContextRouting(prompt) {
      try {
        const phi3Agent = coreAgent.getAgent('Phi3Agent');
        if (!phi3Agent) {
          throw new Error('Phi3Agent not available');
        }

        const routingPrompt = `Classify this standalone query:

"${prompt}"

GENERAL: Factual/knowledge question
MEMORY: Store information  
COMMAND: Action/task request

Answer:`;

        const result = await phi3Agent.execute({
          action: 'query-phi3-routing',
          prompt: routingPrompt,
          options: { 
            timeout: 2000,  // Ultra-fast secondary routing
            maxTokens: 8,   // Enough for GENERAL/MEMORY/COMMAND
            temperature: 0.0
          }
        });

        if (result.success && result.response) {
          const classification = result.response.trim().toUpperCase();
          if (classification.includes('MEMORY')) return 'MEMORY';
          if (classification.includes('COMMAND')) return 'COMMAND';
          return 'GENERAL';
        }

        // Default to GENERAL for fastest path
        return 'GENERAL';

      } catch (error) {
        console.warn('⚠️ [ROUTING-T2] Error, defaulting to GENERAL:', error.message);
        return 'GENERAL';
      }
    }

    // Handle context-dependent queries (progressive search)
    async function handleContextPipeline(prompt, context, startTime) {
      console.log('🔍 [CONTEXT-PIPELINE] Starting streamlined progressive search...');
      
      try {
        // Stage 1: Current conversation scope with embeddings
        const stage1StartTime = Date.now();
        const currentScopeResult = await handleCurrentScope(prompt, context);
        const stage1Time = Date.now() - stage1StartTime;
        
        if (currentScopeResult && currentScopeResult.success) {
          const totalTime = Date.now() - startTime;
          console.log(`✅ [CONTEXT-PIPELINE] Found answer in current scope (${stage1Time}ms, total: ${totalTime}ms)`);
          return {
            success: true,
            response: currentScopeResult.response,
            pipeline: 'context_current_scope',
            timing: { stage1: stage1Time, total: totalTime }
          };
        }
        
        // Stage 2: Session-scoped semantic memory search
        const stage2StartTime = Date.now();
        const sessionScopeResult = await handleSessionScope(prompt, context);
        const stage2Time = Date.now() - stage2StartTime;
        
        if (sessionScopeResult && sessionScopeResult.success) {
          const totalTime = Date.now() - startTime;
          console.log(`✅ [CONTEXT-PIPELINE] Found answer in session scope (${stage2Time}ms, total: ${totalTime}ms)`);
          return {
            success: true,
            response: sessionScopeResult.response,
            pipeline: 'context_session_scope',
            timing: { stage1: stage1Time, stage2: stage2Time, total: totalTime }
          };
        }
        
        // Stage 3: Cross-session semantic memory search
        const stage3StartTime = Date.now();
        const crossSessionResult = await handleCrossSessionScope(prompt, context);
        const stage3Time = Date.now() - stage3StartTime;
        
        if (crossSessionResult && crossSessionResult.success) {
          const totalTime = Date.now() - startTime;
          console.log(`✅ [CONTEXT-PIPELINE] Found answer in cross-session scope (${stage3Time}ms, total: ${totalTime}ms)`);
          return {
            success: true,
            response: crossSessionResult.response,
            pipeline: 'context_cross_session',
            timing: { stage1: stage1Time, stage2: stage2Time, stage3: stage3Time, total: totalTime }
          };
        }
        
        // No context found - fallback to general knowledge pipeline
        const totalTime = Date.now() - startTime;
        console.log(`⚠️ [CONTEXT-PIPELINE] No relevant context found, falling back to general knowledge (${totalTime}ms)`);
        
        // Fallback to general knowledge pipeline
        try {
          const fallbackResult = await handleGeneralKnowledge(prompt, context, startTime);
          if (fallbackResult && fallbackResult.success) {
            return {
              ...fallbackResult,
              pipeline: 'context_fallback_to_general',
              timing: { ...fallbackResult.timing, contextAttempt: totalTime }
            };
          }
        } catch (fallbackError) {
          console.error('❌ [CONTEXT-FALLBACK] General knowledge fallback failed:', fallbackError.message);
        }
        
        return {
          success: true,
          response: "I don't have enough context from our previous conversations to answer that question. Could you provide more details?",
          pipeline: 'context_no_results',
          timing: { stage1: stage1Time, stage2: stage2Time, stage3: stage3Time, total: totalTime }
        };
        
      } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ [CONTEXT-PIPELINE] Error after ${totalTime}ms:`, error.message);
        return { success: false, error: error.message, timing: { total: totalTime } };
      }
    }

    // Helper: Handle current conversation scope with embeddings
    async function handleCurrentScope(prompt, context) {
      try {
        const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
        const embeddingAgent = coreAgent.getAgent('SemanticEmbeddingAgent');
        const phi3Agent = coreAgent.getAgent('Phi3Agent');
        
        if (!conversationAgent || !embeddingAgent || !phi3Agent) {
          console.warn('⚠️ [CURRENT-SCOPE] Required agents not available');
          return null;
        }

        // Get current session ID
        const sessionsResult = await conversationAgent.execute({
          action: 'session-list',
          limit: 1,
          offset: 0
        });

        if (!sessionsResult?.success || !sessionsResult?.data?.sessions?.length) {
          console.warn('⚠️ [CURRENT-SCOPE] No active session found');
          return null;
        }

        const currentSessionId = sessionsResult.data.sessions[0].id;
        
        // Get conversation messages with embeddings
        const messagesResult = await conversationAgent.execute({
          action: 'messages-with-embeddings',
          sessionId: currentSessionId,
          limit: 20
        });

        if (!messagesResult?.success || !messagesResult?.result?.messages?.length) {
          console.warn('⚠️ [CURRENT-SCOPE] No messages with embeddings found');
          return null;
        }

        // Generate embedding for prompt
        const promptEmbeddingResult = await embeddingAgent.execute({
          action: 'generate-embedding',
          text: prompt
        });

        if (!promptEmbeddingResult?.success) {
          console.warn('⚠️ [CURRENT-SCOPE] Failed to generate prompt embedding');
          return null;
        }

        const promptEmbedding = promptEmbeddingResult.embedding;
        const messages = messagesResult.result.messages;
        
        // Calculate semantic similarity and filter relevant messages
        const relevantMessages = [];
        for (const msg of messages) {
          if (!msg.embedding || msg.embedding === 'NULL') continue;
          
          let msgEmbedding;
          try {
            msgEmbedding = typeof msg.embedding === 'string' ? JSON.parse(msg.embedding) : msg.embedding;
          } catch (e) {
            continue;
          }

          // Calculate cosine similarity
          const similarity = calculateCosineSimilarity(promptEmbedding, msgEmbedding);
          if (similarity >= 0.18) {
            relevantMessages.push({
              ...msg,
              similarity,
              text: msg.text || msg.source_text
            });
          }
        }

        if (relevantMessages.length === 0) {
          console.warn('⚠️ [CURRENT-SCOPE] No semantically relevant messages found');
          return null;
        }

        // Sort by similarity and build context
        relevantMessages.sort((a, b) => b.similarity - a.similarity);
        const contextMessages = relevantMessages.slice(0, 8);
        
        // Build conversation context
        const conversationContext = contextMessages
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          .map(msg => `${msg.sender}: ${msg.text}`)
          .join('\n');

        // Generate response using context
        const phiPrompt = `You are ThinkDrop AI. Answer based on our recent conversation.

RECENT CONVERSATION:
${conversationContext}

QUESTION: ${prompt}

Be concise (2-4 sentences).`;

        const result = await phi3Agent.execute({
          action: 'query-phi3-fast',
          prompt: phiPrompt,
          options: { timeout: 10000, maxTokens: 150, temperature: 0.2 }
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

    // Helper: Handle session-scoped semantic memory search
    async function handleSessionScope(prompt, context) {
      try {
        const userMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
        const phi3Agent = coreAgent.getAgent('Phi3Agent');
        
        if (!userMemoryAgent || !phi3Agent) {
          console.warn('⚠️ [SESSION-SCOPE] Required agents not available');
          return null;
        }

        // Get current session ID for scoped search
        const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
        let sessionId = null;
        
        if (conversationAgent) {
          const sessionsResult = await conversationAgent.execute({
            action: 'session-list',
            limit: 1,
            offset: 0
          });
          
          if (sessionsResult?.success && sessionsResult?.data?.sessions?.length) {
            sessionId = sessionsResult.data.sessions[0].id;
          }
        }

        // Perform session-scoped semantic search
        const searchResult = await userMemoryAgent.execute({
          action: 'memory-semantic-search',
          query: prompt,
          limit: 20,
          minSimilarity: 0.26,
          sessionId: sessionId
        }, {
          database: coreAgent.database,
          embedder: coreAgent.getAgent('SemanticEmbeddingAgent')
        });

        if (!searchResult?.success || !searchResult?.result?.results?.length) {
          console.warn('⚠️ [SESSION-SCOPE] No relevant memories found');
          return null;
        }

        const memories = searchResult.result.results;
        const topSimilarity = memories[0].similarity;
        const avgTop3 = memories.slice(0, 3).reduce((s, m) => s + m.similarity, 0) / Math.min(3, memories.length);
        
        // Check if similarity is sufficient
        if (topSimilarity < 0.28 && avgTop3 < 0.25) {
          console.warn('⚠️ [SESSION-SCOPE] Similarity too low');
          return null;
        }

        // Build memory snippets
        const memorySnippets = memories.slice(0, 3).map((m, i) => {
          const text = (m.source_text || '').slice(0, 220);
          return `Memory ${i + 1} (${Math.round((m.similarity || 0) * 100)}%): ${text}${(m.source_text || '').length > 220 ? '...' : ''}`;
        });

        // Generate response using memory context
        const phiPrompt = `You are ThinkDrop AI. Use relevant history to answer.

RELEVANT HISTORY:
${memorySnippets.join('\n\n')}

QUESTION: ${prompt}

Answer in 2-4 sentences, focused and specific.`;

        const result = await phi3Agent.execute({
          action: 'query-phi3-fast',
          prompt: phiPrompt,
          options: { timeout: 12000, maxTokens: 150, temperature: 0.2 }
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

    // Helper: Handle cross-session semantic memory search
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
          database: coreAgent.database,
          embedder: coreAgent.getAgent('SemanticEmbeddingAgent')
        });

        if (!searchResult?.success || !searchResult?.result?.results?.length) {
          console.warn('⚠️ [CROSS-SESSION] No relevant memories found');
          return null;
        }

        const memories = searchResult.result.results;
        const topSimilarity = memories[0].similarity;
        const avgTop3 = memories.slice(0, 3).reduce((s, m) => s + m.similarity, 0) / Math.min(3, memories.length);
        
        // Check if similarity is sufficient for cross-session
        if (topSimilarity < 0.34 && avgTop3 < 0.30) {
          console.warn('⚠️ [CROSS-SESSION] Similarity too low');
          return null;
        }

        // Build memory snippets
        const memorySnippets = memories.slice(0, 3).map((m, i) => {
          const text = (m.source_text || '').slice(0, 220);
          return `Memory ${i + 1} (${Math.round((m.similarity || 0) * 100)}%): ${text}${(m.source_text || '').length > 220 ? '...' : ''}`;
        });

        // Generate response using cross-session memory context
        const phiPrompt = `You are ThinkDrop AI. Use relevant history to answer.

RELEVANT HISTORY:
${memorySnippets.join('\n\n')}

QUESTION: ${prompt}

Answer in 2-4 sentences, focused and specific.`;

        const result = await phi3Agent.execute({
          action: 'query-phi3-fast',
          prompt: phiPrompt,
          options: { timeout: 12000, maxTokens: 150, temperature: 0.2 }
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

    // Helper: Calculate cosine similarity between two vectors
    function calculateCosineSimilarity(vecA, vecB) {
      if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
        return 0;
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }

      normA = Math.sqrt(normA);
      normB = Math.sqrt(normB);

      if (normA === 0 || normB === 0) {
        return 0;
      }

      return dotProduct / (normA * normB);
    }

    // Handle non-context queries (general, memory, command)
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
      console.log('📚 [GENERAL] Direct Phi4-mini call...');
      
      try {
        const phi3Agent = coreAgent.getAgent('Phi3Agent');
        if (!phi3Agent) {
          throw new Error('Phi3Agent not available');
        }

        const result = await phi3Agent.execute({
          action: 'query-phi3-fast',
          prompt: `You are ThinkDrop AI. Answer this general knowledge question concisely (2-3 sentences):

${prompt}`,
          options: { 
            timeout: 6000, // Reduced from 8000ms for faster responses
            maxTokens: 120, // Slightly reduced for faster generation
            temperature: 0.2 // Reduced for more focused responses
          }
        });

        const llmTime = Date.now() - llmStartTime;
        const totalTime = Date.now() - startTime;
        
        console.log(`✅ [GENERAL] Response generated in ${llmTime}ms (total: ${totalTime}ms)`);
        console.log(`🔍 [GENERAL-DEBUG] Result:`, { success: result.success, hasResponse: !!result.response, responseLength: result.response?.length });

        if (result.success && result.response) {
          return {
            success: true,
            response: result.response,
            pipeline: 'general_knowledge',
            timing: { llm: llmTime, total: totalTime }
          };
        }

        console.error(`❌ [GENERAL-DEBUG] Invalid result:`, result);
        throw new Error('Failed to generate response');

      } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ [GENERAL] Error after ${totalTime}ms:`, error.message);
        return { success: false, error: error.message, timing: { total: totalTime } };
      }
    }

    // Handle memory store requests
    async function handleMemoryStore(prompt, context, startTime) {
      const storeStartTime = Date.now();
      console.log('💾 [MEMORY-STORE] Processing information storage...');
      
      try {
        const userMemoryAgent = coreAgent.getAgent('UserMemoryAgent');
        if (!userMemoryAgent) {
          throw new Error('UserMemoryAgent not available');
        }

        // Get current session ID for context
        const conversationAgent = coreAgent.getAgent('ConversationSessionAgent');
        let sessionId = null;
        
        if (conversationAgent) {
          const sessionsResult = await conversationAgent.execute({
            action: 'session-list',
            limit: 1,
            offset: 0
          });
          
          if (sessionsResult?.success && sessionsResult?.data?.sessions?.length) {
            sessionId = sessionsResult.data.sessions[0].id;
          }
        }

        // Store the information in memory
        const storeResult = await userMemoryAgent.execute({
          action: 'memory-store',
          text: prompt,
          tags: ['user_input', 'stored_via_pipeline'],
          metadata: {
            pipeline: 'memory_store',
            sessionId: sessionId,
            timestamp: new Date().toISOString(),
            source: 'llm_query_pipeline'
          }
        }, {
          database: coreAgent.database,
          embedder: coreAgent.getAgent('SemanticEmbeddingAgent')
        });

        const storeTime = Date.now() - storeStartTime;
        const totalTime = Date.now() - startTime;

        if (storeResult.success) {
          console.log(`✅ [MEMORY-STORE] Information stored successfully (${storeTime}ms, total: ${totalTime}ms)`);
          return {
            success: true,
            response: 'Information stored successfully in your memory. I can reference this in future conversations.',
            pipeline: 'memory_store',
            timing: { store: storeTime, total: totalTime }
          };
        } else {
          throw new Error(storeResult.error || 'Failed to store information');
        }

      } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ [MEMORY-STORE] Error after ${totalTime}ms:`, error.message);
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
      const commandStartTime = Date.now();
      console.log('⚡ [COMMAND] Processing action request...');
      
      try {
        const phi3Agent = coreAgent.getAgent('Phi3Agent');
        if (!phi3Agent) {
          throw new Error('Phi3Agent not available');
        }

        // Generate command response with action-oriented prompt
        const result = await phi3Agent.execute({
          action: 'query-phi3-fast',
          prompt: `You are ThinkDrop AI. The user is requesting an action or task. Provide a helpful response about what you can do or guide them on next steps.

User request: ${prompt}

Respond concisely (2-3 sentences) with actionable guidance.`,
          options: { 
            timeout: 8000, 
            maxTokens: 120, 
            temperature: 0.2
          }
        });

        const commandTime = Date.now() - commandStartTime;
        const totalTime = Date.now() - startTime;

        if (result.success && result.response) {
          console.log(`✅ [COMMAND] Action response generated (${commandTime}ms, total: ${totalTime}ms)`);
          return {
            success: true,
            response: result.response,
            pipeline: 'command',
            timing: { command: commandTime, total: totalTime }
          };
        } else {
          throw new Error('Failed to generate command response');
        }

      } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ [COMMAND] Error after ${totalTime}ms:`, error.message);
        return { 
          success: false, 
          error: error.message,
          pipeline: 'command',
          timing: { total: totalTime }
        };
      }
    }
  });
      
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