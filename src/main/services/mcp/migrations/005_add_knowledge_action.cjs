/**
 * Migration: Add knowledge.answer Action to Phi4 Service
 * 
 * Adds the new knowledge.answer endpoint to phi4 service actions
 */

module.exports = {
  name: '005_add_knowledge_action',
  
  async up(db) {
    console.log('🔄 Running migration: 005_add_knowledge_action');
    
    try {
      // Get current phi4 actions
      const service = await db.query(`
        SELECT actions FROM mcp_services WHERE name = 'phi4'
      `);
      
      if (service.length === 0) {
        console.log('  ⏭️  Phi4 service not found, skipping migration');
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
        
        console.log('  ✅ Added knowledge.answer action to phi4 service');
        console.log(`     Actions: ${currentActions.join(', ')}`);
      } else {
        console.log('  ⏭️  knowledge.answer already exists');
      }
      
    } catch (error) {
      console.error('  ❌ Migration failed:', error.message);
      throw error;
    }
  },
  
  async down(db) {
    console.log('🔄 Rolling back migration: 005_add_knowledge_action');
    
    try {
      // Get current phi4 actions
      const service = await db.query(`
        SELECT actions FROM mcp_services WHERE name = 'phi4'
      `);
      
      if (service.length === 0) {
        console.log('  ⏭️  Phi4 service not found, skipping rollback');
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
      
      console.log('  ✅ Removed knowledge.answer action from phi4 service');
      
    } catch (error) {
      console.error('  ❌ Rollback failed:', error.message);
      throw error;
    }
  }
};
