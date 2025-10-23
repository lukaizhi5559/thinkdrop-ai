/**
 * Migration: Add Conversation Service to MCP
 * Adds conversation service with all its actions
 */

module.exports = {
  name: '002_conversation_service',
  
  async migrate(db) {
    console.log('🔄 Running migration: 002_conversation_service');
    
    // Check if conversation service already exists
    const existing = await db.query(`SELECT id FROM mcp_services WHERE name = 'conversation'`);
    
    if (existing.length > 0) {
      console.log('⚠️  Conversation service already exists, skipping migration');
      return;
    }
    
    // Define actions as JSON array
    const actions = [
      'session.create',
      'session.list',
      'session.get',
      'session.update',
      'session.delete',
      'session.switch',
      'message.add',
      'message.list',
      'message.get',
      'message.update',
      'message.delete'
    ];
    
    // Insert conversation service with actions as JSON
    await db.run(
      `INSERT INTO mcp_services (
        id, name, display_name, description, endpoint, api_key,
        enabled, trusted, actions, version, capabilities,
        trust_level, allowed_actions, rate_limit, health_status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'conversation-1',
        'conversation',
        'Conversation Management',
        'Manages conversation sessions and messages',
        'http://localhost:3004',
        'auto-generated-key-conversation',
        true, // enabled
        true, // trusted
        JSON.stringify(actions), // actions as JSON
        '1.0.0', // version
        JSON.stringify(['session-management', 'message-management']), // capabilities
        'trusted', // trust_level
        null, // allowed_actions
        1000, // rate_limit
        'unknown', // health_status
        'system', // created_by
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );
    
    console.log('✅ Conversation service migration complete');
  },
  
  async rollback(db) {
    console.log('🔄 Rolling back migration: 002_conversation_service');
    
    // Delete conversation service
    await db.run(`DELETE FROM mcp_services WHERE id = 'conversation-1'`);
    
    console.log('✅ Conversation service rollback complete');
  }
};
