/**
 * ScreenCaptureIntegrationTest - Test the agent chain workflow
 * 
 * This test demonstrates the Phase 1 use case:
 * User: "Give me a response to this email"
 * 1. ScreenCaptureAgent captures screenshot + OCR
 * 2. UserMemoryAgent stores screenshot and text
 * 3. LLM processes the context and generates response
 * 4. Response displayed in ChatMessage window
 */

const { AgentOrchestrator } = require('../AgentOrchestrator');
const { ScreenCaptureAgent } = require('../agents/ScreenCaptureAgent');
const { UserMemoryAgent } = require('../agents/UserMemoryAgent');

class ScreenCaptureIntegrationTest {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.mockDatabase = options.mockDatabase;
        this.mockLLMClient = options.mockLLMClient;
    }

    async runEmailResponseScenario() {
        try {
            this.logger.info('🧪 Starting Email Response Scenario Test...');

            // Step 1: Initialize agents
            const screenCaptureAgent = new ScreenCaptureAgent();
            const userMemoryAgent = new UserMemoryAgent({ 
                database: this.mockDatabase 
            });

            // Step 2: Simulate user request
            const userInput = "Give me a response to this email";
            this.logger.info(`👤 User Input: "${userInput}"`);

            // Step 3: Execute ScreenCaptureAgent
            this.logger.info('📸 Executing ScreenCaptureAgent...');
            const captureResult = await screenCaptureAgent.execute({
                action: 'capture_and_extract',
                options: {
                    format: 'png',
                    quality: 0.9
                }
            }, {
                userMemoryAgent: userMemoryAgent,
                purpose: 'email_response_context'
            });

            if (!captureResult.success) {
                throw new Error(`Screenshot capture failed: ${captureResult.error}`);
            }

            this.logger.info('✅ Screenshot captured and OCR completed');
            this.logger.info(`📊 OCR Results: ${captureResult.data.ocr.text.length} characters extracted`);

            // Step 4: Verify memory storage
            const memoryKey = captureResult.data.storage?.memoryKey;
            if (memoryKey) {
                const retrieveResult = await userMemoryAgent.execute({
                    action: 'retrieve',
                    key: memoryKey
                });

                if (retrieveResult.success) {
                    this.logger.info('✅ Screenshot and OCR data stored in UserMemoryAgent');
                    this.logger.info(`💾 Memory Key: ${memoryKey}`);
                } else {
                    this.logger.warn('⚠️ Failed to verify memory storage');
                }
            }

            // Step 5: Generate AI response using extracted context
            const emailContext = captureResult.data.ocr.text;
            const aiResponse = await this.generateEmailResponse(emailContext, userInput);

            // Step 6: Format final result for ChatMessage display
            const finalResult = {
                success: true,
                scenario: 'email_response',
                userInput,
                captureData: {
                    screenshotSize: captureResult.data.screenshot.size,
                    ocrText: captureResult.data.ocr.text,
                    confidence: captureResult.data.ocr.confidence,
                    wordCount: captureResult.data.summary.wordCount
                },
                memoryStorage: {
                    stored: !!captureResult.data.storage?.success,
                    memoryKey: captureResult.data.storage?.memoryKey,
                    dataSize: captureResult.data.storage?.dataSize
                },
                aiResponse,
                timestamp: new Date().toISOString()
            };

            this.logger.info('🎉 Email Response Scenario completed successfully!');
            this.logger.info(`🤖 AI Response: ${aiResponse.substring(0, 100)}...`);

            return finalResult;

        } catch (error) {
            this.logger.error('❌ Email Response Scenario failed:', error);
            return {
                success: false,
                error: error.message,
                scenario: 'email_response'
            };
        }
    }

    async generateEmailResponse(emailContext, userRequest) {
        // Simulate LLM processing of the email context
        // In production, this would use the actual LLM client
        
        if (!emailContext || emailContext.trim().length === 0) {
            return "I couldn't extract any text from the screenshot. Please ensure the email is clearly visible and try again.";
        }

        // Mock response generation based on extracted text
        const contextPreview = emailContext.substring(0, 200);
        
        return `Based on the email content I can see: "${contextPreview}..."

Here's a suggested response:

Thank you for your email. I've reviewed the content and would like to respond as follows:

[This would be a contextually appropriate response generated by the LLM based on the email content extracted via OCR]

Would you like me to help you refine this response or capture a different email?`;
    }

    async runAgentChainTest() {
        try {
            this.logger.info('🔗 Testing Agent Chain Integration...');

            // Initialize AgentOrchestrator
            const orchestrator = new AgentOrchestrator({
                llmClient: this.mockLLMClient,
                database: this.mockDatabase,
                logger: this.logger
            });

            await orchestrator.initialize();

            // Test agent chain execution
            const chainResult = await orchestrator.executeAgentChain([
                {
                    agent: 'screenCapture',
                    input: {
                        action: 'capture_and_extract',
                        options: { format: 'png' }
                    }
                },
                {
                    agent: 'memory',
                    input: {
                        action: 'store_screenshot',
                        data: '${previous.data}' // Reference to previous agent output
                    }
                }
            ]);

            this.logger.info('✅ Agent chain test completed');
            return chainResult;

        } catch (error) {
            this.logger.error('❌ Agent chain test failed:', error);
            return { success: false, error: error.message };
        }
    }

    // Mock implementations for testing
    createMockDatabase() {
        const mockData = new Map();
        
        return {
            run: async (query, params) => {
                // Mock database operations
                if (query.includes('INSERT INTO user_memories')) {
                    const [id, key, value] = params;
                    mockData.set(key, { id, key, value, timestamp: new Date().toISOString() });
                    return { changes: 1 };
                }
                return { changes: 0 };
            },
            get: async (query, params) => {
                const [key] = params;
                return mockData.get(key) || null;
            },
            all: async (query, params) => {
                return Array.from(mockData.values());
            }
        };
    }

    createMockLLMClient() {
        return async (prompt, options = {}) => {
            // Mock LLM responses for testing
            if (prompt.includes('email') || prompt.includes('response')) {
                return "This is a mock LLM response for email processing.";
            }
            return "Mock LLM response";
        };
    }
}

// Export for use in tests
module.exports = { ScreenCaptureIntegrationTest };

// Run test if called directly
if (require.main === module) {
    const test = new ScreenCaptureIntegrationTest({
        logger: console
    });
    
    test.mockDatabase = test.createMockDatabase();
    test.mockLLMClient = test.createMockLLMClient();
    
    test.runEmailResponseScenario()
        .then(result => {
            console.log('\n📋 Test Results:');
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(error => {
            console.error('Test execution failed:', error);
        });
}
