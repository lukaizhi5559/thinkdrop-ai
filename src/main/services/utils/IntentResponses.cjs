/**
 * Shared Intent Response Utility
 * Centralized location for all intent-based suggested responses
 * Used across DistilBertIntentParser, FastIntentParser, and HybridIntentParser
 */

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

// -----------------------------
// CONTEXT ANALYSIS
// -----------------------------
const contextAnalysisResponses = [
  "Analyzing conversation context",
  "Reading between the lines",
  "Understanding your intent",
  "Parsing your request",
  "Getting the full picture",
  "Connecting the dots",
  "Piecing things together",
  "Making sense of this",
  "Interpreting your message",
  "Grasping the context",
  "Checking what led up to this",
  "Weaving prior points together",
  "Mapping your objectives",
  "Clarifying what you need",
  "Resolving ambiguities",
  "Aligning on your goal",
  "Reviewing cues and signals",
  "Deriving the core ask",
  "Distilling the request",
  "Locking onto the intent"
];

// -----------------------------
// CONVERSATION (CURRENT THREAD) SEARCH
// -----------------------------
const conversationSearchResponses = [
  "Checking current conversation",
  "Reviewing our chat",
  "Looking at recent messages",
  "Scanning this discussion",
  "Checking what we've covered",
  "Reviewing our exchange",
  "Looking back at our chat",
  "Checking conversation history",
  "Scanning recent context",
  "Reviewing this session",
  "Finding relevant points in this thread",
  "Surfacing recent mentions",
  "Pulling the latest highlights",
  "Catching up on this discussion",
  "Re-reading the last few messages",
  "Gathering near-context",
  "Spotting references we just made",
  "Collecting recent details",
  "Rewinding the thread briefly",
  "Syncing with the current topic"
];

// -----------------------------
// SESSION SEARCH (PAST SESSIONS)
const sessionSearchResponses = [
  "Searching session history",
  "Looking through past chats",
  "Checking previous sessions",
  "Scanning your chat history",
  "Reviewing earlier conversations",
  "Digging through session logs",
  "Searching conversation archives",
  "Looking at your chat timeline",
  "Checking session records",
  "Browsing conversation history",
  "Pulling prior session highlights",
  "Gathering context from older threads",
  "Surfacing earlier decisions",
  "Finding earlier references",
  "Cross-checking past discussions",
  "Reviewing prior outcomes",
  "Looking up older notes",
  "Checking what we did before",
  "Revisiting previous work",
  "Skimming historical context"
];

// -----------------------------
// CROSS-SESSION (GLOBAL) SEARCH
// -----------------------------
const crossSessionSearchResponses = [
  "Searching all conversations",
  "Looking across all sessions",
  "Checking your full history",
  "Scanning everything we've discussed",
  "Searching your complete timeline",
  "Looking through all our chats",
  "Checking your entire archive",
  "Scanning all conversation data",
  "Searching comprehensive history",
  "Looking at everything stored",
  "Querying global memory",
  "Aggregating results across sessions",
  "Surfacing cross-session links",
  "Building the big-picture view",
  "Merging signals from everywhere",
  "Hunting for long-range context",
  "Reconciling past and present",
  "Connecting distant references",
  "Mining the long tail",
  "Pulling a full-history match"
];

// -----------------------------
// INTENT CLASSIFICATION
// -----------------------------
const intentClassificationResponses = [
  "Understanding your intent",
  "Figuring out what you need",
  "Analyzing your request",
  "Determining the best approach",
  "Classifying your query",
  "Understanding your goal",
  "Parsing your intention",
  "Getting to the heart of it",
  "Identifying your needs",
  "Decoding your request",
  "Assigning the right intent",
  "Matching to a workflow",
  "Choosing the correct track",
  "Recognizing the task type",
  "Labeling this correctly",
  "Locking onto the right intent",
  "Selecting the best handler",
  "Clarifying the category",
  "Resolving intent signals",
  "Pinpointing what to do"
];

