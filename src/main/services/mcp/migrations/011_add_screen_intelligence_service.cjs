/**
 * Migration 011: Add Screen Intelligence Service
 * Adds the screen intelligence service for context-aware screen analysis
 */

module.exports = {
  name: '011_add_screen_intelligence_service',
  
  async migrate(db) {
    console.log('🔄 Running migration: 011_add_screen_intelligence_service');
    
    // Check if screen-intelligence service already exists
    const existing = await db.query(`SELECT id FROM mcp_services WHERE name = 'screen-intelligence'`);
    
    if (existing.length > 0) {
      console.log('⚠️  Screen Intelligence service already exists, updating API key and endpoint...');
      
      // Update API key and endpoint from environment variables
      const apiKey = process.env.MCP_SCREEN_INTELLIGENCE_API_KEY || 'PIFMEY6GrUwzt2vQRd2WwpL6qbTTxRGg';
      const endpoint = process.env.MCP_SCREEN_INTELLIGENCE_ENDPOINT || 'http://127.0.0.1:3008';
      
      await db.run(
        `UPDATE mcp_services SET api_key = ?, endpoint = ? WHERE name = ?`,
        [apiKey, endpoint, 'screen-intelligence']
      );
      
      console.log(`  ✅ Updated screen-intelligence service:`);
      console.log(`     Endpoint: ${endpoint}`);
      console.log(`     API key: ${apiKey ? apiKey.substring(0, 10) + '...' : 'EMPTY'}`);
      console.log('✅ Screen Intelligence service updated');
      return;
    }
    
    // Define screen intelligence service actions
    const actions = JSON.stringify([
      'screen.describe',
      'screen.query',
      'screen.analyze',
      'screen.click',
      'screen.type',
      'screen.guide',
      'screen.highlight',
      'screen.toast',
      'screen.clearOverlay'
    ]);
    
    // Define capabilities
    const capabilities = JSON.stringify([
      'accessibility_api',
      'playwright_adapter',
      'window_detection',
      'context_aware_analysis',
      'desktop_analysis',
      'browser_analysis',
      'visual_overlays',
      'element_highlighting',
      'discovery_mode'
    ]);
    
    // Define allowed actions
    const allowedActions = JSON.stringify([
      'screen.describe',
      'screen.query',
      'screen.analyze',
      'screen.click',
      'screen.type',
      'screen.guide',
      'screen.highlight',
      'screen.toast',
      'screen.clearOverlay'
    ]);
    
    // Insert screen-intelligence service
    await db.run(
      `INSERT INTO mcp_services (
        id, name, display_name, description, endpoint, api_key,
        enabled, trusted, actions, version, capabilities,
        trust_level, allowed_actions, rate_limit, health_status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        'screen-intelligence',
        'screen-intelligence',
        'Screen Intelligence Service',
        'Context-aware screen analysis with window detection, accessibility API, and Playwright for browser automation',
        process.env.MCP_SCREEN_INTELLIGENCE_ENDPOINT || 'http://127.0.0.1:3008',
        process.env.MCP_SCREEN_INTELLIGENCE_API_KEY || 'PIFMEY6GrUwzt2vQRd2WwpL6qbTTxRGg',
        true,  // enabled
        true,  // trusted
        actions,
        '1.0.0',
        capabilities,
        'high',
        allowedActions,
        100,  // rate_limit
        'unknown',
        'system'
      ]
    );
    
    console.log('✅ Screen Intelligence service added to database');
    console.log('💡 Note: Set MCP_SCREEN_INTELLIGENCE_API_KEY in .env for API authentication');
  }
};
