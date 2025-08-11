const natural = require('natural');
const nlp = require('compromise');
const IntentResponses = require('./IntentResponses.cjs');

/**
 * Ultra-lightweight intent parser using Natural.js and Compromise.js
 * Designed to replace the heavy transformer-based IntentParser for speed and reliability
 */
class FastIntentParser {
  constructor() {
    console.log('🚀 Initializing FastIntentParser...');
    
    // Initialize stemmer for word normalization
    this.stemmer = natural.PorterStemmer;
    
    // Initialize Naive Bayes classifier for fallback classification
    this.classifier = new natural.BayesClassifier();
    this.isClassifierTrained = false;
    
    // Train the classifier with basic examples
    this.trainClassifier();
    
    // Memory keywords for quick detection
    this.memoryStoreKeywords = [
      'remember', 'store', 'save', 'keep', 'track', 'jot', 'log', 'record', 'note',
      'remind', 'reminder', 'appointment', 'meeting', 'schedule', 'event', 'plan',
      'had', 'went', 'did', 'was', 'visited', 'attended', 'completed'
    ];
    
    this.memoryRetrieveKeywords = [
      'what', 'when', 'where', 'who', 'show', 'find', 'tell', 'recall',
      'next', 'schedule', 'calendar', 'appointments', 'plans', 'happening',
      'going', 'remember', 'forgot', 'remind', 'discuss', 'discussed',
      'conversation', 'chat', 'chatted', 'talked', 'mentioned', 'said',
      'told', 'shared', 'previous', 'last time', 'before', 'earlier',
      'history', 'stored', 'information', 'data'
    ];
    
    this.commandKeywords = [
      'take', 'capture', 'screenshot', 'snap', 'picture', 'photo',
      'open', 'launch', 'run', 'start', 'execute', 'display', 'grab'
    ];
    
    console.log('✅ FastIntentParser initialized');
  }
  
  /**
   * Train the Naive Bayes classifier with comprehensive intent examples
   */
  trainClassifier() {
    // Memory store examples (sharing information, past events)
    this.classifier.addDocument('I had a meeting with John yesterday', 'memory_store');
    this.classifier.addDocument('Remember I have an appointment tomorrow', 'memory_store');
    this.classifier.addDocument('I went to the doctor last week', 'memory_store');
    this.classifier.addDocument('Save this information for later', 'memory_store');
    this.classifier.addDocument('I completed the project today', 'memory_store');
    this.classifier.addDocument('I visited my mom yesterday', 'memory_store');
    this.classifier.addDocument('I have a dentist appointment next Tuesday', 'memory_store');
    this.classifier.addDocument('Keep track of my workout routine', 'memory_store');
    this.classifier.addDocument('I talked to the client about the proposal', 'memory_store');
    this.classifier.addDocument('My vacation starts next month', 'memory_store');
    
    // Memory retrieve examples (asking about stored information)
    this.classifier.addDocument('What do I have tomorrow', 'memory_retrieve');
    this.classifier.addDocument('When is my next appointment', 'memory_retrieve');
    this.classifier.addDocument('What happened last week', 'memory_retrieve');
    this.classifier.addDocument('Show me my schedule', 'memory_retrieve');
    this.classifier.addDocument('What meetings do I have today', 'memory_retrieve');
    this.classifier.addDocument('Tell me about my plans', 'memory_retrieve');
    this.classifier.addDocument('What is happening next week', 'memory_retrieve');
    
    // Complex memory retrieve examples (conversation history, past interactions)
    this.classifier.addDocument('What did we discuss in our previous conversation', 'memory_retrieve');
    this.classifier.addDocument('What was the last thing I told you about my work', 'memory_retrieve');
    this.classifier.addDocument('Can you remind me what I said about my family', 'memory_retrieve');
    this.classifier.addDocument('What information do I have stored about my doctor visits', 'memory_retrieve');
    this.classifier.addDocument('What did I mention about my vacation plans', 'memory_retrieve');
    this.classifier.addDocument('Tell me what I shared about my meeting yesterday', 'memory_retrieve');
    this.classifier.addDocument('What did we chat about last time', 'memory_retrieve');
    this.classifier.addDocument('Remind me what I asked you to remember', 'memory_retrieve');
    this.classifier.addDocument('What appointments did I mention in our chat', 'memory_retrieve');
    this.classifier.addDocument('How long ago did I last chat with you', 'memory_retrieve');
    this.classifier.addDocument('What was our previous conversation about', 'memory_retrieve');
    this.classifier.addDocument('Can you recall what I told you about my project', 'memory_retrieve');
    
    // Command examples
    this.classifier.addDocument('Take a screenshot', 'command');
    this.classifier.addDocument('Capture the screen', 'command');
    this.classifier.addDocument('Open calculator', 'command');
    this.classifier.addDocument('Launch browser', 'command');
    this.classifier.addDocument('Take a photo of the desktop', 'command');
    
    // Question examples
    this.classifier.addDocument('What is the weather like', 'question');
    this.classifier.addDocument('How do I cook pasta', 'question');
    this.classifier.addDocument('What is the capital of France', 'question');
    this.classifier.addDocument('Why is the sky blue', 'question');
    this.classifier.addDocument('How long does it take to drive there', 'question');
    
    // Greeting examples
    this.classifier.addDocument('Hello there', 'greeting');
    this.classifier.addDocument('Good morning', 'greeting');
    this.classifier.addDocument('How are you', 'greeting');
    this.classifier.addDocument('Hi', 'greeting');
    this.classifier.addDocument('Goodbye', 'greeting');
    
    // Train the classifier
    this.classifier.train();
    this.isClassifierTrained = true;
    console.log('✅ Naive Bayes classifier trained with basic examples');
  }
  
