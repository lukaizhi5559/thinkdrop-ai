/**
 * Answer Node
 * Generates answer using LLM with filtered context
 * Supports both Private Mode (local Phi4) and Online Mode (backend LLM)
 * 
 * HYBRID MULTI-STEP ACTIONS:
 * - Detects multi-step queries (e.g., "find X and click Y")
 * - Uses screen-intelligence-service for semantic element search
 * - Uses command-service for action execution
 * - Falls back to LLM if automation fails
 */

/**
 * Detect if query requires multi-step actions
 * @param {string} query - User query
 * @returns {boolean} - True if multi-step action is needed
 */
const logger = require('./../../../logger.cjs');
function detectMultiStepQuery(query) {
  const multiStepPatterns = [
    // Find and action patterns
    /find .+ and (click|reply|open|send|type|press)/i,
    /search .+ and (click|select|open)/i,
    /locate .+ and (click|activate)/i,
    
    // Open and action patterns
    /open .+ and (disable|enable|change|turn|set|click)/i,
    
    // Type and action patterns
    /type .+ and (click|submit|send|press)/i,
    /enter .+ and (click|submit)/i,
    
    // Email/communication patterns
    /reply to/i,
    /forward .+ to/i,
    /compose .+ to/i,
    /send .+ to/i,
    
    // Navigation patterns
    /go to .+ and (click|open|select)/i,
    /navigate to .+ and/i,
    
    // Multiple action indicators
    /then (click|type|press|open|select)/i,
    /after that/i,
    /next (click|type|press)/i
  ];
  
  return multiStepPatterns.some(pattern => pattern.test(query));
}

/**
 * Execute hybrid multi-step workflow
 * Uses screen-intelligence for finding + command-service for execution
 * @param {string} query - User query
 * @param {Object} state - Current state with screenContext
 * @param {Object} mcpClient - MCP client for service communication
 * @returns {Promise<Object>} - { success, message, steps, error }
 */
