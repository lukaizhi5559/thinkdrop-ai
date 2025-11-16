const { clipboard, globalShortcut, screen } = require('electron');
const { execSync } = require('child_process');

/**
 * Hybrid AppleScript + nut.js selection detector
 * Uses AppleScript for reliable text selection detection
 * Uses nut.js for accurate mouse coordinates
 */
class SelectionDetector {
  constructor() {
    this.lastDetectedSelection = null;
    this.lastButtonShowTime = 0;
    this.selectionCheckInterval = null;
    this.isActive = false;
  }

  /**
   * Start selection monitoring using AppleScript
   */
  startSelectionMonitoring() {
    console.log('👀 [SELECTION_DETECTOR] Selection monitoring ready');
    // DISABLED: AppleScript polling causes typing lag
    // this.startAppleScriptSelectionDetection();
    console.log('✅ [SELECTION_DETECTOR] Use Cmd+Option+A to capture highlighted text');
    console.log('⚠️  [SELECTION_DETECTOR] AppleScript polling disabled to prevent typing lag');
  }

  /**
   * Start method expected by main.cjs
   */
  start() {
    console.log('📋 [SELECTION_DETECTOR] Ready for Cmd+A capture');
    this.startSelectionMonitoring();
    console.log('✅ [SELECTION_DETECTOR] Use Cmd+Option+A to capture highlighted text');
  }

