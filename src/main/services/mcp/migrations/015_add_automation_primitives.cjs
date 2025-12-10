/**
 * Migration 015: Add Automation Primitive Actions
 * 
 * Adds keyboard.type, keyboard.hotkey, and mouse.click actions to the command service
 * so they can be called via MCP during automation execution.
 */

const logger = require('../../../logger.cjs');

module.exports = {
  name: '015_add_automation_primitives',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 015_add_automation_primitives');
    
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
      
      // Actions to add
      const newActions = ['keyboard.type', 'keyboard.hotkey', 'mouse.click'];
      
      // Check if actions already exist
      const actionsToAdd = newActions.filter(action => !currentActions.includes(action));
      
      if (actionsToAdd.length === 0) {
        logger.debug('✅ Automation primitive actions already exist');
        return;
      }
      
      // Add new actions
      const updatedActions = [...currentActions, ...actionsToAdd];
      
      // Update database
      await db.run(
        `UPDATE mcp_services 
         SET actions = ? 
         WHERE name = ?`,
        [JSON.stringify(updatedActions), 'command']
      );
      
      logger.debug(`✅ Added automation primitive actions to command service: ${actionsToAdd.join(', ')}`);
      logger.debug(`📋 Updated actions: ${JSON.stringify(updatedActions)}`);
      
    } catch (error) {
      logger.error('❌ Migration 015 failed:', error);
      throw error;
    }
  }
};
