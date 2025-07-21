/**
 * IntentParserAgent_phi3_embedded - Object-based approach
 * Local LLM-compatible agent for intent classification using Phi3 with enhanced prompting
 */

const AGENT_FORMAT = {
  name: 'IntentParserAgent_phi3_embedded',
  description: 'Advanced intent classification agent using Phi3 local LLM with enhanced prompting and pattern fallback',
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Intent parsing operation to perform',
        enum: ['parse-intent-enhanced', 'classify-with-context']
      },
      message: {
        type: 'string',
        description: 'User message to analyze for intent'
      },
      userContext: {
        type: 'object',
        description: 'User context for enhanced classification'
      }
    },
    required: ['action', 'message']
  },
  dependencies: [],
  execution_target: 'frontend',
  requires_database: false,
  database_type: undefined,

  async bootstrap(config, context) {
    try {
      console.log('🧠 IntentParserAgent_phi3_embedded: Initializing enhanced Phi3 intent parsing...');
      this.config = {
        llmTimeout: config.llmTimeout || 8000,
        maxTokens: config.maxTokens || 300,
        temperature: config.temperature || 0.1,
        confidenceThreshold: config.confidenceThreshold || 0.7
      };
      this.intentPatterns = this.initializeEnhancedPatterns();
      
      // Check if Phi3Agent is available via agent-to-agent communication
      this.phi3Available = await this.checkPhi3Availability(context);
      console.log(`🤖 Phi3 availability: ${this.phi3Available ? '✅ Available' : '❌ Not available'}`);
      
      console.log('✅ IntentParserAgent_phi3_embedded: Setup complete');
      return { success: true, config: this.config, phi3Available: this.phi3Available };
    } catch (error) {
      console.error('❌ IntentParserAgent_phi3_embedded setup failed:', error);
      this.phi3Available = false;
      throw error;
    }
  },

  // Check Phi3 availability via agent-to-agent communication
  async checkPhi3Availability(context) {
    try {
      if (!context.executeAgent) {
        console.warn('⚠️ executeAgent not available in context, assuming Phi3 unavailable');
        return false;
      }
      
      const availabilityResult = await context.executeAgent('Phi3Agent', {
        action: 'check-availability'
      });
      
      return availabilityResult.success && availabilityResult.available;
    } catch (error) {
      console.warn('⚠️ Failed to check Phi3 availability:', error.message);
      return false;
    }
  },

  async execute(params, context) {
    try {
      const { action, message } = params;
      
      switch (action) {
        case 'parse-intent-enhanced':
          return await this.parseIntentEnhanced(params, context);
        case 'classify-with-context':
          return await this.classifyWithContext(params, context);
        default:
          throw new Error('Unknown action: ' + action);
      }
    } catch (error) {
      console.error('❌ IntentParserAgent_phi3_embedded execution failed:', error);
      return {
        success: false,
        error: error.message,
        result: { intent: 'question', confidence: 0.5, entities: [], category: 'fallback' },
        timestamp: new Date().toISOString()
      };
    }
  },

  async parseIntentEnhanced(params, context) {
    try {
      const { message, userContext } = params;
      const { llmClient } = context;
      
      console.log(`🧠 Enhanced intent parsing for: "${message}"`);
      
      let intentResult = null;
      if (this.phi3Available) {
        intentResult = await this.detectIntentWithLLM(message, context, userContext);
      }
      
      if (!intentResult || intentResult.confidence < this.config.confidenceThreshold) {
        console.log('⚠️ Falling back to enhanced pattern detection');
        intentResult = this.detectIntentWithPatterns(message);
      }
      
      return {
        success: true,
        action: 'parse-intent-enhanced',
        result: {
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          entities: intentResult.entities || [],
          category: intentResult.category || 'general',
          requiresContext: this.requiresScreenContext(intentResult.intent)
        },
        metadata: {
          agent: 'IntentParserAgent_phi3_embedded',
          method: intentResult.method || 'pattern',
          originalMessage: message
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Enhanced intent parsing failed:', error);
      throw error;
    }
  },

  async classifyWithContext(params, context) {
    try {
      const { message, userContext } = params;
      console.log('📝 Classifying message with context...');
      
      const intentResult = await this.parseIntentEnhanced(params, context);
      
      return {
        success: true,
        action: 'classify-with-context',
        category: this.getIntentCategory(intentResult.result.intent),
        intent: intentResult.result.intent,
        confidence: intentResult.result.confidence,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Context classification failed:', error);
      throw error;
    }
  },

  async detectIntentWithLLM(message, context, userContext = {}) {
    try {
      if (!this.phi3Available) {
        console.warn('⚠️ Phi3 not available, skipping LLM detection');
        return null;
      }
      
      const prompt = this.buildIntentPrompt(message);
      console.log('🤖 Querying local Phi3 model via agent communication...');
      
      // Use agent-to-agent communication to query Phi3
      const phi3Result = await context.executeAgent('Phi3Agent', {
        action: 'query-phi3',
        prompt: prompt,
        options: {
          timeout: this.config.llmTimeout,
          maxRetries: 2
        }
      });
      
      if (!phi3Result.success || !phi3Result.response) {
        console.warn('⚠️ Phi3 agent returned unsuccessful result, falling back to patterns');
        // Mark as unavailable if agent execution failed
        if (phi3Result.error && (phi3Result.error.includes('not found') || phi3Result.error.includes('ENOENT'))) {
          this.phi3Available = false;
          console.warn('🚫 Marking Phi3 as unavailable due to error');
        }
        return null;
      }
      
      console.log('✅ Phi3 response received via agent communication, parsing...');
      return this.parseIntentResponse(phi3Result.response, 'phi3-local');
    } catch (error) {
      console.warn('⚠️ Phi3 intent detection failed:', error.message);
      // Mark Phi3 as unavailable if it fails
      if (error.message.includes('not found') || error.message.includes('ENOENT')) {
        this.phi3Available = false;
        console.warn('🚫 Marking Phi3 as unavailable due to error');
      }
      return null;
    }
  },

    buildIntentPrompt(message) {
      return `
# Full Enhanced Prompt Example for Phi3 Local LLM
# Intent Classification for ThinkDrop AI WebSocket Messages

## Complete Prompt Structure


You are Thinkdrop AI's intent classifier for WebSocket messages. Analyze the user's message and identify ALL applicable intents - messages can have multiple intents simultaneously.

**User Context & Memory:**
- User prefers short responses for better UX
- User has a dentist appointment scheduled for tomorrow at 3pm
- User's favorite color is blue
- User recently mentioned needing a new car title
- User works from home and often uses Spotify for background music

**Message Complexity:** medium (0.65)

**Relevant Context:**
- Previous conversation about car registration and DMV processes
- User mentioned losing important documents last week

**Intent Classification Framework:**

You are an expert intent classifier. Use the following systematic approach:

**Step 1: Analyze the Message Structure**
- What is the user doing? (sharing, asking, commanding, greeting)
- What information is being communicated?
- What is the user's underlying need or goal?

**Step 2: Apply Intent Categories**
**IMPORTANT**: You MUST only use these 7 intent types. Do NOT create new intent types like "general_query" or "other". Every message must be classified as one or more of these 7 types.
- **memory_store**: User is sharing personal information, experiences, plans, tasks, needs, problems, or any data about themselves that should be remembered for future reference
- **memory_retrieve**: User wants to recall/find previously stored information
- **memory_update**: User wants to modify/edit existing stored information  
- **memory_delete**: User wants to remove/delete stored information
- **greeting**: User is greeting, saying hello, or starting conversation
- **question**: User is asking for information, guidance, or explanations (seeking knowledge)
- **command**: User is giving a command or instruction to perform an action (e.g., "take a picture", "screenshot this", "capture my screen", "do something")

**Step 3: Chain-of-Thought Analysis**
For each message, think through:
1. "What is the user telling me about themselves or their situation?"
2. "Should this information be remembered for future conversations?"
3. "Is the user asking me to do something, or just sharing information?"

**CRITICAL DISTINCTION - Memory Store vs Question:**
- **memory_store**: "I need a new car title" (sharing a personal need/task)
- **question**: "How do I get a new car title?" (asking for information)
- **memory_store**: "I lost my car keys" (sharing a personal problem)
- **question**: "What should I do if I lose my car keys?" (asking for advice)

**Few-Shot Examples with Chain-of-Thought:**

**Example 1: "I need a new title for my car. Lost mine"**
Step 1 Analysis: User is sharing a personal problem/need
Step 2 Reasoning: This is personal information about their situation that should be remembered
Step 3 CoT: (1) User is telling me they have a car title problem (2) Yes, this should be remembered for future help (3) They're sharing, not asking how to solve it
Classification: memory_store (confidence: 0.9)

**Example 2: "How do I get a new car title?"**
Step 1 Analysis: User is asking for information/guidance
Step 2 Reasoning: This is seeking knowledge, not sharing personal info
Step 3 CoT: (1) User wants to know the process (2) No personal info to remember (3) They're asking for instructions
Classification: question (confidence: 0.9)

**Example 3: "I lost my wallet yesterday"**
Step 1 Analysis: User is sharing a personal incident
Step 2 Reasoning: Personal experience that should be remembered
Step 3 CoT: (1) User experienced a loss (2) Yes, important personal event (3) Sharing information, not requesting action
Classification: memory_store (confidence: 0.85)

**Example 4: "What should I do if I lose my wallet?"**
Step 1 Analysis: User is asking for advice/guidance
Step 2 Reasoning: Hypothetical question seeking information
Step 3 CoT: (1) User wants advice for a scenario (2) No personal info shared (3) Asking for guidance
Classification: question (confidence: 0.9)

**Example 5: "I have a dentist appointment at 3pm tomorrow"**
Step 1 Analysis: User is sharing personal schedule information
Step 2 Reasoning: Personal appointment that should be remembered
Step 3 CoT: (1) User has a scheduled appointment (2) Yes, important personal schedule (3) Sharing information
Classification: memory_store (confidence: 0.9)

**Example 6: "Take a screenshot of this page"**
Step 1 Analysis: User is giving a direct instruction
Step 2 Reasoning: Command to perform an action
Step 3 CoT: (1) User wants an action performed (2) No personal info to store (3) Direct command
Classification: command (confidence: 0.95)

**Self-Consistency Check:**
Before finalizing, ask yourself:
- "If I were having a conversation with this person next week, would knowing this information be helpful?"
- "Is the user sharing something about themselves, or asking me to provide information?"
- "Would a human friend remember this if the user told them?"

**Screen Capture Detection:**
Set "captureScreen": true if the user's message indicates they need visual context or want to capture/store the current page. This includes:

**Direct Screen References:**
- "I need help understand this page"
- "guide me through this"
- "store/capture this page for later"
- "what is this all about"
- "explain what I'm looking at"
- "save this screen"
- "help me with this interface"
- "take a picture of my screen"
- "take a screenshot"
- "screenshot this"
- "capture my screen"
- "snap a picture of what I'm seeing"
- "picture of my display"
- "what am I looking at here"
- "help me understand what's on my screen"

**Content Analysis/Processing:**
- "sum up this page"
- "summarize this page"
- "summarize what's on my screen"
- "give me a summary of this"
- "tell me about this page"
- "analyze this page"
- "review this page"
- "break down this page"

**Indirect/Contextual References (requiring visual context):**
- "let's get this data in an email" (extracting visible data)
- "clean up all these words" (processing visible text)
- "organize this information" (structuring visible content)
- "extract the key points" (analyzing visible content)
- "turn this into a list" (reformatting visible content)
- "make sense of this" (interpreting visible content)
- "what should I do with this" (contextual advice about visible content)
- "help me process this" (working with visible information)
- "anything else to consider" (when context suggests visible content)
- "what's missing here" (analyzing visible content gaps)
- "how can I improve this" (evaluating visible content)
- "what's the next step" (when context involves visible workflow/process)
- "convert this to [format]" (transforming visible content)
- "send this to [someone]" (sharing visible content)
- "save this as [format]" (preserving visible content)

**Key Principle:** If the request implies the AI needs to see what the user is currently viewing to provide a meaningful response, set captureScreen: true. This includes data extraction, content analysis, formatting requests, and contextual advice about visible information.

User Message: "I'm planning to go grocery shopping after my dentist appointment tomorrow"

**Additional Examples:**
- "Hello, I have appt. at 3pm next week that I need you to email to my wife" → intents: ["greeting", "memory_store", "command"]
- "I need to buy some snacks today" → intents: ["memory_store"] (personal plan/task to remember)
- "I'm going to the gym after work" → intents: ["memory_store"] (personal activity plan)
- "I ate salad and green beans for breakfast" → intents: ["memory_store"] (sharing personal dietary information)
- "My favorite color is blue" → intents: ["memory_store"] (sharing personal preference)
- "I have a meeting tomorrow at 2pm" → intents: ["memory_store"] (personal schedule information)
- "Open Spotify" → intents: ["command"] (pure command, no personal info to store)
- "Play my workout playlist on Spotify" → intents: ["command", "memory_store"] (command + personal preference about playlists)
- "Send an email to john@example.com" → intents: ["command"] (pure command)
- "Email my mom about the dinner plans" → intents: ["command", "memory_store"] (command + personal relationship info)
- "Take a picture of my screen" → intents: ["command"], captureScreen: true (screen capture command)
- "Help me understand this page" → intents: ["question"], captureScreen: true (question requiring visual context)

**ANALYSIS INSTRUCTIONS:**

1. **Apply the 3-Step Framework** to the user message
2. **Use Chain-of-Thought reasoning** for each potential intent
3. **Reference the Few-Shot examples** for similar patterns
4. **Apply Self-Consistency checks** before finalizing
5. **Include your reasoning** in the JSON response

**CRITICAL REQUIREMENT:** You MUST always include both 'suggestedResponse' and 'sourceText' fields in your response. These are REQUIRED fields, not optional.

- 'suggestedResponse': A brief, actionable response that describes what should be done based on the detected intents
- 'sourceText': The exact original user message (for reference and context)

Analyze the message and respond in this exact JSON format:
{
  "chainOfThought": {
    "step1_analysis": "What is the user doing and what information are they communicating?",
    "step2_reasoning": "Which intent category best fits this message and why?",
    "step3_consistency": "Self-consistency check: Would this information be valuable to remember?"
  },
  "intents": [
    {
      "intent": "memory_store",
      "confidence": 0.90,
      "reasoning": "User is sharing personal plans that should be remembered"
    }
  ],
  "primaryIntent": "memory_store",
  "entities": ["grocery shopping", "dentist appointment", "tomorrow"],
  "requiresMemoryAccess": true,
  "requiresExternalData": false,
  "captureScreen": false,
  "suggestedResponse": "I'll remember your grocery shopping plans after your dentist appointment tomorrow",
  "sourceText": "I'm planning to go grocery shopping after my dentist appointment tomorrow"
}

Identify ALL applicable intents with individual confidence scores. The primaryIntent should be the most important/actionable intent.


## Expected Response for the Example Message

'''json
{
  "chainOfThought": {
    "step1_analysis": "User is sharing their personal schedule and plans for tomorrow, connecting two activities (dentist appointment and grocery shopping)",
    "step2_reasoning": "This is personal scheduling information that should be remembered for future reference. User is sharing plans, not asking questions or giving commands",
    "step3_consistency": "Yes, this information would be valuable to remember - it shows the user's schedule and helps with future planning assistance"
  },
  "intents": [
    {
      "intent": "memory_store",
      "confidence": 0.90,
      "reasoning": "User is sharing personal plans and schedule information that should be remembered for future conversations"
    }
  ],
  "primaryIntent": "memory_store",
  "entities": ["grocery shopping", "dentist appointment", "tomorrow", "after"],
  "requiresMemoryAccess": true,
  "requiresExternalData": false,
  "captureScreen": false,
  "suggestedResponse": "I'll remember your grocery shopping plans after your dentist appointment tomorrow. This connects well with your existing appointment I have stored.",
  "sourceText": "I'm planning to go grocery shopping after my dentist appointment tomorrow"
}
'''

## Key Features for Phi3 Implementation

1. **Context-Aware**: Includes user memory and conversation history
2. **Complexity Analysis**: Shows message complexity scoring
3. **RAG Context**: Incorporates relevant background information
4. **Structured Framework**: Clear 3-step analysis process
5. **Chain-of-Thought**: Explicit reasoning for each classification
6. **Few-Shot Examples**: Multiple examples with detailed reasoning
7. **Self-Consistency Checks**: Built-in validation questions
8. **Screen Capture Detection**: Comprehensive visual context detection
9. **Required Fields**: Always includes suggestedResponse and sourceText
10. **JSON Format**: Structured output for easy parsing

This prompt structure ensures your local Phi3 LLM will have the same comprehensive context and reasoning framework as the backend system.

**User Message:** "{message}"

Respond ONLY with a strict JSON object:
{
  "intent": "...",
  "confidence": 0.0-1.0,
  "entities": ["..."],
  "reasoning": "...",
  "category": "..."
}
`.trim();
  },

  parseIntentResponse(response, method = 'llm', logger) {
    try {
      const data = typeof response === 'string' ? JSON.parse(response) : response;
      const { intent, confidence, entities, category } = data;
      return {
        intent: intent || 'unknown',
        confidence: parseFloat(confidence || 0),
        entities: Array.isArray(entities) ? entities : [],
        category: category || null,
        method
      };
    } catch (err) {
      if (logger) logger.warn(`⚠️ Invalid JSON from LLM: {response}`);
      return { intent: 'unknown', confidence: 0.3, entities: [], category: 'llm-error', method };
    }
  },

  detectIntentWithPatterns(message = '') {
    const lower = message.toLowerCase();

    if (/^(hi|hello|hey|yo|greetings)\b/.test(lower)) {
      return { intent: 'greeting', confidence: 0.9, method: 'pattern' };
    }
    if (/\b(what|how|why|where|when|who)\b/.test(lower)) {
      return { intent: 'question', confidence: 0.8, method: 'pattern' };
    }
    if (/\bremember|note|save|store\b/.test(lower)) {
      return { intent: 'memory_store', confidence: 0.85, method: 'pattern' };
    }
    if (/\bgo to|navigate|open\b/.test(lower)) {
      return { intent: 'navigation', confidence: 0.85, method: 'pattern' };
    }

    return { intent: 'unknown', confidence: 0.3, method: 'pattern' };
  },

  requiresScreenContext(intent) {
    return ['navigation', 'command'].includes(intent);
  },

  buildEnhancedIntentPrompt(message, userContext = {}) {
    const contextInfo = Object.keys(userContext).length > 0 
      ? `**User Context:**\n${Object.entries(userContext).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n\n`
      : '';
    
    return `You are ThinkDrop AI's intent classifier. Analyze the user's message and classify the intent.

${contextInfo}**Intent Types:**
- greeting: Hello, hi, good morning
- question: What, how, when, where, why questions
- command: Do something, perform action, execute task
- memory_store: Remember this, save information, my name is
- memory_retrieve: What's my name, recall information
- memory_update: Change my information, update details
- memory_delete: Forget this, delete information

**User Message:** "${message}"

Respond with JSON:
{
  "intent": "intent_name",
  "confidence": 0.9,
  "entities": ["extracted", "entities"],
  "category": "memory|action|query|social"
}`;
  },

  parseIntentResponse(response, method) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
        
      const result = JSON.parse(jsonMatch[0]);
      result.method = method;
        
      if (!this.isValidIntent(result.intent)) {
          result.intent = 'question';
          result.confidence = 0.5;
        }
        
      return result;
    } catch (error) {
      console.warn(`⚠️ Failed to parse LLM response: ${error.message}`);
      return { intent: 'question', confidence: 0.3, entities: [], method: method + '-error' };
    }
  },

  detectIntentWithPatterns(message = '') {
    const lower = message.toLowerCase();
    
    for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(lower)) {
          return {
            intent,
            confidence: 0.85,
            entities: this.extractEntities(message, intent),
            category: this.getIntentCategory(intent),
            method: 'enhanced-pattern'
          };
        }
      }
    }
    
    return { intent: 'question', confidence: 0.6, entities: [], category: 'general', method: 'fallback' };
  },

  initializeEnhancedPatterns() {
    return {
      greeting: [/^(hi|hello|hey|good morning)/i, /^(what's up|how are you)/i],
      memory_store: [/my name is/i, /remember that/i, /save this/i, /my .+ is/i],
      memory_retrieve: [/what('s| is) my/i, /do you remember/i, /what's my name/i],
      memory_update: [/update my/i, /change my/i, /my .+ is now/i],
      memory_delete: [/forget/i, /delete/i, /remove/i],
      command: [/give me a response/i, /help me respond/i, /draft a/i, /create a/i],
      question: [/^(what|how|when|where|why|who)/i, /\?$/, /can you/i, /explain/i]
    };
  },

  extractEntities(message, intent) {
    const entities = [];
    if (intent === 'memory_store') {
      const nameMatch = message.match(/my name is (\w+)/i);
      if (nameMatch) entities.push({ type: 'name', value: nameMatch[1] });
    }
    return entities;
  },

  getIntentCategory(intent) {
    const categories = {
      greeting: 'social', question: 'query', command: 'action',
      memory_store: 'memory', memory_retrieve: 'memory',
      memory_update: 'memory', memory_delete: 'memory'
    };
    return categories[intent] || 'general';
  },

  requiresScreenContext(intent) {
    return ['command'].includes(intent);
  },

  isValidIntent(intent) {
    const validIntents = ['greeting', 'question', 'command', 'memory_store', 'memory_retrieve', 'memory_update', 'memory_delete'];
    return validIntents.includes(intent);
  }
};
  
module.exports = AGENT_FORMAT;