  /**
   * AppleScript-based selection detection (checks for highlighted text)
   */
  startAppleScriptSelectionDetection() {
    console.log('🍎 [SELECTION_DETECTOR] Starting AppleScript selection detection');
    
    // Check for selections every 2 seconds using AppleScript
    this.selectionCheckInterval = setInterval(async () => {
      try {
        const selectedText = await this.getSelectedTextDirectly();
        
        // Only log and act if we actually found new text
        if (selectedText && 
            selectedText.length > 3 && 
            selectedText.length < 2000 &&
            selectedText !== this.lastDetectedSelection) {
          
          // Debounce to avoid spam
          const now = Date.now();
          const timeSinceLastShow = now - this.lastButtonShowTime;
          
          if (timeSinceLastShow > 2000) {
            console.log('🍎 [SELECTION_DETECTOR] New text selection detected');
            console.log(`📝 [SELECTION_DETECTOR] Text: "${selectedText.substring(0, 50)}..."`);
            
            this.lastDetectedSelection = selectedText;
            this.lastButtonShowTime = now;
            
            // Get precise mouse coordinates using nut.js
            await this.showFloatingButtonWithPreciseCoordinates(selectedText);
          }
        }
        
      } catch (error) {
        // Silent fail to avoid spam
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Get selected text directly using AppleScript (simplified approach)
   */
  async getSelectedTextDirectly() {
    try {
      // Use much simpler AppleScript - just try to get AXSelectedText from focused element
      const script = `
        tell application "System Events"
          try
            set selectedText to value of attribute "AXSelectedText" of focused UI element of (first application process whose frontmost is true)
            if selectedText is not missing value and selectedText is not "" then
              return selectedText
            end if
          end try
          return ""
        end tell
      `;
      
      // SAFETY: Wrap in try-catch to prevent crashes
      let result = '';
      try {
        result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}' 2>/dev/null || echo ""`, { 
          encoding: 'utf8',
          timeout: 500,  // Reduced timeout to fail fast
          killSignal: 'SIGKILL'  // Force kill if timeout
        });
      } catch (execError) {
        // Silent fail - AppleScript can crash if accessibility denied
        return null;
      }
      
      const selectedText = result.trim();
      
      // If direct method fails or returns empty, try clipboard method
      if (!selectedText || selectedText.length === 0) {
        return await this.getSelectedTextViaClipboard();
      }
      
      return selectedText;
      
    } catch (error) {
      console.log('🔄 [SELECTION_DETECTOR] Direct AppleScript failed, trying clipboard method');
      // If direct AppleScript fails, fall back to clipboard method
      return await this.getSelectedTextViaClipboard();
    }
  }

  /**
   * Fallback: Get selected text via clipboard (safer AppleScript)
   */
  async getSelectedTextViaClipboard() {
    try {
      // Save original clipboard
      const originalClipboard = clipboard.readText();
      
      // Use simpler AppleScript for Cmd+C
      const script = `
        tell application "System Events"
          keystroke "c" using command down
        end tell
      `;
      
      // SAFETY: Wrap in try-catch to prevent crashes
      try {
        execSync(`osascript -e '${script}'`, { 
          timeout: 500,
          killSignal: 'SIGKILL'
        });
      } catch (execError) {
        // Silent fail - AppleScript can crash
        return null;
      }
      
      // Wait briefly for clipboard to update
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Get new clipboard content
      const newClipboard = clipboard.readText();
      
      // Restore original clipboard
      clipboard.writeText(originalClipboard);
      
      // Return selection if it changed
      if (newClipboard && newClipboard !== originalClipboard) {
        return newClipboard;
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ [SELECTION_DETECTOR] Clipboard fallback failed:', error);
      return null;
    }
  }

  /**
   * Show hotkey hint toast (only once on startup)
   */
  showHotkeyHintOnce() {
    try {
      console.log('🔔 [SELECTION_DETECTOR] showHotkeyHintOnce called');
      
      const { showHotkeyToast } = require('../windows/hotkey-toast-overlay.cjs');
      
      console.log('🔔 [SELECTION_DETECTOR] Showing hotkey toast...');
      showHotkeyToast(`<div class="hotkey-hint" id="hotkeyHint">
        <div class="hint-content">
          <span class="hint-icon"></span>
          <span class="hint-text">Highlight anything anywhere and press to sync to prompt</span>
        </div>
        <br/>
        <div class="hint-content">
          <span class="hint-text"> <kbd>⌘</kbd> + <kbd>⌥</kbd> + <kbd>A</kbd></span>
        </div>
    </div>`);
      
      console.log('✅ [SELECTION_DETECTOR] Hotkey hint toast shown');
      
    } catch (error) {
      console.error('❌ [SELECTION_DETECTOR] Failed to show hotkey hint:', error);
      console.error('Error details:', error.stack);
    }
  }

  /**
   * Show toast notification when text is selected (DISABLED - was annoying)
   */
  async showFloatingButtonWithPreciseCoordinates(selectedText) {
    // Disabled - user found it annoying
    // Only show hotkey hint once on startup via showHotkeyHintOnce()
  }

  /**
   * Manual capture for Cmd+Option+A shortcut
   */
  async captureSelectionWithNutJS() {
    console.log('📋 [SELECTION_DETECTOR] Manual capture triggered (Cmd+Option+A)');
    
    try {
      let selectedText = null;
      
      // Try up to 3 times with small delays (AppleScript can be timing-sensitive)
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Try direct AppleScript first
        selectedText = await this.getSelectedTextDirectly();
        
        // If that fails, try clipboard method
        if (!selectedText || selectedText.length < 3) {
          selectedText = await this.getSelectedTextViaClipboard();
        }
        
        // If we got text, break out
        if (selectedText && selectedText.length > 3) {
          if (attempt > 1) {
            console.log(`✅ [SELECTION_DETECTOR] Captured on attempt ${attempt}`);
          }
          break;
        }
        
        // Wait a bit before retrying (50ms)
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      if (selectedText && selectedText.length > 3) {
        console.log(`✅ [SELECTION_DETECTOR] Captured text: "${selectedText.substring(0, 50)}..."`);
        
        // Persist to all renderer windows via localStorage
        const sourceApp = await this.getActiveAppName();
        const selectionData = {
          text: selectedText,
          sourceApp: sourceApp,
          method: 'manual_capture',
          timestamp: Date.now()
        };
        
        // Send to all windows to store in localStorage
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        const selectionJson = JSON.stringify(selectionData);
        windows.forEach(window => {
          if (window && !window.isDestroyed()) {
            window.webContents.executeJavaScript(
              `localStorage.setItem('thinkdrop_captured_selection', '${selectionJson.replace(/'/g, "\\'")}')`
            );
          }
        });
        console.log('💾 [SELECTION_DETECTOR] Selection persisted to localStorage');
        
        // Show floating button
        await this.showFloatingButtonWithPreciseCoordinates(selectedText);
        
        // Notify renderer
        this.notifySelectionAvailable(selectionData);
        
        return selectedText;
      } else {
        console.log('⚠️  [SELECTION_DETECTOR] No text selection found after 3 attempts');
        return null;
      }
      
    } catch (error) {
      console.error('❌ [SELECTION_DETECTOR] Manual capture failed:', error);
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
      `, { 
        encoding: 'utf8', 
        timeout: 500,
        killSignal: 'SIGKILL'
      });
      return result.trim();
    } catch (error) {
      // Silent fail - accessibility issues can cause crashes
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
    await this.showFloatingButtonWithPreciseCoordinates(testText);
    console.log('✅ [SELECTION_DETECTOR] Test button shown');
  }

  /**
   * Get selection with context (expected by main.cjs)
   * Reads from localStorage in the calling window
   */
  async getSelectionWithContext() {
    try {
      // This will be called from IPC handler which has access to the event
      // Return null here - the actual check happens in the renderer via localStorage
      console.log('⚠️  [SELECTION_DETECTOR] getSelectionWithContext called - should use localStorage in renderer');
      
      // SAFETY: Wrap in timeout to prevent hanging
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1000));
      
      // Fallback: try to get current selection with timeout protection
      const selectionPromise = this.getSelectedTextDirectly().catch(() => null);
      const selectedText = await Promise.race([selectionPromise, timeoutPromise]);
      
      if (selectedText && selectedText.length > 3) {
        const appNamePromise = this.getActiveAppName().catch(() => 'Unknown App');
        const appNameTimeout = new Promise((resolve) => setTimeout(() => resolve('Unknown App'), 500));
        const sourceApp = await Promise.race([appNamePromise, appNameTimeout]);
        
        return {
          text: selectedText,
          sourceApp: sourceApp,
          method: 'context_check'
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ [SELECTION_DETECTOR] Failed to get selection with context:', error);
      return null;
    }
  }
  
  /**
   * Clear the persisted selection from localStorage (called after message is sent)
   */
  clearPersistedSelection() {
    console.log('🗑️  [SELECTION_DETECTOR] Clearing persisted selection from localStorage');
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      if (window && !window.isDestroyed()) {
        window.webContents.executeJavaScript(
          `localStorage.removeItem('thinkdrop_captured_selection')`
        );
      }
    });
  }

  /**
   * Capture from previous window (expected by virtualScreenDOM.cjs)
   */
  async captureFromPreviousWindow() {
    console.log('🎯 [SELECTION_DETECTOR] Capturing from previous window');
    return await this.captureSelectionWithNutJS();
  }

  /**
   * Stop all monitoring
   */
  stop() {
    console.log('🛑 [SELECTION_DETECTOR] Stopping selection monitoring');
    
    if (this.selectionCheckInterval) {
      clearInterval(this.selectionCheckInterval);
      this.selectionCheckInterval = null;
    }
    
    this.isActive = false;
    console.log('✅ [SELECTION_DETECTOR] Selection monitoring stopped');
  }
}

// Create singleton instance
let selectionDetectorInstance = null;

/**
 * Get or create the selection detector instance
 */
function getSelectionDetector() {
  if (!selectionDetectorInstance) {
    selectionDetectorInstance = new SelectionDetector();
  }
  return selectionDetectorInstance;
}

module.exports = {
  SelectionDetector,
  getSelectionDetector
};
