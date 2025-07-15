/**
 * AgentOrchestrator - Central brain for agent-to-agent communication
 * Receives user input and coordinates all downstream planning and execution
 */

import PlannerAgent from './agents/PlannerAgent.js';
import IntentParserAgent from './agents/IntentParserAgent.js';
import UserMemoryAgent from './agents/UserMemoryAgent.js';
import ScreenCaptureAgent from './agents/ScreenCaptureAgent.js';
import { AgentSandbox } from './AgentSandbox.js';
import { OrchestrationService } from './OrchestrationService.js';

export class AgentOrchestrator {
  constructor(options = {}) {
    this.llmClient = options.llmClient;
    this.database = options.database;
    this.logger = options.logger || console;
    
    // Initialize core agents (using new LLM-compatible JSON structure format)
    this.agents = {
      planner: PlannerAgent,
      intent: IntentParserAgent,
      memory: UserMemoryAgent,
      screenCapture: ScreenCaptureAgent
    };
    
    // Store agent instances for execution context
    this.agentInstances = new Map();
    
    // Initialize sandbox for dynamic agents
    this.sandbox = new AgentSandbox();
    
    // Initialize orchestration service for backend communication
    this.orchestrationService = new OrchestrationService(options.apiConfig);
    
    this.isInitialized = false;
  }

  async initialize() {
    try {
      this.logger.info('🧠 Initializing AgentOrchestrator...');
      
      // Initialize all core agents
      for (const [name, agent] of Object.entries(this.agents)) {
        if (agent.initialize) {
          await agent.initialize();
          this.logger.info(`✅ ${name} agent initialized`);
        }
      }
      
      // Initialize sandbox
      await this.sandbox.initialize();
      this.logger.info('✅ AgentSandbox initialized');
      
      this.isInitialized = true;
      this.logger.info('🎯 AgentOrchestrator ready for agent-to-agent communication');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize AgentOrchestrator:', error);
      throw error;
    }
  }

  async screenCapture(captureScreen, context) {
    // Debug logging for screenshot decision
    this.logger.info(`🔍 [DEBUG] Screenshot capture decision:`);
    this.logger.info(`  - captureScreen value: ${captureScreen} (type: ${typeof captureScreen})`);
    this.logger.info(`  - shouldCaptureScreenshot: ${captureScreen}`);
    
    // Step 1a: Capture screenshot if backend determined it's needed via captureScreen flag
    if (captureScreen) {
      this.logger.info(`📸 Capturing screenshot for memory context (captureScreen=${captureScreen})...`);
      const screenshotResult = await this.agents.screenCapture.code.execute({
        action: 'capture_and_extract',
        includeOCR: true,
        ocrOptions: {
          languages: ['eng'],
          confidence: 0.7
        }
      }, {
        logger: this.logger,
        ...context
      });
      
      console.log('📸 Screenshot capture result:', screenshotResult);
      if (screenshotResult.success) {
        this.logger.info('✅ Screenshot captured with OCR');
        return screenshotResult;
      } else {
        this.logger.warn('⚠️ Screenshot capture failed:', screenshotResult.error);
        return null;
      }
    } else {
      this.logger.info(`⏭️ Skipping screenshot capture (captureScreen=${captureScreen})`);
      return null;
    }
  }

