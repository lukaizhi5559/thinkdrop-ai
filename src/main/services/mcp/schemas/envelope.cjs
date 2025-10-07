/**
 * MCP Protocol - Request/Response Envelope Schema
 * 
 * Defines the standard envelope format for all MCP communication.
 * Version: mcp.v1
 */

/**
 * MCP Request Envelope
 */
const MCPRequestEnvelope = {
  version: 'mcp.v1',
  service: '', // Service name (user-memory, web-search, phi4)
  action: '', // Action name (memory.store, web.search, general.answer)
  requestId: '', // Unique request ID (UUID)
  sessionId: '', // Session ID (optional)
  context: {
    userId: '', // User identifier (optional)
    sessionId: '', // Session identifier (optional)
    permissions: [], // Array of permission strings
    locale: 'en-US', // Locale (optional)
    timezone: 'America/New_York' // Timezone (optional)
  },
  payload: {}, // Action-specific payload
  meta: {
    client: 'thinkdrop-desktop', // Client identifier
    appVersion: '1.0.0', // App version
    traceId: '' // Trace ID for distributed tracing (optional)
  },
  timestamp: '' // ISO 8601 timestamp
};

/**
 * MCP Response Envelope
 */
const MCPResponseEnvelope = {
  version: 'mcp.v1',
  service: '', // Service name
  action: '', // Action name
  requestId: '', // Matching request ID
  status: 'ok', // Status: ok, error
  data: null, // Response data (null if error)
  error: null, // Error object (null if ok)
  metrics: {
    elapsedMs: 0, // Total elapsed time
    serviceMs: 0, // Service processing time (optional)
    queueMs: 0 // Queue wait time (optional)
  },
  timestamp: '' // ISO 8601 timestamp
};

/**
 * MCP Error Object
 */
const MCPError = {
  code: '', // Error code (INVALID_REQUEST, SERVICE_UNAVAILABLE, etc.)
  message: '', // Human-readable error message
  retryable: false, // Whether the error is retryable
  details: {} // Additional error details (optional)
};

/**
 * Error Codes
 */
const ErrorCodes = {
  // Client errors (4xx)
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  
  // Server errors (5xx)
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT: 'TIMEOUT',
  DATABASE_ERROR: 'DATABASE_ERROR',
  
  // Service-specific errors
  EMBEDDING_FAILED: 'EMBEDDING_FAILED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INVALID_API_KEY: 'INVALID_API_KEY'
};

/**
 * Retryable Error Codes
 */
const RetryableErrorCodes = [
  ErrorCodes.SERVICE_UNAVAILABLE,
  ErrorCodes.TIMEOUT,
  ErrorCodes.INTERNAL_ERROR
];

/**
 * Create MCP request envelope
 * @param {object} options - Request options
 * @returns {object} MCP request envelope
 */
function createRequest(options) {
  const {
    service,
    action,
    payload = {},
    context = {},
    meta = {},
    requestId = generateRequestId(),
    sessionId = null
  } = options;

  return {
    version: 'mcp.v1',
    service,
    action,
    requestId,
    sessionId,
    context: {
      userId: context.userId || null,
      sessionId: context.sessionId || sessionId,
      permissions: context.permissions || [],
      locale: context.locale || 'en-US',
      timezone: context.timezone || 'America/New_York'
    },
    payload,
    meta: {
      client: meta.client || 'thinkdrop-desktop',
      appVersion: meta.appVersion || '1.0.0',
      traceId: meta.traceId || generateTraceId()
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Create MCP response envelope
 * @param {object} options - Response options
 * @returns {object} MCP response envelope
 */
function createResponse(options) {
  const {
    service,
    action,
    requestId,
    status = 'ok',
    data = null,
    error = null,
    metrics = {}
  } = options;

  return {
    version: 'mcp.v1',
    service,
    action,
    requestId,
    status,
    data,
    error,
    metrics: {
      elapsedMs: metrics.elapsedMs || 0,
      serviceMs: metrics.serviceMs || 0,
      queueMs: metrics.queueMs || 0
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Create MCP error object
 * @param {object} options - Error options
 * @returns {object} MCP error object
 */
function createError(options) {
  const {
    code,
    message,
    retryable = RetryableErrorCodes.includes(code),
    details = {}
  } = options;

  return {
    code,
    message,
    retryable,
    details
  };
}

/**
 * Validate MCP request envelope
 * @param {object} request - Request envelope
 * @returns {object} Validation result { valid: boolean, errors: string[] }
 */
function validateRequest(request) {
  const errors = [];

  if (!request.version || request.version !== 'mcp.v1') {
    errors.push('Invalid or missing version');
  }

  if (!request.service || typeof request.service !== 'string') {
    errors.push('Invalid or missing service');
  }

  if (!request.action || typeof request.action !== 'string') {
    errors.push('Invalid or missing action');
  }

  if (!request.requestId || typeof request.requestId !== 'string') {
    errors.push('Invalid or missing requestId');
  }

  if (!request.payload || typeof request.payload !== 'object') {
    errors.push('Invalid or missing payload');
  }

  if (!request.timestamp) {
    errors.push('Missing timestamp');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate MCP response envelope
 * @param {object} response - Response envelope
 * @returns {object} Validation result { valid: boolean, errors: string[] }
 */
function validateResponse(response) {
  const errors = [];

  if (!response.version || response.version !== 'mcp.v1') {
    errors.push('Invalid or missing version');
  }

  if (!response.service || typeof response.service !== 'string') {
    errors.push('Invalid or missing service');
  }

  if (!response.action || typeof response.action !== 'string') {
    errors.push('Invalid or missing action');
  }

  if (!response.requestId || typeof response.requestId !== 'string') {
    errors.push('Invalid or missing requestId');
  }

  if (!response.status || !['ok', 'error'].includes(response.status)) {
    errors.push('Invalid or missing status');
  }

  if (response.status === 'ok' && response.data === undefined) {
    errors.push('Response status is ok but data is undefined');
  }

  if (response.status === 'error' && !response.error) {
    errors.push('Response status is error but error object is missing');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate unique request ID
 * @returns {string} UUID v4
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate unique trace ID
 * @returns {string} UUID v4
 */
function generateTraceId() {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if error is retryable
 * @param {object} error - MCP error object
 * @returns {boolean}
 */
function isRetryableError(error) {
  return error && error.retryable === true;
}

module.exports = {
  MCPRequestEnvelope,
  MCPResponseEnvelope,
  MCPError,
  ErrorCodes,
  RetryableErrorCodes,
  createRequest,
  createResponse,
  createError,
  validateRequest,
  validateResponse,
  generateRequestId,
  generateTraceId,
  isRetryableError
};
