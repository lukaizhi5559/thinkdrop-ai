/**
 * Migration 016: Add Mouse Scroll Action
 * 
 * Adds mouse.scroll action to the command service
 * so it can be called via MCP during automation execution.
 */

const logger = require('../../../logger.cjs');

module.exports = {
  name: '016_add_mouse_scroll',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 016_add_mouse_scroll');
    
    try {
      // Get current command service actions
      const result = await db.query(
        `SELECT actions FROM mcp_services WHERE name = ?`,
        ['command']
      );
      
      if (result.length === 0) {
        logger.warn('⚠️  Command service not found, skipping migration');
        return;
      }
      
      const currentActions = JSON.parse(result[0].actions || '[]');
      
      // Check if mouse.scroll already exists
      if (currentActions.includes('mouse.scroll')) {
        logger.debug('✅ mouse.scroll action already exists');
        return;
      }
      
      // Add mouse.scroll action
      const updatedActions = [...currentActions, 'mouse.scroll'];
      
      // Update database
      await db.run(
        `UPDATE mcp_services 
         SET actions = ? 
         WHERE name = ?`,
        [JSON.stringify(updatedActions), 'command']
      );
      
      logger.debug(`✅ Added mouse.scroll action to command service`);
      logger.debug(`📋 Updated actions: ${JSON.stringify(updatedActions)}`);
      
    } catch (error) {
      logger.error('❌ Migration 016 failed:', error);
      throw error;
    }
  }
};
