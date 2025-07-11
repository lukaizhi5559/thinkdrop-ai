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

  /**
   * Main entry point for user input
   * Orchestrates agent-to-agent communication flow
   */
  async ask(userInput, context = {}) {
    if (!this.isInitialized) {
      throw new Error('AgentOrchestrator not initialized. Call initialize() first.');
    }

    try {
      this.logger.info('🎯 Processing user input:', userInput);
      
      // Step 1: Parse intent
      const intentResult = await this.agents.intent.code.execute({
        message: userInput
      }, {
        llmClient: this.llmClient,
        logger: this.logger,
        ...context
      });
      
      this.logger.info('🔍 Intent detected:', intentResult.intent);
      
      // Step 2: Generate execution plan
      const planResult = await this.agents.planner.code.execute({
        message: userInput,
        intent: intentResult.intent
      }, {
        llmClient: this.llmClient,
        logger: this.logger,
        ...context,
        intentResult
      });
      
      this.logger.info('📋 Execution plan generated:', planResult.plan);
      
      // Step 3: Execute agent chain
      const executionResult = await this.executeAgentChain(planResult.plan, {
        ...context,
        userInput,
        intentResult,
        planResult
      });
      
      // Step 4: Store interaction in memory
      await this.agents.memory.code.execute({
        action: 'store_interaction',
        data: {
          userInput,
          intent: intentResult.intent,
          plan: planResult.plan,
          result: executionResult,
          timestamp: new Date().toISOString()
        }
      }, {
        database: this.database,
        logger: this.logger,
        ...context
      });
      
      return {
        success: true,
        intent: intentResult.intent,
        plan: planResult.plan,
        result: executionResult,
        metadata: {
          executionTime: Date.now() - context.startTime,
          agentsUsed: planResult.plan?.agents || []
        }
      };
      
    } catch (error) {
      this.logger.error('❌ AgentOrchestrator execution failed:', error);
      
      return {
        success: false,
        error: error.message,
        fallback: 'I encountered an error processing your request. Please try again.'
      };
    }
  }

  /**
   * Execute a chain of agents based on the plan
   */
  async executeAgentChain(plan, context) {
    if (!plan || !plan.agents) {
      throw new Error('Invalid execution plan provided');
    }

    const results = [];
    let chainContext = { ...context };

    for (const agentSpec of plan.agents) {
      try {
        this.logger.info(`🔄 Executing agent: ${agentSpec.name}`);
        
        let agent;
        
        // Check if it's a core agent
        if (this.agents[agentSpec.name]) {
          agent = this.agents[agentSpec.name];
        } else {
          // Load dynamic agent
          agent = await this.loadDynamicAgent(agentSpec);
        }
        
        // Execute agent
        const agentResult = await agent.execute(agentSpec.input || {}, chainContext);
        
        // Update chain context with result
        chainContext = {
          ...chainContext,
          [`${agentSpec.name}_result`]: agentResult,
          previousResults: results
        };
        
        results.push({
          agent: agentSpec.name,
          success: true,
          result: agentResult,
          timestamp: new Date().toISOString()
        });
        
        this.logger.info(`✅ Agent ${agentSpec.name} completed successfully`);
        
      } catch (error) {
        this.logger.error(`❌ Agent ${agentSpec.name} failed:`, error);
        
        results.push({
          agent: agentSpec.name,
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        
        // Handle failure based on plan strategy
        if (plan.strategy === 'fail_fast') {
          throw error;
        }
        // Continue with next agent if strategy is 'continue_on_error'
      }
    }

    return {
      chainResults: results,
      finalContext: chainContext,
      success: results.every(r => r.success)
    };
  }

  /**
   * Load and prepare dynamic agent for execution
   */
  async loadDynamicAgent(agentSpec) {
    try {
      // First check if agent exists locally
      const localAgent = await this.findLocalAgent(agentSpec.name);
      if (localAgent) {
        return localAgent;
      }
      
      // Fetch from backend if not found locally
      const agentData = await this.orchestrationService.getAgent(agentSpec.name);
      
      // Create sandboxed agent
      const sandboxedAgent = await this.sandbox.createAgent(agentData);
      
      return sandboxedAgent;
      
    } catch (error) {
      this.logger.error(`Failed to load dynamic agent ${agentSpec.name}:`, error);
      throw error;
    }
  }

  /**
   * Find agent in local registry
   */
  async findLocalAgent(agentName) {
    // Implementation for finding locally cached agents
    // This would integrate with existing agent discovery
    return null;
  }

  /**
   * Get orchestrator status and health
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      coreAgents: Object.keys(this.agents).length,
      sandboxStatus: this.sandbox?.getStatus() || 'not_initialized',
      lastActivity: this.lastActivity || null
    };
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    this.logger.info('🛑 Shutting down AgentOrchestrator...');
    
    // Cleanup sandbox
    if (this.sandbox) {
      await this.sandbox.cleanup();
    }
    
    // Cleanup agents
    for (const agent of Object.values(this.agents)) {
      if (agent.cleanup) {
        await agent.cleanup();
      }
    }
    
    this.isInitialized = false;
    this.logger.info('✅ AgentOrchestrator shutdown complete');
  }
}
