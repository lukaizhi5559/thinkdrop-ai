/**
 * Execute Command Node
 * 
 * Handles command intent by calling the command MCP service.
 * Interprets natural language commands and executes them safely.
 */

module.exports = async function executeCommand(state) {
  const { message, resolvedMessage, intent, context, mcpClient } = state;
  
  // Only handle command intent
  if (intent?.type !== 'command') {
    return state;
  }
  
  // Use resolved message if available (after coreference resolution), otherwise use original
  const commandMessage = resolvedMessage || message;
  
  try {
    console.log('⚡ [NODE:EXECUTE_COMMAND] Executing command via MCP:', commandMessage);
    if (resolvedMessage && resolvedMessage !== message) {
      console.log('📝 [NODE:EXECUTE_COMMAND] Using resolved message:', message, '→', resolvedMessage);
    }
    
    // Detect if this should use Nut.js automation instead of shell commands
    const shouldUseAutomation = detectAutomationCommand(commandMessage);
    
    if (shouldUseAutomation) {
      console.log('🤖 [NODE:EXECUTE_COMMAND] Detected automation command, using Nut.js API');
      
      // Use Nut.js automation for complex UI interactions
      const commandTimeout = parseInt(process.env.MCP_COMMAND_TIMEOUT || '300000');
      const result = await mcpClient.callService(
        'command',
        'command.automate',
        {
          command: commandMessage,
          context: {
            os: process.platform,
            userId: context.userId,
            sessionId: context.sessionId
          }
        },
        { timeout: commandTimeout } // 5 minutes for code generation + execution
      );
      
      if (!result.success) {
        console.warn('⚠️ [NODE:EXECUTE_COMMAND] Automation failed:', result.error);
        
        // Provide user-friendly error message
        const userFriendlyMessage = `I wasn't able to complete that workflow command. This task might be too complex for me to automate right now.\n\n` +
          `If you'd like help with this, please submit a ticket at **ticket.thinkdrop.ai** and our team will look into it.`;
        
        return {
          ...state,
          answer: userFriendlyMessage,
          commandExecuted: false,
          commandError: result.error, // Keep technical error for logging
          automationAttempted: true
        };
      }
      
      console.log('✅ [NODE:EXECUTE_COMMAND] Automation completed successfully');
      console.log('📊 [NODE:EXECUTE_COMMAND] Provider:', result.metadata?.provider);
      console.log('⏱️ [NODE:EXECUTE_COMMAND] Total time:', result.metadata?.totalTime, 'ms');
      
      return {
        ...state,
        answer: result.result || 'Automation completed successfully',
        commandExecuted: true,
        automationUsed: true,
        automationMetadata: result.metadata
      };
    }
    
    // Use standard shell command execution
    const result = await mcpClient.callService(
      'command',
      'command.execute',
      {
        command: commandMessage,
        context: {
          os: process.platform,
          userId: context.userId,
          sessionId: context.sessionId,
          useOnlineMode: context.useOnlineMode || false, // Pass privacy mode flag
          bypassConfirmation: context.bypassConfirmation || false // Pass confirmation bypass flag
        }
      },
      { timeout: 60000 } // 60 seconds for Ollama LLM interpretation
    );
    
    // Handle confirmation required BEFORE checking success
    if (result.requiresConfirmation && !result.success) {
      console.log('⚠️ [NODE:EXECUTE_COMMAND] Command requires user confirmation');
      
      return {
        ...state,
        requiresConfirmation: true,
        confirmationDetails: {
          command: result.interpretedCommand || commandMessage,
          category: result.category,
          riskLevel: result.riskLevel,
          originalMessage: message,
          resolvedMessage: commandMessage
        },
        commandExecuted: false
      };
    }
    
    if (!result.success) {
      // Handle different error types
      let errorMessage = `I couldn't execute that command: ${result.error}`;
      
      // Provide helpful context based on error type
      if (result.riskLevel === 'critical') {
        errorMessage += '\n\nThis command is blocked for security reasons.';
      } else if (result.riskLevel === 'high') {
        errorMessage += '\n\nThis command requires elevated privileges that I cannot provide.';
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
    
    // Check for Gemini configuration warning
    if (result.geminiWarning) {
      console.warn('⚠️ [NODE:EXECUTE_COMMAND] Gemini warning:', result.geminiWarning.message);
    }
    
    // Success - check if output was interpreted
    console.log('✅ [NODE:EXECUTE_COMMAND] Command executed successfully:', result.executedCommand);
    console.log('📊 [NODE:EXECUTE_COMMAND] Output length:', result.output?.length || 0);
    console.log('🔍 [NODE:EXECUTE_COMMAND] Interpretation source:', result.outputInterpretationSource || 'raw');
    
    // Only skip answer node if Gemini (online mode) interpreted it
    // Ollama interpretation in command service is just pre-processing, still needs answer node
    const isGeminiInterpreted = result.outputInterpretationSource === 'gemini';
    
    if (isGeminiInterpreted) {
      // Gemini already interpreted - use as final answer (skip answer node)
      return {
        ...state,
        answer: result.output,
        commandExecuted: true,
        executedCommand: result.executedCommand,
        commandCategory: result.category,
        executionTime: result.executionTime,
        interpretationSource: 'gemini',
        geminiWarning: result.geminiWarning // Pass warning if present
      };
    } else {
      // Check if this is a simple command that should use raw output
      const simpleNetworkCommands = ['ifconfig.me', 'ipconfig', 'ifconfig'];
      const isSimpleNetworkCommand = result.category === 'network' && 
        simpleNetworkCommands.some(cmd => result.executedCommand?.includes(cmd));
      
      // Check if this is a version check command (generic - any tool with version flags)
      const versionCheckPatterns = [
        /\s+--version(\s|$)/i,
        /\s+-v(\s|$)/i,
        /\s+-V(\s|$)/i,
        /\s+version(\s|$)/i
      ];
      const isVersionCheck = result.category === 'system_info' && 
        versionCheckPatterns.some(pattern => pattern.test(result.executedCommand || ''));
      
      // Check if this is a directory listing command
      const isDirectoryListing = result.category === 'file_read' && 
        /^(ls|ll|la)\s/.test(result.executedCommand || '');
      
      if (isSimpleNetworkCommand && result.rawOutput) {
        // For simple network commands, use raw output with nice formatting
        const formattedOutput = result.rawOutput.trim();
        return {
          ...state,
          answer: `Your IP address is: **${formattedOutput}**`,
          commandExecuted: true,
          executedCommand: result.executedCommand,
          commandCategory: result.category,
          executionTime: result.executionTime,
          needsInterpretation: false,
          outputInterpretationSource: 'raw',
          geminiWarning: result.geminiWarning
        };
      }
      
      if (isVersionCheck && result.rawOutput) {
        // For version checks, use raw output with nice formatting
        const formattedOutput = result.rawOutput.trim();
        const toolName = result.executedCommand?.split(/\s+/)[0] || 'tool';
        return {
          ...state,
          answer: `**${toolName}** version: **${formattedOutput}**`,
          commandExecuted: true,
          executedCommand: result.executedCommand,
          commandCategory: result.category,
          executionTime: result.executionTime,
          needsInterpretation: false,
          outputInterpretationSource: 'raw',
          geminiWarning: result.geminiWarning
        };
      }
      
      if (isDirectoryListing && result.rawOutput) {
        // For directory listings, use raw output in a code block
        const formattedOutput = result.rawOutput.trim();
        return {
          ...state,
          answer: `\`\`\`\n${formattedOutput}\n\`\`\``,
          commandExecuted: true,
          executedCommand: result.executedCommand,
          commandCategory: result.category,
          executionTime: result.executionTime,
          needsInterpretation: false,
          outputInterpretationSource: 'raw',
          geminiWarning: result.geminiWarning
        };
      }
      
      // Raw or Ollama-interpreted output - pass to answer node
      return {
        ...state,
        commandOutput: result.output,
        commandExecuted: true,
        executedCommand: result.executedCommand,
        commandCategory: result.category,
        executionTime: result.executionTime,
        needsInterpretation: true,
        outputInterpretationSource: result.outputInterpretationSource,
        geminiWarning: result.geminiWarning // Pass warning if present
      };
    }
    
  } catch (error) {
    console.error('❌ [NODE:EXECUTE_COMMAND] Error:', error.message);
    
    // Check if this might be a screen intelligence question misclassified as command
    // Comprehensive list of screen-related keywords that indicate visual/content questions
    const screenKeywords = [
      // Question words
      'what', 'which', 'where', 'how',
      // Visual verbs
      'show', 'see', 'display', 'view', 'look', 'watch', 'read',
      // Screen/content nouns
      'screen', 'page', 'chapter', 'section', 'article', 'paragraph', 'line',
      'tab', 'window', 'browser', 'website', 'site',
      // Content actions
      'reading', 'viewing', 'watching', 'looking at', 'on my screen',
      // Document/media
      'document', 'file', 'video', 'image', 'picture', 'photo',
      // Specific content
      'title', 'heading', 'text', 'content', 'verse', 'passage'
    ];
    const hasScreenKeyword = screenKeywords.some(keyword => 
      message.toLowerCase().includes(keyword) || (resolvedMessage && resolvedMessage.toLowerCase().includes(keyword))
    );
    
    // If command service is down AND message contains screen-related keywords, retry as screen_intelligence
    const isServiceDown = error.message?.includes('ECONNREFUSED') || error.message?.includes('connect');
    
    if (isServiceDown && hasScreenKeyword) {
      console.log('🔄 [NODE:EXECUTE_COMMAND] Command service down + screen keywords detected → Retrying as screen_intelligence');
      
      // Override intent to screen_intelligence and let the graph retry
      return {
        ...state,
        intent: {
          type: 'screen_intelligence',
          confidence: 0.95,
          fallbackFrom: 'command'
        },
        commandExecuted: false,
        error: null, // Clear error so validation doesn't fail
        retryWithIntent: 'screen_intelligence'
      };
    }
    
    // Provide user-friendly error message for unexpected failures
    const userFriendlyMessage = `I ran into an issue trying to complete that command. This might be a temporary problem or the task might be too complex for me right now.\n\n` +
      `If this keeps happening, please submit a ticket at **ticket.thinkdrop.ai** so our team can help.`;
    
    return {
      ...state,
      answer: userFriendlyMessage,
      commandExecuted: false,
      error: error.message // Keep technical error for logging
    };
  }
};

/**
 * Detect if a command should use Nut.js automation instead of shell commands
 * @param {string} command - The command message
 * @returns {boolean} - True if should use automation
 */
function detectAutomationCommand(command) {
  const lowerCommand = command.toLowerCase();
  
  // Keywords that indicate UI automation is needed
  const automationKeywords = [
    // Calendar/reminder operations
    'calendar', 'reminder', 'appointment', 'schedule', 'meeting',
    // UI interactions
    'click', 'type', 'navigate', 'browse', 'search for',
    // Application workflows
    'compose', 'email', 'message', 'post', 'tweet',
    // Shopping/browsing
    'find', 'shop', 'buy', 'purchase', 'amazon', 'ebay',
    // Complex multi-step tasks
    'set a', 'create a', 'make a', 'add a',
    // Specific apps that need UI automation
    'chrome', 'safari', 'firefox', 'slack', 'discord', 'spotify'
  ];
  
  // Phrases that indicate complex automation
  const automationPhrases = [
    'set a calendar reminder',
    'set a reminder',
    'add to calendar',
    'create calendar event',
    'open and navigate',
    'find on',
    'search on',
    'buy on',
    'shop for',
    'compose email',
    'send message'
  ];
  
  // Check for automation phrases first (more specific)
  for (const phrase of automationPhrases) {
    if (lowerCommand.includes(phrase)) {
      return true;
    }
  }
  
  // Check for automation keywords
  for (const keyword of automationKeywords) {
    if (lowerCommand.includes(keyword)) {
      // Additional context check - avoid false positives for simple commands
      // e.g., "open calendar" is simple, but "set a calendar reminder" is complex
      const simpleOpenPattern = /^(open|launch|start)\s+\w+$/i;
      if (simpleOpenPattern.test(command)) {
        return false; // Simple app opening, use shell command
      }
      return true;
    }
  }
  
  return false;
}
