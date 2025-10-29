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
    filteredMemories = [] // Use filtered memories instead of raw memories
  } = state;

  console.log('💬 [NODE:ANSWER] Generating answer...');
  console.log(`📊 [NODE:ANSWER] Context: ${conversationHistory.length} messages, ${filteredMemories.length} memories`);

  try {
    // Build system instructions based on intent
    let systemInstructions = `You are an AI assistant helping the user. Always respond from the assistant's perspective (use "you" for the user, not "I").`;

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

    systemInstructions += `\nThe "conversationHistory" shows the recent back-and-forth messages. Use this for immediate context and follow-up questions.`;

    // Mark most recent user message for meta-questions
    let processedHistory = [...conversationHistory];
    if (message.toLowerCase().includes('what did i')) {
      // Find the most recent user message (excluding current one)
      const userMessages = conversationHistory.filter(m => m.role === 'user');
      if (userMessages.length > 0) {
        const mostRecent = userMessages[0]; // Already sorted DESC
        processedHistory = conversationHistory.map(m => 
          m === mostRecent 
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
        systemInstructions,
        sessionId: context.sessionId,
        userId: context.userId
      }
    });

    console.log(`✅ [NODE:ANSWER] Answer generated (${result.text?.length || 0} chars)`);

    return {
      ...state,
      answer: result.text || 'I apologize, but I was unable to generate a response.',
      answerMetadata: {
        model: result.model,
        tokens: result.tokens,
        duration: result.duration
      }
    };
  } catch (error) {
    console.error('❌ [NODE:ANSWER] Failed:', error.message);
    throw error;
  }
};
