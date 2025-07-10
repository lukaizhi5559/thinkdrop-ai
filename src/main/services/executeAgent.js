/**
 * Agent Execution Service
 * Handles execution of agents with trusted bypass and sandbox security
 */

/**
 * Execute a specific agent by name using secure sandbox
 * Default trusted agents can bypass the sandbox for performance and reliability
 */
class ExecuteAgent {
    constructor() {
      this.backendApiClient = null;
    }

  async call(agentName, params, context = {}, localLLMAgent) {
    const startTime = Date.now();
    
    try {
      const agent = localLLMAgent.agentCache.get(agentName);
      if (!agent) {
        throw new Error(`Agent '${agentName}' not found in cache`);
      }
  
      // List of trusted default agents that can bypass the sandbox
      const trustedAgents = ['IntentParserAgent', 'PlannerAgent', 'UserMemoryAgent', 'MemoryEnrichmentAgent'];
      const bypassSandbox = trustedAgents.includes(agentName);
  
      if (bypassSandbox) {
        console.log(`🔑 Executing trusted agent directly (sandbox bypass): ${agentName}`);
      } else {
        console.log(`🔒 Executing agent in secure sandbox: ${agentName}`);
      }
  
      const agentContext = {
        ...context,
        agentName,
        timestamp: new Date().toISOString()
      };
      
      // Add llmClient adapter for trusted agents that need LLM access
      if ((agentName === 'IntentParserAgent' || agentName === 'PlannerAgent') && localLLMAgent.localLLMAvailable) {
        console.log(`🧠 Adding LLM client to ${agentName} context`);
        // Create an adapter that wraps queryLocalLLM for the agent to use
        agentContext.llmClient = {
          complete: async (options) => {
            try {
              const response = await localLLMAgent.queryLocalLLM(options.prompt, {
                temperature: options.temperature || 0.1,
                maxTokens: options.max_tokens || 500,
                stopTokens: options.stop || []
              });
              return { text: response };
            } catch (error) {
              console.error('❌ LLM client error:', error.message);
              throw error;
            }
          }
        };
      }
  
      let result;
      
      // Execute trusted agents directly, bypassing the sandbox
      if (bypassSandbox) {
        try {
          // For IntentParserAgent, use a hardcoded implementation
          if (agentName === 'IntentParserAgent') {
            console.log(`🔑 Using hardcoded implementation for ${agentName}`);
            result = await this.executeIntentParserAgent(params, agentContext);
          } else if (agentName === 'PlannerAgent') {
            console.log(`🔑 Using hardcoded implementation for ${agentName}`);
            result = await this.executePlannerAgent(params, agentContext);
          } else if (agentName === 'UserMemoryAgent') {
            console.log(`🔑 Using hardcoded implementation for ${agentName}`);
            result = await this.executeUserMemoryAgent(params, agentContext);
          } else if (agentName === 'MemoryEnrichmentAgent') {
            console.log(`🔑 Using hardcoded implementation for ${agentName}`);
            result = await this.executeMemoryEnrichmentAgent(params, agentContext);
          } else {
            // For other trusted agents, use Function constructor
            const moduleExports = {};
            const agentFunction = new Function('module', 'exports', 'params', 'context', agent.code);
            agentFunction(moduleExports, moduleExports, params, agentContext);
            result = await moduleExports.execute(params, agentContext);
            console.log(`✅ Trusted agent ${agentName} executed successfully (direct execution)`);
          }
        } catch (directError) {
          console.error(`❌ Direct execution failed for ${agentName}, falling back to sandbox:`, directError.message);
          // Fall back to sandbox if direct execution fails
          result = await localLLMAgent.agentSandbox.executeAgent(agent.code, agentName, params, agentContext);
        }
      } else {
        // Use sandbox for untrusted agents
        result = await localLLMAgent.agentSandbox.executeAgent(agent.code, agentName, params, agentContext);
      }
  
      if (!result || !result.success) {
        const errorMsg = result ? result.error : 'Unknown execution error';
        console.error(`❌ Execution failed for ${agentName}:`, errorMsg);
        
        // Emit step failure event
        if (localLLMAgent && localLLMAgent.emitOrchestrationUpdate) {
          await localLLMAgent.emitOrchestrationUpdate({
            type: 'step-failed',
            stepId: `${agentName}_${Date.now()}`,
            agent: agentName,
            error: errorMsg,
            timestamp: new Date().toISOString()
          });
        }
        
        return {
          success: false,
          error: errorMsg,
          agentName,
          executionTime: Date.now() - startTime
        };
      }
  
      const executionTime = Date.now() - startTime;
      console.log(`✅ Agent ${agentName} completed successfully in ${executionTime}ms`);
      
      // Emit step completion event
      if (localLLMAgent && localLLMAgent.emitOrchestrationUpdate) {
        await localLLMAgent.emitOrchestrationUpdate({
          type: 'step-completed',
          stepId: `${agentName}_${Date.now()}`,
          agent: agentName,
          result: result,
          executionTime,
          timestamp: new Date().toISOString()
        });
      }
      
      return {
        ...result,
        agentName,
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`❌ Agent execution error for ${agentName}:`, error);
      
      // Emit step failure event for exceptions
      if (localLLMAgent && localLLMAgent.emitOrchestrationUpdate) {
        await localLLMAgent.emitOrchestrationUpdate({
          type: 'step-failed',
          stepId: `${agentName}_${Date.now()}`,
          agent: agentName,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
      
      return {
        success: false,
        error: error.message,
        agentName,
        executionTime
      };
    }
  }

  /*
  * Fallback detection function with comprehensive intent support
  */
  detectIntent(msg) {
    const lowerMessage = msg.toLowerCase();
    let intent = 'question';
    let memoryCategory = null;
    let confidence = 0.7;
    
    // ✅ MEMORY INTENTS (Full CRUD)
    
    // Memory deletion patterns
    if(lowerMessage.match(/\b(remove|delete|forget|clear|erase)\b.*\b(my|name|memory|info|data)\b/i) ||
      lowerMessage.match(/\b(thinkdrop|ai)\b.*\b(forget|remove|delete)\b.*\b(my|name|info)\b/i)) {
      intent = 'memory_delete';
      memoryCategory = 'deletion';
      confidence = 0.9;
    }
    // Memory update patterns (explicit updates)
    else if(lowerMessage.match(/\b(update|change|set|modify)\b.*\b(my|mom|dad|mother|father|friend|contact)\b.*\b(name|number|phone|email|info)\b/i)) {
      intent = 'memory_update';
      memoryCategory = 'personal_info';
      confidence = 0.85;
    }
    // Memory storage patterns (new information)
    else if(lowerMessage.match(/my name (is|=) [\w\s]+/i)) {
      intent = 'memory_store';
      memoryCategory = 'personal_info';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(mom|dad|mother|father|friend|contact)\b.*\b(name|number|phone|email)\b.*\b(is|to|=)\b/i)) {
      intent = 'memory_store';
      memoryCategory = 'personal_info';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/my favorite|i like|i prefer|i love/i) && 
              lowerMessage.match(/color|food|movie|book|music|song/i)) {
      intent = 'memory_store';
      memoryCategory = 'preferences';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(i have|i've got|i got|my)\b.*\b(appointment|appt|meeting|class|session)\b/i) ||
            lowerMessage.match(/\b(appointment|appt|meeting|class|session)\b.*\b(at|on|next|this|tomorrow)\b/i) ||
            lowerMessage.match(/\b(scheduled|booked)\b.*\b(for|at|on)\b/i)) {
      intent = 'memory_store';
      memoryCategory = 'calendar';
      confidence = 0.85;
    }
    // Memory retrieval patterns
    else if(lowerMessage.match(/what.*my name|who am i/i)) {
      intent = 'memory_retrieve';
      memoryCategory = 'personal_info';
      confidence = 0.8;
    } 
    else if(lowerMessage.match(/what.*favorite|what.*like|what.*prefer/i)) {
      intent = 'memory_retrieve';
      memoryCategory = 'preferences';
      confidence = 0.8;
    } 
    else if(lowerMessage.match(/\b(what|show|list|tell)\b.*\b(do you know|remember|stored|saved)\b.*\b(about me|my)\b/i)) {
      intent = 'memory_retrieve';
      memoryCategory = 'general';
      confidence = 0.8;
    }
    
    // 🤖 AGENT-ORIENTED INTENTS
    
    else if(lowerMessage.match(/\b(run|execute|start|launch)\b.*\b(agent|drop)\b/i) ||
            lowerMessage.match(/\b(agent|drop)\b.*\b(run|execute|start|launch)\b/i)) {
      intent = 'agent_run';
      confidence = 0.85;
    }
    else if(lowerMessage.match(/\b(schedule|automate)\b.*\b(agent|drop)\b/i) ||
            lowerMessage.match(/\b(agent|drop)\b.*\b(schedule|every|daily|weekly)\b/i)) {
      intent = 'agent_schedule';
      confidence = 0.85;
    }
    else if(lowerMessage.match(/\b(update|modify|change)\b.*\b(agent|drop)\b.*\b(settings|config)\b/i)) {
      intent = 'agent_update';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(stop|pause|halt|disable)\b.*\b(agent|drop)\b/i)) {
      intent = 'agent_stop';
      confidence = 0.85;
    }
    else if(lowerMessage.match(/\b(create|generate|make|build)\b.*\b(agent|drop)\b/i) ||
            lowerMessage.match(/\b(agent|drop)\b.*\b(that|to|for)\b/i)) {
      intent = 'agent_generate';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(orchestrate|coordinate|workflow)\b/i) ||
            (lowerMessage.includes('and') && lowerMessage.split(' ').length > 10)) {
      intent = 'agent_orchestrate';
      confidence = 0.75;
    }
    else if(lowerMessage.match(/\b(what does|explain|describe)\b.*\b(agent|drop)\b/i)) {
      intent = 'agent_explain';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(debug|fix|troubleshoot)\b.*\b(agent|drop)\b/i) ||
            lowerMessage.match(/\b(agent|drop)\b.*\b(error|failed|broken)\b/i)) {
      intent = 'agent_debug';
      confidence = 0.85;
    }
    
