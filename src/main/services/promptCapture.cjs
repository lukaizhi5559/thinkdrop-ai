const { clipboard } = require('electron');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// 🎯 CONFIG: Choose submission method
// 'overlay' - Send to overlay/App.tsx via IPC (current flow with UI)
// 'mcp' - Send directly to MCP service (like promptedAnywhere, no UI)
const SUBMIT_MODE = 'overlay'; // Change to 'mcp' to test direct MCP submission

class PromptCaptureService {
  constructor(logger, keyHookBridge, mcpClient = null) {
    this.logger = logger;
    this.keyHookBridge = keyHookBridge;
    this.mcpClient = mcpClient;
    this.isActive = false;
    this.promptBuffer = '';
    this.initialText = '';
    this.overlayWindow = null;
    this.cursorPosition = null;
    this.textCursorPos = 0; // Cursor position in text
    this.selectionStart = 0; // Selection start
    this.selectionEnd = 0; // Selection end
    
    this.setupKeyHookListeners();
  }

  setOverlayWindow(window) {
    this.overlayWindow = window;
  }

  setupKeyHookListeners() {
    this.keyHookBridge.on('keyEvent', (event) => {
      if (!this.isActive) return;
      
      this.handleKeyEvent(event);
    });

    this.keyHookBridge.on('captureStarted', () => {
      this.logger.info('[PromptCapture] Native capture started');
    });

    this.keyHookBridge.on('captureStopped', () => {
      this.logger.info('[PromptCapture] Native capture stopped');
    });

    this.keyHookBridge.on('error', (error) => {
      this.logger.error('[PromptCapture] KeyHook error:', error);
      this.cancel();
    });
  }

  async activate() {
    if (this.isActive) {
      this.logger.warn('[PromptCapture] Already active, toggling off');
      this.cancel();
      return;
    }

    this.logger.info('[PromptCapture] Activating...');

    const highlightedText = await this.captureHighlightedText();
    
    if (highlightedText) {
      this.initialText = highlightedText;
      this.promptBuffer = highlightedText;
      this.textCursorPos = highlightedText.length;
      this.selectionStart = highlightedText.length; // Cursor at end, no selection
      this.selectionEnd = highlightedText.length;
      this.logger.info(`[PromptCapture] Captured highlighted text: ${highlightedText.substring(0, 50)}...`);
    } else {
      this.initialText = '';
      this.promptBuffer = '';
      this.textCursorPos = 0;
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.logger.info('[PromptCapture] No highlighted text');
    }

    this.cursorPosition = await this.getCursorPosition();
    
    this.isActive = true;
    
    this.keyHookBridge.startCapture();
    
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('prompt-capture-started', {
        initialText: this.promptBuffer,
        cursorPosition: this.cursorPosition
      });
      
      // Show results window (fixed at bottom-right)
      const { ipcMain } = require('electron');
      ipcMain.emit('prompt-capture:show-results');
    }

