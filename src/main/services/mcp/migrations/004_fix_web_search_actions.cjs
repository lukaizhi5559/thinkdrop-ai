/**
 * Migration: Fix Web Search Service Actions
 * 
 * Problem: Web search actions were incorrectly named as:
 *   - search.web (should be web.search)
 *   - search.news (should be web.news)
 *   - content.extract (should be web.scrape)
 * 
 * This caused 404 errors when calling the web-search service.
 */

const logger = require('./../../../logger.cjs');
module.exports = {
  name: '004_fix_web_search_actions',
  
  async up(db) {
    logger.debug('🔄 Running migration: 004_fix_web_search_actions');
    
    try {
      // Check if web-search service exists
      const service = await db.query(`
        SELECT * FROM mcp_services WHERE name = 'web-search'
      `);
      
      if (service.length === 0) {
        logger.debug('  ⏭️  Web-search service not found, skipping migration');
        return;
      }
      
      // Update the actions to correct endpoint names
      const correctActions = JSON.stringify([
        'web.search',
        'web.news',
        'web.scrape'
      ]);
      
      await db.run(`
        UPDATE mcp_services 
        SET actions = ? 
        WHERE name = 'web-search'
      `, [correctActions]);
      
      logger.debug('  ✅ Updated web-search actions:');
      logger.debug('     Old: search.web, search.news, content.extract');
      logger.debug('     New: web.search, web.news, web.scrape');
      
    } catch (error) {
      logger.error('  ❌ Migration failed:', error.message);
      throw error;
    }
  },
  
  async down(db) {
    logger.debug('🔄 Rolling back migration: 004_fix_web_search_actions');
    
    try {
      // Revert to old (incorrect) actions
      const oldActions = JSON.stringify([
        'search.web',
        'search.news',
        'content.extract'
      ]);
      
      await db.run(`
        UPDATE mcp_services 
        SET actions = ? 
        WHERE name = 'web-search'
      `, [oldActions]);
      
      logger.debug('  ✅ Reverted web-search actions to old values');
      
    } catch (error) {
      logger.error('  ❌ Rollback failed:', error.message);
      throw error;
    }
  }
};
