/**
 * Migration: Add OAuth and API key management columns
 * 
 * Adds columns to support:
 * - OAuth token storage
 * - Gemini configuration status
 * - Auto-generated API keys
 */

module.exports = {
  name: '008_add_oauth_columns',
  
  async migrate(db) {
    console.log('🔄 Running migration: 008_add_oauth_columns');
    
    try {
      // Add OAuth token columns
      await db.run(`
        ALTER TABLE mcp_services 
        ADD COLUMN IF NOT EXISTS oauth_access_token TEXT
      `);
      
      await db.run(`
        ALTER TABLE mcp_services 
        ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT
      `);
      
      await db.run(`
        ALTER TABLE mcp_services 
        ADD COLUMN IF NOT EXISTS oauth_token_expiry TIMESTAMP
      `);
      
      await db.run(`
        ALTER TABLE mcp_services 
        ADD COLUMN IF NOT EXISTS oauth_scope TEXT
      `);
      
      // Add Gemini configuration flag
      await db.run(`
        ALTER TABLE mcp_services 
        ADD COLUMN IF NOT EXISTS gemini_configured BOOLEAN DEFAULT FALSE
      `);
      
      // Add API key auto-generated flag
      await db.run(`
        ALTER TABLE mcp_services 
        ADD COLUMN IF NOT EXISTS api_key_auto_generated BOOLEAN DEFAULT FALSE
      `);
      
      // Add API key service (which Google service this key is for)
      await db.run(`
        ALTER TABLE mcp_services 
        ADD COLUMN IF NOT EXISTS api_key_service TEXT
      `);
      
      console.log('✅ OAuth columns added successfully');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  },
  
  async down(db) {
    console.log('🔄 Rolling back migration: 008_add_oauth_columns');
    
    // Note: DuckDB doesn't support DROP COLUMN, so we'd need to recreate the table
    // For now, just log that rollback is not supported
    console.log('⚠️  Rollback not supported for column additions in DuckDB');
  }
};