async function executeHybridMultiStep(query, state, mcpClient) {
  const startTime = Date.now();
  
  try {
    logger.debug('🔄 [HYBRID] Starting hybrid multi-step execution');
    logger.debug(`   Query: "${query}"`);
    
    // Step 1: Use screen-intelligence service to find UI elements with semantic search
    logger.debug('🔍 [HYBRID] Step 1: Finding UI elements with semantic search...');
    
    // Extract search terms from query (simple heuristic)
    const searchTerms = extractSearchTerms(query);
    logger.debug(`   Search terms: ${searchTerms.join(', ')}`);
    
    // Call screen-intelligence service via MCP to search for elements
    const foundElements = [];
    for (const term of searchTerms) {
      try {
        const searchResult = await mcpClient.callService('screen-intelligence', 'element.search', {
          query: term,
          k: 3, // Get top 3 matches
          minScore: 0.5,
          screenContext: state.screenContext
        });
        
        const results = searchResult.data?.results || searchResult.results || [];
        
        if (results.length > 0) {
          const topResult = results[0];
          logger.debug(`   ✅ Found "${term}": ${topResult.type} (score: ${topResult.score.toFixed(3)})`);
          foundElements.push({
            searchTerm: term,
            element: topResult,
            score: topResult.score,
            alternatives: results.slice(1)
          });
        } else {
          logger.warn(`   ⚠️ Not found: "${term}"`);
        }
      } catch (error) {
        logger.error(`   ❌ Error searching for "${term}":`, error.message);
      }
    }
    
    // Step 2: Enrich query with element coordinates for command-service
    logger.debug('📝 [HYBRID] Step 2: Enriching command with element coordinates...');
    
    const enrichedContext = {
      os: process.platform,
      screenContext: state.screenContext,
      foundElements: foundElements.map(fe => ({
        term: fe.searchTerm,
        type: fe.element.type,
        text: fe.element.text,
        coordinates: {
          x: Math.round((fe.element.bbox[0] + fe.element.bbox[2]) / 2),
          y: Math.round((fe.element.bbox[1] + fe.element.bbox[3]) / 2)
        },
        bbox: fe.element.bbox,
        score: fe.score
      })),
      useSemanticSearch: true,
      semanticSearchAvailable: true
    };
    
    // Step 3: Call command-service via MCP with enriched context
    logger.debug('🚀 [HYBRID] Step 3: Executing via command-service MCP...');
    
    if (!mcpClient) {
      throw new Error('MCP client not available');
    }
    
    const result = await mcpClient.callService('command', 'command.automate', {
      command: query,
      context: enrichedContext
    });
    
    const totalTime = Date.now() - startTime;
    
    if (result.success) {
      logger.debug(`✅ [HYBRID] Workflow completed in ${totalTime}ms`);
      return {
        success: true,
        message: result.result || result.message,
        foundElements: foundElements,
        executionTime: totalTime,
        metadata: result.metadata
      };
    } else {
      logger.error(`❌ [HYBRID] Workflow failed: ${result.error}`);
      return {
        success: false,
        error: result.error,
        foundElements: foundElements,
        executionTime: totalTime
      };
    }
    
  } catch (error) {
    logger.error('❌ [HYBRID] Execution error:', error);
    return {
      success: false,
      error: error.message,
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Extract search terms from natural language query
 * @param {string} query - User query
 * @returns {Array<string>} - Extracted search terms
 */
function extractSearchTerms(query) {
  const terms = [];
  const pronouns = ['it', 'this', 'that', 'them', 'these', 'those'];
  
  // Pattern 1: "find X and Y" -> extract X
  const findMatch = query.match(/find\s+(?:the\s+)?(.+?)\s+and\s+/i);
  if (findMatch) {
    terms.push(findMatch[1].trim());
  }
  
  // Pattern 2: "click X" (standalone or at end)
  const clickMatch = query.match(/click\s+(?:the\s+)?(.+?)(?:\s+and\s+|$)/i);
  if (clickMatch && !terms.includes(clickMatch[1].trim())) {
    const term = clickMatch[1].trim();
    if (!pronouns.includes(term.toLowerCase())) {
      terms.push(term);
    }
  }
  
  // Pattern 3: "reply to X"
  const replyMatch = query.match(/reply\s+to\s+(?:the\s+)?(.+?)(?:\s+and\s+|$)/i);
  if (replyMatch && !terms.includes(replyMatch[1].trim())) {
    const term = replyMatch[1].trim();
    if (!pronouns.includes(term.toLowerCase())) {
      terms.push(term);
    }
  }
  
  // Pattern 4: "open X"
  const openMatch = query.match(/open\s+(?:the\s+)?(.+?)(?:\s+and\s+|$)/i);
  if (openMatch && !terms.includes(openMatch[1].trim())) {
    const term = openMatch[1].trim();
    if (!pronouns.includes(term.toLowerCase())) {
      terms.push(term);
    }
  }
  
  // Pattern 5: "type X"
  const typeMatch = query.match(/type\s+['"]([^'"]+)['"]/i);
  if (typeMatch && !terms.includes(typeMatch[1].trim())) {
    terms.push(typeMatch[1].trim());
  }
  
  // Fallback: if no patterns matched, use the whole query
  if (terms.length === 0) {
    terms.push(query);
  }
  
  return terms;
}


/**
 * Detect context switching and filter conversation history
 * Uses semantic similarity to determine message relevance
 * 
 * NOTE: The retrieveMemory node already does semantic search on conversation history,
 * so conversationHistory should already be semantically relevant. However, we still
 * need to filter out messages from completely different topics when context switches.
 */
function detectContextSwitch(conversationHistory, currentMessage) {
  if (!conversationHistory || conversationHistory.length === 0) {
    return [];
  }

  // Always keep the last 2 exchanges (4 messages) for immediate context
  const IMMEDIATE_CONTEXT_SIZE = 4;
  const MIN_RELEVANCE_SCORE = 0.3; // Threshold for considering a message relevant
  
  // If we have 4 or fewer messages total, just return all of them
  if (conversationHistory.length <= IMMEDIATE_CONTEXT_SIZE) {
    logger.debug(`🔄 [CONTEXT-SWITCH] Small history (${conversationHistory.length} messages), using all`);
    return conversationHistory;
  }
  
  // For longer histories, score each message by relevance to current query
  const scoredMessages = conversationHistory.map((msg, index) => {
    const isRecent = index >= conversationHistory.length - IMMEDIATE_CONTEXT_SIZE;
    
    // Recent messages always get high score
    if (isRecent) {
      return { msg, index, score: 1.0, reason: 'recent' };
    }
    
    // Score older messages by semantic similarity (simple word overlap)
    const score = calculateMessageRelevance(msg.content, currentMessage);
    return { msg, index, score, reason: score >= MIN_RELEVANCE_SCORE ? 'relevant' : 'irrelevant' };
  });
  
  // Filter to keep only relevant messages
  const relevantMessages = scoredMessages
    .filter(item => item.score >= MIN_RELEVANCE_SCORE)
    .map(item => item.msg);
  
  // Count how many older messages were filtered out
  const olderMessagesCount = conversationHistory.length - IMMEDIATE_CONTEXT_SIZE;
  const keptOlderMessages = relevantMessages.length - IMMEDIATE_CONTEXT_SIZE;
  const filteredCount = olderMessagesCount - keptOlderMessages;
  
  if (filteredCount > 0) {
    logger.debug(`🔄 [CONTEXT-SWITCH] Filtered out ${filteredCount} irrelevant older messages`);
    logger.debug(`   Kept: ${relevantMessages.length}/${conversationHistory.length} messages (${IMMEDIATE_CONTEXT_SIZE} recent + ${keptOlderMessages} relevant older)`);
  } else {
    logger.debug(`🔄 [CONTEXT-SWITCH] All messages relevant, kept ${relevantMessages.length}/${conversationHistory.length}`);
  }
  
  return relevantMessages;
}

/**
 * Calculate semantic relevance between two messages using word overlap
 * Returns a score between 0 and 1
 */
function calculateMessageRelevance(messageText, queryText) {
  if (!messageText || !queryText) return 0;
  
  // Common stop words to ignore
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
    'can', 'what', 'when', 'where', 'who', 'which', 'how', 'why', 'this',
    'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their'
  ]);
  
  // Extract meaningful words (3+ chars, not stop words)
  const extractWords = (text) => {
    return text.toLowerCase()
      .match(/\b[a-z]{3,}\b/g)
      ?.filter(word => !stopWords.has(word)) || [];
  };
  
  const messageWords = new Set(extractWords(messageText));
  const queryWords = new Set(extractWords(queryText));
  
  if (messageWords.size === 0 || queryWords.size === 0) return 0;
  
  // Calculate Jaccard similarity (intersection / union)
  const intersection = new Set([...messageWords].filter(word => queryWords.has(word)));
  const union = new Set([...messageWords, ...queryWords]);
  
  const jaccardScore = intersection.size / union.size;
  
  // Boost score if there are exact phrase matches (2+ word sequences)
  const messageLower = messageText.toLowerCase();
  const queryLower = queryText.toLowerCase();
  
  // Extract 2-word phrases from query
  const queryPhrases = [];
  const queryWordArray = extractWords(queryText);
  for (let i = 0; i < queryWordArray.length - 1; i++) {
    queryPhrases.push(`${queryWordArray[i]} ${queryWordArray[i + 1]}`);
  }
  
  // Check if any query phrases appear in message
  const phraseMatches = queryPhrases.filter(phrase => messageLower.includes(phrase));
  const phraseBoost = phraseMatches.length > 0 ? 0.3 : 0;
  
  return Math.min(1.0, jaccardScore + phraseBoost);
}

module.exports = async function answer(state) {
  const { 
    mcpClient, 
    message, 
    resolvedMessage, // Use resolved message if available
    context, 
    intent,
    conversationHistory = [],
    sessionFacts = [],
    sessionEntities = [],
    filteredMemories = [], // Use filtered memories instead of raw memories
    contextDocs = [], // Web search results
    streamCallback = null, // Optional callback for streaming tokens
    retryCount = 0, // Track if this is a retry
    useOnlineMode = false, // 🌐 NEW: Flag to use online LLM instead of local Phi4
    commandOutput = null, // Raw command output to interpret
    executedCommand = null, // The shell command that was executed
    needsInterpretation = false // Flag indicating command output needs interpretation
  } = state;
  
  // DEBUG: Log incoming message types
  logger.debug('🔍 [NODE:ANSWER] Incoming message types:', {
    message: typeof message,
    resolvedMessage: typeof resolvedMessage,
    context: typeof context,
    messagePreview: typeof message === 'string' ? message.substring(0, 100) : JSON.stringify(message).substring(0, 100)
  });
  
  // For screen intelligence, use original message (coreference resolution can confuse "this" references to screen content)
  // For other intents, use resolved message (after coreference resolution)
  let queryMessage = (intent?.type === 'screen_intelligence') ? message : (resolvedMessage || message);
  
  // SAFETY: Ensure queryMessage is always a string
  if (typeof queryMessage !== 'string') {
    logger.warn('⚠️  [NODE:ANSWER] queryMessage is not a string, converting:', typeof queryMessage);
    logger.warn('   Original value:', queryMessage);
    queryMessage = typeof queryMessage === 'object' ? JSON.stringify(queryMessage) : String(queryMessage);
  }

  // 🔄 CONTEXT SWITCHING DETECTION
  // Detect if the user has switched topics and filter conversation history accordingly
  const filteredHistory = detectContextSwitch(conversationHistory, queryMessage);

  // Only stream on first attempt, not on retries (prevents double responses)
  const isStreaming = typeof streamCallback === 'function' && retryCount === 0;
  
  // 🌐 Determine which LLM to use
  const llmMode = useOnlineMode ? 'ONLINE' : 'PRIVATE';
  logger.debug(`💬 [NODE:ANSWER] Generating answer... (mode: ${llmMode}, streaming: ${isStreaming}, retry: ${retryCount})`);
  logger.debug(`📊 [NODE:ANSWER] Context: ${conversationHistory.length} total → ${filteredHistory.length} filtered messages, ${filteredMemories.length} memories, ${contextDocs.length} web results`);
  console.log(`📊 [NODE:ANSWER] History: ${conversationHistory.length} total → ${filteredHistory.length} filtered messages, ${filteredMemories.length} memories, ${contextDocs.length} web results`);
  
  // 🔧 Check if we need to interpret command output
  // Let phi4 handle all interpretation - no pre-processing needed
  let processedOutput = commandOutput; // Create mutable copy
  
  try {
    // ═══════════════════════════════════════════════════════════
    // Build INTENT-DRIVEN system instructions
    // 
    // DESIGN PRINCIPLE: Only include instructions relevant to the current intent
    // This reduces token usage, improves model focus, and prevents instruction dilution
    // 
    // Structure:
    // 1. Base instructions (always included)
    // 2. Follow-up question handling (if conversation history exists)
    // 3. Intent-specific instructions (only ONE of these):
    //    - screen_intelligence: Screen reading and UI element extraction
    //    - web_search: Using web search results
    //    - memory_retrieve: Using stored memories
    //    - question: Generic factual questions
    // 4. Special cases (command interpretation, meta-questions)
    // ═══════════════════════════════════════════════════════════
    
    // 🚀 ULTRA-LIGHTWEIGHT SYSTEM INSTRUCTIONS
    // The LLM's ONLY job is to format the provided context into a natural response
    // All the heavy lifting (semantic search, filtering, ranking) is done by other services
    
    let systemInstructions = `Answer using the provided context. Be direct and natural.

Context:`;
    
    // List what context is available
    const contextSources = [];
    if (filteredMemories && filteredMemories.length > 0) {
      contextSources.push(`- ${filteredMemories.length} user memories from past conversations`);
    }
    if (contextDocs && contextDocs.length > 0) {
      contextSources.push(`- ${contextDocs.length} web search results`);
    }
    if (state.screenContext) {
      contextSources.push('- Screen content analysis');
    }
    if (filteredHistory && filteredHistory.length > 0) {
      contextSources.push(`- ${filteredHistory.length} conversation messages`);
    }
    
    if (contextSources.length > 0) {
      systemInstructions += '\n' + contextSources.join('\n');
    } else {
      systemInstructions += '\n- No additional context';
    }
    
    systemInstructions += `

Rules:`;
    
    // Intent-specific rules (minimal - semantic search already filtered)
    if (intent?.type === 'web_search' || intent?.type === 'search' || intent?.type === 'lookup') {
      systemInstructions += `
- Answer using the web search results
- Be factual and direct`;
    } else if (intent?.type === 'screen_intelligence' || intent?.type === 'vision') {
      systemInstructions += `
- Describe the screen content
- Be specific about visible elements`;
    } else if (intent?.type === 'command_execute' || intent?.type === 'command_guide') {
      systemInstructions += `
- Interpret the command output as human-readable information
- Command output may include: timestamps, file listings, file paths, system info, or error messages
- Convert technical output (like timestamps, file paths) into natural language
- For timestamps: convert to readable time format (e.g., "4:39 PM on Tuesday, November 26, 2025")
- For file listings: summarize the files/folders found
- For paths: explain what the path represents
- Be clear, concise, and helpful`;
    } else if (intent?.type === 'memory_store' || intent?.type === 'memory_retrieve') {
      systemInstructions += `
- Use the provided memories
- Be accurate and helpful`;
    } else {
      systemInstructions += `
- Use the provided context
- Be helpful and concise`;
    }

    console.log(`📋 [NODE:ANSWER] System instructions for intent '${intent?.type}':`, systemInstructions);

    // ═══════════════════════════════════════════════════════════
    // MULTI-STEP ACTION DETECTION (HYBRID APPROACH)
    // ═══════════════════════════════════════════════════════════
    
    // Check if query requires multi-step actions (e.g., "find X and click Y")
    if (state.intent?.type === 'screen_intelligence' && state.screenContext) {
      const requiresMultiStep = detectMultiStepQuery(queryMessage);
      
      if (requiresMultiStep) {
        logger.debug('🎯 [NODE:ANSWER] Multi-step query detected, using hybrid approach');
        
        try {
          // Execute hybrid multi-step workflow
          const result = await executeHybridMultiStep(queryMessage, state, mcpClient);
          
          if (result.success) {
            logger.debug('✅ [NODE:ANSWER] Multi-step workflow completed successfully');
            return {
              ...state,
              answer: result.message,
              multiStepResult: result,
              skipLLM: true // Skip LLM generation since we have the result
            };
          } else {
            logger.warn('⚠️ [NODE:ANSWER] Multi-step workflow failed, falling back to LLM');
            // Fall through to LLM generation with error context
            systemInstructions += `\n\n⚠️ Note: I attempted to execute this as a multi-step workflow but encountered an error: ${result.error}. Please provide a text-based response instead.`;
          }
        } catch (error) {
          logger.error('❌ [NODE:ANSWER] Multi-step execution error:', error);
          systemInstructions += `\n\n⚠️ Note: Multi-step execution failed: ${error.message}. Providing text-based response instead.`;
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════
    // SPECIAL CASES ONLY (keep minimal)
    // ═══════════════════════════════════════════════════════════
    
    // Command output interpretation (keep this - it's useful)
    if (needsInterpretation) {
      systemInstructions += `\n\nCommand output interpretation: Answer in 1 sentence based on the command output below.`;
    }

    // Mark most recent user message for meta-questions
    let processedHistory = [...filteredHistory];
    if (queryMessage.toLowerCase().includes('what did i')) {
      // Find the previous user message (excluding current one which is the LAST in chronological order)
      // conversationHistory is now in chronological order (oldest → newest)
      let userMessageCount = 0;
      let targetIndex = -1;
      
      // Iterate backwards to find the second-to-last user message
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'user') {
          userMessageCount++;
          if (userMessageCount === 2) {
            // This is the second-to-last user message (the one before current)
            targetIndex = i;
            break;
          }
        }
      }
      
      if (targetIndex !== -1) {
        // Mark the previous user message by index (more reliable than object comparison)
        processedHistory = conversationHistory.map((m, idx) => 
          idx === targetIndex 
            ? { ...m, content: `[MOST RECENT USER MESSAGE] ${m.content}` }
            : m
        );
      }
    }

    // Prepare payload for phi4
    // 🎯 OPTIMIZATION: For commands with interpreted output, skip extra context
    // The command service already interpreted the output, so we don't need
    // conversation history, memories, or web results
    const isCommandWithInterpretedOutput = needsInterpretation && processedOutput;
    
    // 🎯 INTELLIGENT TOKEN ALLOCATION: Adjust maxTokens based on intent type
    const getTokenLimitForIntent = (intentType, isFastMode) => {
      // Intent-specific token limits (min:max for fast:normal mode)
      const intentTokenLimits = {
        'screen_intelligence': { fast: 200, normal: 600 },  // Detailed screen descriptions
        'web_search': { fast: 150, normal: 500 },           // Factual answers with sources
        'general_knowledge': { fast: 100, normal: 400 },    // Concise factual responses
        'command_execute': { fast: 50, normal: 150 },       // Brief command confirmations
        'command_guide': { fast: 150, normal: 500 },        // Step-by-step instructions
        'memory_store': { fast: 30, normal: 100 },          // Quick confirmations
        'memory_retrieve': { fast: 100, normal: 300 },      // Retrieved facts
        'question': { fast: 100, normal: 400 },             // General Q&A
        'greeting': { fast: 30, normal: 80 }                // Short greetings
      };
      
      const limits = intentTokenLimits[intentType] || { fast: 150, normal: 500 }; // Default
      return isFastMode ? limits.fast : limits.normal;
    };
    
    // Prepare the query - add context directly to query for vision/screen intents
    let finalQuery = queryMessage;
    if (state.visualContext && state.intent?.type === 'vision') {
      finalQuery = `${queryMessage}\n\n${state.visualContext}`;
      logger.debug('👁️  [NODE:ANSWER] Added visual context directly to query for vision intent');
    } else if (state.context) {
      // Generic context from other nodes (including screen_intelligence)
      // The screenIntelligence node already built the appropriate context
      
      // SAFETY: Ensure context is a string, not an object
      const contextStr = typeof state.context === 'string' 
        ? state.context 
        : JSON.stringify(state.context);
      
      if (typeof state.context !== 'string') {
        logger.warn('⚠️  [NODE:ANSWER] state.context is not a string, converting:', typeof state.context);
      }
      
      finalQuery = `${queryMessage}\n\n${contextStr}`;
      logger.debug('📋 [NODE:ANSWER] Added context to query');
      
      // Log which strategy was used
      if (state.useSimpleContext) {
        logger.debug('   Strategy: Simple context (llmContext)');
      } else if (state.screenContext) {
        logger.debug('   Strategy: Semantic search');
      }
    }
    
    // 🚀 Determine if we should use fast mode
    // Use fast mode for simple queries without much context
    const hasMinimalContext = (filteredMemories?.length || 0) === 0 && 
                               (contextDocs?.length || 0) === 0 && 
                               (processedHistory?.length || 0) <= 2;
    const isSimpleQuery = queryMessage.length < 100 && !needsInterpretation;
    const useFastMode = hasMinimalContext && isSimpleQuery;
    
    // Calculate intelligent token limit based on intent
    const intentType = intent?.type || 'question'; // Default to 'question' if no intent
    const maxTokens = getTokenLimitForIntent(intentType, useFastMode);
    
    if (useFastMode) {
      logger.debug(`⚡ [NODE:ANSWER] Using FAST MODE - minimal context, simple query (${maxTokens} tokens for ${intentType})`);
    } else {
      logger.debug(`🎯 [NODE:ANSWER] Using NORMAL MODE (${maxTokens} tokens for ${intentType})`);
    }

    console.log('🌊 [NODE:ANSWER] Processed Output:', processedOutput);
    
    const payload = {
      query: needsInterpretation && processedOutput && processedOutput.trim().length > 0
        ? `Interpret this command output:\n\n${processedOutput.substring(0, 5000)}` // Truncate very long output
        : needsInterpretation && (!processedOutput || processedOutput.trim().length === 0)
        ? `The command "${executedCommand}" executed successfully with no output. Provide a brief confirmation.`
        : finalQuery,
      context: {
        // For commands with interpreted output, only include minimal context
        // Use filteredHistory which has context switching applied
        conversationHistory: isCommandWithInterpretedOutput ? [] : processedHistory,
        sessionFacts: isCommandWithInterpretedOutput ? [] : sessionFacts,
        sessionEntities: isCommandWithInterpretedOutput ? [] : sessionEntities,
        memories: isCommandWithInterpretedOutput ? [] : filteredMemories,
        webSearchResults: isCommandWithInterpretedOutput ? [] : contextDocs,
        systemInstructions,
        sessionId: context.sessionId,
        userId: context.userId,
        intent: intent?.type, // Pass intent type for better query classification
        // Add command context if interpreting
        ...(needsInterpretation && {
          commandContext: {
            originalQuery: queryMessage,
            executedCommand,
            outputLength: processedOutput?.length || 0
          }
        })
      },
      // 🚀 Add performance options with intelligent token allocation
      options: {
        fastMode: useFastMode,           // Skip heavy system prompts in Phi4
        maxTokens,                       // 🎯 Intent-based token limit (30-600 depending on intent)
        temperature: 0.1,                // Deterministic
        contextLength: 2048              // Larger context window for screen content
      }
    };

    let finalAnswer;
    let answerData;

    // 🌐 ROUTE TO ONLINE OR PRIVATE LLM
    if (useOnlineMode) {
      // ═══════════════════════════════════════════════════════════
      // 🌐 ONLINE MODE: Use backend LLM via WebSocket
      // ═══════════════════════════════════════════════════════════
      logger.debug('🌐 [NODE:ANSWER] Using ONLINE MODE - Backend LLM via WebSocket');
      
      try {
        const WebSocket = require('ws');
        
        // Get WebSocket URL from environment or use default
        const wsBaseUrl = process.env.WEBSOCKET_URL || 'ws://localhost:4000/ws/stream';
        const apiKey = process.env.WEBSOCKET_API_KEY || 'test-api-key-123';
        const userId = context.userId || 'default_user';
        const clientId = `mcp_backend_${Date.now()}`;
        
        // Build URL with authentication parameters (same as frontend)
        const url = new URL(wsBaseUrl);
        url.searchParams.set('apiKey', apiKey);
        url.searchParams.set('userId', userId);
        url.searchParams.set('clientId', clientId);
        
        logger.debug(`🌐 [NODE:ANSWER] Connecting to backend WebSocket: ${url.toString()}`);
        
        // Create WebSocket connection with auth params
        const ws = new WebSocket(url.toString());
        
        // Wait for connection with timeout
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('WebSocket connection timeout'));
          }, 5000);
          
          ws.on('open', () => {
            clearTimeout(timeout);
            logger.debug('✅ [NODE:ANSWER] WebSocket connected');
            resolve();
          });
          
          ws.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
        
        // Prepare LLM request message
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const llmRequest = {
          id: requestId,
          type: 'llm_request',
          payload: {
            prompt: payload.query,  // ✅ Use payload.query which includes screen context
            provider: 'openai',
            options: {
              temperature: 0.7,
              stream: true,
              taskType: 'ask'
            },
            context: {
              recentContext: processedHistory.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: new Date().toISOString(),
                messageId: `msg_${Date.now()}`
              })),
              sessionFacts,
              sessionEntities,
              memories: filteredMemories,
              webSearchResults: contextDocs,
              systemInstructions
            }
          },
          timestamp: Date.now(),
          metadata: {
            source: 'mcp_backend',
            sessionId: context.sessionId,
            userId: context.userId
          }
        };
        
        // Send request
        logger.debug('📤 [NODE:ANSWER] Sending LLM request to WebSocket backend');
        ws.send(JSON.stringify(llmRequest));
        
        // Handle streaming response
        let accumulatedAnswer = '';
        let streamStarted = false;
        
        await new Promise((resolve, reject) => {
          const responseTimeout = setTimeout(() => {
            ws.close();
            reject(new Error('Response timeout - no data received'));
          }, 60000); // 60 second timeout
          
          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              
              if (message.type === 'llm_stream_start') {
                logger.debug('🌊 [NODE:ANSWER] Stream started');
                streamStarted = true;
                clearTimeout(responseTimeout);
                
              } else if (message.type === 'llm_stream_chunk') {
                const chunk = message.payload?.chunk || message.payload?.text || '';
                if (chunk) {
                  accumulatedAnswer += chunk;
                  if (streamCallback) {
                    streamCallback(chunk);
                  }
                }
                
              } else if (message.type === 'llm_stream_end') {
                logger.debug(`✅ [NODE:ANSWER] Stream ended (${accumulatedAnswer.length} chars)`);
                clearTimeout(responseTimeout);
                ws.close();
                resolve();
                
              } else if (message.type === 'error') {
                clearTimeout(responseTimeout);
                ws.close();
                reject(new Error(message.payload?.message || 'WebSocket error'));
              }
            } catch (e) {
              logger.error('❌ [NODE:ANSWER] Failed to parse WebSocket message:', e);
            }
          });
          
          ws.on('error', (error) => {
            clearTimeout(responseTimeout);
            reject(error);
          });
          
          ws.on('close', () => {
            clearTimeout(responseTimeout);
            if (!streamStarted) {
              reject(new Error('WebSocket closed before stream started'));
            } else {
              resolve();
            }
          });
        });
        
        finalAnswer = accumulatedAnswer;
        answerData = {
          answer: finalAnswer,
          model: 'online-backend-llm',
          metadata: { streaming: true, source: 'websocket' }
        };
        
        logger.debug(`✅ [NODE:ANSWER] Online LLM complete (${finalAnswer.length} chars)`);
        
      } catch (onlineError) {
        logger.error('❌ [NODE:ANSWER] Online LLM failed:', onlineError.message);
        logger.debug('🔄 [NODE:ANSWER] Falling back to local Phi4...');
        
        // Fall through to private mode on error
      }
    }
    
    // ═══════════════════════════════════════════════════════════
    // 🔒 PRIVATE MODE: Use local Phi4 via MCP (also fallback for online)
    // ═══════════════════════════════════════════════════════════
    if (!useOnlineMode || !finalAnswer) { // Use private mode if not online OR if online failed
      // ═══════════════════════════════════════════════════════════
      // 🔒 PRIVATE MODE: Use local Phi4 via MCP
      // ═══════════════════════════════════════════════════════════
      logger.debug('🔒 [NODE:ANSWER] Using PRIVATE MODE - Local Phi4');
      
      // Log the full payload being sent to Phi4
      logger.debug('=' .repeat(80));
      logger.debug('📤 PAYLOAD BEING SENT TO PHI4:');
      logger.debug('Query:', payload.query.substring(0, 200));
      logger.debug('System Instructions:', payload.context.systemInstructions?.substring(0, 300));
      logger.debug('Conversation History:', payload.context.conversationHistory?.length || 0, 'messages');
      logger.debug('Memories:', payload.context.memories?.length || 0);
      logger.debug('Web Results:', payload.context.webSearchResults?.length || 0);
      logger.debug('=' .repeat(80));
      
      // Use streaming if callback provided, otherwise blocking call
      if (isStreaming) {
        logger.debug('🌊 [NODE:ANSWER] Using streaming mode...');
        let accumulatedAnswer = '';
        
        try {
          // Call streaming endpoint
          const result = await mcpClient.callServiceStream(
            'phi4',
            'general.answer.stream',
            payload,
            // Token callback - forward to state callback
            (token) => {
              accumulatedAnswer += token;
              streamCallback(token); // Forward token to orchestrator/IPC
            },
            // Progress callback
            (progress) => {
              if (progress.type === 'start') {
                logger.debug('🌊 [NODE:ANSWER] Stream started');
              } else if (progress.type === 'done') {
                logger.debug('🌊 [NODE:ANSWER] Stream complete');
              }
            }
          );
        
        answerData = result.data || result;
        
        // CRITICAL: Check if streaming produced any content
        // If not, fall back to blocking call to get the actual answer
        if (!accumulatedAnswer || accumulatedAnswer.trim().length === 0) {
          logger.warn('⚠️ [NODE:ANSWER] Streaming produced no content (0 tokens), falling back to blocking call...');
          const timeout = contextDocs.length > 0 ? 60000 : 30000;
          const blockingResult = await mcpClient.callService('phi4', 'general.answer', payload, { timeout });
          answerData = blockingResult.data || blockingResult;
          finalAnswer = answerData.answer || answerData.text || 'I apologize, but I was unable to generate a response.';
          
          logger.debug(`📦 [NODE:ANSWER] Fallback answer generated (${finalAnswer.length} chars)`);
          
          // IMPORTANT: Send the answer via callback so UI receives it
          if (streamCallback && typeof streamCallback === 'function') {
            logger.debug('📤 [NODE:ANSWER] Sending fallback answer via callback');
            streamCallback(finalAnswer);
          } else {
            logger.warn('⚠️ [NODE:ANSWER] No streamCallback available to send fallback answer!');
          }
        } else {
          finalAnswer = accumulatedAnswer;
          logger.debug(`✅ [NODE:ANSWER] Streaming successful (${finalAnswer.length} chars)`);
        }
        
        logger.debug(`✅ [NODE:ANSWER] Answer complete (${finalAnswer.length} chars)`);
      } catch (streamError) {
        logger.error('❌ [NODE:ANSWER] Streaming failed:', streamError.message);
        logger.debug('🔄 [NODE:ANSWER] Falling back to blocking call...');
        
        // Fall back to blocking call
        const timeout = contextDocs.length > 0 ? 60000 : 30000;
        const blockingResult = await mcpClient.callService('phi4', 'general.answer', payload, { timeout });
        answerData = blockingResult.data || blockingResult;
        finalAnswer = answerData.answer || answerData.text || 'I apologize, but I was unable to generate a response.';
        
        // Send the answer via callback
        if (streamCallback && typeof streamCallback === 'function') {
          logger.debug('📤 [NODE:ANSWER] Sending fallback answer via callback');
          streamCallback(finalAnswer);
        }
      }
      
    } else {
      logger.debug('📦 [NODE:ANSWER] Using blocking mode...');
      // Blocking call for non-streaming
      // Use longer timeout when web results are present (large context to process)
      const timeout = contextDocs.length > 0 ? 60000 : 30000;
      logger.debug(`⏱️  [NODE:ANSWER] Using ${timeout}ms timeout (${contextDocs.length} web results)`);
      const result = await mcpClient.callService('phi4', 'general.answer', payload, { timeout });
      
      // MCP protocol wraps response in 'data' field
      answerData = result.data || result;
      
      // Phi4 service returns "answer" field, not "text"
      finalAnswer = answerData.answer || answerData.text || 'I apologize, but I was unable to generate a response.';
      logger.debug(`✅ [NODE:ANSWER] Answer generated (${finalAnswer.length} chars)`);
      
        // IMPORTANT: Send the final answer via streamCallback even in non-streaming mode
        // This ensures the UI receives the answer after web search retry
        if (streamCallback && typeof streamCallback === 'function') {
          logger.debug('📤 [NODE:ANSWER] Sending final answer via callback (non-streaming mode)');
          streamCallback(finalAnswer);
        }
      }
    } // End of private mode block

    return {
      ...state,
      answer: finalAnswer,
      answerMetadata: {
        model: answerData.metadata?.model || answerData.model,
        tokens: answerData.tokensUsed || answerData.tokens,
        duration: answerData.metadata?.processingTimeMs || answerData.duration
      }
    };
  } catch (error) {
    logger.error('❌ [NODE:ANSWER] Failed:', error.message);
    throw error;
  }
};
