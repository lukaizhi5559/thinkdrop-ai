/**
 * Authentication Middleware
 * Validates API key from request headers
 */

const VALID_API_KEY = process.env.MCP_CONVERSATION_API_KEY || process.env.CONVERSATION_API_KEY || 'auto-generated-key-conversation';

function authenticateRequest(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey) {
    return res.status(401).json({
      version: 'mcp.v1',
      service: 'conversation',
      success: false,
      error: 'Missing API key'
    });
  }
  
  if (apiKey !== VALID_API_KEY) {
    return res.status(403).json({
      version: 'mcp.v1',
      service: 'conversation',
      success: false,
      error: 'Invalid API key'
    });
  }
  
  next();
}

module.exports = { authenticateRequest };
