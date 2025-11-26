/**
 * IPC Handlers for Google Vision OAuth
 * Handles OAuth flow for Google Cloud Vision API
 */

const { ipcMain } = require('electron');

const logger = require('./../logger.cjs');
/**
 * Setup Google Vision OAuth IPC handlers
 * @param {Object} db - DuckDB connection for storing OAuth data
 * @param {Object} mcpConfigManager - MCP Config Manager instance to reload services
 */
function setupVisionOAuthHandlers(db, mcpConfigManager = null) {
  logger.debug('🔧 Setting up Vision OAuth handlers...');

  /**
   * Start Google Vision OAuth flow
   * Uses the same OAuth client as Gemini since both are Google APIs
   */
  ipcMain.handle('vision:oauth:start', async () => {
    logger.debug('🔐 Starting Google Vision OAuth flow...');
    
    try {
      // Call the command service OAuth endpoint (reuses Gemini OAuth)
      // Google OAuth provides access to multiple APIs with the same token
      const response = await fetch('http://localhost:3007/gemini.oauth.start', {
        method: 'POST',
        headers: {
          'Authorization': 'q6E53kWzIGoxkohxuih3A4xVS06PZn1I',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'gemini.oauth.start',
          payload: {
            // Request additional scopes for Cloud Vision API
            additionalScopes: ['https://www.googleapis.com/auth/cloud-vision']
          }
        })
      });

      const data = await response.json();
      
      logger.debug('🔍 OAuth response data:', JSON.stringify(data, null, 2));
      
      if (data.success) {
        logger.debug('✅ Google Vision OAuth completed successfully');
        
        // Store Google API key and OAuth tokens in user_settings
        if (data.apiKey && db) {
          logger.debug('🔑 Storing Google API key:', data.apiKey.substring(0, 20) + '...');
          try {
            // Store Google Cloud API key
            await db.run(`
              INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted, updated_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
              'setting_google_cloud_api_key',
              'default_user',
              'google_cloud_api_key',
              data.apiKey,
              true
            ]);
            logger.debug('✅ Google Cloud API key stored in user_settings');
            
            // Store OAuth tokens in user_settings
            if (data.tokens) {
              // Access token
              await db.run(`
                INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              `, [
                'setting_google_oauth_access_token',
                'default_user',
                'google_oauth_access_token',
                data.tokens.access_token,
                true
              ]);
              
              // Refresh token
              if (data.tokens.refresh_token) {
                await db.run(`
                  INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted, updated_at)
                  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                  'setting_google_oauth_refresh_token',
                  'default_user',
                  'google_oauth_refresh_token',
                  data.tokens.refresh_token,
                  true
                ]);
              }
              
              // Token expiry
              if (data.tokens.expiry_date) {
                await db.run(`
                  INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted, updated_at)
                  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                  'setting_google_oauth_token_expiry',
                  'default_user',
                  'google_oauth_token_expiry',
                  new Date(data.tokens.expiry_date).toISOString(),
                  false
                ]);
              }
              
              // Scope
              if (data.tokens.scope) {
                await db.run(`
                  INSERT OR REPLACE INTO user_settings (id, user_id, setting_key, setting_value, encrypted, updated_at)
                  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                  'setting_google_oauth_scope',
                  'default_user',
                  'google_oauth_scope',
                  data.tokens.scope,
                  false
                ]);
              }
              
              logger.debug('✅ OAuth tokens stored in user_settings');
            }
          } catch (dbError) {
            logger.error('❌ Failed to store Google OAuth data:', dbError);
          }
        }
        
        return {
          success: true,
          message: 'Google Vision API connected successfully',
          status: data.status
        };
      } else {
        logger.error('❌ Google Vision OAuth failed:', data.error);
        return {
          success: false,
          error: data.error
        };
      }
    } catch (error) {
      logger.error('❌ Google Vision OAuth error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Get Google Vision status
   */
  ipcMain.handle('vision:status', async () => {
    try {
      // Check if user has Google OAuth configured in user_settings
      if (db) {
        const apiKeyResult = await db.query(`
          SELECT setting_value 
          FROM user_settings 
          WHERE user_id = 'default_user' AND setting_key = 'google_api_key'
        `);
        
        const tokenExpiryResult = await db.query(`
          SELECT setting_value 
          FROM user_settings 
          WHERE user_id = 'default_user' AND setting_key = 'google_oauth_token_expiry'
        `);
        
        const hasApiKey = apiKeyResult.length > 0 && !!apiKeyResult[0].setting_value;
        const isExpired = tokenExpiryResult.length > 0 && tokenExpiryResult[0].setting_value
          ? new Date(tokenExpiryResult[0].setting_value) < new Date()
          : false;
        
        return {
          success: true,
          configured: hasApiKey && !isExpired,
          hasApiKey,
          hasOAuth: hasApiKey,
          isExpired,
          apiKeyService: 'vision.googleapis.com',
          autoGenerated: true
        };
      }
      
      return {
        success: true,
        configured: false,
        hasApiKey: false,
        hasOAuth: false
      };
    } catch (error) {
      logger.error('❌ Failed to get Vision status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Revoke Google Vision OAuth
   */
  ipcMain.handle('vision:oauth:revoke', async () => {
    try {
      // Clear Google OAuth data from user_settings
      if (db) {
        await db.run(`
          DELETE FROM user_settings 
          WHERE user_id = 'default_user' 
            AND setting_key IN (
              'google_api_key',
              'google_oauth_access_token',
              'google_oauth_refresh_token',
              'google_oauth_token_expiry',
              'google_oauth_scope'
            )
        `);
        logger.debug('✅ Google OAuth data cleared from user_settings');
      }
      
      return {
        success: true,
        message: 'Google Vision OAuth revoked successfully'
      };
    } catch (error) {
      logger.error('❌ Failed to revoke Vision OAuth:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.debug('✅ Vision OAuth handlers setup complete');
}

module.exports = { setupVisionOAuthHandlers };
