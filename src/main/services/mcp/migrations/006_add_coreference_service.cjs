/**
 * Migration 006: Add Coreference Service
 * Adds the Python-based coreference resolution service to MCP registry
 */

const logger = require('./../../../logger.cjs');
module.exports = {
  name: '006_add_coreference_service',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 006_add_coreference_service');
    
    // Check if coreference service already exists
    const existing = await db.query(`SELECT id FROM mcp_services WHERE name = 'coreference'`);
    
    if (existing.length > 0) {
      logger.debug('⚠️  Coreference service already exists, skipping migration');
      return;
    }
    
    // Define coreference service actions
    const actions = JSON.stringify(['resolve']);
    
    // Insert coreference service
    await db.run(
      `INSERT INTO mcp_services (
        id, name, display_name, description, endpoint, api_key,
        enabled, trusted, actions, version, capabilities,
        trust_level, allowed_actions, rate_limit, health_status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        'coreference',
        'coreference',
        'Coreference Resolution',
        'Python-based coreference resolution service using spaCy and neuralcoref',
        process.env.MCP_COREFERENCE_ENDPOINT || 'http://localhost:3005',
        process.env.MCP_COREFERENCE_API_KEY || '',
        true,  // enabled
        true,  // trusted
        actions,
        '1.0.0',
        JSON.stringify(['resolve_references']),
        'high',
        JSON.stringify(['resolve']),
        100,
        'unknown',
        'system'
      ]
    );
    
    logger.debug('✅ Coreference service added to database');
  }
};
