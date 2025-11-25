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
  }

  /**
   * Main handler for Prompted Anywhere feature
   * Called when user presses Shift+Cmd+L
   */
  async handlePromptAnywhere() {
    // Prevent multiple simultaneous triggers
    if (this.isProcessing) {
      console.log('⚠️  [Prompted Anywhere] Already processing, ignoring trigger');
      return;
    }

    this.isProcessing = true;

    try {
      console.log('🔥 [Prompted Anywhere] Triggered!');

      // Step 1: Capture screenshot
      console.log('📸 [Prompted Anywhere] Capturing screenshot...');
      const screenshot = await this.captureScreen();

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

      if (result.success) {
        console.log('✅ [Prompted Anywhere] Completed successfully!');
        console.log(`   Provider: ${result.metadata?.provider}`);
        console.log(`   Used Vision: ${result.metadata?.usedVision}`);
        console.log(`   Latency: ${result.metadata?.latencyMs}ms`);
      } else {
        console.error('❌ [Prompted Anywhere] Failed:', result.error);
      }

    } catch (error) {
      console.error('❌ [Prompted Anywhere] Error:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Capture screenshot of current screen
   * @returns {Promise<string>} Base64 encoded PNG
   */
  async captureScreen() {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;

      // Get all sources (windows and screens)
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width, height }
      });

      if (!sources || sources.length === 0) {
        throw new Error('No screen sources available');
      }

      // Use the primary screen (first source)
      const source = sources[0];
      const screenshot = source.thumbnail;

      // Resize to reduce payload size (max 800px width)
      const targetWidth = 800;
      const scaleFactor = targetWidth / screenshot.getSize().width;
      const targetHeight = Math.round(screenshot.getSize().height * scaleFactor);

      const resized = screenshot.resize({
        width: targetWidth,
        height: targetHeight
      });

      // Convert to base64 PNG
      const base64 = resized.toPNG().toString('base64');

      console.log(`📸 [Prompted Anywhere] Screenshot captured: ${(base64.length / 1024).toFixed(2)} KB`);

      return base64;

    } catch (error) {
      console.error('❌ [Prompted Anywhere] Screenshot capture failed:', error);
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
