#!/usr/bin/env node

/**
 * Clear User Memory Database
 * 
 * This script clears the polluted user_memory.duckdb database.
 * Run this to remove all the incorrectly stored conversation queries.
 * 
 * Usage: node scripts/clear-user-memory.js
 */

const Database = require('duckdb').Database;
const path = require('path');

const DB_PATH = path.join(__dirname, '../mcp-services/thinkdrop-user-memory-service/data/user_memory.duckdb');

console.log('🗑️  Clearing user memory database...');
console.log(`📁 Database: ${DB_PATH}`);

const db = new Database(DB_PATH);

db.all(`SELECT COUNT(*) as count FROM memory`, (err, result) => {
  if (err) {
    console.error('❌ Error counting memories:', err);
    process.exit(1);
  }
  
  const count = result[0].count;
  console.log(`📊 Found ${count} memories to delete`);
  
  // Delete all memories
  db.run(`DELETE FROM memory`, (err) => {
    if (err) {
      console.error('❌ Error deleting memories:', err);
      process.exit(1);
    }
    
    console.log('✅ Deleted all memories from memory table');
    
    // Delete all memory entities
    db.run(`DELETE FROM memory_entities`, (err) => {
      if (err) {
        console.error('❌ Error deleting memory entities:', err);
        process.exit(1);
      }
      
      console.log('✅ Deleted all entities from memory_entities table');
      
      // Verify
      db.all(`SELECT COUNT(*) as count FROM memory`, (err, result) => {
        if (err) {
          console.error('❌ Error verifying:', err);
          process.exit(1);
        }
        
        console.log(`✅ Database cleared! Remaining memories: ${result[0].count}`);
        console.log('');
        console.log('🎉 User memory database is now clean!');
        console.log('   Only explicit memory_store intents will be saved going forward.');
        
        db.close();
      });
    });
  });
});
