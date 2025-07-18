// IPC Handlers Part 3: Screenshot, System Health, and Legacy LLM Handlers
// To be combined with ipc-handlers.cjs

const { ipcMain, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========================================
// SCREENSHOT WINDOW HANDLERS
// ========================================

function setupScreenshotHandlers(ipcMain) {
  // Open screenshot window
  ipcMain.handle('open-screenshot-window', async (event, imageData) => {
    const { screen } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    // Calculate window size - make it large enough to show the screenshot clearly
    const windowWidth = Math.min(screenWidth * 0.8, 1200); // 80% of screen width, max 1200px
    const windowHeight = Math.min(screenHeight * 0.8, 900); // 80% of screen height, max 900px
    
    // Position at the center-top of the screen
    const x = Math.floor((screenWidth - windowWidth) / 2);
    const y = 20; // 20px from the top
    
    const screenshotWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: x,
      y: y,                                                                                                                    
      alwaysOnTop: true,
      frame: false,  // Chromeless window
      transparent: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      closable: true,
      skipTaskbar: true,  // Don't show in taskbar
      webPreferences: {
        webSecurity: false,  // Allow file:// URLs
        nodeIntegration: false,
        contextIsolation: true,
        allowRunningInsecureContent: true  // Allow local file access
      }
    });
    
    try {
      // Create a temporary file for the screenshot to avoid URL length limits
      const tempDir = os.tmpdir();
      const tempFileName = `screenshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
      const tempFilePath = path.join(tempDir, tempFileName);
      
      let imageBuffer;
      
      if (typeof imageData === 'string') {
        // Extract base64 data from data URL if present
        const base64Data = imageData.startsWith('data:') 
          ? imageData.split(',')[1] 
          : imageData;
        
        console.log('Screenshot window - extracted base64 length:', base64Data.length);
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else if (imageData instanceof Uint8Array || Array.isArray(imageData)) {
        imageBuffer = Buffer.from(imageData);
      } else {
        throw new Error('Unsupported image data type');
      }
      
      // Write the image buffer to temporary file
      fs.writeFileSync(tempFilePath, imageBuffer);
      console.log('Screenshot window - wrote temp file:', tempFilePath);
      
      // Use file:// URL instead of data URL to avoid length limits
      const fileUrl = `file://${tempFilePath}`;
      const imageUrl = fileUrl;
      console.log('Screenshot window - using file URL:', imageUrl);
      
      // Create HTML content with file URL
      const htmlContent = `
        <html>
          <head>
            <title>Memory Snapshot</title>
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #0a0a0a;
                color: white;
                overflow: hidden;
                height: 100vh;
                display: flex;
                flex-direction: column;
              }
              .header {
                background: rgba(20, 20, 20, 0.95);
                padding: 8px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                -webkit-app-region: drag;
              }
              .title {
                font-size: 14px;
                font-weight: 500;
                color: #e0e0e0;
              }
              .close-btn {
                background: rgba(255, 59, 48, 0.8);
                border: none;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                color: white;
                transition: background 0.2s;
                -webkit-app-region: no-drag;
              }
              .close-btn:hover {
                background: rgba(255, 59, 48, 1);
              }
              .image-container {
                flex: 1;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 16px;
                background: #0a0a0a;
              }
              img { 
                max-width: 100%; 
                max-height: 100%; 
                object-fit: contain;
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
              }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="title">Memory Snapshot</div>
              <button class="close-btn" onclick="window.close()" title="Close">×</button>
            </div>
            <div class="image-container">
              <img src="${imageUrl}" alt="Memory Snapshot" 
                   onload="console.log('✅ Image loaded successfully', this.naturalWidth, 'x', this.naturalHeight)" 
                   onerror="console.error('❌ Image failed to load', this.src)" />
            </div>
            <script>
              console.log('🔍 Screenshot window HTML loaded');
              console.log('🔍 Image src:', '${imageUrl}');
              console.log('🔍 Image src length:', '${imageUrl}'.length);
              
              // Test file access
              const img = document.querySelector('img');
              if (img) {
                img.onload = function() {
                  console.log('✅ Image loaded successfully:', this.naturalWidth, 'x', this.naturalHeight);
                };
                img.onerror = function(e) {
                  console.error('❌ Image failed to load:', e);
                  console.error('❌ Image src:', this.src);
                  console.error('❌ Error details:', e.type, e.message);
                };
              }
              
              // Test if file exists by trying to fetch it
              fetch('${imageUrl}')
                .then(response => {
                  console.log('🔍 Fetch response:', response.status, response.statusText);
                  return response.blob();
                })
                .then(blob => {
                  console.log('🔍 File blob size:', blob.size, 'bytes');
                  console.log('🔍 File blob type:', blob.type);
                })
                .catch(err => {
                  console.error('❌ Fetch failed:', err);
                });
              
              // Add click handler to close window
              document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                  window.close();
                }
              });
              
              // Clean up temp file when window closes
              window.addEventListener('beforeunload', () => {
                // Note: We'll clean up the temp file in the main process
              });
            </script>
          </body>
        </html>
      `;
      // Load the HTML content
      screenshotWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))
        .catch(error => {
          console.error('Failed to load screenshot window with data URL, trying alternative method:', error);
          
          // Alternative: use webContents.loadURL with a simpler approach
          const simpleHtml = `
            <html>
              <head>
                <title>Memory Screenshot</title>
                <style>
                  body { margin: 0; background: #0a0a0a; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
                  img { max-width: 100%; max-height: 100%; object-fit: contain; }
                </style>
              </head>
              <body>
                <img src="${imageUrl}" alt="Screenshot" onload="console.log('Image loaded')" onerror="console.error('Image failed')" />
              </body>
            </html>
          `;
          
          return screenshotWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(simpleHtml));
        });
      
      // Add error handling for the window
      screenshotWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Screenshot window failed to load:', errorCode, errorDescription);
      });
      
      screenshotWindow.webContents.on('did-finish-load', () => {
        console.log('Screenshot window loaded successfully');
      });
      
      // Clean up temp file when window is closed
      screenshotWindow.on('closed', () => {
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log('Screenshot window - cleaned up temp file:', tempFilePath);
          }
        } catch (err) {
          console.error('Screenshot window - failed to clean up temp file:', err);
        }
      });
      
      // Don't auto-open DevTools in production
      // screenshotWindow.webContents.openDevTools();
      
      console.log('Screenshot window - returning success: true');
      return { success: true };
      
    } catch (error) {
      console.error('Screenshot window - error:', error);
      return { success: false, error: error.message };
    }
  });
}

