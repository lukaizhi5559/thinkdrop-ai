/**
 * Selection Detector Service
 * Detects system-wide text selection for context-aware queries
 * 
 * Phase 1: Clipboard monitoring (non-invasive)
 * Phase 2: Native macOS Accessibility API integration
 */

const { clipboard, systemPreferences } = require('electron');

const logger = require('./../logger.cjs');
class SelectionDetector {
  constructor() {
    this.lastClipboard = '';
    this.lastDetectedText = '';
    this.lastClipboardTime = 0;
    this.clipboardCheckInterval = null;
    this.recentSelectionWindow = 3000; // 3 seconds - consider clipboard "recent" if changed within this window
    
    // Stored selection from background capture
    this.storedSelection = null;
    this.selectionCaptureInterval = null;
    this.lastActiveWindow = null;
  }

  /**
   * Start monitoring clipboard for selection detection
   * AND start background selection capture on window changes
   */
  start() {
    logger.debug('📋 [SELECTION_DETECTOR] Ready for Cmd+A capture');
    
    // Initialize with current clipboard
    this.lastClipboard = clipboard.readText();
    
    // Start monitoring for text selections to show floating button
    this.startSelectionMonitoring();
    
    // 🎯 No automatic monitoring - user triggers with Cmd+Option+A
    // This provides explicit, predictable behavior
    logger.debug('✅ [SELECTION_DETECTOR] Use Cmd+Option+A to capture highlighted text');
  }

  /**
   * Start monitoring for text selections system-wide using nut.js
   * Shows floating button when text is selected
   */
  startSelectionMonitoring() {
    logger.debug('👀 [SELECTION_DETECTOR] Starting nut.js-based selection monitoring');
    
    // Initialize mouse tracking
    this.lastMousePosition = null;
    this.mouseDownTime = null;
    this.isMouseDown = false;
    
    // Start mouse event monitoring with nut.js
    this.startMouseEventMonitoring();
    
    // Also start periodic selection checking as backup
    this.startPeriodicSelectionCheck();
  }

