/**
 * IntentParserAgent - Object-based approach
 * Maps user input to intent tags and classifies messages into actionable intents for agent routing
 */

const AGENT_FORMAT = {
    name: 'IntentParserAgent',
    description: 'Maps user input to intent tags and classifies messages into actionable intents for agent routing with LLM and pattern-based detection',
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Intent parsing operation to perform',
          enum: [
            'parse-intent',
            'detect-entities',
            'classify-message',
            'validate-intent'
          ]
        },
        message: {
          type: 'string',
          description: 'User message to analyze for intent'
        },
        context: {
          type: 'object',
          description: 'Additional context for intent parsing'
        },
        confidenceThreshold: {
          type: 'number',
          description: 'Minimum confidence threshold for LLM results',
          minimum: 0.0,
          maximum: 1.0,
          default: 0.7
        }
      },
      required: ['action', 'message']
    },
    dependencies: [],
    execution_target: 'frontend',
    requires_database: false,
    database_type: undefined,
  
    // Object-based bootstrap method
    async bootstrap(config, context) {
      try {
        console.log('🔍 IntentParserAgent: Initializing intent parsing capabilities...');
        
        // Store configuration
        this.config = {
          llmTimeout: config.llmTimeout || 8000,
          confidenceThreshold: config.confidenceThreshold || 0.7,
          fallbackToPatterns: config.fallbackToPatterns !== false,
          maxTokens: config.maxTokens || 200,
          temperature: config.temperature || 0.1
        };
        
        // Initialize intent patterns
        this.intentPatterns = this.initializeIntentPatterns();
        
        console.log('✅ IntentParserAgent: Setup complete');
        return { 
          success: true, 
          config: this.config,
          patternsLoaded: Object.keys(this.intentPatterns).length
        };
        
      } catch (error) {
        console.error('❌ IntentParserAgent setup failed:', error);
        throw error;
      }
    },

    // Object-based execute method
    async execute(params, context) {
      try {
        const { action, message } = params;
        
        switch (action) {
          case 'parse-intent':
            return await this.parseIntent(params, context);
          case 'detect-entities':
            return await this.detectEntities(params, context);
          case 'classify-message':
            return await this.classifyMessage(params, context);
          case 'validate-intent':
            return await this.validateIntent(params, context);
          default:
            throw new Error('Unknown action: ' + action);
        }
        
      } catch (error) {
        console.error('❌ IntentParserAgent execution failed:', error);
        return {
          success: false,
          error: error.message,
          action: params.action,
          result: {
            intent: 'question',
            confidence: 0.5,
            entities: [],
            category: 'fallback'
          },
          timestamp: new Date().toISOString()
        };
      }
    },

    async parseIntent(params, context) {
      try {
        const { message, confidenceThreshold = this.config.confidenceThreshold } = params;
        const { llmClient } = context;
        
        console.log(`🔍 Parsing intent for: "${message}"`);
        
        // Try LLM-based intent detection first
        let intentResult;
        if (llmClient) {
          intentResult = await this.detectIntentWithLLM(message, context);
        }
        
        // Fallback to pattern matching if LLM fails or confidence is low
        if (!intentResult || intentResult.confidence < confidenceThreshold) {
          console.log('Using pattern-based intent detection');
          intentResult = this.detectIntentWithPatterns(message);
        }
        
        console.log('✅ Intent parsing complete:', intentResult.intent);
        
        return {
          success: true,
          action: 'parse-intent',
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
          },
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('❌ Intent parsing failed:', error);
        throw error;
      }
    },

    async detectIntentWithLLM(message, context) {
      try {
        const { llmClient } = context;
        const prompt = this.buildIntentPrompt(message);
        
        const response = await llmClient(prompt, {
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          timeout: this.config.llmTimeout
        });
        
        return this.parseIntentResponse(response, 'llm');
        
      } catch (error) {
        console.warn(`LLM intent detection failed: ${error.message}`);
        return null;
      }
    },

    buildIntentPrompt(message) {
      return `Classify this user message into one of these intents:

INTENTS:
- greeting: Hello, hi, good morning
- question: What, how, when, where, why questions
- command: Do something, perform action, execute task
{{ ... }}
  "intent": "intent_name",
  "confidence": 0.9,
  "entities": ["extracted", "entities"],
  "category": "memory|action|query|social"
}`;
    },

    parseIntentResponse(response, method) {
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
        console.warn(`Failed to parse LLM response: ${error.message}`);
        return null;
      }
    },

    detectIntentWithPatterns(message) {
      const lowerMessage = message.toLowerCase();
      
      for (const [intent, regexList] of Object.entries(this.intentPatterns)) {
        for (const regex of regexList) {
          if (regex.test(lowerMessage)) {
            return {
              intent,
              confidence: 0.85,
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

    async detectEntities(params, context) {
      try {
        const { message, intent } = params;
        
        console.log('🏷️ Detecting entities for intent:', intent);
        
        const entities = this.extractEntities(message, intent);
        
        return {
          success: true,
          action: 'detect-entities',
          entities: entities,
          count: entities.length,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('❌ Entity detection failed:', error);
        throw error;
      }
    },

    async classifyMessage(params, context) {
      try {
        const { message } = params;
        
        console.log('📝 Classifying message category...');
        
        // First get the intent
        const intentResult = await this.parseIntent(params, context);
        
        if (!intentResult.success) {
          throw new Error('Failed to parse intent for classification');
        }
        
        const category = this.getIntentCategory(intentResult.result.intent);
        
        return {
          success: true,
          action: 'classify-message',
          category: category,
          intent: intentResult.result.intent,
          confidence: intentResult.result.confidence,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('❌ Message classification failed:', error);
        throw error;
      }
    },

    async validateIntent(params, context) {
      try {
        const { intent } = params;
        
        console.log('✅ Validating intent:', intent);
        
        const isValid = this.isValidIntent(intent);
        
        return {
          success: true,
          action: 'validate-intent',
          intent: intent,
          isValid: isValid,
          validIntents: this.getValidIntents(),
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('❌ Intent validation failed:', error);
        throw error;
      }
    },

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

    requiresScreenContext(intent) {
      const screenContextIntents = [
        'command',
        'external_data_required'
      ];
      
      return screenContextIntents.includes(intent);
    },

    isValidIntent(intent) {
      return this.getValidIntents().includes(intent);
    },

    getValidIntents() {
      return [
        'greeting',
        'question',
        'command',
        'memory_store',
        'memory_retrieve',
        'memory_update',
        'memory_delete',
        'external_data_required'
      ];
    }
  };
  
module.exports = AGENT_FORMAT;
