/**
 * MCP Initialization
 * Sets up database, runs migrations, and initializes MCPConfigManager
 */

const MCPConfigManager = require('./MCPConfigManager.cjs');
const migration001 = require('./migrations/001_initial_services.cjs');
const migration002 = require('./migrations/002_conversation_service.cjs');
const migration003 = require('./migrations/003_cleanup_conversation_tables.cjs');

/**
 * Initialize MCP system
 * @param {object} database - DuckDB database connection
 * @returns {Promise<void>}
 */
async function initializeMCP(database) {
  console.log('🚀 Initializing MCP system...');

  try {
    // 1. Initialize MCPConfigManager (creates tables)
    await MCPConfigManager.initialize(database);

    // 2. Run migrations
    await runMigrations(database);

    // 3. Reload services from database after migration
    await MCPConfigManager.loadFromDatabase();

    // 4. Validate services
    const services = MCPConfigManager.getAllServices();
    console.log(`✅ MCP initialized with ${services.length} services`);

    // 4. Log service status
    services.forEach(service => {
      console.log(`  📦 ${service.displayName} (${service.name})`);
      console.log(`     Endpoint: ${service.endpoint}`);
      console.log(`     Status: ${service.enabled ? '✅ Enabled' : '❌ Disabled'}`);
      console.log(`     Trusted: ${service.trusted ? '✅ Yes' : '⚠️  No'}`);
      console.log(`     Actions: ${service.actions.length}`);
    });

    return MCPConfigManager;
  } catch (error) {
    console.error('❌ Failed to initialize MCP:', error);
    throw error;
  }
}

/**
 * Run database migrations
 * @param {object} database - DuckDB database connection
 */
async function runMigrations(database) {
  console.log('🔄 Running database migrations...');

  const migrations = [
    { name: '001_initial_services', module: migration001 },
    { name: '002_conversation_service', module: migration002 },
    { name: '003_cleanup_conversation_tables', module: migration003 }
  ];

  for (const migration of migrations) {
    try {
      console.log(`  Running migration: ${migration.name}`);
      await migration.module.migrate(database);
    } catch (error) {
      console.error(`  ❌ Migration failed: ${migration.name}`, error);
      throw error;
    }
  }

  console.log('✅ All migrations completed');
}

/**
 * Rollback migrations (for testing/development)
 * @param {object} database - DuckDB database connection
 */
async function rollbackMigrations(database) {
  console.log('🔄 Rolling back migrations...');

  const migrations = [
    { name: '001_initial_services', module: migration001 },
    { name: '002_conversation_service', module: migration002 },
    { name: '003_cleanup_conversation_tables', module: migration003 }
  ];

  // Rollback in reverse order
  for (const migration of migrations.reverse()) {
    try {
      console.log(`  Rolling back: ${migration.name}`);
      await migration.module.rollback(database);
    } catch (error) {
      console.error(`  ❌ Rollback failed: ${migration.name}`, error);
      throw error;
    }
  }

  console.log('✅ All migrations rolled back');
}

module.exports = {
  initializeMCP,
  runMigrations,
  rollbackMigrations
};
