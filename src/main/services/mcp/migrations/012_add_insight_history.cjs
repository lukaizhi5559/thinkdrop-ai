/**
 * Migration: Add insight_history table for storing page insights
 * 
 * This table stores historical page insights so users can:
 * - View past insights
 * - Navigate back to previous contexts
 * - Delete individual insights or clear all
 */

const logger = require('./../../../logger.cjs');
module.exports = {
  name: '012_add_insight_history',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 012_add_insight_history');
    
    // Create insight_history table
    await db.run(`
      CREATE TABLE IF NOT EXISTS insight_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default_user',
        window_title TEXT NOT NULL,
        window_id TEXT,
        insight_type TEXT NOT NULL DEFAULT 'page',
        query TEXT,
        summary TEXT,
        links TEXT,
        video_links TEXT,
        concepts TEXT,
        ocr_text TEXT,
        screenshot_path TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes for faster lookups
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_insight_history_user 
      ON insight_history(user_id)
    `);
    
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_insight_history_created 
      ON insight_history(created_at DESC)
    `);
    
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_insight_history_window 
      ON insight_history(window_id)
    `);
    
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_insight_history_type 
      ON insight_history(insight_type)
    `);
    
    logger.debug('✅ insight_history table created');
    logger.debug('✅ Migration 012_add_insight_history completed');
  }
};
