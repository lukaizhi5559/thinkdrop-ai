/**
 * Overlay Output Node
 * 
 * Packages intent context into overlay payload for the UI.
 * This node runs at the tail of overlay-enabled intents,
 * right before storeConversation or end.
 * 
 * Output is sent to the overlay window via IPC.
 */

const logger = require('./../../../logger.cjs');

/**
 * Package overlay payload for UI rendering
 * @param {object} state - Graph state with intentContext
 * @returns {object} Updated state with overlayPayload
 */
module.exports = function overlayOutput(state) {
  const { intent, slots, uiVariant } = state.intentContext || {};
  
  // Skip if no intent context or variant
  if (!intent || !uiVariant) {
    logger.debug('⏭️  [NODE:OVERLAY_OUTPUT] No overlay context, skipping');
    return state;
  }
  
  // Generate correlation ID if not present
  const correlationId = state.correlationId || `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Package overlay payload
  state.overlayPayload = {
    intent,
    uiVariant,
    slots: slots || {},
    conversationId: state.context?.sessionId || 'default_session',
    correlationId,
  };
  
  logger.debug(`📤 [NODE:OVERLAY_OUTPUT] Prepared overlay payload:`);
  logger.debug(`   Intent: ${intent}`);
  logger.debug(`   Variant: ${uiVariant}`);
  logger.debug(`   Slots: ${Object.keys(slots || {}).join(', ')}`);
  logger.debug(`   Correlation ID: ${correlationId}`);
  
  return state;
};