  /**
   * Main parsing method - compatible with existing IntentParser interface
   */
  async parse(responseText, originalMessage) {
    const startTime = Date.now();
    const message = originalMessage || responseText;
    
    try {
      // Fast grammatical analysis using Compromise
      const result = await this.classifyIntent(message, message);
      
      // Extract entities
      const entities = this.extractEntities(message);
      
      const processingTime = Date.now() - startTime;
      console.log(`⚡ FastIntentParser processed in ${processingTime}ms`);
      
      return {
        intent: result.intent,
        confidence: result.confidence,
        entities: entities,
        reasoning: result.reasoning,
        processingTime: processingTime,
        suggestedResponse: this.getFallbackResponse(result.intent, message),
        analysis: `Fast classification: ${result.intent}`,
        isConsistent: true
      };
      
    } catch (error) {
      console.error('❌ FastIntentParser error:', error);
      return {
        intent: 'question',
        confidence: 0.5,
        entities: [],
        reasoning: 'Fallback due to parsing error',
        processingTime: Date.now() - startTime,
        suggestedResponse: "I'm not sure what you'd like me to do. Could you rephrase that?",
        analysis: 'Error in classification',
        isConsistent: false
      };
    }
  }
  
  /**
   * Fast intent classification using grammatical analysis + keyword matching
   */
  async classifyIntent(responseText, originalMessage) {
    const message = originalMessage.toLowerCase().trim();
    const doc = nlp(originalMessage);
    
    // 1. Fast grammatical analysis (1-2ms)
    
    // Check for commands first (highest priority)
    if (this.isCommand(doc, message)) {
      return {
        intent: 'command',
        confidence: 0.9,
        reasoning: 'Detected command keywords and imperative structure'
      };
    }
    
    // Check for memory storage (past tense or explicit storage)
    if (this.isMemoryStore(doc, message)) {
      return {
        intent: 'memory_store',
        confidence: 0.85,
        reasoning: 'Detected past tense or storage intent'
      };
    }
    
    // Check for memory retrieval (questions about stored info)
    if (this.isMemoryRetrieve(doc, message)) {
      return {
        intent: 'memory_retrieve',
        confidence: 0.85,
        reasoning: 'Detected question about stored information'
      };
    }
    
    // Check for greetings
    if (this.isGreeting(doc, message)) {
      return {
        intent: 'greeting',
        confidence: 0.8,
        reasoning: 'Detected greeting or social interaction'
      };
    }
    
    // 2. Fallback to Naive Bayes classifier (2-3ms)
    if (this.isClassifierTrained) {
      const classification = this.classifier.classify(message);
      const classifications = this.classifier.getClassifications(message);
      const confidence = classifications.length > 0 ? classifications[0].value : 0.6;
      
      return {
        intent: classification,
        confidence: confidence,
        reasoning: `Naive Bayes classification (${(confidence * 100).toFixed(1)}%)`
      };
    }
    
    // 3. Final fallback
    return {
      intent: 'question',
      confidence: 0.5,
      reasoning: 'Default fallback classification'
    };
  }
  
  /**
   * Check if message is a command
   */
  isCommand(doc, message) {
    // Check for command keywords
    const hasCommandKeywords = this.commandKeywords.some(keyword => 
      message.includes(keyword)
    );
    
    // Check for imperative mood
    const hasImperative = doc.has('#Imperative') || 
                         doc.match('(take|capture|open|launch|run|start|show|grab) #Determiner? #Noun').found;
    
    return hasCommandKeywords || hasImperative;
  }
  
  /**
   * Check if message is memory storage intent
   */
  isMemoryStore(doc, message) {
    // Check for past tense (sharing what happened)
    const hasPastTense = doc.has('#PastTense') || 
                        doc.match('I (had|went|did|was|visited|attended|completed)').found;
    
    // Check for explicit storage keywords (but not questions)
    const hasStorageKeywords = this.memoryStoreKeywords.some(keyword => 
      message.includes(keyword)
    );
    
    // Check for appointment/event statements (not questions)
    const hasAppointmentStatement = doc.match('I (have|had) #Determiner? (appointment|meeting|event)').found;
    
    // Don't classify questions as storage
    const isQuestion = doc.has('#Question') || message.startsWith('what') || 
                      message.startsWith('when') || message.startsWith('where') ||
                      message.startsWith('who') || message.includes('?');
    
    return (hasPastTense || hasAppointmentStatement || (hasStorageKeywords && !isQuestion)) && !isQuestion;
  }
  
