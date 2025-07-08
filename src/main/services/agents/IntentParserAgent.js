/**
 * IntentParserAgent - Intent detection and classification for user requests
 */
module.exports = {
  execute: async function(params, context) {
    const { message } = params;
    const llmClient = context?.llmClient;
    
    // Define fallback detection as a local function
    const fallbackDetection = function(msg) {
      const lowerMessage = msg.toLowerCase();
      let intent = 'question';
      let memoryCategory = null;
      let confidence = 0.7;
      
      if(lowerMessage.match(/my name (is|=) [\w\s]+/i)) {
        intent = 'memory_store';
        memoryCategory = 'personal_info';
        confidence = 0.8;
      } else if(lowerMessage.match(/my favorite|i like|i prefer|i love/i) && 
                lowerMessage.match(/color|food|movie|book|music|song/i)) {
        intent = 'memory_store';
        memoryCategory = 'preferences';
        confidence = 0.8;
      } else if(lowerMessage.match(/what.*my name|who am i/i)) {
        intent = 'memory_retrieve';
        memoryCategory = 'personal_info';
        confidence = 0.8;
      } else if(lowerMessage.match(/what.*favorite|what.*like|what.*prefer/i)) {
        intent = 'memory_retrieve';
        memoryCategory = 'preferences';
        confidence = 0.8;
      } else if(lowerMessage.match(/appointment|schedule|meeting|calendar|flight|plane|travel|trip|airport/i) ||
                lowerMessage.match(/what time|when is|tomorrow/i)) {
        intent = 'external_data_required';
        memoryCategory = lowerMessage.match(/flight|plane|airport|travel|trip/i) ? 'travel' : 'calendar';
        confidence = 0.8;
      }
      
      return {
        success: true,
        intent,
        memoryCategory,
        confidence,
        entities: [],
        requiresExternalData: intent === 'external_data_required'
      };
    };
    
    // If no LLM client available, use fallback
    if(!llmClient) {
      console.log('LLM client not available for intent detection, using fallback');
      return fallbackDetection(message);
    }
    
    try {
      // Use LLM for intent detection
      const prompt = "You are an intent detection system. Classify the user message into: question, command, memory_store, memory_retrieve, or external_data_required. For memory/external data, specify category: personal_info, preferences, calendar, travel, work, health, general. Include confidence (0-1) and if external data is needed. Extract entities. Reply in JSON format only. User message: " + message;
      
      const result = await llmClient.complete({
        prompt,
        max_tokens: 500,
        temperature: 0.1,
        stop: ["\n\n"]
      });
      
      try {
        const parsedResult = JSON.parse(result.text);
        console.log('LLM intent detection result:', parsedResult);
        return {
          success: true,
          ...parsedResult
        };
      } catch(parseError) {
        console.error('Failed to parse LLM intent detection result:', parseError);
        return fallbackDetection(message);
      }
    } catch(error) {
      console.error('Error in LLM intent detection:', error);
      return fallbackDetection(message);
    }
  }
};
