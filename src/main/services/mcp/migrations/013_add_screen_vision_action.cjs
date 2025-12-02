/**
 * Migration 013: Add screen.analyze-vision action
 * Adds the new backend vision API action to screen-intelligence service
 */

const logger = require('./../../../logger.cjs');

module.exports = {
  name: '013_add_screen_vision_action',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 013_add_screen_vision_action');
    
    // Get current screen-intelligence service
    const service = await db.query(`SELECT id, actions, allowed_actions FROM mcp_services WHERE name = 'screen-intelligence'`);
    
    if (service.length === 0) {
      logger.warn('⚠️  Screen Intelligence service not found, skipping migration');
      return;
    }
    
    const currentActions = JSON.parse(service[0].actions || '[]');
    const currentAllowedActions = JSON.parse(service[0].allowed_actions || '[]');
    
    // Check if screen.analyze-vision already exists
    if (currentActions.includes('screen.analyze-vision')) {
      logger.debug('✅ screen.analyze-vision action already exists');
      return;
    }
    
    // Add new action
    const newActions = [...currentActions, 'screen.analyze-vision'];
    const newAllowedActions = [...currentAllowedActions, 'screen.analyze-vision'];
    
    // Update service with new actions
    await db.run(
      `UPDATE mcp_services 
       SET actions = ?, 
           allowed_actions = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE name = ?`,
      [
        JSON.stringify(newActions),
        JSON.stringify(newAllowedActions),
        'screen-intelligence'
      ]
    );
    
    logger.debug('✅ Added screen.analyze-vision action to screen-intelligence service');
    logger.debug(`   Total actions: ${newActions.length}`);
    logger.debug(`   New action: screen.analyze-vision (backend vision API)`);
  }
};
