/**
 * IPC Handlers for Gemini OAuth
 * Handles OAuth flow from renderer process
 */

const { ipcMain } = require('electron');
const http = require('http');

/**
 * Setup Gemini OAuth IPC handlers
 * @param {Object} db - DuckDB connection for storing OAuth data
 */
function setupGeminiOAuthHandlers(db) {
  console.log('🔧 Setting up Gemini OAuth handlers...');

  /**
   * Start Gemini OAuth flow
   */
  ipcMain.handle('gemini:oauth:start', async () => {
    console.log('🔐 Starting Gemini OAuth flow...');
    
    try {
      // Call the command service OAuth endpoint
      const response = await fetch('http://localhost:3007/gemini.oauth.start', {
        method: 'POST',
        headers: {
          'Authorization': 'q6E53kWzIGoxkohxuih3A4xVS06PZn1I',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'gemini.oauth.start',
          payload: {}
        })
      });

      const data = await response.json();
      
      if (data.success) {
        console.log('✅ Gemini OAuth completed successfully');
        
        // Store API key and OAuth tokens in user_settings (not mcp_services)
        if (data.apiKey && data.tokens && db) {
          try {
            // Store Google Cloud API key
            await db.run(`
              INSERT INTO user_settings (id, user_id, setting_key, setting_value, encrypted, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT (user_id, setting_key) DO UPDATE SET
                setting_value = EXCLUDED.setting_value,
                updated_at = EXCLUDED.updated_at
            `, [
              'setting_google_cloud_api_key',
              'default_user',
              'google_cloud_api_key',
              data.apiKey,
              false
            ]);
            
            // Store OAuth access token
            await db.run(`
              INSERT INTO user_settings (id, user_id, setting_key, setting_value, encrypted, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT (user_id, setting_key) DO UPDATE SET
                setting_value = EXCLUDED.setting_value,
                updated_at = EXCLUDED.updated_at
            `, [
              'setting_google_oauth_access_token',
              'default_user',
              'google_oauth_access_token',
              data.tokens.access_token,
              true
            ]);
            
            // Store OAuth refresh token
            if (data.tokens.refresh_token) {
              await db.run(`
                INSERT INTO user_settings (id, user_id, setting_key, setting_value, encrypted, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, setting_key) DO UPDATE SET
                  setting_value = EXCLUDED.setting_value,
                  updated_at = EXCLUDED.updated_at
              `, [
                'setting_google_oauth_refresh_token',
                'default_user',
                'google_oauth_refresh_token',
                data.tokens.refresh_token,
                true
              ]);
            }
            
            // Store OAuth token expiry
            if (data.tokens.expiry_date) {
              await db.run(`
                INSERT INTO user_settings (id, user_id, setting_key, setting_value, encrypted, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, setting_key) DO UPDATE SET
                  setting_value = EXCLUDED.setting_value,
                  updated_at = EXCLUDED.updated_at
              `, [
                'setting_google_oauth_token_expiry',
                'default_user',
                'google_oauth_token_expiry',
                new Date(data.tokens.expiry_date).toISOString(),
                false
              ]);
            }
            
            // Store OAuth scope
            if (data.tokens.scope) {
              await db.run(`
                INSERT INTO user_settings (id, user_id, setting_key, setting_value, encrypted, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, setting_key) DO UPDATE SET
                  setting_value = EXCLUDED.setting_value,
                  updated_at = EXCLUDED.updated_at
              `, [
                'setting_google_oauth_scope',
                'default_user',
                'google_oauth_scope',
                data.tokens.scope,
                false
              ]);
            }
            
            console.log('✅ API key and OAuth tokens stored in user_settings');
          } catch (dbError) {
            console.error('❌ Failed to store OAuth data in user_settings:', dbError);
          }
        }
        
        return {
          success: true,
          message: data.message,
          status: data.status
        };
      } else {
        console.error('❌ Gemini OAuth failed:', data.error);
        return {
          success: false,
          error: data.error
        };
      }
    } catch (error) {
      console.error('❌ Gemini OAuth error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Get Gemini status
   */
  ipcMain.handle('gemini:status', async () => {
    try {
      const response = await fetch('http://localhost:3007/gemini.status', {
        method: 'POST',
        headers: {
          'Authorization': 'q6E53kWzIGoxkohxuih3A4xVS06PZn1I',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'gemini.status',
          payload: {}
        })
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Failed to get Gemini status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  /**
   * Revoke Gemini OAuth
   */
  ipcMain.handle('gemini:oauth:revoke', async () => {
    try {
      const response = await fetch('http://localhost:3007/gemini.oauth.revoke', {
        method: 'POST',
        headers: {
          'Authorization': 'q6E53kWzIGoxkohxuih3A4xVS06PZn1I',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'gemini.oauth.revoke',
          payload: {}
        })
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Failed to revoke Gemini OAuth:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  console.log('✅ Gemini OAuth handlers setup complete');
}

module.exports = { setupGeminiOAuthHandlers };
