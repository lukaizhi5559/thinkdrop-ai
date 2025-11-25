/**
 * Migration: Add Command Service
 * Adds the command execution service to the MCP registry
 */

const crypto = require('crypto');

const COMMAND_SERVICE = {
  name: 'command',
  displayName: 'Command Service',
  description: 'Natural language command execution service using Ollama',
  endpoint: process.env.MCP_COMMAND_ENDPOINT || 'http://localhost:3007',
  apiKey: process.env.MCP_COMMAND_API_KEY || 'auto-generated-key-command',
  capabilities: {
    command_execution: true,
    command_interpretation: true,
    desktop_automation: true,
    educational_guide: true,
    system_query: true,
    security_validation: true
  },
  actions: [
    'command.execute',
    'command.interpret',
    'command.automate',
    'command.prompt-anywhere',
    'command.cancel-automation', // Cancel running automation
    'command.guide',
    'command.guide.execute',
    'system.query',
    'health'
  ],
  version: '1.0.0',
  trusted: true,
  trustLevel: 'trusted',
  allowedActions: null, // null = all actions allowed
  rateLimit: 1000 // requests per minute
};

/**
 * Run migration
 */
async function migrate(db) {
  console.log('🔄 Running migration: 004_command_service');

  // Check if service already exists
  const existing = await db.query('SELECT COUNT(*) as count FROM mcp_services WHERE name = ?', ['command']);
  
  if (existing[0].count > 0) {
    console.log('⚠️  Command service already exists, updating...');
    
    try {
      await db.run(
        `UPDATE mcp_services SET 
          api_key = ?, 
          actions = ?,
          endpoint = ?,
          capabilities = ?
        WHERE name = ?`,
        [
          COMMAND_SERVICE.apiKey,
          JSON.stringify(COMMAND_SERVICE.actions),
          COMMAND_SERVICE.endpoint,
          JSON.stringify(COMMAND_SERVICE.capabilities),
          'command'
        ]
      );
      console.log(`  ✅ Updated command service:`);
      console.log(`     Endpoint: ${COMMAND_SERVICE.endpoint}`);
      console.log(`     API key: ${COMMAND_SERVICE.apiKey.substring(0, 10)}...`);
      console.log(`     Actions: ${COMMAND_SERVICE.actions.join(', ')}`);
    } catch (error) {
      console.error(`  ❌ Failed to update command service:`, error.message);
    }
    
    console.log('✅ Command service updated');
    return;
  }

  // Insert command service
  const id = generateId();
  
  const sql = `
    INSERT INTO mcp_services (
      id, name, display_name, description, endpoint, api_key, enabled,
      capabilities, actions, version,
      trusted, trust_level, allowed_actions, rate_limit,
      health_status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    id,
    COMMAND_SERVICE.name,
    COMMAND_SERVICE.displayName,
    COMMAND_SERVICE.description,
    COMMAND_SERVICE.endpoint,
    COMMAND_SERVICE.apiKey,
    1, // enabled (BOOLEAN as INTEGER)
    JSON.stringify(COMMAND_SERVICE.capabilities),
    JSON.stringify(COMMAND_SERVICE.actions),
    COMMAND_SERVICE.version,
    1, // trusted (BOOLEAN as INTEGER)
    COMMAND_SERVICE.trustLevel,
    COMMAND_SERVICE.allowedActions ? JSON.stringify(COMMAND_SERVICE.allowedActions) : null,
    COMMAND_SERVICE.rateLimit,
    'unknown', // health_status
    'system' // created_by
  ];
  
  console.log(`  Inserting command service with ${params.length} parameters`);
  
  try {
    await db.run(sql, params);
  } catch (error) {
    console.error(`  Failed to insert command service:`, error.message);
    console.error(`  SQL:`, sql);
    console.error(`  Params:`, params);
    throw error;
  }

  console.log(`  ✅ Inserted service: command`);

  // Set up permissions for command service to call other services if needed
  const coreServices = ['user-memory', 'phi4', 'conversation'];
  
  for (const toService of coreServices) {
    // Get all actions from target service
    const targetActions = await db.query(
      'SELECT actions FROM mcp_services WHERE name = ?',
      [toService]
    );
    
    if (targetActions.length > 0) {
      const actions = JSON.parse(targetActions[0].actions);
      
      for (const action of actions) {
        const permId = generateId();
        
        await db.run(`
          INSERT INTO service_permissions (
            id, from_service, to_service, action, allowed, requires_user_confirmation
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [permId, 'command', toService, action, 1, 0]);
      }
    }
  }

  console.log('  ✅ Set up command service permissions');
  console.log('✅ Migration complete: 004_command_service');
}

/**
 * Rollback migration
 */
async function rollback(db) {
  console.log('🔄 Rolling back migration: 004_command_service');

  // Delete command service
  await db.run(`DELETE FROM mcp_services WHERE name = 'command'`);
  
  // Delete permissions
  await db.run(`DELETE FROM service_permissions WHERE from_service = 'command' OR to_service = 'command'`);

  console.log('✅ Rollback complete: 004_command_service');
}

/**
 * Generate unique ID
 */
function generateId() {
  return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = { migrate, rollback };
