/**
 * Update screen-intelligence service actions to include screen.context
 */

const duckdb = require('duckdb');
const path = require('path');

async function updateActions() {
  const dbPath = path.join(__dirname, 'data', 'agent_memory.duckdb');
  console.log('📂 Opening database:', dbPath);
  
  const db = new duckdb.Database(dbPath);
  
  const newActions = JSON.stringify([
    'screen.describe',
    'screen.query',
    'screen.analyze',
    'screen.click',
    'screen.type',
    'screen.guide',
    'screen.highlight',
    'screen.toast',
    'screen.clearOverlay',
    'screen.context',
    'element.search'
  ]);
  
  console.log('🔄 Updating screen-intelligence actions...');
  
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE mcp_services 
       SET actions = ?, 
           allowed_actions = ?,
           updated_at = CURRENT_TIMESTAMP 
       WHERE name = ?`,
      newActions, newActions, 'screen-intelligence',
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        console.log('✅ Actions updated successfully');
        
        // Verify the update
        db.all(
          `SELECT name, actions, allowed_actions FROM mcp_services WHERE name = 'screen-intelligence'`,
          (err, rows) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (rows && rows.length > 0) {
              console.log('📊 Current actions:', JSON.parse(rows[0].actions));
            }
            
            db.close((err) => {
              if (err) {
                reject(err);
                return;
              }
              console.log('✅ Database closed');
              resolve();
            });
          }
        );
      }
    );
  });
}

updateActions().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
