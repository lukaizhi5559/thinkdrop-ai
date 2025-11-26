/**
 * Migration: Add user_settings table for storing user-specific API keys and preferences
 * 
 * This table stores user credentials like Google API keys that are used across multiple services
 * (Vision, Maps, YouTube, Gemini, etc.)
 */

const logger = require('./../../../logger.cjs');
module.exports = {
  name: '010_add_user_settings',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 010_add_user_settings');
    
    // Create user_settings table
    await db.run(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default_user',
        setting_key TEXT NOT NULL,
        setting_value TEXT,
        encrypted BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, setting_key)
      )
    `);
    
    // Create index for faster lookups
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_user_settings_user_key 
      ON user_settings(user_id, setting_key)
    `);
    
    logger.debug('✅ user_settings table created');
    
    // Migrate existing OAuth data from mcp_services to user_settings
    logger.debug('🔄 Migrating existing Google OAuth data from vision service...');
    
    const visionService = await db.query(`
      SELECT api_key, api_key_auto_generated, api_key_service,
             oauth_access_token, oauth_refresh_token, oauth_token_expiry, oauth_scope
      FROM mcp_services 
      WHERE name = 'vision'
    `);
    
    if (visionService.length > 0) {
      const service = visionService[0];
      
      // Migrate Google API key if it was auto-generated
      if (service.api_key && service.api_key_auto_generated && service.api_key_service === 'vision.googleapis.com') {
        await db.run(`
          INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted)
          VALUES (?, ?, ?, ?, ?)
        `, [
          'setting_google_api_key',
          'default_user',
          'google_api_key',
          service.api_key,
          true
        ]);
        logger.debug('✅ Migrated Google API key to user_settings');
      }
      
      // Migrate OAuth tokens
      if (service.oauth_access_token) {
        await db.run(`
          INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted)
          VALUES (?, ?, ?, ?, ?)
        `, [
          'setting_google_oauth_access_token',
          'default_user',
          'google_oauth_access_token',
          service.oauth_access_token,
          true
        ]);
        logger.debug('✅ Migrated OAuth access token to user_settings');
      }
      
      if (service.oauth_refresh_token) {
        await db.run(`
          INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted)
          VALUES (?, ?, ?, ?, ?)
        `, [
          'setting_google_oauth_refresh_token',
          'default_user',
          'google_oauth_refresh_token',
          service.oauth_refresh_token,
          true
        ]);
        logger.debug('✅ Migrated OAuth refresh token to user_settings');
      }
      
      if (service.oauth_token_expiry) {
        await db.run(`
          INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted)
          VALUES (?, ?, ?, ?, ?)
        `, [
          'setting_google_oauth_token_expiry',
          'default_user',
          'google_oauth_token_expiry',
          service.oauth_token_expiry,
          false
        ]);
        logger.debug('✅ Migrated OAuth token expiry to user_settings');
      }
      
      if (service.oauth_scope) {
        await db.run(`
          INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted)
          VALUES (?, ?, ?, ?, ?)
        `, [
          'setting_google_oauth_scope',
          'default_user',
          'google_oauth_scope',
          service.oauth_scope,
          false
        ]);
        logger.debug('✅ Migrated OAuth scope to user_settings');
      }
      
      // Clear OAuth data from vision service (restore original MCP API key)
      const originalApiKey = process.env.MCP_VISION_API_KEY || 'DBijsTqb56xCeDHJ4P1IyMBcZWYrlxuW';
      await db.run(`
        UPDATE mcp_services 
        SET api_key = ?,
            oauth_access_token = NULL,
            oauth_refresh_token = NULL,
            oauth_token_expiry = NULL,
            oauth_scope = NULL,
            gemini_configured = false,
            api_key_auto_generated = false,
            api_key_service = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE name = 'vision'
      `, [originalApiKey]);
      
      logger.debug('✅ Restored original MCP API key and cleared OAuth data from vision service');
    } else {
      logger.debug('ℹ️  No Google OAuth data found to migrate');
    }
    
    logger.debug('✅ Migration 010_add_user_settings completed');
  }
};