  /**
   * Check if message is memory retrieval intent
   */
  isMemoryRetrieve(doc, message) {
    // Check for questions
    const isQuestion = doc.has('#Question') || message.startsWith('what') || 
                      message.startsWith('when') || message.startsWith('where') ||
                      message.startsWith('who') || message.includes('?');
    
    // Check for memory retrieval keywords
    const hasRetrievalKeywords = this.memoryRetrieveKeywords.some(keyword => 
      message.includes(keyword)
    );
    
    // Check for schedule/calendar queries
    const hasScheduleQuery = doc.match('(what|when|where) #Verb #Pronoun (have|schedule|plan)').found ||
                            (message.includes('next week') && isQuestion) || 
                            (message.includes('tomorrow') && isQuestion) ||
                            (message.includes('today') && isQuestion) || 
                            message.includes('my schedule') || message.includes('my calendar');
    
    // Check for conversation history queries
    const hasConversationQuery = (message.includes('conversation') || message.includes('chat') || 
                                message.includes('discuss') || message.includes('talked') ||
                                message.includes('previous') || message.includes('last time') ||
                                message.includes('we ') || message.includes('our ')) && isQuestion;
    
    // Check for memory-specific queries
    const hasMemoryQuery = (message.includes('remember') || message.includes('recall') ||
                           message.includes('stored') || message.includes('told you') ||
                           message.includes('mentioned') || message.includes('shared')) && isQuestion;
    
    // Exclude general knowledge questions
    const isGeneralQuestion = message.includes('weather') || message.includes('how to') ||
                             message.includes('what is the') || message.includes('why is') ||
                             message.includes('how do i') || message.includes('how can i');
    
    return ((isQuestion && hasRetrievalKeywords) || hasScheduleQuery || hasConversationQuery || hasMemoryQuery) && !isGeneralQuestion;
  }
  
  /**
   * Check if message is a greeting
   */
  isGreeting(doc, message) {
    const greetingPatterns = [
      'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
      'how are you', 'goodbye', 'bye', 'see you', 'nice to meet'
    ];
    
    return greetingPatterns.some(pattern => message.includes(pattern));
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
  };
  
  extractDatetimes(doc) {
    try {
      // Extract time-related terms
      const timeTerms = doc.match('#Date').out('array');
      const timeWords = doc.match('(today|tomorrow|yesterday|next week|last week|this week|next month|last month)').out('array');
      const specificTimes = doc.match('#Time').out('array');
      return [...timeTerms, ...timeWords, ...specificTimes].filter(Boolean);
    } catch (error) {
      // Fallback to simple regex
      const text = doc.text();
      const timeMatches = text.match(/\b(today|tomorrow|yesterday|next week|last week|this week|next month|last month|\d{1,2}:\d{2}|\d{1,2}(am|pm))\b/gi) || [];
      return timeMatches;
    }
  }
  
  extractPeople(doc) {
    try {
      return doc.people().out('array');
    } catch (error) {
      // Fallback to capitalized words that might be names
      const text = doc.text();
      const nameMatches = text.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || [];
      return nameMatches;
    }
  }
  
  extractLocations(doc) {
    try {
      return doc.places().out('array');
    } catch (error) {
      // Fallback to common location words
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
      // Extract potential contact information
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
    
    // Common item patterns
    const itemPatterns = [
      /\b(shoes?|boots?|sneakers?|sandals?)\b/g,
      /\b(shirt?s?|pants?|jeans?|dress(es)?)\b/g,
      /\b(phone?s?|laptop?s?|computer?s?)\b/g,
      /\b(food|meal?s?|coffee|tea)\b/g,
      /\b(book?s?|magazine?s?)\b/g,
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
    
    return [...new Set(items)];
  }
  
  /**
   * Calculate pattern scores (for compatibility with existing system)
   */
  calculatePatternScores(message) {
    const scores = {
      memory_store: 0,
      memory_retrieve: 0,
      command: 0,
      question: 0,
      greeting: 0
    };
    
    const doc = nlp(message);
    const lowerMessage = message.toLowerCase();
    
    // Calculate scores based on keyword presence and grammatical structure
    if (this.isMemoryStore(doc, lowerMessage)) scores.memory_store = 0.8;
    if (this.isMemoryRetrieve(doc, lowerMessage)) scores.memory_retrieve = 0.8;
    if (this.isCommand(doc, lowerMessage)) scores.command = 0.9;
    if (this.isGreeting(doc, lowerMessage)) scores.greeting = 0.7;
    if (doc.has('#Question')) scores.question = 0.6;
    
    return scores;
  }
  
  /**
   * Get fallback response (for compatibility)
   */
  getFallbackResponse(intent, originalMessage = '') {
    return IntentResponses.getSuggestedResponse(intent, originalMessage);
  }
  
  /**
   * Initialize embeddings (for compatibility - not used in fast parser)
   */
  async initializeEmbeddings() {
    console.log('✅ FastIntentParser: No embeddings needed - using grammatical analysis');
    return Promise.resolve();
  }
}

module.exports = FastIntentParser;
