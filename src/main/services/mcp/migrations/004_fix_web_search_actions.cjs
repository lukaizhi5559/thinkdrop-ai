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

module.exports = {
  name: '004_fix_web_search_actions',
  
  async up(db) {
    console.log('🔄 Running migration: 004_fix_web_search_actions');
    
    try {
      // Check if web-search service exists
      const service = await db.query(`
        SELECT * FROM mcp_services WHERE name = 'web-search'
      `);
      
      if (service.length === 0) {
        console.log('  ⏭️  Web-search service not found, skipping migration');
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
      
      console.log('  ✅ Updated web-search actions:');
      console.log('     Old: search.web, search.news, content.extract');
      console.log('     New: web.search, web.news, web.scrape');
      
    } catch (error) {
      console.error('  ❌ Migration failed:', error.message);
      throw error;
    }
  },
  
  async down(db) {
    console.log('🔄 Rolling back migration: 004_fix_web_search_actions');
    
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
      
      console.log('  ✅ Reverted web-search actions to old values');
      
    } catch (error) {
      console.error('  ❌ Rollback failed:', error.message);
      throw error;
    }
  }
};