    this.logger.info('[PromptCapture] Activated successfully');
  }

  handleKeyEvent(event) {
    if (!this.isActive) return;

    const { key, modifiers } = event;
    const hasShift = modifiers.includes('shift');
    const hasCmd = modifiers.includes('cmd') || modifiers.includes('meta');

    // Log key events for debugging
    this.logger.debug(`[PromptCapture] Key: "${key}" (code: ${key.charCodeAt(0)}), modifiers: ${modifiers.join(',')}`);

    // Escape - cancel
    if (key === '\u{1B}') {
      this.cancel();
      return;
    }

    // Cmd+A - select all
    if (hasCmd && (key === 'a' || key === 'A')) {
      this.logger.info('[PromptCapture] Cmd+A detected - selecting all text');
      this.selectionStart = 0;
      this.selectionEnd = this.promptBuffer.length;
      this.textCursorPos = this.promptBuffer.length;
      this.updateOverlay();
      return;
    }

    // Enter
    if (key === '\n') {
      if (hasShift) {
        this.insertText('\n');
      } else {
        this.submit();
      }
      return;
    }

    // Backspace
    if (key === '\u{08}') {
      this.handleBackspace();
      return;
    }

    // Arrow keys - check multiple possible codes
    const keyCode = key.charCodeAt(0);
    if (key === '\u{F702}' || keyCode === 63234) { // Left arrow
      this.logger.debug('[PromptCapture] Left arrow detected');
      this.handleArrowKey('left', hasShift);
      return;
    }
    if (key === '\u{F703}' || keyCode === 63235) { // Right arrow
      this.logger.debug('[PromptCapture] Right arrow detected');
      this.handleArrowKey('right', hasShift);
      return;
    }
    if (key === '\u{F700}' || keyCode === 63232) { // Up arrow
      this.logger.debug('[PromptCapture] Up arrow detected (ignored)');
      return;
    }
    if (key === '\u{F701}' || keyCode === 63233) { // Down arrow
      this.logger.debug('[PromptCapture] Down arrow detected (ignored)');
      return;
    }

    // Regular character input
    if (key && key.length === 1 && !hasCmd) {
      this.insertText(key);
    }
  }

  insertText(text) {
    // Delete selection if exists
    if (this.selectionStart !== this.selectionEnd) {
      const start = Math.min(this.selectionStart, this.selectionEnd);
      const end = Math.max(this.selectionStart, this.selectionEnd);
      this.promptBuffer = this.promptBuffer.slice(0, start) + this.promptBuffer.slice(end);
      this.textCursorPos = start;
      this.selectionStart = start;
      this.selectionEnd = start;
    }

    // Insert text at cursor
    this.promptBuffer = 
      this.promptBuffer.slice(0, this.textCursorPos) + 
      text + 
      this.promptBuffer.slice(this.textCursorPos);
    this.textCursorPos += text.length;
    this.selectionStart = this.textCursorPos;
    this.selectionEnd = this.textCursorPos;
    this.updateOverlay();
  }

  handleBackspace() {
    if (this.selectionStart !== this.selectionEnd) {
      // Delete selection
      const start = Math.min(this.selectionStart, this.selectionEnd);
      const end = Math.max(this.selectionStart, this.selectionEnd);
      this.promptBuffer = this.promptBuffer.slice(0, start) + this.promptBuffer.slice(end);
      this.textCursorPos = start;
      this.selectionStart = start;
      this.selectionEnd = start;
    } else if (this.textCursorPos > 0) {
      // Delete character before cursor
      this.promptBuffer = 
        this.promptBuffer.slice(0, this.textCursorPos - 1) + 
        this.promptBuffer.slice(this.textCursorPos);
      this.textCursorPos--;
      this.selectionStart = this.textCursorPos;
      this.selectionEnd = this.textCursorPos;
    }
    this.updateOverlay();
  }

  handleArrowKey(direction, withShift) {
    if (direction === 'left') {
      if (withShift) {
        // Extend selection left
        if (this.textCursorPos > 0) {
          this.textCursorPos--;
          this.selectionEnd = this.textCursorPos;
        }
      } else {
        // Move cursor left (clear selection)
        if (this.selectionStart !== this.selectionEnd) {
          this.textCursorPos = Math.min(this.selectionStart, this.selectionEnd);
        } else if (this.textCursorPos > 0) {
          this.textCursorPos--;
        }
        this.selectionStart = this.textCursorPos;
        this.selectionEnd = this.textCursorPos;
      }
    } else if (direction === 'right') {
      if (withShift) {
        // Extend selection right
        if (this.textCursorPos < this.promptBuffer.length) {
          this.textCursorPos++;
          this.selectionEnd = this.textCursorPos;
        }
      } else {
        // Move cursor right (clear selection)
        if (this.selectionStart !== this.selectionEnd) {
          this.textCursorPos = Math.max(this.selectionStart, this.selectionEnd);
        } else if (this.textCursorPos < this.promptBuffer.length) {
          this.textCursorPos++;
        }
        this.selectionStart = this.textCursorPos;
        this.selectionEnd = this.textCursorPos;
      }
    }
    this.updateOverlay();
  }

  updateOverlay() {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('prompt-capture-update', {
        text: this.promptBuffer,
        cursorPos: this.textCursorPos,
        selectionStart: Math.min(this.selectionStart, this.selectionEnd),
        selectionEnd: Math.max(this.selectionStart, this.selectionEnd)
      });
    }
  }

  async submit() {
    if (!this.isActive) return;

    const finalPrompt = this.promptBuffer.trim();
    
    this.logger.info(`[PromptCapture] Submitting prompt (mode: ${SUBMIT_MODE}): ${finalPrompt.substring(0, 100)}...`);

    // Choose submission method based on config
    if (SUBMIT_MODE === 'mcp') {
      // Direct to MCP service (like promptedAnywhere)
      this.logger.info('[PromptCapture] 🚀 Sending directly to MCP service...');
      
      // Stop capture and deactivate for MCP mode
      this.keyHookBridge.stopCapture();
      this.isActive = false;
      
      // Close the overlay UI first
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send('prompt-capture-cancelled');
      }
      
      // Then send to MCP service
      await this.sendToMCPService(finalPrompt);
    } else {
      // Via IPC to overlay/App.tsx (current flow)
      this.logger.info('[PromptCapture] 📤 Sending to overlay via IPC...');
      
      // Keep capture active and listening - just clear the buffer for new input
      // This allows user to immediately type a new query while results are showing
      this.logger.info('[PromptCapture] ✨ Keeping prompt capture active for next query');
      
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send('prompt-capture-submit', {
          text: finalPrompt
        });
      }
    }

    // Clear buffer and reset state for new input (but keep isActive true in overlay mode)
    this.promptBuffer = '';
    this.initialText = '';
    this.textCursorPos = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    
    // Update overlay to show empty prompt box (ready for new input)
    this.updateOverlay();
  }

  cancel() {
    if (!this.isActive) return;

    this.logger.info('[PromptCapture] Cancelling');

    this.keyHookBridge.stopCapture();
    this.isActive = false;

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      // Temporarily disable click-through to send IPC reliably
      try {
        this.overlayWindow.setIgnoreMouseEvents(false);
        this.overlayWindow.webContents.send('prompt-capture-cancelled');
        this.logger.debug('[PromptCapture] Sent cancellation via native IPC');
        
        // Hide results window
        // const { ipcMain } = require('electron');
        // ipcMain.emit('prompt-capture:hide-results');
        
        // Re-enable click-through
        setImmediate(() => {
          if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
          }
        });
      } catch (err) {
        this.logger.error('[PromptCapture] Failed to send cancellation:', err);
        // Ensure click-through is restored
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
        }
      }
    }

    this.promptBuffer = '';
    this.initialText = '';
    this.textCursorPos = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  async captureHighlightedText() {
    try {
      const previousClipboard = clipboard.readText();

      const marker = `__THINKDROP_CAPTURE_${Date.now()}__`;
      clipboard.writeText(marker);

      await new Promise(resolve => setTimeout(resolve, 150));

      const copyCommand = process.platform === 'darwin'
        ? 'osascript -e \'tell application "System Events" to keystroke "c" using command down\''
        : process.platform === 'win32'
        ? 'powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'\^c\')"'
        : 'xdotool key ctrl+c';

      await execAsync(copyCommand);

      await new Promise(resolve => setTimeout(resolve, 500));

      const copiedText = clipboard.readText();

      if (!copiedText || copiedText === marker || copiedText === previousClipboard) {
        clipboard.writeText(previousClipboard);
        return null;
      }

      setTimeout(() => {
        clipboard.writeText(previousClipboard);
      }, 5000);

      return copiedText;

    } catch (error) {
      this.logger.error('[PromptCapture] Failed to capture highlighted text:', error);
      return null;
    }
  }

  async getCursorPosition() {
    try {
      const { screen } = require('electron');
      const point = screen.getCursorScreenPoint();
      return { x: point.x, y: point.y };
    } catch (error) {
      this.logger.error('[PromptCapture] Failed to get cursor position:', error);
      return { x: 0, y: 0 };
    }
  }

  /**
   * Send prompt directly to MCP command service
   * Similar to promptedAnywhere.cjs -> sendToMCPService()
   * @param {string} prompt - The captured prompt text
   * @returns {Promise<Object>} MCP response
   */
  async sendToMCPService(prompt) {
    try {
      if (!this.mcpClient) {
        this.logger.error('[PromptCapture] ❌ MCP client not available. Cannot send to MCP service.');
        this.logger.error('[PromptCapture] 💡 Tip: Pass mcpClient to PromptCaptureService constructor in main.cjs');
        return {
          success: false,
          error: 'MCP client not initialized'
        };
      }

      this.logger.debug('[PromptCapture] 📤 Sending to MCP command service...');

      // Send to MCP service via MCP client
      // Use callService(serviceName, action, payload)
      const response = await this.mcpClient.callService(
        'command',
        'command.prompt-anywhere',
        {
          text: prompt,
          screenshot: null, // No screenshot in prompt capture mode
          context: {
            os: process.platform,
            timestamp: Date.now(),
            source: 'prompt-capture'
          }
        },
        { timeout: 120000 } // 120 second timeout
      );

      this.logger.info('[PromptCapture] ✅ MCP service responded successfully');
      return response;

    } catch (error) {
      this.logger.error('[PromptCapture] ❌ MCP request failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { PromptCaptureService };
