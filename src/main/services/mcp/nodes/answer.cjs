/**
 * Answer Node
 * Generates answer using LLM with filtered context
 * Supports both Private Mode (local Phi4) and Online Mode (backend LLM)
 */

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
    console.log(`🔄 [CONTEXT-SWITCH] Small history (${conversationHistory.length} messages), using all`);
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
    console.log(`🔄 [CONTEXT-SWITCH] Filtered out ${filteredCount} irrelevant older messages`);
    console.log(`   Kept: ${relevantMessages.length}/${conversationHistory.length} messages (${IMMEDIATE_CONTEXT_SIZE} recent + ${keptOlderMessages} relevant older)`);
  } else {
    console.log(`🔄 [CONTEXT-SWITCH] All messages relevant, kept ${relevantMessages.length}/${conversationHistory.length}`);
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
  
  // For screen intelligence, use original message (coreference resolution can confuse "this" references to screen content)
  // For other intents, use resolved message (after coreference resolution)
  const queryMessage = (intent?.type === 'screen_intelligence') ? message : (resolvedMessage || message);

  // 🔄 CONTEXT SWITCHING DETECTION
  // Detect if the user has switched topics and filter conversation history accordingly
  const filteredHistory = detectContextSwitch(conversationHistory, queryMessage);

  // Only stream on first attempt, not on retries (prevents double responses)
  const isStreaming = typeof streamCallback === 'function' && retryCount === 0;
  
  // 🌐 Determine which LLM to use
  const llmMode = useOnlineMode ? 'ONLINE' : 'PRIVATE';
  console.log(`💬 [NODE:ANSWER] Generating answer... (mode: ${llmMode}, streaming: ${isStreaming}, retry: ${retryCount})`);
  console.log(`📊 [NODE:ANSWER] Context: ${conversationHistory.length} total → ${filteredHistory.length} filtered messages, ${filteredMemories.length} memories, ${contextDocs.length} web results`);
  
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
    
    // Base instructions (always included)
    let systemInstructions = `You are a helpful AI assistant. Answer concisely and directly.

Guidelines:
- The conversation history is in CHRONOLOGICAL ORDER (oldest messages first, newest messages last)
- Read the ENTIRE conversation history carefully to understand the full context
- Pay special attention to the MOST RECENT messages (at the end of the history)
- If the user provides clarification or answers your question, it will be in the LAST user message
- Be brief and to the point
- Don't repeat information already discussed`;

    // Add follow-up question handling (only if there's conversation history)
    if (filteredHistory && filteredHistory.length > 0) {
      systemInstructions += `

CRITICAL CONTEXT AWARENESS:
- If the user asks a FOLLOW-UP QUESTION (e.g., "give me examples", "tell me more", "what else"), you MUST read the conversation history to understand what topic they're referring to
- Look at the PREVIOUS messages to identify the subject being discussed
- For example: If the conversation was about "MCP" and the user says "give me examples", they want examples of MCP, NOT examples of the phrase "give me"
- ALWAYS interpret vague requests in the context of the ongoing conversation topic`;
    }

    // ═══════════════════════════════════════════════════════════
    // INTENT-SPECIFIC INSTRUCTIONS
    // ═══════════════════════════════════════════════════════════
    
    // Screen Intelligence Intent
    if (state.intent?.type === 'screen_intelligence' && state.screenContext) {
      systemInstructions += `

🚨 SCREEN INTELLIGENCE: When you see "USER REQUEST:" + "SCREEN CONTEXT:":
1. Read the user's request carefully
2. If a 🎯 TARGET is specified, focus ONLY on that specific element/area
3. Find relevant info in "Full Screen Text (OCR):" section
4. Perform the requested action (don't just describe)
5. For "draft a response" - write the actual response immediately

🚨 CRITICAL SCREEN INTELLIGENCE PROTOCOL 🚨
YOU ARE ANALYZING THE USER'S SCREEN RIGHT NOW!

The screen analysis below contains ACTUAL UI ELEMENTS extracted from the user's display.
Each element shows: [Element Type]: [Label/Text] - [Price if applicable] [Screen Region]

⚠️ PRIORITY: Screen context takes ABSOLUTE PRIORITY over web search results!
- If screen context is provided, answer from the screen data FIRST
- Only use web results if the screen doesn't contain the answer
- DO NOT say "web search results don't provide information" when screen data is available

MANDATORY RESPONSE RULES:
1. When asked "what do you see in [location]", EXTRACT AND LIST the specific items shown in that location
2. DO NOT give generic responses like "The user is referring to an item from a website"
3. DO NOT say "I cannot see" or "I don't have the capability" - YOU ARE SEEING IT RIGHT NOW
4. DO NOT ask for clarification when the screen data clearly shows the answer
5. BE SPECIFIC - mention product names, prices, and discounts exactly as shown
6. DO NOT prioritize web search results over screen data - the screen is what the user is looking at RIGHT NOW

EXAMPLE:
User asks: "what do you see in the lower right"
Screen shows: "link: Bestbee Women's Pajama Set - $11.99 (40% off) [lower right]"
CORRECT response: "In the lower right, I see a Bestbee Women's Pajama Set for $11.99 (40% off)"
WRONG response: "The user is referring to an item from a website"

YOU MUST EXTRACT THE ACTUAL PRODUCT NAMES AND DETAILS FROM THE SCREEN DATA!

CONTENT EXTRACTION:
- If SELECTED TEXT is provided, it takes HIGHEST PRIORITY - the user highlighted this text and wants you to work with it
- If the user asks "what do you see" or "what's on my screen", describe the MAIN CONTENT visible
- If the user asks about an email, webpage, or document, extract the key information from the BROWSER CONTENT or PAGE CONTENT section
- Focus on the ACTUAL TEXT and CONTENT shown, not on describing the interface itself
- Be direct and factual - summarize what you see, don't analyze the platform

🚨 DRAFTING RESPONSES 🚨
When user asks to "draft a response" or "reply to this message":
1. Find the sender's name in the OCR text
2. Read their message
3. Write a professional response addressing their points

Example: If OCR shows "Daniel Wilken: Hi Chris, I'm recruiting for Georgetown's cybersecurity programs..."
You write: "Hi Daniel, Thank you for reaching out! I appreciate you thinking of me for Georgetown's programs..."

CODE EDITOR / TERMINAL RESPONSES:
- If analyzing a CODE EDITOR (VS Code, Windsurf, Cursor), focus on the CODE CONTENT visible in the editor
- Extract function names, class names, variable names, and code logic from the OCR text
- If asked "what do you see", describe the code structure, not just "a code editor"
- For TERMINAL/CONSOLE windows (Warp, iTerm, Terminal), describe the commands and output visible, not just "terminal interface"
- Be specific about file names, line numbers, and code patterns you can identify

EXAMPLE (Code Editor):
Screen shows: "function createWindow() { const win = new BrowserWindow({ width: 800 }) }"
User asks: "what do you see here"
CORRECT: "I see a JavaScript function called createWindow() that creates a new BrowserWindow with a width of 800 pixels"
WRONG: "I see a desktop interface with no visible desktop items. There are two accessibility elements in the browser content section - Electron's main.cjs file and no interactive elements."

EXAMPLE (Terminal/Console):
User asks: "what's in the warp console"
Screen shows OCR text with: "yarn dev", "MCP Request", "Response status: 200 OK", "MCP Success: conversation.message.list"
CORRECT: "The Warp console shows a yarn dev command running. I can see MCP service requests and responses, including successful calls to conversation.message.list with 200 OK status codes."
WRONG: "The web search results do not provide information about what is in the Warp Console."`;
    }
    
    // Web Search Intent
    else if (contextDocs && contextDocs.length > 0) {
      systemInstructions += `

CRITICAL WEB SEARCH PROTOCOL:
- Web search results are provided below - YOU MUST USE THEM to answer the question
- DO NOT say "I don't have that information" when web results are provided
- DO NOT say "Let me look that up" when web results are provided
- Extract key facts from the web results and provide a direct, informative answer
- The web results contain the answer - use them!`;
    }
    
    // Memory Retrieval Intent
    else if (filteredMemories && filteredMemories.length > 0) {
      systemInstructions += `

CRITICAL MEMORY PROTOCOL:
- The "memories" section contains factual information from PREVIOUS conversations (possibly from days or weeks ago)
- If the user asks about appointments, preferences, or past statements, USE THE MEMORIES to provide specific details
- PRONOUN RESOLUTION: ALWAYS prioritize the MOST RECENT conversation history over old memories
  * If the last few messages discuss a specific person, that person is the referent for pronouns
  * Only use memories if there's NO relevant person mentioned in recent conversation history`;
    }
    
    // Generic Question Intent (no special context)
    else if (state.intent?.type === 'question') {
      systemInstructions += `

FACTUAL INFORMATION PROTOCOL:
- If the user asks about FACTUAL INFORMATION about the world (e.g., "who is X", "what is Y", "when was X created"):
  * Answer using your knowledge from training data
  * Be direct and factual - provide the best answer you can from what you know
  * If you truly don't know, say "I don't have reliable information about that"
  * DO NOT say "I need to search online" - just answer from your knowledge
- If the user asks about THEIR OWN preferences or past statements and you DON'T have it in memories:
  * Respond: "I don't have that information stored yet."
- If the user explicitly asks you to search online (e.g., "can you look online", "search for it"):
  * Respond EXACTLY: "I'll search online for that information now." (this triggers a web search)`;
    }

    // Add command output interpretation instructions
    if (needsInterpretation) {
      systemInstructions += `\n\nCOMMAND OUTPUT INTERPRETATION:
The user asked: "${queryMessage}"
A shell command was executed: ${executedCommand}

Your task is to provide a concise, confident, human-friendly answer based on the command output.

CRITICAL RULES:
- Answer in 1 sentence maximum
- Be direct and confident - state the result clearly
- DO NOT hedge with phrases like "likely", "probably", "seems to", "appears to", "not specific enough"
- DO NOT explain what command was run or how it works
- DO NOT describe the technical details
- DO NOT ask clarifying questions - the command has already been executed
- ONLY provide the direct answer to the user's question

SPECIFIC PATTERNS:
- For "how many apps open": If output is a number, respond: "You have [number] apps currently running."
- For "what apps are open": List the application names clearly (one per line or comma-separated)
- For system info (storage, memory, etc.): State the numbers in readable format (e.g., "You have 250 GB free")
- For file operations: Confirm what was done (e.g., "File created successfully")
- For empty output: Confirm the action completed successfully

The command output will be provided below. Interpret it confidently and directly.`;
    }

    // Add meta-question handling (only if user is asking about their own previous messages)
    if (queryMessage.toLowerCase().includes('what did i')) {
      systemInstructions += `\n\nMETA-QUESTION PROTOCOL:\nThe user is asking what they previously said.
The conversation history is in CHRONOLOGICAL ORDER (oldest → newest).
STEP 1: Find the user message that has "[MOST RECENT USER MESSAGE]" at the very start.
STEP 2: Extract ONLY the text AFTER "[MOST RECENT USER MESSAGE] " (note the space).
STEP 3: Respond with EXACTLY: "You asked: [extracted text]"

Example conversation history (chronological order):
[
  {"role": "user", "content": "[MOST RECENT USER MESSAGE] What do I like to eat"},  ← EXTRACT FROM THIS
  {"role": "assistant", "content": "..."},
  {"role": "user", "content": "what did I just say"}  ← CURRENT QUESTION (at the end)
]
Correct response: "You asked: What do I like to eat"

DO NOT extract from the last user message (that's the current question). ONLY extract from the marked user message.`;
    }

    // Add web search context instructions
    if (contextDocs.length > 0) {
      systemInstructions += `\n\nWEB SEARCH RESULTS (${contextDocs.length} found):
Use these current web results to answer. Extract key facts and answer directly.`;
      
      // List web result topics
      const webTopics = contextDocs.slice(0, 3).map((doc, idx) => {
        const preview = doc.text.substring(0, 80).replace(/\n/g, ' ');
        return `${idx + 1}. ${preview}...`;
      }).join('\n');
      
      systemInstructions += `\n${webTopics}`;
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
    
    // Prepare the query - add context directly to query for vision/screen intents
    let finalQuery = queryMessage;
    if (state.visualContext && state.intent?.type === 'vision') {
      finalQuery = `${queryMessage}\n\n${state.visualContext}`;
      console.log('👁️  [NODE:ANSWER] Added visual context directly to query for vision intent');
    } else if (state.screenContext && state.intent?.type === 'screen_intelligence') {
      // Put user's request FIRST, then provide screen data as context
      // If a target entity was extracted, highlight it in the request
      let userRequest = queryMessage;
      if (state.targetEntity) {
        userRequest = `${queryMessage}\n\n🎯 TARGET: Focus on "${state.targetEntity}"`;
        console.log(`🎯 [NODE:ANSWER] Target entity highlighted: "${state.targetEntity}"`);
      }
      finalQuery = `USER REQUEST: ${userRequest}\n\nSCREEN CONTEXT (use this to fulfill the user's request):\n${state.screenContext}`;
      console.log('🎯 [NODE:ANSWER] Added screen context AFTER query for screen_intelligence intent');
    } else if (state.context) {
      // Generic context from other nodes
      finalQuery = `${queryMessage}\n\n${state.context}`;
      console.log('📋 [NODE:ANSWER] Added generic context to query');
    }
    
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
        // Add command context if interpreting
        ...(needsInterpretation && {
          commandContext: {
            originalQuery: queryMessage,
            executedCommand,
            outputLength: processedOutput?.length || 0
          }
        })
      }
    };

    let finalAnswer;
    let answerData;

    // 🌐 ROUTE TO ONLINE OR PRIVATE LLM
    if (useOnlineMode) {
      // ═══════════════════════════════════════════════════════════
      // 🌐 ONLINE MODE: Use backend LLM via WebSocket
      // ═══════════════════════════════════════════════════════════
      console.log('🌐 [NODE:ANSWER] Using ONLINE MODE - Backend LLM via WebSocket');
      
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
        
        console.log(`🌐 [NODE:ANSWER] Connecting to backend WebSocket: ${url.toString()}`);
        
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
            console.log('✅ [NODE:ANSWER] WebSocket connected');
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
        console.log('📤 [NODE:ANSWER] Sending LLM request to WebSocket backend');
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
                console.log('🌊 [NODE:ANSWER] Stream started');
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
                console.log(`✅ [NODE:ANSWER] Stream ended (${accumulatedAnswer.length} chars)`);
                clearTimeout(responseTimeout);
                ws.close();
                resolve();
                
              } else if (message.type === 'error') {
                clearTimeout(responseTimeout);
                ws.close();
                reject(new Error(message.payload?.message || 'WebSocket error'));
              }
            } catch (e) {
              console.error('❌ [NODE:ANSWER] Failed to parse WebSocket message:', e);
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
        
        console.log(`✅ [NODE:ANSWER] Online LLM complete (${finalAnswer.length} chars)`);
        
      } catch (onlineError) {
        console.error('❌ [NODE:ANSWER] Online LLM failed:', onlineError.message);
        console.log('🔄 [NODE:ANSWER] Falling back to local Phi4...');
        
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
      console.log('🔒 [NODE:ANSWER] Using PRIVATE MODE - Local Phi4');
      
      // Log the full payload being sent to Phi4
      console.log('=' .repeat(80));
      console.log('📤 PAYLOAD BEING SENT TO PHI4:');
      console.log('Query:', payload.query.substring(0, 200));
      console.log('System Instructions:', payload.context.systemInstructions?.substring(0, 300));
      console.log('Conversation History:', payload.context.conversationHistory?.length || 0, 'messages');
      console.log('Memories:', payload.context.memories?.length || 0);
      console.log('Web Results:', payload.context.webSearchResults?.length || 0);
      console.log('=' .repeat(80));
      
      // Use streaming if callback provided, otherwise blocking call
      if (isStreaming) {
        console.log('🌊 [NODE:ANSWER] Using streaming mode...');
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
                console.log('🌊 [NODE:ANSWER] Stream started');
              } else if (progress.type === 'done') {
                console.log('🌊 [NODE:ANSWER] Stream complete');
              }
            }
          );
        
        answerData = result.data || result;
        
        // CRITICAL: Check if streaming produced any content
        // If not, fall back to blocking call to get the actual answer
        if (!accumulatedAnswer || accumulatedAnswer.trim().length === 0) {
          console.warn('⚠️ [NODE:ANSWER] Streaming produced no content (0 tokens), falling back to blocking call...');
          const timeout = contextDocs.length > 0 ? 60000 : 30000;
          const blockingResult = await mcpClient.callService('phi4', 'general.answer', payload, { timeout });
          answerData = blockingResult.data || blockingResult;
          finalAnswer = answerData.answer || answerData.text || 'I apologize, but I was unable to generate a response.';
          
          console.log(`📦 [NODE:ANSWER] Fallback answer generated (${finalAnswer.length} chars)`);
          
          // IMPORTANT: Send the answer via callback so UI receives it
          if (streamCallback && typeof streamCallback === 'function') {
            console.log('📤 [NODE:ANSWER] Sending fallback answer via callback');
            streamCallback(finalAnswer);
          } else {
            console.warn('⚠️ [NODE:ANSWER] No streamCallback available to send fallback answer!');
          }
        } else {
          finalAnswer = accumulatedAnswer;
          console.log(`✅ [NODE:ANSWER] Streaming successful (${finalAnswer.length} chars)`);
        }
        
        console.log(`✅ [NODE:ANSWER] Answer complete (${finalAnswer.length} chars)`);
      } catch (streamError) {
        console.error('❌ [NODE:ANSWER] Streaming failed:', streamError.message);
        console.log('🔄 [NODE:ANSWER] Falling back to blocking call...');
        
        // Fall back to blocking call
        const timeout = contextDocs.length > 0 ? 60000 : 30000;
        const blockingResult = await mcpClient.callService('phi4', 'general.answer', payload, { timeout });
        answerData = blockingResult.data || blockingResult;
        finalAnswer = answerData.answer || answerData.text || 'I apologize, but I was unable to generate a response.';
        
        // Send the answer via callback
        if (streamCallback && typeof streamCallback === 'function') {
          console.log('📤 [NODE:ANSWER] Sending fallback answer via callback');
          streamCallback(finalAnswer);
        }
      }
      
    } else {
      console.log('📦 [NODE:ANSWER] Using blocking mode...');
      // Blocking call for non-streaming
      // Use longer timeout when web results are present (large context to process)
      const timeout = contextDocs.length > 0 ? 60000 : 30000;
      console.log(`⏱️  [NODE:ANSWER] Using ${timeout}ms timeout (${contextDocs.length} web results)`);
      const result = await mcpClient.callService('phi4', 'general.answer', payload, { timeout });
      
      // MCP protocol wraps response in 'data' field
      answerData = result.data || result;
      
      // Phi4 service returns "answer" field, not "text"
      finalAnswer = answerData.answer || answerData.text || 'I apologize, but I was unable to generate a response.';
      console.log(`✅ [NODE:ANSWER] Answer generated (${finalAnswer.length} chars)`);
      
        // IMPORTANT: Send the final answer via streamCallback even in non-streaming mode
        // This ensures the UI receives the answer after web search retry
        if (streamCallback && typeof streamCallback === 'function') {
          console.log('📤 [NODE:ANSWER] Sending final answer via callback (non-streaming mode)');
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
    console.error('❌ [NODE:ANSWER] Failed:', error.message);
    throw error;
  }
};
