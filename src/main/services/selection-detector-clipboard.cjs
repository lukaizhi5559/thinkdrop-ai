const { clipboard, globalShortcut, screen } = require('electron');
const { execSync } = require('child_process');

/**
 * Event-driven selection detector - much more efficient!
 */
class SelectionDetector {
  constructor() {
    this.lastDetectedSelection = null;
    this.lastButtonShowTime = 0;
    this.clipboardMonitorInterval = null;
    this.isActive = false;
  }

  /**
   * Start selection monitoring using event-driven approach
   */
  startSelectionMonitoring() {
    console.log('👀 [SELECTION_DETECTOR] Starting event-driven selection monitoring');
    
    // Start clipboard monitoring (lightweight)
    this.startClipboardMonitoring();
    
    this.isActive = true;
    console.log('✅ [SELECTION_DETECTOR] Event-driven monitoring active');
  }

  /**
   * Monitor clipboard changes for text selection (much more efficient)
   */
  startClipboardMonitoring() {
    console.log('📋 [SELECTION_DETECTOR] Starting clipboard monitoring for selection detection');
    
    let lastClipboard = clipboard.readText();
    
    // Check clipboard every 2 seconds (very lightweight)
    this.clipboardMonitorInterval = setInterval(() => {
      try {
        const currentClipboard = clipboard.readText();
        
        // Check if clipboard changed and it's valid text
        if (currentClipboard !== lastClipboard && 
            currentClipboard !== '__THINKDROP_TEMP__' &&
            currentClipboard.length > 3 &&
            currentClipboard.length < 2000) {
          
          // Debounce to avoid spam
          const now = Date.now();
          const timeSinceLastShow = now - this.lastButtonShowTime;
          
          if (currentClipboard !== this.lastDetectedSelection && timeSinceLastShow > 2000) {
            console.log('📋 [SELECTION_DETECTOR] New text detected in clipboard');
            console.log(`📝 [SELECTION_DETECTOR] Text: "${currentClipboard.substring(0, 50)}..."`);
            
            this.lastDetectedSelection = currentClipboard;
            this.lastButtonShowTime = now;
            
            // Show floating button at current mouse position
            this.showFloatingButtonAtCurrentPosition(currentClipboard);
          }
          
          lastClipboard = currentClipboard;
        }
        
      } catch (error) {
        // Silent fail to avoid spam
      }
    }, 2000); // Every 2 seconds - very lightweight
  }

  /**
   * Show floating button at current mouse position
   */
  async showFloatingButtonAtCurrentPosition(selectedText) {
    try {
      // Get current mouse position
      const cursorPos = screen.getCursorScreenPoint();
      
      console.log('🎯 [SELECTION_DETECTOR] Showing floating button at current mouse position');
      console.log(`🖱️  [SELECTION_DETECTOR] Mouse position: (${cursorPos.x}, ${cursorPos.y})`);
      
      // Calculate button position (slightly offset from cursor)
      const buttonX = cursorPos.x + 15;
      const buttonY = cursorPos.y + 25;
      
      console.log(`📍 [SELECTION_DETECTOR] Button position: (${buttonX}, ${buttonY})`);
      
      // Show the floating button
      const { showSelectionButton } = require('../windows/selection-overlay.cjs');
      showSelectionButton(buttonX, buttonY, selectedText);
      
      console.log('✅ [SELECTION_DETECTOR] Floating button shown at mouse position');
      
    } catch (error) {
      console.error('❌ [SELECTION_DETECTOR] Failed to show floating button:', error);
    }
  }

  /**
   * Manual capture for Cmd+Option+A shortcut
   */
  async captureSelectionWithNutJS() {
    console.log('📋 [SELECTION_DETECTOR] Starting capture...');
    
    try {
      // Save original clipboard
      const originalClipboard = clipboard.readText();
      console.log(`📋 [SELECTION_DETECTOR] Original clipboard: ${originalClipboard.substring(0, 50)}`);
      
      // Clear clipboard with temp marker
      clipboard.writeText('__THINKDROP_TEMP__');
      console.log('📋 [SELECTION_DETECTOR] Clipboard cleared');
      
      // Simulate Cmd+C
      console.log('📋 [SELECTION_DETECTOR] Simulating Cmd+C...');
      execSync('osascript -e "tell application \\"System Events\\" to keystroke \\"c\\" using command down"');
      
      // Wait for clipboard to update
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Get new clipboard content
      const newClipboard = clipboard.readText();
      console.log('📋 [SELECTION_DETECTOR] Cmd+C simulated');
      
      // Restore original clipboard
      clipboard.writeText(originalClipboard);
      
      if (newClipboard && newClipboard !== '__THINKDROP_TEMP__' && newClipboard !== originalClipboard) {
        console.log(`✅ [SELECTION_DETECTOR] Captured highlighted text: ${newClipboard}`);
        
        // Notify renderer about selection
        this.notifySelectionAvailable({
          text: newClipboard,
          sourceApp: await this.getActiveAppName(),
          method: 'capture'
        });
        
        return newClipboard;
      } else {
        console.log('⚠️  [SELECTION_DETECTOR] No highlighted text detected');
        return null;
      }
      
    } catch (error) {
      console.error('❌ [SELECTION_DETECTOR] Capture failed:', error);
      return null;
    }
  }

  /**
   * Get active application name
   */
  async getActiveAppName() {
    try {
      const result = execSync(`
        osascript -e "tell application \\"System Events\\" to get name of first application process whose frontmost is true"
      `, { encoding: 'utf8' });
      return result.trim();
    } catch (error) {
      return 'Unknown App';
    }
  }

  /**
   * Notify renderer about available selection
   */
  notifySelectionAvailable(selectionData) {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    
    windows.forEach(window => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('selection:available', selectionData);
      }
    });
  }

  /**
   * Show floating button for testing (Cmd+Option+T)
   */
  async showFloatingButtonWithEstimatedPosition(testText) {
    console.log('🧪 [SELECTION_DETECTOR] Showing test floating button');
    
    const cursorPos = screen.getCursorScreenPoint();
    const buttonX = cursorPos.x + 15;
    const buttonY = cursorPos.y + 25;
    
    const { showSelectionButton } = require('../windows/selection-overlay.cjs');
    showSelectionButton(buttonX, buttonY, testText);
    
    console.log('✅ [SELECTION_DETECTOR] Test button shown');
  }

  /**
   * Stop all monitoring
   */
  stop() {
    console.log('🛑 [SELECTION_DETECTOR] Stopping selection monitoring');
    
    if (this.clipboardMonitorInterval) {
      clearInterval(this.clipboardMonitorInterval);
      this.clipboardMonitorInterval = null;
    }
    
    this.isActive = false;
    console.log('✅ [SELECTION_DETECTOR] Selection monitoring stopped');
  }
}

module.exports = SelectionDetector;
