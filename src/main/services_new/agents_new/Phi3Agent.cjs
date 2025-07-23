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
          timeout: { type: 'integer', description: 'Query timeout in milliseconds', default: 30000 },
          maxRetries: { type: 'integer', description: 'Maximum retry attempts', default: 2 },
          temperature: { type: 'number', description: 'Model temperature', default: 0.1 },
          maxTokens: { type: 'integer', description: 'Maximum tokens to generate', default: 200 }
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
        timeout: config.timeout || 30000,
        model: config.model || 'phi3:mini',
        maxRetries: config.maxRetries || 2
      };
      
      // Store child_process dependency (using original name as shown in debug logs)
      const { child_process } = context;
      AGENT_FORMAT.spawn = child_process?.spawn;
      
      console.log('🔍 DEBUG: child_process available:', !!child_process);
      console.log('🔍 DEBUG: child_process.spawn available:', !!child_process?.spawn);
      
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
        console.log('🔍 DEBUG: Testing Phi3 availability after service startup...');
        const testResult = await AGENT_FORMAT.executeOllamaQuery('Hello', { timeout: 5000 });
        AGENT_FORMAT.isAvailable = testResult && testResult.length > 0;
        console.log('🔍 DEBUG: Phi3 availability test result:', AGENT_FORMAT.isAvailable);
      } catch (error) {
        console.warn('🚫 Phi3 availability test failed:', error.message);
        AGENT_FORMAT.isAvailable = false;
      }
      
      console.log(`🤖 Phi3 availability: ${AGENT_FORMAT.isAvailable ? '✅ Available' : '❌ Not available'}`);
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
          stream: false
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
          await new Promise(resolve => setTimeout(resolve, 3000));
          
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
