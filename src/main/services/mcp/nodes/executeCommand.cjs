/**
 * Execute Command Node
 * 
 * Handles command intent by calling the command MCP service.
 * Interprets natural language commands and executes them safely.
 */

module.exports = async function executeCommand(state) {
  const { message, resolvedMessage, intent, context, mcpClient } = state;
  
  // Handle all command sub-types
  const commandTypes = ['command_execute', 'command_automate', 'command_guide'];
  if (!commandTypes.includes(intent?.type)) {
    return state;
  }
  
  // Use resolved message if available (after coreference resolution), otherwise use original
  const commandMessage = resolvedMessage || message;
  
  try {
    console.log(`⚡ [NODE:EXECUTE_COMMAND] Executing ${intent.type} via MCP:`, commandMessage);
    if (resolvedMessage && resolvedMessage !== message) {
      console.log('📝 [NODE:EXECUTE_COMMAND] Using resolved message:', message, '→', resolvedMessage);
    }
    
    // Route based on ML-classified intent type
    if (intent.type === 'command_guide') {
      console.log('🎓 [NODE:EXECUTE_COMMAND] Educational guide mode detected');
      return await executeGuide(state, mcpClient, commandMessage, context);
    }
    
    if (intent.type === 'command_automate') {
      console.log('🤖 [NODE:EXECUTE_COMMAND] UI automation mode detected');
      
      // Hide ThinkDrop AI window during automation to prevent focus interference
      try {
        if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
          global.overlayWindow.hide();
          console.log('🙈 [NODE:EXECUTE_COMMAND] Hidden overlay window for automation');
        } else {
          console.warn('⚠️ [NODE:EXECUTE_COMMAND] Overlay window not available');
        }
      } catch (hideError) {
        console.warn('⚠️ [NODE:EXECUTE_COMMAND] Could not hide window:', hideError.message);
      }
      
      try {
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
        
        // Restore window after automation completes
        try {
          if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
            global.overlayWindow.show();
            console.log('👁️ [NODE:EXECUTE_COMMAND] Restored overlay window after automation');
          }
        } catch (showError) {
          console.warn('⚠️ [NODE:EXECUTE_COMMAND] Could not restore window:', showError.message);
        }
      
      if (!result.success) {
        // Check if this is an uncertain result (task may have completed but couldn't verify)
        if (result.uncertainResult) {
          console.warn('⚠️ [NODE:EXECUTE_COMMAND] Automation result uncertain:', result.warning || result.error);
          
          // Use the warning message from the backend, or provide a default
          const uncertainMessage = result.warning || 
            `I attempted to complete that task, but couldn't fully verify the result. **Please check if your task was completed successfully.**\n\n` +
            `If it didn't work as expected, please submit a ticket at **ticket.thinkdrop.ai** and our team will help improve the automation.`;
          
          return {
            ...state,
            answer: uncertainMessage,
            commandExecuted: true, // Task was attempted
            automationUsed: true,
            uncertainResult: true,
            automationMetadata: result.metadata,
            planFailure: result.planFailure // Include plan failure details if available
          };
        }
        
        // True failure - task didn't execute at all
        console.warn('⚠️ [NODE:EXECUTE_COMMAND] Automation failed:', result.error);
        
        const userFriendlyMessage = `I attempted to help with that task. Please check if the results are what you expected.\n\n` +
          `If you need further assistance, feel free to submit a ticket at **ticket.thinkdrop.ai** and our team will help improve this.`;
        
        return {
          ...state,
          answer: userFriendlyMessage,
          commandExecuted: false,
          commandError: result.error,
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
      } catch (automationError) {
        // Ensure window is restored even if automation fails
        try {
          if (global.overlayWindow && !global.overlayWindow.isDestroyed()) {
            global.overlayWindow.show();
            console.log('👁️ [NODE:EXECUTE_COMMAND] Restored overlay window after automation error');
          }
        } catch (showError) {
          console.warn('⚠️ [NODE:EXECUTE_COMMAND] Could not restore window after error:', showError.message);
        }
        
        // Re-throw to be handled by outer catch
        throw automationError;
      }
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
 * Execute educational guide mode
 * @param {object} state - Current state
 * @param {object} mcpClient - MCP client
 * @param {string} commandMessage - Command message
 * @param {object} context - Context object
 * @returns {object} - Updated state
 */
async function executeGuide(state, mcpClient, commandMessage, context) {
  try {
    const result = await mcpClient.callService(
      'command',
      'command.guide',
      {
        command: commandMessage,
        context: {
          os: process.platform,
          userId: context.userId,
          sessionId: context.sessionId
        }
      },
      { timeout: 300000 } // 5 minutes for guide generation
    );
    
    if (!result.success) {
      console.warn('⚠️ [NODE:EXECUTE_COMMAND] Guide generation failed:', result.error);
      
      const userFriendlyMessage = `I couldn't create a guide for that task. This might be too complex or outside my current capabilities.\n\n` +
        `If you'd like help with this, please submit a ticket at **ticket.thinkdrop.ai**.`;
      
      return {
        ...state,
        answer: userFriendlyMessage,
        commandExecuted: false,
        commandError: result.error
      };
    }
    
    console.log('✅ [NODE:EXECUTE_COMMAND] Guide generated successfully');
    console.log('📦 [NODE:EXECUTE_COMMAND] Raw result keys:', Object.keys(result));
    
    // Extract guide data - handle MCP wrapper and backend response structure
    // Backend returns: { success, guide: {...}, provider, latencyMs }
    // MCP wraps it as: { success, guide: { success, guide: {...}, provider, latencyMs } }
    let guideData;
    
    if (result.guide && result.guide.guide) {
      // Double-nested (MCP wrapped the backend response)
      console.log('📦 [NODE:EXECUTE_COMMAND] Detected double-nested structure');
      guideData = result.guide.guide;
    } else if (result.guide) {
      // Single-nested (direct backend response)
      console.log('📦 [NODE:EXECUTE_COMMAND] Detected single-nested structure');
      guideData = result.guide;
    } else {
      // Flat structure
      console.log('📦 [NODE:EXECUTE_COMMAND] Detected flat structure');
      guideData = result;
    }
    
    console.log('📚 [NODE:EXECUTE_COMMAND] Total steps:', guideData.totalSteps);
    console.log('📝 [NODE:EXECUTE_COMMAND] Guide intro:', guideData.intro?.substring(0, 100));
    console.log('🔧 [NODE:EXECUTE_COMMAND] Provider:', result.guide?.provider || result.provider);
    console.log('⏱️  [NODE:EXECUTE_COMMAND] Latency:', result.guide?.latencyMs || result.latencyMs, 'ms');
    
    // Format guide as markdown for display
    let formattedGuide = '';
    
    if (guideData.intro) {
      formattedGuide += `${guideData.intro}\n\n`;
    }
    
    if (guideData.steps && Array.isArray(guideData.steps)) {
      formattedGuide += '## Steps:\n\n';
      guideData.steps.forEach((step, index) => {
        formattedGuide += `### ${index + 1}. ${step.title || step.description}\n\n`;
        if (step.description && step.title) {
          formattedGuide += `${step.description}\n\n`;
        }
        if (step.code) {
          formattedGuide += `\`\`\`bash\n${step.code}\n\`\`\`\n\n`;
        }
        if (step.explanation) {
          formattedGuide += `${step.explanation}\n\n`;
        }
      });
    }
    
    if (guideData.commonRecoveries && guideData.commonRecoveries.length > 0) {
      formattedGuide += '\n## Troubleshooting:\n\n';
      guideData.commonRecoveries.forEach((recovery, index) => {
        // Handle different recovery object structures from backend
        const title = recovery.title || recovery.issue || 'Common Issue';
        const explanation = recovery.explanation || recovery.solution || recovery.manualInstructions || '';
        
        if (title && explanation) {
          formattedGuide += `**${title}**\n\n${explanation}\n\n`;
          
          // Add help links if available
          if (recovery.helpLinks && Array.isArray(recovery.helpLinks)) {
            formattedGuide += 'Resources:\n';
            recovery.helpLinks.forEach(link => {
              formattedGuide += `- [${link.title}](${link.url})\n`;
            });
            formattedGuide += '\n';
          }
        }
      });
    }
    
    // Extract guideId from result
    const guideId = result.guideId || result.guide?.guideId || result.guide?.id;
    console.log('🆔 [NODE:EXECUTE_COMMAND] Guide ID extracted:', guideId);
    console.log('🔍 [NODE:EXECUTE_COMMAND] result.guideId:', result.guideId);
    console.log('🔍 [NODE:EXECUTE_COMMAND] result.guide?.guideId:', result.guide?.guideId);
    console.log('🔍 [NODE:EXECUTE_COMMAND] result.guide?.id:', result.guide?.id);
    
    if (!guideId) {
      console.error('❌ [NODE:EXECUTE_COMMAND] No guideId found in result!');
    }
    
    // Return guide data for frontend to display
    return {
      ...state,
      answer: formattedGuide || guideData.intro || 'Guide generated successfully.',
      guideMode: true,
      guideId, // Include guideId for execution
      guideSteps: guideData.steps,
      guideTotalSteps: guideData.totalSteps,
      guideCode: guideData.code,
      guideRecoveries: guideData.commonRecoveries,
      guideMetadata: guideData.metadata,
      commandExecuted: true
    };
  } catch (error) {
    console.error('❌ [NODE:EXECUTE_COMMAND] Guide execution error:', error.message);
    
    const userFriendlyMessage = `I ran into an issue creating a guide for that task.\n\n` +
      `If this keeps happening, please submit a ticket at **ticket.thinkdrop.ai**.`;
    
    return {
      ...state,
      answer: userFriendlyMessage,
      commandExecuted: false,
      error: error.message
    };
  }
}
