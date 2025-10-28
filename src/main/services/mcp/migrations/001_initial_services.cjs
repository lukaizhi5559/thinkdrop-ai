/**
 * Migration: Initial Core Services
 * Migrates hardcoded services from config.cjs to database
 */

const crypto = require('crypto');

// Core services configuration (from original config.cjs)
const CORE_SERVICES = [
  {
    name: 'user-memory',
    displayName: 'User Memory',
    description: 'Memory storage and retrieval service',
    endpoint: process.env.MCP_USER_MEMORY_ENDPOINT || 'http://localhost:3001',
    apiKey: process.env.MCP_USER_MEMORY_API_KEY || 'auto-generated-key-memory',
    capabilities: {
      storage: true,
      retrieval: true,
      tagging: true,
      semantic_search: true
    },
    actions: [
      'memory.store',
      'memory.retrieve',
      'memory.search',  // Service uses 'memory.search', not 'memory.query'
      'memory.delete',
      'memory.update',
      'memory.list',
      'memory.stats',
      'memory.health-check',  // NEW: Health check endpoint
      'memory.debug-embedding'  // NEW: Debug embedding endpoint
    ],
    version: '1.0.0',
    trusted: true,
    trustLevel: 'trusted',
    allowedActions: null, // null = all actions allowed
    rateLimit: 1000 // requests per minute
  },
  {
    name: 'phi4',
    displayName: 'Phi4 NLP',
    description: 'Intent parsing, entity extraction, and general Q&A service',
    endpoint: process.env.MCP_PHI4_ENDPOINT || 'http://localhost:3003',
    apiKey: process.env.MCP_PHI4_API_KEY || 'auto-generated-key-phi4',
    capabilities: {
      intent_parsing: true,
      entity_extraction: true,
      general_qa: true,
      embeddings: true
    },
    actions: [
      'intent.parse',
      'entity.extract',
      'general.answer',
      'embedding.generate',
      'parser.list'
    ],
    version: '1.0.0',
    trusted: true,
    trustLevel: 'trusted',
    allowedActions: null,
    rateLimit: 1000
  },
  {
    name: 'web-search',
    displayName: 'Web Search',
    description: 'Web search and information retrieval service',
    endpoint: process.env.MCP_WEB_SEARCH_ENDPOINT || 'http://localhost:3002',
    apiKey: process.env.MCP_WEB_SEARCH_API_KEY || 'auto-generated-key-websearch',
    capabilities: {
      web_search: true,
      content_extraction: true,
      summarization: true
    },
    actions: [
      'search.web',
      'search.news',
      'content.extract'
    ],
    version: '1.0.0',
    trusted: true,
    trustLevel: 'trusted',
    allowedActions: null,
    rateLimit: 1000
  },
  {
    name: 'conversation',
    displayName: 'Conversation Service',
    description: 'Conversation session and context management service',
    endpoint: process.env.MCP_CONVERSATION_ENDPOINT || 'http://localhost:3004',
    apiKey: process.env.MCP_CONVERSATION_API_KEY || 'auto-generated-key-conversation',
    capabilities: {
      session_management: true,
      message_storage: true,
      context_extraction: true,
      entity_tracking: true
    },
    actions: [
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
      'message.delete',
      'context.add',
      'context.get',
      'context.extract',
      'entity.add',
      'entity.list'
    ],
    version: '1.0.0',
    trusted: true,
    trustLevel: 'trusted',
    allowedActions: null,
    rateLimit: 1000
  }
];

/**
 * Run migration
 */
async function migrate(db) {
  console.log('🔄 Running migration: 001_initial_services');

  // Check if services already exist
  const existingServices = await db.query('SELECT COUNT(*) as count FROM mcp_services');
  
  if (existingServices[0].count > 0) {
    console.log('⚠️  Services already exist, updating API keys and actions from .env...');
    
    // Update API keys and actions from environment variables
    for (const service of CORE_SERVICES) {
      try {
        await db.run(
          `UPDATE mcp_services SET api_key = ?, actions = ? WHERE name = ?`,
          [service.apiKey, JSON.stringify(service.actions), service.name]
        );
        console.log(`  ✅ Updated ${service.name}:`);
        console.log(`     API key: ${service.apiKey.substring(0, 10)}...`);
        console.log(`     Actions: ${service.actions.join(', ')}`);
      } catch (error) {
        console.error(`  ❌ Failed to update ${service.name}:`, error.message);
      }
    }
    
    console.log('✅ API keys and actions updated from .env');
    return;
  }

  // Insert core services
  for (const service of CORE_SERVICES) {
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
      service.name,
      service.displayName,
      service.description,
      service.endpoint,
      service.apiKey,
      1, // enabled (BOOLEAN as INTEGER)
      JSON.stringify(service.capabilities),
      JSON.stringify(service.actions),
      service.version,
      1, // trusted (BOOLEAN as INTEGER)
      service.trustLevel,
      service.allowedActions ? JSON.stringify(service.allowedActions) : null,
      service.rateLimit,
      'unknown', // health_status
      'system' // created_by
    ];
    
    console.log(`  Inserting ${service.name} with ${params.length} parameters`);
    console.log(`  SQL placeholders: ${(sql.match(/\?/g) || []).length}`);
    
    try {
      await db.run(sql, params);
    } catch (error) {
      console.error(`  Failed to insert ${service.name}:`, error.message);
      console.error(`  SQL:`, sql);
      console.error(`  Params:`, params);
      throw error;
    }

    console.log(`  ✅ Inserted service: ${service.name}`);
  }

  // Set up default service-to-service permissions
  // Core services can call each other
  const coreServiceNames = CORE_SERVICES.map(s => s.name);
  
  for (const fromService of coreServiceNames) {
    for (const toService of coreServiceNames) {
      if (fromService !== toService) {
        // Get all actions from target service
        const targetService = CORE_SERVICES.find(s => s.name === toService);
        
        for (const action of targetService.actions) {
          const permId = generateId();
          
          await db.run(`
            INSERT INTO service_permissions (
              id, from_service, to_service, action, allowed, requires_user_confirmation
            ) VALUES (?, ?, ?, ?, ?, ?)
          `, [permId, fromService, toService, action, 1, 0]);
        }
      }
    }
  }

  console.log('  ✅ Set up core service permissions');
  console.log('✅ Migration complete: 001_initial_services');
}

/**
 * Rollback migration
 */
async function rollback(db) {
  console.log('🔄 Rolling back migration: 001_initial_services');

  // Delete core services
  await db.run(`DELETE FROM mcp_services WHERE created_by = 'system'`);
  
  // Delete permissions
  await db.run(`DELETE FROM service_permissions`);

  console.log('✅ Rollback complete: 001_initial_services');
}

/**
 * Generate unique ID
 */
function generateId() {
  return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = { migrate, rollback };
