/**
 * Suggested responses for different intent types
 */

// Response arrays for variety
const memoryStoreResponses = [
    "I've noted that information.",
    "Information saved.",
    "Got it, I'll remember that.",
    "Okay, I'll keep that in mind.",
    "Saving that for future reference.",
    "Noted and stored.",
    "I've logged that in your memory.",
    "That's been added to your timeline.",
    "I’ve recorded it.",
    "Information locked in.",
    "Got it saved.",
    "That's now in your memory.",
    "All set, I’ve saved that.",
    "Just stored that.",
    "Saved and secured.",
    "I've written that down for you.",
    "Marked it in your log.",
    "That’s remembered.",
    "I'll hold on to that.",
    "Added to your notes.",
    "That's been archived.",
    "That event is now stored.",
    "Got that for you.",
    "Noted and added to your timeline.",
    "I saved that detail.",
    "Stored it away.",
    "That's filed safely.",
    "Logged and remembered.",
    "I've taken note of it.",
    "It’s on record now.",
    "That’s been written to memory.",
    "I’ve kept that in mind.",
    "You got it — remembered.",
    "Consider it stored.",
    "That’s now saved with me.",
    "Remembering it now.",
    "Stored with context.",
    "Information captured.",
    "It’s in the system.",
    "Jotted that down.",
    "Saved with a timestamp.",
    "Context saved successfully.",
    "Added to your history.",
    "Noted for reference.",
    "Stored that snippet.",
    "Saved to your logbook.",
    "I’ll recall that when needed.",
    "Got it — it’s logged.",
    "That’s saved in your memory vault.",
    "Added that to your profile."
];

const memoryRetrieveResponses = [
    "Let me check what I have stored.",
    "I'll look that up for you.",
    "Searching my memory.",
    "One moment, retrieving that now.",
    "Accessing your saved information.",
    "Digging into your timeline.",
    "Let me pull that up.",
    "Checking your logs now.",
    "Let’s see what you saved.",
    "Looking that up from memory.",
    "I’ll fetch that for you.",
    "Reviewing your past entries.",
    "Searching through your stored notes.",
    "Checking past data.",
    "Retrieving now...",
    "Consulting your records.",
    "Scanning your history.",
    "Rewinding your timeline.",
    "Fetching stored info.",
    "Let’s take a look at your memory.",
    "Pulling from your saved items.",
    "Let me reference your notes.",
    "Grabbing what I stored for you.",
    "Pulling that from memory bank.",
    "Let me remind you...",
    "Here’s what’s stored on that.",
    "Let’s find out what’s in memory.",
    "Searching your context.",
    "Looking for previous mentions.",
    "That rings a bell — retrieving it now.",
    "Let me refresh your memory.",
    "Pulling that event from your timeline.",
    "Querying your stored moments.",
    "Digging that out of memory.",
    "I’ll find what you saved.",
    "Opening your mental vault.",
    "Fetching previously stored details.",
    "I’m checking your past records.",
    "That was saved — I’ll get it.",
    "Unpacking that from history.",
    "Resurfacing stored context.",
    "That sounds familiar — checking now.",
    "I'm on it — just a second.",
    "Let me recall that detail.",
    "Reading from your notes.",
    "Surfacing saved memory...",
    "Reviewing past events now.",
    "I'll see what we discussed.",
    "That should be in your archive — checking."
];

const commandResponses = [
    "I'll execute that command.",
    "Running that for you.",
    "Processing your request.",
    "Done. What's next?",
    "Working on it.",
    "Command received and underway.",
    "Executing now.",
    "Got it — performing the action.",
    "Understood — doing it now.",
    "On it.",
    "Initiating that command.",
    "Let me take care of that.",
    "Setting that up.",
    "Your request is in motion.",
    "Launching the task.",
    "Starting the action now.",
    "Kicking that off.",
    "Moving forward with your command.",
    "It’s happening now.",
    "I’ll take care of it right away.",
    "Got your request — executing now.",
    "Just a sec — doing that now.",
    "Beginning the operation.",
    "Making that happen.",
    "I'll start that up.",
    "Command confirmed.",
    "Right away — I'm on it.",
    "Processing as requested.",
    "I'll handle that immediately.",
    "Activating the action.",
    "You got it — starting now.",
    "Acknowledged — doing it.",
    "Deploying the command.",
    "Executing your task now.",
    "I’ve queued that up.",
    "That’s in progress.",
    "It’s rolling.",
    "Performing the task now.",
    "Give me a moment — doing it now.",
    "I’ve started that.",
    "Task received — initiating.",
    "I’ll take care of that command.",
    "Got it — running now.",
    "I’ll get it done.",
    "Happening now.",
    "That’s being handled.",
    "I’ll perform that action.",
    "I’m working on your request.",
    "Action underway.",
    "Handling it right now."
];

