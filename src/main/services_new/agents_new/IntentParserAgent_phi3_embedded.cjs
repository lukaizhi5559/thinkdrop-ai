'use strict';

const AGENT_FORMAT = {
    name: 'IntentParserAgent_phi3_embedded',
    description: 'Enhanced intent parsing with embedded Phi3 LLM fallback',
    version: '2.0.0',
    _bootstrapped: false,
    enhancedPatterns: null,

    async bootstrap(context = {}) {
        if (AGENT_FORMAT._bootstrapped) {
            console.log('🔄 IntentParserAgent_phi3_embedded already bootstrapped, skipping...');
            return { success: true, message: 'Already bootstrapped' };
        }

        try {
            console.log('🚀 Bootstrapping IntentParserAgent_phi3_embedded...');
            
            // Initialize enhanced pattern matching
            AGENT_FORMAT.initializeEnhancedPatterns();
            
            AGENT_FORMAT._bootstrapped = true;
            console.log('✅ IntentParserAgent_phi3_embedded bootstrapped successfully');
            
            return { success: true, message: 'IntentParserAgent_phi3_embedded bootstrapped successfully' };
        } catch (error) {
            console.error('❌ IntentParserAgent_phi3_embedded bootstrap failed:', error);
            return { success: false, error: error.message };
        }
    },

    async execute(params = {}, context = {}) {
        try {
            const { action, message } = params;
            console.log(`🎯 IntentParserAgent_phi3_embedded executing action: ${action}`);

            switch (action) {
                case 'parse-intent-enhanced':
                    return await AGENT_FORMAT.parseIntentEnhanced(message, context);
                default:
                    return { success: false, error: `Unknown action: ${action}` };
            }
        } catch (error) {
            console.error('❌ IntentParserAgent_phi3_embedded execution failed:', error);
            return { success: false, error: error.message };
        }
    },

    async parseIntentEnhanced(message, context = {}) {
        try {
            console.log('🔍 Enhanced intent parsing started for:', message);

            // First classify the prompt complexity
            const promptClassification = AGENT_FORMAT.classifyPrompt(message);
            console.log('📊 Prompt classification:', promptClassification);

            // First check if Phi3 is available
            const phi3Available = await AGENT_FORMAT.checkPhi3Availability(context);
            console.log('🤖 Phi3 availability:', phi3Available);

            if (phi3Available) {
                // Use Phi3 for intent parsing with classified prompt level
                const phi3Result = await AGENT_FORMAT.parseWithPhi3(message, context, promptClassification);
                if (phi3Result.success) {
                    console.log('✅ Phi3 intent parsing successful');
                    return phi3Result;
                }
                console.log('⚠️ Phi3 intent parsing failed, falling back to patterns');
            }

            // Fallback to enhanced pattern matching
            console.log('🔄 Using enhanced pattern matching fallback');
            const patternResult = AGENT_FORMAT.parseWithPatterns(message);
            return {
                success: true,
                result: {
                    intent: patternResult.intent,
                    confidence: patternResult.confidence,
                    entities: patternResult.entities || [],
                    category: patternResult.category || 'general',
                    requiresContext: patternResult.requiresContext || false,
                    method: 'pattern_matching'
                }
            };
        } catch (error) {
            console.error('❌ Enhanced intent parsing failed:', error);
            return { success: false, error: error.message };
        }
    },

    async checkPhi3Availability(context = {}) {
        try {
            if (!context.executeAgent) {
                console.log('⚠️ No executeAgent function available');
                return false;
            }

            // Use Phi3Agent's cached availability status without making API calls
            const availabilityCheck = await context.executeAgent('Phi3Agent', {
                action: 'check-availability'
            }, context);

            return availabilityCheck.success && availabilityCheck.result && availabilityCheck.result.available;
        } catch (error) {
            console.error('❌ Error checking Phi3 availability:', error);
            return false;
        }
    },

    classifyPrompt(message) {
        const words = message.trim().split(/\s+/);
        const length = words.length;
        const questionCount = (message.match(/[?]/g) || []).length + 
                             (message.match(/\b(what|how|why|when|where|who|which)\b/gi) || []).length;
        
        // Count action verbs and instructional keywords
        const actionKeywords = /\b(create|make|generate|write|build|help|show|explain|tell|describe|analyze|summarize|extract|convert|send|save|capture|take|screenshot|do|perform|execute|run|start|stop|open|close)\b/gi;
        const keywordDensity = (message.match(actionKeywords) || []).length;
        
        // Count technical terms (simplified detection)
        const technicalTerms = (message.match(/\b(API|JSON|HTTP|URL|database|server|client|function|method|class|object|array|variable|parameter|algorithm|framework|library|SDK|REST|GraphQL|SQL|NoSQL)\b/gi) || []).length;
        
        // Count context references
        const contextReferences = (message.match(/\b(this|that|above|below|earlier|previously|before|after|here|there)\b/gi) || []).length;
        
        // Determine fuzziness based on vague language
        const vagueTerms = (message.match(/\b(something|anything|stuff|things|maybe|perhaps|possibly|kind of|sort of|somehow|whatever)\b/gi) || []).length;
        const fuzziness = vagueTerms > 2 ? 'high' : vagueTerms > 0 ? 'medium' : 'low';
        
        // Determine context dependency
        const contextDependency = contextReferences > 2 ? 'strong' : contextReferences > 0 ? 'some' : 'none';
        
        // Determine technicality
        const technicality = technicalTerms > 3 ? 'high' : technicalTerms > 0 ? 'some' : 'none';
        
        // Determine instructional clarity
        const instructionalClarity = keywordDensity > 2 ? 'clear' : keywordDensity > 0 ? 'some' : 'none';
        
        // Determine complexity (multiple sentences, conjunctions, etc.)
        const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
        const conjunctions = (message.match(/\b(and|but|or|however|therefore|because|since|while|although|unless|if|when|where)\b/gi) || []).length;
        const complexity = (sentences > 2 || conjunctions > 2) ? 'layered' : 'flat';
        
        // Calculate overall score (0-100)
        let score = 0;
        score += Math.min(length * 2, 30); // Length contribution (max 30)
        score += questionCount * 5; // Question complexity
        score += keywordDensity * 3; // Instruction complexity
        score += technicalTerms * 4; // Technical complexity
        score += contextReferences * 3; // Context dependency
        score += vagueTerms * 2; // Fuzziness penalty
        score += (complexity === 'layered') ? 15 : 0; // Structural complexity
        
        // Determine prompt level based on score
        let level;
        if (score <= 15) level = 'minimal';
        else if (score <= 35) level = 'light';
        else if (score <= 60) level = 'medium';
        else if (score <= 85) level = 'high';
        else level = 'complex';
        
        return {
            level,
            score: Math.min(score, 100),
            categories: {
                fuzziness,
                contextDependency,
                technicality,
                instructionalClarity,
                complexity
            },
            factors: {
                length,
                questionCount,
                keywordDensity,
                technicalTerms,
                contextReferences
            }
        };
    },

    async parseWithPhi3(message, context = {}, promptClassification = null) {
        try {
            if (!context.executeAgent) {
                return { success: false, error: 'No executeAgent function available' };
            }

            const prompt = AGENT_FORMAT.buildIntentPrompt(message, promptClassification);
            console.log(`🤖 Querying Phi3 for intent parsing (${promptClassification?.level || 'unknown'} level)...`);

            const phi3Result = await context.executeAgent('Phi3Agent', {
                action: 'query-phi3',
                prompt: prompt
            }, context);

            if (!phi3Result.success) {
                return { success: false, error: phi3Result.error };
            }

            // Parse the JSON response from Phi3 (handle Markdown code blocks)
            const response = phi3Result.result.response;
            let parsedIntent;
            
            try {
                // First try direct parsing
                parsedIntent = JSON.parse(response);
            } catch (parseError) {
                try {
                    // Extract JSON from Markdown code blocks
                    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || 
                                    response.match(/{[\s\S]*}/) || 
                                    response.match(/\[[\s\S]*\]/);
                    
                    if (jsonMatch) {
                        const cleanJson = jsonMatch[1] || jsonMatch[0];
                        parsedIntent = JSON.parse(cleanJson.trim());
                        console.log('✅ Successfully extracted JSON from Markdown code block');
                    } else {
                        throw new Error('No JSON found in response');
                    }
                } catch (secondParseError) {
                    console.error('❌ Failed to parse Phi3 JSON response:', parseError);
                    console.error('❌ Raw response:', response);
                    console.error('❌ Second parse attempt failed:', secondParseError);
                    return { success: false, error: 'Invalid JSON response from Phi3' };
                }
            }

            return {
                success: true,
                result: {
                    intent: parsedIntent.intent,
                    confidence: parsedIntent.confidence || 0.8,
                    entities: parsedIntent.entities || [],
                    category: parsedIntent.category || 'general',
                    requiresContext: parsedIntent.requiresContext || false,
                    method: 'phi3_llm'
                }
            };
        } catch (error) {
            console.error('❌ Phi3 intent parsing failed:', error);
            return { success: false, error: error.message };
        }
    },

    buildIntentPrompt(message, promptClassification = null) {
        const level = promptClassification?.level || 'medium';
        
        const whoYouAre = 'You are Thinkdrop AI, an intelligent, helpful, and discerning assistant. You answer with clarity, humility, and wisdom — grounded in Biblical worldview and traditional values.'  

        switch (level) {
            case 'minimal':
                return `${whoYouAre} 
Classify intent. Return JSON only.
Intents: greeting, memory_store, memory_retrieve, memory_update, memory_delete, command, question
{"intent":"?","confidence":0.8}
Message: "${message}"
JSON:`;
                
            case 'light':
                return `${whoYouAre}
Intent classifier. Return JSON only.
Intents:
- greeting: hi/bye
- memory_store: save info
- memory_retrieve: recall info
- memory_update: update info
- memory_delete: delete info
- command: do something
- question: ask something

{"intent":"?","confidence":0.8,"entities":[],"category":"?","requiresContext":false}
Message: "${message}"
JSON:`;
                
            case 'medium':
                return `${whoYouAre}
You are an intent classifier. Analyze the message and return JSON only.

Available intents:
- greeting: hellos, goodbyes, social pleasantries
- memory_store: save information ("my name is X", "remember that")
- memory_retrieve: recall information ("what's my name?", "do you remember?")
- memory_update: update information ("update my name to X", "change my job to software engineer")
- memory_delete: delete information ("delete my name", "remove my job")
- command: direct requests ("help me write", "create a")
- question: information requests, queries

Return this exact JSON structure:
{
  "intent": "intent_name",
  "confidence": 0.85,
  "entities": [],
  "category": "social",
  "requiresContext": false
}

Message: "${message}"

JSON response:`;
                
            case 'high':
                return `${whoYouAre}
You are an advanced intent classifier. Analyze the user's message and identify the primary intent with supporting details.

Available intents with examples:
- greeting: "hi", "hello", "goodbye", "thanks"
- memory_store: "my name is John", "remember I like pizza", "I work at Google"
- memory_retrieve: "what's my name?", "do you remember my job?", "what did I tell you?"
- memory_update: "update my name to John", "change my job to software engineer"
- memory_delete: "delete my name", "remove my job"
- command: "help me write an email", "create a document", "take a screenshot"
- question: "how does this work?", "what is the weather?", "explain this concept"

Consider:
- Context clues and implicit meaning
- Multiple possible intents (choose primary)
- User's likely goal or need
- Information that should be remembered

Return this JSON structure:
{
  "intent": "primary_intent",
  "confidence": 0.85,
  "entities": ["extracted_entities"],
  "category": "intent_category",
  "requiresContext": false,
  "reasoning": "brief explanation"
}

Message: "${message}"

JSON response:`;
                
            case 'complex':
                return `${whoYouAre}
You are a sophisticated intent classification system. Perform comprehensive analysis of the user's message to identify intent, extract entities, and determine context requirements.

Intent Categories:
1. **greeting**: Social interactions (hello, goodbye, thanks, pleasantries)
2. **memory_store**: Information to remember (personal details, preferences, facts about user)
3. **memory_retrieve**: Requests to recall stored information
4. **memory_update**: Requests to update stored information
5. **memory_delete**: Requests to delete stored information
6. **command**: Direct instructions or requests for action
7. **question**: Information seeking, explanations, how-to queries

Analysis Framework:
- Primary intent identification
- Secondary intent consideration
- Entity extraction (names, dates, locations, preferences)
- Context dependency assessment
- Confidence scoring based on clarity

Return comprehensive JSON:
{
  "intent": "primary_intent",
  "confidence": 0.85,
  "entities": ["entity1", "entity2"],
  "category": "intent_category",
  "requiresContext": boolean,
  "reasoning": "detailed analysis",
  "secondaryIntents": ["possible_alternatives"],
  "complexity": "${level}"
}

Message: "${message}"

Provide thorough JSON analysis:`;
                
            default:
                return AGENT_FORMAT.buildIntentPrompt(message, { level: 'medium' });
        }
    },

    parseWithPatterns(message) {
        const lowerMessage = message.toLowerCase();
        
        // Check each pattern
        for (const [intent, pattern] of Object.entries(AGENT_FORMAT.enhancedPatterns)) {
            if (pattern.test(lowerMessage)) {
                return {
                    intent: intent,
                    confidence: 0.7,
                    entities: [],
                    category: AGENT_FORMAT.getCategoryForIntent(intent),
                    requiresContext: intent.includes('memory')
                };
            }
        }

        // Default to question intent
        return {
            intent: 'question',
            confidence: 0.5,
            entities: [],
            category: 'general',
            requiresContext: false
        };
    },

    getCategoryForIntent(intent) {
        const categoryMap = {
            greeting: 'social',
            memory_store: 'memory',
            memory_retrieve: 'memory',
            command: 'action',
            question: 'information',
            weather: 'information',
            scheduling: 'planning'
        };
        return categoryMap[intent] || 'general';
    },

    initializeEnhancedPatterns() {
        AGENT_FORMAT.enhancedPatterns = {
            greeting: /\b(hi|hello|hey|good morning|good afternoon|good evening|goodbye|bye|see you|thanks|thank you)\b/i,
            memory_store: /\b(remember|my name is|I am|I like|I prefer|save this|store this)\b/i,
            memory_retrieve: /\b(what.+my name|do you remember|what did I|recall|remind me)\b/i,
            command: /\b(help me|create|make|generate|write|build|do this|please)\b/i,
            question: /\b(what|how|why|when|where|who|can you|could you|\?)\b/i,
            weather: /\b(weather|temperature|rain|sunny|cloudy|forecast)\b/i,
            scheduling: /\b(appointment|meeting|schedule|calendar|time|date|tomorrow|today)\b/i
        };
    }
};

module.exports = AGENT_FORMAT;
