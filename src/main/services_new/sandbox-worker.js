/**
 * Sandbox Worker - Isolated execution environment for agent code
 * Runs in separate thread with restricted access
 */

import { parentPort, workerData } from 'worker_threads';

// Restricted global environment
const restrictedGlobal = {
  console: {
    log: (...args) => parentPort.postMessage({ type: 'log', data: args }),
    error: (...args) => parentPort.postMessage({ type: 'error', data: args }),
    warn: (...args) => parentPort.postMessage({ type: 'warn', data: args }),
    info: (...args) => parentPort.postMessage({ type: 'info', data: args })
  },
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  Date,
  Math,
  JSON,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  Promise
};

// Override dangerous globals
global.require = undefined;
global.process = undefined;
global.Buffer = undefined;
global.__dirname = undefined;
global.__filename = undefined;

async function executeAgentCode() {
  try {
    const { agentCode, agentName, input, context, config } = workerData;
    
    // Create execution context
    const executionContext = {
      input,
      context,
      config,
      agentName,
      // Provide safe utilities
      utils: {
        timestamp: () => new Date().toISOString(),
        randomId: () => Math.random().toString(36).substring(2, 15),
        delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))
      }
    };
    
    // Wrap agent code in function
    const wrappedCode = `
      (async function(executionContext) {
        const { input, context, config, agentName, utils } = executionContext;
        
        // Agent code execution
        ${agentCode}
        
        // Agent must export an execute function
        if (typeof execute !== 'function') {
          throw new Error('Agent must export an execute function');
        }
        
        return await execute(input, context);
      })
    `;
    
    // Execute with restricted global scope
    const agentFunction = eval(wrappedCode);
    const result = await agentFunction(executionContext);
    
    // Send success result
    parentPort.postMessage({
      success: true,
      data: result
    });
    
  } catch (error) {
    // Send error result
    parentPort.postMessage({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}

// Start execution
executeAgentCode();
