/**
 * LLM Router - Handles multiple AI providers with intelligent routing and fallback
 */
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class LLMRouter {
  constructor() {
    this.providers = {};
    this.initializeProviders();
    this.primaryProvider = this.detectPrimaryProvider();
  }

  /**
   * Initialize all available LLM providers based on environment variables
   */
  initializeProviders() {
    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.providers.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log('✅ OpenAI provider initialized');
    }

    // Anthropic (Claude)
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      console.log('✅ Anthropic provider initialized');
    }

    // Google AI (Gemini)
    if (process.env.GOOGLE_AI_API_KEY) {
      this.providers.google = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
      console.log('✅ Google AI provider initialized');
    }

    // Mistral
    if (process.env.MISTRAL_API_KEY) {
      // Note: Mistral SDK would be initialized here
      this.providers.mistral = {
        apiKey: process.env.MISTRAL_API_KEY,
        // Placeholder for Mistral client
      };
      console.log('✅ Mistral provider initialized');
    }

    if (Object.keys(this.providers).length === 0) {
      console.warn('⚠️ No LLM providers configured. Check your API keys.');
    }
  }

  /**
   * Detect which provider to use as primary based on availability
   */
  detectPrimaryProvider() {
    const priority = ['openai', 'anthropic', 'google', 'mistral'];
    
    for (const provider of priority) {
      if (this.providers[provider]) {
        console.log(`🎯 Primary LLM provider: ${provider}`);
        return provider;
      }
    }
    
    return null;
  }

  /**
   * Generate completion using specified or primary provider
   */
  async generateCompletion(prompt, options = {}) {
    const {
      provider = this.primaryProvider,
      maxTokens = 1000,
      temperature = 0.7,
      systemPrompt = 'You are Thinkdrop AI, an intelligent assistant.',
      useStreaming = false
    } = options;

    if (!provider || !this.providers[provider]) {
      throw new Error(`Provider '${provider}' not available`);
    }

    console.log(`🤖 Generating completion with ${provider}...`);

    try {
      switch (provider) {
        case 'openai':
          return await this.generateOpenAICompletion(prompt, {
            maxTokens,
            temperature,
            systemPrompt,
            useStreaming
          });
        
        case 'anthropic':
          return await this.generateAnthropicCompletion(prompt, {
            maxTokens,
            temperature,
            systemPrompt
          });
        
        case 'google':
          return await this.generateGoogleCompletion(prompt, {
            maxTokens,
            temperature,
            systemPrompt
          });
        
        case 'mistral':
          return await this.generateMistralCompletion(prompt, options);
        
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }
    } catch (error) {
      console.error(`❌ Error with ${provider}:`, error.message);
      
      // Try fallback to other providers
      if (provider !== this.primaryProvider) {
        console.log('🔄 Falling back to primary provider...');
        return await this.generateCompletion(prompt, {
          ...options,
          provider: this.primaryProvider
        });
      }
      
      // Try next available provider
      const availableProviders = Object.keys(this.providers);
      const nextProvider = availableProviders.find(p => p !== provider);
      
      if (nextProvider) {
        console.log(`🔄 Falling back to ${nextProvider}...`);
        return await this.generateCompletion(prompt, {
          ...options,
          provider: nextProvider
        });
      }
      
      throw error;
    }
  }

  /**
   * OpenAI completion
   */
  async generateOpenAICompletion(prompt, options) {
    const { maxTokens, temperature, systemPrompt, useStreaming } = options;
    
    const completion = await this.providers.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: temperature,
      stream: useStreaming
    });

    if (useStreaming) {
      return completion; // Return stream for handling
    }

    return {
      content: completion.choices[0].message.content,
      provider: 'openai',
      model: 'gpt-4',
      usage: completion.usage
    };
  }

  /**
   * Anthropic (Claude) completion
   */
  async generateAnthropicCompletion(prompt, options) {
    const { maxTokens, temperature, systemPrompt } = options;
    
    const completion = await this.providers.anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: maxTokens,
      temperature: temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    return {
      content: completion.content[0].text,
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
      usage: completion.usage
    };
  }

  /**
   * Google AI (Gemini) completion
   */
  async generateGoogleCompletion(prompt, options) {
    const { temperature, systemPrompt } = options;
    
    const model = this.providers.google.getGenerativeModel({ 
      model: 'gemini-pro',
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: options.maxTokens,
      }
    });

    const fullPrompt = `${systemPrompt}\n\nUser: ${prompt}`;
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    
    return {
      content: response.text(),
      provider: 'google',
      model: 'gemini-pro',
      usage: response.usageMetadata
    };
  }

  /**
   * Mistral completion (placeholder - implement based on actual Mistral SDK)
   */
  async generateMistralCompletion(prompt, options) {
    // This would be implemented once Mistral provides a proper Node.js SDK
    throw new Error('Mistral provider not yet implemented');
  }

  /**
   * Generate embeddings for semantic search
   */
  async generateEmbedding(text, provider = 'openai') {
    if (!this.providers[provider]) {
      throw new Error(`Embedding provider '${provider}' not available`);
    }

    try {
      switch (provider) {
        case 'openai':
          const response = await this.providers.openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: text,
          });
          return response.data[0].embedding;
        
        default:
          throw new Error(`Embeddings not supported for provider: ${provider}`);
      }
    } catch (error) {
      console.error(`❌ Embedding generation error:`, error.message);
      throw error;
    }
  }

  /**
   * Health check for all providers
   */
  async healthCheck() {
    const results = {};
    
    for (const [providerName, provider] of Object.entries(this.providers)) {
      try {
        // Simple test completion
        const testResult = await this.generateCompletion(
          'Say "Hello" in one word.',
          { 
            provider: providerName, 
            maxTokens: 10,
            temperature: 0 
          }
        );
        
        results[providerName] = {
          status: 'healthy',
          model: testResult.model,
          responseLength: testResult.content.length
        };
      } catch (error) {
        results[providerName] = {
          status: 'unhealthy',
          error: error.message
        };
      }
    }
    
    return results;
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    return Object.keys(this.providers);
  }

  /**
   * Switch primary provider
   */
  setPrimaryProvider(provider) {
    if (!this.providers[provider]) {
      throw new Error(`Provider '${provider}' not available`);
    }
    
    this.primaryProvider = provider;
    console.log(`🔄 Primary provider switched to: ${provider}`);
  }
}

module.exports = LLMRouter;
