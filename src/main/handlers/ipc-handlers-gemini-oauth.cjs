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
        
        // Store API key and OAuth tokens in DuckDB
        if (data.apiKey && data.tokens && db) {
          try {
            await db.run(`
              UPDATE mcp_services 
              SET api_key = ?,
                  oauth_access_token = ?,
                  oauth_refresh_token = ?,
                  oauth_token_expiry = ?,
                  oauth_scope = ?,
                  gemini_configured = true,
                  api_key_auto_generated = true,
                  api_key_service = 'generativelanguage.googleapis.com',
                  updated_at = CURRENT_TIMESTAMP
              WHERE name = 'command'
            `, [
              data.apiKey,
              data.tokens.access_token,
              data.tokens.refresh_token,
              data.tokens.expiry_date ? new Date(data.tokens.expiry_date).toISOString() : null,
              data.tokens.scope
            ]);
            console.log('✅ API key and OAuth tokens stored in DuckDB');
          } catch (dbError) {
            console.error('❌ Failed to store OAuth data in DuckDB:', dbError);
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
