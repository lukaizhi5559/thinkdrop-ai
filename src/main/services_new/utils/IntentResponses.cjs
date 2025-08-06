/**
 * Shared Intent Response Utility
 * Centralized location for all intent-based suggested responses
 * Used across DistilBertIntentParser, FastIntentParser, and HybridIntentParser
 */

class IntentResponses {
  /**
   * Get suggested response for a given intent and message
   * @param {string} intent - The classified intent
   * @param {string} message - The original user message
   * @returns {string} - Suggested response
   */
  static getSuggestedResponse(intent, message) {
    const responses = {
      memory_store: [
        "I've noted that information.", 
        "Information saved.", 
        "Got it, I'll remember that."
      ],
      memory_retrieve: [
        "Let me check what I have stored.", 
        "I'll look that up for you.", 
        "Searching my memory"
      ],
      command: [
        "I'll execute that command.", 
        "Running that for you.", 
        "Processing your request."
      ],
      question: [
        "I can help you find that information.", 
        "Let me look that up for you.", 
        "I'll help you with that question."
      ],
      greeting: [
        "Hello! How can I help you today?", 
        "Hi there! What can I do for you?", 
        "Good to see you! How can I assist?"
      ]
    };
    
    const intentResponses = responses[intent] || responses.question;
    const randomIndex = Math.floor(Math.random() * intentResponses.length);
    return intentResponses[randomIndex];
  }

  /**
   * Get all available response templates for a specific intent
   * @param {string} intent - The intent to get responses for
   * @returns {string[]} - Array of response templates
   */
  static getResponseTemplates(intent) {
    const responses = {
      memory_store: [
        "I've noted that information.", 
        "Information saved.", 
        "Got it, I'll remember that."
      ],
      memory_retrieve: [
        "Let me check what I have stored.", 
        "I'll look that up for you.", 
        "Searching my memory"
      ],
      command: [
        "I'll execute that command.", 
        "Running that for you.", 
        "Processing your request."
      ],
      question: [
        "I can help you find that information.", 
        "Let me look that up for you.", 
        "I'll help you with that question."
      ],
      greeting: [
        "Hello! How can I help you today?", 
        "Hi there! What can I do for you?", 
        "Good to see you! How can I assist?"
      ]
    };
    
    return responses[intent] || responses.question;
  }

  /**
   * Get a random response for a given intent
   * @param {string} intent - The classified intent
   * @returns {string} - Random suggested response
   */
  static getRandomResponse(intent) {
    const templates = this.getResponseTemplates(intent);
    const randomIndex = Math.floor(Math.random() * templates.length);
    return templates[randomIndex];
  }

  /**
   * Get all supported intents
   * @returns {string[]} - Array of supported intent names
   */
  static getSupportedIntents() {
    return ['memory_store', 'memory_retrieve', 'command', 'question', 'greeting'];
  }
}

module.exports = IntentResponses;
