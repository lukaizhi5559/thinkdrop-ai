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
        model: config.model || 'phi3:mini',
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
      
      // Test Phi3 availability after service startup
      try {
        const testResult = await AGENT_FORMAT.executeOllamaQuery('Hello', { timeout: 3000 });
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
      
      const maxRetries = options.maxRetries || AGENT_FORMAT.config.maxRetries;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await AGENT_FORMAT.executeOllamaQuery(prompt, options);
          
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
      
      if (!AGENT_FORMAT.isAvailable) {
        throw new Error('Phi3 is not available');
      }
      
      console.log(`🎯 Classifying intent for message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
      
      // Get current date for context
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      // Simplified and focused intent classification prompt
      const systemPrompt = `You are ThinkDrop AI's intent classifier. Analyze the message and classify into exactly one primary intent from these 7 types:

**Intent Types:**
- memory_store: User shares personal info/experiences/needs/plans to remember
- memory_retrieve: User wants to recall stored information  
- memory_update: User wants to modify existing stored info
- memory_delete: User wants to remove stored info
- greeting: User says hello/starts conversation
- question: User asks for information/guidance/explanations
- command: User gives instruction to perform action

**Key Rules:**
1. ONLY use these 7 types - no others
2. Memory store = sharing personal info ("I lost my keys", "I have appointment at 3pm")
3. Question = asking for info ("How do I get a title?", "What should I do?")
4. Command = direct instruction ("take screenshot", "capture this", "do something")

**Entity Types:** time, date, date_range, event, person, channel, location, object, task, command
**Date Context:** Today is ${today}. Use ISO format YYYY-MM-DD for dates. Times in 24-hour format.

**Quick Examples:**
- "I need a new car title" → memory_store (sharing personal need)
- "How do I get a car title?" → question (asking for info)
- "Take a screenshot" → command (direct instruction)
- "Hello there" → greeting (starting conversation)
- "What did I say about my car?" → memory_retrieve (recalling info)

Examples:
- "Take a screenshot" → command (captureScreen: true)
- "I have a meeting at 3pm" → memory_store
- "What did I say about my car?" → memory_retrieve
- "Hello there" → greeting
- "How do I do this?" → question

Rules:
- Use ONLY these 7 intent types
- Set captureScreen=true for screenshot/screen capture requests
- Set requiresMemoryAccess=true for memory operations
- Provide a helpful suggestedResponse

Respond with ONLY this JSON format:
{
  "primaryIntent": "intent_name",
  "intents": [
    {
      "intent": "greeting",
      "confidence": 0.95,
      "reasoning": "Message starts with greeting"
    },
    {
      "intent": "memory_store",
      "confidence": 0.90,
      "reasoning": "User wants to store appointment information"
    },
    {
      "intent": "command",
      "confidence": 0.85,
      "reasoning": "User requests email action to be performed"
    }
  ],
  "captureScreen": false,
  "requiresMemoryAccess": false,
  "requiresExternalData": false,
  "suggestedResponse": "helpful response",
  "entities": [
    { "value": "extracted_text", "type": "entity_type", "normalized_value": "standardized_value_or_null" }
  ],
  "sourceText": "${message}"
}

Message: "${message}"`.trim();
      
      const result = await AGENT_FORMAT.executeOllamaQuery(systemPrompt, {
        ...options,
        temperature: 0.1, // Low temperature for consistent classification
        maxTokens: 300 // Reduced for focused JSON response
      });
      
      console.log('🎯 Raw Phi3 intent classification result:', result);
      
      // Parse JSON response with robust extraction
      let intentData;
      try {
        let jsonStr = result.trim();
        
        // Remove markdown code blocks if present
        if (jsonStr.includes('```json')) {
          const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
          }
        } else if (jsonStr.includes('```')) {
          const jsonMatch = jsonStr.match(/```\s*([\s\S]*?)```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
          }
        }
        
        // Extract JSON object with proper bracket matching
        if (!jsonStr.startsWith('{')) {
          const startIndex = jsonStr.indexOf('{');
          if (startIndex !== -1) {
            let braceCount = 0;
            let endIndex = startIndex;
            
            for (let i = startIndex; i < jsonStr.length; i++) {
              if (jsonStr[i] === '{') braceCount++;
              if (jsonStr[i] === '}') braceCount--;
              if (braceCount === 0) {
                endIndex = i;
                break;
              }
            }
            
            jsonStr = jsonStr.substring(startIndex, endIndex + 1);
          }
        }
        
        console.log('🔍 Extracted JSON string:', jsonStr.substring(0, 200) + '...');
        intentData = JSON.parse(jsonStr);
        
        // Ensure primaryIntent is set based on content if missing
        if (!intentData.primaryIntent) {
          const message = params.message.toLowerCase();
          if (message.includes('screenshot') || message.includes('capture') || message.includes('screen')) {
            intentData.primaryIntent = 'command';
            intentData.captureScreen = true;
          } else if (message.includes('remember') || message.includes('store') || message.includes('save')) {
            intentData.primaryIntent = 'memory_store';
          } else if (message.includes('recall') || message.includes('what did') || message.includes('retrieve')) {
            intentData.primaryIntent = 'memory_retrieve';
          } else if (message.includes('hello') || message.includes('hi ') || message.includes('hey')) {
            intentData.primaryIntent = 'greeting';
          } else {
            intentData.primaryIntent = 'question';
          }
          console.log('🔧 Added missing primaryIntent:', intentData.primaryIntent);
        }
        
      } catch (parseError) {
        console.warn('⚠️ Failed to parse intent JSON, using fallback:', parseError.message);
        console.warn('🔍 Raw response causing error:', result.substring(0, 300) + '...');
        
        // Smart fallback based on message content
        const message = params.message.toLowerCase();
        let fallbackIntent = 'question';
        let fallbackCapture = false;
        
        if (message.includes('screenshot') || message.includes('capture') || message.includes('screen')) {
          fallbackIntent = 'command';
          fallbackCapture = true;
        } else if (message.includes('remember') || message.includes('store') || message.includes('save')) {
          fallbackIntent = 'memory_store';
        } else if (message.includes('recall') || message.includes('what did') || message.includes('retrieve')) {
          fallbackIntent = 'memory_retrieve';
        } else if (message.includes('hello') || message.includes('hi ') || message.includes('hey')) {
          fallbackIntent = 'greeting';
        }
        
        intentData = {
          primaryIntent: fallbackIntent,
          confidence: 0.6,
          reasoning: `JSON parse failed, smart fallback to ${fallbackIntent} based on keywords`,
          captureScreen: fallbackCapture,
          suggestedResponse: fallbackCapture ? 
            'I\'ll take a screenshot for you.' : 
            'I\'ll help you with that using my local capabilities.'
        };
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

  // Simple Phi3 query using direct HTTP approach
  async executeOllamaQuery(prompt, options = {}) { 
    try {
      // Since curl test shows Ollama is accessible, use HTTP module directly
      console.log('🔍 DEBUG: Request body preview:', JSON.stringify({
        model: AGENT_FORMAT.config.model,
        prompt: prompt.substring(0, 50) + (prompt.length > 50 ? '...' : ''),
        stream: false
      }));
      console.log('🔍 DEBUG: Full prompt length:', prompt.length, 'characters');
      
      const response = await AGENT_FORMAT.makeHttpRequest('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AGENT_FORMAT.config.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: options.temperature || 0.0,
            num_predict: options.maxTokens || 50,
            top_k: 10,
            top_p: 0.9,
            num_ctx: 512
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('🔍 DEBUG: Phi3 response:', result.response);
      
      return result.response?.trim() || '';
    } catch (error) {
      console.log('❌ DEBUG: Ollama request failed:', error.message);
      
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
  }
};

module.exports = AGENT_FORMAT;
