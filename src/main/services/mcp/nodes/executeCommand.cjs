/**
 * Execute Command Node
 * 
 * Handles command intent by calling the command MCP service.
 * Interprets natural language commands and executes them safely.
 */

const logger = require('./../../../logger.cjs');

/**
 * Decide whether to use Computer Use (agentic WebSocket) or Static Plan
 * @param {string} command - User command
 * @param {object} context - Execution context
 * @param {string} screenshot - Initial screenshot
 * @returns {boolean} - True if should use Computer Use
 */
function shouldUseComputerUse(command, context, screenshot) {
  // Check if explicitly disabled (fallback mode after Computer Use failure)
  if (process.env.DISABLE_COMPUTER_USE === 'true' || context.disableComputerUse) {
    logger.debug('📋 [DECISION] Computer Use disabled - using static plan fallback');
    return false;
  }
  
  // Default: Always use Computer Use (most human-like, adaptive)
  // Static plan is only used as fallback when Computer Use fails
  logger.debug('🌐 [DECISION] Using Computer Use mode (default)');
  return true;
}

module.exports = async function executeCommand(state) {
  const { message, resolvedMessage, intent, context, mcpClient, conversationHistory = [] } = state;
  
  // Handle all command sub-types
  const commandTypes = ['command_execute', 'command_automate', 'command_guide'];
  if (!commandTypes.includes(intent?.type)) {
    return state;
  }
  
  // Use resolved message if available (after coreference resolution), otherwise use original
  const commandMessage = resolvedMessage || message;
  
  // Check if this is a follow-up to a clarification request
  // Look for the most recent assistant message with needsClarification
  let previousClarificationContext = null;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (msg.role === 'assistant' && msg.metadata?.needsClarification) {
      previousClarificationContext = {
        originalCommand: msg.metadata.originalCommand,
        clarificationQuestions: msg.metadata.clarificationQuestions,
        timestamp: msg.timestamp
      };
      logger.debug('🔄 [NODE:EXECUTE_COMMAND] Detected follow-up to clarification request', {
        originalCommand: previousClarificationContext.originalCommand,
        questionCount: previousClarificationContext.clarificationQuestions?.length || 0
      });
      break;
    }
  }
  
  try {
    logger.debug(`⚡ [NODE:EXECUTE_COMMAND] Executing ${intent.type} via MCP:`, commandMessage);
    if (resolvedMessage && resolvedMessage !== message && commandMessage === resolvedMessage) {
      logger.debug('📝 [NODE:EXECUTE_COMMAND] Using resolved message:', message, '→', resolvedMessage);
    } else if (resolvedMessage && resolvedMessage !== message && commandMessage === message) {
      logger.debug('📝 [NODE:EXECUTE_COMMAND] Rejected resolved message, using original:', resolvedMessage, '→', message);
    }
    
    // Route based on ML-classified intent type
    if (intent.type === 'command_guide') {
      logger.debug('🎓 [NODE:EXECUTE_COMMAND] Educational guide mode detected');
      return await executeGuide(state, mcpClient, commandMessage, context);
    }
    
    if (intent.type === 'command_automate') {
      logger.debug('🤖 [NODE:EXECUTE_COMMAND] UI automation mode detected');
      
      try {
        // Capture screenshot for initial context
        let screenshot = null;
        try {
          const { BrowserWindow } = require('electron');
          const { desktopCapturer, screen } = require('electron');
          
          // Get primary display
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width, height } = primaryDisplay.bounds;
          
          // Capture screenshot
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width, height }
          });
          
          if (sources.length > 0) {
            screenshot = sources[0].thumbnail.toDataURL();
            logger.info('📸 [NODE:EXECUTE_COMMAND] Captured screenshot for initial context', {
              size: screenshot.length,
              resolution: `${width}x${height}`
            });
          }
        } catch (screenshotError) {
          logger.warn('⚠️ [NODE:EXECUTE_COMMAND] Failed to capture screenshot', {
            error: screenshotError.message
          });
        }
        
        // Get active window information for context
        let activeWindowInfo = null;
        try {
          const windowTracker = require('../../../services/windowTracker.cjs');
          activeWindowInfo = windowTracker.getActiveWindow();
          logger.debug('🪟 [NODE:EXECUTE_COMMAND] Active window:', {
            app: activeWindowInfo?.app,
            title: activeWindowInfo?.title
          });
        } catch (error) {
          logger.warn('⚠️ [NODE:EXECUTE_COMMAND] Failed to get active window:', error.message);
        }
        
        // Decision: Use Computer Use (agentic) or Static Plan?
        const useComputerUse = shouldUseComputerUse(commandMessage, context, screenshot);
        
        if (useComputerUse) {
          logger.info('🌐 [NODE:EXECUTE_COMMAND] Using Computer Use agentic mode (WebSocket)');
          
          // Get screen dimensions for pixel-accurate coordinates
          const { screen } = require('electron');
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds;
          
          // Return metadata for frontend to connect WebSocket directly
          const intentContext = state.intentContext || { intent: intent.type, slots: {}, uiVariant: null };
          intentContext.slots = {
            ...intentContext.slots,
            mode: 'computer-use-streaming',
            goal: commandMessage,
            screenshot: screenshot,
            backendUrl: process.env.BACKEND_URL || 'http://localhost:4000',
            wsUrl: process.env.BACKEND_WS_URL || 'ws://localhost:4000/computer-use',
            apiKey: process.env.BIBSCRIP_API_KEY || 'test-api-key-123',
            context: {
              os: process.platform,
              userId: context.userId,
              sessionId: context.sessionId,
              activeApp: activeWindowInfo?.app || null,
              activeTitle: activeWindowInfo?.title || null,
              activeUrl: activeWindowInfo?.url || null,
              screenWidth: screenWidth,
              screenHeight: screenHeight,
              screenshotWidth: screenWidth,  // Same as screen for fullscreen capture
              screenshotHeight: screenHeight
            }
          };
          state.intentContext = intentContext;
          
          logger.debug('📦 [NODE:EXECUTE_COMMAND] Populated intentContext for Computer Use streaming', {
            screenDimensions: `${screenWidth}x${screenHeight}`
          });
          
          // Return state without answer - frontend will handle WebSocket connection
          return state;
        }
        
        // Otherwise, use static plan generation (existing flow)
        logger.info('📋 [NODE:EXECUTE_COMMAND] Using static plan generation');
        
        // Prepare request payload
        const requestPayload = {
          command: commandMessage,
          intent: 'command_automate',
          context: {
            os: process.platform,
            userId: context.userId,
            sessionId: context.sessionId,
            screenshot: screenshot
          }
        };
        
        // If this is a follow-up to a clarification request, include clarification context
        if (previousClarificationContext) {
          logger.info('🔄 [NODE:EXECUTE_COMMAND] Including clarification context for replanning');
          
          // Use the original command that needed clarification
          requestPayload.command = previousClarificationContext.originalCommand;
          
          // Include the user's clarification answer as feedback
          requestPayload.clarificationAnswers = {
            userResponse: commandMessage, // The current message is the clarification answer
            questions: previousClarificationContext.clarificationQuestions
          };
          
          logger.debug('📝 [NODE:EXECUTE_COMMAND] Replanning with:', {
            originalCommand: requestPayload.command,
            clarificationAnswer: commandMessage
          });
        }
        
        // Call command.automate which now returns a plan instead of executing
        const commandTimeout = parseInt(process.env.MCP_COMMAND_TIMEOUT || '60000');
        const result = await mcpClient.callService(
          'command',
          'command.automate',
          requestPayload,
          { timeout: commandTimeout }
        );
        
        // Handle clarification needed
        if (result.success && result.needsClarification) {
          logger.info('🤔 [NODE:EXECUTE_COMMAND] Backend needs clarification');
          
          const questions = result.clarificationQuestions || [];
          const questionText = questions.map((q, i) => `${i + 1}. ${q.question || q.text || q}`).join('\n');
          
          const userFriendlyMessage = `I need some clarification before I can automate this task:\n\n` +
            `${questionText}\n\n` +
            `Please provide more details and try again.`;
          
          // Populate intentContext.slots for overlay system
          const intentContext = state.intentContext || { intent: intent.type, slots: {}, uiVariant: null };
          intentContext.slots = {
            ...intentContext.slots,
            needsClarification: true,
            clarificationQuestions: questions,
            subject: resolvedMessage || message
          };
          
          return {
            ...state,
            answer: userFriendlyMessage,
            commandExecuted: false,
            needsClarification: true,
            clarificationQuestions: questions,
            intentContext: intentContext
          };
        }
        
        if (!result.success || !result.plan) {
          logger.warn('⚠️ [NODE:EXECUTE_COMMAND] Plan generation failed:', result.error);
          
          const userFriendlyMessage = `I couldn't generate an automation plan for that task.\n\n` +
            `Error: ${result.error || 'Unknown error'}\n\n` +
            `If you need assistance, please submit a ticket at **ticket.thinkdrop.ai**.`;
          
          return {
            ...state,
            answer: userFriendlyMessage,
            commandExecuted: false,
            commandError: result.error
          };
        }
        
        logger.debug('✅ [NODE:EXECUTE_COMMAND] Automation plan generated');
        logger.debug('📊 [NODE:EXECUTE_COMMAND] Plan ID:', result.plan.planId);
        logger.debug('📊 [NODE:EXECUTE_COMMAND] Steps:', result.plan.steps.length);
        logger.debug('📊 [NODE:EXECUTE_COMMAND] Provider:', result.plan.metadata?.provider);
        
        // Log automation plan for debugging
        logger.logAutomationPlan(result.plan, resolvedMessage || message);
        
        // Populate intentContext.slots for overlay system
        const intentContext = state.intentContext || { intent: intent.type, slots: {}, uiVariant: null };
        intentContext.slots = {
          ...intentContext.slots,
          automationPlan: result.plan,
          planId: result.plan.planId,
          steps: result.plan.steps,
          totalSteps: result.plan.steps.length,
          currentStep: 0,
          goal: result.plan.goal,
          metadata: result.plan.metadata
        };
        state.intentContext = intentContext;
        
        logger.debug('📦 [NODE:EXECUTE_COMMAND] Populated intentContext.slots for overlay');
        
        // Return state without answer - will route to overlay system
        return state;
        
      } catch (error) {
        logger.error('❌ [NODE:EXECUTE_COMMAND] Error generating plan:', error.message);
        
        const userFriendlyMessage = `I ran into an issue generating an automation plan for that task.\n\n` +
          `If this keeps happening, please submit a ticket at **ticket.thinkdrop.ai**.`;
        
        return {
          ...state,
          answer: userFriendlyMessage,
          commandExecuted: false,
          error: error.message
        };
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
      logger.debug('⚠️ [NODE:EXECUTE_COMMAND] Command requires user confirmation');
      
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
      
      logger.warn('⚠️ [NODE:EXECUTE_COMMAND] Command execution failed:', result.error);
      
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
      logger.warn('⚠️ [NODE:EXECUTE_COMMAND] Gemini warning:', result.geminiWarning.message);
    }
    
    // Success - check if output was interpreted
    logger.debug('✅ [NODE:EXECUTE_COMMAND] Command executed successfully:', result.executedCommand);
    logger.debug('📊 [NODE:EXECUTE_COMMAND] Output length:', result.output?.length || 0);
    logger.debug('🔍 [NODE:EXECUTE_COMMAND] Interpretation source:', result.outputInterpretationSource || 'raw');
    
    // Populate intentContext.slots for overlay system
    const intentContext = state.intentContext || { intent: intent.type, slots: {}, uiVariant: null };
    intentContext.slots = {
      ...intentContext.slots,
      originalCommand: commandMessage,
      shellCommand: result.executedCommand || result.interpretedCommand,
      output: result.output || result.rawOutput || '',
      success: result.success,
      method: result.method || 'unknown',
      confidence: result.confidence || 0,
      executionTime: result.executionTime || 0,
      category: result.category || 'general',
      timestamp: new Date().toISOString()
    };
    state.intentContext = intentContext;
    
    logger.debug('📦 [NODE:EXECUTE_COMMAND] Populated intentContext.slots for overlay');
    
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
      
      // Check if this is a find/search command
      const isSearchCommand = result.category === 'file_read' && 
        /^(find|mdfind|locate|grep)\s/.test(result.executedCommand || '');
      
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
      
      if (isSearchCommand && result.rawOutput) {
        // For find/search commands, format the paths nicely
        const paths = result.rawOutput.trim().split('\n').filter(p => p.trim());
        
        if (paths.length === 0) {
          return {
            ...state,
            answer: 'No files or folders found matching your search.',
            commandExecuted: true,
            executedCommand: result.executedCommand,
            commandCategory: result.category,
            executionTime: result.executionTime,
            needsInterpretation: false,
            outputInterpretationSource: 'raw',
            geminiWarning: result.geminiWarning
          };
        }
        
        // Extract just the filename/folder name for non-technical users
        const formattedResults = paths.map(fullPath => {
          const fileName = fullPath.split('/').pop(); // Get last part of path
          const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/')); // Get directory
          return `**${fileName}**\n   📁 \`${dirPath}\``;
        }).join('\n\n');
        
        const count = paths.length;
        const plural = count === 1 ? 'result' : 'results';
        
        return {
          ...state,
          answer: `Found **${count} ${plural}**:\n\n${formattedResults}`,
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
    logger.error('❌ [NODE:EXECUTE_COMMAND] Error:', error.message);
    
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
      logger.debug('🔄 [NODE:EXECUTE_COMMAND] Command service down + screen keywords detected → Retrying as screen_intelligence');
      
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
      logger.warn('⚠️ [NODE:EXECUTE_COMMAND] Guide generation failed:', result.error);
      
      const userFriendlyMessage = `I couldn't create a guide for that task. This might be too complex or outside my current capabilities.\n\n` +
        `If you'd like help with this, please submit a ticket at **ticket.thinkdrop.ai**.`;
      
      return {
        ...state,
        answer: userFriendlyMessage,
        commandExecuted: false,
        commandError: result.error
      };
    }
    
    logger.debug('✅ [NODE:EXECUTE_COMMAND] Guide generated successfully');
    logger.debug('📦 [NODE:EXECUTE_COMMAND] Raw result keys:', Object.keys(result));
    
    // Extract guide data - handle MCP wrapper and backend response structure
    // Backend returns: { success, guide: {...}, provider, latencyMs }
    // MCP wraps it as: { success, guide: { success, guide: {...}, provider, latencyMs } }
    let guideData;
    
    if (result.guide && result.guide.guide) {
      // Double-nested (MCP wrapped the backend response)
      logger.debug('📦 [NODE:EXECUTE_COMMAND] Detected double-nested structure');
      guideData = result.guide.guide;
    } else if (result.guide) {
      // Single-nested (direct backend response)
      logger.debug('📦 [NODE:EXECUTE_COMMAND] Detected single-nested structure');
      guideData = result.guide;
    } else {
      // Flat structure
      logger.debug('📦 [NODE:EXECUTE_COMMAND] Detected flat structure');
      guideData = result;
    }
    
    logger.debug('📚 [NODE:EXECUTE_COMMAND] Total steps:', guideData.totalSteps);
    logger.debug('📝 [NODE:EXECUTE_COMMAND] Guide intro:', guideData.intro?.substring(0, 100));
    logger.debug('🔧 [NODE:EXECUTE_COMMAND] Provider:', result.guide?.provider || result.provider);
    logger.debug('⏱️  [NODE:EXECUTE_COMMAND] Latency:', result.guide?.latencyMs || result.latencyMs, 'ms');
    
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
    logger.debug('🆔 [NODE:EXECUTE_COMMAND] Guide ID extracted:', guideId);
    logger.debug('🔍 [NODE:EXECUTE_COMMAND] result.guideId:', result.guideId);
    logger.debug('🔍 [NODE:EXECUTE_COMMAND] result.guide?.guideId:', result.guide?.guideId);
    logger.debug('🔍 [NODE:EXECUTE_COMMAND] result.guide?.id:', result.guide?.id);
    
    if (!guideId) {
      logger.error('❌ [NODE:EXECUTE_COMMAND] No guideId found in result!');
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
    logger.error('❌ [NODE:EXECUTE_COMMAND] Guide execution error:', error.message);
    
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
