/**
 * Default agents configuration and loading logic
 * Extracted from LocalLLMAgent.js to improve code organization
 */

/**
 * Load default agents into the database and cache
 * @param {Object} database - DuckDB database instance
 * @param {Map} agentCache - Agent cache map
 */
class DefaultAgents {
  constructor() {}

  async loadDefaultAgents(database, agentCache) {
    console.log('🔄 Loading default agents...');
    
    const defaultAgents = [
      {
        name: "UserMemoryAgent",
        id: "user-memory-agent",
        description: "Manages user memory storage, retrieval, and updates",
        parameters: JSON.stringify({
          supportedOperations: ["store", "retrieve", "update", "delete"],
          memoryCategories: [
            "personal_info",
            "preferences",
            "calendar",
            "work",
            "general",
          ],
        }),
        dependencies: JSON.stringify([]),
        execution_target: "backend",
        requires_database: true,
        database_type: "duckdb",
        code: `module.exports = {
          execute: async function(params, context) {
            const { action, memoryCategory, content, query } = params;
            const database = context?.database;
            
            if (!database) {
              return {
                success: false,
                error: 'Database connection required'
              };
            }
            
            try {
              switch(action) {
                case 'store':
                  const insertStmt = database.prepare(
                    'INSERT INTO user_memory (category, content, timestamp, metadata) VALUES (?, ?, ?, ?)'
                  );
                  insertStmt.run(
                    memoryCategory || 'general',
                    content,
                    new Date().toISOString(),
                    JSON.stringify({ source: 'user_input' })
                  );
                  return {
                    success: true,
                    message: 'Memory stored successfully',
                    category: memoryCategory
                  };
                  
                case 'retrieve':
                  const selectStmt = database.prepare(
                    'SELECT * FROM user_memory WHERE category = ? ORDER BY timestamp DESC LIMIT 10'
                  );
                  const memories = selectStmt.all(memoryCategory || 'general');
                  return {
                    success: true,
                    memories: memories,
                    count: memories.length
                  };
                  
                case 'delete':
                  const deleteStmt = database.prepare(
                    'DELETE FROM user_memory WHERE category = ? AND content LIKE ?'
                  );
                  const result = deleteStmt.run(memoryCategory, '%' + content + '%');
                  return {
                    success: true,
                    message: 'Memory deleted successfully',
                    deletedCount: result.changes
                  };
                  
                default:
                  return {
                    success: false,
                    error: 'Unsupported action: ' + action
                  };
              }
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        };`,
        config: JSON.stringify({ timeout: 5000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "high",
          type: "memory",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify(["memory_crud", "user_data"]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
      {
        name: "IntentParserAgent",
        id: "intent-parser-agent",
        description: "Advanced intent detection and parsing for user messages",
        parameters: JSON.stringify({
          supportedIntents: [
            "question", "command", "memory_store", "memory_retrieve", 
            "task_create", "agent_orchestrate", "external_data_required"
          ],
          confidenceThreshold: 0.7,
          fallbackIntent: "question"
        }),
        dependencies: JSON.stringify([]),
        execution_target: "backend",
        requires_database: false,
        database_type: null,
        code: `module.exports = {
          execute: async function(params, context) {
            const message = params.message;
            const llmClient = context?.llmClient;
            const lowerMessage = message.toLowerCase();
            let intent = 'question';
            
            // Fallback detection function
            const fallbackDetection = (message) => {
              const lowerMessage = message.toLowerCase();
              let intent = 'question';
              let memoryCategory = null;
              let confidence = 0.7;
              let action = undefined;
              
              // Memory storage patterns (setting/storing new info)
              if (lowerMessage.match(/my name (is|=) [\\w\\s]+/i)) {
                intent = 'memory_store';
                memoryCategory = 'personal_info';
                confidence = 0.8;
                action = 'store';
              } else if (lowerMessage.match(/my favorite|i like|i prefer|i love/i) && lowerMessage.match(/color|food|movie|book|music|song/i)) {
                intent = 'memory_store';
                memoryCategory = 'preferences';
                confidence = 0.8;
                action = 'store';
              }
              // Memory deletion patterns
              else if (lowerMessage.match(/remove|delete|clear|forget|erase/i) && (lowerMessage.match(/favorite|preference|that|color/i) || lowerMessage.match(/name|personal|info/i))) {
                intent = 'memory_store';
                memoryCategory = lowerMessage.match(/name|personal|info/i) ? 'personal_info' : 'preferences';
                confidence = 0.9;
                action = 'delete';
              }
              // Memory retrieval patterns (asking for stored info)
              else if (lowerMessage.match(/what.*my name|who am i/i)) {
                intent = 'memory_retrieve';
                memoryCategory = 'personal_info';
                confidence = 0.8;
              } else if (lowerMessage.match(/what.*favorite|what.*like|what.*prefer|what.*my.*color/i)) {
                intent = 'memory_retrieve';
                memoryCategory = 'preferences';
                confidence = 0.8;
              }
              // Appointment/calendar patterns
              else if (lowerMessage.match(/delete|cancel|remove/i) && lowerMessage.match(/appointment|appt|meeting|schedule/i)) {
                intent = 'memory_store';
                memoryCategory = 'calendar';
                confidence = 0.9;
                action = 'delete';
              } else if (lowerMessage.match(/appointment|schedule|meeting|calendar/i) && lowerMessage.match(/have|at|next|tomorrow|today/i)) {
                intent = 'memory_store';
                memoryCategory = 'calendar';
                confidence = 0.8;
                action = 'store';
              } else if (lowerMessage.match(/flight|plane|travel|trip|airport/i) || lowerMessage.match(/what time|when is|tomorrow/i)) {
                intent = 'external_data_required';
                memoryCategory = lowerMessage.match(/flight|plane|airport|travel|trip/i) ? 'travel' : 'calendar';
                confidence = 0.8;
              }
              // Task creation patterns
              else if (lowerMessage.match(/create|make|set up|build|generate/i) && lowerMessage.match(/task|workflow|plan|reminder|schedule|todo|list/i)) {
                intent = 'task_create';
                memoryCategory = 'work';
                confidence = 0.9;
                action = 'create';
              } else if (lowerMessage.match(/remind me|set reminder|schedule/i) && lowerMessage.match(/to|about|for/i)) {
                intent = 'task_create';
                memoryCategory = 'general';
                confidence = 0.8;
                action = 'create';
              }
              // Agent orchestration patterns
              else if (lowerMessage.match(/orchestrate|coordinate|manage|run multiple|execute workflow/i)) {
                intent = 'agent_orchestrate';
                memoryCategory = 'work';
                confidence = 0.9;
                action = 'orchestrate';
              } else if (lowerMessage.match(/complex|multi-step|workflow/i) && lowerMessage.match(/process|execute|run|handle/i)) {
                intent = 'agent_orchestrate';
                memoryCategory = 'work';
                confidence = 0.8;
                action = 'orchestrate';
              }
              
              return {
                success: true,
                intent,
                memoryCategory,
                confidence,
                entities: [],
                requiresExternalData: intent === 'external_data_required',
                action
              };
            };
            
            if (!llmClient) {
              console.log('LLM client not available for intent detection, using fallback');
              return fallbackDetection(message);
            }
            
            try {
              const prompt = "You are an intent detection system. Classify the user message into: question, command, memory_store, memory_retrieve, task_create, agent_orchestrate, or external_data_required. For memory operations (store, delete, update), use memory_store with an action field (e.g., 'store', 'delete'). For memory retrieval/queries, use memory_retrieve. For creating tasks/workflows/reminders, use task_create. For complex multi-step orchestration, use agent_orchestrate. Include confidence (0-1), entities, and an action field if applicable. Reply in JSON format only. User message: " + message;
              
              console.log('🔍 Sending intent detection prompt to LLM...');
              const result = await llmClient.complete({
                prompt: prompt,
                max_tokens: 150,
                temperature: 0,
                stop: ["\\n\\n", "}", "User:"]
              });
              
              console.log('📝 Raw LLM response:', JSON.stringify(result));
              
              if (!result || result === 'No response generated' || result.trim().length === 0) {
                console.log('⚠️ Empty or "No response generated" received, using fallback detection');
                return fallbackDetection(message);
              }
              
              try {
                let cleanResult = result.replace(/\`\`\`json|\`\`\`|\`/g, '').trim();
                
                if (!cleanResult.startsWith('{')) {
                  const jsonMatch = cleanResult.match(/\\{(?:[^{}]*|\\{[^{}]*\\})*\\}/);
                  if (jsonMatch) cleanResult = jsonMatch[0];
                }
                
                if (!cleanResult.endsWith('}')) {
                  cleanResult += '}';
                }
                
                const parsedResult = JSON.parse(cleanResult);
                console.log('✅ LLM intent detection result:', parsedResult);
                
                return {
                  success: true,
                  intent: parsedResult.intent || 'question',
                  memoryCategory: parsedResult.memoryCategory || null,
                  confidence: parsedResult.confidence || 0.7,
                  entities: parsedResult.entities || [],
                  requiresExternalData: parsedResult.intent === 'external_data_required',
                  action: parsedResult.action || (parsedResult.intent === 'memory_store' ? 'store' : undefined)
                };
              } catch (parseError) {
                console.log('⚠️ Failed to parse LLM response, using fallback:', parseError.message);
                return fallbackDetection(message);
              }
            } catch (error) {
              console.error('Error in LLM intent detection:', error);
              return fallbackDetection(message);
            }
          }
        };`,
        config: JSON.stringify({ timeout: 10000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "highest",
          type: "orchestrator",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify([
          "multi_intent_detection",
          "workflow_planning",
          "orchestration",
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
      {
        name: "PlannerAgent",
        id: "planner-agent",
        description: "Multi-intent orchestration planner for complex workflows",
        parameters: JSON.stringify({
          supportedIntents: [
            // Core Memory Intents (Full CRUD)
            "memory_store", "memory_retrieve", "memory_update", "memory_delete",
            // Agent-Oriented Intents
            "agent_run", "agent_schedule", "agent_stop", "agent_generate", "agent_orchestrate", "agent_update", "agent_explain", "agent_debug",
            // Task & Planning Intents
            "task_create", "task_update", "task_delete", "task_summarize", "task_prioritize",
            // Contextual & System Intents
            "context_enrich", "context_retrieve", "session_restart", "feedback_submit", "external_data_required",
            // Communication & Interaction
            "compose_email", "speak", "listen",
            // Spiritual/Wellness Intents
            "prayer_request", "verse_lookup", "devotion_suggest", "mood_checkin", "daily_reminder",
            // General
            "question", "command"
          ],
          orchestrationTypes: ["sequential", "parallel", "conditional"],
          minimumV1Intents: [
            "memory_store", "memory_retrieve", "memory_update", "memory_delete",
            "agent_run", "agent_schedule", "agent_generate", "agent_orchestrate",
            "external_data_required", "context_enrich", "task_create", "task_summarize",
            "devotion_suggest", "verse_lookup", "prayer_request", "mood_checkin",
            "question", "command"
          ]
        }),
        dependencies: JSON.stringify([]),
        execution_target: "frontend",
        requires_database: false,
        database_type: null,
        code: `module.exports = {execute: async function(params, context) {
    const message = params.message;
    const llmClient = context?.llmClient;
    
    if(!llmClient) {
      console.log('PlannerAgent: LLM client not available');
      return {
        success: false,
        error: 'LLM client required for orchestration planning'
      };
    }
    
    try {
      const prompt = \`You are ThinkDrop AI's orchestration planner. Analyze the user message and determine orchestration needs.
  
  For SIMPLE single-intent messages, return:
  {"multiIntent": false, "primaryIntent": "intent_name", "complexity": "simple"}
  
  For COMPLEX multi-intent messages, return:
  {"multiIntent": true, "intents": ["intent1", "intent2"], "orchestrationPlan": [{"step": 1, "agent": "AgentName", "action": "action_name", "data": {}, "parallel": false}], "complexity": "complex"}
  
  ✅ SUPPORTED INTENTS:
  • Memory: memory_store, memory_retrieve, memory_update, memory_delete
  • Agents: agent_run, agent_schedule, agent_generate, agent_orchestrate
  • Tasks: task_create, task_summarize, task_update, task_delete
  • Context: context_enrich, context_retrieve
  • Communication: compose_email, speak, listen
  • Spiritual: prayer_request, verse_lookup, devotion_suggest, mood_checkin
  • System: external_data_required, session_restart, feedback_submit
  • General: question, command
  
  🤖 AVAILABLE AGENTS:
  • UserMemoryAgent - Memory CRUD operations
  • MemoryEnrichmentAgent - Context enrichment
  • IntentParserAgent - Intent detection
  • CalendarIntegrationAgent - Calendar operations
  • CommunicationAgent - Email/messaging
  • SpiritualAgent - Prayer, verses, devotions
  
  User message: "\${message}"
  
  Analyze and return JSON only:\`;
  
      const result = await llmClient.complete({
        prompt,
        max_tokens: 1000,
        temperature: 0.1,
        stop: ["\\n\\n"]
      });
      
      try {
        const parsedResult = JSON.parse(result.text);
        console.log('PlannerAgent orchestration result:', parsedResult);
        
        if(parsedResult.multiIntent) {
          return {
            success: true,
            multiIntent: true,
            intents: parsedResult.intents,
            orchestrationPlan: parsedResult.orchestrationPlan,
            totalSteps: parsedResult.orchestrationPlan?.length || 0,
            complexity: parsedResult.complexity || 'complex'
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
            complexity: parsedResult.complexity || 'simple'
          };
        }
      } catch(parseError) {
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
          complexity: 'simple'
        };
      }
    } catch(error) {
      console.error('Error in PlannerAgent:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }};`,
        config: JSON.stringify({ timeout: 10000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "highest",
          type: "orchestrator",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify([
          "multi_intent_detection",
          "workflow_planning",
          "orchestration",
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
      {
        name: "LocalLLMAgent",
        id: "local-llm-agent",
        description: "Local LLM orchestration and prompt clarification",
        parameters: JSON.stringify({}),
        dependencies: JSON.stringify([]),
        execution_target: "frontend",
        requires_database: true,
        database_type: "duckdb",
        code: 'module.exports = { execute: async (params, context) => ({ success: true, message: "LocalLLMAgent ready" }) };',
        config: JSON.stringify({ timeout: 30000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "high",
          type: "orchestrator",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify([
          "orchestration",
          "clarification",
          "local_llm",
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
      {
        name: "CalendarIntegrationAgent",
        id: "calendar-integration-agent",
        description: "Calendar operations and event management",
        parameters: JSON.stringify({
          supportedCalendars: ["google", "microsoft", "apple"],
          defaultCalendar: "google"
        }),
        dependencies: JSON.stringify([]),
        execution_target: "backend",
        requires_database: true,
        database_type: "duckdb",
        code: `module.exports = {
          execute: async function(params, context) {
            const { action, calendarId, eventId } = params;
            const database = context?.database;
            const calendarClient = context?.calendarClient;
            
            if (!database || !calendarClient) {
              return {
                success: false,
                error: 'Database and calendar client required'
              };
            }
            
            try {
              switch (action) {
                case 'create_event':
                  const event = await calendarClient.createEvent(calendarId, params.event);
                  return {
                    success: true,
                    message: 'Event created successfully',
                    eventId: event.id
                  };
                case 'update_event':
                  const updatedEvent = await calendarClient.updateEvent(calendarId, eventId, params.event);
                  return {
                    success: true,
                    message: 'Event updated successfully',
                    eventId: updatedEvent.id
                  };
                case 'delete_event':
                  await calendarClient.deleteEvent(calendarId, eventId);
                  return {
                    success: true,
                    message: 'Event deleted successfully'
                  };
                case 'get_events':
                  const events = await calendarClient.getEvents(calendarId);
                  return {
                    success: true,
                    events: events
                  };
                default:
                  return {
                    success: false,
                    error: 'Unsupported action: ' + action
                  };
              }
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        };`,
        config: JSON.stringify({ timeout: 5000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "high",
          type: "calendar",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify([
          "calendar_operations",
          "event_management",
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
      {
        name: "CommunicationAgent",
        id: "communication-agent",
        description: "Email and messaging operations",
        parameters: JSON.stringify({
          supportedChannels: ["email", "sms", "slack"],
          defaultChannel: "email"
        }),
        dependencies: JSON.stringify([]),
        execution_target: "backend",
        requires_database: true,
        database_type: "duckdb",
        code: `module.exports = {
          execute: async function(params, context) {
            const { action, channelId, message } = params;
            const database = context?.database;
            const communicationClient = context?.communicationClient;
            
            if (!database || !communicationClient) {
              return {
                success: false,
                error: 'Database and communication client required'
              };
            }
            
            try {
              switch (action) {
                case 'send_message':
                  const result = await communicationClient.sendMessage(channelId, message);
                  return {
                    success: true,
                    message: 'Message sent successfully',
                    messageId: result.id
                  };
                case 'get_messages':
                  const messages = await communicationClient.getMessages(channelId);
                  return {
                    success: true,
                    messages: messages
                  };
                default:
                  return {
                    success: false,
                    error: 'Unsupported action: ' + action
                  };
              }
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        };`,
        config: JSON.stringify({ timeout: 5000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "high",
          type: "communication",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify([
          "email_operations",
          "messaging_operations",
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
      {
        name: "MemoryEnrichmentAgent",
        id: "memory-enrichment-agent",
        description: "Enriches prompts with user context and memories",
        parameters: JSON.stringify({
          supportedOperations: ["enrich"],
          contextCategories: ["user", "recent", "preferences"]
        }),
        dependencies: JSON.stringify(["UserMemoryAgent"]),
        execution_target: "backend",
        requires_database: true,
        database_type: "duckdb",
        code: `module.exports = {
          execute: async function(params, context) {
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
                if (userMemories.name) userContext.push("Name: " + userMemories.name);
                if (userMemories.location) userContext.push("Location: " + userMemories.location);
                if (userMemories.preferences) userContext.push("Preferences: " + userMemories.preferences);
                if (userMemories.role) userContext.push("Role: " + userMemories.role);
                
                if (userContext.length > 0) {
                  contextSections.push("[User Context: " + userContext.join(', ') + "]");
                }
                
                // Add recent memories context
                const recentMemories = Object.entries(userMemories)
                  .filter(([key]) => !['name', 'location', 'preferences', 'role'].includes(key))
                  .slice(0, 3)
                  .map(([key, value]) => key + ": " + value);
                
                if (recentMemories.length > 0) {
                  contextSections.push("[Recent Context: " + recentMemories.join(', ') + "]");
                }
                
                // Prepend context to prompt
                if (contextSections.length > 0) {
                  enrichedPrompt = contextSections.join('\n') + "\n\n" + prompt;
                }
              }
              
              return {
                success: true,
                enrichedPrompt,
                contextAdded: userMemories ? Object.keys(userMemories).length : 0
              };
            } catch (error) {
              return {
                success: false,
                error: error.message,
                enrichedPrompt: prompt // Fallback to original prompt
              };
            }
          }
        };`,
        config: JSON.stringify({ timeout: 5000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "high",
          type: "memory",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify([
          "context_enrichment",
          "memory_integration",
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
      {
        name: "SpiritualAgent",
        id: "spiritual-agent",
        description: "Prayer, verse, and devotion operations",
        parameters: JSON.stringify({
          supportedPrayerTypes: ["personal", "group"],
          defaultPrayerType: "personal"
        }),
        dependencies: JSON.stringify([]),
        execution_target: "backend",
        requires_database: true,
        database_type: "duckdb",
        code: `module.exports = {
          execute: async function(params, context) {
            const { action, prayerId } = params;
            const database = context?.database;
            const spiritualClient = context?.spiritualClient;
            
            if (!database || !spiritualClient) {
              return {
                success: false,
                error: 'Database and spiritual client required'
              };
            }
            
            try {
              switch (action) {
                case 'create_prayer':
                  const prayer = await spiritualClient.createPrayer(prayerId, params.prayer);
                  return {
                    success: true,
                    message: 'Prayer created successfully',
                    prayerId: prayer.id
                  };
                case 'update_prayer':
                  const updatedPrayer = await spiritualClient.updatePrayer(prayerId, params.prayer);
                  return {
                    success: true,
                    message: 'Prayer updated successfully',
                    prayerId: updatedPrayer.id
                  };
                case 'delete_prayer':
                  await spiritualClient.deletePrayer(prayerId);
                  return {
                    success: true,
                    message: 'Prayer deleted successfully'
                  };
                case 'get_prayers':
                  const prayers = await spiritualClient.getPrayers();
                  return {
                    success: true,
                    prayers: prayers
                  };
                default:
                  return {
                    success: false,
                    error: 'Unsupported action: ' + action
                  };
              }
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        };`,
        config: JSON.stringify({ timeout: 5000 }),
        secrets: JSON.stringify({}),
        orchestrator_metadata: JSON.stringify({
          priority: "high",
          type: "spiritual",
        }),
        memory: JSON.stringify({}),
        capabilities: JSON.stringify([
          "prayer_operations",
          "verse_operations",
          "devotion_operations",
        ]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: "1.0.0",
        source: "default",
      },
    ];
  
    const insertAgent = database.prepare(`
      INSERT OR REPLACE INTO cached_agents (
        name, id, description, parameters, dependencies, execution_target,
        requires_database, database_type, code, config, secrets,
        orchestrator_metadata, memory, capabilities, created_at,
        updated_at, version, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  
    defaultAgents.forEach((agent) => {
      insertAgent.run(
        agent.name,
        agent.id,
        agent.description,
        agent.parameters,
        agent.dependencies,
        agent.execution_target,
        agent.requires_database,
        agent.database_type,
        agent.code,
        agent.config,
        agent.secrets,
        agent.orchestrator_metadata,
        agent.memory,
        agent.capabilities,
        agent.created_at,
        agent.updated_at,
        agent.version,
        agent.source,
      );
  
      agentCache.set(agent.name, agent);
    });
  
    console.log(`✅ Loaded ${defaultAgents.length} default agents`);
  }
}

export default DefaultAgents;