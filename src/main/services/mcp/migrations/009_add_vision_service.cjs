/**
 * Migration 009: Add Vision Service
 * Adds the Python-based vision service with dual-mode support (Google Vision API + Qwen2-VL)
 */

module.exports = {
  name: '009_add_vision_service',
  
  async migrate(db) {
    console.log('🔄 Running migration: 009_add_vision_service');
    
    // Check if vision service already exists
    const existing = await db.query(`SELECT id FROM mcp_services WHERE name = 'vision'`);
    
    if (existing.length > 0) {
      console.log('⚠️  Vision service already exists, skipping migration');
      return;
    }
    
    // Define vision service actions
    const actions = JSON.stringify([
      'capture',
      'ocr',
      'describe',
      'watch.start',
      'watch.stop',
      'watch.status'
    ]);
    
    // Define capabilities
    const capabilities = JSON.stringify([
      'screenshot_capture',
      'text_extraction',
      'scene_description',
      'continuous_monitoring',
      'online_mode',      // Google Vision API
      'privacy_mode',     // Local Qwen2-VL
      'smart_caching',
      'visual_tokens'     // For LLM integration
    ]);
    
    // Define allowed actions
    const allowedActions = JSON.stringify([
      'capture',
      'ocr',
      'describe',
      'watch.start',
      'watch.stop',
      'watch.status'
    ]);
    
    // Insert vision service
    await db.run(
      `INSERT INTO mcp_services (
        id, name, display_name, description, endpoint, api_key,
        enabled, trusted, actions, version, capabilities,
        trust_level, allowed_actions, rate_limit, health_status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        'vision',
        'vision',
        'Vision Service',
        'Screen capture, OCR, and visual understanding with dual-mode support (Google Vision API for speed, Qwen2-VL for privacy)',
        process.env.MCP_VISION_ENDPOINT || 'http://localhost:3006',
        process.env.GOOGLE_VISION_API_KEY || '',  // Google Vision API key
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
    
    console.log('✅ Vision service added to database');
    console.log('💡 Note: Set GOOGLE_VISION_API_KEY in .env for online mode');
    console.log('💡 Privacy mode (local Qwen2-VL) works without API key');
  }
};
