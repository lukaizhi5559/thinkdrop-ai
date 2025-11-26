/**
 * Prompted Anywhere Service
 * 
 * Handles the "Prompted Anywhere" feature - allows users to trigger AI assistance
 * from any application using Shift+Cmd+L shortcut.
 * 
 * Flow:
 * 1. User presses Shift+Cmd+L in any app
 * 2. Captures screenshot of current screen
 * 3. Captures highlighted text (if any) via clipboard
 * 4. Sends to MCP command service
 * 5. Backend generates NutJS code that types response
 * 6. Response appears inline in the user's app
 */

const { screen, desktopCapturer, clipboard } = require('electron');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class PromptedAnywhereService {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.isProcessing = false;
    this.lastTriggerTime = 0;
    this.debounceMs = 500; // Prevent triggers within 500ms
    this.captureCount = 0;
    this.maxCapturesBeforeGC = 10; // Force GC every 10 captures
    
    // Memory monitoring
    this.startMemoryMonitoring();
  }

  /**
   * Monitor memory usage and log warnings
   */
  startMemoryMonitoring() {
    setInterval(() => {
      if (global.gc && this.captureCount > 0) {
        const usage = process.memoryUsage();
        const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
        const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(2);
        
        if (usage.heapUsed / usage.heapTotal > 0.9) {
          console.warn(`⚠️  [Prompted Anywhere] High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`);
          console.log('🧹 [Prompted Anywhere] Forcing garbage collection...');
          global.gc();
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Main handler for Prompted Anywhere feature
   * Called when user presses Shift+Cmd+L
   */
  async handlePromptAnywhere() {
    // Debounce: Prevent triggers too close together
    const now = Date.now();
    if (now - this.lastTriggerTime < this.debounceMs) {
      console.log('⚠️  [Prompted Anywhere] Debounced - too soon after last trigger');
      return;
    }
    this.lastTriggerTime = now;

    // Prevent multiple simultaneous triggers
    if (this.isProcessing) {
      console.log('⚠️  [Prompted Anywhere] Already processing, ignoring trigger');
      return;
    }

    this.isProcessing = true;
    let screenshot = null;

    try {
      console.log('🔥 [Prompted Anywhere] Triggered!');

      // Step 1: Capture screenshot
      console.log('📸 [Prompted Anywhere] Capturing screenshot...');
      screenshot = await this.captureScreen();
      this.captureCount++;

      // Step 2: Capture highlighted text
      console.log('📋 [Prompted Anywhere] Capturing highlighted text...');
      const highlightedText = await this.captureHighlightedText();

      if (highlightedText) {
        console.log(`📝 [Prompted Anywhere] Text captured: "${highlightedText.substring(0, 50)}..."`);
      } else {
        console.log('📝 [Prompted Anywhere] No text highlighted, using default prompt');
      }

      // Step 3: Send to MCP service
      console.log('🚀 [Prompted Anywhere] Sending to MCP service...');
      const result = await this.sendToMCPService(highlightedText, screenshot);

      // Clear screenshot from memory immediately after sending
      screenshot = null;

      if (result.success) {
        console.log('✅ [Prompted Anywhere] Completed successfully!');
        console.log(`   Provider: ${result.metadata?.provider}`);
        console.log(`   Used Vision: ${result.metadata?.usedVision}`);
        console.log(`   Latency: ${result.metadata?.latencyMs}ms`);
      } else {
        console.error('❌ [Prompted Anywhere] Failed:', result.error);
      }

      // Periodic garbage collection
      if (this.captureCount >= this.maxCapturesBeforeGC) {
        console.log('🧹 [Prompted Anywhere] Triggering garbage collection...');
        this.captureCount = 0;
        if (global.gc) {
          global.gc();
        }
      }

    } catch (error) {
      console.error('❌ [Prompted Anywhere] Error:', error.message);
      // Ensure screenshot is cleared on error
      screenshot = null;
    } finally {
      this.isProcessing = false;
      // Force cleanup
      screenshot = null;
    }
  }

  /**
   * Capture screenshot of current screen
   * @returns {Promise<string>} Base64 encoded PNG
   */
  async captureScreen() {
    let sources = null;
    let targetSource = null;
    let screenshot = null;
    let resized = null;
    
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;

      // Optimize: Use smaller thumbnail size to reduce memory allocation
      // We'll resize to 800px anyway, so no need for full resolution
      const maxThumbnailSize = 1200; // Reduced from full display size
      const thumbnailWidth = Math.min(width, maxThumbnailSize);
      const thumbnailHeight = Math.min(height, maxThumbnailSize);

      // Get all sources (windows and screens)
      sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
        fetchWindowIcons: false // Faster capture
      });

      if (!sources || sources.length === 0) {
        throw new Error('No screen sources available');
      }

      // Debug: Log all available sources
      console.log(`📸 [Prompted Anywhere] Available sources (${sources.length}):`);
      sources.slice(0, 5).forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.name} (${s.id})`);
      });

      // Try to get the active window from window tracker
      
      // Check if we have window tracker data
      if (global.activeWindowData) {
        const activeWindow = global.activeWindowData;
        console.log(`📸 [Prompted Anywhere] Active window from tracker: ${activeWindow.app} - ${activeWindow.title || 'unknown'}`);
        
        // Try to find matching source by app name or title
        if (activeWindow.app || activeWindow.title) {
          targetSource = sources.find(s => {
            const sourceName = s.name.toLowerCase();
            const appName = (activeWindow.app || '').toLowerCase();
            const title = (activeWindow.title || '').toLowerCase();
            
            // Match by app name (e.g., "Google Chrome")
            if (appName && sourceName.includes(appName)) {
              return true;
            }
            
            // Match by title (e.g., "LinkedIn")
            if (title && (sourceName.includes(title) || title.includes(sourceName))) {
              return true;
            }
            
            return false;
          });
          
          if (targetSource) {
            console.log(`📸 [Prompted Anywhere] Matched window: ${targetSource.name}`);
          } else {
            console.log(`📸 [Prompted Anywhere] No match found for: ${activeWindow.app} - ${activeWindow.title}`);
          }
        }
      } else {
        console.log(`📸 [Prompted Anywhere] No active window data available`);
      }
      
      // Fallback: Filter out Electron windows and use first non-ThinkDrop window
      if (!targetSource) {
        const activeWindows = sources.filter(s => 
          s.name !== 'Electron' && 
          !s.name.includes('ThinkDrop') &&
          s.id.startsWith('window:')
        );
        targetSource = activeWindows[0];
      }
      
      // Final fallback: Use entire screen
      if (!targetSource) {
        targetSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      }
      
      console.log(`📸 [Prompted Anywhere] Capturing: ${targetSource.name} (${targetSource.id})`);
      
      screenshot = targetSource.thumbnail;

      // Resize to reduce payload size (max 800px width)
      const targetWidth = 800;
      const screenshotSize = screenshot.getSize();
      const scaleFactor = targetWidth / screenshotSize.width;
      const targetHeight = Math.round(screenshotSize.height * scaleFactor);

      resized = screenshot.resize({
        width: targetWidth,
        height: targetHeight
      });

      // Convert to base64 PNG
      const base64 = resized.toPNG().toString('base64');

      console.log(`📸 [Prompted Anywhere] Screenshot captured: ${(base64.length / 1024).toFixed(2)} KB`);

      // Explicit cleanup: Clear references to native image objects
      screenshot = null;
      resized = null;
      sources = null;
      targetSource = null;

      return base64;

    } catch (error) {
      console.error('❌ [Prompted Anywhere] Screenshot capture failed:', error);
      
      // Cleanup on error
      screenshot = null;
      resized = null;
      sources = null;
      targetSource = null;
      
      throw error;
    }
  }

  /**
   * Capture highlighted text using clipboard
   * Uses a marker to detect if text was actually selected vs just clipboard content
   * @returns {Promise<string|null>} Captured text or null if nothing highlighted
   */
  async captureHighlightedText() {
    try {
      // Save current clipboard content
      const previousClipboard = clipboard.readText();

      // Use a unique marker to detect if clipboard changes
      const marker = `__THINKDROP_${Date.now()}__`;
      clipboard.writeText(marker);

      // Wait a bit for clipboard to update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate Cmd+C (macOS) or Ctrl+C (Windows/Linux)
      const copyCommand = process.platform === 'darwin'
        ? 'osascript -e \'tell application "System Events" to keystroke "c" using command down\''
        : process.platform === 'win32'
        ? 'powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^c\')"'
        : 'xdotool key ctrl+c'; // Linux

      await execAsync(copyCommand);

      // Wait for clipboard to update
      await new Promise(resolve => setTimeout(resolve, 300));

      // Read clipboard
      const copiedText = clipboard.readText();

      // Check if clipboard changed from our marker
      // If it's still the marker or same as previous, nothing was selected
      if (!copiedText || copiedText === marker || copiedText === previousClipboard) {
        // Nothing was highlighted - restore previous clipboard
        clipboard.writeText(previousClipboard);
        console.log('📋 [Prompted Anywhere] No text highlighted');
        return null;
      }

      console.log(`📋 [Prompted Anywhere] Captured text: "${copiedText.substring(0, 50)}..."`);

      // Restore previous clipboard after a delay
      setTimeout(() => {
        clipboard.writeText(previousClipboard);
      }, 5000);

      return copiedText;

    } catch (error) {
      console.error('❌ [Prompted Anywhere] Failed to capture highlighted text:', error);
      // Restore clipboard on error
      try {
        const previousClipboard = clipboard.readText();
        if (previousClipboard && previousClipboard.startsWith('__THINKDROP_')) {
          clipboard.writeText(''); // Clear our marker
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      return null;
    }
  }

  /**
   * Send request to MCP command service
   * @param {string|null} text - Highlighted text or null
   * @param {string} screenshot - Base64 screenshot
   * @returns {Promise<Object>} MCP response
   */
  async sendToMCPService(text, screenshot) {
    try {
      console.log('📤 [Prompted Anywhere] Sending to MCP service...');

      // Send to MCP service via MCP client
      // Use callService(serviceName, action, payload)
      const response = await this.mcpClient.callService(
        'command',
        'command.prompt-anywhere',
        {
          text: text || '',
          screenshot: screenshot,
          context: {
            os: process.platform,
            timestamp: Date.now()
          }
        },
        { timeout: 120000 } // 120 second timeout for vision processing + execution
      );

      return response;

    } catch (error) {
      console.error('❌ [Prompted Anywhere] MCP request failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { PromptedAnywhereService };
