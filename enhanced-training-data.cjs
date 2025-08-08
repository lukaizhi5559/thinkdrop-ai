#!/usr/bin/env node

/**
 * Enhanced Training Data Generator for DistilBERT Intent Parser
 * Implements suggestions from the LLM conversation for 100% accuracy
 */

class EnhancedTrainingDataGenerator {
  constructor() {
    this.synonyms = {
      // Event/appointment synonyms
      'meeting': ['appointment', 'call', 'zoom', 'catch-up', 'session', 'conference', 'discussion'],
      'appointment': ['meeting', 'visit', 'session', 'consultation', 'booking'],
      'event': ['happening', 'occasion', 'activity', 'gathering', 'function'],
      
      // Storage action synonyms
      'remember': ['save', 'store', 'keep', 'log', 'record', 'note', 'track'],
      'save': ['remember', 'store', 'keep', 'log', 'record', 'note'],
      
      // Retrieval action synonyms
      'what': ['tell me', 'show me', 'remind me', 'let me know'],
      'when': ['what time', 'at what time', 'what day'],
      
      // Time synonyms
      'tomorrow': ['next day', 'the following day'],
      'next week': ['the following week', 'coming week', 'upcoming week'],
      'yesterday': ['the previous day', 'last day'],
      'last week': ['the previous week', 'past week']
    };
  }

  /**
   * Generate comprehensive training data with all enhancements
   */
  generateEnhancedTrainingData() {
    const baseData = this.getBaseTrainingData();
    const synonymVariations = this.generateSynonymVariations(baseData);
    const ambiguityExamples = this.getAmbiguityExamples();
    const complexityExamples = this.getComplexityExamples();
    
    return [
      ...baseData,
      ...synonymVariations,
      ...ambiguityExamples,
      ...complexityExamples
    ];
  }

  /**
   * Base training data with confidence and complexity metadata
   */
  getBaseTrainingData() {
    return [
      // === MEMORY STORE (High Confidence) ===
      { text: 'I had a meeting with John yesterday', intent: 'memory_store', confidence: 'high', complexity: 'simple', entities: ['person', 'event', 'time'] },
      { text: 'Remember I have an appointment tomorrow', intent: 'memory_store', confidence: 'high', complexity: 'simple', entities: ['event', 'time'] },
      { text: 'I went to the doctor last week', intent: 'memory_store', confidence: 'high', complexity: 'simple', entities: ['event', 'time'] },
      { text: 'Save this information for later', intent: 'memory_store', confidence: 'high', complexity: 'simple', entities: [] },
      { text: 'I completed the project today', intent: 'memory_store', confidence: 'high', complexity: 'simple', entities: ['event', 'time'] },
      
      // "I have X coming up" patterns (CRITICAL)
      { text: 'I have a hair appointment coming up in a week', intent: 'memory_store', confidence: 'high', complexity: 'medium', entities: ['event', 'time'] },
      { text: 'I have a dentist appointment coming up next week', intent: 'memory_store', confidence: 'high', complexity: 'medium', entities: ['event', 'time'] },
      { text: 'My kids go back to school next week', intent: 'memory_store', confidence: 'high', complexity: 'medium', entities: ['person', 'event', 'time'] },
      { text: 'I have a hair appt coming up in a week, plus my kids go back to school next week', intent: 'memory_store', confidence: 'high', complexity: 'complex', entities: ['event', 'person', 'time'] },
      
      // === MEMORY RETRIEVE (High Confidence) ===
      { text: 'What do I have tomorrow', intent: 'memory_retrieve', confidence: 'high', complexity: 'simple', entities: ['time'] },
      { text: 'When is my next appointment', intent: 'memory_retrieve', confidence: 'high', complexity: 'simple', entities: ['event'] },
      { text: 'What happened last week', intent: 'memory_retrieve', confidence: 'high', complexity: 'simple', entities: ['time'] },
      { text: 'anything coming up this week', intent: 'memory_retrieve', confidence: 'high', complexity: 'simple', entities: ['time'] },
      { text: 'anything happening next week', intent: 'memory_retrieve', confidence: 'high', complexity: 'simple', entities: ['time'] },
      { text: 'anything coming in in a week or two', intent: 'memory_retrieve', confidence: 'high', complexity: 'medium', entities: ['time'] },
      { text: 'do I have anything planned', intent: 'memory_retrieve', confidence: 'high', complexity: 'simple', entities: [] },
      
      // === COMMANDS (High Confidence) ===
      { text: 'Take a screenshot', intent: 'command', confidence: 'high', complexity: 'simple', entities: [] },
      { text: 'Capture the screen', intent: 'command', confidence: 'high', complexity: 'simple', entities: [] },
      { text: 'Open calculator', intent: 'command', confidence: 'high', complexity: 'simple', entities: [] },
      
      // === QUESTIONS (High Confidence) ===
      { text: 'What is the weather like', intent: 'question', confidence: 'high', complexity: 'simple', entities: [] },
      { text: 'How do I cook pasta', intent: 'question', confidence: 'high', complexity: 'simple', entities: [] },
      { text: 'What time does the library open', intent: 'question', confidence: 'high', complexity: 'medium', entities: ['location'] },
      
      // === GREETINGS (High Confidence) ===
      { text: 'Hello there', intent: 'greeting', confidence: 'high', complexity: 'simple', entities: [] },
      { text: 'Good morning', intent: 'greeting', confidence: 'high', complexity: 'simple', entities: [] },
      { text: 'How are you', intent: 'greeting', confidence: 'high', complexity: 'simple', entities: [] }
    ];
  }

