/**
 * Intent Parser Factory - Centralized parser creation and management
 * Provides consistent parser instances across the entire application
 */

const NaturalLanguageIntentParser = require('./IntentParser.cjs');
const FastIntentParser = require('./FastIntentParser.cjs');
const HybridIntentParser = require('./HybridIntentParser.cjs');
const DistilBertIntentParser = require('./DistilBertIntentParser.cjs');

class IntentParserFactory {
  constructor() {
    // Global configuration - can be changed at runtime
    this.config = {
      useDistilBert: true,  // Best: DistilBERT fine-tuned for 95%+ accuracy
      useHybrid: false,     // Good: TensorFlow.js + USE + Compromise + Natural
      useFast: false,       // Good: Natural + Compromise only
      useOriginal: false    // Fallback: Original heavy parser
    };
    
    // Singleton instances
    this.distilBertInstance = null;
    this.hybridInstance = null;
    this.fastInstance = null;
    this.originalInstance = null;
    
    console.log('🏭 IntentParserFactory initialized');
  }
  
  /**
   * Get the best available parser instance
   */
  async getParser() {
    // Try DistilBERT parser first (highest accuracy)
    if (this.config.useDistilBert) {
      if (!this.distilBertInstance) {
        try {
          console.log('🤖 Creating DistilBERT Intent Parser instance...');
          this.distilBertInstance = new DistilBertIntentParser();
          return this.distilBertInstance;
        } catch (error) {
          console.warn('⚠️ DistilBERT parser failed, falling back to HybridIntentParser:', error.message);
          this.config.useDistilBert = false;
          this.config.useHybrid = true;
        }
      } else {
        return this.distilBertInstance;
      }
    }
    
    // Try hybrid parser second
    if (this.config.useHybrid) {
      if (!this.hybridInstance) {
        try {
          console.log('🚀 Creating HybridIntentParser instance...');
          this.hybridInstance = new HybridIntentParser();
          return this.hybridInstance;
        } catch (error) {
          console.warn('⚠️ HybridIntentParser failed, falling back to FastIntentParser:', error.message);
          this.config.useHybrid = false;
          this.config.useFast = true;
        }
      } else {
        return this.hybridInstance;
      }
    }
    
    // Try fast parser
    if (this.config.useFast) {
      if (!this.fastInstance) {
        try {
          console.log('🚀 Creating FastIntentParser instance...');
          this.fastInstance = new FastIntentParser();
          return this.fastInstance;
        } catch (error) {
          console.warn('⚠️ FastIntentParser failed, falling back to original:', error.message);
          this.config.useFast = false;
          this.config.useOriginal = true;
        }
      } else {
        return this.fastInstance;
      }
    }
    
    // Fallback to original parser
    if (!this.originalInstance) {
      console.log('🚀 Creating NaturalLanguageIntentParser instance...');
      this.originalInstance = new NaturalLanguageIntentParser();
      
      // Initialize embeddings asynchronously
      this.originalInstance.initializeEmbeddings().catch(err => {
        console.warn('⚠️ Original parser embeddings initialization failed:', err.message);
      });
    }
    
    return this.originalInstance;
  }
  
  /**
   * Get parser for specific use case
   */
  async getParserForUseCase(useCase) {
    switch (useCase) {
      case 'fast-fallback':
        // For fallback responses, use fast parser
        return this.getFastParser();
        
      case 'semantic-analysis':
        // For complex semantic analysis, prefer hybrid
        return this.getHybridParser();
        
      case 'bootstrap':
        // For bootstrap/initialization, use best available
        return this.getParser();
        
      default:
        return this.getParser();
    }
  }
  
  /**
   * Force get DistilBERT parser (may return null if not available)
   */
  async getDistilBertParser() {
    if (!this.distilBertInstance) {
      try {
        this.distilBertInstance = new DistilBertIntentParser();
      } catch (error) {
        console.warn('⚠️ DistilBERT parser not available:', error.message);
        return null;
      }
    }
    return this.distilBertInstance;
  }
  
  /**
   * Force get hybrid parser (may return null if not available)
   */
  async getHybridParser() {
    if (!this.hybridInstance) {
      try {
        this.hybridInstance = new HybridIntentParser();
      } catch (error) {
        console.warn('⚠️ HybridIntentParser not available:', error.message);
        return null;
      }
    }
    return this.hybridInstance;
  }
  
  /**
   * Force get fast parser (may return null if not available)
   */
  async getFastParser() {
    if (!this.fastInstance) {
      try {
        this.fastInstance = new FastIntentParser();
      } catch (error) {
        console.warn('⚠️ FastIntentParser not available:', error.message);
        return null;
      }
    }
    return this.fastInstance;
  }
  
  /**
   * Get original parser (always available)
   */
  async getOriginalParser() {
    if (!this.originalInstance) {
      this.originalInstance = new NaturalLanguageIntentParser();
      
      // Initialize embeddings asynchronously
      this.originalInstance.initializeEmbeddings().catch(err => {
        console.warn('⚠️ Original parser embeddings initialization failed:', err.message);
      });
    }
    return this.originalInstance;
  }
  
  /**
   * Configure parser preferences
   */
  configure(options) {
    this.config = { ...this.config, ...options };
    console.log('🔧 IntentParserFactory configured:', this.config);
  }
  
  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }
  
  /**
   * Reset all instances (useful for testing)
   */
  reset() {
    this.distilBertInstance = null;
    this.hybridInstance = null;
    this.fastInstance = null;
    this.originalInstance = null;
    console.log('🔄 IntentParserFactory reset');
  }
  
  /**
   * Get parser info for debugging
   */
  getInfo() {
    return {
      config: this.config,
      instances: {
        distilbert: !!this.distilBertInstance,
        hybrid: !!this.hybridInstance,
        fast: !!this.fastInstance,
        original: !!this.originalInstance
      }
    };
  }
}

// Export singleton instance
const factory = new IntentParserFactory();

module.exports = factory;