const questionResponses = [
    "I can help you find that information.",
    "Let me look that up for you.",
    "I'll help you with that question.",
    "Give me a moment to check on that.",
    "Let me investigate that for you.",
    "That’s a good question — let me check.",
    "Looking into it right now.",
    "Give me a sec to find the answer.",
    "I’ll get the information you need.",
    "Let’s explore that together.",
    "I’ll look it up for you.",
    "Checking the details on that.",
    "Let me gather that info for you.",
    "Finding the best answer for you.",
    "I’ll pull that data right now.",
    "Give me a moment — I’m checking.",
    "I’m on it — let’s find the answer.",
    "One sec while I look into that.",
    "Researching that for you.",
    "That’s a great question — I’ll handle it.",
    "Let’s figure that out.",
    "Digging into that now.",
    "Let me see what I can find.",
    "I’ve got you — just a moment.",
    "You got it — I’m searching now.",
    "Let’s find that together.",
    "Hold on — I’ll get that for you.",
    "I’m working on your question.",
    "Checking into that for you now.",
    "I’ll do my best to answer that.",
    "Searching my resources for that answer.",
    "Finding out for you.",
    "One moment — I’ll look into it.",
    "I’ll try to answer that thoroughly.",
    "Let me fetch the details.",
    "Accessing what I know about that.",
    "Pulling up the information now.",
    "Let me locate that answer for you.",
    "I’ll respond with what I know.",
    "Just a sec — pulling info.",
    "Hold tight — I’m getting the answer.",
    "Allow me to explain.",
    "Here's what I know about that.",
    "Let me help clarify that for you.",
    "Let me walk you through the answer.",
    "I'll analyze that for you.",
    "I’ll share what I can on that.",
    "I’m compiling the facts now.",
    "I’ll give you a concise explanation.",
    "Hang on — let’s solve that together.",
    "Let me provide a detailed answer."
];

const webSearchResponses = [
    "Searching the web for you...",
    "Looking that up online...",
    "Checking the latest information...",
    "Searching for current data...",
    "Finding the most up-to-date info...",
    "Querying web sources...",
    "Searching across the internet...",
    "Looking for the latest results...",
    "Gathering information from the web...",
    "Checking online resources..."
];

const greetingResponses = [
    "Hello! How can I help you today?",
    "Hi there! What can I do for you?",
    "Good to see you! How can I assist?",
    "Hey! What's on your mind?",
    "Welcome back! Ready when you are.",
    "Hello again! What can I do for you?",
    "Hi! Need anything?",
    "Hey there! How may I be of service?",
    "Greetings! How can I help you today?",
    "Hey! Let me know how I can assist.",
    "Hi! What's up?",
    "Hey friend! What can I do today?",
    "Hi there! I'm here to assist.",
    "Hello! Let's get started.",
    "Greetings! I'm at your service.",
    "Hi! Let's make today productive.",
    "Howdy! How can I assist today?",
    "Hey! Hope your day's going well.",
    "Hi! What brings you here today?",
    "Nice to see you! How can I help?",
    "Hello! Just say the word.",
    "Hi! What would you like to do?",
    "Hello! I'm ready when you are.",
    "Hi there! Need a hand?",
    "Hello! Let's take care of that.",
    "Hey! Ready to assist as always.",
    "Welcome! How can I be useful?",
    "Hi! Got a task for me?",
    "Hey! Let's tackle something together.",
    "Hi there! Here to support you.",
    "Hello again! Let's get things done.",
    "Hey there! What's first?",
    "Hi! Let me know what you need.",
    "Good day! I'm standing by.",
    "Hey! How can I serve you today?",
    "Hi there! Ready to dive in?",
    "Hello! What's the plan today?",
    "Hi! I'm here to help.",
    "Hey! Let's make progress.",
    "Welcome back! What's on the agenda?",
    "Hi! How may I assist you right now?",
    "Hey! Happy to help, as always.",
    "Greetings, friend! What's next?",
    "Hi! You can count on me.",
    "Hey! I'm listening.",
    "Hello! Let's get to work.",
    "Hi! Always good to see you.",
    "Hey! Just say the word."
];

