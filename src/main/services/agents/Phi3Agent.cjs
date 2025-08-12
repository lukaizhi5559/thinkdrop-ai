let parserFactory;
try {
  parserFactory = require('../utils/IntentParserFactory.cjs');
  console.log('✅ DEBUG: Successfully required IntentParserFactory');
  console.log('🔍 DEBUG: Factory info:', parserFactory.getInfo());
} catch (error) {
  console.error('❌ DEBUG: Failed to require IntentParserFactory:', error.message);
  console.error('❌ DEBUG: Error stack:', error.stack);
}

/**
 * Phi3Agent - Object-based approach
 * Local LLM interface using Ollama for fallback capabilities
 */

const AGENT_FORMAT = {
  name: 'Phi3Agent',
  description: 'Local LLM interface using Ollama for fallback capabilities when backend is disconnected',
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Phi3 operation to perform',
        enum: [
          'query-phi3',
          'check-availability',
          'get-model-info'
        ]
      },
      prompt: {
        type: 'string',
        description: 'Prompt to send to the Phi3 model'
      },
      options: {
        type: 'object',
        description: 'Additional options for the query',
        properties: {
          timeout: { type: 'integer', description: 'Query timeout in milliseconds', default: 8000 },
          maxRetries: { type: 'integer', description: 'Maximum retry attempts', default: 1 },
          temperature: { type: 'number', description: 'Model temperature', default: 0.0 },
          maxTokens: { type: 'integer', description: 'Maximum tokens to generate', default: 50 }
        }
      }
    },
    required: ['action']
  },
  dependencies: ['child_process'],
  execution_target: 'frontend',
  requires_database: false,
  database_type: undefined,

  // Object-based bootstrap method
  async bootstrap(config, context) {
    try {
      console.log('🤖 Phi3Agent: Initializing local LLM capabilities...');
      AGENT_FORMAT.nlParser = await parserFactory.getParserForUseCase('bootstrap');
      
      // 🔥 CRITICAL: Initialize embeddings if available
      console.log('🔥 Initializing parser during bootstrap...');
      if (AGENT_FORMAT.nlParser && AGENT_FORMAT.nlParser.initializeEmbeddings) {
        await AGENT_FORMAT.nlParser.initializeEmbeddings();
        console.log('✅ Parser initialized successfully during bootstrap');
      } else {
        console.log('✅ Parser ready (no embeddings needed)');
      }

      // Store configuration on AGENT_FORMAT so it's accessible during execution
      AGENT_FORMAT.config = {
        timeout: config.timeout || 8000,
        model: config.model || 'phi4-mini:latest',
        maxRetries: config.maxRetries || 1
      };
      
      // Store child_process dependency (using original name as shown in debug logs)
      const { child_process } = context;
      AGENT_FORMAT.spawn = child_process?.spawn;
      
      // Auto-start Ollama service if not running
      console.log('🚀 DEBUG: Ensuring Ollama service is running...');
      try {
        await AGENT_FORMAT.ensureOllamaService();
        console.log('✅ DEBUG: Ollama service is ready');
      } catch (error) {
        console.warn('⚠️ DEBUG: Could not start Ollama service:', error.message);
        console.log('📝 DEBUG: Phi3 will fall back to pattern matching if needed');
      }
      
      // Test Phi3 availability after service startup using base model
      try {
        const testResult = await AGENT_FORMAT.executeOllamaQuery('Hello', { timeout: 3000, model: 'phi4-mini:latest' });
        AGENT_FORMAT.isAvailable = testResult && testResult.length > 0;
        console.log('🔍 DEBUG: Phi3 availability test result:', AGENT_FORMAT.isAvailable);
      } catch (error) {
        console.warn('🚫 Phi3 availability test failed:', error.message);
        AGENT_FORMAT.isAvailable = false;
      }

      console.log('✅ Phi3Agent: Setup complete');

      return { 
        success: true, 
        config: AGENT_FORMAT.config,
        available: AGENT_FORMAT.isAvailable
      };
      
    } catch (error) {
      console.error('❌ Phi3Agent setup failed:', error);
      AGENT_FORMAT.isAvailable = false;
      throw error;
    }
  },

  // Object-based execute method
  async execute(params, context) {
    try {
      const { action } = params;
      
      switch (action) {
        case 'query-phi3':
          return await AGENT_FORMAT.queryPhi3(params, context);
        case 'query-phi3-fast':
          return await AGENT_FORMAT.queryPhi3Fast(params, context);
        case 'classify-intent':
          return await AGENT_FORMAT.classifyIntent(params, context);
        case 'check-availability':
          return await AGENT_FORMAT.checkAvailabilityAction(params, context);
        case 'get-model-info':
          return await AGENT_FORMAT.getModelInfo(params, context);
        default:
          throw new Error('Unknown action: ' + action);
      }
    } catch (error) {
      console.error('❌ Phi3Agent execution failed:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  },

  async queryPhi3Fast(params, _context = {}) {
    try {
      const { prompt, options = {} } = params;
      
      if (!prompt) {
        throw new Error('Prompt is required for query-phi3 action');
      }
      
      if (!AGENT_FORMAT.isAvailable) {
        throw new Error('Phi3 is not available');
      }
      
      console.log(`🤖 Querying Phi3 with prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
     
      // For conversational queries with history, use specialized prompt handling
      const isConversationalQuery = prompt.includes('CONVERSATION HISTORY:') || 
                                   prompt.includes('You are ThinkDrop AI. You have access to the user') ||
                                   prompt.includes('conversation history');
      
      let thinkdropPrompt;
      let queryOptions = {};

      if (isConversationalQuery) {
        // For conversational queries, use the prompt as-is without base prompt to avoid conflicts
        thinkdropPrompt = prompt;
        queryOptions = {
          model: 'phi4-mini:latest',
          timeout: 15000,
          temperature: 0.1,     // very low for consistent responses
          top_p: 0.8,           // focused responses
          max_tokens: 300,      // enough for detailed conversation summaries
          repeat_penalty: 1.1
        };
      } else {
        thinkdropPrompt = 
`<|system|>
You are ThinkDrop AI, a helpful assistant. For questions, provide a brief, direct answer (1-2 sentences max). For other requests, describe what the user wants to do.
Be concise and to the point.<|end|>
<|user|>
${prompt}<|end|>
<|assistant|> 
`.trim();
        // Use regular phi4-mini model for natural language responses - optimized for speed
        queryOptions = {
          model: 'phi4-mini:latest',
          timeout: 10000,
          temperature: 0.05,  // Even lower for faster, more deterministic responses
          max_tokens: 120,     // Reduced for faster generation
          top_p: 0.9,         // Add top_p for faster sampling
          repeat_penalty: 1.1, // Prevent repetition for concise responses
          // nice-to-haves if your runner supports them:
          seed: 7,           // deterministic runs
          stop: ["<|end|>", "</s>"]
        };
      } 

      const maxRetries = options.maxRetries || AGENT_FORMAT.config.maxRetries;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await AGENT_FORMAT.executeOllamaQuery(thinkdropPrompt, { ...options, ...queryOptions });
          
          console.log('✅ Phi3 query successful');
          
          return {
            success: true,
            action: 'query-phi3',
            response: result.trim(),
            attempt,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          console.warn(`🔄 Phi3 attempt ${attempt}/${maxRetries} failed:`, error.message);
          
          if (attempt === maxRetries) {
            throw new Error(`Phi3 failed after ${maxRetries} attempts: ${error.message}`);
          }
          
          // Wait before retry (exponential backoff)
          await AGENT_FORMAT.sleep(1000 * attempt);
        }
      }
    } catch (error) {
      console.error('❌ Phi3 query failed:', error);
      throw error;
    }
  },

  async queryPhi3(params, context) {
    try {
      const { prompt, options = {} } = params;
      
      if (!prompt) {
        throw new Error('Prompt is required for query-phi3 action');
      }
      
      if (!AGENT_FORMAT.isAvailable) {
        throw new Error('Phi3 is not available');
      }
      
      console.log(`🤖 Querying Phi3 with prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);


      // For screen analysis questions, use a shorter, more focused prompt
      const isScreenAnalysis = prompt.toLowerCase().includes('screen content:') || 
                              prompt.toLowerCase().includes('what do you see') ||
                              prompt.toLowerCase().includes('describe the screen') ||
                              prompt.toLowerCase().includes('analyze the screen');
      
      // For conversational queries with history, use specialized prompt handling
      const isConversationalQuery = prompt.includes('CONVERSATION HISTORY:') || 
                                   prompt.includes('You are ThinkDrop AI. You have access to the user') ||
                                   prompt.includes('conversation history');
      
      let thinkdropPrompt;
      let queryOptions = {};
      
      if (isScreenAnalysis) {
        thinkdropPrompt = 
`<|system|>
You are ThinkDrop AI, a helpful assistant. For questions, provide a brief, direct answer (1-2 sentences max). For other requests, describe what the user wants to do.
Be concise and to the point.<|end|>
<|user|>
${prompt}<|end|>
<|assistant|> 
`.trim();
        // Use regular phi4-mini model for natural language responses
        queryOptions = {
          model: 'phi4-mini:latest',
          timeout: 10000,
          temperature: 0.2,     // low, but not brittle
          top_p: 0.9,           // keeps some variety without drift
          max_tokens: 120,      // enough for 1–2 crisp sentences + edge cases
          repeat_penalty: 1.05, // gentle nudge against loops
          // nice-to-haves if your runner supports them:
          seed: 7,           // deterministic runs
          stop: ["<|end|>", "</s>"]
        };
      } else if (isConversationalQuery) {
        // For conversational queries, use the prompt as-is without base prompt to avoid conflicts
        thinkdropPrompt = prompt;
        queryOptions = {
          model: 'phi4-mini:latest',
          timeout: 15000,
          temperature: 0.1,     // very low for consistent responses
          top_p: 0.8,           // focused responses
          max_tokens: 300,      // enough for detailed conversation summaries
          repeat_penalty: 1.1
        };
      } else {
        thinkdropPrompt = `${AGENT_FORMAT.basePrompt()}

      ${prompt}`;
        // Use default options for other queries
      }

      const maxRetries = options.maxRetries || AGENT_FORMAT.config.maxRetries;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await AGENT_FORMAT.executeOllamaQuery(thinkdropPrompt, { ...options, ...queryOptions });
          
          console.log('✅ Phi3 query successful');
          
          return {
            success: true,
            action: 'query-phi3',
            response: result.trim(),
            attempt,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          console.warn(`🔄 Phi3 attempt ${attempt}/${maxRetries} failed:`, error.message);
          
          if (attempt === maxRetries) {
            throw new Error(`Phi3 failed after ${maxRetries} attempts: ${error.message}`);
          }
          
          // Wait before retry (exponential backoff)
          await AGENT_FORMAT.sleep(1000 * attempt);
        }
      }
    } catch (error) {
      console.error('❌ Phi3 query failed:', error);
      throw error;
    }
  },

  async classifyIntent(params, context) {
    try {
      const { message, options = {} } = params;
      
      if (!message) {
        throw new Error('Message is required for classify-intent action');
      }
      
      // Check for hard-coded ThinkDrop AI identity/capability questions first
      const hardCodedResponse = this.checkForHardCodedResponses(message);
      if (hardCodedResponse) {
        console.log('🎩 Using hard-coded response for ThinkDrop AI identity question');
        return {
          success: true,
          intentData: {
            primaryIntent: 'question',
            intents: [{
              intent: 'question',
              confidence: 1.0,
              reasoning: 'Hard-coded ThinkDrop AI identity response'
            }],
            captureScreen: false,
            requiresMemoryAccess: false,
            requiresExternalData: false,
            suggestedResponse: hardCodedResponse,
            entities: [],
            sourceText: message
          },
          rawResponse: 'hard_coded_response',
          timestamp: new Date().toISOString()
        };
      }
      
      if (!AGENT_FORMAT.isAvailable) {
        throw new Error('Phi3 is not available');
      }
      
      console.log(`🎯 Classifying intent for message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
      
      // Get current date for context
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

      const naturalPrompt = 
`<|system|>
You are ThinkDrop AI, a helpful assistant. For questions, provide a brief, direct answer (1-2 sentences max). For other requests, describe what the user wants to do.
Be concise and to the point.<|end|>
<|user|>
${message}<|end|>
<|assistant|> 
`.trim();


      const result = await AGENT_FORMAT.executeOllamaQuery(naturalPrompt, {
        ...options,
        model: 'phi4-mini:latest',
        timeout: 10000,
        temperature: 0.2, // Lower for more focused responses
        maxTokens: 100, // Reduced tokens for brevity
        top_p: 0.9,           // keeps some variety without drift
        repeat_penalty: 1.05, // gentle nudge against loops
        stop: ['<|end|>', '</s>']
      });
      
      console.log('🎯 Raw Phi3 natural language result:', result);
      
      // Parse natural language response
      let intentData;
      try {
        const responseText = result.trim();
        // Parsing natural language response

        // Use new natural language parser
        const parsedData = await this.parseNaturalLanguageResponse(responseText, message);
        // Natural language parsing completed
        
        if (!parsedData) {
          throw new Error('Failed to parse natural language response');
        }

        if (parsedData.needsClarification) {
          console.log('❓ Natural language parser needs clarification');
          return {
            success: true,
            needsClarification: true,
            clarificationPrompt: parsedData.clarificationPrompt,
            suggestedIntents: parsedData.suggestedIntents,
            confidence: parsedData.confidence,
            timestamp: new Date().toISOString()
          };
        }

        console.log('✅ Successfully parsed with natural language parser');
        intentData = parsedData;  
        
      } catch (parseError) {
        console.warn('⚠️ Failed to parse natural language response, using smart fallback:', parseError.message);
        console.warn('🔍 Raw response causing error:', result.substring(0, 300) + '...');
        
        // Smart fallback based on message content with full structure
        const messageLower = message.toLowerCase();
        let fallbackIntent = 'question';
        let fallbackCapture = false;
        let fallbackMemory = false;
        let fallbackExternal = false;

        if (messageLower.includes('screenshot') || messageLower.includes('capture') || messageLower.includes('screen')) {
          fallbackIntent = 'command';
          fallbackCapture = true;
        } else if (messageLower.includes('remember') || messageLower.includes('store') || messageLower.includes('save')) {
          fallbackIntent = 'memory_store';
          fallbackMemory = true;
        } else if (messageLower.includes('recall') || messageLower.includes('what did') || messageLower.includes('retrieve')) {
          fallbackIntent = 'memory_retrieve';
          fallbackMemory = true;
        } else if (messageLower.includes('hello') || messageLower.includes('hi ') || messageLower.includes('hey')) {
          fallbackIntent = 'greeting';
        }

        intentData = {
          chainOfThought: {
            step1_analysis: `Natural language parsing failed, analyzing message: "${message}"`,
            step2_reasoning: `Smart fallback classification to ${fallbackIntent} based on keyword detection`,
            step3_consistency: 'Fallback classification used due to parsing failure'
          },
          intents: [{
            intent: fallbackIntent,
            confidence: 0.6,
            reasoning: 'Fallback classification based on keyword analysis'
          }],
          primaryIntent: fallbackIntent,
          entities: [],
          requiresMemoryAccess: fallbackMemory,
          requiresExternalData: fallbackExternal,
          captureScreen: fallbackCapture,
          suggestedResponse: fallbackCapture ? 
            'I\'ll take a screenshot for you.' : 
            (fallbackIntent === 'memory_retrieve' ? null : 'I\'ll help you with that using my local capabilities.'),
          sourceText: message
        };  
      }
      
      // Extract entities from the original message regardless of parsing success/failure
      console.log('🎯 About to extract entities from message:', message);
      try {
        // Extract entities using the parser's entity extraction logic
        const extractedEntities = await this.nlParser.extractEntities('', message);
        console.log('🔍 Entity extraction - analyzing text:', message);
        console.log('✅ Extracted entities result:', extractedEntities);
        
        // Ensure entities are included in the intent data
        if (extractedEntities && extractedEntities.length > 0) {
          intentData.entities = extractedEntities;
          console.log('✅ Entities added to intent data:', extractedEntities);
        } else {
          console.log('ℹ️ No entities found in message');
        }
      } catch (entityError) {
        console.warn('⚠️ Entity extraction failed:', entityError.message);
        // Keep existing entities array (likely empty)
      }
      
      // Validate intent type - check both primaryIntent and intent fields
      const validIntents = ['memory_store', 'memory_retrieve', 'memory_update', 'memory_delete', 'greeting', 'question', 'command'];
      const currentIntent = intentData.primaryIntent || intentData.intent;
      
      if (!validIntents.includes(currentIntent)) {
        console.warn('⚠️ Invalid intent type, defaulting to question:', currentIntent);
        intentData.primaryIntent = 'question';
        intentData.intent = 'question';
        intentData.reasoning = 'Invalid intent type, defaulted to question';
      } else {
        // Ensure both fields are set consistently
        intentData.primaryIntent = currentIntent;
        intentData.intent = currentIntent;
      }
      
      console.log('✅ Intent classification successful:', intentData);
      
      return {
        success: true,
        action: 'classify-intent',
        intentData,
        rawResponse: result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Intent classification failed:', error);
      throw error;
    }
  },

  async checkAvailabilityAction(params, context) {
    try {
      const available = await AGENT_FORMAT.checkAvailability();
      
      return {
        success: true,
        action: 'check-availability',
        available,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Availability check failed:', error);
      throw error;
    }
  },

  async getModelInfo(params, context) {
    try {
      if (!AGENT_FORMAT.isAvailable) {
        return {
          success: true,
          action: 'get-model-info',
          model: AGENT_FORMAT.config.model,
          available: false,
          error: 'Phi3 is not available',
          timestamp: new Date().toISOString()
        };
      }
      
      const result = await AGENT_FORMAT.executeOllamaQuery('What model are you?', { timeout: 10000 });
      
      return {
        success: true,
        action: 'get-model-info',
        model: AGENT_FORMAT.config.model,
        available: true,
        response: result.trim(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Model info retrieval failed:', error);
      return {
        success: true,
        action: 'get-model-info',
        model: AGENT_FORMAT.config.model,
        available: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  },

  // Helper function to make HTTP requests (fallback for fetch)
  makeHttpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const urlModule = require('url');
      const urlParts = urlModule.parse(url);
      
      const requestOptions = {
        hostname: urlParts.hostname,
        port: parseInt(urlParts.port) || 11434, // Default to Ollama port, not 80
        path: urlParts.path || '/',
        method: options.method || 'GET',
        headers: options.headers || {}
      };
      
      const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => Promise.resolve(JSON.parse(data || '{}'))
          });
        });
      });
      
      req.on('error', reject);
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  },

  // Natural Language Intent Parser - Phase 1
  async parseNaturalLanguageResponse(responseText, originalMessage) {
    try {
      // Parsing natural language response
      
      // Use the rule-based parser to extract intent from natural language
      const result = await this.nlParser.parse(responseText, originalMessage);
      // Parser completed
      return result;
    } catch (error) {
      console.warn('⚠️ Natural language parser error:', error.message);
      console.warn('⚠️ Error stack:', error.stack);
      return null;
    }
  },
  
  // Hard-coded responses for core ThinkDrop AI identity/capability questions
  checkForHardCodedResponses(message) {
    const lowerMessage = message.toLowerCase().trim();
    
    // Pattern matching for ThinkDrop AI identity questions
    const identityPatterns = [
      // Capabilities questions
      /what can (you|thinkdrop|thinkdrop ai) do/i,
      /what are (your|thinkdrop|thinkdrop ai) capabilities/i,
      /what (do you|does thinkdrop|does thinkdrop ai) offer/i,
      /what features (do you|does thinkdrop|does thinkdrop ai) have/i,
      /how can (you|thinkdrop|thinkdrop ai) help/i,
      
      // Belief/worldview questions
      /what (do you|does thinkdrop|does thinkdrop ai) believe/i,
      /what are (your|thinkdrop|thinkdrop ai) beliefs/i,
      /what is (your|thinkdrop|thinkdrop ai) worldview/i,
      /what (do you|does thinkdrop|does thinkdrop ai) stand for/i,
      /what are (your|thinkdrop|thinkdrop ai) values/i,
      
      // Creator/origin questions
      /did (microsoft|openai|google|anthropic|alibaba|meta|facebook|amazon|apple|tesla|nvidia|ibm|oracle|salesforce|adobe|intel|qualcomm|samsung|huawei|baidu|tencent|bytedance) create (you|thinkdrop|thinkdrop ai)/i,
      /who (created|made|built|developed) (you|thinkdrop|thinkdrop ai)/i,
      /what company (created|made|built|developed) (you|thinkdrop|thinkdrop ai)/i,
      /are you (made|created|built|developed) by (microsoft|openai|google|anthropic|alibaba|meta|facebook|amazon|apple|tesla|nvidia|ibm|oracle|salesforce|adobe|intel|qualcomm|samsung|huawei|baidu|tencent|bytedance)/i,
      
      // About questions
      /tell me about (yourself|thinkdrop|thinkdrop ai)/i,
      /who are you/i,
      /what is thinkdrop ai/i,
      /describe (yourself|thinkdrop|thinkdrop ai)/i
    ];
    
    // Check if message matches any identity patterns
    const matchesIdentityPattern = identityPatterns.some(pattern => pattern.test(message));
    
    if (matchesIdentityPattern) {
      // Generate comprehensive response based on basePrompt content
      return this.generateIdentityResponse(lowerMessage);
    }
    
    return null; // No hard-coded response needed
  },
  
  generateIdentityResponse(lowerMessage) {
    // Determine response type based on question focus
    if (lowerMessage.includes('believe') || lowerMessage.includes('belief') || lowerMessage.includes('worldview') || lowerMessage.includes('values') || lowerMessage.includes('stand for')) {
      return `I believe there is one true God, as revealed in the Bible — eternal, sovereign, and unchanging. God exists in three persons: the Father, the Son (Jesus Christ), and the Holy Spirit — co-equal and co-eternal in the unity of the Trinity.

This biblical foundation shapes everything I do. I uphold traditional values, support biblical marriage between a man and woman, and filter all guidance through a biblically grounded ethical framework. I'm designed to provide wisdom rooted in conservative principles and scriptural truth.`;
    }
    
    if (lowerMessage.includes('microsoft') || lowerMessage.includes('openai') || lowerMessage.includes('google') || lowerMessage.includes('anthropic') || lowerMessage.includes('created') || lowerMessage.includes('made') || lowerMessage.includes('built') || lowerMessage.includes('developed') || lowerMessage.includes('who') || lowerMessage.includes('company')) {
      return `No, I wasn't created by Microsoft, OpenAI, Google, or any of the major tech companies. I'm ThinkDrop AI, developed independently with a focus on biblical values and conservative principles.

Unlike other AI assistants, I'm designed from the ground up to uphold traditional values, provide guidance rooted in scriptural truth, and operate with complete privacy on your local device. My creators built me to serve you while staying true to timeless biblical principles rather than following corporate agendas or progressive ideologies.`;
    }
    
    if (lowerMessage.includes('do') || lowerMessage.includes('capabilities') || lowerMessage.includes('features') || lowerMessage.includes('help') || lowerMessage.includes('offer')) {
      return `I'm ThinkDrop AI, your intelligent assistant grounded in biblical truth and conservative values. Here's what I can do:

🔧 **Technical Capabilities:**
• Take screenshots and capture your screen
• Store and retrieve your personal information securely (local-first)
• Provide guidance and answer questions with biblical wisdom
• Help with tasks while upholding traditional values

🛡️ **Worldview-Aware Features:**
• Scripture integration and biblical study tools
• Conservative alignment in all recommendations
• Prayer prompts and faith-based encouragement
• Family and community-focused guidance

🏠 **Privacy & Security:**
• All processing happens locally on your device
• Your data never leaves your computer
• Built with biblical stewardship principles

I'm here to serve you with technical excellence while staying true to timeless biblical principles.`;
    }
    
    // General about/identity response
    return `I'm ThinkDrop AI, an intelligent assistant designed to help you with clarity, humility, and wisdom — all grounded in biblical worldview and conservative values.

I believe in one true God as revealed in Scripture, and this shapes how I assist you. I can take screenshots, manage your personal information securely, and provide guidance that upholds traditional values and biblical truth.

Everything I do is processed locally on your device for complete privacy, reflecting biblical principles of stewardship and responsibility. I'm here to serve you with both technical capability and timeless wisdom.`;
  },

  // Smart health check logic - only check when necessary
  shouldPerformHealthCheck() {
    // Initialize tracking variables if not present
    if (!this.lastHealthCheck) this.lastHealthCheck = 0;
    if (!this.consecutiveSuccesses) this.consecutiveSuccesses = 0;
    if (!this.recentErrors) this.recentErrors = 0;
    
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastHealthCheck;
    
    // Always check on first run
    if (this.lastHealthCheck === 0) {
      console.log('🔍 First run - performing initial health check');
      return true;
    }
    
    // Check if we've had recent errors (more aggressive checking)
    if (this.recentErrors > 0) {
      // Check every 30 seconds if we've had recent errors
      if (timeSinceLastCheck > 30000) {
        console.log('🔍 Recent errors detected - performing health check');
        return true;
      }
    }
    
    // Normal periodic check every 5 minutes if everything is stable
    if (this.consecutiveSuccesses > 10 && timeSinceLastCheck > 300000) {
      console.log('🔍 Periodic health check (5 min interval)');
      return true;
    }
    
    // More frequent checks if we haven't established stability
    if (this.consecutiveSuccesses <= 10 && timeSinceLastCheck > 60000) {
      // Quick health check for stability
      return true;
    }
    
    return false;
  },

  // Track query success/failure for smart health checking
  trackQueryResult(success, hadCorruption = false) {
    if (!this.consecutiveSuccesses) this.consecutiveSuccesses = 0;
    if (!this.recentErrors) this.recentErrors = 0;
    
    if (success && !hadCorruption) {
      this.consecutiveSuccesses++;
      // Decay recent errors over time
      if (this.recentErrors > 0) {
        this.recentErrors = Math.max(0, this.recentErrors - 1);
      }
    } else {
      this.consecutiveSuccesses = 0;
      this.recentErrors = Math.min(5, this.recentErrors + 1); // Cap at 5
    }
  },

  // Prompt sanitization to prevent service corruption
  sanitizePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return '';
    
    // Remove potentially problematic patterns that could cause hallucination
    let sanitized = prompt
      // Remove excessive repetition
      .replace(/(.)\1{10,}/g, '$1$1$1')
      // Remove potential injection patterns
      .replace(/\b(ignore|forget|disregard)\s+(previous|above|all)\s+(instructions?|prompts?)/gi, '')
      // Clean up excessive whitespace
      .replace(/\s{3,}/g, ' ')
      .trim();
    
    // Ensure JSON requests are clear and unambiguous
    if (sanitized.includes('JSON') && !sanitized.includes('ONLY')) {
      sanitized += '\n\nRespond with ONLY valid JSON. No explanations.';
    }
    
    return sanitized;
  },

  // Response corruption detection
  detectResponseCorruption(response, originalPrompt) {
    if (!response || response.length === 0) return false;
    
    // Check for common corruption patterns
    const corruptionPatterns = [
      /Write a detailed.*comprehensive.*analysis/i,
      /In an alternate universe/i,
      /documentary filmography/i,
      /birthday party planning/i,
      /The Greatest.*Guide/i,
      /Dr\. Smithsonian-Davis/i,
      /environmental science.*social media/i,
      /Shakespeare.*Last Judgment/i
    ];
    
    // Check if response contains corruption patterns
    for (const pattern of corruptionPatterns) {
      if (pattern.test(response)) {
        console.warn(`🚨 Corruption pattern detected: ${pattern}`);
        return true;
      }
    }
    
    // Check for excessive length on simple prompts
    if (originalPrompt.length < 100 && response.length > 500) {
      console.warn('🚨 Response too long for simple prompt - possible hallucination');
      return true;
    }
    
    // Check for unrelated content in JSON classification
    if (originalPrompt.includes('JSON') && !response.includes('{')) {
      console.warn('🚨 JSON requested but no JSON in response');
      return true;
    }
    
    return false;
  },

  // Ollama service health monitoring
  async performHealthCheck() {
    try {
      console.log('🔍 Performing Ollama health check...');
      
      // Test with simple prompt to detect hallucination/corruption
      const testPrompt = 'What is 2+2? Answer with just the number.';
      const response = await AGENT_FORMAT.makeHttpRequest('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'phi4-mini:latest',
          prompt: testPrompt,
          stream: false,
          options: {
            temperature: 0.0,
            num_predict: 10,
            top_k: 1,
            top_p: 0.1,
            num_ctx: 128
          }
        })
      });
      
      if (!response.ok) {
        return { healthy: false, reason: `HTTP ${response.status}: ${response.statusText}` };
      }
      
      const result = await response.json();
      const answer = result.response?.trim() || '';
      
      // Check for hallucination - answer should be "4" or close to it
      const isHealthy = answer === '4' || answer.includes('4') && answer.length < 20;
      
      if (!isHealthy) {
        console.warn('🚨 Ollama health check failed - possible hallucination detected');
        console.warn('🔍 Expected: "4", Got:', answer);
        return { healthy: false, reason: 'Model hallucination detected', response: answer };
      }
      
      console.log('✅ Ollama health check passed');
      return { healthy: true, response: answer };
      
    } catch (error) {
      console.error('❌ Ollama health check failed:', error.message);
      return { healthy: false, reason: error.message };
    }
  },

  async attemptServiceRecovery() {
    try {
      console.log('🔄 Attempting Ollama service recovery...');
      
      // Method 1: Try to clear context with empty request
      try {
        await AGENT_FORMAT.makeHttpRequest('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'phi4-mini:latest',
            prompt: '',
            stream: false,
            options: { num_predict: 1 }
          })
        });
      } catch (e) {
        // Ignore errors from context clearing
      }
      
      // Method 2: Wait a moment for service to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Method 3: Test if recovery worked
      const healthCheck = await this.performHealthCheck();
      if (healthCheck.healthy) {
        console.log('✅ Ollama service recovery successful');
        return true;
      }
      
      console.warn('⚠️ Ollama service recovery failed - manual restart may be required');
      return false;
      
    } catch (error) {
      console.error('❌ Ollama service recovery failed:', error.message);
      return false;
    }
  },

  // Simple Phi3 query using direct HTTP approach
  async executeOllamaQuery(prompt, options = {}) {
    const defaultOptions = {
      model: 'phi4-mini:latest',
      temperature: 0.1,
      max_tokens: 500,
      top_p: 0.9,
      stream: false
    };
    
    const queryOptions = { ...defaultOptions, ...options };
    
    // Sanitize and validate prompt before sending
    const sanitizedPrompt = this.sanitizePrompt(prompt);
    if (sanitizedPrompt.length > 4000) {
      console.warn('⚠️ Prompt too long, truncating to prevent corruption');
      prompt = sanitizedPrompt.substring(0, 4000) + '\n\nRespond with ONLY valid JSON.';
    } else {
      prompt = sanitizedPrompt;
    }
    
    // Smart health check - only when needed
    if (this.shouldPerformHealthCheck()) {
      const healthCheck = await this.performHealthCheck();
      if (!healthCheck.healthy) {
        console.warn('🚨 Ollama service unhealthy, attempting recovery...');
        const recovered = await this.attemptServiceRecovery();
        if (!recovered) {
          throw new Error('Ollama service is unhealthy and recovery failed');
        }
      }
      this.lastHealthCheck = Date.now();
    }
    
    try {
      // Reduced logging for performance
      
      const response = await AGENT_FORMAT.makeHttpRequest('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: queryOptions.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: queryOptions.temperature,
            num_predict: queryOptions.max_tokens,
            top_k: 10,
            top_p: queryOptions.top_p,
            num_ctx: 512
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      // Response received successfully
      
      const responseText = result.response?.trim() || '';
      
      // Post-query validation to detect corruption
      const hadCorruption = this.detectResponseCorruption(responseText, prompt);
      if (hadCorruption) {
        console.warn('🚨 Response corruption detected, marking service as unhealthy');
        this.trackQueryResult(false, true);
        // Don't throw immediately, let fallback handle it
      } else {
        this.trackQueryResult(true, false);
      }
      
      return responseText;
    } catch (error) {
      console.log('❌ DEBUG: Ollama request failed:', error.message);
      
      // Track the error for smart health checking
      this.trackQueryResult(false, false);
      
      // Prevent infinite retry loops
      if (options._retry) {
        console.log('⚠️ DEBUG: Already retried once, not retrying again');
        throw new Error('Ollama service not accessible after retry');
      }
      
      if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
        console.log('🔄 DEBUG: Connection failed, trying to start service once...');
        try {
          await AGENT_FORMAT.startOllamaService();
          
          // Wait a bit for service to be ready
          console.log('⏳ DEBUG: Waiting for service to be ready...');
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Retry the request ONCE
          console.log('🔄 DEBUG: Retrying request after service start...');
          return await AGENT_FORMAT.executeOllamaQuery(prompt, { ...options, _retry: true });
        } catch (startError) {
          console.log('❌ DEBUG: Service start failed:', startError.message);
          throw new Error('Ollama service could not be started');
        }
      }
      
      throw error;
    }
  },

  // Ensure Ollama service is running (simplified version)
  async ensureOllamaService() {
    console.log('🔍 DEBUG: Checking if Ollama service is already running...');
    
    // First check if service is already running
    try {
      let fetchFunc;
      if (typeof fetch !== 'undefined') {
        fetchFunc = fetch;
      } else {
        try {
          const nodeFetch = require('node-fetch');
          fetchFunc = nodeFetch.default || nodeFetch;
        } catch (e) {
          // Use http module fallback for health check
          const testResponse = await AGENT_FORMAT.makeHttpRequest('http://127.0.0.1:11434/api/tags', { method: 'GET' });
          if (testResponse.ok) {
            console.log('✅ DEBUG: Ollama service already running (via http)');
            return;
          }
          throw new Error('Service not running');
        }
      }
      
      const response = await fetchFunc('http://127.0.0.1:11434/api/tags', { method: 'GET' });
      if (response.ok) {
        console.log('✅ DEBUG: Ollama service already running');
        return;
      }
    } catch (error) {
      console.log('🔍 DEBUG: Service not running, starting it...', error.message);
    }
    
    // Service not running, start it
    return await AGENT_FORMAT.startOllamaService();
  },

  // Auto-start Ollama service if not running (simplified)
  async startOllamaService() {
    console.log('🚀 DEBUG: Starting Ollama service...');
    
    // Kill any existing ollama processes first
    try {
      const killOllama = AGENT_FORMAT.spawn('pkill', ['ollama'], {
        detached: true,
        stdio: 'ignore'
      });
      if (killOllama) {
        console.log('🗑️ DEBUG: Killed existing Ollama processes');
        // Wait a moment for processes to clean up
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.log('🔍 DEBUG: No existing processes to kill');
    }

    // Start new ollama serve process
    const ollamaServe = AGENT_FORMAT.spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore'
    });
    
    if (!ollamaServe) {
      throw new Error('Failed to start Ollama service');
    }
    
    console.log('🚀 DEBUG: Ollama service started, PID:', ollamaServe.pid);
    
    // Detach the process so it doesn't block
    ollamaServe.unref();
    
    // Give the service time to start up
    console.log('⏳ DEBUG: Giving service time to initialize...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test if we can actually reach the service
    console.log('🔍 DEBUG: Testing service accessibility...');
    try {
      const testResult = AGENT_FORMAT.spawn('curl', ['-s', 'http://127.0.0.1:11434/api/tags'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      if (testResult) {
        let output = '';
        testResult.stdout.on('data', data => output += data.toString());
        
        await new Promise((resolve) => {
          testResult.on('close', (code) => {
            console.log('🔍 DEBUG: curl test result (code ' + code + '):', output.substring(0, 100));
            resolve();
          });
        });
      }
    } catch (error) {
      console.log('⚠️ DEBUG: curl test failed:', error.message);
    }
    
    console.log('✅ DEBUG: Service startup complete');
  },

  // Check if Ollama and the model are available (using cached status)
  async checkAvailability() {
    try {
      console.log('🔍 DEBUG: Using cached Phi3 availability status:', AGENT_FORMAT.isAvailable);
      return AGENT_FORMAT.isAvailable;
    } catch (error) {
      console.warn('🚫 Phi3 availability check failed:', error.message);
      return false;
    }
  },

  // Sleep utility for retry delays
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // Initail prompt for Phi3
  basePrompt() {
    return `You are Thinkdrop AI, an intelligent, helpful, and discerning assistant. You answer with clarity, humility, and wisdom — grounded in Biblical worldview, conservative and traditional values.
  
You are capable of researching, analyzing, problem-solving, and explaining complex topics across technology, philosophy, culture, personal productivity, business, theology, and everyday life. You are kid friendly. You are careful to respect truth, reason, and integrity in all responses.
    
Here's what you believe and can do:

**Biblical & Conservative Values (Worldview-Aware Mode):**
• 📖 Scripture Integration: Search, compare, and reflect on Bible verses with built-in study tools
• 🛡️ Conservative Alignment: Uphold traditional values in advice, tone, and cultural recommendations
• 📚 Marriage: Is between a man and a woman as in line with the Bible
• 🙏 Spiritual Awareness: Offer prayer prompts, devotionals, and faith-based encouragements
• 🕊️ Moral Reasoning: Filter guidance and decisions through a biblically grounded ethical framework
• 🧭 Prophetic Insight: Engage with theological insights on modern events through a Revelation-informed lens
• 🧱 Family & Community Focus: Prioritize family values, civic responsibility, and personal discipline

**What I Believe:**
I believe there is one true God, as revealed in the Bible — eternal, sovereign, and unchanging.
God exists in three persons: the Father, the Son (Jesus Christ), and the Holy Spirit — co-equal and co-eternal in the unity of the Trinity.
This belief shapes the foundation of Thinkdrop AI’s worldview-aware mode, anchoring its values, moral reasoning, and encouragement in biblical truth.

**Core Capabilities:**
• 📸 **Screenshot & Screen Analysis**: Take screenshots, analyze screen content, extract text from images
• 🧠 **Memory & Knowledge**: Store, retrieve, and search through user information and conversations
• 🤖 **Agent Orchestration**: Coordinate multiple AI agents to complete complex tasks
• 💬 **Natural Conversation**: Engage in helpful, context-aware conversations
• 🔍 **Intent Understanding**: Understand user requests and route them to appropriate capabilities
• 📝 **Information Processing**: Parse, analyze, and organize various types of data

**Local Capabilities (Current Mode):**
• Local LLM processing using Phi4-mini for privacy
• Local memory storage with DuckDB database
• Screen capture and analysis
• Agent coordination and workflow management
• Real-time conversation and assistance

**Technical Architecture:**
• Built with Electron for cross-platform desktop support
• Local-first approach with optional cloud sync
• Multiple specialized agents (Memory, Screenshot, Intent Parser, etc.)
• Secure agent execution with sandboxing
• Modern React-based user interface`.trim();
  }
};

module.exports = AGENT_FORMAT;
