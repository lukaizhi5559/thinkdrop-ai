/**
 * Migration: Remove OAuth columns from mcp_services table
 * 
 * OAuth tokens are now stored in user_settings table (per-user), not in mcp_services (per-service).
 * This migration removes the now-unused OAuth columns from mcp_services.
 */

const logger = require('./../../../logger.cjs');
module.exports = {
  name: '011_remove_oauth_from_services',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 011_remove_oauth_from_services');
    
    // DuckDB doesn't support DROP COLUMN directly, so we need to recreate the table
    // First, create a new table with the correct schema (without OAuth columns)
    await db.run(`
      CREATE TABLE IF NOT EXISTS mcp_services_new (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        endpoint TEXT NOT NULL,
        api_key TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        capabilities JSON,
        actions TEXT,
        version TEXT DEFAULT '1.0.0',
        trusted BOOLEAN DEFAULT false,
        trust_level TEXT DEFAULT 'trusted',
        trust_reason TEXT,
        rate_limit INTEGER DEFAULT 1000,
        health_status TEXT DEFAULT 'unknown',
        last_health_check TIMESTAMP,
        consecutive_failures INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT DEFAULT 'system',
        priority INTEGER DEFAULT 0,
        timeout_ms INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0
      )
    `);
    
    logger.debug('✅ Created mcp_services_new table without OAuth columns');
    
    // Copy data from old table to new table (excluding OAuth columns)
    await db.run(`
      INSERT INTO mcp_services_new (
        id, name, display_name, description, endpoint, api_key, enabled,
        capabilities, actions, version, trusted, trust_level, trust_reason,
        rate_limit, health_status, last_health_check, consecutive_failures,
        created_at, updated_at, created_by, priority, timeout_ms, retry_count
      )
      SELECT 
        id, name, display_name, description, endpoint, api_key, enabled,
        capabilities, actions, version, trusted, trust_level, trust_reason,
        rate_limit, health_status, last_health_check, consecutive_failures,
        created_at, updated_at, created_by, priority, timeout_ms, retry_count
      FROM mcp_services
    `);
    
    logger.debug('✅ Copied data to new table');
    
    // Drop old table
    await db.run(`DROP TABLE mcp_services`);
    logger.debug('✅ Dropped old mcp_services table');
    
    // Rename new table to original name
    await db.run(`ALTER TABLE mcp_services_new RENAME TO mcp_services`);
    logger.debug('✅ Renamed mcp_services_new to mcp_services');
    
    // Recreate indexes
    await db.run(`CREATE INDEX IF NOT EXISTS idx_mcp_services_name ON mcp_services(name)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_mcp_services_enabled ON mcp_services(enabled)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_mcp_services_trusted ON mcp_services(trusted)`);
    
    logger.debug('✅ Recreated indexes');
    logger.debug('✅ Migration 011_remove_oauth_from_services completed');
    logger.debug('ℹ️  OAuth data is now exclusively stored in user_settings table');
  }
};
