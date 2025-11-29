/**
 * Overlay Intent System - Type Definitions
 * 
 * Defines the contract between:
 * - State Graph (orchestration)
 * - Overlay UI (transparent React layer)
 * - Intent Descriptors (schema registry)
 */

/**
 * All supported intent types in Thinkdrop AI
 */
export type IntentLabel =
  | 'screen_intelligence'
  | 'command_execute'
  | 'command_guide'
  | 'memory_store'
  | 'memory_retrieve'
  | 'web_search'
  | 'general_knowledge'
  | 'question'
  | 'greeting';

/**
 * How the answer node should behave for this intent
 */
export type AnswerMode = 
  | 'none'   // Skip answer generation, overlay-only
  | 'brief'  // Short summary + overlay UI
  | 'full';  // Full natural language response

/**
 * Overlay UI component schema
 * Describes what shadcn/ui components to render and how
 */
export type OverlaySchema = {
  type: string; // e.g., 'overlay.choiceCard', 'overlay.personCard', 'overlay.bubble'
  position: 'bottom-center' | 'side-of-anchor' | 'top-center' | 'center' | 'top-right' | 'bottom-left';
  anchorSlot?: string; // Slot name for entity anchor (e.g., 'anchorEntityId')
  props: Record<string, any>; // Component-specific props with slot references
};

/**
 * Intent descriptor - the contract for each intent type
 * Defines how the intent integrates with state graph + overlay
 */
export type IntentDescriptor = {
  id: IntentLabel;
  
  // State graph integration
  entryNode: string; // Which node to enter when this intent is triggered
  allowBypassParseIntent: boolean; // Can skip parseIntent for continuations
  
  // Data model
  slots: {
    required: string[]; // Must be present for intent to execute
    optional?: string[]; // Nice-to-have, filled opportunistically
  };
  
  // Overlay UI
  uiVariants: Record<string, OverlaySchema>; // Named UI states (choice, loading, results, error)
  defaultVariant?: string; // Fallback if variant selection fails
  
  // Answer node behavior
  answerMode?: AnswerMode; // Default: 'full'
};

/**
 * Intent context - flows through state graph
 * Tracks current intent, data slots, and UI state
 */
export type IntentContext = {
  intent: IntentLabel | null;
  slots: Record<string, any>; // Dynamic data filled by graph nodes
  uiVariant?: string; // Current UI variant to render
};

/**
 * Overlay event - sent from overlay UI back to graph
 * Triggers intent continuation without re-parsing
 */
export type OverlayEvent = {
  type: 'intent.continuation' | 'ui.action';
  
  // Intent routing
  intent: IntentLabel;
  slots: Record<string, any>; // Updated/new slot values
  
  // Correlation & tracking
  conversationId: string;
  correlationId: string; // Ties to a pending graph step
  previousStepId?: string; // Optional step tracking
  
  // Behavior flags
  bypassParseIntent: boolean; // Usually true for continuations
  
  // Analytics & debugging
  sourceComponent?: string; // e.g., 'webSearch.choice.linkedin'
  uiActionId?: string; // e.g., 'clicked_linkedin', 'pressed_retry'
  meta?: Record<string, any>; // Arbitrary metadata
};

/**
 * Overlay payload - sent from graph to overlay UI
 * Tells overlay what to render
 */
export type OverlayPayload = {
  intent: IntentLabel;
  uiVariant: string;
  slots: Record<string, any>;
  conversationId: string;
  correlationId: string;
};

/**
 * Automation plan fragment (for complex intents)
 * Used by screen_intelligence and command_guide
 */
export type AutomationStep = {
  id: string;
  action: string; // e.g., 'movePointer', 'click', 'highlightRegion', 'refreshOCR'
  params?: Record<string, any>;
  retryPolicy?: {
    maxAttempts: number;
    delayMs?: number;
  };
};

export type AutomationPlan = {
  steps: AutomationStep[];
  metadata?: {
    description?: string;
    createdBy?: string;
  };
};
