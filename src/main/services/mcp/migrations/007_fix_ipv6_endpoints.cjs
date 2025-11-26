/**
 * Migration: Fix IPv6 endpoints
 * Changes localhost to 127.0.0.1 for IPv4 compatibility
 */

const logger = require('./../../../logger.cjs');
module.exports = {
  async migrate(db) {
    logger.debug('🔄 Running migration: 007_fix_ipv6_endpoints');
    
    try {
      // Update phi4 endpoint from localhost to 127.0.0.1
      await db.run(`
        UPDATE mcp_services 
        SET endpoint = 'http://127.0.0.1:3003'
        WHERE name = 'phi4'
      `);
      
      logger.debug('✅ Updated phi4 endpoint to use 127.0.0.1 (IPv4)');
      
      // Optional: Update other services too for consistency
      await db.run(`
        UPDATE mcp_services 
        SET endpoint = 'http://127.0.0.1:3001'
        WHERE name = 'user-memory'
      `);
      
      await db.run(`
        UPDATE mcp_services 
        SET endpoint = 'http://127.0.0.1:3002'
        WHERE name = 'web-search'
      `);
      
      await db.run(`
        UPDATE mcp_services 
        SET endpoint = 'http://127.0.0.1:3004'
        WHERE name = 'conversation'
      `);
      
      await db.run(`
        UPDATE mcp_services 
        SET endpoint = 'http://127.0.0.1:3005'
        WHERE name = 'coreference'
      `);
      
      await db.run(`
        UPDATE mcp_services 
        SET endpoint = 'http://127.0.0.1:3006'
        WHERE name = 'vision'
      `);
      
      await db.run(`
        UPDATE mcp_services 
        SET endpoint = 'http://127.0.0.1:3007'
        WHERE name = 'command'
      `);
      
      logger.debug('✅ All service endpoints updated to use 127.0.0.1 (IPv4)');
      
    } catch (error) {
      logger.error('❌ Migration 007_fix_ipv6_endpoints failed:', error);
      throw error;
    }
  }
};
