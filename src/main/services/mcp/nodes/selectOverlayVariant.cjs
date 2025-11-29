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

// Dynamic import helper for ES modules
let getIntentDescriptor = null;
async function loadRegistry() {
  if (!getIntentDescriptor) {
    const registry = await import('../../../../intents/registry.js');
    getIntentDescriptor = registry.getIntentDescriptor;
  }
  return getIntentDescriptor;
}

/**
 * Select appropriate UI variant for current intent
 * @param {object} state - Graph state with intentContext
 * @returns {object} Updated state with uiVariant set
 */
module.exports = async function selectOverlayVariant(state) {
  const intent = state.intentContext?.intent;
  
  if (!intent) {
    logger.debug('⏭️  [NODE:SELECT_OVERLAY_VARIANT] No intent context, skipping');
    return state;
  }
  
  // Load intent descriptor
  const getDescriptor = await loadRegistry();
  const descriptor = getDescriptor(intent);
  
  if (!descriptor) {
    logger.warn(`⚠️  [NODE:SELECT_OVERLAY_VARIANT] No descriptor for intent: ${intent}`);
    return state;
  }
  
  const slots = state.intentContext.slots || {};
  
  // Intent-specific variant selection logic
  switch (intent) {
    case 'web_search':
      // Check for error state first
      if (slots.error || slots.errorMessage) {
        state.intentContext.uiVariant = 'error';
        logger.debug('🎨 [NODE:SELECT_OVERLAY_VARIANT] web_search → error (has error)');
      }
      // Multiple channels available → show choice
      else if (slots.candidateChannels && Array.isArray(slots.candidateChannels) && slots.candidateChannels.length > 1) {
        state.intentContext.uiVariant = 'choice';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] web_search → choice (${slots.candidateChannels.length} channels)`);
      }
      // Has results → show results card
      else if (slots.results && Array.isArray(slots.results) && slots.results.length > 0) {
        state.intentContext.uiVariant = 'results';
        logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] web_search → results (${slots.results.length} items)`);
      }
      // Still loading
      else {
        state.intentContext.uiVariant = 'loading';
        logger.debug('🎨 [NODE:SELECT_OVERLAY_VARIANT] web_search → loading');
      }
      break;
      
    // TODO: Add other intents (screen_intelligence, command_guide, etc.)
    
    default:
      // Use default variant from descriptor
      state.intentContext.uiVariant = descriptor.defaultVariant || 'results';
      logger.debug(`🎨 [NODE:SELECT_OVERLAY_VARIANT] ${intent} → ${state.intentContext.uiVariant} (default)`);
  }
  
  return state;
};
