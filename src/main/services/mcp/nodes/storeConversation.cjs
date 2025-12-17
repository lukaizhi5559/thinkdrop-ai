/**
 * Store Conversation Node
 * Stores the conversation exchange in memory for future context
 */

const logger = require('./../../../logger.cjs');
const { BrowserWindow } = require('electron');

/**
 * Determine if a screen_intelligence or command_automate interaction should be stored to user-memory
 * Only store valuable, reusable information - not transient queries
 * Uses a scoring system to reduce false positives
 */
function shouldStoreToUserMemory(intentType, userMessage, answer, state = {}) {
  // Only auto-store for these intents
  if (!['screen_intelligence', 'command_automate'].includes(intentType)) {
    return false;
  }
  
  const msg = (userMessage || '').toLowerCase();
  const ans = (answer || '').toLowerCase();
  
  // Very short content is rarely worth storing
  if (msg.length < 8 && ans.length < 40) {
    logger.debug('⏭️  [FILTER] Content too short to store');
    return false;
  }
  
  // TODO: Add user preference for auto-storing sensitive information
  // For now, allow auto-storage since data is local (DuckDB) and users have full control via memory debugger
  
  // ═══════════════════════════════════════════════════════════════
  // SCREEN INTELLIGENCE - Store valuable analysis, skip transient queries
  // ═══════════════════════════════════════════════════════════════
  if (intentType === 'screen_intelligence') {
    // DON'T STORE: Simple "what's on screen" queries without valuable content
    const transientPatterns = [
      /^what('s| is) on (my |the )?screen/,
      /^show (me )?(my |the )?screen/,
      /^describe (my |the )?screen/,
      /^read (my |the )?screen/,
      /what (do you see|can you see)/,
      /what time is it/,
      /what('s| is) the (weather|temperature|date)/
    ];
    
    if (transientPatterns.some(pattern => pattern.test(msg))) {
      logger.debug('⏭️  [FILTER] Skipping transient screen query');
      return false;
    }
    
    let score = 0;
    
    // SCORING: Error / bug analysis (requires multiple signals)
    const errorKeywords = ['error', 'bug', 'issue', 'problem', 'warning', 'exception', 'stack trace'];
    const hasErrorWord = errorKeywords.some(k => msg.includes(k)) || errorKeywords.some(k => ans.includes(k));
    const hasFixLanguage = ans.includes('fix') || ans.includes('solution') || 
                           ans.includes('steps to resolve') || ans.includes('workaround');
    
    if (hasErrorWord && hasFixLanguage && ans.length > 80) {
      score += 2; // Strong signal: error + solution + substantial answer
    } else if (hasErrorWord && ans.length > 100) {
      score += 1; // Weak signal: error mentioned but no clear solution
    }
    
    // SCORING: Code/UI analysis with explanations
    const analysisTriggers = [
      'what does this', 'explain this', 'how does this', 'why does this',
      'analyze', 'walk me through', 'step by step'
    ];
    const hasAnalysisRequest = analysisTriggers.some(k => msg.includes(k));
    const hasCodeAnalysisInAnswer = 
      (ans.includes('this code') || ans.includes('this function') || ans.includes('component')) &&
      ans.length > 120;
    
    if (hasAnalysisRequest && hasCodeAnalysisInAnswer) {
      score += 2; // Strong signal: analysis request + detailed explanation
    } else if (hasAnalysisRequest || hasCodeAnalysisInAnswer) {
      score += 1; // Weak signal: only one part present
    }
    
    // SCORING: Configuration / important text (including credentials)
    const configWords = ['configuration', 'settings', 'options', 'preferences', 'api key', 'password', 'credentials'];
    const hasConfigWord = configWords.some(k => msg.includes(k) || ans.includes(k));
    
    if (hasConfigWord || state.screenData?.hasImportantText) {
      score += 1;
    }
    
    // Require score threshold to reduce false positives
    if (score >= 2) {
      logger.debug(`💎 [FILTER] Storing screen_intelligence (score=${score})`);
      return true;
    }
    
    logger.debug(`⏭️  [FILTER] screen_intelligence below threshold (score=${score})`);
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // COMMAND AUTOMATE - Store workflows and preferences
  // ═══════════════════════════════════════════════════════════════
  if (intentType === 'command_automate') {
    let score = 0;
    
    // SCORING: Explicit "remember"/persistence language
    const persistenceTriggers = [
      'remember this', 'save this', 'use this next time', 'from now on',
      'in the future', 'default', 'my usual', 'my standard', 'my template'
    ];
    if (persistenceTriggers.some(k => msg.includes(k))) {
      score += 2; // Strong signal: explicit persistence intent
    }
    
    // SCORING: User preferences
    const preferenceTriggers = [
      'favorite', 'preferred', 'i like to', 'i prefer',
      'always use', 'normally i', 'typically i'
    ];
    if (preferenceTriggers.some(k => msg.includes(k))) {
      score += 1;
    }
    
    // SCORING: Multi-step workflow + repeating language
    const looksMultiStep = 
      msg.includes(' and then ') || msg.includes(' then ') ||
      msg.includes('after that') ||
      (state.automationSteps && state.automationSteps.length > 1);
    
    const repeatingLanguage = 
      msg.includes('every time') || msg.includes('whenever') ||
      msg.includes('always when') || msg.includes('each morning') ||
      msg.includes('each day') || msg.includes('every day');
    
    if (looksMultiStep && repeatingLanguage) {
      score += 2; // Strong signal: workflow + repetition
    } else if (looksMultiStep) {
      score += 1; // Weak signal: just multi-step, might be one-off
    }
    
    // Require score threshold (no default true)
    if (score >= 2) {
      logger.debug(`💎 [FILTER] Storing command_automate (score=${score})`);
      return true;
    }
    
    logger.debug(`⏭️  [FILTER] command_automate below threshold (score=${score})`);
    return false;
  }
  
  return false;
}

module.exports = async function storeConversation(state) {
  const { mcpClient, message, resolvedMessage, answer, context, intent } = state;
  
  // Use resolved message if available (after coreference resolution), otherwise original
  const userMessage = resolvedMessage || message;

  logger.debug('💾 [NODE:STORE_CONVERSATION] Storing conversation exchange...');

  try {
    // Build storage text
    const storageText = `User asked: "${userMessage}"\nAssistant responded: "${answer}"`;

    // Start with entities from user's message (extracted during intent parsing)
    const userEntities = intent.entities || [];
    logger.debug(`📋 [NODE:STORE_CONVERSATION] User message entities: ${userEntities.length}`, userEntities);

    // Extract entities from AI response (contains rich information like names, dates, places)
    let responseEntities = [];
    if (answer && typeof answer === 'string' && answer.trim().length > 0) {
      try {
        const extractResult = await mcpClient.callService('phi4', 'entity.extract', {
          text: answer
        });
        responseEntities = extractResult.data?.entities || extractResult.entities || [];
        logger.debug(`📋 [NODE:STORE_CONVERSATION] AI response entities: ${responseEntities.length}`, responseEntities);
      } catch (error) {
        logger.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to extract entities from response:', error.message);
      }
    } else {
      logger.debug('⚠️ [NODE:STORE_CONVERSATION] Skipping entity extraction - empty or invalid response');
    }

    // Combine entities from both user message and AI response
    // Remove duplicates based on value (case-insensitive)
    const seenValues = new Set();
    const entities = [...userEntities, ...responseEntities].filter(entity => {
      const key = entity.value?.toLowerCase();
      if (!key || seenValues.has(key)) return false;
      seenValues.add(key);
      return true;
    });
    
    logger.debug(`📋 [NODE:STORE_CONVERSATION] Total unique entities: ${entities.length}`, entities);

    // IMPORTANT: Do NOT store conversations in user-memory database
    // Conversations are already stored in conversation service (conversation.duckdb)
    // User-memory (user_memory.duckdb) should ONLY contain explicit memories from memory_store intent
    // 
    // This prevents pollution of user-memory with every query/question
    // Examples of what should NOT be in user-memory:
    // - "do I have any appts" (question - goes to conversation history only)
    // - "what time is it" (question - goes to conversation history only)
    // - "what's the weather" (question - goes to conversation history only)
    //
    // Examples of what SHOULD be in user-memory:
    // - "Set a reminder that I have appt. in two weeks" (memory_store intent)
    // - "Remember my favorite coffee is oat milk latte" (memory_store intent)
    // - "My car's VIN is ABC123" (memory_store intent)
    
    // ═══════════════════════════════════════════════════════════════
    // SELECTIVE AUTO-STORAGE for screen_intelligence & command_automate
    // ═══════════════════════════════════════════════════════════════
    // Store valuable, reusable information to user-memory
    const intentType = intent?.type;
    const shouldAutoStore = shouldStoreToUserMemory(intentType, userMessage, answer, state);
    
    if (shouldAutoStore) {
      logger.debug(`💎 [NODE:STORE_CONVERSATION] Auto-storing ${intentType} to user-memory (valuable content detected)`);
      try {
        await mcpClient.callService('user-memory', 'memory.store', {
          text: storageText,
          entities: entities,
          userId: context?.userId,
          sessionId: context?.sessionId,
          metadata: {
            intent: intentType,
            autoStored: true,
            timestamp: new Date().toISOString()
          }
        });
        logger.debug('✅ [NODE:STORE_CONVERSATION] Auto-stored to user-memory');
      } catch (error) {
        logger.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to auto-store to user-memory:', error.message);
      }
    } else {
      logger.debug('✅ [NODE:STORE_CONVERSATION] Conversation stored in conversation service only (not user-memory)');
    }

    // 💾 Store AI response message to conversation service
    try {
      const sessionId = context?.sessionId || 'default_session';
      logger.debug('💾 [NODE:STORE_CONVERSATION] Storing AI response to conversation service, session:', sessionId);
      
      // Build metadata - include clarification context if present
      const metadata = {
        intentType: intent?.type,
        entities: entities.slice(0, 10) // Include first 10 entities
      };
      
      // If this is a clarification request, store the context for replanning
      if (state.needsClarification) {
        metadata.needsClarification = true;
        metadata.originalCommand = message; // Store the original command
        metadata.clarificationQuestions = state.clarificationQuestions || [];
        logger.debug('🤔 [NODE:STORE_CONVERSATION] Storing clarification context for replanning', {
          originalCommand: message,
          questionCount: metadata.clarificationQuestions.length
        });
      }
      
      await mcpClient.callService('conversation', 'message.add', {
        sessionId,
        text: answer,
        sender: 'ai',
        metadata
      });
      
      logger.debug('✅ [NODE:STORE_CONVERSATION] AI response stored successfully');
    } catch (storeError) {
      logger.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to store AI response:', storeError.message);
    }

    // 📤 Notify chat window to reload messages (AI response is now stored)
    try {
      // Try multiple sources for session ID - use context from destructured state
      const notifySessionId = context?.sessionId || context?.conversationId || 'default_session';
      
      logger.debug('🔍 [NODE:STORE_CONVERSATION] Session ID for notification:', {
        'context.sessionId': context?.sessionId,
        'context.conversationId': context?.conversationId,
        'notifySessionId': notifySessionId
      });
      
      if (notifySessionId) {
        const windows = BrowserWindow.getAllWindows();
        const chatWindow = windows.find(w => w.webContents.getURL().includes('mode=chat'));
        
        if (chatWindow && !chatWindow.isDestroyed()) {
          logger.debug('📤 [NODE:STORE_CONVERSATION] Notifying chat window to reload messages for session:', notifySessionId);
          chatWindow.webContents.send('conversation:message-added', { sessionId: notifySessionId });
          logger.debug('✅ [NODE:STORE_CONVERSATION] Notification sent with sessionId:', notifySessionId);
        } else {
          logger.warn('⚠️ [NODE:STORE_CONVERSATION] Chat window not found or destroyed');
        }
      } else {
        logger.warn('⚠️ [NODE:STORE_CONVERSATION] No session ID found in context, cannot notify chat window');
      }
    } catch (notifyError) {
      logger.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to notify chat window:', notifyError.message);
    }

    return {
      ...state,
      conversationStored: true
    };
  } catch (error) {
    logger.warn('⚠️ [NODE:STORE_CONVERSATION] Failed to store conversation:', error.message);
    // Don't fail the entire workflow if storage fails
    return {
      ...state,
      conversationStored: false,
      storageError: error.message
    };
  }
};
