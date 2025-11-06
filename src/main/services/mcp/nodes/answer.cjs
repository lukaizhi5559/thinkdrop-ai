/**
 * Answer Node
 * Generates answer using LLM with filtered context
 */

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
    retryCount = 0 // Track if this is a retry
  } = state;
  
  // Use resolved message if available (after coreference resolution), otherwise original
  const queryMessage = resolvedMessage || message;

  // Only stream on first attempt, not on retries (prevents double responses)
  const isStreaming = typeof streamCallback === 'function' && retryCount === 0;
  console.log(`💬 [NODE:ANSWER] Generating answer... (streaming: ${isStreaming}, retry: ${retryCount})`);
  console.log(`📊 [NODE:ANSWER] Context: ${conversationHistory.length} messages, ${filteredMemories.length} memories, ${contextDocs.length} web results`);

  try {
    // Build system instructions
    let systemInstructions = `You are a helpful AI assistant. Answer concisely and directly.

Guidelines:
- The conversation history is in CHRONOLOGICAL ORDER (oldest messages first, newest messages last)
- Read the ENTIRE conversation history carefully to understand the full context
- Pay special attention to the MOST RECENT messages (at the end of the history)
- If the user provides clarification or answers your question, it will be in the LAST user message
- Be brief and to the point
- Don't repeat information already discussed

CRITICAL CONTEXT AWARENESS:
- If the user asks a FOLLOW-UP QUESTION (e.g., "give me examples", "tell me more", "what else"), you MUST read the conversation history to understand what topic they're referring to
- Look at the PREVIOUS messages to identify the subject being discussed
- For example: If the conversation was about "MCP" and the user says "give me examples", they want examples of MCP, NOT examples of the phrase "give me"
- ALWAYS interpret vague requests in the context of the ongoing conversation topic

CRITICAL FACTUAL INFORMATION PROTOCOL:
1. **IF WEB SEARCH RESULTS ARE PROVIDED BELOW, YOU MUST USE THEM TO ANSWER THE QUESTION.**
   - DO NOT say "I don't have that information" if web results are provided
   - DO NOT say "Let me look that up" if web results are provided
   - Extract key facts from the web results and provide a direct, informative answer
   - The web results contain the answer - use them!

2. If NO web results are provided AND the user asks about FACTUAL INFORMATION about the world (e.g., "who is X", "what is Y", "when was X created", "how old is Z", etc.):
   - IMPORTANT: Web search was already attempted but returned no results (offline or no matches)
   - Answer the question using your own knowledge from training data
   - Be direct and factual - provide the best answer you can from what you know
   - If you truly don't know, say "I don't have reliable information about that" (but try to answer first!)
   - DO NOT say "I need to search online" - web search was already tried

3. If the user asks about THEIR OWN preferences or past statements (e.g., "what do I like", "what did I say about myself") and you DON'T have it in memories, respond:
   "I don't have that information stored yet."

4. If the user explicitly asks you to search online (e.g., "can you look online", "search for it"), respond EXACTLY:
   "I'll search online for that information now."

These exact phrases will trigger a web search to get the answer.`;

    // Add meta-question handling
    if (queryMessage.toLowerCase().includes('what did i')) {
      systemInstructions += `\nCRITICAL INSTRUCTION: The user is asking what they previously said.
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

    // Add memory usage instructions
    if (filteredMemories.length > 0) {
      systemInstructions += `\nIMPORTANT: The "memories" section contains factual information from PREVIOUS conversations (possibly from days or weeks ago).

APPOINTMENT QUERIES: If the user asks about appointments (e.g., "when do I have an appt", "when is my appointment"), USE THE MEMORIES to provide specific details (date, time, type).

PRONOUN RESOLUTION: When resolving pronouns like "he", "she", "it", ALWAYS prioritize the MOST RECENT conversation history over old memories.
- If the last few messages discuss a specific person, that person is the referent for pronouns.
- Only use memories if there's NO relevant person mentioned in recent conversation history.
Example: If recent messages discuss "Anthony Albanese" and user asks "how old is he", they mean Anthony Albanese, NOT someone from an old memory.`;
      
      // List memory topics
      const memoryTopics = filteredMemories.map(m => {
        const preview = m.text.substring(0, 50);
        return `  ${preview}...`;
      }).join('\n');
      
      systemInstructions += `\nThe user has mentioned these in PAST conversations (check memories for details):\n${memoryTopics}`;
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
    let processedHistory = [...conversationHistory];
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
    const payload = {
      query: queryMessage,
      context: {
        conversationHistory: processedHistory,
        sessionFacts,
        sessionEntities,
        memories: filteredMemories, // Use filtered memories
        webSearchResults: contextDocs, // Add web search results
        systemInstructions,
        sessionId: context.sessionId,
        userId: context.userId
      }
    };

    let finalAnswer;
    let answerData;

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