  /**
   * Monitor mouse events to detect text selections using nut.js
   */
  async startMouseEventMonitoring() {
    logger.debug('🖱️  [SELECTION_DETECTOR] Starting nut.js mouse event monitoring for text selection');
    
    try {
      const { mouse, Button } = await import('@nut-tree-fork/nut-js');
      
      // Track mouse state for selection detection
      this.isMousePressed = false;
      this.selectionStartPos = null;
      this.selectionEndPos = null;
      this.lastMousePos = null;
  async handlePotentialSelection() {
    try {
      if (!this.selectionStartPos || !this.selectionEndPos) return;
      
      // Calculate selection area
      const dragDistance = Math.sqrt(
        Math.pow(this.selectionEndPos.x - this.selectionStartPos.x, 2) + 
        Math.pow(this.selectionEndPos.y - this.selectionStartPos.y, 2)
      );
      
      // Only check for selection if there was significant drag (likely text selection)
      if (dragDistance > 20) {
        logger.debug(`🎯 [SELECTION_DETECTOR] Significant drag detected (${Math.round(dragDistance)}px), checking for selected text`);
        
        // Try to get selected text
        const selectedText = await this.getSelectedTextViaAppleScript();
        
        if (selectedText && selectedText.length > 3 && selectedText.length < 2000) {
          // Avoid showing button repeatedly for same selection with debouncing
          const now = Date.now();
          const timeSinceLastShow = now - (this.lastButtonShowTime || 0);
          
          if (selectedText !== this.lastDetectedSelection && timeSinceLastShow > 1000) {
            logger.debug('✨ [SELECTION_DETECTOR] Text selection detected after mouse drag!');
            logger.debug(`📝 [SELECTION_DETECTOR] Selected text: "${selectedText.substring(0, 50)}..."`);
            
            this.lastDetectedSelection = selectedText;
            this.lastButtonShowTime = now;
            
            // Show floating button at the end of selection
            await this.showFloatingButtonAtPosition(
              this.selectionEndPos.x, 
              this.selectionEndPos.y, 
              selectedText
            );
          }
        } else {
          logger.debug('⚠️  [SELECTION_DETECTOR] No text found after drag - might not be text selection');
        }
      }
      
      // Reset selection tracking
      this.selectionStartPos = null;
      this.selectionEndPos = null;
      
    } catch (error) {
      logger.error('❌ [SELECTION_DETECTOR] Error handling potential selection:', error);
    }
  }

  /**
   * Periodic selection check as backup method
   * This catches selections that mouse drag detection might miss
   */
  startPeriodicSelectionCheck() {
    logger.debug('⏰ [SELECTION_DETECTOR] Starting periodic selection check as backup');
    
    this.lastKnownSelection = null;
    
    this.periodicSelectionInterval = setInterval(async () => {
      try {
        const currentSelection = await this.getSelectedTextViaAppleScript();
        
        // Check if selection changed and enough time has passed
        const now = Date.now();
        const timeSinceLastShow = now - (this.lastButtonShowTime || 0);
        
        if (currentSelection && 
            currentSelection.length > 3 && 
            currentSelection.length < 2000 &&
            currentSelection !== this.lastKnownSelection &&
            currentSelection !== this.lastDetectedSelection &&
            timeSinceLastShow > 2000) { // Minimum 2 seconds between shows
          
          logger.debug('🔍 [SELECTION_DETECTOR] New text selection detected via periodic check');
          logger.debug(`📝 [SELECTION_DETECTOR] Selected text: "${currentSelection.substring(0, 50)}..."`);
          
          this.lastKnownSelection = currentSelection;
          this.lastDetectedSelection = currentSelection;
          this.lastButtonShowTime = now;
          
          // Get current mouse position for button placement
          try {
            const { mouse } = await import('@nut-tree-fork/nut-js');
            const mousePos = await mouse.getPosition();
            await this.showFloatingButtonAtPosition(mousePos.x, mousePos.y, currentSelection);
          } catch (error) {
            // Fallback to Electron cursor position
            const { screen } = require('electron');
            const cursorPos = screen.getCursorScreenPoint();
            await this.showFloatingButtonAtPosition(cursorPos.x, cursorPos.y, currentSelection);
          }
        } else if (!currentSelection || currentSelection.length < 3) {
          // Clear last known selection if nothing is selected
          this.lastKnownSelection = null;
        }
        
      } catch (error) {
        // Silent fail to avoid spam
      }
    }, 1000); // Check every 1 second - much less aggressive
  }

  /**
   * Get selected text using AppleScript
   */
  async getSelectedTextViaAppleScript() {
    try {
      const { execSync } = require('child_process');
      
      const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          try
            tell process frontApp
              try
                -- Save original clipboard
                set originalClipboard to the clipboard
                -- Simulate Cmd+C to copy selection
                key code 8 using command down
                delay 0.2
                set newClipboard to the clipboard
                -- Restore original clipboard
                set the clipboard to originalClipboard
                
                if newClipboard is not originalClipboard and newClipboard is not "" then
                  return newClipboard
                end if
              end try
            end tell
          end try
          return ""
        end tell
      `;
      
      const result = execSync(`osascript -e '${script}'`, { 
        encoding: 'utf8',
        timeout: 2000 // 2 second timeout
      }).trim();
      
      return result || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fallback to clipboard monitoring if nut.js fails
   */
  startClipboardFallback() {
    logger.debug('📋 [SELECTION_DETECTOR] Starting clipboard fallback monitoring');
    
    this.lastClipboard = clipboard.readText();
    this.lastClipboardTime = Date.now();
    
    this.clipboardFallbackInterval = setInterval(async () => {
      try {
        const currentClipboard = clipboard.readText();
        const now = Date.now();
        
        if (currentClipboard !== this.lastClipboard && 
            currentClipboard && 
            currentClipboard.trim().length > 3 && 
            currentClipboard.length < 2000 &&
            !currentClipboard.includes('__THINKDROP_TEMP__')) {
          
          const timeSinceChange = now - this.lastClipboardTime;
          
          if (timeSinceChange > 100) {
            logger.debug('✅ [SELECTION_DETECTOR] Selection detected via clipboard (fallback)');
            
            // Get mouse position for button placement
            try {
              const { mouse } = await import('@nut-tree-fork/nut-js');
              const mousePos = await mouse.getPosition();
              await this.showFloatingButtonAtPosition(mousePos.x, mousePos.y, currentClipboard);
            } catch (error) {
              // Use Electron's cursor position as final fallback
              const { screen } = require('electron');
              const cursorPos = screen.getCursorScreenPoint();
              await this.showFloatingButtonAtPosition(cursorPos.x, cursorPos.y, currentClipboard);
            }
          }
          
          this.lastClipboard = currentClipboard;
          this.lastClipboardTime = now;
        }
      } catch (error) {
        logger.error('❌ [SELECTION_DETECTOR] Error in clipboard fallback:', error);
      }
    }, 200);
  }


  /**
   * Show floating button at exact mouse position
   */
  async showFloatingButtonAtPosition(mouseX, mouseY, selectedText) {
    try {
      logger.debug('🎯 [SELECTION_DETECTOR] Showing floating button at exact mouse position');
      logger.debug(`🖱️  [SELECTION_DETECTOR] Mouse position: (${mouseX}, ${mouseY})`);
      
      // Position button slightly below and to the right of mouse
      const buttonX = mouseX + 15;
      const buttonY = mouseY + 25;
      
      logger.debug(`📍 [SELECTION_DETECTOR] Button position: (${buttonX}, ${buttonY})`);
      
      // Show the floating button
      const { showSelectionButton } = require('../windows/selection-overlay.cjs');
      showSelectionButton(buttonX, buttonY, selectedText);
      
      logger.debug(`✅ [SELECTION_DETECTOR] Floating button shown at mouse position (${buttonX}, ${buttonY})`);
      
    } catch (error) {
      logger.error('❌ [SELECTION_DETECTOR] Failed to show floating button:', error);
      logger.error('❌ [SELECTION_DETECTOR] Error details:', error.stack);
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async showFloatingButtonWithEstimatedPosition(selectedText) {
    try {
      // Try to get mouse position with nut.js first
      const { mouse } = await import('@nut-tree-fork/nut-js');
      const mousePos = await mouse.getPosition();
      await this.showFloatingButtonAtPosition(mousePos.x, mousePos.y, selectedText);
    } catch (error) {
      // Fallback to Electron cursor position
      const { screen } = require('electron');
      const cursorPos = screen.getCursorScreenPoint();
      await this.showFloatingButtonAtPosition(cursorPos.x, cursorPos.y, selectedText);
    }
  }
  
  /**
   * Start background selection capture
   * Captures selection when window focus changes
   */
  async startBackgroundCapture() {
    logger.debug('🎯 [SELECTION_DETECTOR] Starting background selection capture');
    
    // Check active window every 300ms for fast detection
    this.selectionCaptureInterval = setInterval(async () => {
      try {
        const windowInfo = await this.getActiveWindowInfo();
        const currentWindow = `${windowInfo.appName}-${windowInfo.windowTitle}`;
        
        // Only act on window changes
        if (currentWindow === this.lastActiveWindow || windowInfo.appName === 'Unknown') {
          return;
        }
        
        logger.debug(`🔄 [SELECTION_DETECTOR] Window changed: ${this.lastActiveWindow} → ${currentWindow}`);
        
        // If previous window was NOT Electron, capture from it
        if (this.lastActiveWindow && 
            this.lastActiveWindow !== 'null-undefined' &&
            !this.lastActiveWindow.startsWith('Electron-')) {
          
          const [prevApp] = this.lastActiveWindow.split('-');
          logger.debug('📸 [SELECTION_DETECTOR] Capturing from previous window:', prevApp);
          await this.captureAndStoreSelection({ 
            appName: prevApp, 
            windowTitle: '' 
          });
        }
        
        this.lastActiveWindow = currentWindow;
        
      } catch (error) {
        // Silent fail - don't spam logs
      }
    }, 300); // Check every 300ms for fast window change detection
  }
  
  /**
   * Capture selection using nut.js (for global shortcut)
   * This preserves and restores the original clipboard
   */
  async captureSelectionWithNutJS() {
    try {
      const { clipboard } = require('electron');
      const { keyboard, Key } = require('@nut-tree-fork/nut-js');
      
      logger.debug('🎯 [NUTJS] Starting selection capture...');
      
      // Store original clipboard FIRST
      const originalClipboard = clipboard.readText();
      logger.debug('💾 [NUTJS] Stored original clipboard');
      
      // Clear clipboard to detect new content
      clipboard.writeText('__THINKDROP_TEMP__');
      
      // Wait a moment for clipboard to clear
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Simulate Cmd+C using nut.js IMMEDIATELY (before window changes)
      logger.debug('⌨️  [NUTJS] Simulating Cmd+C...');
      await keyboard.pressKey(Key.LeftCmd, Key.C);
      await keyboard.releaseKey(Key.LeftCmd, Key.C);
      
      // Wait for clipboard to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get the captured text
      const capturedText = clipboard.readText();
      
      // Restore original clipboard
      clipboard.writeText(originalClipboard);
      logger.debug('🔄 [NUTJS] Restored original clipboard');
      
      // Now get window info (after capture but use a fallback since window might have changed)
      const windowInfo = await this.getActiveWindowInfo();
      const sourceApp = windowInfo.appName === 'Electron' ? 'Previous App' : windowInfo.appName;
      
      // Check if we captured something new
      if (capturedText && capturedText !== '__THINKDROP_TEMP__' && capturedText !== originalClipboard) {
        // Store selection
        this.storedSelection = {
          text: capturedText,
          sourceApp: sourceApp,
          windowTitle: windowInfo.windowTitle,
          capturedAt: Date.now()
        };
        
        logger.debug('✅ [NUTJS] Captured selection:', {
          preview: capturedText.substring(0, 100),
          sourceApp: sourceApp
        });
        
        // Notify renderer
        this.notifySelectionAvailable();
      } else {
        logger.debug('⚠️  [NUTJS] No text selected or no change detected');
      }
      
    } catch (error) {
      logger.error('❌ [NUTJS] Failed to capture selection:', error);
    }
  }

  /**
   * Capture from the previous window (called when Thinkdrop AI gains focus)
   */
  async captureFromPreviousWindow() {
    if (!this.lastActiveWindow || 
        this.lastActiveWindow === 'null-undefined' ||
        this.lastActiveWindow.startsWith('Electron-')) {
      logger.debug('⏭️  [SELECTION_DETECTOR] No valid previous window to capture from');
      return;
    }
    
    const [prevApp] = this.lastActiveWindow.split('-');
    logger.debug('🎯 [SELECTION_DETECTOR] Capturing from previous window on Thinkdrop AI focus:', prevApp);
    await this.captureAndStoreSelection({ 
      appName: prevApp, 
      windowTitle: '' 
    });
  }

  /**
   * Capture selection and store it for later retrieval
   */
  async captureAndStoreSelection(windowInfo) {
    try {
      logger.debug('📸 [SELECTION_DETECTOR] Attempting to capture selection from:', windowInfo.appName);
      
      const selection = await this.captureHighlightedText();
      
      if (selection && selection.text) {
        this.storedSelection = {
          ...selection,
          sourceApp: windowInfo.appName,
          windowTitle: windowInfo.windowTitle,
          capturedAt: Date.now()
        };
        
        logger.debug('✅ [SELECTION_DETECTOR] Stored selection:', {
          preview: this.storedSelection.text.substring(0, 100),
          sourceApp: this.storedSelection.sourceApp,
          age: 0
        });
        
        // Notify renderer that selection is available
        this.notifySelectionAvailable();
      } else {
        // No selection captured - but DON'T clear stored selection yet
        // It will be cleared by getStoredSelection() if too old (30s)
        logger.debug('⏭️  [SELECTION_DETECTOR] No selection found this time - keeping previous stored selection');
      }
    } catch (error) {
      logger.error('❌ [SELECTION_DETECTOR] Failed to capture and store:', error.message);
    }
  }

  /**
   * Notify renderer that selection is available
   */
  notifySelectionAvailable() {
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      
      if (this.storedSelection && windows.length > 0) {
        const selectionData = {
          preview: this.storedSelection.text.substring(0, 100),
          sourceApp: this.storedSelection.sourceApp,
          windowTitle: this.storedSelection.windowTitle,
          fullText: this.storedSelection.text
        };
        
        // Send to all windows
        windows.forEach(win => {
          win.webContents.send('selection:available', selectionData);
        });
        
        logger.debug('📢 [SELECTION_DETECTOR] Notified renderer of available selection');
      }
    } catch (error) {
      logger.error('❌ [SELECTION_DETECTOR] Failed to notify renderer:', error);
    }
  }


  /**
   * Stop monitoring clipboard and background capture
   */
  stop() {
    if (this.clipboardCheckInterval) {
      clearInterval(this.clipboardCheckInterval);
      this.clipboardCheckInterval = null;
      logger.debug('📋 [SELECTION_DETECTOR] Stopped clipboard monitor');
    }
    if (this.selectionCaptureInterval) {
      clearInterval(this.selectionCaptureInterval);
      this.selectionCaptureInterval = null;
      logger.debug('🎯 [SELECTION_DETECTOR] Stopped background capture');
    }
    if (this.selectionMonitorInterval) {
      clearInterval(this.selectionMonitorInterval);
      this.selectionMonitorInterval = null;
      logger.debug('👀 [SELECTION_DETECTOR] Stopped selection monitoring');
    }
    if (this.activeSelectionInterval) {
      clearInterval(this.activeSelectionInterval);
      this.activeSelectionInterval = null;
      logger.debug('🎯 [SELECTION_DETECTOR] Stopped active selection monitoring');
    }
    if (this.mouseMonitorInterval) {
      clearInterval(this.mouseMonitorInterval);
      this.mouseMonitorInterval = null;
      logger.debug('🖱️  [SELECTION_DETECTOR] Stopped mouse monitoring');
    }
    if (this.clipboardFallbackInterval) {
      clearInterval(this.clipboardFallbackInterval);
      this.clipboardFallbackInterval = null;
      logger.debug('📋 [SELECTION_DETECTOR] Stopped clipboard fallback monitoring');
    }
    if (this.periodicSelectionInterval) {
      clearInterval(this.periodicSelectionInterval);
      this.periodicSelectionInterval = null;
      logger.debug('⏰ [SELECTION_DETECTOR] Stopped periodic selection check');
    }
  }
  
  /**
   * Get stored selection (captured in background)
   * Returns null if no selection or too old (> 30 seconds)
   */
  getStoredSelection() {
    if (!this.storedSelection) {
      return null;
    }
    
    const age = Date.now() - this.storedSelection.capturedAt;
    const maxAge = 60000; // 30 seconds
    
    if (age > maxAge) {
      logger.debug('⏰ [SELECTION_DETECTOR] Stored selection too old, discarding');
      this.storedSelection = null;
      return null;
    }
    
    logger.debug('✅ [SELECTION_DETECTOR] Retrieved stored selection:', {
      preview: this.storedSelection.text.substring(0, 100),
      age: Math.round(age / 1000) + 's'
    });
    
    return this.storedSelection;
  }
  
  /**
   * Clear stored selection
   */
  clearStoredSelection() {
    this.storedSelection = null;
    logger.debug('🗑️  [SELECTION_DETECTOR] Cleared stored selection');
  }

  /**
   * Check if accessibility permissions are granted
   */
  hasAccessibilityPermissions() {
    try {
      return systemPreferences.isTrustedAccessibilityClient(false);
    } catch (error) {
      logger.warn('⚠️  [SELECTION_DETECTOR] Could not check accessibility permissions:', error);
      return false;
    }
  }

  /**
   * Capture currently highlighted text by simulating Cmd+C
   * Preserves user's original clipboard content
   * Works in ALL apps including IDEs
   */
  async captureHighlightedText() {
    try {
      logger.debug('📋 [SELECTION_DETECTOR] Starting capture...');
      const { keyboard, Key } = require('@nut-tree-fork/nut-js');
      
      // 1. Save current clipboard
      const originalClipboard = clipboard.readText();
      logger.debug('📋 [SELECTION_DETECTOR] Original clipboard:', originalClipboard?.substring(0, 50) || '(empty)');
      
      // 2. Clear clipboard to detect if anything is selected
      clipboard.writeText('__THINKDROP_TEMP__');
      logger.debug('📋 [SELECTION_DETECTOR] Clipboard cleared');
      
      // 3. Simulate Cmd+C to copy highlighted text
      // Small delay to ensure clipboard is cleared
      await new Promise(resolve => setTimeout(resolve, 100));
      
      logger.debug('📋 [SELECTION_DETECTOR] Simulating Cmd+C...');
      // Use nut.js for reliable key simulation (already installed!)
      await keyboard.pressKey(Key.LeftSuper); // Command key on Mac
      await keyboard.pressKey(Key.C);
      await keyboard.releaseKey(Key.C);
      await keyboard.releaseKey(Key.LeftSuper);
      logger.debug('📋 [SELECTION_DETECTOR] Cmd+C simulated');
      
      // 4. Wait for clipboard to update
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // 5. Read the newly copied text
      const highlightedText = clipboard.readText();
      logger.debug('📋 [SELECTION_DETECTOR] New clipboard:', highlightedText?.substring(0, 50) || '(empty)');
      
      // 6. Restore original clipboard immediately
      clipboard.writeText(originalClipboard);
      logger.debug('📋 [SELECTION_DETECTOR] Restored original clipboard');
      
      // 7. Check if we actually captured something new
      if (highlightedText && 
          highlightedText !== '' && 
          highlightedText !== '__THINKDROP_TEMP__' &&
          highlightedText !== originalClipboard) {
        logger.debug('✅ [SELECTION_DETECTOR] Captured highlighted text:', highlightedText.substring(0, 100));
        return {
          text: highlightedText.trim(),
          timestamp: Date.now(),
          age: 0,
          method: 'capture'
        };
      }
      
      logger.debug('⚠️  [SELECTION_DETECTOR] No highlighted text detected');
      return null;
      
    } catch (error) {
      logger.error('❌ [SELECTION_DETECTOR] Failed to capture highlighted text:', error);
      logger.error('❌ [SELECTION_DETECTOR] Error stack:', error.stack);
      return null;
    }
  }
  
  /**
   * Get recently selected text (if clipboard changed within recent window)
   * Returns null if no recent selection detected
   * FALLBACK METHOD - prefer captureHighlightedText()
   */
  getRecentSelection() {
    const timeSinceClipboardChange = Date.now() - this.lastClipboardTime;
    
    // If clipboard changed recently, consider it a selection
    if (timeSinceClipboardChange < this.recentSelectionWindow) {
      const text = this.lastClipboard.trim();
      
      // Only return if text is meaningful (not empty, not too long)
      if (text.length > 0 && text.length < 10000) {
        logger.debug(`📋 [SELECTION_DETECTOR] Recent selection detected (${timeSinceClipboardChange}ms ago):`, text.substring(0, 100));
        return {
          text,
          timestamp: this.lastClipboardTime,
          age: timeSinceClipboardChange,
          method: 'clipboard'
        };
      }
    }
    
    return null;
  }


  /**
   * Get active window information (app name and window title)
   * Uses AppleScript to get frontmost app info
   */
  async getActiveWindowInfo() {
    try {
      const { execSync } = require('child_process');
      
      // Get frontmost app name and window title
      const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          set windowTitle to ""
          try
            tell process frontApp
              set windowTitle to name of front window
            end tell
          end try
          return frontApp & "|" & windowTitle
        end tell
      `;
      
      const result = execSync(`osascript -e '${script}'`, { encoding: 'utf8' }).trim();
      const [appName, windowTitle] = result.split('|');
      
      return {
        appName: appName || 'Unknown',
        windowTitle: windowTitle || ''
      };
    } catch (error) {
      logger.warn('⚠️  [SELECTION_DETECTOR] Could not get active window info:', error);
      return {
        appName: 'Unknown',
        windowTitle: ''
      };
    }
  }

  /**
   * Get selection with full context (text + source app + window title)
   * PRIMARY METHOD: Check stored selection from background capture
   */
  async getSelectionWithContext() {
    // 🎯 FIRST: Check if we have a stored selection from background capture
    let selection = this.getStoredSelection();
    
    if (selection) {
      logger.debug('✅ [SELECTION_DETECTOR] Using stored selection from background capture');
      return {
        text: selection.text,
        timestamp: selection.capturedAt,
        age: Date.now() - selection.capturedAt,
        method: 'background',
        sourceApp: selection.sourceApp,
        windowTitle: selection.windowTitle,
        hasContext: true
      };
    }
    
    // Fallback 1: Try to capture highlighted text directly (if still in same window)
    selection = await this.captureHighlightedText();
    
    // Fallback 2: Check if user manually copied recently
    if (!selection) {
      selection = this.getRecentSelection();
    }
    
    if (!selection) {
      return null;
    }
    
    // Get window context for fallback methods
    const windowInfo = await this.getActiveWindowInfo();
    
    return {
      text: selection.text,
      timestamp: selection.timestamp,
      age: selection.age,
      method: selection.method, // 'capture' or 'clipboard'
      sourceApp: windowInfo.appName,
      windowTitle: windowInfo.windowTitle,
      hasContext: true
    };
  }

  /**
   * Format selection context for display in UI
   */
  formatSelectionPreview(selection) {
    if (!selection) return null;
    
    const preview = selection.text.length > 50 
      ? selection.text.substring(0, 50) + '...' 
      : selection.text;
    
    let context = '';
    if (selection.sourceApp && selection.sourceApp !== 'Unknown') {
      context = ` from ${selection.sourceApp}`;
      if (selection.windowTitle) {
        context += ` - ${selection.windowTitle}`;
      }
    }
    
    return {
      preview,
      context,
      fullText: selection.text
    };
  }
}

// Singleton instance
let instance = null;

function getSelectionDetector() {
  if (!instance) {
    instance = new SelectionDetector();
  }
  return instance;
}

module.exports = {
  SelectionDetector,
  getSelectionDetector
};