    // 📅 TASK & PLANNING INTENTS
    
    else if(lowerMessage.match(/\b(create|add|new)\b.*\b(task|todo|goal|plan)\b/i)) {
      intent = 'task_create';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(update|modify|change)\b.*\b(task|todo|deadline)\b/i)) {
      intent = 'task_update';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(delete|remove|cancel)\b.*\b(task|todo)\b/i)) {
      intent = 'task_delete';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(what.*next|what.*planned|summarize.*tasks)\b/i) ||
            lowerMessage.match(/\b(show|list)\b.*\b(tasks|todos|plans)\b/i)) {
      intent = 'task_summarize';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(prioritize|reorder|organize)\b.*\b(tasks|todos)\b/i)) {
      intent = 'task_prioritize';
      confidence = 0.8;
    }
    
    // 🧠 CONTEXTUAL & SYSTEM INTENTS
    
    else if(lowerMessage.match(/\b(improve|update|enrich)\b.*\b(context|prompt|tone)\b/i)) {
      intent = 'context_enrich';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(what.*context|current.*settings|my.*preferences)\b/i)) {
      intent = 'context_retrieve';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(restart|reset|start over)\b.*\b(session|conversation)\b/i)) {
      intent = 'session_restart';
      confidence = 0.9;
    }
    else if(lowerMessage.match(/\b(feedback|review|rate)\b/i) && 
            lowerMessage.match(/\b(response|output|behavior)\b/i)) {
      intent = 'feedback_submit';
      confidence = 0.8;
    }
    
    // 📞 INTERACTION & COMMUNICATION INTENTS
    
    else if(lowerMessage.match(/\b(speak|say|read.*aloud|voice)\b/i)) {
      intent = 'speak';
      confidence = 0.85;
    }
    else if(lowerMessage.match(/\b(listen|voice.*command|speech)\b/i)) {
      intent = 'listen';
      confidence = 0.85;
    }
    else if(lowerMessage.match(/\b(compose|send|write)\b.*\b(email|text|message)\b/i)) {
      intent = 'compose_email';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(api|web|external|lookup|search)\b/i) ||
            lowerMessage.match(/\b(weather|news|stock|price)\b/i)) {
      intent = 'external_data_required';
      confidence = 0.75;
    }
    
    // 🕊️ SPIRITUAL/WELLNESS INTENTS
    
    else if(lowerMessage.match(/\b(daily.*reminder|spiritual.*check)\b/i)) {
      intent = 'daily_reminder';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(prayer|pray|intention)\b/i)) {
      intent = 'prayer_request';
      confidence = 0.85;
    }
    else if(lowerMessage.match(/\b(bible.*verse|scripture|verse)\b/i)) {
      intent = 'verse_lookup';
      confidence = 0.9;
    }
    else if(lowerMessage.match(/\b(devotion|spiritual.*practice|meditation)\b/i)) {
      intent = 'devotion_suggest';
      confidence = 0.8;
    }
    else if(lowerMessage.match(/\b(how.*feeling|mood|emotional.*check)\b/i)) {
      intent = 'mood_checkin';
      confidence = 0.8;
    } else {
      // Smart handling for calendar/appointment/travel related queries
      // Distinguish between informational vs actionable calendar/appointment requests
      const isInformationalAppointment = 
        lowerMessage.match(/\b(i have|i've got|my|there's)\b.*\b(appointment|appt|meeting)\b/i) ||
        lowerMessage.match(/\b(i'm going|i'll be|i need to go)\b.*\b(to|for)\b/i);
      
      const isActionableCalendar = 
        lowerMessage.match(/\b(schedule|book|create|set up|cancel|reschedule|check|find)\b.*\b(appointment|meeting|calendar)\b/i) ||
        lowerMessage.match(/\b(when is|what time is)\b.*\b(my|the)\b.*\b(appointment|meeting)\b/i);
      
      // Only classify as external_data_required for actionable requests
      if (isActionableCalendar) {
        intent = 'external_data_required';
        memoryCategory = lowerMessage.match(/flight|plane|airport|travel|trip/i) ? 'travel' : 'calendar';
        confidence = 0.8;
      }
      // For informational appointments, keep as 'question' for natural LLM response
    }
    
    // Generate rich backend-compatible structure
    const intentText = msg.trim();
    const summary = `User wants to ${intent.replace('_', ' ')} - ${memoryCategory || 'general request'}`;
    
    // Map intent to required agents
    const required_agents = [];
    if (intent.includes('memory')) {
      required_agents.push({
        type: 'memory_agent',
        reason: 'needed to handle memory storage, retrieval, or updates'
      });
    }
    if (intent === 'external_data_required') {
      required_agents.push({
        type: 'data_agent',
        reason: 'needed to fetch external data or interact with APIs'
      });
    }
    if (intent.includes('devotion') || intent.includes('verse') || intent.includes('prayer')) {
      required_agents.push({
        type: 'spiritual_agent',
        reason: 'needed to provide spiritual content and guidance'
      });
    }
    
    // Determine complexity and execution approach
    const complexity = required_agents.length > 1 ? 'medium' : 'simple';
    const execution_approach = required_agents.length > 1 ? 'multi_agent_sequence' : 'single_agent';
    
    return {
      success: true,
      intent: intentText,
      summary: summary,
      intent_type: intent,
      required_agents: required_agents,
      complexity: complexity,
      execution_approach: execution_approach,
      confidence: confidence,
      clarification_questions: [],
      // Legacy fields for backward compatibility
      category: memoryCategory || 'general',
      entities: [],
      requiresExternalData: intent === 'external_data_required'
    };
  }

  /**
   * Hardcoded implementation of IntentParserAgent for trusted bypass
   */
  async executeIntentParserAgent(params, agentContext) {
    try {
      // Direct implementation of IntentParserAgent
      // Handle both direct message string and params object
      const message = typeof params === 'string' ? params : params.message;
      const llmClient = agentContext?.llmClient;
      
      if (!message) {
        return {
          success: false,
          error: 'No message provided for intent parsing'
        };
      }
      
      try {
        const apiClientModule = await import('./apiClient.js');
        this.backendApiClient = apiClientModule.default;
      } catch (error) {
        console.warn('⚠️ Could not load backend API client:', error.message);
      }

      // Step 1: Try Local LLM first (fastest, always available)
      // console.log(' Step 1: Trying Local LLM for intent detection...');
//       if (llmClient && llmClient.complete) {
//           try {
//             // Enhanced prompt to match backend structure
//             const prompt = `Analyze the user's request and extract structured intent information. Return ONLY a JSON object with the specified fields.

// Here is an example:

// User request: "Remind me to call John about the project tomorrow at 10am"

// JSON response:
// \`\`\`json
// {
//   "intent": "Remind me to call John about the project tomorrow at 10am",
//   "summary": "Create a reminder to call John.",
//   "intent_type": "task_create",
//   "required_agents": [
//     {
//       "type": "CalendarAgent",
//       "reason": "The user wants to set a reminder, which requires calendar integration."
//     }
//   ],
//   "complexity": "simple",
//   "execution_approach": "single_agent",
//   "confidence": 0.95,
//   "clarification_questions": []
// }
// \`\`\`

// ---

// Now, analyze the following user request. Respond with only the JSON object in a markdown code block.

// User request: "${message}"

// JSON response:`;
//             console.log(' Local LLM LLMClient:', llmClient)
//             const llmResponse = await llmClient.complete(prompt, {
//               temperature: 0.1,
//               maxTokens: 200,
//               timeout: 8000
//             });
      
//             console.log(' Local LLM response:', llmResponse);
      
//             if (llmResponse && llmResponse.text.trim()) {
//               // Preprocess to extract JSON from markdown code blocks
//               let jsonText = llmResponse.text.trim();
//               if (jsonText.includes('```json')) {
//                 jsonText = jsonText.split('```json')[1].split('```')[0].trim();
//               } else if (jsonText.includes('```')) {
//                 jsonText = jsonText.split('```')[1].split('```')[0].trim();
//               } 
      
//               try {
//                 const parsed = JSON.parse(jsonText);
//                 if (parsed.intent && parsed.confidence > 0.6) {
//                   console.log(' Local LLM intent detection successful:', parsed);
//                   // Return backend-compatible structure
//                   return {
//                     success: true,
//                     intent: parsed.intent,
//                     summary: parsed.summary,
//                     intent_type: parsed.intent_type,
//                     required_agents: parsed.required_agents || [],
//                     complexity: parsed.complexity || 'simple',
//                     execution_approach: parsed.execution_approach || 'single_agent',
//                     confidence: parsed.confidence,
//                     clarification_questions: parsed.clarification_questions || [],
//                     // Legacy fields for backward compatibility
//                     category: parsed.intent_type,
//                     entities: {},
//                     requiresExternalData: parsed.complexity !== 'simple'
//                   };
//                 }
//               } catch (jsonError) {
//                 console.log(' Local LLM JSON parsing failed:', jsonError.message);
//               }
//             }
//           } catch (error) {
//             console.log(' Local LLM failed:', error.message);
//           }
//       } else {
//         console.log(' Local LLM not available, skipping to backend API');
//       }
  
      // Step 1: Try Backend API (more accurate, if available)
      if (this.backendApiClient) {
        try {
          console.log(' Step 1: Trying Backend API for intent detection...');
          const backendResult = await this.backendApiClient.parseIntent(message);
          
          if (backendResult.success && backendResult.confidence > 0.5) {
            console.log('✅ Backend API intent detection successful - using full rich structure:', backendResult);
            // Backend already provides the perfect structure - use it directly!
            return {
              ...backendResult,
              // Legacy fields for backward compatibility
              category: backendResult.intent_type || 'general',
              entities: {},
              requiresExternalData: backendResult.complexity !== 'simple'
            };
          }
        } catch (backendError) {
          console.warn('⚠️ Backend API intent detection failed:', backendError.message);
        }
      } else {
        console.log('🔍 Backend API client not available, skipping to hardcoded fallback');
      }
    
      // Step 3: Hardcoded fallback (guaranteed to work)
      console.log('🔍 Step 3: Using hardcoded fallback intent detection...');
      const fallbackResult = this.detectIntent(params.message || message);
      console.log('✅ Hardcoded fallback intent detection:', fallbackResult);
      return fallbackResult;
    } catch (error) {
      console.error('❌ IntentParserAgent execution error:', error);
      return {
        success: false,
        error: error.message || 'Unknown execution error',
        intent: 'question',
        category: 'general',
        confidence: 0.5,
        entities: [],
        requiresExternalData: false
      };
    }
  }

  /**
   * Analyze message complexity to determine appropriate prompt level
   */
  analyzeMessageComplexity(message) {
    const text = message.toLowerCase();
    const words = text.split(/\s+/).length;
    
    // Quick patterns for immediate classification
    const greetingPatterns = /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|bye|goodbye)$/i;
    const simpleQuestionPatterns = /^(what is|who is|where is|when is|how to|what|who|when|where|why|how)\s+.{1,15}\?$/i;
    const confirmationPatterns = /^(yes|no|ok|okay|sure|thanks|thank you)$/i;
    
    // Refined complexity indicators with reduced overlap
    const timePatterns = /(today|tomorrow|yesterday|next week|this week|\d{1,2}(am|pm)|\d{1,2}:\d{2}|this (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(mon|tue|wed|thu|fri|sat|sun))/i;
    const actionWords = /(book|schedule|send|create|make|remind|cancel|delete|update|cut|trim|visit|see)/i;
    const multiActionWords = /(and|then|also)/i; // Simplified for clarity
    const memoryWords = /(remember|my name is|i am|i like|i prefer|i hate|favorite)/i;
    const complexityWords = /(appointment|appt|meeting|flight|hotel|reservation|calendar|event|hair|doctor|dentist)/i; // Added common appointment types
    
    // Negation detection (reduces complexity for denial statements)
    const negationWords = /(don't|won't|can't|not|never|no)/i;
    const hasNegation = negationWords.test(text);
    
    // Punctuation complexity indicators
    const commaCount = (text.match(/,/g) || []).length;
    const questionMarks = (text.match(/\?/g) || []).length;
    
    let complexityScore = 0;
    
    // Immediate simple cases
    if (greetingPatterns.test(text)) return 'minimal';
    if (confirmationPatterns.test(text)) return 'minimal';
    if (simpleQuestionPatterns.test(text) && words < 8) return 'light';
    
    // Refined length-based scoring (more gradual)
    complexityScore += Math.min(Math.floor((words - 8) / 7), 2); // 0 for ≤8, 1 for 9-15, 2 for >15
    
    // Pattern-based scoring with weights
    if (timePatterns.test(text)) complexityScore += 1;
    if (actionWords.test(text)) complexityScore += hasNegation ? 0 : 1; // Negation reduces action complexity
    if (multiActionWords.test(text)) complexityScore += 2;
    if (memoryWords.test(text)) complexityScore += 1;
    if (complexityWords.test(text)) complexityScore += 2; // Increased weight for appointment/scheduling words
    
    // Special case: appointment/scheduling with time should be at least medium
    if (complexityWords.test(text) && timePatterns.test(text)) {
      complexityScore = Math.max(complexityScore, 2); // Ensure at least medium complexity
    }
    
    // Punctuation indicators
    complexityScore += Math.min(commaCount, 2); // Max +2 for commas
    if (questionMarks > 1) complexityScore += 1; // Multiple questions
    
    // Count conjunctions (indicates multiple intents)
    const conjunctions = (text.match(/\b(and|then|also)\b/g) || []).length;
    complexityScore += conjunctions;
    
    // Refined thresholds based on testing
    if (complexityScore <= 1) return 'light';
    if (complexityScore <= 3) return 'medium';
    if (complexityScore <= 5) return 'high';
    return 'complex';
  }

  /**
   * Quick Response Corpus - Immediate hardcoded responses for better UX
   * Used for medium/high/complex tasks while LLM processes in background
   */
  getQuickResponse(message, level) {
      // Only provide quick responses for medium+ complexity
      if (level === 'minimal' || level === 'light') {
        return null;
      }
    
      const quickResponses = {
        // --- Core Action Categories ---
    
        // Scheduling & Calendar Management
        scheduling: [
          "Alright, let's get that scheduled! Checking your calendar now.",
          "Got it! I'm setting up that meeting/appointment for you.",
          "On it! Coordinating the best time for your schedule.",
          "Perfect! I'll arrange that event in your calendar.",
          "Yes, I'm on it! Preparing the scheduling details.",
          "Consider it done! I'm handling your calendar request.",
          "Confirming your scheduling request. I'll get back to you shortly.",
          "Working on your schedule now. This will just take a moment.",
          "I'm securing that slot in your calendar.",
          "Great! Let me find the perfect time for that.",
          "Booking that for you. Stand by!",
          "I'm reviewing your availability for that request.",
          "Setting up your calendar entry. Almost there!",
          "Your scheduling task is underway.",
          "Finding the ideal time for your arrangement.",
          "Right away, I'm managing your appointment details.",
          "Processing your scheduling request now.",
          "Arranging the specifics for your calendar item.",
          "I'm ensuring that's added correctly to your schedule.",
          "Just a moment while I confirm those dates and times.",
          "Finding an opening for your new event.",
          "I'll make sure that's on your radar.",
          "Setting things up for you.",
          "Let me lock that in for you.",
          "Making sure your calendar is perfect.",
          "One moment while I check the details.",
          "Getting your schedule sorted.",
          "Looking at availabilities now.",
          "Finding the right time.",
          "Your schedule is my priority.",
          "I'm updating your calendar.",
          "Scheduling in progress.",
          "Booking your slot.",
          "Confirming details now.",
          "Arranging your event.",
          "Securing your appointment.",
          "Checking timeframes.",
          "Getting it on the books."
        ],
    
        // Multi-step Workflows & Complex Tasks
        workflow: [
          "Understood! I'll work through each step of that complex request.",
          "Got it! Breaking down your multi-step task now.",
          "On it! Orchestrating all the moving parts of your workflow.",
          "Perfect! Give me a minute to coordinate this intricate request.",
          "Yes, I'm on it! Processing your complex instructions.",
          "Consider it done! Navigating the multi-step process now.",
          "Confirming your multi-faceted request. I'll get back to you shortly.",
          "Working on your intricate task. This will just take a moment.",
          "I'm handling the various components of your request.",
          "Great! Let me put together that comprehensive plan.",
          "Executing your multi-stage request. Stand by!",
          "I'm analyzing and initiating your complex workflow.",
          "Building out the steps for your request. Almost there!",
          "Your multi-layered task is underway.",
          "Processing your detailed instructions now.",
          "Right away, I'm managing your workflow execution.",
          "Arranging the specifics for your complex query.",
          "I'm ensuring all parts of that request are handled correctly.",
          "Just a moment while I confirm the sequence of operations.",
          "Breaking your request into manageable actions.",
          "I'm connecting the dots for your multi-part request.",
          "Initiating the detailed process for you.",
          "Getting all the pieces in place.",
          "Working on your sequence of actions.",
          "Putting your plan into motion.",
          "Handling the intricacies now.",
          "Unpacking your request.",
          "Connecting the workflow elements.",
          "Processing all components.",
          "Executing the full plan.",
          "Breaking it down step-by-step.",
          "Building the solution.",
          "Managing the process flow.",
          "All systems go for your complex task."
        ],
    
        // Communication & Email Management
        communication: [
          "I'll handle that communication for you. Drafting it now.",
          "Got it! Let me compose and send those messages.",
          "On it! I'm reaching out to everyone involved.",
          "Perfect! I'll coordinate the necessary communications.",
          "Yes, I'm on it! Preparing your message.",
          "Consider it done! Managing your outreach now.",
          "Confirming your communication request. I'll get back to you shortly.",
          "Working on your messages. This will just take a moment.",
          "I'm drafting the perfect response for you.",
          "Great! Let me get that email/message out.",
          "Sending that for you. Stand by!",
          "I'm preparing to notify the relevant parties.",
          "Composing your communication. Almost there!",
          "Your message is underway.",
          "Formulating the communication details.",
          "Right away, I'm handling your outreach.",
          "Processing your communication request now.",
          "Arranging the specifics for your message.",
          "I'm ensuring that's sent correctly.",
          "Just a moment while I confirm the recipient details.",
          "Crafting your outgoing message.",
          "Getting your thoughts into words.",
          "Preparing your correspondence.",
          "Reaching out for you.",
          "Handling your email/message.",
          "Composing your reply.",
          "Sending it on its way.",
          "Getting your voice heard.",
          "Coordinating communications.",
          "Drafting and sending now."
        ],
    
        // Research & Data Retrieval/Analysis
        research: [
          "Let me research that for you right away. Gathering data now.",
          "I'll gather all the information you need. Searching sources.",
          "On it! Let me find the best options and details.",
          "Perfect! I'll compile the research data and insights.",
          "Yes, I'm on it! Digging for information.",
          "Consider it done! Performing your research query now.",
          "Confirming your research request. I'll get back to you shortly.",
          "Working on your data retrieval. This will just take a moment.",
          "I'm finding the relevant facts and figures for you.",
          "Great! Let me compile that report.",
          "Analyzing the data for you. Stand by!",
          "I'm exploring the best resources for your query.",
          "Compiling your findings. Almost there!",
          "Your research request is underway.",
          "Processing your information gathering now.",
          "Right away, I'm managing your data search.",
          "Arranging the specifics for your research task.",
          "I'm ensuring that's accurate and comprehensive.",
          "Just a moment while I cross-reference the data.",
          "Seeking out the answers to your questions.",
          "Diving into the information.",
          "Pulling the data for you.",
          "Getting the insights you need.",
          "Searching for answers now.",
          "Compiling the facts.",
          "Analyzing the details.",
          "Gathering knowledge.",
          "Finding the best sources.",
          "On the hunt for info.",
          "Building your knowledge base."
        ],
    
        // Planning & Organization (Non-Scheduling Specific)
        planning: [
          "Great idea! Let me create a comprehensive plan for that.",
          "I'll organize everything step by step. Structuring it now.",
          "On it! Let me structure this project properly for you.",
          "Perfect! I'll coordinate all the details for your plan.",
          "Yes, I'm on it! Building out the organizational framework.",
          "Consider it done! Mapping out your strategy now.",
          "Confirming your planning request. I'll get back to you shortly.",
          "Working on your organizational task. This will just take a moment.",
          "I'm putting together the perfect plan for you.",
          "Great! Let me outline the next steps.",
          "Planning that out for you. Stand by!",
          "I'm structuring the components of your request.",
          "Organizing your details. Almost there!",
          "Your planning task is underway.",
          "Processing your organizational request now.",
          "Right away, I'm managing your project outline.",
          "Arranging the specifics for your planning needs.",
          "I'm ensuring that's well-structured and logical.",
          "Just a moment while I consider all angles.",
          "Crafting the roadmap for your goal.",
          "Laying out the groundwork.",
          "Getting your project in order.",
          "Thinking through the strategy.",
          "Organizing the details.",
          "Building a solid plan.",
          "Mapping out the process.",
          "Structuring your thoughts.",
          "Creating your action plan.",
          "Setting things up systematically."
        ],
    
        // Technical & Setup / Configuration
        technical: [
          "I'll set that up for you right away. Initiating configuration.",
          "Got it! Let me configure everything properly and securely.",
          "On it! I'll handle the technical setup and deployment.",
          "Perfect! I'll get the infrastructure/system ready for you.",
          "Yes, I'm on it! Preparing the technical environment.",
          "Consider it done! Installing and setting up now.",
          "Confirming your technical request. I'll get back to you shortly.",
          "Working on your setup. This will just take a moment.",
          "I'm ensuring that's technically sound and robust.",
          "Great! Let me get that system optimized.",
          "Deploying that for you. Stand by!",
          "I'm running the necessary configurations.",
          "Getting your tech ready. Almost there!",
          "Your technical request is underway.",
          "Processing your setup instructions now.",
          "Right away, I'm managing your system build.",
          "Arranging the specifics for your technical needs.",
          "I'm ensuring that's installed and functioning correctly.",
          "Just a moment while I verify the system parameters.",
          "Bringing your technical vision to life.",
          "Setting up the backend.",
          "Configuring the system.",
          "Deploying the solution.",
          "Handling the technical side.",
          "Building out the framework.",
          "Making sure everything is connected.",
          "Getting the gears turning.",
          "Initiating the setup process.",
          "Ensuring smooth operation."
        ],
    
        // --- Generic / Fallback Categories ---
    
        // Acknowledgment & Processing
        acknowledgment: [
          "Got it! Giving that a quick look now.",
          "Understood! Processing your request.",
          "Alright, I'm on it!",
          "Received! Working on that for you.",
          "Okay, just a moment while I dive in.",
          "Right then, let's get this done.",
          "Affirmative. Your request is being handled.",
          "Copy that. I'm starting on it now.",
          "Loud and clear. Processing your input.",
          "Heard you. Getting to work.",
          "I've got it. One moment please.",
          "Acknowledged. Initiating analysis.",
          "Yes. Looking into that for you.",
          "Consider it noted. I'll be right back.",
          "All good. I'm on the case.",
          "Understood. Please hold.",
          "Processing...",
          "Just a moment.",
          "On it.",
          "Got it.",
          "Understood.",
          "Acknowledged.",
          "Received."
        ],
    
        // Assurance & "Getting Back to You"
        assurance: [
          "I'll get back to you with the details shortly.",
          "Please bear with me, I'm working through it.",
          "This will just take a moment, I'll be right back.",
          "I'm making sure everything is perfect before I respond.",
          "Almost there! Just finalizing a few things.",
          "Thank you for your patience, I'm on it.",
          "I'm ensuring accuracy for you.",
          "Compiling the best response now.",
          "Just making sure I've got all the pieces.",
          "I'll have an answer for you very soon.",
          "Working diligently on your request.",
          "Your patience is appreciated while I process this.",
          "I'm gathering all necessary information.",
          "Hold tight, I'm almost ready.",
          "I'm confirming the details.",
          "Just wrapping up.",
          "Bear with me.",
          "Almost ready.",
          "One moment.",
          "Soon.",
          "Stand by."
        ],
    
        // Positive & Encouraging
        positive: [
          "Great! I'll handle this right away for you.",
          "Perfect! I'm on it.",
          "Excellent! Let me get that sorted.",
          "Fantastic! I'll take care of it.",
          "Good stuff! Processing now.",
          "Awesome! I'm on the case.",
          "No problem! Getting started immediately.",
          "Sounds good! Working on it now.",
          "Wonderful! I'm on your request.",
          "Certainly! I'll manage that for you.",
          "You got it! Processing now.",
          "Happy to help! Looking into it.",
          "Gladly! Getting that done.",
          "Consider it done!",
          "Absolutely!",
          "My pleasure!",
          "No sweat!",
          "You bet!"
        ],
    
        // Complex / Default Fallback
        generic: [
          "Got it! Give me a moment to process this.",
          "On it! Let me work through this for you.",
          "Perfect! I'll handle this right away.",
          "Understood! Let me take care of this for you.",
          "I'm on it! Processing your request now.",
          "Great! Let me coordinate everything for you.",
          "Taking that on now. Please stand by.",
          "Initiating the process for your request.",
          "Processing your instructions. This might take a moment.",
          "I've received your request and am beginning analysis.",
          "Starting on that now. I'll notify you when complete.",
          "Your request has been received. I'm on the job.",
          "Acknowledged. Breaking down your request for action.",
          "Working on it. I appreciate your patience.",
          "Analyzing your request to provide the best response.",
          "Diving into your request now.",
          "Just getting things organized for your query.",
          "Processing your input and preparing a response.",
          "Taking care of that right now.",
          "I'm on your case.",
          "Working on your request.",
          "Figuring it out now.",
          "Processing."
        ]
      };
    
      // Pattern matching for response category
      const lowerMessage = message.toLowerCase();
    
      let category = 'generic'; // Default fallback
    
      // Prioritize more specific matches
      if (lowerMessage.includes('schedule') || lowerMessage.includes('meeting') || lowerMessage.includes('calendar') || lowerMessage.includes('appointment') || lowerMessage.includes('book') || lowerMessage.includes('reschedule') || lowerMessage.includes('event')) {
        category = 'scheduling';
      } else if (lowerMessage.includes('email') || lowerMessage.includes('message') || lowerMessage.includes('contact') || lowerMessage.includes('notify') || lowerMessage.includes('send') || lowerMessage.includes('write')) {
        category = 'communication';
      } else if (lowerMessage.includes('research') || lowerMessage.includes('find') || lowerMessage.includes('search') || lowerMessage.includes('compare') || lowerMessage.includes('look up') || lowerMessage.includes('analyze') || lowerMessage.includes('data')) {
        category = 'research';
      } else if (lowerMessage.includes('plan') || lowerMessage.includes('organize') || lowerMessage.includes('create') || lowerMessage.includes('set up') || lowerMessage.includes('design') || lowerMessage.includes('structure') || lowerMessage.includes('manage')) {
        category = 'planning';
      } else if (lowerMessage.includes('install') || lowerMessage.includes('configure') || lowerMessage.includes('deploy') || lowerMessage.includes('build') || lowerMessage.includes('troubleshoot') || lowerMessage.includes('fix') || lowerMessage.includes('technical')) {
        category = 'technical';
      }
      // Generic workflow catch for longer or compound sentences (often indicates multi-step)
      else if (lowerMessage.split(' ').length > 10 || lowerMessage.includes(' and ') || lowerMessage.includes(', ') || lowerMessage.includes(' then ') || lowerMessage.includes(' after that ')) {
        category = 'workflow';
      } else {
        // If no specific category, fall back to general acknowledgment or processing
        category = 'acknowledgment'; // A more specific generic than 'generic' for general complex queries
      }
    
      // If the category is generic, select from a wider pool of generic responses including acknowledgment, assurance, positive, and the general generic.
      if (category === 'acknowledgment' || category === 'generic') {
        const combinedGenericResponses = [
          ...quickResponses.acknowledgment,
          ...quickResponses.assurance,
          ...quickResponses.positive,
          ...quickResponses.generic
        ];
        return combinedGenericResponses[Math.floor(Math.random() * combinedGenericResponses.length)];
      }
    
      const responses = quickResponses[category];
      return responses[Math.floor(Math.random() * responses.length)];
  }

    /**
   * Generate appropriate prompt based on complexity level
   */
  generateLeveledPrompt(message, level) {
    const baseInstruction = 'Analyze the user message and return JSON only. Do not include any other text, explanation, or conversation. IMPORTANT: If the message contains multiple distinct pieces of information that should be stored separately (like name AND phone number, or color AND address), use multiIntent: true with multiple memory_store intents.';
    const returnFormat = 'Return: {"multiIntent": false, "primaryIntent": "intent_name"} OR {"multiIntent": true, "intents": ["intent1", "intent2"]}';
    
    const intents = {
      minimal: 'question, greeting, communication_completion',
      light: 'question, memory_store, memory_retrieve, speak, listen, communication_completion',
      medium: 'question, command, memory_store, memory_retrieve, memory_update, memory_delete, external_data_required, devotion_suggest, verse_lookup, prayer_request, mood_checkin, communication_completion',
      high: 'question, command, memory_store, memory_retrieve, memory_update, memory_delete, agent_run, agent_schedule, task_create, task_update, task_summarize, external_data_required, context_enrich, devotion_suggest, verse_lookup, prayer_request, mood_checkin, speak, listen, communication_completion',
      complex: 'question, command, memory_store, memory_retrieve, memory_update, memory_delete, agent_run, agent_schedule, agent_stop, agent_generate, agent_orchestrate, task_create, task_update, task_delete, task_summarize, task_prioritize, context_enrich, context_retrieve, external_data_required, feedback_submit, session_restart, devotion_suggest, verse_lookup, prayer_request, mood_checkin, speak, listen, communication_completion'
    };
    
    switch (level) {
      case 'minimal':
        return `${baseInstruction} ${returnFormat} Intents: ${intents.minimal} Example: "Hello" → {"multiIntent": false, "primaryIntent": "greeting"} User: ${message}`;
        
      case 'light':
        return `${baseInstruction} ${returnFormat} Intents: ${intents.light} Examples: "Sent my wife a text" → {"multiIntent": false, "primaryIntent": "communication_completion"} | "My name is John" → {"multiIntent": false, "primaryIntent": "memory_store"} | "Called mom today" → {"multiIntent": false, "primaryIntent": "communication_completion"} | "Remember my birthday is May 15th" → {"multiIntent": false, "primaryIntent": "memory_store"} User: ${message}`;
        
      case 'medium':
        return `${baseInstruction} ${returnFormat} Intents: ${intents.medium} Examples: "My mom's name is Sarah and her phone is 555-1234" → {"multiIntent": true, "intents": ["memory_store", "memory_store"]} | "Sent my wife a text saying love you" → {"multiIntent": false, "primaryIntent": "communication_completion"} | "What's the weather?" → {"multiIntent": false, "primaryIntent": "external_data_required"} | "Remember my birthday is May 15th" → {"multiIntent": false, "primaryIntent": "memory_store"} | "Called the doctor yesterday" → {"multiIntent": false, "primaryIntent": "communication_completion"} User: ${message}`;
        
      case 'high':
        return `${baseInstruction} ${returnFormat} Intents: ${intents.high} Examples: "Meeting tomorrow and remind me" → {"multiIntent": true, "intents": ["memory_store", "external_data_required", "command"]} | "Book flight and check my calendar" → {"multiIntent": true, "intents": ["command", "external_data_required"]} | "What time is my dentist appointment?" → {"multiIntent": false, "primaryIntent": "external_data_required"} User: ${message}`;
        
      case 'complex':
        return `${baseInstruction} ${returnFormat} Intents: ${intents.complex} Examples: "Schedule client meeting tomorrow, check calendar conflicts, email all attendees, and set reminder" → {"multiIntent": true, "intents": ["memory_store", "external_data_required", "command", "orchestration"]} | "Plan vacation: research destinations, book flights, reserve hotels, create itinerary" → {"multiIntent": true, "intents": ["external_data_required", "command", "multi_command", "orchestration"]} | "Set up project: create repo, invite team, schedule kickoff, and track progress" → {"multiIntent": true, "intents": ["command", "multi_command", "orchestration"]} User: ${message}`;
        
      default:
        return this.generateLeveledPrompt(message, 'medium');
    }
  }
  
  /**
   * Hardcoded implementation of PlannerAgent for trusted bypass
   */
  async executePlannerAgent(params, agentContext) {
    // Direct implementation of PlannerAgent
    const message = params.message;
    const llmClient = agentContext?.llmClient;
    
    if (!llmClient) {
      console.log('PlannerAgent: LLM client not available');
      return {
        success: false,
        error: 'LLM client required for orchestration planning'
      };
    }
  
    try {
      // Analyze message complexity to determine appropriate prompt level
      const complexityLevel = this.analyzeMessageComplexity(message);
      const prompt = this.generateLeveledPrompt(message, complexityLevel);
      
      console.log(`🎯 Using ${complexityLevel} complexity prompt for: "${message.substring(0, 50)}..."`);
      
      // Get immediate quick response for medium+ complexity
      const quickResponse = this.getQuickResponse(message, complexityLevel);
      if (quickResponse) {
        console.log(`⚡ Providing quick response: "${quickResponse}"`);
        // Return immediate response while processing continues in background
        // Note: In production, this would trigger a background process
        // For now, we'll include it in the response metadata
      }
      
      // Dynamic parameters based on complexity level
      const getParametersForLevel = (level) => {
        switch (level) {
          case 'minimal':
            return { max_tokens: 100, timeout: 5000 }; // 5 seconds
          case 'light':
            return { max_tokens: 200, timeout: 10000 }; // 10 seconds
          case 'medium':
            return { max_tokens: 300, timeout: 15000 }; // 15 seconds
          case 'high':
            return { max_tokens: 400, timeout: 25000 }; // 25 seconds
          case 'complex':
            return { max_tokens: 500, timeout: 35000 }; // 35 seconds
          default:
            return { max_tokens: 300, timeout: 15000 };
        }
      };
      
      const params = getParametersForLevel(complexityLevel);
      
      const llmResult = await llmClient.complete({
        prompt,
        max_tokens: params.max_tokens,
        temperature: 0.2,
        stop: ["\n\n"],
        timeout: params.timeout
      });
      
      try {
        // Preprocess to remove markdown formatting (similar to IntentParserAgent)
        let jsonText = llmResult.text.trim();
        
        // Remove markdown code blocks
        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        
        console.log('🔍 Raw PlannerAgent response:', llmResult.text);
        console.log('🔍 Preprocessed JSON text:', jsonText);
        
        // Handle empty or truncated responses
        if (!jsonText || jsonText.trim() === '') {
          console.warn('⚠️ Empty JSON response from PlannerAgent, using fallback');
          return {
            success: true,
            multiIntent: false,
            primaryIntent: 'question',
            quickResponse: 'Let me help you with that.',
            immediateResponse: true
          };
        }
        
        let parsedResult;
        try {
          parsedResult = JSON.parse(jsonText);
        } catch (parseError) {
          console.warn('⚠️ Failed to parse PlannerAgent JSON, using fallback:', parseError.message);
          return {
            success: true,
            multiIntent: false,
            primaryIntent: 'question',
            quickResponse: 'I understand. Let me process that for you.',
            immediateResponse: true
          };
        }
        console.log('PlannerAgent orchestration result:', parsedResult);
        
        if (parsedResult.multiIntent) {
          // For multi-intent scenarios, create a flexible orchestration plan
          let orchestrationPlan = [];
          
          // Use the LLM-provided plan if available, otherwise create a generic mapping
          if (parsedResult.orchestrationPlan && Array.isArray(parsedResult.orchestrationPlan)) {
            orchestrationPlan = parsedResult.orchestrationPlan;
          } else {
            // Create orchestration plan based on detected intents
            const createOrchestrationPlan = (intents) => {
              return intents.map((intent, index) => {
                let agent, action, parallel = false;
                
                switch (intent) {
                  case 'memory_store':
                    agent = 'UserMemoryAgent';
                    action = 'store';
                    break;
                  case 'memory_retrieve':
                    agent = 'UserMemoryAgent';
                    action = 'retrieve';
                    break;
                  case 'external_data_required':
                    agent = 'BackendLLMAgent';
                    action = 'llm_query';
                    break;
                  case 'command':
                    agent = 'BackendOrchestrationAgent';
                    action = 'orchestrate_command';
                    break;
                  case 'multi_command':
                    agent = 'BackendOrchestrationAgent';
                    action = 'orchestrate_command';
                    parallel = true; // Multi-commands can be parallelized
                    break;
                  case 'greeting':
                    agent = 'LocalLLMAgent';
                    action = 'handle_greeting';
                    break;
                  case 'question':
                    agent = 'LocalLLMAgent';
                    action = 'answer_question';
                    break;
                  case 'orchestration':
                    agent = 'BackendOrchestrationAgent';
                    action = 'orchestrate_workflow';
                    parallel = true; // Orchestration can handle parallel execution
                    break;
                  default:
                    // Better fallback: route unknown intents based on message complexity
                    if (complexityLevel === 'minimal' || complexityLevel === 'light') {
                      agent = 'LocalLLMAgent';
                      action = 'handle_single_intent';
                    } else {
                      agent = 'BackendLLMAgent';
                      action = 'llm_query';
                    }
                    break;
                }
                
                return {
                  step: index + 1,
                  agent,
                  action,
                  data: { intent, message },
                  parallel
                };
              });
            };
            orchestrationPlan = createOrchestrationPlan(parsedResult.intents);
          }
          
          return {
            success: true,
            multiIntent: true,
            intents: parsedResult.intents,
            orchestrationPlan,
            totalSteps: orchestrationPlan.length,
            quickResponse: quickResponse || null,
            immediateResponse: !!quickResponse
          };
        } else {
          return {
            success: true,
            multiIntent: false,
            primaryIntent: parsedResult.primaryIntent,
            orchestrationPlan: [{
              step: 1,
              agent: 'LocalLLMAgent',
              action: 'handle_single_intent',
              data: { intent: parsedResult.primaryIntent },
              parallel: false
            }],
            totalSteps: 1,
            quickResponse: quickResponse || null,
            immediateResponse: !!quickResponse
          };
        }
      } catch (parseError) {
        console.error('Failed to parse PlannerAgent result:', parseError);
        return {
          success: true,
          multiIntent: false,
          primaryIntent: 'question',
          orchestrationPlan: [{
            step: 1,
            agent: 'LocalLLMAgent',
            action: 'handle_single_intent',
            data: { intent: 'question' },
            parallel: false
          }],
          totalSteps: 1,
          quickResponse: quickResponse || null,
          immediateResponse: !!quickResponse
        };
      }
    } catch (error) {
      console.error('Error in PlannerAgent:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Hardcoded implementation of UserMemoryAgent for trusted bypass
   */
  async executeUserMemoryAgent(params, agentContext) {
    console.log('🧠 Executing UserMemoryAgent with params:', params);
    
    const { action, key, value, query } = params;
    const dbConnection = agentContext.dbConnection;
    
    if (!dbConnection) {
      return {
        success: false,
        error: 'Database connection not available'
      };
    }
    
    try {
      switch (action) {
        case 'store':
          console.log(`💾 Storing memory: ${key} = ${value}`);
          return new Promise((resolve, reject) => {
            const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            const timestamp = new Date().toISOString();
            
            try {
              const stmt = dbConnection.prepare(
                "INSERT OR REPLACE INTO user_memories (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)"
              );
              
              // DuckDB doesn't use callbacks like SQLite
              stmt.run(key, valueStr, timestamp, timestamp);
              console.log('✅ Memory stored successfully');
              resolve({
                success: true,
                action: 'store_memory',
                key,
                value,
                  timestamp
              });
            } catch (error) {
              console.error('❌ Memory store failed:', error);
              reject({ success: false, error: error.message });
            }
          });

        case 'retrieve':
          console.log(`🔍 Retrieving memory for key: ${key}`);
          return new Promise((resolve, reject) => {
            try {
              const sql = key === '*' 
                ? 'SELECT key, value FROM user_memories ORDER BY updated_at DESC'
                : 'SELECT key, value FROM user_memories WHERE key = ?';
              const params = key === '*' ? [] : [key];
              
              // DuckDB uses direct return instead of callbacks
              const result = dbConnection.all(sql, params);
              const rows = Array.isArray(result) ? result : [];
              
              const memories = {};
              rows.forEach(row => {
                try {
                  memories[row.key] = JSON.parse(row.value);
                } catch (parseError) {
                  memories[row.key] = row.value;
                }
              });
              console.log(`✅ Retrieved ${rows.length} memories`);
              resolve({
                success: true,
                action: 'retrieve_memory',
                key,
                memories
              });
            } catch (error) {
              console.error('❌ Memory retrieve failed:', error);
              reject({ success: false, error: error.message });
            }
          });
       
          
        case 'search':
          console.log(`🔍 Searching memories for: ${query}`);
          return new Promise((resolve, reject) => {
            const searchTerm = `%${query}%`;
            const sql = 'SELECT key, value FROM user_memories WHERE key LIKE ? OR value LIKE ?';
            
            dbConnection.all(sql, [searchTerm, searchTerm], (err, rows) => {
              if (err) {
                console.error('❌ Memory search failed:', err);
                reject({ success: false, error: err.message });
              } else {
                const results = rows.map(row => {
                  try {
                    return {
                      key: row.key,
                      value: JSON.parse(row.value)
                    };
                  } catch (parseError) {
                    return {
                      key: row.key,
                      value: row.value
                    };
                  }
                });
                console.log(`✅ Found ${results.length} matching memories`);
                resolve({
                  success: true,
                  action: 'search_memory',
                  query,
                  results
                });
              }
            });
          });
          
        case 'delete':
          console.log(` Deleting memory for key: ${key}`);
          return new Promise((resolve, reject) => {
            const stmt = dbConnection.prepare('DELETE FROM user_memories WHERE key = ?');
            try {
              stmt.run(key);
              console.log(`✅ Deleted memory for key: ${key}`);
              resolve({
                success: true,
                action: 'delete_memory',
                key
              });
            } catch (error) {
              console.error('❌ Memory delete failed:', error);
              reject({ success: false, error: error.message });
            }
          });
          
        case 'update':
          console.log(`📝 Updating memory: ${key} = ${value}`);
          return new Promise((resolve, reject) => {
            const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            const timestamp = new Date().toISOString();
            
            const stmt = dbConnection.prepare(
              "UPDATE user_memories SET value = ?, updated_at = ? WHERE key = ?"
            );
            try {
              stmt.run(valueStr, timestamp, key);
              console.log(`✅ Updated memory for key: ${key}`);
              resolve({
                success: true,
                action: 'update_memory',
                key,
                value,
                updated: this.changes > 0
              });
            } catch (error) {
              console.error('❌ Memory update failed:', error);
              reject({ success: false, error: error.message });
            }
          });
          
        case 'list':
          console.log('📋 Listing all memory keys');
          return new Promise((resolve, reject) => {
            const sql = 'SELECT key, updated_at FROM user_memories ORDER BY updated_at DESC';
            
            dbConnection.all(sql, [], (err, rows) => {
              if (err) {
                console.error('❌ Memory list failed:', err);
                reject({ success: false, error: err.message });
              } else {
                const keys = rows.map(row => ({
                  key: row.key,
                  updated_at: row.updated_at
                }));
                console.log(`✅ Listed ${keys.length} memory keys`);
                resolve({
                  success: true,
                  action: 'list_memory',
                  keys,
                  count: keys.length
                });
              }
            });
          });
          
        case 'clear':
          console.log('🧹 Clearing all memories');
          return new Promise((resolve, reject) => {
            const stmt = dbConnection.prepare('DELETE FROM user_memories');
            try {
              stmt.run();
              console.log('✅ All memories cleared successfully');
              resolve({
                success: true,
                action: 'clear_memory'
              });
            } catch (error) {
              console.error('❌ Memory clear failed:', err);
              reject({ success: false, error: err.message });
            }
          });
          
        case 'count':
          console.log('🔢 Counting memories');
          return new Promise((resolve, reject) => {
            const stmt = dbConnection.prepare('SELECT COUNT(*) as count FROM user_memories');
            try {
              stmt.get();
              console.log(`✅ Memory count: ${row.count}`);
              resolve({
                success: true,
                action: 'count_memory',
                count: row.count
              });
            } catch (error) {
              console.error('❌ Memory count failed:', err);
              reject({ success: false, error: err.message });
            }
          });
          
        default:
          return {
            success: false,
            error: `Unknown memory action: ${action}. Supported: store, retrieve, search, delete, update, list, clear, count`
          };
      }
    } catch (error) {
      console.error('❌ UserMemoryAgent execution error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Hardcoded implementation of MemoryEnrichmentAgent for trusted bypass
   */
  async executeMemoryEnrichmentAgent(params, agentContext) {
    console.log('🎯 Executing MemoryEnrichmentAgent with params:', params);
    
    const { prompt, userMemories } = params;
    
    if (!prompt) {
      return {
        success: false,
        error: 'No prompt provided for enrichment'
      };
    }
    
    try {
      let enrichedPrompt = prompt;
      
      // Add user context if memories are available
      if (userMemories && Object.keys(userMemories).length > 0) {
        const contextSections = [];
        
        // Add user personal context
        const userContext = [];
        if (userMemories.name) userContext.push(`Name: ${userMemories.name}`);
        if (userMemories.location) userContext.push(`Location: ${userMemories.location}`);
        if (userMemories.preferences) userContext.push(`Preferences: ${userMemories.preferences}`);
        if (userMemories.role) userContext.push(`Role: ${userMemories.role}`);
        
        if (userContext.length > 0) {
          contextSections.push(`[User Context: ${userContext.join(', ')}]`);
        }
        
        // Add recent memories context
        const recentMemories = Object.entries(userMemories)
          .filter(([key]) => !['name', 'location', 'preferences', 'role'].includes(key))
          .slice(0, 3)
          .map(([key, value]) => `${key}: ${value}`);
        
        if (recentMemories.length > 0) {
          contextSections.push(`[Recent Context: ${recentMemories.join(', ')}]`);
        }
        
        // Prepend context to prompt
        if (contextSections.length > 0) {
          enrichedPrompt = `${contextSections.join('\n')}\n\n${prompt}`;
        }
      }
      
      console.log('✅ Prompt enriched with user context');
      return {
        success: true,
        enrichedPrompt,
        contextAdded: userMemories ? Object.keys(userMemories).length : 0
      };
    } catch (error) {
      console.error('❌ MemoryEnrichmentAgent execution error:', error);
      return {
        success: false,
        error: error.message,
        enrichedPrompt: prompt // Fallback to original prompt
      };
    }
  }

}

export default ExecuteAgent;

  
  

  

  


