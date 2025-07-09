module.exports = {
  execute: async function(params, context) {
    const message = params.message;
    const llmClient = context?.llmClient;
    
    const fallbackDetection = function(msg) {
      const lowerMessage = msg.toLowerCase();
      let intent = 'question';
      let memoryCategory = null;
      let confidence = 0.7;
      
      if(lowerMessage.match(/my name (is|=) [\w\s]+/i)) {
        intent = 'memory_store';
        memoryCategory = 'personal_info';
        confidence = 0.8;
      } else if(lowerMessage.match(/my favorite|i like|i prefer|i love/i) && lowerMessage.match(/color|food|movie|book|music|song/i)) {
        intent = 'memory_store';
        memoryCategory = 'preferences';
        confidence = 0.8;
      } else if(lowerMessage.match(/remove|delete|clear|forget|erase/i) && lowerMessage.match(/favorite|preference|that|my/i)) {
        intent = 'memory_store';
        memoryCategory = 'preferences';
        confidence = 0.9;
      } else if(lowerMessage.match(/remove|delete|clear|forget|erase/i) && lowerMessage.match(/name|personal|info/i)) {
        intent = 'memory_store';
        memoryCategory = 'personal_info';
        confidence = 0.9;
      } else if(lowerMessage.match(/what.*my name|who am i/i)) {
        intent = 'memory_retrieve';
        memoryCategory = 'personal_info';
        confidence = 0.8;
      } else if(lowerMessage.match(/what.*favorite|what.*like|what.*prefer/i)) {
        intent = 'memory_retrieve';
        memoryCategory = 'preferences';
        confidence = 0.8;
      } else if(lowerMessage.match(/appointment|schedule|meeting|calendar|flight|plane|travel|trip|airport/i) || lowerMessage.match(/what time|when is|tomorrow/i)) {
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
    
    // Check if LLM client is available and is a function
    if(!llmClient || typeof llmClient !== 'function') {
      console.log('🔄 LLM client not available for intent detection, using fallback');
      return fallbackDetection(message);
    }
    
    try {
      // Simplified prompt optimized for phi3:mini
      const prompt = `Classify this message. Reply ONLY with valid JSON:
{"intent": "memory_store", "memoryCategory": "preferences", "confidence": 0.9}

Intents: question, command, memory_store, memory_retrieve, external_data_required
Categories: personal_info, preferences, calendar, travel, work, health, general

Message: ${message}
JSON:`;
      
      console.log('🔍 Sending intent detection prompt to LLM...');
      const result = await llmClient(prompt, {
        maxTokens: 150,
        temperature: 0.0,
        stopTokens: ["\n\n", "}", "User:"]
      });
      
      console.log('📝 Raw LLM response:', JSON.stringify(result));
      
      // Check for empty or "No response generated"
      if(!result || result === 'No response generated' || result.trim().length === 0) {
        console.log('⚠️ Empty or "No response generated" received, using fallback detection');
        return fallbackDetection(message);
      }
      
      try {
        // Clean up the response
        let cleanResult = result.replace(/```json|```|`/g, '').trim();
        
        // Ensure it starts with {
        if(!cleanResult.startsWith('{')) {
          const jsonMatch = cleanResult.match(/\{[^}]+\}/);
          if(jsonMatch) {
            cleanResult = jsonMatch[0];
          }
        }
        
        // Ensure it ends with }
        if(!cleanResult.endsWith('}')) {
          cleanResult += '}';
        }
        
        const parsedResult = JSON.parse(cleanResult);
        console.log('✅ LLM intent detection result:', parsedResult);
        
        return {
          success: true,
          intent: parsedResult.intent || 'question',
          memoryCategory: parsedResult.memoryCategory || null,
          confidence: parsedResult.confidence || 0.7,
          entities: parsedResult.entities || [],
          requiresExternalData: parsedResult.intent === 'external_data_required'
        };
      } catch(parseError) {
        console.log('⚠️ Failed to parse LLM response, using fallback:', parseError.message);
        return fallbackDetection(message);
      }
    } catch(error) {
      console.log('⚠️ LLM error, using fallback:', error.message);
      return fallbackDetection(message);
    }
  }
};
