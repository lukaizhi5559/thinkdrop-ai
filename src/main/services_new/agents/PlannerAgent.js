/**
 * PlannerAgent - Strategizes agent sequences based on user goals
 * Generates execution plans for agent-to-agent communication chains
 * 
 * LLM-Compatible JSON Structure Format
 */

// Agent code object containing all executable logic
const code = {

  /**
   * Main execution method - Generate execution plan based on user input and intent
   * @param {Object} input - Input data containing message and intent
   * @param {Object} context - Execution context including llmClient and logger
   * @returns {Promise<Object>} - Agent execution result
   */
  async execute(input, context) {
    try {
      const { message, intent } = input;
      const { logger } = context;
      
      if (logger) {
        logger.info(`📋 Planning execution for intent: ${intent}`);
      }
      
      // Generate plan based on intent
      const plan = await this.generatePlan(message, intent, context);
      
      return {
        success: true,
        result: {
          plan,
          strategy: plan.strategy || 'sequential',
          estimatedTime: this.estimateExecutionTime(plan),
          complexity: this.assessComplexity(plan)
        },
        metadata: {
          agent: 'PlannerAgent',
          planGenerated: true,
          agentCount: plan.agents?.length || 0
        }
      };
      
    } catch (error) {
      const { logger } = context;
      if (logger) {
        logger.error(`❌ PlannerAgent execution failed: ${error.message}`);
      }
      
      return {
        success: false,
        error: error.message,
        result: this.getFallbackPlan(input.intent)
      };
    }
  },

  /**
   * Generate execution plan using LLM
   */
  async generatePlan(message, intent, context) {
    const { llmClient, logger } = context;
    const prompt = this.buildPlanningPrompt(message, intent, context);
    
    try {
      const response = await llmClient(prompt, {
        temperature: 0.1,
        maxTokens: 500,
        timeout: 10000
      });
      
      // Parse LLM response
      const plan = this.parsePlanResponse(response, logger);
      
      // Validate and enhance plan
      return this.validateAndEnhancePlan(plan, intent, logger);
      
    } catch (error) {
      if (logger) {
        logger.warn(`LLM planning failed, using fallback: ${error.message}`);
      }
      return this.getFallbackPlan(intent);
    }
  },

  /**
   * Build planning prompt for LLM
   */
  buildPlanningPrompt(message, intent, context) {
    return `You are a planning agent that creates execution plans for other agents.

User Message: "${message}"
Detected Intent: ${intent}
Context: ${JSON.stringify(context.metadata || {})}

Available Agents:
- IntentParserAgent: Parse and classify user intents
- UserMemoryAgent: Store and retrieve user memories
- ScreenCaptureAgent: Capture and analyze screenshots
- BackendAgent: Communicate with backend services
- LLMAgent: Process natural language tasks

Create an execution plan as JSON:
{
  "agents": [
    {
      "name": "AgentName",
      "input": { "key": "value" },
      "description": "What this agent will do"
    }
  ],
  "strategy": "sequential|parallel",
  "description": "Overall plan description"
}

Focus on the specific intent: ${intent}`;
  },

  /**
   * Parse LLM response into plan object
   */
  parsePlanResponse(response, logger) {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const plan = JSON.parse(jsonMatch[0]);
      
      if (!plan.agents || !Array.isArray(plan.agents)) {
        throw new Error('Invalid plan structure');
      }
      
      return plan;
      
    } catch (error) {
      if (logger) {
        logger.error(`Failed to parse plan response: ${error.message}`);
      }
      throw error;
    }
  },

  /**
   * Validate and enhance the generated plan
   */
  validateAndEnhancePlan(plan, intent, logger) {
    // Ensure required fields
    plan.strategy = plan.strategy || 'sequential';
    plan.description = plan.description || `Execution plan for ${intent}`;
    
    // Validate agents
    plan.agents = plan.agents.filter(agent => {
      if (!agent.name) {
        if (logger) {
          logger.warn('Removing agent without name from plan');
        }
        return false;
      }
      return true;
    });
    
    // Add metadata
    plan.metadata = {
      generatedAt: new Date().toISOString(),
      intent,
      agentCount: plan.agents.length
    };
    
    return plan;
  },

  /**
   * Get fallback plan for known intents
   */
  getFallbackPlan(intent) {
    const fallbackPlans = {
      'memory_store': {
        agents: [
          {
            name: 'UserMemoryAgent',
            input: { action: 'store' },
            description: 'Store user information in memory'
          }
        ],
        strategy: 'sequential',
        description: 'Store information in user memory'
      },
      
      'memory_retrieve': {
        agents: [
          {
            name: 'UserMemoryAgent',
            input: { action: 'retrieve' },
            description: 'Retrieve user information from memory'
          }
        ],
        strategy: 'sequential',
        description: 'Retrieve information from user memory'
      },
      
      'external_data_required': {
        agents: [
          {
            name: 'BackendAgent',
            input: { action: 'orchestrate' },
            description: 'Request backend orchestration for complex task'
          }
        ],
        strategy: 'sequential',
        description: 'Escalate to backend for complex processing'
      },
      
      'command': {
        agents: [
          {
            name: 'ScreenCaptureAgent',
            input: { action: 'capture' },
            description: 'Capture current screen for context'
          },
          {
            name: 'UserMemoryAgent',
            input: { action: 'store' },
            description: 'Store interaction context'
          }
        ],
        strategy: 'sequential',
        description: 'Execute command with screen context'
      }
    };
    
    return fallbackPlans[intent] || {
      agents: [
        {
          name: 'UserMemoryAgent',
          input: { action: 'store' },
          description: 'Store interaction for future reference'
        }
      ],
      strategy: 'sequential',
      description: 'Default fallback plan'
    };
  },

  /**
   * Estimate execution time for plan
   */
  estimateExecutionTime(plan) {
    const baseTime = 1000; // 1 second base
    const agentTime = plan.agents?.length * 2000 || 2000; // 2 seconds per agent
    
    return baseTime + agentTime;
  },

  /**
   * Assess plan complexity
   */
  assessComplexity(plan) {
    const agentCount = plan.agents?.length || 0;
    
    if (agentCount <= 1) return 'simple';
    if (agentCount <= 3) return 'medium';
    return 'complex';
  }
};

// Default export with LLM-compatible JSON structure
export default {
  name: 'PlannerAgent',
  description: 'Strategizes agent sequences based on user goals and generates execution plans for agent-to-agent communication chains with LLM-powered planning',
  code,
  dependencies: [],
  execution_target: 'backend',
  requires_database: false,
  config: {
    llm_timeout: 10000,
    max_tokens: 500,
    temperature: 0.1,
    planning_strategy: 'sequential',
    fallback_enabled: true
  },
  secrets: [],
  orchestrator_metadata: {
    chain_order: 2,
    resource_requirements: {
      memory: 'medium',
      cpu: 'medium',
      network: 'required'
    },
    typical_execution_time_ms: 5000,
    can_run_parallel: false,
    output_format: {
      plan: 'object',
      strategy: 'string',
      estimatedTime: 'number',
      complexity: 'string'
    },
    requires_llm: true
  }
};
