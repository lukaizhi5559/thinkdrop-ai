/**
 * Select Overlay Variant Node
 * 
 * Determines which UI variant to show based on:
 * - Current intent type
 * - Available data in slots
 * - Error states
 * 
 * This node runs near the tail of each intent branch,
 * right before overlayOutput.
 */

const logger = require('./../../../logger.cjs');

/**
 * Select appropriate UI variant for current intent
 * @param {object} state - Graph state with intentContext
 * @returns {object} Updated state with uiVariant set
 */
module.exports = async function selectOverlayVariant(state) {
  try {
    const intent = state.intentContext?.intent;
    
    if (!intent) {
      logger.debug('⏭️  [NODE:SELECT_OVERLAY_VARIANT] No intent context, skipping');
      return state;
    }
    
    logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] Processing intent: ${intent}`);
  
  const slots = state.intentContext.slots || {};
  
  // Debug: Log what's in slots
  logger.debug(`🔍 [NODE:SELECT_OVERLAY_VARIANT] Slots keys: ${Object.keys(slots).join(', ')}`);
  logger.debug(`🔍 [NODE:SELECT_OVERLAY_VARIANT] Has results: ${!!slots.results}, Is array: ${Array.isArray(slots.results)}, Length: ${slots.results?.length || 0}`);
  
  // Add answer to slots if available (for display in UI)
  if (state.answer) {
    slots.answer = state.answer;
    logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] Added answer to slots: "${state.answer.substring(0, 100)}..."`);
  }
  
  // Intent-specific variant selection logic
  switch (intent) {
    case 'web_search':
    case 'question':
      // Both web_search and question intents can have web search results
      // Check for error state first
      if (slots.error || slots.errorMessage) {
        state.intentContext.uiVariant = 'error';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → error (has error)`);
      }
      // Multiple channels available → show choice
      else if (slots.candidateChannels && Array.isArray(slots.candidateChannels) && slots.candidateChannels.length > 1) {
        state.intentContext.uiVariant = 'choice';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → choice (${slots.candidateChannels.length} channels)`);
      }
      // Has results → show results card
      else if (slots.results && Array.isArray(slots.results) && slots.results.length > 0) {
        state.intentContext.uiVariant = 'results';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → results (${slots.results.length} items)`);
      }
      // Has answer (e.g., from online LLM without web search) → show as results
      else if (state.answer || slots.answer) {
        state.intentContext.uiVariant = 'results';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → results (has answer, no web results)`);
      }
      // Still loading
      else {
        state.intentContext.uiVariant = 'loading';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → loading`);
      }
      break;
      
    case 'screen_intelligence':
      // Screen intelligence intent - show analysis results
      // Check for error state first
      if (slots.error || slots.errorMessage) {
        state.intentContext.uiVariant = 'error';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] screen_intelligence → error (has error)`);
      }
      // Has analysis or text → show results
      else if (slots.analysis || slots.text || state.answer) {
        state.intentContext.uiVariant = 'results';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] screen_intelligence → results (has analysis)`);
      }
      // Still loading
      else {
        state.intentContext.uiVariant = 'loading';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] screen_intelligence → loading`);
      }
      break;
      
    case 'command_execute':
      // Simple command execution - show results
      if (slots.error || slots.errorMessage || state.commandError) {
        state.intentContext.uiVariant = 'error';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → error (has error)`);
      }
      else if (state.commandExecuted || state.answer || slots.output) {
        state.intentContext.uiVariant = 'results';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → results (command executed)`);
      }
      else {
        state.intentContext.uiVariant = 'loading';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → loading`);
      }
      break;
    
    case 'command_automate':
      // Automation with structured plan - show progress UI
      if (slots.error || slots.errorMessage) {
        state.intentContext.uiVariant = 'error';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → error (has error)`);
      }
      else if (state.needsClarification || slots.needsClarification) {
        // Backend needs clarification - show as a message/results view
        state.intentContext.uiVariant = 'results';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → results (needs clarification)`);
      }
      else if (slots.automationPlan && slots.steps) {
        state.intentContext.uiVariant = 'automation_progress';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → automation_progress (${slots.totalSteps} steps)`);
      }
      else {
        state.intentContext.uiVariant = 'loading';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → loading`);
      }
      break;
    
    case 'command_guide':
      // Interactive guide mode - show guide renderer
      if (slots.error || slots.errorMessage) {
        state.intentContext.uiVariant = 'error';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → error (has error)`);
      }
      else if (slots.guideId && slots.steps) {
        state.intentContext.uiVariant = 'guide_renderer';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → guide_renderer (${slots.totalSteps} steps)`);
      }
      else {
        state.intentContext.uiVariant = 'loading';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → loading`);
      }
      break;
    
    default:
      // Use default variant for unknown intents
      state.intentContext.uiVariant = 'results';
      logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → results (default)`);
  }
  
  return state;
  } catch (error) {
    logger.error('❌ [NODE:SELECT_OVERLAY_VARIANT] Error:', error);
    logger.error('❌ [NODE:SELECT_OVERLAY_VARIANT] Stack:', error.stack);
    // Return state unchanged on error
    return state;
  }
};
