/**
 * IntentParserAgent - Maps user input to intent tags
 * Classifies user messages into actionable intents for agent routing
 * 
 * LLM-Compatible JSON Structure Format
 */

// Agent code object containing all executable logic
const code = {
  /**
   * Main execution method - Parse user input and determine intent
   * @param {Object} input - Input data containing message
   * @param {Object} context - Execution context including llmClient and logger
   * @returns {Promise<Object>} - Agent execution result
   */
  async execute(input, context) {
    try {
      const { message } = input;
      const { llmClient, logger } = context;
      
      if (logger) {
        logger.info(`🔍 Parsing intent for: "${message}"`);
      }
      
      // Try LLM-based intent detection first
      let intentResult;
      if (llmClient) {
        intentResult = await this.detectIntentWithLLM(message, context);
      }
      
      // Fallback to pattern matching if LLM fails
      if (!intentResult || intentResult.confidence < 0.7) {
        if (logger) {
          logger.info('Using pattern-based intent detection');
        }
        intentResult = this.detectIntentWithPatterns(message);
      }
      
      return {
        success: true,
        result: {
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          entities: intentResult.entities || [],
          category: intentResult.category || 'general',
          requiresContext: this.requiresScreenContext(intentResult.intent)
        },
        metadata: {
          agent: 'IntentParserAgent',
          method: intentResult.method || 'pattern',
          originalMessage: message
        }
      };
      
    } catch (error) {
      const { logger } = context;
      if (logger) {
        logger.error(`❌ IntentParserAgent execution failed: ${error.message}`);
      }
      
      return {
        success: false,
        error: error.message,
        result: {
          intent: 'question',
          confidence: 0.5,
          entities: [],
          category: 'fallback'
        }
      };
    }
  },

  /**
   * Detect intent using LLM
   */
  async detectIntentWithLLM(message, context) {
    try {
      const { llmClient, logger } = context;
      const prompt = this.buildIntentPrompt(message, context);
      
      const response = await llmClient(prompt, {
        temperature: 0.1,
        maxTokens: 200,
        timeout: 8000
      });
      
      return this.parseIntentResponse(response, 'llm', logger);
      
    } catch (error) {
      const { logger } = context;
      if (logger) {
        logger.warn(`LLM intent detection failed: ${error.message}`);
      }
      return null;
    }
  },

  /**
   * Build intent detection prompt
   */
  buildIntentPrompt(message, context) {
    return `Classify this user message into one of these intents:

INTENTS:
- greeting: Hello, hi, good morning
- question: What, how, when, where, why questions
- command: Do something, perform action, execute task
- memory_store: Remember this, save information, my name is
- memory_retrieve: What's my name, recall information
- memory_update: Change my information, update details
- memory_delete: Forget this, delete information
- external_data_required: Complex tasks needing multiple steps

User Message: "${message}"

Respond with JSON:
{
  "intent": "intent_name",
  "confidence": 0.9,
  "entities": ["extracted", "entities"],
  "category": "memory|action|query|social"
}`;
  },

  /**
   * Parse LLM intent response
   */
  parseIntentResponse(response, method, logger) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const result = JSON.parse(jsonMatch[0]);
      result.method = method;
      
      // Validate intent
      if (!this.isValidIntent(result.intent)) {
        result.intent = 'question';
        result.confidence = 0.5;
      }
      
      return result;
      
    } catch (error) {
      if (logger) {
        logger.error(`Failed to parse intent response: ${error.message}`);
      }
      return {
        intent: 'question',
        confidence: 0.3,
        entities: [],
        method: method
      };
    }
  },

  /**
   * Detect intent using pattern matching
   */
  detectIntentWithPatterns(message) {
    const lowerMessage = message.toLowerCase().trim();
    const intentPatterns = this.initializeIntentPatterns();
    
    for (const [intent, patterns] of Object.entries(intentPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(lowerMessage)) {
          return {
            intent,
            confidence: 0.8,
            entities: this.extractEntities(message, intent),
            category: this.getIntentCategory(intent),
            method: 'pattern'
          };
        }
      }
    }
    
    // Default fallback
    return {
      intent: 'question',
      confidence: 0.6,
      entities: [],
      category: 'general',
      method: 'fallback'
    };
  },

  /**
   * Initialize intent detection patterns
   */
  initializeIntentPatterns() {
    return {
      greeting: [
        /^(hi|hello|hey|good morning|good afternoon|good evening)/,
        /^(what's up|how are you|how's it going)/
      ],
      
      memory_store: [
        /my name is/,
        /remember that/,
        /save this/,
        /store this/,
        /my .+ is/,
        /i am/,
        /i live/,
        /my favorite/
      ],
      
      memory_retrieve: [
        /what('s| is) my/,
        /do you remember/,
        /what did i/,
        /recall/,
        /what's my name/,
        /who am i/
      ],
      
      memory_update: [
        /update my/,
        /change my/,
        /my .+ is now/,
        /correct that/,
        /actually my/
      ],
      
      memory_delete: [
        /forget/,
        /delete/,
        /remove/,
        /don't remember/
      ],
      
      command: [
        /give me a response to this email/,
        /help me respond/,
        /draft a/,
        /create a/,
        /generate/,
        /make a/,
        /write a/,
        /send/,
        /schedule/,
        /set up/,
        /configure/
      ],
      
      external_data_required: [
        /login to/,
        /connect to/,
        /integrate with/,
        /fetch from/,
        /sync with/,
        /automate/,
        /workflow/,
        /multiple steps/
      ],
      
      question: [
        /^(what|how|when|where|why|who)/,
        /\?$/,
        /can you/,
        /could you/,
        /would you/,
        /explain/,
        /tell me/
      ]
    };
  },

  /**
   * Extract entities from message based on intent
   */
  extractEntities(message, intent) {
    const entities = [];
    
    if (intent === 'memory_store') {
      // Extract name
      const nameMatch = message.match(/my name is (\w+)/i);
      if (nameMatch) entities.push({ type: 'name', value: nameMatch[1] });
      
      // Extract other personal info
      const infoMatch = message.match(/my (\w+) is (.+)/i);
      if (infoMatch) entities.push({ type: infoMatch[1], value: infoMatch[2] });
    }
    
    return entities;
  },

  /**
   * Get intent category
   */
  getIntentCategory(intent) {
    const categories = {
      greeting: 'social',
      question: 'query',
      command: 'action',
      memory_store: 'memory',
      memory_retrieve: 'memory',
      memory_update: 'memory',
      memory_delete: 'memory',
      external_data_required: 'action'
    };
    
    return categories[intent] || 'general';
  },

  /**
   * Check if intent requires screen context
   */
  requiresScreenContext(intent) {
    const screenContextIntents = [
      'command',
      'external_data_required'
    ];
    
    return screenContextIntents.includes(intent);
  },

  /**
   * Validate intent name
   */
  isValidIntent(intent) {
    const validIntents = [
      'greeting',
      'question',
      'command',
      'memory_store',
      'memory_retrieve',
      'memory_update',
      'memory_delete',
      'external_data_required'
    ];
    
    return validIntents.includes(intent);
  }
};

// Default export with LLM-compatible JSON structure
export default {
  name: 'IntentParserAgent',
  description: 'Maps user input to intent tags and classifies messages into actionable intents for agent routing with LLM and pattern-based detection',
  code,
  dependencies: [],
  execution_target: 'backend',
  requires_database: false,
  config: {
    llm_timeout: 8000,
    confidence_threshold: 0.7,
    fallback_to_patterns: true,
    max_tokens: 200,
    temperature: 0.1
  },
  secrets: [],
  orchestrator_metadata: {
    chain_order: 1,
    resource_requirements: {
      memory: 'low',
      cpu: 'low',
      network: 'optional'
    },
    typical_execution_time_ms: 2000,
    can_run_parallel: true,
    output_format: {
      intent: 'string',
      confidence: 'number',
      entities: 'array',
      category: 'string',
      requiresContext: 'boolean'
    }
  }
};