  /**
   * Generate synonym variations of base examples
   */
  generateSynonymVariations(baseData) {
    const variations = [];
    
    baseData.forEach(example => {
      if (example.confidence === 'high' && example.complexity === 'simple') {
        // Generate 2-3 synonym variations for high-confidence simple examples
        const synonymVariations = this.createSynonymVariations(example.text, example.intent, 2);
        variations.push(...synonymVariations.map(text => ({
          text,
          intent: example.intent,
          confidence: 'medium',
          complexity: 'simple',
          entities: example.entities,
          generated: true
        })));
      }
    });
    
    return variations;
  }

  /**
   * Create synonym variations of a text
   */
  createSynonymVariations(text, intent, count = 2) {
    const variations = [];
    let currentText = text;
    
    // Replace synonyms
    Object.keys(this.synonyms).forEach(word => {
      if (currentText.toLowerCase().includes(word)) {
        this.synonyms[word].slice(0, count).forEach(synonym => {
          const variation = currentText.replace(new RegExp(word, 'gi'), synonym);
          if (variation !== currentText && !variations.includes(variation)) {
            variations.push(variation);
          }
        });
      }
    });
    
    return variations.slice(0, count);
  }

  /**
   * Ambiguous and edge case examples
   */
  getAmbiguityExamples() {
    return [
      // Ambiguous cases that need careful classification
      { text: "I'm not sure what I have this weekend", intent: 'memory_retrieve', confidence: 'medium', complexity: 'ambiguous', entities: ['time'] },
      { text: "Can you tell me if I've saved anything about my trip?", intent: 'memory_retrieve', confidence: 'medium', complexity: 'ambiguous', entities: ['event'] },
      { text: "Maybe I should remember this", intent: 'memory_store', confidence: 'low', complexity: 'ambiguous', entities: [] },
      { text: "I think I told you about something important", intent: 'memory_retrieve', confidence: 'low', complexity: 'ambiguous', entities: [] },
      { text: "Did I mention anything about next week?", intent: 'memory_retrieve', confidence: 'medium', complexity: 'ambiguous', entities: ['time'] },
      { text: "I might have something coming up", intent: 'memory_store', confidence: 'low', complexity: 'ambiguous', entities: [] },
      
      // Negative cases
      { text: "I don't have anything planned", intent: 'memory_store', confidence: 'medium', complexity: 'simple', entities: [] },
      { text: "Nothing is happening this week", intent: 'memory_store', confidence: 'medium', complexity: 'simple', entities: ['time'] },
      { text: "I cancelled my appointment", intent: 'memory_store', confidence: 'high', complexity: 'simple', entities: ['event'] }
    ];
  }

  /**
   * Complex multi-intent examples
   */
  getComplexityExamples() {
    return [
      // Complex sentences with multiple intents
      { text: "I have a meeting tomorrow, can you remind me what time it is?", intent: 'memory_retrieve', confidence: 'medium', complexity: 'complex', entities: ['event', 'time'] },
      { text: "Save this note and also check what I have next week", intent: 'memory_store', confidence: 'medium', complexity: 'complex', entities: ['time'] },
      { text: "I just finished a call with the client about the project timeline and budget", intent: 'memory_store', confidence: 'high', complexity: 'complex', entities: ['person', 'event'] },
      
      // Conversational context
      { text: "Actually, let me add that to my calendar", intent: 'memory_store', confidence: 'medium', complexity: 'medium', entities: [] },
      { text: "On second thought, what did I say about that meeting?", intent: 'memory_retrieve', confidence: 'medium', complexity: 'medium', entities: ['event'] }
    ];
  }

  /**
   * Export enhanced training data in the format expected by DistilBertIntentParser
   */
  exportForDistilBert() {
    const enhancedData = this.generateEnhancedTrainingData();
    
    console.log(`📊 Generated ${enhancedData.length} training examples:`);
    console.log(`   - High confidence: ${enhancedData.filter(d => d.confidence === 'high').length}`);
    console.log(`   - Medium confidence: ${enhancedData.filter(d => d.confidence === 'medium').length}`);
    console.log(`   - Low confidence: ${enhancedData.filter(d => d.confidence === 'low').length}`);
    console.log(`   - Simple complexity: ${enhancedData.filter(d => d.complexity === 'simple').length}`);
    console.log(`   - Medium complexity: ${enhancedData.filter(d => d.complexity === 'medium').length}`);
    console.log(`   - Complex: ${enhancedData.filter(d => d.complexity === 'complex').length}`);
    console.log(`   - Ambiguous: ${enhancedData.filter(d => d.complexity === 'ambiguous').length}`);
    
    // Return in simple format for DistilBert (just text and intent)
    return enhancedData.map(item => ({
      text: item.text,
      intent: item.intent,
      metadata: {
        confidence: item.confidence,
        complexity: item.complexity,
        entities: item.entities,
        generated: item.generated || false
      }
    }));
  }
}

// Test the generator
if (require.main === module) {
  const generator = new EnhancedTrainingDataGenerator();
  const enhancedData = generator.exportForDistilBert();
  
  console.log('\n🎯 Sample enhanced training examples:');
  enhancedData.slice(0, 5).forEach((item, i) => {
    console.log(`${i+1}. "${item.text}" → ${item.intent} (${item.metadata.confidence}/${item.metadata.complexity})`);
  });
}

module.exports = EnhancedTrainingDataGenerator;