// -----------------------------
// ROUTING (PIPELINE DECISION)
// -----------------------------
const routingResponses = [
  "Finding the best path forward",
  "Determining next steps",
  "Choosing the right approach",
  "Routing your request",
  "Selecting optimal strategy",
  "Planning the response",
  "Mapping out the solution",
  "Deciding how to help",
  "Charting the course",
  "Setting the direction",
  "Choosing the right tools",
  "Queuing the proper modules",
  "Picking the proper stage",
  "Orchestrating the pipeline",
  "Allocating the lanes",
  "Balancing speed and depth",
  "Prioritizing useful context",
  "Sequencing the steps",
  "Aligning to your goal",
  "Locking the route"
];

// -----------------------------
// RESPONSE GENERATION
// -----------------------------
const responseGenerationResponses = [
  "Crafting your response",
  "Generating an answer",
  "Putting together a reply",
  "Formulating the response",
  "Creating your answer",
  "Building the reply",
  "Composing a response",
  "Preparing your answer",
  "Constructing the reply",
  "Assembling the response",
  "Shaping a clear reply",
  "Refining the wording",
  "Making this concise and useful",
  "Tailoring the output to you",
  "Expressing this simply",
  "Packaging the details",
  "Arranging the key points",
  "Making it actionable",
  "Ensuring clarity and flow",
  "Delivering a helpful answer"
];

// -----------------------------
// CONTEXT EVALUATION
// -----------------------------
const contextEvaluationResponses = [
  "Evaluating response quality",
  "Checking if context is sufficient",
  "Analyzing response completeness",
  "Verifying answer adequacy",
  "Assessing context coverage",
  "Reviewing response quality",
  "Validating information completeness",
  "Examining answer thoroughness",
  "Checking for missing details",
  "Evaluating context depth",
  "Analyzing response accuracy",
  "Assessing information gaps",
  "Reviewing answer quality",
  "Checking response relevance",
  "Validating context sufficiency",
  "Examining information quality",
  "Evaluating answer completeness",
  "Analyzing context adequacy",
  "Checking for knowledge gaps",
  "Assessing response depth"
];

class IntentResponses {
  /**
   * Get suggested response for a given intent and message
   * @param {string} intent - The classified intent
   * @param {string} message - The original user message
   * @returns {string} - Suggested response
   */
  static getSuggestedResponse(intent, message) {
    const responses = {
      memory_store: memoryStoreResponses,
      memory_retrieve: memoryRetrieveResponses,
      command: commandResponses,
      question: questionResponses,
      greeting: greetingResponses,
      context_analysis: contextAnalysisResponses,
      conversation_search: conversationSearchResponses,
      session_search: sessionSearchResponses,
      cross_session_search: crossSessionSearchResponses,
      intent_classification: intentClassificationResponses,
      routing: routingResponses,
      response_generation: responseGenerationResponses,
      context_evaluation: contextEvaluationResponses
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
        memory_store: memoryStoreResponses,
        memory_retrieve: memoryRetrieveResponses,
        command: commandResponses,
        question: questionResponses,
        greeting: greetingResponses,
        context_analysis: contextAnalysisResponses,
        conversation_search: conversationSearchResponses,
        session_search: sessionSearchResponses,
        cross_session_search: crossSessionSearchResponses,
        intent_classification: intentClassificationResponses,
        routing: routingResponses,
        response_generation: responseGenerationResponses,
        context_evaluation: contextEvaluationResponses
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
    return ['memory_store', 'memory_retrieve', 'command', 'question', 'greeting', 
            'context_analysis', 'conversation_search', 'session_search', 'cross_session_search',
            'intent_classification', 'routing', 'response_generation', 'context_evaluation'];
  }

  /**
   * Get a random thinking update message for pipeline stages
   * @param {string} stage - The pipeline stage
   * @returns {string} - Random thinking message
   */
  static getThinkingMessage(stage) {
    return this.getRandomResponse(stage);
  }
}

module.exports = IntentResponses;
