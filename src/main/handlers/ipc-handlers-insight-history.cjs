/**
 * Insight History IPC Handlers
 * Handles insight history operations: list, get, delete, clear
 */

const { ipcMain } = require('electron');
const db = require('../services/utils/duckdb-wrapper.cjs');

/**
 * Promisify db.query
 */
function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Promisify db.run
 */
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Setup insight history IPC handlers
 */
function setupInsightHistoryHandlers() {
  console.log('🔧 Setting up Insight History handlers...');
  
  // Get insight history list
  ipcMain.handle('insight-history:list', async (event, options = {}) => {
    try {
      const { limit = 50, offset = 0, userId = 'default_user' } = options;
      
      const results = await queryAsync(`
        SELECT 
          id, window_title, window_id, insight_type, query, summary,
          links, video_links, concepts, created_at, accessed_at
        FROM insight_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `, [userId, limit, offset]);
      
      // Parse JSON fields
      const insights = results.map(row => ({
        ...row,
        links: row.links ? JSON.parse(row.links) : [],
        videoLinks: row.video_links ? JSON.parse(row.video_links) : [],
        concepts: row.concepts ? JSON.parse(row.concepts) : []
      }));
      
      return { success: true, insights };
    } catch (error) {
      console.error('❌ [INSIGHT_HISTORY] List failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get single insight by ID
  ipcMain.handle('insight-history:get', async (event, insightId) => {
    try {
      const results = await queryAsync(`
        SELECT 
          id, window_title, window_id, insight_type, query, summary,
          links, video_links, concepts, ocr_text, created_at, accessed_at
        FROM insight_history
        WHERE id = ?
      `, [insightId]);
      
      if (results.length === 0) {
        return { success: false, error: 'Insight not found' };
      }
      
      const insight = results[0];
      
      // Parse JSON fields
      insight.links = insight.links ? JSON.parse(insight.links) : [];
      insight.videoLinks = insight.video_links ? JSON.parse(insight.video_links) : [];
      insight.concepts = insight.concepts ? JSON.parse(insight.concepts) : [];
      
      // Update accessed_at
      await runAsync(`
        UPDATE insight_history 
        SET accessed_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [insightId]);
      
      return { success: true, insight };
    } catch (error) {
      console.error('❌ [INSIGHT_HISTORY] Get failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Delete single insight
  ipcMain.handle('insight-history:delete', async (event, insightId) => {
    try {
      await runAsync(`
        DELETE FROM insight_history 
        WHERE id = ?
      `, [insightId]);
      
      console.log(`🗑️  [INSIGHT_HISTORY] Deleted insight: ${insightId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ [INSIGHT_HISTORY] Delete failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Clear all insights for user
  ipcMain.handle('insight-history:clear', async (event, userId = 'default_user') => {
    try {
      await runAsync(`
        DELETE FROM insight_history 
        WHERE user_id = ?
      `, [userId]);
      
      console.log(`🗑️  [INSIGHT_HISTORY] Cleared all insights for user: ${userId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ [INSIGHT_HISTORY] Clear failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Search insights
  ipcMain.handle('insight-history:search', async (event, searchQuery, userId = 'default_user') => {
    try {
      const results = await queryAsync(`
        SELECT 
          id, window_title, window_id, insight_type, query, summary,
          links, video_links, concepts, created_at, accessed_at
        FROM insight_history
        WHERE user_id = ?
          AND (
            window_title LIKE ? OR
            query LIKE ? OR
            summary LIKE ?
          )
        ORDER BY created_at DESC
        LIMIT 50
      `, [
        userId,
        `%${searchQuery}%`,
        `%${searchQuery}%`,
        `%${searchQuery}%`
      ]);
      
      // Parse JSON fields
      const insights = results.map(row => ({
        ...row,
        links: row.links ? JSON.parse(row.links) : [],
        videoLinks: row.video_links ? JSON.parse(row.video_links) : [],
        concepts: row.concepts ? JSON.parse(row.concepts) : []
      }));
      
      return { success: true, insights };
    } catch (error) {
      console.error('❌ [INSIGHT_HISTORY] Search failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  console.log('✅ Insight History handlers setup complete');
}

module.exports = { setupInsightHistoryHandlers };
