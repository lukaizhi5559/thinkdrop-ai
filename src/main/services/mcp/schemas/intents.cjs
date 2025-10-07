/**
 * MCP Protocol - Intent Definitions
 * 
 * Maps Thinkdrop AI intents to MCP services and actions.
 */

/**
 * Intent Types (from Thinkdrop AI)
 */
const IntentTypes = {
  GENERAL: 'GENERAL',
  MEMORY: 'MEMORY',
  CONTEXT: 'CONTEXT',
  COMMAND: 'COMMAND',
  QUESTION: 'QUESTION',
  GREETING: 'GREETING'
};

/**
 * Intent to Service Mapping
 */
const IntentServiceMapping = {
  [IntentTypes.GENERAL]: 'phi4',
  [IntentTypes.MEMORY]: 'user-memory',
  [IntentTypes.CONTEXT]: null, // Handled locally by ConversationSessionAgent
  [IntentTypes.COMMAND]: null, // May route to multiple services
  [IntentTypes.QUESTION]: 'phi4', // Route to Phi4 for general questions
  [IntentTypes.GREETING]: null // Handled locally
};

/**
 * Intent to Action Mapping
 */
const IntentActionMapping = {
  [IntentTypes.GENERAL]: {
    default: 'general.answer'
  },
  [IntentTypes.MEMORY]: {
    store: 'memory.store',
    search: 'memory.search',
    retrieve: 'memory.retrieve',
    update: 'memory.update',
    delete: 'memory.delete',
    list: 'memory.list',
    classifyConversational: 'memory.classify-conversational-query'
  },
  [IntentTypes.CONTEXT]: {
    fetch: 'conversation.fetch',
    summarize: 'conversation.summarize',
    related: 'conversation.related'
  },
  [IntentTypes.COMMAND]: {
    webSearch: 'web.search',
    webNews: 'web.news',
    webScrape: 'web.scrape',
    screenCapture: 'screen.capture',
    automationExecute: 'automation.execute',
    plannerPlan: 'planner.plan'
  },
  [IntentTypes.QUESTION]: {
    default: 'general.answer'
  }
};

/**
 * Service Capabilities
 */
const ServiceCapabilities = {
  'user-memory': {
    actions: [
      'memory.store',
      'memory.search',
      'memory.retrieve',
      'memory.update',
      'memory.delete',
      'memory.list',
      'memory.classify-conversational-query'
    ],
    features: [
      'semantic-search',
      'entity-extraction',
      'embeddings',
      'cross-session-search',
      'screenshot-support',
      'conversational-context'
    ]
  },
  'web-search': {
    actions: [
      'web.search',
      'web.news',
      'web.scrape'
    ],
    features: [
      'multi-provider',
      'intelligent-caching',
      'fallback-mechanism',
      'rate-limiting',
      'result-enrichment'
    ]
  },
  'phi4': {
    actions: [
      'general.answer',
      'general.chat',
      'general.complete'
    ],
    features: [
      'conversational',
      'context-aware',
      'streaming',
      'multi-turn'
    ]
  }
};

/**
 * Get service name for intent
 * @param {string} intent - Intent type
 * @returns {string|null} Service name or null if handled locally
 */
function getServiceForIntent(intent) {
  return IntentServiceMapping[intent] || null;
}

/**
 * Get action for intent and operation
 * @param {string} intent - Intent type
 * @param {string} operation - Operation name (optional, defaults to 'default')
 * @returns {string|null} Action name or null
 */
function getActionForIntent(intent, operation = 'default') {
  const mapping = IntentActionMapping[intent];
  if (!mapping) return null;
  
  return mapping[operation] || mapping.default || null;
}

/**
 * Check if intent should be routed to MCP
 * @param {string} intent - Intent type
 * @param {object} config - MCP config object
 * @returns {boolean}
 */
function shouldRouteToMCP(intent, config) {
  if (!config || !config.features || !config.features.enabled) {
    return false;
  }

  switch (intent) {
    case IntentTypes.MEMORY:
      return config.features.routeMemoryToMCP;
    case IntentTypes.GENERAL:
    case IntentTypes.QUESTION:
      return config.features.routePhi4ToMCP;
    case IntentTypes.COMMAND:
      // Check if command requires web search
      return config.features.routeWebSearchToMCP;
    case IntentTypes.CONTEXT:
    case IntentTypes.GREETING:
      return false; // Always handled locally
    default:
      return false;
  }
}

/**
 * Get service capabilities
 * @param {string} serviceName - Service name
 * @returns {object|null} Capabilities object or null
 */
function getServiceCapabilities(serviceName) {
  return ServiceCapabilities[serviceName] || null;
}

/**
 * Check if service supports action
 * @param {string} serviceName - Service name
 * @param {string} action - Action name
 * @returns {boolean}
 */
function serviceSupportsAction(serviceName, action) {
  const capabilities = ServiceCapabilities[serviceName];
  if (!capabilities) return false;
  
  return capabilities.actions.includes(action);
}

/**
 * Parse action string into service and action
 * @param {string} actionString - Action string (e.g., "memory.store")
 * @returns {object} { service: string, action: string }
 */
function parseAction(actionString) {
  const parts = actionString.split('.');
  if (parts.length < 2) {
    throw new Error(`Invalid action string: ${actionString}`);
  }

  const servicePrefix = parts[0];
  const action = parts.slice(1).join('.');

  // Map service prefix to service name
  const servicePrefixMapping = {
    'memory': 'user-memory',
    'web': 'web-search',
    'general': 'phi4',
    'conversation': 'conversation-session',
    'screen': 'screen-capture',
    'automation': 'automation',
    'planner': 'planner'
  };

  const service = servicePrefixMapping[servicePrefix];
  if (!service) {
    throw new Error(`Unknown service prefix: ${servicePrefix}`);
  }

  return { service, action: actionString };
}

/**
 * Determine operation from query/request
 * @param {string} intent - Intent type
 * @param {object} params - Request parameters
 * @returns {string} Operation name
 */
function determineOperation(intent, params = {}) {
  if (intent === IntentTypes.MEMORY) {
    // Determine memory operation from params
    if (params.action) return params.action.replace('memory-', '');
    if (params.query) return 'search';
    if (params.memoryId && params.updates) return 'update';
    if (params.memoryId && !params.updates) return 'retrieve';
    return 'store'; // Default to store
  }

  if (intent === IntentTypes.COMMAND) {
    // Determine command operation
    if (params.searchQuery || params.query) return 'webSearch';
    if (params.category === 'news') return 'webNews';
    if (params.url) return 'webScrape';
    return 'default';
  }

  return 'default';
}

module.exports = {
  IntentTypes,
  IntentServiceMapping,
  IntentActionMapping,
  ServiceCapabilities,
  getServiceForIntent,
  getActionForIntent,
  shouldRouteToMCP,
  getServiceCapabilities,
  serviceSupportsAction,
  parseAction,
  determineOperation
};
