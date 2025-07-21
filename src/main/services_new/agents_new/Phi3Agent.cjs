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
      
      // Store configuration
      this.config = {
        timeout: config.timeout || 30000,
        model: config.model || 'phi3',
        maxRetries: config.maxRetries || 2
      };
      
      // Store child_process dependency
      const { child_process } = context;
      this.spawn = child_process.spawn;
      
      // Check availability during bootstrap
      this.isAvailable = await this.checkAvailability();
      
      console.log(`🤖 Phi3 availability: ${this.isAvailable ? '✅ Available' : '❌ Not available'}`);
      console.log('✅ Phi3Agent: Setup complete');
      
      return { 
        success: true, 
        config: this.config,
        available: this.isAvailable
      };
      
    } catch (error) {
      console.error('❌ Phi3Agent setup failed:', error);
      this.isAvailable = false;
      throw error;
    }
  },

  // Object-based execute method
  async execute(params, context) {
    try {
      const { action } = params;
      
      switch (action) {
        case 'query-phi3':
          return await this.queryPhi3(params, context);
        case 'check-availability':
          return await this.checkAvailabilityAction(params, context);
        case 'get-model-info':
          return await this.getModelInfo(params, context);
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
      
      if (!this.isAvailable) {
        throw new Error('Phi3 is not available');
      }
      
      console.log(`🤖 Querying Phi3 with prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
      
      const maxRetries = options.maxRetries || this.config.maxRetries;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await this.executeOllamaQuery(prompt, options);
          
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
          await this.sleep(1000 * attempt);
        }
      }
    } catch (error) {
      console.error('❌ Phi3 query failed:', error);
      throw error;
    }
  },

  async checkAvailabilityAction(params, context) {
    try {
      const available = await this.checkAvailability();
      
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
      if (!this.isAvailable) {
        return {
          success: true,
          action: 'get-model-info',
          model: this.config.model,
          available: false,
          error: 'Phi3 is not available',
          timestamp: new Date().toISOString()
        };
      }
      
      const result = await this.executeOllamaQuery('What model are you?', { timeout: 10000 });
      
      return {
        success: true,
        action: 'get-model-info',
        model: this.config.model,
        available: true,
        response: result.trim(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Model info retrieval failed:', error);
      return {
        success: true,
        action: 'get-model-info',
        model: this.config.model,
        available: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  },

  // Execute the actual Ollama query using child_process spawn
  executeOllamaQuery(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || this.config.timeout;
      let timeoutId;

      // Spawn Ollama process
      const ollama = this.spawn('ollama', ['run', this.config.model], { 
        stdio: ['pipe', 'pipe', 'inherit'] 
      });

      let result = '';
      let errorOutput = '';

      // Set up timeout
      timeoutId = setTimeout(() => {
        ollama.kill('SIGTERM');
        reject(new Error(`Phi3 query timed out after ${timeout}ms`));
      }, timeout);

      // Handle stdout data
      ollama.stdout.on('data', (data) => {
        result += data.toString();
      });

      // Handle stderr data
      ollama.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      // Send prompt to model
      try {
        ollama.stdin.write(prompt + '\n');
        ollama.stdin.end();
      } catch (error) {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to write prompt to Ollama: ${error.message}`));
        return;
      }

      // Handle process completion
      ollama.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (code !== 0) {
          const errorMsg = errorOutput || `Ollama process exited with code ${code}`;
          reject(new Error(`Ollama execution failed: ${errorMsg}`));
          return;
        }

        if (!result.trim()) {
          reject(new Error('Ollama returned empty response'));
          return;
        }

        resolve(result);
      });

      // Handle process errors
      ollama.on('error', (error) => {
        clearTimeout(timeoutId);
        
        if (error.code === 'ENOENT') {
          reject(new Error('Ollama not found. Please install Ollama and ensure it\'s in your PATH.'));
        } else {
          reject(new Error(`Ollama process error: ${error.message}`));
        }
      });
    });
  },

  // Check if Ollama and the model are available
  async checkAvailability() {
    try {
      const result = await this.executeOllamaQuery('test', { timeout: 5000 });
      return result.length > 0;
    } catch (error) {
      console.warn('🚫 Phi3 not available:', error.message);
      return false;
    }
  },

  // Sleep utility for retry delays
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

module.exports = AGENT_FORMAT;
