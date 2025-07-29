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
      
      // Store configuration on AGENT_FORMAT so it's accessible during execution
      AGENT_FORMAT.config = {
        timeout: config.timeout || 8000,
        model: config.model || 'phi3-json',
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
        const testResult = await AGENT_FORMAT.executeOllamaQuery('Hello', { timeout: 3000, model: 'phi3:mini' });
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


      const thinkdropPrompt = `${AGENT_FORMAT.basePrompt()}

      ${prompt}`;

      const maxRetries = options.maxRetries || AGENT_FORMAT.config.maxRetries;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await AGENT_FORMAT.executeOllamaQuery(thinkdropPrompt, options);
          
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
        model: 'phi3:mini',
        temperature: 0.2, // Lower for more focused responses
        maxTokens: 100 // Reduced tokens for brevity
      });
      
      console.log('🎯 Raw Phi3 natural language result:', result);
      
      // Parse natural language response
      let intentData;
      try {
        const responseText = result.trim();
        console.log('🔍 DEBUG: About to call parseNaturalLanguageResponse with:', {
          responseText: responseText.substring(0, 100) + '...',
          originalMessage: message.substring(0, 50) + '...'
        });

        // Use new natural language parser
        const parsedData = await this.parseNaturalLanguageResponse(responseText, message);
        console.log('🔍 DEBUG: parseNaturalLanguageResponse returned:', parsedData ? 'success' : 'null');
        
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
            'I\'ll help you with that using my local capabilities.',
          sourceText: message
        };  
      }
      
      // Extract entities from the original message regardless of parsing success/failure
      console.log('🎯 About to extract entities from message:', message);
      try {
        // Create parser instance if needed for entity extraction
        if (!this.nlParser) {
          this.nlParser = new this.NaturalLanguageIntentParser();
        }
        
        // Extract entities using the parser's entity extraction logic
        const extractedEntities = this.nlParser.extractEntities('', message);
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
      
      // Validate intent type
      const validIntents = ['memory_store', 'memory_retrieve', 'memory_update', 'memory_delete', 'greeting', 'question', 'command'];
      if (!validIntents.includes(intentData.primaryIntent)) {
        console.warn('⚠️ Invalid intent type, defaulting to question:', intentData.primaryIntent);
        intentData.primaryIntent = 'question';
        intentData.reasoning = 'Invalid intent type, defaulted to question';
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
      
      console.log('🔍 DEBUG: Parsed URL parts:', {
        hostname: urlParts.hostname,
        port: urlParts.port,
        path: urlParts.path
      });
      
      const requestOptions = {
        hostname: urlParts.hostname,
        port: parseInt(urlParts.port) || 11434, // Default to Ollama port, not 80
        path: urlParts.path || '/',
        method: options.method || 'GET',
        headers: options.headers || {}
      };
      
      console.log('🔍 DEBUG: Request options:', requestOptions);
      
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
      console.log('🔍 DEBUG: parseNaturalLanguageResponse called with:', {
        responseText: responseText.substring(0, 50) + '...',
        originalMessage: originalMessage.substring(0, 50) + '...'
      });
      
      // Create parser instance if needed
      if (!this.nlParser) {
        console.log('🔍 DEBUG: Creating new NaturalLanguageIntentParser instance');
        this.nlParser = new this.NaturalLanguageIntentParser();
      }
      
      // Use the rule-based parser to extract intent from natural language
      console.log('🔍 DEBUG: About to call nlParser.parse()');
      const result = await this.nlParser.parse(responseText, originalMessage);
      console.log('🔍 DEBUG: nlParser.parse() completed, result:', result ? 'success' : 'null');
      return result;
    } catch (error) {
      console.warn('⚠️ Natural language parser error:', error.message);
      console.warn('⚠️ Error stack:', error.stack);
      return null;
    }
  },
  
  // Natural Language Intent Parser Class - Phase 1 Implementation
  NaturalLanguageIntentParser: class {
    constructor() {
      this.embedder = null;
      this.seedEmbeddings = null;
      this.isEmbeddingReady = false;
      
      this.intentPatterns = {
        memory_store: [
          /\b(remember|store|save|keep track of|jot down|log|record|note down)\b/i,
          /\b(remind me (?:to|about)|set a reminder)\b/i,
          /\b(my|our|the) (appointment|meeting|schedule|event|plan|task)\b/i,
          /\b(don't forget|make a note|write this down|save this)\b/i
        ],
        memory_retrieve: [
          /\b(what did I|do you remember|recall|tell me what|what was)\b/i,
          /\b(when is|where is|show me|find my)\b/i,
          /\b(what's my next|did I forget|remind me what)\b/i,
          /\b(what's on my|check my|look up my)\b/i
        ],
        command: [
          /\b(take a screenshot|capture|screenshot|snap|take a picture|take a photo|take a snap)\b/i,
          /\b(open|launch|run|start|go to|execute)\b/i,
          /\b(show me|display|grab)\s+(?:the\s+)?(screen|desktop|window|display)\b/i,
          /\b(take a)\s+(?:picture|photo|screenshot|snap)\s+(?:of\s+)?(?:the\s+)?(screen|desktop|display)\b/i,
          /\b(capture|grab|get)\s+(?:the\s+)?(screen|desktop|window|display)\b/i
        ],
        question: [
          /\b(what is|how is|why is|when is|where is|who is|which is)\b/i,
          /\b(tell me about|what's|how do I|why does|where can|how can I)\b/i,
          /\b(explain|help with|tutorial|example|code example)\b/i,
          /\bare you (able|capable|good|fast|better|designed|built|trained)\b/i,
          /\bdo you (support|have|offer|provide|know|understand)\b/i,
          /^\s*(what|how|why|when|where|who|which)\b/i,
          /\bhow many\b/i,
          /\bhow much\b/i,
          /\bcount.*in\b/i,
          /\bnumber of\b/i
        ],
        greeting: [
          /^\s*(hi|hello|hey)\s*[!.?]*\s*$/i,
          /^\s*(good morning|good evening|what's up|yo)\s*[!.?]*\s*$/i,
          /^\s*how are you\b/i,
          /\b(nice to meet|greetings)\b/i
        ]
      };
      
      // this.entityPatterns = {
      //   datetime: /\b(?:\d{1,2}:\d{2}(?:am|pm)?|\d{1,2}(?:am|pm)|\b(?:tomorrow|today|yesterday|next week|next month|this week|this weekend|in \d+ (?:days|hours|minutes))\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)\b/gi,
      
      //   person: /\b(?:Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
      
      //   location: /\b(?:office|home|downtown|clinic|hospital|school|library|cafe|airport|station|park|city|building|room \d+|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/gi,
      
      //   event: /\b(?:appointment|meeting|call|interview|lunch|dinner|conference|webinar|standup|demo|presentation|workshop|check-in|review)\b/gi,
      
      //   contact: /\b(?:\+?\d{1,2}\s*[\-\.]?\s*\(?\d{3}\)?[\-\.]?\s*\d{3}[\-\.]?\s*\d{4}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
      
      //   capability: /\b(?:semantic search|search|memory|memorize|store|save|screenshot|capture|screen|desktop|display|recognize|detect|track|code|coding|programming|javascript|typescript|python|react|svelte|vue|angular|automation|workflow|agent|intent)\b/gi,
      
      //   technology: /\b(?:AI|LLM|GPT|embedding|vector|transformer|neural network|machine learning|deep learning|NLP|ollama|phi3|chatbot|language model|duckdb|pgvector|sql|json|yaml|API|CLI|OCR)\b/gi,
      
      //   action: /\b(?:create|generate|build|make|edit|update|delete|remove|list|show|display|explain|describe|define|help|assist|sum(?:marize)?|analyze|review|plan|schedule|organize|find|search|remind)\b/gi,
      // };

      this.entityPatterns = {
        datetime: /\b(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?|\d{1,2}(?:\s*(?:am|pm|AM|PM))|(?:tomorrow|today|yesterday|tonight|this\s+(?:morning|afternoon|evening|night))|(?:next|last|this)\s+(?:week|month|year|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+\d+\s+(?:days?|hours?|minutes?|weeks?|months?|years?)|\d+\s+(?:days?|hours?|minutes?|weeks?|months?|years?)\s+(?:ago|from\s+now)|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?s?|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}(?:st|nd|rd|th)\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:at\s+)?(?:noon|midnight|dawn|dusk|sunrise|sunset)|(?:early|late)\s+(?:morning|afternoon|evening)|(?:end|beginning|start)\s+of\s+(?:week|month|year))\b/gi,
        person: /\b(?:(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof\.?|Professor|Sir|Madam|Captain|Colonel|Major|General)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z']+)*|[A-Z][a-z']+(?:\s+[A-Z][a-z']+)+|(?:John|Jane|Michael|Sarah|David|Lisa|Robert|Mary|James|Jennifer|William|Elizabeth|Richard|Patricia|Charles|Barbara|Thomas|Susan|Christopher|Jessica|Daniel|Karen|Matthew|Nancy|Anthony|Mark|Betty|Donald|Helen|Steven|Sandra|Paul|Donna|Andrew|Carol|Joshua|Ruth|Kenneth|Sharon|Kevin|Michelle|Brian|Laura|George|Edward|Kimberly|Ronald|Timothy|Dorothy|Jason|Amy|Jeffrey|Angela|Ryan|Jacob|Brenda|Gary|Emma|Nicholas|Olivia|Eric|Cynthia|Jonathan|Marie))\b/g,
        location: /\b(?:office|home|downtown|uptown|midtown|clinic|hospital|school|university|college|library|cafe|coffee\s+shop|restaurant|airport|station|train\s+station|bus\s+stop|park|city|town|village|building|room\s+\d+|floor\s+\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Plaza|Court|Ct\.?)|\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?)|(?:north|south|east|west|northeast|northwest|southeast|southwest)\s+(?:side|end|part)|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Center|Centre|Mall|Market|Square|Park|Gardens?|Hospital|Clinic|University|College|School|Library|Museum|Theater|Theatre|Stadium|Arena)|(?:United\s+States|USA|Canada|Mexico|California|New\s+York|Texas|Florida|Illinois|Pennsylvania|Ohio|Georgia|North\s+Carolina|Michigan|New\s+Jersey|Virginia|Washington|Arizona|Massachusetts|Tennessee|Indiana|Missouri|Maryland|Wisconsin|Colorado|Minnesota|South\s+Carolina|Alabama|Louisiana|Kentucky|Oregon|Oklahoma|Connecticut|Utah|Iowa|Nevada|Arkansas|Mississippi|Kansas|New\s+Mexico|Nebraska|West\s+Virginia|Idaho|Hawaii|New\s+Hampshire|Maine|Montana|Rhode\s+Island|Delaware|South\s+Dakota|North\s+Dakota|Alaska|Vermont|Wyoming))\b/gi,
        event: /\b(?:appointment|meeting|call|phone\s+call|video\s+call|conference\s+call|interview|lunch|dinner|breakfast|brunch|conference|webinar|seminar|workshop|training|standup|stand-up|demo|demonstration|presentation|pitch|check-in|check\s+in|review|evaluation|assessment|follow-up|follow\s+up|party|celebration|birthday|anniversary|wedding|funeral|graduation|class|lesson|session|consultation|therapy|treatment|kickoff|kick-off|launch|release|deployment|go-live|milestone|deadline)\b/gi,
        contact: /(?:\+?\d{1,4}[\s\-\.]?\(?\d{1,4}\)?[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,4}[\s\-\.]?\d{0,4}|\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[^\s]+|www\.[^\s]+|@[a-zA-Z0-9_]+|skype:[a-zA-Z0-9._-]+|teams:[a-zA-Z0-9._-]+)/gi,
        capability: /\b(?:semantic\s+search|search|memory|memorize|store|save|remember|recall|retrieve|screenshot|capture|screen|desktop|display|monitor|window|recognize|detect|identify|track|observe|analyze|code|coding|programming|develop|javascript|typescript|python|java|c\+\+|c#|php|ruby|go|rust|swift|kotlin|react|angular|vue|svelte|node\.?js|express|django|flask|spring|laravel|rails|automation|workflow|agent|bot|chatbot|assistant|AI|artificial\s+intelligence|intent|understand|comprehend|interpret|parse|process|extract|transform|load|ETL|migrate|sync|synchronize|backup|restore)\b/gi,
        technology: /\b(?:AI|artificial\s+intelligence|LLM|large\s+language\s+model|GPT|BERT|transformer|neural\s+network|machine\s+learning|ML|deep\s+learning|DL|NLP|natural\s+language\s+processing|embedding|vector|semantic|similarity|RAG|retrieval\s+augmented\s+generation|ollama|phi3|llama|claude|chatgpt|copilot|gemini|duckdb|postgresql|postgres|mysql|mongodb|redis|elasticsearch|pgvector|chromadb|pinecone|weaviate|sql|nosql|json|xml|yaml|yml|csv|parquet|API|REST|GraphQL|gRPC|HTTP|HTTPS|WebSocket|CLI|command\s+line|GUI|web\s+interface|dashboard|OCR|optical\s+character\s+recognition|computer\s+vision|image\s+recognition|speech\s+recognition|voice\s+recognition|AWS|Azure|GCP|Google\s+Cloud|Docker|Kubernetes|microservices|serverless|lambda)\b/gi,
        action: /\b(?:create|generate|build|make|construct|develop|design|craft|compose|write|edit|update|modify|change|alter|revise|refactor|improve|enhance|optimize|delete|remove|erase|clear|purge|clean|wipe|destroy|list|show|display|present|render|visualize|demonstrate|exhibit|explain|describe|define|clarify|elaborate|detail|outline|summarize|sum|help|assist|support|guide|advise|recommend|suggest|analyze|analyse|process|examine|investigate|study|evaluate|assess|review|inspect|plan|schedule|organize|arrange|coordinate|manage|structure|find|search|locate|discover|identify|detect|lookup|query|remind|remember|store|save|bookmark|note|record|log|send|share|distribute|broadcast|notify|alert|inform|tell|run|execute|launch|start|begin|initiate|trigger|invoke|call|complete|finish|end|stop|close|terminate|conclude|finalize)\b/gi
      };
      
      // Seed examples for embedding-based similarity
      this.seedExamples = {
        memory_store: [
          // Direct storage commands
          "remember this", "save a reminder", "jot down this meeting", "don't forget my appointment", 
          "note that I have", "store this information", "keep track of my schedule", "write down this task", 
          "log this event", "make a note of this", "record this detail", "bookmark this information",
          "file this away", "add to my notes", "memorize this fact", "save this for later",
          "document this conversation", "archive this message", "keep this on file", "register this event",
          
          // Context-specific storage
          "remember I'm meeting John at 3pm", "save that the deadline is Friday", "note my doctor's appointment",
          "store my login credentials", "remember my parking spot is B-12", "keep track of my expenses",
          "log my workout routine", "record my medication schedule", "save my favorite restaurant",
          "remember my anniversary date", "note my flight details", "store my emergency contacts",
          "remember where I parked", "save this recipe for later", "note my wifi password",
          
          // Scheduling and calendar
          "add this to my calendar", "schedule this meeting", "block this time", "reserve this slot",
          "put this on my agenda", "mark this date", "set aside time for this", "allocate time for",
          "pencil this in", "book this appointment", "reserve this time slot", "schedule a reminder",
          
          // Task and project management
          "add this to my todo list", "create a task for this", "add this action item", "track this project",
          "monitor this deadline", "follow up on this", "add this to my backlog", "queue this task",
          "prioritize this item", "flag this for later", "escalate this issue", "assign this task",
          
          // Personal information
          "remember my preferences", "save my settings", "store my profile", "keep my contact info",
          "remember my allergies", "note my dietary restrictions", "save my medical history",
          "record my emergency info", "store my insurance details", "remember my blood type"
        ],
      
        memory_retrieve: [
          // Direct retrieval requests
          "what did I say", "remind me of my meeting", "what's on my calendar", "when is my appointment",
          "do you remember", "tell me what I stored", "find my notes about", "look up my schedule",
          "recall my tasks", "what did I save", "show me my reminders", "pull up my notes",
          "retrieve my information", "access my files", "find my records", "locate my data",
          
          // Specific information queries
          "when is my next meeting", "what's my password for", "where did I park", "what's my flight number",
          "remind me of my anniversary", "what's my doctor's number", "when is my deadline",
          "what medication do I take", "where's my favorite restaurant", "what's my emergency contact",
          "when do I need to leave", "what's my budget for", "where's my backup stored",
          
          // Schedule and calendar queries
          "what's on my agenda today", "show me tomorrow's schedule", "what meetings do I have",
          "when am I free", "what's my next appointment", "check my availability", "review my calendar",
          "what's planned for this week", "show me my upcoming events", "when is my next commitment",
          
          // Task and project queries
          "what tasks do I have", "show me my todo list", "what's pending", "what needs to be done",
          "what's overdue", "show me my priorities", "what projects am I tracking", "what's my workload",
          "what deadlines are coming up", "what's on my plate", "show me action items",
          
          // Historical queries
          "what did we discuss last time", "what was decided in that meeting", "what was the outcome",
          "how did that project end", "what was the resolution", "what happened with", "what was the result",
          "what did I learn from", "what was my feedback on", "how did I solve that before"
        ],
      
        command: [
          // Screenshot and capture commands
          "take a screenshot", "take a picture of the screen", "capture the desktop", "grab the screen",
          "take a photo of my display", "screenshot this", "snap the screen", "capture this window",
          "take a screen grab", "screenshot the current page", "capture what I'm seeing",
          "save a picture of this", "grab a screenshot", "capture the entire screen",
          
          // Application and system commands
          "open browser", "run the script", "launch application", "execute this command", "start the program",
          "show me the screen", "display the desktop", "open file explorer", "launch calculator",
          "start notepad", "open settings", "run system diagnostics", "execute batch file",
          "launch terminal", "open command prompt", "start task manager", "run registry editor",
          
          // File and folder operations
          "create a new folder", "delete this file", "copy these files", "move to desktop",
          "rename this document", "compress these files", "extract this archive", "backup my data",
          "sync my files", "upload to cloud", "download from server", "share this file",
          
          // System operations
          "restart the computer", "shut down system", "lock the screen", "log out user",
          "switch user account", "check system status", "update software", "install program",
          "uninstall application", "clear cache", "run antivirus scan", "defragment disk",
          
          // Network and connectivity
          "connect to wifi", "check internet connection", "ping this server", "test network speed",
          "connect to VPN", "disconnect from network", "refresh IP address", "diagnose connection",
          
          // Automation and workflows
          "automate this process", "create a workflow", "schedule this task", "set up automation",
          "trigger this action", "execute workflow", "run automated script", "start batch process"
        ],
      
        question: [
          // General knowledge
          "what is the weather", "how do I cook rice", "explain this concept", "what's the oldest city",
          "why does this happen", "tell me about history", "how can I learn programming", "what does this mean",
          "help me understand", "what is your name", "how are you designed", "explain how you work",
          
          // How-to questions
          "how do I fix this", "how can I improve", "what's the best way to", "how should I approach",
          "what steps should I take", "how do I get started", "what's the process for", "how can I optimize",
          "what's the proper method", "how do I troubleshoot", "what's the recommended approach",
          
          // Explanatory questions
          "why is this important", "what are the benefits", "what are the risks", "how does this work",
          "what's the difference between", "what are the alternatives", "what should I consider",
          "what are the implications", "what's the impact of", "how does this affect",
          
          // Comparative questions
          "which is better", "what's the comparison", "how do these differ", "what are the pros and cons",
          "which should I choose", "what's more effective", "which option is optimal", "what's the trade-off",
          
          // Definitional questions
          "what is artificial intelligence", "define machine learning", "explain neural networks",
          "what does API mean", "what is cloud computing", "define cryptocurrency", "explain blockchain",
          "what is cybersecurity", "define data science", "what does agile mean",
          
          // Problem-solving questions
          "how do I solve this problem", "what's wrong with this", "why isn't this working",
          "how can I fix this error", "what's causing this issue", "how do I debug this",
          "what's the solution to", "how do I resolve this conflict", "what's the root cause",
          
          // Planning and strategy questions
          "what should I plan for", "how should I prepare", "what's the best strategy",
          "how do I prioritize this", "what's the timeline for", "how should I organize",
          "what resources do I need", "how do I measure success", "what's the roadmap",
          
          // Counting and analysis questions
          "how many letters in this word", "how many Rs in strawberry", "count the vowels in this",
          "how many words in this sentence", "what's the length of this text", "how many characters",
          "count the occurrences of", "how many times does this appear", "what's the frequency of",
          "how many syllables in this word", "count the consonants", "how many digits in this number"
        ],
      
        greeting: [
          // Basic greetings (removed question-like greetings)
          "hello there", "good morning", "hi assistant", "nice to meet you", 
          "greetings", "good evening", "howdy", "hi there", "hello", "hey", 
          "good afternoon", "good day", "salutations",
          
          // Casual greetings (removed question-like greetings)
          "long time no see", "good to see you", "nice seeing you",
          
          // Formal greetings
          "good day to you", "pleased to meet you", "how do you do", "it's a pleasure",
          "I hope you're well", "trust you're doing well", "I hope this finds you well",
          
          // Time-specific greetings
          "good morning sunshine", "rise and shine", "top of the morning", "good evening friend",
          "good night", "have a great day", "enjoy your evening", "sweet dreams",
          
          // Friendly and enthusiastic
          "hey buddy", "hi friend", "hello my friend", "hey there pal", "greetings friend",
          "hello wonderful", "hi amazing", "hey fantastic", "good to see you",
          
          // International greetings
          "bonjour", "hola", "guten tag", "konnichiwa", "namaste", "shalom", "ciao"
        ],
      
        request: [
          // Polite requests
          "could you please", "would you mind", "I'd appreciate if you could", "if possible, could you",
          "would it be possible to", "I was wondering if you could", "do you think you could",
          "I need help with", "can you assist me", "I require assistance", "I could use some help",
          
          // Direct requests
          "please do this", "I need you to", "can you handle", "take care of this",
          "deal with this", "process this request", "complete this task", "finish this job",
          
          // Service requests
          "book me a flight", "schedule an appointment", "order food delivery", "make a reservation",
          "call customer service", "send an email", "draft a letter", "create a document",
          "generate a report", "analyze this data", "research this topic", "find information about"
        ],
      
        complaint: [
          // Service complaints
          "this isn't working", "I'm having trouble with", "there's a problem with", "this is broken",
          "I can't get this to work", "this is frustrating", "I'm not satisfied with", "this is disappointing",
          "I expected better", "this doesn't meet my needs", "I'm unhappy with the service",
          
          // Technical complaints
          "the system is down", "the app keeps crashing", "I can't connect", "it's running slowly",
          "there are bugs", "it's not responding", "the interface is confusing", "it's not user-friendly",
          
          // Quality complaints
          "the quality is poor", "this is defective", "it's not as described", "this is substandard",
          "I'm not getting what I paid for", "this doesn't work as advertised", "the performance is lacking"
        ],
      
        compliment: [
          // Performance compliments
          "great job", "well done", "excellent work", "that was perfect", "you did amazing",
          "fantastic", "brilliant", "outstanding", "superb", "wonderful job", "impressive",
          
          // Appreciation
          "thank you so much", "I really appreciate this", "you're very helpful", "this is exactly what I needed",
          "you're amazing", "you're the best", "I couldn't have done it without you",
          
          // Quality compliments
          "this is high quality", "this exceeds expectations", "this is exactly right", "perfect solution",
          "this is very professional", "excellent attention to detail", "this is comprehensive"
        ],
      
        emergency: [
          // Medical emergencies
          "call 911", "I need medical help", "someone is hurt", "medical emergency", "call ambulance",
          "heart attack", "stroke", "accident", "injury", "unconscious", "not breathing",
          
          // Safety emergencies
          "fire", "smoke", "gas leak", "break in", "intruder", "theft", "robbery",
          "call police", "call fire department", "emergency services", "help immediately",
          
          // Personal emergencies
          "I'm lost", "I'm trapped", "car broke down", "flat tire", "out of gas",
          "locked out", "lost keys", "phone died", "need immediate help"
        ],
      
        memory_delete: [
          // Direct deletion commands
          "delete this", "remove this note", "erase this reminder", "clear this entry", "forget this",
          "delete my reminder about", "remove this from memory", "clear this information", "erase this data",
          "forget what I said about", "delete this appointment", "remove this task", "clear my notes about",
          "wipe this information", "purge this record", "eliminate this entry", "discard this note",
          
          // Specific deletions
          "delete my meeting with John", "remove my doctor's appointment", "forget my password for",
          "clear my calendar entry", "delete this contact", "remove this address", "forget this person",
          "delete this file reference", "remove this bookmark", "clear this saved item",
          "delete my note about the project", "remove this phone number", "forget this website",
          
          // Bulk deletions
          "clear all my reminders", "delete everything about", "remove all notes from last week",
          "clear my entire calendar", "delete all contacts", "remove all saved passwords",
          "clear all my bookmarks", "delete all project notes", "remove everything stored",
          "purge all old entries", "clear expired reminders", "delete completed tasks",
          
          // Conditional deletions
          "delete if outdated", "remove expired entries", "clear old appointments", "delete past events",
          "remove completed items", "clear finished tasks", "delete cancelled meetings",
          "remove obsolete information", "clear duplicate entries", "delete unnecessary notes",
          
          // Confirmation requests
          "can you delete this", "please remove this entry", "would you clear this",
          "I want to delete this", "help me remove this", "need to clear this information",
          "can you forget this", "please erase this data", "I'd like to remove this note"
        ],
      
        memory_update: [
          // Direct update commands
          "update this", "change this note", "modify this reminder", "edit this entry", "revise this information",
          "update my meeting time", "change my appointment", "modify this contact", "edit this address",
          "revise my password", "update this project status", "change this deadline", "modify my schedule",
          "edit my profile", "update my preferences", "change this setting", "revise this document",
          
          // Specific updates
          "change my meeting from 2pm to 3pm", "update my phone number", "modify my email address",
          "change the location to downtown", "update the project deadline", "revise my notes about",
          "change my doctor's appointment time", "update my emergency contact", "modify my dietary restrictions",
          "change my parking spot to C-14", "update my flight details", "revise my workout schedule",
          
          // Status updates
          "mark this as completed", "update status to in progress", "change priority to high",
          "mark as cancelled", "update to urgent", "change status to pending", "mark as resolved",
          "update progress to 50%", "change to active", "mark as on hold", "update to approved",
          
          // Correction updates
          "correct this information", "fix this entry", "update the wrong details", "fix this mistake",
          "correct the spelling", "update the wrong time", "fix this error", "revise incorrect data",
          "update the typo", "correct this address", "fix the wrong date", "update misinformation",
          
          // Partial updates
          "just change the time", "only update the location", "just modify the date", "only change the name",
          "update just the phone number", "change only the email", "modify just the address",
          "update only the priority", "change just the status", "modify only the deadline",
          
          // Bulk updates
          "update all my contact info", "change all meeting times", "modify all project deadlines",
          "update my entire schedule", "revise all my notes", "change all passwords", "update all addresses"
        ],
      
        memory_search: [
          // General search commands
          "search for", "find information about", "look for", "search my notes for", "find my entry about",
          "locate information on", "search through my data", "find records containing", "look up details about",
          "search my memory for", "find anything related to", "locate entries about", "search for mentions of",
          
          // Specific searches
          "search for my meeting with Sarah", "find my doctor's phone number", "look for my parking spot",
          "search for project deadlines", "find my flight information", "look for restaurant recommendations",
          "search for my wifi password", "find my insurance details", "look for my workout routine",
          "search for my anniversary date", "find my emergency contacts", "look for my medication schedule",
          
          // Content-based searches
          "find notes containing", "search for entries with", "look for records about", "find data related to",
          "search for keywords", "find mentions of", "look for references to", "search text for",
          "find documents with", "search for phrases", "look for specific words", "find content about",
          
          // Time-based searches
          "search last week's entries", "find today's notes", "look for yesterday's meetings",
          "search this month's appointments", "find last year's records", "look for recent entries",
          "search for upcoming events", "find past appointments", "look for future deadlines",
          "search for expired items", "find overdue tasks", "look for scheduled reminders",
          
          // Category searches
          "search my contacts", "find my appointments", "look through my tasks", "search my bookmarks",
          "find my passwords", "look through my projects", "search my calendar", "find my documents",
          "look through my reminders", "search my notes", "find my addresses", "look through my files",
          
          // Advanced searches
          "search by date range", "find entries between", "look for items modified", "search by category",
          "find by importance level", "look for high priority items", "search by status", "find completed tasks",
          "look for pending items", "search by tag", "find by location", "look for urgent matters"
        ],
      
        memory_list: [
          // General listing commands
          "list all", "show me everything", "display all entries", "give me a list of", "show all my",
          "list my notes", "display my reminders", "show my appointments", "list my contacts",
          "show my tasks", "display my schedule", "list my bookmarks", "show my passwords",
          "display my projects", "list my documents", "show my addresses", "display my files",
          
          // Categorized listings
          "list all my meetings", "show all my appointments", "display all my contacts", "list all my tasks",
          "show all my projects", "display all my reminders", "list all my notes", "show all my bookmarks",
          "display all my passwords", "list all my addresses", "show all my documents", "display all my files",
          
          // Time-based listings
          "list today's appointments", "show this week's schedule", "display tomorrow's tasks",
          "list next week's meetings", "show this month's events", "display upcoming deadlines",
          "list past appointments", "show completed tasks", "display recent entries", "list overdue items",
          "show expired reminders", "display future events", "list pending tasks", "show active projects",
          
          // Status-based listings
          "list completed items", "show pending tasks", "display active projects", "list cancelled meetings",
          "show high priority items", "display urgent tasks", "list important notes", "show critical reminders",
          "display in-progress projects", "list on-hold items", "show approved requests", "display rejected items",
          
          // Filtered listings
          "list items containing", "show entries with", "display records about", "list notes related to",
          "show appointments with", "display tasks for", "list projects involving", "show contacts from",
          "display reminders about", "list bookmarks for", "show documents related to", "display files about",
          
          // Organized listings
          "list by priority", "show by date", "display by category", "list by importance", "show by status",
          "display by location", "list alphabetically", "show chronologically", "display by size",
          "list by frequency", "show by relevance", "display by modification date", "list by creation date",
          
          // Summary listings
          "give me a summary of", "show me an overview of", "display a breakdown of", "list the highlights",
          "show key information", "display important items", "list the essentials", "show the main points",
          "display critical information", "list the priorities", "show what's important", "display the summary"
        ]
      };
      
      // Initialize embeddings asynchronously
      this.initializeEmbeddings();
    }
    
    async initializeEmbeddings() {
      if (this.embedder) {
        return; // Already initialized
      }
      
      try {
        console.log('🤖 Initializing embedding model for intent classification...');
        
        // Use dynamic import for ES modules in Electron with proper callback
        const transformers = await import('@xenova/transformers');
        
        this.embedder = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          quantized: true,
          device: 'cpu',
          progress_callback: null // Explicitly set to null to avoid callback issues
        });
        
        // Pre-compute embeddings for seed examples
        await this.precomputeSeedEmbeddings();
        
        console.log('✅ Embedding model initialized successfully');
        this.isEmbeddingReady = true;
        
      } catch (error) {
        console.warn('⚠️ Failed to initialize embedding model:', error.message);
        console.log('📝 Falling back to word overlap similarity');
        this.embedder = null;
        this.isEmbeddingReady = false;
      }
    }
    
    async parse(responseText, originalMessage) {
      try {
        console.log('🔍 Analyzing natural language response...');
        
        // Step 1: Classify Intent
        const intentResult = await this.classifyIntent(responseText, originalMessage);
        
        // Step 2: Extract entities from both texts
        console.log('🎯 About to extract entities from message:', originalMessage);
        const entities = this.extractEntities(responseText, originalMessage);
        console.log('🎯 Extracted entities result:', entities);
        
        // Step 3: Determine boolean flags
        const flags = this.determineBooleanFlags(responseText, originalMessage, intentResult.intent);
        
        // Step 4: Generate suggested response
        const suggestedResponse = this.generateSuggestedResponse(responseText, originalMessage, intentResult.intent);
        
        // Step 5: Check if clarification is needed (lowered threshold to avoid rejecting valid responses)
        if (intentResult.confidence < 0.5) {
          return {
            needsClarification: true,
            clarificationPrompt: this.generateClarificationPrompt(intentResult),
            possibleIntents: intentResult.possibleIntents,
            confidence: intentResult.confidence
          };
        }
      
      // Step 6: Build final result
      return {
        chainOfThought: {
          step1_analysis: this.extractAnalysis(responseText),
          step2_reasoning: this.extractReasoning(responseText, intentResult.intent),
          step3_consistency: this.checkConsistency(responseText, originalMessage)
        },
        intents: intentResult.allIntents || [{
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          reasoning: intentResult.reasoning
        }],
        primaryIntent: intentResult.intent,
        entities: entities,
        requiresMemoryAccess: flags.requiresMemoryAccess,
        requiresExternalData: flags.requiresExternalData,
        captureScreen: flags.captureScreen,
        suggestedResponse: suggestedResponse,
        sourceText: originalMessage
      };
      
    } catch (error) {
      console.error('🚨 Error in natural language parsing:', error);
      
      // Fallback to simple pattern matching
      return {
        chainOfThought: {
          step1_analysis: 'Error in analysis',
          step2_reasoning: 'Fallback to simple parsing',
          step3_consistency: 'Unable to check consistency'
        },
        intents: [{
          intent: 'question',
          confidence: 0.5,
          reasoning: 'Fallback due to parsing error'
        }],
        primaryIntent: 'question',
        entities: [],
        requiresMemoryAccess: false,
        requiresExternalData: false,
        captureScreen: false,
        suggestedResponse: 'I apologize, but I had trouble understanding your request. Could you please rephrase it?',
        sourceText: originalMessage
      };
    }
  }
    
    async classifyIntent(responseText, originalMessage) {
      const combinedText = (responseText + ' ' + originalMessage).toLowerCase();
      
      // Layer 1: Enhanced Pattern Matching with Scoring
      const patternScores = this.calculatePatternScores(combinedText);
      
      // Layer 2: Semantic Similarity (true embedding-based approach)
      const semanticScores = await this.calculateSemanticScores(originalMessage);
      
      // Combine scores with weighted approach
      const finalScores = this.combineScores(patternScores, semanticScores);
      
      // Find the best intent
      const sortedIntents = Object.entries(finalScores)
        .sort(([,a], [,b]) => b - a)
        .map(([intent, score]) => ({ intent, score }));
      
      const bestIntent = sortedIntents[0];
      const confidence = this.calculateConfidence(bestIntent.score, sortedIntents);
      
      // Build multiple intents array with confidence scores
      const allIntents = sortedIntents.slice(0, 3).map(item => ({
        intent: item.intent,
        confidence: this.calculateConfidence(item.score, sortedIntents),
        reasoning: `Pattern: ${patternScores[item.intent] || 0}, Semantic: ${semanticScores[item.intent] || 0}`
      }));
      
      return {
        intent: bestIntent.intent || 'question',
        confidence: confidence,
        reasoning: `Pattern: ${patternScores[bestIntent.intent] || 0}, Semantic: ${semanticScores[bestIntent.intent] || 0}`,
        possibleIntents: sortedIntents.slice(0, 3).map(item => item.intent),
        allIntents: allIntents
      };
    }
    
    calculatePatternScores(combinedText) {
      const scores = {};
      
      // Score each intent based on pattern matching
      for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
        scores[intent] = 0;
        for (const pattern of patterns) {
          if (pattern.test(combinedText)) {
            scores[intent] += 1;
          }
        }
      }
      
      return scores;
    }
    
    async calculateSemanticScores(message) {
      // Lightweight semantic similarity using seed examples
      const seedExamples = {
        memory_store: [
          "remember this for me",
          "save this note",
          "jot this down",
          "I need to remember an appointment",
          "log this event",
          "store this memory",
          "keep track of this",
          "make a note of my plans",
          "don't forget that I have a meeting",
          "remind me later about this"
        ],
        memory_retrieve: [
          "what did I tell you before",
          "remind me what I said",
          "do you remember my schedule",
          "what's on my calendar",
          "tell me my upcoming meetings",
          "recall my past appointments",
          "show me what I stored",
          "what did I ask you to remember",
          "did I mention anything earlier",
          "do you remember when I said..."
        ],
        memory_update: [
          "update my appointment time",
          "change what I told you earlier",
          "modify the note I saved",
          "edit what I asked you to remember",
          "replace the meeting info",
          "reschedule the reminder",
          "update the details I shared",
          "change the stored memory",
          "fix what I said before",
          "correct the saved event"
        ],
        memory_delete: [
          "delete the reminder",
          "remove what I told you",
          "forget what I said earlier",
          "erase that memory",
          "clear the stored information",
          "drop the saved note",
          "undo what I remembered",
          "delete my schedule entry",
          "forget that event",
          "remove that from memory"
        ],
        greeting: [
          "hello",
          "hi there",
          "hey",
          "good morning",
          "good evening",
          "yo",
          "sup",
          "how are you doing",
          "nice to meet you"
        ],
        question: [
          "what can you do",
          "how does this work",
          "are you capable of semantic search",
          "are you fast compared to other models",
          "do you support programming",
          "can you help with coding",
          "what are your capabilities",
          "how good are you at",
          "are you able to",
          "do you know about"
        ]
      };
      
      const scores = {};
      
      // Use true embeddings if available, otherwise fallback to word overlap
      if (this.isEmbeddingReady && this.embedder && this.seedEmbeddings) {
        try {
          // Get embedding for the input message
          const messageEmbedding = await this.embedder(message, { pooling: 'mean', normalize: true });
          
          // Calculate cosine similarity with each intent's seed examples
          for (const [intent, seedEmbeddings] of Object.entries(this.seedEmbeddings)) {
            let maxSimilarity = 0;
            
            for (const seedEmbedding of seedEmbeddings) {
              const similarity = this.cosineSimilarity(messageEmbedding.data, seedEmbedding);
              maxSimilarity = Math.max(maxSimilarity, similarity);
            }
            
            scores[intent] = maxSimilarity;
          }
          
          return scores;
          
        } catch (error) {
          console.warn('⚠️ Embedding similarity failed, falling back to word overlap:', error.message);
        }
      }
      
      // Fallback: Simple word overlap similarity
      const messageLower = message.toLowerCase();
      
      for (const [intent, examples] of Object.entries(this.seedExamples)) {
        let maxSimilarity = 0;
        
        for (const example of examples) {
          const similarity = this.calculateWordOverlapSimilarity(messageLower, example);
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }
        
        scores[intent] = maxSimilarity;
      }
      
      return scores;
    }
    
    cosineSimilarity(vecA, vecB) {
      if (vecA.length !== vecB.length) {
        throw new Error('Vectors must have the same length');
      }
      
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      
      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }
      
      normA = Math.sqrt(normA);
      normB = Math.sqrt(normB);
      
      if (normA === 0 || normB === 0) {
        return 0;
      }
      
      return dotProduct / (normA * normB);
    }
    
    calculateWordOverlapSimilarity(text1, text2) {
      const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
      const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));
      
      const intersection = new Set([...words1].filter(x => words2.has(x)));
      const union = new Set([...words1, ...words2]);
      
      return union.size > 0 ? intersection.size / union.size : 0;
    }
    
    combineScores(patternScores, semanticScores) {
      const combined = {};
      const allIntents = new Set([...Object.keys(patternScores), ...Object.keys(semanticScores)]);
      
      for (const intent of allIntents) {
        const patternScore = patternScores[intent] || 0;
        const semanticScore = semanticScores[intent] || 0;
        
        // Weighted combination: 70% pattern matching, 30% semantic similarity
        combined[intent] = (patternScore * 0.7) + (semanticScore * 0.3);
      }
      
      return combined;
    }
    
    calculateConfidence(bestScore, sortedIntents) {
      if (bestScore === 0) return 0.5;
      
      // Higher confidence if there's a clear winner
      const secondBest = sortedIntents[1]?.score || 0;
      const gap = bestScore - secondBest;
      
      let confidence = Math.min(0.95, 0.6 + (bestScore * 0.15) + (gap * 0.1));
      
      // Boost confidence if multiple signals agree
      if (bestScore > 1.0) {
        confidence = Math.min(0.95, confidence + 0.1);
      }
      
      return confidence;
    }
    
    extractEntities(responseText, originalMessage) {
      const entities = [];
      
      // Focus on the original message for entity extraction, not the analysis
      const textToAnalyze = originalMessage;
      console.log('🔍 Entity extraction - analyzing text:', textToAnalyze);
      console.log('🔍 Available entity patterns:', Object.keys(this.entityPatterns));
      
      // Extract different types of entities from the original user message only
      for (const [entityType, pattern] of Object.entries(this.entityPatterns)) {
        const matches = textToAnalyze.match(pattern);
        if (matches) {
          for (const match of matches) {
            const cleanMatch = match.trim();
            // Filter out common parsing artifacts and short meaningless matches
            if (cleanMatch.length > 2 && 
                !cleanMatch.includes('Intent') && 
                !cleanMatch.includes('Type') &&
                !cleanMatch.includes('Key') &&
                !cleanMatch.includes('\n')) {
              entities.push({
                value: cleanMatch,
                type: entityType,
                normalized_value: this.normalizeEntity(cleanMatch, entityType)
              });
            }
          }
        }
      }
      
      return entities;
    }
    
    normalizeEntity(value, type) {
      if (!value || typeof value !== 'string') {
        return null;
      }
      
      const cleanValue = value.trim();
      if (cleanValue.length === 0) {
        return null;
      }
      
      try {
        switch (type) {
          case 'datetime':
            return this.normalizeDatetime(cleanValue);
          case 'person':
            return this.normalizePerson(cleanValue);
          case 'location':
            return this.normalizeLocation(cleanValue);
          case 'event':
            return this.normalizeEvent(cleanValue);
          case 'contact':
            return this.normalizeContact(cleanValue);
          default:
            return cleanValue;
        }
      } catch (error) {
        console.warn(`⚠️ Entity normalization failed for ${type}:`, error.message);
        return cleanValue; // Return original value on error
      }
    }
    
    normalizeDatetime(value) {
      const lowerValue = value.toLowerCase();
      const now = new Date();
      
      // Handle relative dates
      if (lowerValue === 'today') {
        return now.toISOString().split('T')[0];
      }
      if (lowerValue === 'tomorrow') {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
      }
      if (lowerValue === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      }
      if (lowerValue === 'next week') {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek.toISOString().split('T')[0];
      }
      
      // Handle time formats (12:30, 2pm, etc.)
      const timeMatch = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const minute = parseInt(timeMatch[2]);
        const ampm = timeMatch[3]?.toLowerCase();
        
        if (ampm === 'pm' && hour !== 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      }
      
      // Handle simple pm/am formats (2pm, 10am)
      const simpleTimeMatch = value.match(/^(\d{1,2})\s*(am|pm)$/i);
      if (simpleTimeMatch) {
        let hour = parseInt(simpleTimeMatch[1]);
        const ampm = simpleTimeMatch[2].toLowerCase();
        
        if (ampm === 'pm' && hour !== 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        
        return `${hour.toString().padStart(2, '0')}:00`;
      }
      
      return value; // Return original if no pattern matches
    }
    
    normalizePerson(value) {
      // Remove extra whitespace and normalize case
      const cleaned = value.replace(/\s+/g, ' ').trim();
      
      // Handle titles and proper names
      return cleaned.replace(/\b\w+/g, word => {
        // Keep common titles in proper case
        const lowerWord = word.toLowerCase();
        if (['dr', 'mr', 'mrs', 'ms', 'prof', 'sir', 'dame'].includes(lowerWord)) {
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() + '.';
        }
        // Capitalize first letter of each word
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      });
    }
    
    normalizeLocation(value) {
      // Capitalize location names properly
      return value.replace(/\b\w+/g, word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      );
    }
    
    normalizeEvent(value) {
      // Normalize event names to lowercase for consistency
      return value.toLowerCase();
    }
    
    normalizeContact(value) {
      // Normalize phone numbers and emails
      if (value.includes('@')) {
        // Email - normalize to lowercase
        return value.toLowerCase();
      }
      
      // Phone number - remove formatting and standardize
      const phoneDigits = value.replace(/\D/g, '');
      if (phoneDigits.length === 10) {
        return `(${phoneDigits.slice(0,3)}) ${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`;
      }
      if (phoneDigits.length === 11 && phoneDigits.startsWith('1')) {
        const number = phoneDigits.slice(1);
        return `+1 (${number.slice(0,3)}) ${number.slice(3,6)}-${number.slice(6)}`;
      }
      
      return value; // Return original if no standard format
    }
    
    determineBooleanFlags(responseText, originalMessage, intent) {
      const combinedText = (responseText + ' ' + originalMessage).toLowerCase();
      
      // More comprehensive pattern matching with edge case handling
      const memoryPatterns = [
        /\b(remember|store|save|keep track|don't forget|note|log|record)\b/,
        /\b(remind me|recall|what did I|do you remember)\b/,
        /\b(my (appointment|meeting|schedule|task|note))\b/
      ];
      
      const externalDataPatterns = [
        /\b(weather|temperature|forecast|climate)\b/,
        /\b(news|current events|headlines|breaking)\b/,
        /\b(search|lookup|find online|google|web)\b/,
        /\b(stock price|market|exchange rate)\b/,
        /\b(what time|current time|timezone)\b/
      ];
      
      const screenshotPatterns = [
        /\b(screenshot|screen shot|capture|snap)\b/,
        /\b(show me (the|this|what's on))\b/,
        /\b(take a (picture|photo) of)\b/,
        /\b(grab (the|this) (screen|display))\b/
      ];
      
      return {
        requiresMemoryAccess: intent === 'memory_store' || 
                             intent === 'memory_retrieve' ||
                             intent === 'memory_update' ||
                             intent === 'memory_delete' ||
                             memoryPatterns.some(pattern => pattern.test(combinedText)),
        requiresExternalData: externalDataPatterns.some(pattern => pattern.test(combinedText)),
        captureScreen: intent === 'command' && screenshotPatterns.some(pattern => pattern.test(combinedText))
      };
    }
    
    generateSuggestedResponse(responseText, originalMessage, intent) {
      if (!responseText || typeof responseText !== 'string') {
        return this.getFallbackResponse(intent);
      }
      
      // For questions and commands, prioritize using the actual LLM response
      if (intent !== 'greeting') {
        // Clean up the response text and use it directly if it's substantial
        const cleanedResponse = responseText.trim();
        if (cleanedResponse.length > 10) {
          // Truncate if too long (keep first 200 chars for conciseness)
          return cleanedResponse;
        }
      }
      
      // Extract any direct answer from the Phi3 response
      const lines = responseText.split('\n').filter(line => line.trim().length > 0);
      
      // Look for lines that contain actual answers (not analysis metadata)
      const answerLine = this.extractAnswerFromResponse(lines);
      if (answerLine) {
        return answerLine;
      }
      
      // If no direct answer found, generate contextual response
      return this.getFallbackResponse(intent, originalMessage);
    }
    
    extractAnswerFromResponse(lines) {
      const skipPatterns = [
        /^(Intent Type|Key Entities|Need for Memory|Screenshots|Briefly analyze)/i,
        /^(User:|Think through:|Analyze this)/i,
        /^(\d+\.|•|-|\*)/,  // List markers
        /^(The user|This is|Based on)/i
      ];
      
      const answerIndicators = [
        /\b(is often|considered|evidence|suggests|indicates)\b/i,
        /\b(according to|research shows|studies indicate)\b/i,
        /\b(the answer|the result|the solution)\b/i,
        /\b(Damascus|Jericho|ancient|oldest|years|BCE|AD)\b/i,  // Context-specific
        /\b(approximately|around|about|over|under)\s+\d+/i
      ];
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip if line is too short or matches skip patterns
        if (trimmedLine.length < 20) continue;
        if (skipPatterns.some(pattern => pattern.test(trimmedLine))) continue;
        
        // Check if line contains answer indicators
        if (answerIndicators.some(pattern => pattern.test(trimmedLine))) {
          // Clean up the line
          let cleanedLine = trimmedLine
            .replace(/^(The\s+)?/i, '')  // Remove leading "The"
            .replace(/\s+/g, ' ')        // Normalize whitespace
            .trim();
          
          // Ensure it ends with proper punctuation
          if (!/[.!?]$/.test(cleanedLine)) {
            cleanedLine += '.';
          }
          
          return cleanedLine;
        }
      }
      
      return null;
    }
    
    getFallbackResponse(intent, originalMessage = '') {
      const responses = {
        memory_store: [
          "I'll remember that for you.",
          "Got it, I've stored that information.",
          "I'll keep that in mind."
        ],
        memory_retrieve: [
          "Let me check what I have stored about that.",
          "I'll look up that information for you.",
          "Let me recall what you told me about that."
        ],
        memory_update: [
          "I'll update that information for you.",
          "I'll modify what I have stored.",
          "I'll change that in my records."
        ],
        memory_delete: [
          "I'll remove that from my memory.",
          "I'll forget that information.",
          "I'll delete that record."
        ],
        command: [
          "I'll take care of that for you.",
          "I'll execute that command.",
          "I'll handle that action."
        ],
        greeting: [
          "Hello! How can I help you today?",
          "Hi there! What can I assist you with?",
          "Good to see you! How may I help?"
        ],
        question: [
          "I can help you find that information.",
          "Let me look that up for you.",
          "I'll help you with that question."
        ]
      };
      
      const intentResponses = responses[intent] || responses.question;
      
      // Add some variety by choosing based on message length
      const messageLength = originalMessage.length;
      const index = messageLength % intentResponses.length;
      
      return intentResponses[index];
    }
    
    extractAnalysis(responseText) {
      // Extract key phrases that indicate what the user is trying to do
      const analysisPatterns = [
        /user (?:wants|is trying|needs) to (.+?)\./i,
        /this (?:is|appears to be) (?:a|an) (.+?)\./i,
        /(?:request|message) (?:is|about) (.+?)\./i
      ];
      
      for (const pattern of analysisPatterns) {
        const match = responseText.match(pattern);
        if (match) {
          return match[1].trim();
        }
      }
      
      return "User message analysis";
    }
    
    extractReasoning(responseText, intent) {
      return `Classified as ${intent} based on content analysis`;
    }
    
    checkConsistency(responseText, originalMessage) {
      // Simple consistency check
      return "Analysis consistent with message content";
    }
    
    generateClarificationPrompt(intentResult) {
      return `I'm not entirely sure what you'd like me to do. Could you clarify if you want me to: ${intentResult.possibleIntents.join(', ')}?`;
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
    // Get the full basePrompt content for reference
    const baseContent = this.basePrompt();
    
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
      console.log('🔍 Establishing stability - performing health check');
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
          model: 'phi3:mini',
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
            model: 'phi3:mini',
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
      model: 'phi3-json',
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
      // Since curl test shows Ollama is accessible, use HTTP module directly
      console.log('🔍 DEBUG: Request body preview:', JSON.stringify({
        model: queryOptions.model,
        prompt: prompt.substring(0, 50) + (prompt.length > 50 ? '...' : ''),
        stream: false
      }));
      console.log('🔍 DEBUG: Full prompt length:', prompt.length, 'characters');
      
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
      console.log('🔍 DEBUG: Phi3 response:', result.response);
      
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
• Local LLM processing using Phi3-mini for privacy
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