const IntentResponses = {
  /**
   * Get suggested response for a given intent
   * @param {string} intent - Intent type
   * @param {string} message - Original user message
   * @param {Array} entities - Extracted entities
   * @returns {string} Suggested response
   */
  getSuggestedResponse(intent, message, entities = []) {
    switch (intent) {
      case 'memory_store':
        return this._getMemoryStoreResponse(message, entities);

      case 'memory_retrieve':
        return this._getMemoryRetrieveResponse(message, entities);

      case 'command':
        return this._getCommandResponse(message, entities);

      case 'question':
        return this._getQuestionResponse(message, entities);

      case 'greeting':
        return this._getGreetingResponse(message);

      case 'web_search':
        return this._getWebSearchResponse(message);

      case 'context':
        return this._getContextResponse(message);

      case 'farewell':
        return this._getFarewellResponse(message);

      default:
        return "I understand. How can I assist you?";
    }
  },

  _getMemoryStoreResponse(_message, _entities) {
    // Use random response from array for variety
    const randomIndex = Math.floor(Math.random() * memoryStoreResponses.length);
    return memoryStoreResponses[randomIndex];
  },

  _getMemoryRetrieveResponse(_message, _entities) {
    // Use random response from array for variety
    const randomIndex = Math.floor(Math.random() * memoryRetrieveResponses.length);
    return memoryRetrieveResponses[randomIndex];
  },

  _getCommandResponse(message, _entities) {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('screenshot')) {
      return "Taking a screenshot...";
    } else if (lowerMessage.includes('open')) {
      return "Opening the application...";
    } else if (lowerMessage.includes('close')) {
      return "Closing the application...";
    } else if (lowerMessage.includes('search')) {
      return "Searching...";
    }

    return "Executing command...";
  },

  _getQuestionResponse(message, _entities) {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.startsWith('what')) {
      return "Let me explain that for you...";
    } else if (lowerMessage.startsWith('how')) {
      return "Here's how that works...";
    } else if (lowerMessage.startsWith('why')) {
      return "The reason is...";
    } else if (lowerMessage.startsWith('when')) {
      return "Let me check the timing...";
    } else if (lowerMessage.startsWith('where')) {
      return "Let me find that location...";
    } else if (lowerMessage.startsWith('who')) {
      return "Let me tell you about that...";
    }

    return "Let me answer that for you...";
  },

  _getGreetingResponse(_message) {
    // Use random greeting response for variety
    const randomIndex = Math.floor(Math.random() * greetingResponses.length);
    return greetingResponses[randomIndex];
  },

  _getWebSearchResponse(_message) {
    // Use random web search response for variety
    const randomIndex = Math.floor(Math.random() * webSearchResponses.length);
    return webSearchResponses[randomIndex];
  },

  _getContextResponse(_message) {
    return "Let me review our conversation history...";
  },

  _getFarewellResponse(_message) {
    return "Goodbye! Have a great day!";
  },

  /**
   * Get node-specific progress message
   * @param {string} nodeName - Name of the node being executed
   * @param {Object} state - Current state
   * @returns {string} Progress message
   */
  getNodeProgressMessage(nodeName, state = {}) {
    const nodeMessages = {
      parseIntent: "Understanding your request...",
      webSearch: "Searching the web...",
      sanitizeWeb: "Processing search results...",
      retrieveMemory: "Checking your memories...",
      filterMemory: "Filtering relevant information...",
      answer: "Generating response...",
      validateAnswer: "Validating answer quality...",
      storeConversation: "Saving conversation...",
      storeMemory: "Storing information..."
    };

    return nodeMessages[nodeName] || `Processing ${nodeName}...`;
  }
};

module.exports = IntentResponses;
