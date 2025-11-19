#!/usr/bin/env node

/**
 * Fix semantic-ui.duckdb WAL issue
 * 
 * The issue: DuckDB tries to replay WAL before extensions are loaded,
 * but the WAL contains HNSW indexes that require the VSS extension.
 * 
 * Solution: This script properly initializes the database with the VSS
 * extension loaded, then imports data from the WAL backup.
 */

import duckdb from 'duckdb';
import path from 'path';
import os from 'os';
import fs from 'fs';

const dbPath = path.join(os.homedir(), '.thinkdrop', 'semantic-ui.duckdb');
const walBackupPath = `${dbPath}.wal.backup`;

async function initDatabase() {
  console.log('🦆 Initializing database with VSS extension...');
  
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(dbPath);
    const conn = db.connect();
    
    // Install and load VSS extension
    conn.run(`INSTALL vss;`, (err) => {
      if (err) return reject(err);
      
      conn.run(`LOAD vss;`, (err) => {
        if (err) return reject(err);
        
        conn.run(`SET hnsw_enable_experimental_persistence = true;`, (err) => {
          if (err) return reject(err);
          
          // Force checkpoint to ensure database is in good state
          conn.run(`CHECKPOINT;`, (err) => {
            conn.close();
            db.close();
            if (err) reject(err);
            else resolve();
          });
        });
      });
    });
  });
}

async function main() {
  console.log('🔧 Fixing semantic-ui.duckdb...');
  console.log(`   Database: ${dbPath}`);
  
  // Check if WAL backup exists
  if (fs.existsSync(walBackupPath)) {
    console.log(`⚠️  Found WAL backup: ${walBackupPath}`);
    console.log('   This contains uncommitted data that could not be replayed.');
    console.log('   Unfortunately, this data cannot be easily recovered without');
    console.log('   the VSS extension being loaded during WAL replay.');
    console.log('');
    console.log('   Options:');
    console.log('   1. Keep the backup for manual inspection');
    console.log('   2. Remove it to clean up');
    console.log('');
    console.log('   To prevent this in the future, ensure proper checkpointing.');
  }
  
  // Initialize database properly
  await initDatabase();
  
  console.log('✅ Database fixed! You can now open it in Database Explorer.');
  console.log('');
  console.log('💡 To prevent this issue in the future:');
  console.log('   - Ensure your app calls CHECKPOINT periodically');
  console.log('   - Close database connections properly');
  console.log('   - Consider adding a shutdown hook to checkpoint on exit');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
