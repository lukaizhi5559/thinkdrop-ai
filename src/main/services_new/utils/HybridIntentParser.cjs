const natural = require('natural');
const nlp = require('compromise');
const IntentResponses = require('./IntentResponses.cjs');

/**
 * Hybrid Intent Parser combining TensorFlow.js + USE with Natural.js + Compromise.js
 * This provides the best of both worlds: semantic understanding + grammatical analysis
 */
class HybridIntentParser {
  constructor() {
    console.log('🚀 Initializing HybridIntentParser...');
    
    // TensorFlow.js components (loaded asynchronously)
    this.useModel = null;           // Universal Sentence Encoder
    this.tfModel = null;            // Custom intent classifier
    this.isSemanticReady = false;
    
    // Traditional NLP components (fast initialization)
    this.stemmer = natural.PorterStemmer;
    this.fallbackClassifier = new natural.BayesClassifier();
    this.isFallbackTrained = false;
    
    // Intent patterns for fast pre-filtering
    this.intentKeywords = {
      memory_store: [
        'remember', 'store', 'save', 'keep', 'track', 'jot', 'log', 'record', 'note',
        'had', 'went', 'did', 'was', 'visited', 'attended', 'completed', 'talked'
      ],
      memory_retrieve: [
        'what', 'when', 'where', 'who', 'show', 'find', 'tell', 'recall',
        'schedule', 'calendar', 'appointments', 'plans', 'happening',
        'conversation', 'chat', 'discuss', 'mentioned', 'said', 'told',
        'previous', 'last time', 'stored', 'information'
      ],
      command: [
        'take', 'capture', 'screenshot', 'snap', 'picture', 'photo',
        'open', 'launch', 'run', 'start', 'execute', 'display'
      ]
    };
    
    // Initialize fallback classifier
    this.trainFallbackClassifier();
    
    // Initialize semantic models asynchronously
    this.initializeSemanticModels().catch(err => {
      console.warn('⚠️ Semantic models initialization failed, using fallback:', err.message);
    });
    
    console.log('✅ HybridIntentParser initialized (semantic models loading...)');
  }
  
  /**
   * Initialize TensorFlow.js and Universal Sentence Encoder
   */
  async initializeSemanticModels() {
    try {
      console.log('🔄 Loading TensorFlow.js and Universal Sentence Encoder...');
      
      // Import TensorFlow.js
      const tf = await import('@tensorflow/tfjs');
      
      // Load Universal Sentence Encoder
      const use = await import('@tensorflow-models/universal-sentence-encoder');
      this.useModel = await use.load();
      
      console.log('✅ Universal Sentence Encoder loaded');
      
      // Train or load custom intent classifier
      await this.initializeCustomModel();
      
      this.isSemanticReady = true;
      console.log('✅ Semantic models ready');
      
    } catch (error) {
      console.warn('⚠️ Failed to load semantic models:', error.message);
      this.isSemanticReady = false;
    }
  }
  
