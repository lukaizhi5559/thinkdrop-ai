/**
 * Migration: Add knowledge.answer Action to Phi4 Service
 * 
 * Adds the new knowledge.answer endpoint to phi4 service actions
 */

const logger = require('./../../../logger.cjs');
module.exports = {
  name: '005_add_knowledge_action',
  
  async up(db) {
    logger.debug('🔄 Running migration: 005_add_knowledge_action');
    
    try {
      // Get current phi4 actions
      const service = await db.query(`
        SELECT actions FROM mcp_services WHERE name = 'phi4'
      `);
      
      if (service.length === 0) {
        logger.debug('  ⏭️  Phi4 service not found, skipping migration');
        return;
      }
      
      // Parse current actions
      const currentActions = JSON.parse(service[0].actions);
      
      // Add knowledge.answer if not present
      if (!currentActions.includes('knowledge.answer')) {
        currentActions.push('knowledge.answer');
        
        await db.run(`
          UPDATE mcp_services 
          SET actions = ? 
          WHERE name = 'phi4'
        `, [JSON.stringify(currentActions)]);
        
        logger.debug('  ✅ Added knowledge.answer action to phi4 service');
        logger.debug(`     Actions: ${currentActions.join(', ')}`);
      } else {
        logger.debug('  ⏭️  knowledge.answer already exists');
      }
      
    } catch (error) {
      logger.error('  ❌ Migration failed:', error.message);
      throw error;
    }
  },
  
  async down(db) {
    logger.debug('🔄 Rolling back migration: 005_add_knowledge_action');
    
    try {
      // Get current phi4 actions
      const service = await db.query(`
        SELECT actions FROM mcp_services WHERE name = 'phi4'
      `);
      
      if (service.length === 0) {
        logger.debug('  ⏭️  Phi4 service not found, skipping rollback');
        return;
      }
      
      // Parse current actions
      const currentActions = JSON.parse(service[0].actions);
      
      // Remove knowledge.answer
      const updatedActions = currentActions.filter(action => action !== 'knowledge.answer');
      
      await db.run(`
        UPDATE mcp_services 
        SET actions = ? 
        WHERE name = 'phi4'
      `, [JSON.stringify(updatedActions)]);
      
      logger.debug('  ✅ Removed knowledge.answer action from phi4 service');
      
    } catch (error) {
      logger.error('  ❌ Rollback failed:', error.message);
      throw error;
    }
  }
};
