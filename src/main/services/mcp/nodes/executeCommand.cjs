/**
 * Execute Command Node
 * 
 * Handles command intent by calling the command MCP service.
 * Interprets natural language commands and executes them safely.
 */

module.exports = async function executeCommand(state) {
  const { message, intent, context, mcpClient } = state;
  
  // Only handle command intent
  if (intent?.type !== 'command') {
    return state;
  }
  
  try {
    console.log('⚡ [NODE:EXECUTE_COMMAND] Executing command via MCP:', message);
    
    // Use longer timeout for command execution (Ollama interpretation can be slow)
    const result = await mcpClient.callService(
      'command',
      'command.execute',
      {
        command: message,
        context: {
          os: process.platform,
          userId: context.userId,
          sessionId: context.sessionId
        }
      },
      { timeout: 60000 } // 60 seconds for Ollama LLM interpretation
    );
    
    if (!result.success) {
      // Handle different error types
      let errorMessage = `I couldn't execute that command: ${result.error}`;
      
      // Provide helpful context based on error type
      if (result.riskLevel === 'critical') {
        errorMessage += '\n\nThis command is blocked for security reasons.';
      } else if (result.riskLevel === 'high') {
        errorMessage += '\n\nThis command requires elevated privileges that I cannot provide.';
      } else if (result.requiresConfirmation) {
        errorMessage = `This command requires confirmation:\n\n"${result.interpretedCommand}"\n\nCategory: ${result.category}\nRisk level: ${result.riskLevel}\n\nWould you like me to proceed?`;
      } else if (result.error?.includes('not in allowed categories')) {
        errorMessage = `I'm not allowed to execute commands in that category. I can help with:\n- Opening applications\n- Checking system information\n- Reading files and directories`;
      }
      
      console.warn('⚠️ [NODE:EXECUTE_COMMAND] Command execution failed:', result.error);
      
      return {
        ...state,
        answer: errorMessage,
        commandExecuted: false,
        commandError: result.error,
        interpretedCommand: result.interpretedCommand
      };
    }
    
    // Success - return raw output for answer node to interpret
    console.log('✅ [NODE:EXECUTE_COMMAND] Command executed successfully:', result.executedCommand);
    console.log('📊 [NODE:EXECUTE_COMMAND] Raw output length:', result.output?.length || 0);
    
    return {
      ...state,
      // Pass raw output to answer node for human-friendly interpretation
      commandOutput: result.output,
      commandExecuted: true,
      executedCommand: result.executedCommand,
      commandCategory: result.category,
      executionTime: result.executionTime,
      // Signal that answer node should interpret this
      needsInterpretation: true
    };
    
  } catch (error) {
    console.error('❌ [NODE:EXECUTE_COMMAND] Error:', error.message);
    
    return {
      ...state,
      answer: `Sorry, I encountered an error executing that command: ${error.message}`,
      commandExecuted: false,
      error: error.message
    };
  }
};