// ========================================
// SYSTEM HEALTH HANDLERS
// ========================================

function setupSystemHealthHandlers(ipcMain, coreAgent, windowState) {
  // System health check
  ipcMain.handle('get-system-health', async () => {
    const health = {
      coreAgent: coreAgent ? (coreAgent.isInitialized ? 'ready' : 'initializing') : 'not_available',
      windows: {
        overlay: windowState.isOverlayVisible,
        chat: windowState.isChatVisible,
        insight: windowState.isInsightVisible,
        memoryDebugger: windowState.isMemoryDebuggerVisible
      }
    };
    
    return health;
  });
}

// ========================================
// LEGACY LLM COMPATIBILITY HANDLERS
// ========================================

function setupLegacyLLMHandlers(ipcMain, coreAgent) {
  // Legacy LLM health check - routes to unified agent system
  ipcMain.handle('llm-get-health', async () => {
    try {
      // Return health status compatible with legacy LocalLLMContext expectations
      const health = {
        status: coreAgent && coreAgent.isInitialized ? 'ready' : 'initializing',
        agents: coreAgent ? Object.keys(coreAgent.agents || {}).length : 0,
        database: coreAgent && coreAgent.database ? 'connected' : 'disconnected',
        lastActivity: new Date().toISOString()
      };
      
      return { success: true, data: health };
    } catch (error) {
      console.error('❌ LLM health check error:', error);
      return { success: false, error: error.message };
    }
  });

  // Legacy LLM query handler - routes to unified agent system
  ipcMain.handle('llm-query-local', async (event, prompt, options = {}) => {
    try {
      if (!coreAgent || !coreAgent.isInitialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      // Route legacy LLM queries through unified agent orchestration
      const intentPayload = {
        type: 'question',
        message: prompt,
        options,
        source: 'legacy_llm'
      };
      
      const result = await coreAgent.ask(intentPayload);
      return { success: true, data: result };
    } catch (error) {
      console.error('❌ Legacy LLM query error:', error);
      return { success: false, error: error.message };
    }
  });

  // Legacy LLM orchestration handler - routes to unified agent system
  ipcMain.handle('llm-orchestrate', async (event, userInput, context = {}) => {
    try {
      if (!coreAgent || !coreAgent.isInitialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      // Route legacy orchestration through unified agent orchestration
      const intentPayload = {
        type: 'command',
        message: userInput,
        context,
        source: 'legacy_orchestration'
      };
      
      const result = await coreAgent.ask(intentPayload);
      return { success: true, data: result };
    } catch (error) {
      console.error('❌ Legacy LLM orchestration error:', error);
      return { success: false, error: error.message };
    }
  });

  // Legacy cached agents handler - returns empty for now
  ipcMain.handle('llm-get-cached-agents', async () => {
    return { success: true, data: [] };
  });

  // Legacy communications handler - returns empty for now
  ipcMain.handle('llm-get-communications', async (event, limit = 10) => {
    return { success: true, data: [] };
  });

  // Legacy cache clear handler - no-op for now
  ipcMain.handle('llm-clear-cache', async () => {
    return { success: true };
  });

  // Legacy local LLM health check - routes to unified agent system
  ipcMain.handle('local-llm:health', async () => {
    try {
      // Return health status compatible with legacy LocalLLMContext expectations
      const health = {
        status: coreAgent && coreAgent.isInitialized ? 'ready' : 'initializing',
        agents: coreAgent ? Object.keys(coreAgent.agents || {}).length : 0,
        database: coreAgent && coreAgent.database ? 'connected' : 'disconnected',
        lastActivity: new Date().toISOString()
      };
      
      return { success: true, data: health };
    } catch (error) {
      console.error('❌ Local LLM health check error:', error);
      return { success: false, error: error.message };
    }
  });

  // Legacy local LLM process message handler - routes to unified agent system
  ipcMain.handle('local-llm:process-message', async (event, message) => {
    try {
      if (!coreAgent || !coreAgent.isInitialized) {
        return { success: false, error: 'CoreAgent not initialized' };
      }
      
      // Route legacy message processing through unified agent orchestration
      const intentPayload = {
        type: 'question',
        message: message.text || message,
        options: message.options || {},
        source: 'legacy_local_llm'
      };
      
      const result = await coreAgent.ask(intentPayload);
      return { success: true, data: result };
    } catch (error) {
      console.error('❌ Local LLM process message error:', error);
      return { success: false, error: error.message };
    }
  });
}

// Initialize all handlers
function initializeHandlers({
  ipcMain,
  coreAgent,
  windowState,
  windows
}) {
  setupScreenshotHandlers(ipcMain);
  setupSystemHealthHandlers(ipcMain, coreAgent, windowState);
  setupLegacyLLMHandlers(ipcMain, coreAgent);
}

module.exports = {
  initializeHandlers,
  setupScreenshotHandlers,
  setupSystemHealthHandlers,
  setupLegacyLLMHandlers
};
