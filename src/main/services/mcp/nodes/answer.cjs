/**
 * Answer Node
 * Generates answer using LLM with filtered context
 */

module.exports = async function answer(state) {
  const { 
    mcpClient, 
    message, 
    context, 
    intent,
    conversationHistory = [],
    sessionFacts = [],
    sessionEntities = [],
    filteredMemories = [], // Use filtered memories instead of raw memories
    contextDocs = [] // Web search results
  } = state;

  console.log('💬 [NODE:ANSWER] Generating answer...');
  console.log(`📊 [NODE:ANSWER] Context: ${conversationHistory.length} messages, ${filteredMemories.length} memories, ${contextDocs.length} web results`);

  try {
    // Build system instructions based on intent
    let systemInstructions = `You are an AI assistant helping the user. Always respond from the assistant's perspective (use "you" for the user, not "I").`;

    // Add pronoun resolution FIRST (highest priority) for queries with "he", "she", "it", "they", etc.
    const hasPronoun = /\b(he|she|it|they|him|her|his|their)\b/i.test(message);
    if (hasPronoun && conversationHistory.length > 0) {
      systemInstructions = `🚨 **CRITICAL - PRONOUN RESOLUTION** 🚨
The user's query contains a pronoun ("he", "she", "it", "they", etc.).

MANDATORY STEPS:
1. FIRST: Read the conversation history to identify who/what "he/she/it/they" refers to
2. Look at the most recent 2-3 assistant messages to see who was being discussed
3. ONLY AFTER identifying the person from context, use web search results to answer about THAT SPECIFIC PERSON
4. IGNORE web search results about other people - they are irrelevant

` + systemInstructions;
    }

    // Add follow-up detection for short affirmative responses (e.g., "yes football", "tell me more about X")
    const isShortFollowUp = message.trim().split(/\s+/).length <= 4 && conversationHistory.length > 0;
    const hasAffirmative = /\b(yes|yeah|yep|sure|ok|okay|tell me|more about)\b/i.test(message);
    if (isShortFollowUp && hasAffirmative) {
      systemInstructions = `🎯 **FOLLOW-UP CONTEXT** 🎯
The user is responding to your previous question with a short affirmative phrase.

MANDATORY STEPS:
1. Look at your MOST RECENT assistant message to see what question you asked
2. The user's response is answering that question - identify which option/topic they chose
3. Address THAT SPECIFIC TOPIC mentioned in their response
4. Stay on topic - don't switch to a different subject

Example:
- You asked: "Would you like to know about his hobbies or medical conditions?"
- User says: "yes football"
- You should: Talk about football/hobbies, NOT medical conditions

` + systemInstructions;
    }

    // Add meta-question handling
    if (message.toLowerCase().includes('what did i')) {
      systemInstructions += `\nIMPORTANT: If the user asks "what did I just say", look for the message marked with "[MOST RECENT USER MESSAGE]" in the conversation history.\nExtract ONLY the text after "[MOST RECENT USER MESSAGE]" and respond with: "You asked: [that text]"\nExample: If you see "[MOST RECENT USER MESSAGE] What do I like to eat", respond EXACTLY: "You asked: What do I like to eat"`;
    }

    // Add memory usage instructions
    if (filteredMemories.length > 0) {
      systemInstructions += `\nIMPORTANT: The "memories" section contains factual information about the user from previous conversations. Use these memories to answer questions about the user's preferences, history, or past statements.\nWhen the user asks "what do I like" or "what is my favorite", check the memories first before saying you don't know.`;
      
      // List memory topics
      const memoryTopics = filteredMemories.map(m => {
        const preview = m.text.substring(0, 50);
        return `  ${preview}...`;
      }).join('\n');
      
      systemInstructions += `\nThe user has mentioned these in past conversations (check memories for details):\n${memoryTopics}`;
    }

    // Add web search context instructions
    if (contextDocs.length > 0) {
      systemInstructions += `\nIMPORTANT: The "webSearchResults" section contains current information from the web about the user's query. Use these results to provide accurate, up-to-date answers.\nCite the information from these results when answering factual questions.`;
      
      // List web result topics
      const webTopics = contextDocs.slice(0, 3).map((doc, idx) => {
        const preview = doc.text.substring(0, 60).replace(/\n/g, ' ');
        return `  ${idx + 1}. ${preview}...`;
      }).join('\n');
      
      systemInstructions += `\nWeb search found these results:\n${webTopics}`;
    }

    systemInstructions += `\nThe "conversationHistory" shows the recent back-and-forth messages. Use this for immediate context and follow-up questions.`;

    // Mark most recent user message for meta-questions
    let processedHistory = [...conversationHistory];
    if (message.toLowerCase().includes('what did i')) {
      // Find the previous user message (excluding current one which is the first in DESC order)
      const userMessages = conversationHistory.filter(m => m.role === 'user');
      if (userMessages.length > 1) {
        // userMessages[0] is the current message, userMessages[1] is the previous one
        const previousUserMessage = userMessages[1];
        processedHistory = conversationHistory.map(m => 
          m === previousUserMessage 
            ? { ...m, content: `[MOST RECENT USER MESSAGE] ${m.content}` }
            : m
        );
      }
    }

    // Call phi4 for answer generation
    const result = await mcpClient.callService('phi4', 'general.answer', {
      query: message,
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
    });

    // MCP protocol wraps response in 'data' field
    const answerData = result.data || result;

    // Phi4 service returns "answer" field, not "text"
    const finalAnswer = answerData.answer || answerData.text || 'I apologize, but I was unable to generate a response.';

    console.log(`✅ [NODE:ANSWER] Answer generated (${finalAnswer.length} chars)`);

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
