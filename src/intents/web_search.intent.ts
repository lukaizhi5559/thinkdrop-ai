/**
 * Web Search Intent Descriptor
 * 
 * Handles queries that require web search:
 * - Person lookups (LinkedIn, social media)
 * - Time-sensitive information
 * - Factual questions requiring current data
 * 
 * Flow:
 * 1. User asks about someone/something
 * 2. Graph performs web search (parallel with memory retrieval)
 * 3. If multiple channels available → show choice UI
 * 4. User selects channel → re-enter graph with specific channel
 * 5. Show results in person/info card
 */

import { IntentDescriptor } from '../types/overlay-intents';

export const webSearchIntent: IntentDescriptor = {
  id: 'web_search',
  
  // State graph integration
  entryNode: 'parallelWebAndMemory', // From AgentOrchestrator state graph
  allowBypassParseIntent: true, // Can skip parseIntent for continuations
  
  // Answer node behavior
  answerMode: 'brief', // Short summary + overlay UI
  
  // Data slots
  slots: {
    required: ['subject'], // Who/what we're searching for
    optional: [
      'channel',           // Specific channel (linkedin, twitter, etc.)
      'searchQuery',       // Actual search query used
      'results',           // Search results array
      'candidateChannels', // Available channels to choose from
      'anchorEntityId',    // OCR entity to anchor result card to
      'loadingMessage',    // Loading state message
      'errorMessage',      // Error state message
      'channelLabel',      // Display label for selected channel
    ],
  },
  
  // UI variants
  uiVariants: {
    // User needs to choose between multiple channels
    choice: {
      type: 'overlay.choiceCard',
      position: 'bottom-center',
      props: {
        titleSlot: 'subject', // "John Smith"
        subtitle: 'What would you like to explore?',
        buttonsSlot: 'candidateChannels', // [{ id: 'linkedin', label: 'LinkedIn' }, ...]
        dismissible: true,
      },
    },
    
    // Searching in progress
    loading: {
      type: 'overlay.loadingBubble',
      position: 'bottom-center',
      props: {
        messageSlot: 'loadingMessage', // "Searching for {subject}..."
        showSpinner: true,
      },
    },
    
    // Search results ready
    results: {
      type: 'overlay.personCard',
      position: 'side-of-anchor',
      anchorSlot: 'anchorEntityId', // Anchor to OCR entity if available
      props: {
        nameSlot: 'subject',           // "John Smith"
        subtitleSlot: 'channelLabel',  // "LinkedIn Profile"
        itemsSlot: 'results',          // [{ title, url, summary }, ...]
        footerText: 'Tap a link to open',
        dismissible: true,
      },
    },
    
    // Search failed or no results
    error: {
      type: 'overlay.errorCard',
      position: 'bottom-center',
      props: {
        titleSlot: 'subject',
        messageSlot: 'errorMessage', // "Couldn't find information about {subject}"
        buttons: [
          { id: 'retry', label: 'Retry', variant: 'primary' },
          { id: 'cancel', label: 'Cancel', variant: 'ghost' },
        ],
      },
    },
  },
  
  defaultVariant: 'results',
};
