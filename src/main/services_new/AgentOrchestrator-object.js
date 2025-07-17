/**
 * AgentOrchestrator - Object-based approach
 * Supports both string-based agents (legacy) and object-based agents (new)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AgentOrchestrator {
  constructor() {
    this.agents = new Map();
    this.loadedAgents = new Map();
    this.context = {};
    this.initialized = false;
  }

  async initialize(config = {}) {
    try {
      console.log('🎭 Initializing AgentOrchestrator-object...');
      
      this.context = {
        ...config,
        orchestratorPath: __dirname,
        timestamp: new Date().toISOString()
      };

      // Register default agents
      await this.registerDefaultAgents();
      
      // Preload critical agents
      const criticalAgents = config.preloadAgents || ['UserMemoryAgent'];
      console.log('🚨 Preloading critical agents:', criticalAgents);
      
      await this.preloadAgents(criticalAgents);
      
      this.initialized = true;
      console.log(`✅ AgentOrchestrator initialized with ${this.agents.size} registered agents`);
      
      return { success: true, agentCount: this.agents.size };
      
    } catch (error) {
      console.error('❌ AgentOrchestrator initialization failed:', error);
      throw error;
    }
  }

  /**
   * Register default agents from the agents_new directory
   */
  async registerDefaultAgents() {
    const agentsDir = path.join(__dirname, 'agents_new');
    const defaultAgents = [
      'ScreenCaptureAgent',
      'UserMemoryAgent',
      'IntentParserAgent',
      'PlannerAgent'
    ];

    for (const agentName of defaultAgents) {
      const agentPath = path.join(agentsDir, `${agentName}.js`);
      this.registerAgent(agentName, agentPath);
    }
  }

  /**
   * Register an agent with the orchestrator
   */
  registerAgent(name, filePath) {
    console.log(`📝 Registering agent: ${name} at ${filePath}`);
    this.agents.set(name, { name, filePath });
  }

  /**
   * Preload specified agents
   */
  async preloadAgents(agentNames) {
    for (const agentName of agentNames) {
      try {
        await this.loadAgent(agentName);
        console.log(`🔄 Preloaded agent: ${agentName}`);
      } catch (error) {
        console.warn(`⚠️ Failed to preload agent ${agentName}:`, error.message);
      }
    }
  }

  /**
   * Load an agent from file
   */
  async loadAgent(agentName) {
    if (this.loadedAgents.has(agentName)) {
      return this.loadedAgents.get(agentName);
    }

    try {
      console.log(`📦 Loading agent: ${agentName}`);
      
      const agentInfo = this.agents.get(agentName);
      if (!agentInfo) {
        throw new Error(`Agent ${agentName} not registered`);
      }

      // Import the agent module
      const agentModule = await import(agentInfo.filePath);
      const agentFormat = agentModule.AGENT_FORMAT || agentModule.default;
      
      if (!agentFormat) {
        throw new Error(`Agent ${agentName} does not export AGENT_FORMAT`);
      }

      // Create agent instance based on format type
      let agentInstance;
      
      if (this.isObjectBasedAgent(agentFormat)) {
        // Object-based agent - methods are already defined
        agentInstance = this.createObjectBasedAgent(agentFormat);
      } else {
        // String-based agent - use legacy approach
        agentInstance = await this.createStringBasedAgent(agentFormat);
      }

      this.loadedAgents.set(agentName, agentInstance);
      console.log(`✅ Agent ${agentName} loaded successfully`);
      
      return agentInstance;
      
    } catch (error) {
      console.error(`❌ Failed to load agent ${agentName}:`, error);
      throw error;
    }
  }

  isObjectBasedAgent(agentFormat) {
    // Check if bootstrap and execute are functions (object-based) or strings (string-based)
    return typeof agentFormat.bootstrap === 'function' && typeof agentFormat.execute === 'function';
  }

  createObjectBasedAgent(agentFormat) {
    // Object-based agent - methods are already functions, just bind context
    const agentInstance = {
      name: agentFormat.name,
      description: agentFormat.description,
      schema: agentFormat.schema,
      dependencies: agentFormat.dependencies,
      execution_target: agentFormat.execution_target,
      requires_database: agentFormat.requires_database,
      database_type: agentFormat.database_type,
      
      // Bind all methods to the instance
      bootstrap: agentFormat.bootstrap.bind(agentFormat),
      execute: agentFormat.execute.bind(agentFormat),
      
      // Bind helper methods if they exist
      ...this.bindHelperMethods(agentFormat)
    };

    return agentInstance;
  }

  bindHelperMethods(agentFormat) {
    const helperMethods = {};
    
    // Find all methods that aren't bootstrap/execute
    for (const [key, value] of Object.entries(agentFormat)) {
      if (typeof value === 'function' && !['bootstrap', 'execute'].includes(key)) {
        helperMethods[key] = value.bind(agentFormat);
      }
    }
    
    return helperMethods;
  }

  async createStringBasedAgent(agentFormat) {
    // Legacy string-based agent approach (fallback)
    const agentInstance = {
      name: agentFormat.name || 'UnknownAgent',
      description: agentFormat.description || 'No description provided',
      schema: agentFormat.schema || {},
      dependencies: agentFormat.dependencies || [],
      execution_target: agentFormat.execution_target || 'backend',
      requires_database: agentFormat.requires_database || false,
      database_type: agentFormat.database_type || null
    };

    // Create bootstrap function from string
    if (agentFormat.bootstrap && typeof agentFormat.bootstrap === 'string') {
      try {
        const bootstrapCode = this.extractFunctionBody(agentFormat.bootstrap);
        agentInstance.bootstrap = new AsyncFunction('config', 'context', bootstrapCode);
      } catch (error) {
        console.error(`❌ Failed to create bootstrap function for ${agentInstance.name}:`, error);
        // Provide fallback bootstrap function
        agentInstance.bootstrap = async () => ({ success: true, message: 'Default bootstrap (no code provided)' });
      }
    }

    // Create execute function from string
    if (agentFormat.code && typeof agentFormat.code === 'string') {
      try {
        const executeCode = this.extractFunctionBody(agentFormat.code);
        agentInstance.execute = new AsyncFunction('params', 'context', executeCode);
      } catch (error) {
        console.error(`❌ Failed to create execute function for ${agentInstance.name}:`, error);
        // Provide fallback execute function
        agentInstance.execute = async () => ({ success: false, error: 'No valid execute code provided' });
      }
    } else if (typeof agentFormat.code === 'object' && agentFormat.code !== null) {
      // Handle case where code is an object with methods
      console.log(`ℹ️ Agent ${agentInstance.name} has object-based code, using execute method directly`);
      if (typeof agentFormat.code.execute === 'function') {
        agentInstance.execute = agentFormat.code.execute.bind(agentFormat.code);
      }
    } else {
      // No code provided at all
      console.warn(`⚠️ Agent ${agentInstance.name} has no code property`);
      agentInstance.execute = async () => ({ success: false, error: 'No execute code provided' });
    }

    return agentInstance;
  }

  extractFunctionBody(codeString) {
    // Extract function body from string (legacy support)
    if (!codeString || typeof codeString !== 'string') {
      console.warn('⚠️ Invalid code string provided to extractFunctionBody:', typeof codeString);
      return ''; // Return empty string for invalid input
    }
    
    let cleanCode = codeString.trim();
    
    // Remove async function declaration if present
    cleanCode = cleanCode.replace(/^async\s+function\s*\([^)]*\)\s*\{/, '');
    cleanCode = cleanCode.replace(/^async\s*\([^)]*\)\s*=>\s*\{/, '');
    cleanCode = cleanCode.replace(/^\([^)]*\)\s*=>\s*\{/, '');
    
    // Remove trailing }
    if (cleanCode.endsWith('}')) {
      cleanCode = cleanCode.slice(0, -1);
    }
    
    return cleanCode.trim();
  }

  /**
   * Execute an agent with proper dependency injection and bootstrap
   */
  async executeAgent(agentName, params, context = {}) {
    try {
      console.log(`🎯 Executing ${agentName}.${params.action || 'default'}`);
      
      const agent = await this.loadAgent(agentName);
      const dependencies = {};

      // Bootstrap agent if needed
      if (agent.bootstrap && !agent._bootstrapped) {
        console.log(`🔧 Bootstrapping ${agentName}...`);
        
        // Process dependencies if they exist
        if (agent.dependencies && Array.isArray(agent.dependencies)) {
          for (const dependency of agent.dependencies) {
            try {
              let module;
              const dependencyCamelcase = this.toCamelCase(dependency);
            
              // Standard import for other dependencies
              module = await import(dependency);
              dependencies[dependencyCamelcase] = module.default || module;
            } catch (error) {
              console.warn(`⚠️ Failed to import dependency ${dependency}:`, error.message);
            }
          }
        }
        
        console.log(`🔍 Dependencies being passed to ${agentName}:`, Object.keys(dependencies));
        console.log(`🔍 screenshotDesktop available:`, !!dependencies.screenshotDesktop);
        
        await agent.bootstrap(this.context, { ...this.context, ...context, ...dependencies });
        agent._bootstrapped = true;
        console.log(`✅ ${agentName} bootstrapped successfully`);
      }
      
      // Execute agent with orchestrator reference for agent-to-agent communication
      const enhancedContext = {
        ...this.context,
        ...context,
        ...dependencies, // Dependencies must come after context to avoid being overridden
        orchestrator: this, // Allow agents to call other agents
        executeAgent: this.executeAgent.bind(this), // Direct method access
        getAgent: this.getAgent.bind(this) // Access to other agents
      };
      
      const result = await agent.execute(params, enhancedContext);
      
      console.log(`✅ ${agentName} executed successfully`, enhancedContext);
      return {
        success: true,
        agent: agentName,
        action: params.action || 'default',
        result,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Agent execution failed for ${agentName}:`, error);
      return {
        success: false,
        agent: agentName,
        action: params.action || 'default',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Execute multiple agents in a workflow (agent-to-agent communication)
   * @param {Array} workflow - Array of {agent, params, context} objects
   * @param {Object} sharedContext - Context shared across all agents
   * @returns {Object} Combined results from all agents
   */
  async executeWorkflow(workflow, sharedContext = {}) {
    console.log(`🔄 Executing workflow with ${workflow.length} agents`);
    
    // Initialize workflow state
    const workflowState = {
      workflow,
      currentStep: 0,
      results: [],
      context: { ...sharedContext },
      status: 'running',
      paused: false
    };
    
    // Create workflow control functions
    const workflowControls = this.createWorkflowControls(workflowState);
    
    // Add workflow controls to context for agents to use
    workflowState.context.workflowControls = workflowControls;
    
    return await this.executeWorkflowSteps(workflowState);
  }

  /**
   * Create workflow control functions for agent-to-agent communication
   * @param {Object} workflowState - Current workflow state
   * @returns {Object} Workflow control functions
   */
  createWorkflowControls(workflowState) {
    return {
      start: (stepIndex = 0) => {
        console.log(`🚀 Workflow start() called - jumping to step ${stepIndex}`);
        workflowState.currentStep = stepIndex;
        workflowState.status = 'running';
        workflowState.paused = false;
        return { action: 'start', targetStep: stepIndex };
      },
      
      next: (stepIndex = null) => {
        const targetStep = stepIndex !== null ? stepIndex : workflowState.currentStep + 1;
        console.log(`⏭️ Workflow next() called - jumping to step ${targetStep}`);
        workflowState.currentStep = targetStep;
        return { action: 'next', targetStep };
      },
      
      stop: (reason = 'Manual stop') => {
        console.log(`🛑 Workflow stop() called - ${reason}`);
        workflowState.status = 'stopped';
        return { action: 'stop', reason };
      },
      
      pause: (reason = 'Manual pause') => {
        console.log(`⏸️ Workflow pause() called - ${reason}`);
        workflowState.paused = true;
        return { action: 'pause', reason };
      },
      
      // Utility functions for agents
      getCurrentStep: () => workflowState.currentStep,
      getTotalSteps: () => workflowState.workflow.length,
      getResults: () => workflowState.results,
      getContext: () => workflowState.context,
      getStatus: () => workflowState.status
    };
  }

  /**
   * Execute workflow steps with control flow support
   * @param {Object} workflowState - Workflow state object
   * @returns {Object} Workflow execution result
   */
  async executeWorkflowSteps(workflowState) {
    const { workflow, context } = workflowState;
    
    while (workflowState.currentStep < workflow.length && workflowState.status === 'running') {
      // Check if workflow is paused
      if (workflowState.paused) {
        console.log(`⏸️ Workflow paused at step ${workflowState.currentStep}`);
        break;
      }
      
      const step = workflow[workflowState.currentStep];
      const { agent, params, context: stepContext = {} } = step;
      
      console.log(`📋 Executing workflow step ${workflowState.currentStep + 1}/${workflow.length}: ${agent}.${params.action}`);
      
      try {
        // Execute agent with accumulated context and previous results
        const stepResult = await this.executeAgent(agent, params, {
          ...context,
          ...stepContext,
          previousResults: workflowState.results,
          currentStep: workflowState.currentStep,
          totalSteps: workflow.length,
          workflowControls: context.workflowControls
        });
        
        workflowState.results.push(stepResult);
        
        // Add result to shared context for next agents
        context[`${agent}_result`] = stepResult;
        context[`step_${workflowState.currentStep}_result`] = stepResult;
        
        // Check if agent used workflow controls
        if (stepResult.result && stepResult.result.workflowControl) {
          const control = stepResult.result.workflowControl;
          console.log(`🎛️ Agent ${agent} used workflow control: ${control.action}`);
          
          switch (control.action) {
            case 'next':
              workflowState.currentStep = control.targetStep;
              continue;
            case 'stop':
              workflowState.status = 'stopped';
              break;
            case 'pause':
              workflowState.paused = true;
              break;
            default:
              workflowState.currentStep++;
          }
        } else {
          // Normal progression to next step
          workflowState.currentStep++;
        }
        
        // Stop workflow if step fails (unless configured to continue)
        if (!stepResult.success && !step.continueOnError) {
          console.error(`❌ Workflow stopped at step ${workflowState.currentStep} due to error`);
          workflowState.status = 'failed';
          break;
        }
        
      } catch (error) {
        console.error(`❌ Error executing step ${workflowState.currentStep}:`, error);
        workflowState.results.push({
          success: false,
          agent,
          action: params.action,
          error: error.message,
          step: workflowState.currentStep,
          timestamp: new Date().toISOString()
        });
        
        if (!step.continueOnError) {
          workflowState.status = 'failed';
          break;
        }
        
        workflowState.currentStep++;
      }
    }
    
    // Determine final status
    const finalStatus = workflowState.status === 'running' ? 'completed' : workflowState.status;
    
    return {
      success: workflowState.results.every(r => r.success) && finalStatus === 'completed',
      workflow: true,
      status: finalStatus,
      steps: workflowState.results.length,
      totalSteps: workflow.length,
      currentStep: workflowState.currentStep,
      results: workflowState.results,
      paused: workflowState.paused,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get appropriate agent for an intent
   */
  getAgentForIntent(intent) {
    const intentMap = {
      'capture-screen': 'ScreenCaptureAgent',
      'capture-window': 'ScreenCaptureAgent',
      'extract-text': 'ScreenCaptureAgent',
      'memory-store': 'UserMemoryAgent',
      'memory-retrieve': 'UserMemoryAgent',
      'memory-search': 'UserMemoryAgent',
      'memory-list': 'UserMemoryAgent',
      'parse-intent': 'IntentParserAgent',
      'enrich-memory': 'MemoryEnrichmentAgent'
    };
    
    return intentMap[intent] || null;
  }

  /**
   * Get a loaded agent instance
   */
  getAgent(agentName) {
    return this.loadedAgents.get(agentName);
  }

  /**
   * Convert dependency name to camelCase for consistent injection
   */
  getRegisteredAgents() {
    return Array.from(this.agents.keys());
  }

  getLoadedAgents() {
    return Array.from(this.loadedAgents.keys());
  }

  isAgentLoaded(agentName) {
    return this.loadedAgents.has(agentName);
  }

  toCamelCase(input) {
    return input.replace(/[-.](\w)/g, (_, char) => char.toUpperCase());
  }

  async unloadAgent(agentName) {
    if (this.loadedAgents.has(agentName)) {
      this.loadedAgents.delete(agentName);
      console.log(`🗑️ Agent ${agentName} unloaded`);
      return true;
    }
    return false;
  }

  async reloadAgent(agentName) {
    await this.unloadAgent(agentName);
    return await this.loadAgent(agentName);
  }

}

export default AgentOrchestrator;
           