  /**
   * Initialize custom TensorFlow model for intent classification
   */
  async initializeCustomModel() {
    try {
      const tf = await import('@tensorflow/tfjs');
      
      // Training data for intent classification
      const trainingData = [
        // Memory store examples
        { text: 'I had a meeting with John yesterday', intent: 'memory_store' },
        { text: 'Remember I have an appointment tomorrow', intent: 'memory_store' },
        { text: 'I went to the doctor last week', intent: 'memory_store' },
        { text: 'Save this information for later', intent: 'memory_store' },
        { text: 'I completed the project today', intent: 'memory_store' },
        { text: 'I talked to the client about the proposal', intent: 'memory_store' },
        { text: 'Keep track of my new routine starting next Monday', intent: 'memory_store' },
        { text: 'I want to remember this recipe for later', intent: 'memory_store' },
        { text: 'Store this email as part of my job notes', intent: 'memory_store' },
        { text: 'Next week I have a work meeting in texas', intent: 'memory_store' },
        { text: 'Tomorrow I have a dentist appointment', intent: 'memory_store' },
        { text: 'I have a conference call on Friday', intent: 'memory_store' },
        { text: 'Next month I have a vacation planned', intent: 'memory_store' },
        { text: 'I have a job interview next Tuesday', intent: 'memory_store' },
        { text: 'This weekend I have a family dinner', intent: 'memory_store' },
      
        // Memory retrieve examples
        { text: 'What do I have tomorrow', intent: 'memory_retrieve' },
        { text: 'When is my next appointment', intent: 'memory_retrieve' },
        { text: 'What happened last week', intent: 'memory_retrieve' },
        { text: 'Show me my schedule', intent: 'memory_retrieve' },
        { text: 'What did we discuss in our previous conversation', intent: 'memory_retrieve' },
        { text: 'What was the last thing I told you about my work', intent: 'memory_retrieve' },
        { text: 'How long was it when the last time I chatted with you', intent: 'memory_retrieve' },
        { text: 'What did we chat about last time', intent: 'memory_retrieve' },
        { text: 'Can you remind me what I said about my family', intent: 'memory_retrieve' },
        { text: 'What did I mention about my upcoming trip?', intent: 'memory_retrieve' },
        { text: 'Tell me what I shared about that meeting yesterday', intent: 'memory_retrieve' },
        { text: 'anything coming up this week', intent: 'memory_retrieve' },
        { text: 'anything happening next week', intent: 'memory_retrieve' },
        { text: 'anything coming in in a week or two', intent: 'memory_retrieve' },
        { text: 'anything scheduled for next month', intent: 'memory_retrieve' },
        { text: 'something coming up soon', intent: 'memory_retrieve' },
        { text: 'any events this weekend', intent: 'memory_retrieve' },
        { text: 'do I have anything planned', intent: 'memory_retrieve' },
      
        // Command examples
        { text: 'Take a screenshot', intent: 'command' },
        { text: 'Capture the screen', intent: 'command' },
        { text: 'Open calculator', intent: 'command' },
        { text: 'Launch browser', intent: 'command' },
        { text: 'Save this page as a PDF', intent: 'command' },
        { text: 'Start recording my screen', intent: 'command' },
      
        // Question examples
        { text: 'What is the weather like', intent: 'question' },
        { text: 'How do I cook pasta', intent: 'question' },
        { text: 'What is the capital of France', intent: 'question' },
        { text: 'Why is the sky blue', intent: 'question' },
        { text: 'What time does the library open', intent: 'question' },
        { text: 'Where is the nearest coffee shop', intent: 'question' },
      
        // Greeting examples
        { text: 'Hello there', intent: 'greeting' },
        { text: 'Good morning', intent: 'greeting' },
        { text: 'How are you', intent: 'greeting' },
        { text: 'Hi', intent: 'greeting' },
        { text: 'Good evening', intent: 'greeting' },
        { text: 'See you later', intent: 'greeting' }
      ];      
      
      // Get embeddings for training data
      const texts = trainingData.map(d => d.text);
      const embeddings = await this.useModel.embed(texts);
      
      // Create labels (one-hot encoded)
      const intentLabels = ['memory_store', 'memory_retrieve', 'command', 'question', 'greeting'];
      const labels = trainingData.map(d => {
        const oneHot = new Array(intentLabels.length).fill(0);
        oneHot[intentLabels.indexOf(d.intent)] = 1;
        return oneHot;
      });
      
      // Create and train model
      this.tfModel = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [512], units: 128, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: 64, activation: 'relu' }),
          tf.layers.dense({ units: intentLabels.length, activation: 'softmax' })
        ]
      });
      
      this.tfModel.compile({
        optimizer: 'adam',
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });
      
      // Train the model
      const xs = embeddings;
      const ys = tf.tensor2d(labels);
      
      await this.tfModel.fit(xs, ys, {
        epochs: 50,
        batchSize: 8,
        verbose: 0
      });
      
      this.intentLabels = intentLabels;
      console.log('✅ Custom TensorFlow model trained');
      
    } catch (error) {
      console.warn('⚠️ Failed to initialize custom model:', error.message);
    }
  }
  
  /**
   * Train fallback Naive Bayes classifier
   */
  trainFallbackClassifier() {
    // Same training data as before for fallback
    const examples = [
      // Memory store
      ['I had a meeting with John yesterday', 'memory_store'],
      ['Remember I have an appointment tomorrow', 'memory_store'],
      ['I went to the doctor last week', 'memory_store'],
      ['Save this information for later', 'memory_store'],
      
      // Memory retrieve
      ['What do I have tomorrow', 'memory_retrieve'],
      ['When is my next appointment', 'memory_retrieve'],
      ['What did we discuss in our previous conversation', 'memory_retrieve'],
      ['How long was it when the last time I chatted with you', 'memory_retrieve'],
      ['anything coming up this week', 'memory_retrieve'],
      ['anything happening next week', 'memory_retrieve'],
      ['anything coming in in a week or two', 'memory_retrieve'],
      ['do I have anything planned', 'memory_retrieve'],
      
      // Commands
      ['Take a screenshot', 'command'],
      ['Open calculator', 'command'],
      
      // Questions
      ['What is the weather like', 'question'],
      ['How do I cook pasta', 'question'],
      
      // Greetings
      ['Hello there', 'greeting'],
      ['Good morning', 'greeting']
    ];
    
    examples.forEach(([text, intent]) => {
      this.fallbackClassifier.addDocument(text, intent);
    });
    
    this.fallbackClassifier.train();
    this.isFallbackTrained = true;
    console.log('✅ Fallback Naive Bayes classifier trained');
  }
  
  /**
   * Main parsing method - hybrid approach
   */
  async parse(responseText, originalMessage) {
    const startTime = Date.now();
    const message = originalMessage || responseText;
    
    try {
      // 1. Fast grammatical pre-analysis (1-2ms)
      const grammarHints = this.getGrammarHints(message);
      
      // 2. Semantic classification if available (10-20ms)
      let semanticResult = null;
      if (this.isSemanticReady && this.useModel && this.tfModel) {
        semanticResult = await this.getSemanticClassification(message);
      }
      
      // 3. Combine results for final decision
      const result = this.combineResults(grammarHints, semanticResult, message);
      
      // 4. Extract entities using Compromise
      const entities = this.extractEntities(message);
      
      const processingTime = Date.now() - startTime;
      console.log(`⚡ HybridIntentParser processed in ${processingTime}ms (semantic: ${this.isSemanticReady})`);
      
      return {
        intent: result.intent,
        confidence: result.confidence,
        entities: entities,
        reasoning: result.reasoning,
        processingTime: processingTime,
        suggestedResponse: this.getFallbackResponse(result.intent, message),
        analysis: `Hybrid classification: ${result.intent}`,
        isConsistent: true,
        semanticEnabled: this.isSemanticReady
      };
      
    } catch (error) {
      console.error('❌ HybridIntentParser error:', error);
      return this.getFallbackResult(message, Date.now() - startTime);
    }
  }
  
  /**
   * Get grammatical hints using Compromise.js
   */
  getGrammarHints(message) {
    const doc = nlp(message);
    const lowerMessage = message.toLowerCase();
    
    return {
      isQuestion: doc.has('#Question') || message.includes('?') || 
               message.startsWith('what') || message.startsWith('when') ||
               message.startsWith('where') || message.startsWith('who') ||
               message.startsWith('how') || message.startsWith('is there') ||
               message.startsWith('are there') || message.startsWith('do i have') ||
               message.startsWith('anything') || message.startsWith('any ') ||
               /\b(anything|something)\s+(coming|happening|scheduled|planned)\b/i.test(message),
      hasPastTense: doc.has('#PastTense') || doc.match('I (had|went|did|was|visited|attended|completed)').found,
      hasFutureTense: doc.has('#FutureTense') || doc.match('I (have|will have|am having)').found ||
                     lowerMessage.includes('next week') || lowerMessage.includes('tomorrow') ||
                     lowerMessage.includes('next month') || lowerMessage.includes('this weekend') ||
                     lowerMessage.includes('next tuesday') || lowerMessage.includes('on friday'),
      isImperative: doc.has('#Imperative') || message.startsWith('take') || 
                   message.startsWith('open') || message.startsWith('capture'),
      hasMemoryKeywords: this.intentKeywords.memory_retrieve.some(kw => lowerMessage.includes(kw)),
      hasCommandKeywords: this.intentKeywords.command.some(kw => lowerMessage.includes(kw)),
      hasConversationRef: lowerMessage.includes('conversation') || lowerMessage.includes('chat') ||
                         lowerMessage.includes('discuss') || lowerMessage.includes('previous') ||
                         lowerMessage.includes('last time') || lowerMessage.includes('we '),
      isGreeting: lowerMessage.includes('hello') || /\bhi\b/.test(lowerMessage) ||
                 lowerMessage.includes('good morning') || lowerMessage.includes('how are you') ||
                 lowerMessage.startsWith('hi ') || lowerMessage === 'hi'
    };
  }
  
  /**
   * Get semantic classification using TensorFlow
   */
  async getSemanticClassification(message) {
    try {
      const embedding = await this.useModel.embed([message]);
      const prediction = this.tfModel.predict(embedding);
      const scores = await prediction.data();
      
      const maxIndex = scores.indexOf(Math.max(...scores));
      const confidence = scores[maxIndex];
      const intent = this.intentLabels[maxIndex];
      
      return {
        intent: intent,
        confidence: confidence,
        reasoning: `TensorFlow semantic classification (${(confidence * 100).toFixed(1)}%)`
      };
      
    } catch (error) {
      console.warn('⚠️ Semantic classification failed:', error.message);
      return null;
    }
  }
  
  /**
   * Combine grammar hints and semantic results
   */
  combineResults(grammarHints, semanticResult, message) {
    // If semantic model is available and confident, use it
    if (semanticResult && semanticResult.confidence > 0.7) {
      return semanticResult;
    }
    
    // Otherwise use grammar-based rules with high confidence
    if (grammarHints.isGreeting) {
      return { intent: 'greeting', confidence: 0.9, reasoning: 'Grammar-based: greeting detected' };
    }
    
    if (grammarHints.hasCommandKeywords || grammarHints.isImperative) {
      return { intent: 'command', confidence: 0.9, reasoning: 'Grammar-based: command detected' };
    }
    
    if ((grammarHints.hasPastTense || grammarHints.hasFutureTense) && !grammarHints.isQuestion) {
      return { intent: 'memory_store', confidence: 0.85, reasoning: 'Grammar-based: event sharing (past/future)' };
    }
    
    if (grammarHints.isQuestion && (grammarHints.hasMemoryKeywords || grammarHints.hasConversationRef)) {
      return { intent: 'memory_retrieve', confidence: 0.85, reasoning: 'Grammar-based: memory query' };
    }
    
    // Fallback to semantic result if available
    if (semanticResult) {
      return semanticResult;
    }
    
    // Final fallback to Naive Bayes
    if (this.isFallbackTrained) {
      const classification = this.fallbackClassifier.classify(message);
      const classifications = this.fallbackClassifier.getClassifications(message);
      const confidence = classifications.length > 0 ? classifications[0].value : 0.6;
      
      return {
        intent: classification,
        confidence: confidence,
        reasoning: `Fallback Naive Bayes (${(confidence * 100).toFixed(1)}%)`
      };
    }
    
    return { intent: 'question', confidence: 0.5, reasoning: 'Default fallback' };
  }
  
  /**
   * Extract entities using Compromise.js
   */
  extractEntities(message) {
    const doc = nlp(message);
    
    return {
      datetime: this.extractDatetimes(doc),
      person: this.extractPeople(doc),
      location: this.extractLocations(doc),
      event: this.extractEvents(doc),
      contact: this.extractContacts(doc),
      items: this.extractItems(doc, message)
    };
  }
  
  extractDatetimes(doc) {
    try {
      const text = doc.text();
      const timeMatches = text.match(/\b(today|tomorrow|yesterday|next week|last week|this week|next month|last month|\d{1,2}:\d{2}|\d{1,2}(am|pm))\b/gi) || [];
      return timeMatches;
    } catch (error) {
      return [];
    }
  }
  
  extractPeople(doc) {
    try {
      return doc.people().out('array');
    } catch (error) {
      const text = doc.text();
      const nameMatches = text.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || [];
      return nameMatches;
    }
  }
  
  extractLocations(doc) {
    try {
      return doc.places().out('array');
    } catch (error) {
      const locationWords = doc.match('(office|home|hospital|school|restaurant|cafe|park|mall|store)').out('array');
      return locationWords;
    }
  }
  
  extractEvents(doc) {
    const events = doc.match('(appointment|meeting|event|call|conference|lunch|dinner|interview|presentation)').out('array');
    return events;
  }
  
  extractContacts(doc) {
    try {
      const text = doc.text();
      const emails = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || [];
      const phones = text.match(/\b\d{3}-\d{3}-\d{4}\b|\b\(\d{3}\)\s*\d{3}-\d{4}\b/g) || [];
      return [...emails, ...phones];
    } catch (error) {
      return [];
    }
  }

  extractItems(doc, message) {
    const items = [];
    const text = message.toLowerCase();
    
    // Use Compromise.js to find nouns that might be items
    try {
      const nouns = doc.nouns().out('array');
      const itemNouns = nouns.filter(noun => {
        const n = noun.toLowerCase();
        return /^(shoes?|clothes?|food|phone|laptop|book|car|bike|furniture|equipment)/.test(n) ||
               /\b(need|want|buy|get|looking for)\b.*\b(shoes?|clothes?|food|phone|laptop|book|car|bike)\b/.test(text);
      });
      items.push(...itemNouns);
    } catch (error) {
      // Fallback to regex patterns
    }
    
    // Common item patterns (same as DistilBertIntentParser)
    const itemPatterns = [
      /\b(shoes?|boots?|sneakers?|sandals?|heels?|flats?)\b/g,
      /\b(shirt?s?|pants?|jeans?|dress(es)?|skirt?s?|jacket?s?|coat?s?)\b/g,
      /\b(phone?s?|laptop?s?|computer?s?|tablet?s?|headphones?)\b/g,
      /\b(food|meal?s?|coffee|tea|water|juice)\b/g,
      /\b(book?s?|magazine?s?|movie?s?|music)\b/g,
      /\bneed (?:some |a |an |new |more )?([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\b/g,
      /\bwant (?:some |a |an |new |more )?([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\b/g,
      /\bbuy (?:some |a |an |new |more )?([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\b/g
    ];
    
    itemPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const item = match[1] || match[0];
        if (item && item.length > 2 && !items.includes(item)) {
          items.push(item.trim());
        }
      }
    });
    
    return [...new Set(items)]; // Remove duplicates
  }
  
  /**
   * Calculate pattern scores for compatibility
   */
  calculatePatternScores(message) {
    const grammarHints = this.getGrammarHints(message);
    
    return {
      memory_store: (grammarHints.hasPastTense || grammarHints.hasFutureTense) && !grammarHints.isQuestion ? 0.8 : 0,
      memory_retrieve: grammarHints.isQuestion && (grammarHints.hasMemoryKeywords || grammarHints.hasConversationRef) ? 0.8 : 0,
      command: grammarHints.hasCommandKeywords || grammarHints.isImperative ? 0.9 : 0,
      question: grammarHints.isQuestion ? 0.6 : 0,
      greeting: grammarHints.isGreeting ? 0.8 : 0
    };
  }
  
  /**
   * Get fallback response
   */
  getFallbackResponse(intent, originalMessage = '') {
    return IntentResponses.getSuggestedResponse(intent, originalMessage);
  }
  
  /**
   * Get fallback result in case of error
   */
  getFallbackResult(message, processingTime) {
    return {
      intent: 'question',
      confidence: 0.5,
      entities: [],
      reasoning: 'Fallback due to parsing error',
      processingTime: processingTime,
      suggestedResponse: "I'm not sure what you'd like me to do. Could you rephrase that?",
      analysis: 'Error in classification',
      isConsistent: false,
      semanticEnabled: false
    };
  }
  
  /**
   * Initialize embeddings (for compatibility)
   */
  async initializeEmbeddings() {
    return this.initializeSemanticModels();
  }
}

module.exports = HybridIntentParser;
