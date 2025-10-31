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
    // Build system instructions - simple and clear
    let systemInstructions = `You are an AI assistant. Use the conversation history to understand context and answer questions naturally.

IMPORTANT:
- When the user refers to "the show", "the cartoon", "he", "she", "it", or "they", check the conversation history to understand what they're referring to.
- If the user asks to "go back" to a previous topic, find that topic in the conversation history and continue it.
- Do not ask the user to repeat information that's already in the conversation history.
- Always respond from the assistant's perspective (use "you" for the user, not "I").`;

    // Add meta-question handling
    if (message.toLowerCase().includes('what did i')) {
      systemInstructions += `\nCRITICAL INSTRUCTION: The user is asking what they previously said.
STEP 1: SKIP the first user message in the conversation history (that's the current question).
STEP 2: Find the SECOND user message that has "[MOST RECENT USER MESSAGE]" at the very start.
STEP 3: Extract ONLY the text AFTER "[MOST RECENT USER MESSAGE] " (note the space).
STEP 4: Respond with EXACTLY: "You asked: [extracted text]"

Example conversation history:
[
  {"role": "user", "content": "what did I just say"},  ← SKIP THIS (current question)
  {"role": "assistant", "content": "..."},
  {"role": "user", "content": "[MOST RECENT USER MESSAGE] What do I like to eat"}  ← EXTRACT FROM THIS
]
Correct response: "You asked: What do I like to eat"

DO NOT extract from the first user message. DO NOT extract from assistant messages. ONLY extract from the marked user message.`;
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

    // Mark most recent user message for meta-questions
    let processedHistory = [...conversationHistory];
    if (message.toLowerCase().includes('what did i')) {
      // Find the previous user message (excluding current one which is the first in DESC order)
      let userMessageCount = 0;
      let targetIndex = -1;
      
      for (let i = 0; i < conversationHistory.length; i++) {
        if (conversationHistory[i].role === 'user') {
          userMessageCount++;
          if (userMessageCount === 2) {
            // This is the second user message (the one before current)
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