  /**
   * Main orchestration method - processes intent classification payloads from backend
   */
  async ask(intentPayload, context = {}) {
    if (!this.isInitialized) {
      throw new Error('AgentOrchestrator not initialized. Call initialize() first.');
    }

    try {
      // Handle both legacy string input and new intent classification payloads
      let processedPayload;
      
      if (typeof intentPayload === 'string') {
        // Try to parse the string as JSON first
        try {
          const parsedPayload = JSON.parse(intentPayload);
          
          // Check if it has the expected structure of an intent classification payload
          if (parsedPayload && 
              (parsedPayload.type === 'intent_classification' || 
               parsedPayload.primaryIntent || 
               (parsedPayload.payload && parsedPayload.payload.intents))) {
            
            // Extract the actual payload if it's nested
            if (parsedPayload.payload && parsedPayload.payload.intents) {
              processedPayload = parsedPayload.payload;
              this.logger.info('📦 Parsed nested intent classification payload:', processedPayload.primaryIntent);
            } else {
              processedPayload = parsedPayload;
              this.logger.info('📦 Parsed intent classification payload:', processedPayload.primaryIntent);
            }
          } else {
            // JSON parsed but not an intent classification payload
            processedPayload = {
              intents: [{ intent: 'question', confidence: 0.8, reasoning: 'Parsed JSON but not intent format' }],
              primaryIntent: 'question',
              entities: [],
              requiresMemoryAccess: parsedPayload.requiresMemoryAccess || false,
              requiresExternalData: parsedPayload.requiresExternalData || false,
              suggestedResponse: parsedPayload.suggestedResponse || '',
              sourceText: intentPayload
            };
            this.logger.info('🔄 Processing parsed JSON as legacy input');
          }
        } catch (parseError) {
          // Not valid JSON, treat as legacy string input
          this.logger.info('🔄 Processing legacy string input (not valid JSON):', intentPayload);
          processedPayload = {
            intents: [{ intent: 'question', confidence: 0.8, reasoning: 'Legacy string input' }],
            primaryIntent: 'question',
            entities: [],
            requiresMemoryAccess: false,  // Default false for legacy string input
            requiresExternalData: false,
            suggestedResponse: '',
            sourceText: intentPayload
          };
        }
      } else if (intentPayload && typeof intentPayload === 'object') {
        // Handle object payloads - check for different structures
        if (intentPayload.message && typeof intentPayload.message === 'string') {
          // Case: { message: '{"type":"intent_classification",...}', ... }
          try {
            const parsedMessage = JSON.parse(intentPayload.message);
            if (parsedMessage.payload && parsedMessage.payload.intents) {
              processedPayload = parsedMessage.payload;
              this.logger.info('📦 Parsed message-wrapped intent payload:', processedPayload.primaryIntent);
            } else if (parsedMessage.intents) {
              processedPayload = parsedMessage;
              this.logger.info('📦 Parsed message intent payload:', processedPayload.primaryIntent);
            } else {
              // Fallback for message format
              processedPayload = {
                intents: [{ intent: 'question', confidence: 0.8, reasoning: 'Message format fallback' }],
                primaryIntent: 'question',
                entities: [],
                requiresMemoryAccess: false,
                requiresExternalData: false,
                suggestedResponse: '',
                sourceText: intentPayload.message
              };
              this.logger.info('🔄 Processing message as fallback');
            }
          } catch (parseError) {
            this.logger.warn('⚠️ Failed to parse message field:', parseError.message);
            processedPayload = {
              intents: [{ intent: 'question', confidence: 0.8, reasoning: 'Message parse error' }],
              primaryIntent: 'question',
              entities: [],
              requiresMemoryAccess: false,
              requiresExternalData: false,
              suggestedResponse: '',
              sourceText: intentPayload.message || 'Unknown message'
            };
          }
        } else if (intentPayload.intents && Array.isArray(intentPayload.intents)) {
          // Case: Direct intent payload object
          processedPayload = intentPayload;
          this.logger.info('🎯 Processing direct intent classification payload object:', processedPayload.primaryIntent);
        } else if (intentPayload.intentPayload && intentPayload.intentPayload.intents) {
          // Case: Nested intentPayload structure
          processedPayload = intentPayload.intentPayload;
          this.logger.info('🎯 Processing nested intentPayload object:', processedPayload.primaryIntent);
        } else {
          // Unknown object structure - create fallback
          this.logger.warn('⚠️ Unknown payload structure:', Object.keys(intentPayload));
          processedPayload = {
            intents: [{ intent: 'question', confidence: 0.8, reasoning: 'Unknown object structure' }],
            primaryIntent: 'question',
            entities: [],
            requiresMemoryAccess: false,
            requiresExternalData: false,
            suggestedResponse: '',
            sourceText: JSON.stringify(intentPayload)
          };
        }
      } else {
        // Invalid input type
        this.logger.warn('⚠️ Invalid intentPayload type:', typeof intentPayload);
        processedPayload = {
          intents: [{ intent: 'question', confidence: 0.8, reasoning: 'Invalid input type' }],
          primaryIntent: 'question',
          entities: [],
          requiresMemoryAccess: false,
          captureScreen: false,
          requiresExternalData: false,
          suggestedResponse: '',
          sourceText: String(intentPayload)
        };
      }
      
      const { intents, primaryIntent, entities, requiresMemoryAccess, sourceText } = processedPayload;
      
      // Auto-enable captureScreen for memory-related intents or when requiresMemoryAccess is true
      let captureScreen = processedPayload.captureScreen;
      // if (captureScreen === undefined || captureScreen === null) {
      //   // Auto-enable screenshot capture for memory intents or when memory access is required
      //   captureScreen = primaryIntent === 'memory_store' || requiresMemoryAccess === true;
      //   this.logger.info(`🔧 Auto-setting captureScreen to ${captureScreen} for intent: ${primaryIntent} (requiresMemoryAccess: ${requiresMemoryAccess})`);
      // }
      
      // Log the screenshot capture flags for debugging
      this.logger.info(`📸 requiresMemoryAccess flag: ${requiresMemoryAccess}`);
      this.logger.info(`📸 captureScreen flag: ${captureScreen} (auto-set: ${processedPayload.captureScreen === undefined})`);
      
      // Validate intents array
      if (!Array.isArray(intents)) {
        this.logger.warn('⚠️ No valid intents array found in payload. Payload keys:', Object.keys(processedPayload || {}));
        this.logger.warn('⚠️ Intents value:', intents);
        return {
          success: false,
          error: 'Invalid intents format - expected array',
          results: [],
          fallback: 'I encountered an issue processing your request. Please try again.',
          debug: {
            processedPayload: processedPayload,
            intentsType: typeof intents,
            intentsValue: intents
          }
        };
      }
      
      // Step 1: Process intents by priority/confidence
      const results = [];
      let memoryResult = null;
      let screenshotResult = null;
      
      // Process each intent individually to support multi-intent scenarios
      for (const intentData of intents) {
        const { intent, confidence } = intentData;
        
        this.logger.info(`🔍 Processing intent: ${intent} (confidence: ${confidence})`);
        
        // Process memory_store intent
        if (intent === 'memory_store') {
            // Trigger screenshot capture + memory storage chain
            this.logger.info('💾 Memory store intent detected - triggering agent chain');
            
            // Use captureScreen boolean from intent classification to determine screenshot capture
            screenshotResult = await this.screenCapture(captureScreen, context);
            
            // Step 1b: Store intent classification in memory
            this.logger.info('💾 Storing intent classification in memory...');
            memoryResult = await this.agents.memory.code.execute({
              action: 'store_intent_classification',
              data: {
                ...processedPayload,
                screenshot: screenshotResult?.result?.screenshot?.filepath || null,  // Use file path instead of buffer
                extractedText: screenshotResult?.result?.ocr?.text || null  // Fix OCR text path
              }
            }, {
              database: this.database,
              logger: this.logger,
              userId: context.userId || 'default_user',
              orchestrationService: this.orchestrationService,
              ...context
            });
            
            if (memoryResult.success) {
              this.logger.info('✅ Intent classification stored in memory');
              
              // Attempt backend sync if orchestration service available
              if (this.orchestrationService) {
                try {
                  const syncResult = await this.agents.memory.code.execute({
                    action: 'sync_to_backend',
                    data: {
                      ...processedPayload,
                      screenshot: screenshotResult?.result?.screenshot?.buffer || null,  // Pass only the buffer
                      extractedText: screenshotResult?.result?.ocr?.text || null  // Fix OCR text path
                    }
                  }, {
                    database: this.database,
                    logger: this.logger,
                    userId: context.userId || 'default_user',
                    orchestrationService: this.orchestrationService,
                    ...context
                  });
                  
                  if (syncResult.success && syncResult.synced > 0) {
                    this.logger.info('✅ Memory synced to backend');
                  }
                } catch (syncError) {
                  this.logger.warn('⚠️ Backend sync failed (continuing with local storage):', syncError.message);
                }
              }
            }
            
            results.push({
              intent: 'memory_store',
              action: 'stored',
              metadata: {
                memoryId: memoryResult?.id,
                hasScreenshot: !!screenshotResult?.success,
                hasOCR: !!screenshotResult?.result?.extractedText,
                entitiesStored: entities.length
              }
            });
        }
        
        // Process command intent
        if (intent === 'command') {
          screenshotResult = await this.screenCapture(captureScreen, context);
          console.log('📸 SCREENSHOT RESULTS:', screenshotResult);
          
          // Read screenshot data from file if buffer is empty but filepath exists
          let screenshotData = screenshotResult?.result?.screenshot?.buffer || null;
          if (!screenshotData && screenshotResult?.result?.screenshot?.filepath) {
            try {
              const fs = require('fs');
              screenshotData = fs.readFileSync(screenshotResult.result.screenshot.filepath);
              console.log('📸 Screenshot data read from file:', screenshotData.length, 'bytes');
            } catch (error) {
              console.warn('⚠️ Failed to read screenshot file:', error.message);
              screenshotData = null;
            }
          }
          
          memoryResult = await this.agents.memory.code.execute({
            action: 'store_intent_classification',
            data: {
              ...processedPayload,
              screenshot: screenshotData,  // Use actual screenshot data (buffer or file contents)
              extractedText: screenshotResult?.result?.ocr?.text || null  // Fix OCR text path
            }
          }, {
            database: this.database,
            logger: this.logger,
            userId: context.userId || 'default_user',
            orchestrationService: this.orchestrationService,
            ...context
          });

          // Future: Call orchestration API
          this.logger.info('⚙️ Command intent detected (future: orchestration API)');
          results.push({
            intent: 'command',
            action: 'planned',
            message: 'Command orchestration not yet implemented'
          });
        }
        
        // Process memory_retrieve intent
        if (intent === 'memory_retrieve') {
            // Handle memory retrieval requests (e.g., from MemoryDebugger)
            this.logger.info('🔍 Memory retrieve intent detected - querying UserMemoryAgent');
            
            try {
              const retrieveResult = await this.agents.memory.code.execute({
                action: 'query_intent_memories' // Use the MemoryDebugger-compatible action
              }, {
                logger: this.logger,
                database: context.database || this.database,
                ...context
              });
              
              if (retrieveResult.success) {
                // Handle both array result and object with queryResult property (from test_populate)
                console.log('✅ THE RETRIEVE RESULT:', retrieveResult);
                const memoryArray = Array.isArray(retrieveResult.result?.memories) ? 
                  retrieveResult.result.memories : [];
                const metadata = retrieveResult.metadata || {};
                const retrievedAt = retrieveResult.retrievedAt || new Date().toISOString();
                
                this.logger.info(`✅ Retrieved ${memoryArray.length} memories`);
                results.push({
                  intent: 'memory_retrieve',
                  action: 'retrieved',
                  agent: 'UserMemoryAgent',
                  result: memoryArray,
                  message: `Retrieved ${memoryArray.length} memories`,
                  metadata: { ...metadata, retrievedAt }
                });
              } else {
                this.logger.warn('⚠️ Memory retrieval failed:', retrieveResult.error);
                results.push({
                  intent: 'memory_retrieve',
                  action: 'failed',
                  agent: 'UserMemoryAgent',
                  error: retrieveResult.error,
                  message: 'Memory retrieval failed'
                });
              }
            } catch (error) {
              this.logger.error('❌ Memory retrieve error:', error.message);
              results.push({
                intent: 'memory_retrieve',
                action: 'error',
                agent: 'UserMemoryAgent',
                error: error.message,
                message: 'Memory retrieval error'
              });
            }
        }
        
        // Process question intent
        if (intent === 'question') {
          this.logger.info('❓ Question intent detected');
          
          // If captureScreen is true, capture screenshot for context (e.g., "Help me understand this page?")
          if (captureScreen) {
            this.logger.info('📸 Question requires screenshot context - capturing screen...');
            screenshotResult = await this.screenCapture(captureScreen, context);
            
            // Store the question with screenshot context
            memoryResult = await this.agents.memory.code.execute({
              action: 'store_intent_classification',
              data: {
                ...processedPayload,
                screenshot: screenshotResult?.result?.screenshot?.filepath || null,
                extractedText: screenshotResult?.result?.ocr?.text || null
              }
            }, {
              database: this.database,
              logger: this.logger,
              userId: context.userId || 'default_user',
              orchestrationService: this.orchestrationService,
              ...context
            });
            
            if (memoryResult.success) {
              this.logger.info('✅ Question with screenshot context stored in memory');
            }
          }
          
          results.push({
            intent: 'question',
            action: captureScreen ? 'processed_with_screenshot' : 'processed',
            metadata: {
              hasScreenshot: !!screenshotResult?.success,
              hasOCR: !!screenshotResult?.result?.extractedText,
              memoryStored: !!memoryResult?.success
            }
          });
        }
        
        // Process greeting intent
        if (intent === 'greeting') {
          // Acknowledge but don't process further
          this.logger.info('👋 Greeting acknowledged');
          results.push({
            intent: 'greeting',
            action: 'acknowledged',
            message: 'Greeting processed'
          });
        }
        
        // Handle unknown intents
        if (!['memory_store', 'command', 'memory_retrieve', 'test_populate', 'question', 'greeting'].includes(intent)) {
          this.logger.info(`🤷 Unknown intent: ${intent} (ignoring)`);
          results.push({
            intent,
            action: 'ignored',
            message: `Unknown intent: ${intent}`
          });
        }
      }
      
      this.logger.info(`✅ Intent processing completed: ${results.length} intents processed`);
      
      return {
        success: true,
        primaryIntent,
        intentsProcessed: results,
        memoryStored: !!memoryResult,
        screenshotCaptured: !!screenshotResult?.success,
        entities,
        timestamp: new Date().toISOString(),
        context: {
          requiresMemoryAccess,
          sourceText: sourceText?.substring(0, 100) + '...' || 'No source text'
        }
      };
      
    } catch (error) {
      this.logger.error('❌ Intent orchestration failed:', error);
      
      return {
        success: false,
        error: error.message,
        fallback: 'I encountered an error processing your request. Please try again.'
      };
    }
  }
}
