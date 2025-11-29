/**
 * Intent Registry
 * 
 * Central registry for all intent descriptors.
 * Used by:
 * - AgentOrchestrator (to get entry nodes and slot requirements)
 * - Overlay renderer (to get UI variant schemas)
 * - IPC handlers (to validate overlay events)
 */

import { IntentLabel, IntentDescriptor } from '../types/overlay-intents';
import { webSearchIntent } from './web_search.intent';

/**
 * Registry of all intent descriptors
 * TODO: Add other intents as they're implemented
 */
export const IntentRegistry: Partial<Record<IntentLabel, IntentDescriptor>> = {
  web_search: webSearchIntent,
  
  // Placeholders for future intents
  // screen_intelligence: screenIntelligenceIntent,
  // command_execute: commandExecuteIntent,
  // command_guide: commandGuideIntent,
  // memory_store: memoryStoreIntent,
  // memory_retrieve: memoryRetrieveIntent,
  // general_knowledge: generalKnowledgeIntent,
  // question: questionIntent,
  // greeting: greetingIntent,
};

/**
 * Get intent descriptor by ID
 * @param id Intent label
 * @returns Intent descriptor or null if not found
 */
export function getIntentDescriptor(id: IntentLabel): IntentDescriptor | null {
  return IntentRegistry[id] || null;
}

/**
 * Check if an intent has overlay support
 * @param id Intent label
 * @returns True if intent has UI variants defined
 */
export function hasOverlaySupport(id: IntentLabel): boolean {
  const descriptor = getIntentDescriptor(id);
  return descriptor !== null && Object.keys(descriptor.uiVariants).length > 0;
}

/**
 * Get all registered intent IDs
 * @returns Array of intent labels
 */
export function getRegisteredIntents(): IntentLabel[] {
  return Object.keys(IntentRegistry) as IntentLabel[];
}

/**
 * Validate that required slots are present
 * @param id Intent label
 * @param slots Current slot values
 * @returns True if all required slots are present
 */
export function validateRequiredSlots(id: IntentLabel, slots: Record<string, any>): boolean {
  const descriptor = getIntentDescriptor(id);
  if (!descriptor) return false;
  
  return descriptor.slots.required.every(slot => {
    const value = slots[slot];
    return value !== undefined && value !== null && value !== '';
  });
}
