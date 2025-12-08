/**
 * Migration: Add session.getActive action to conversation service
 * 
 * This migration adds the new session.getActive action to the conversation
 * service's actions array in the mcp_services table.
 */

const logger = require('./../../../logger.cjs');

module.exports = {
  name: '014_add_session_getActive',
  
  async migrate(db) {
    logger.debug('🔄 Running migration: 014_add_session_getActive');
    
    try {
      // Get current actions from conversation service
      const result = await db.query(
        'SELECT actions FROM mcp_services WHERE name = ?',
        ['conversation']
      );
      
      if (result.length === 0) {
        logger.warn('⚠️  Conversation service not found in database');
        return;
      }
      
      // Parse current actions
      let actions = JSON.parse(result[0].actions);
      
      // Check if session.getActive already exists
      if (actions.includes('session.getActive')) {
        logger.debug('✅ session.getActive already exists in conversation service actions');
        return;
      }
      
      // Find the index of session.switch to insert session.getActive before it
      const switchIndex = actions.indexOf('session.switch');
      if (switchIndex !== -1) {
        actions.splice(switchIndex, 0, 'session.getActive');
      } else {
        // If session.switch not found, just add it after session.delete
        const deleteIndex = actions.indexOf('session.delete');
        if (deleteIndex !== -1) {
          actions.splice(deleteIndex + 1, 0, 'session.getActive');
        } else {
          // Fallback: just add it to the array
          actions.push('session.getActive');
        }
      }
      
      // Update the database
      await db.run(
        'UPDATE mcp_services SET actions = ? WHERE name = ?',
        [JSON.stringify(actions), 'conversation']
      );
      
      logger.debug('✅ Added session.getActive to conversation service actions');
      logger.debug(`📋 Updated actions: ${JSON.stringify(actions)}`);
      
    } catch (error) {
      logger.error('❌ Migration failed:', error);
      throw error;
    }
  }
};
