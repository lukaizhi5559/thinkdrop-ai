/**
 * Migration 003: Cleanup Conversation Tables
 * 
 * Removes conversation-related tables from agent_memory.duckdb
 * These tables now belong to the conversation service's own database (conversation.duckdb)
 */

module.exports = {
  name: '003_cleanup_conversation_tables',
  
  async migrate(db) {
    console.log('🔄 Running migration: 003_cleanup_conversation_tables');
    
    const tablesToRemove = [
      'session_message_chunks',
      'conversation_messages',
      'session_context',
      'conversation_sessions',
      'agents' // Not needed in MCP mode
    ];
    
    for (const table of tablesToRemove) {
      try {
        // Check if table exists first
        const exists = await db.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_name = '${table}'
        `);
        
        if (exists.length > 0) {
          await db.run(`DROP TABLE IF EXISTS ${table}`);
          console.log(`  ✅ Dropped table: ${table}`);
        } else {
          console.log(`  ⏭️  Table ${table} doesn't exist, skipping`);
        }
      } catch (error) {
        console.warn(`  ⚠️  Failed to drop ${table}:`, error.message);
      }
    }
    
    console.log('✅ Conversation tables cleanup complete');
  },
  
  async rollback(db) {
    console.log('🔄 Rolling back migration: 003_cleanup_conversation_tables');
    console.log('⚠️  Cannot restore dropped tables - rollback not supported');
    console.log('⚠️  If needed, restart the app to recreate tables via conversation service');
  }
};
