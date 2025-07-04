/**
 * UI Indexer Daemon - Persistent background service for mapping actionable UI elements
 * Supports macOS (AXObserver), Windows (UIAutomationClient), Linux (xdotool)
 * Records UI elements to bibscrip-backend for visual automation
 */

const { EventEmitter } = require('events');
const { execSync } = require('child_process');
const axios = require('axios');

// UI Element interface matching backend schema
class UIElement {
  constructor(data) {
    this.id = data.id;
    this.appName = data.appName;
    this.windowTitle = data.windowTitle;
    this.elementRole = data.elementRole;
    this.elementLabel = data.elementLabel;
    this.elementValue = data.elementValue || '';
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
    this.accessibilityId = data.accessibilityId || '';
    this.className = data.className || '';
    this.automationId = data.automationId || '';
    this.isEnabled = data.isEnabled !== false;
    this.isVisible = data.isVisible !== false;
    this.confidenceScore = data.confidenceScore || 0.5;
    this.lastSeen = data.lastSeen || new Date();
  }
}

// Platform-specific UI scanning interface
class PlatformScanner {
  async scanActiveWindows() { throw new Error('Not implemented'); }
  async getActiveApplication() { throw new Error('Not implemented'); }
  async initialize() { throw new Error('Not implemented'); }
  async cleanup() { throw new Error('Not implemented'); }
}

// macOS Scanner using Accessibility API
class MacOSScanner extends PlatformScanner {
  constructor() {
    super();
    this.axObserver = null;
  }

  async initialize() {
    try {
      // Check if accessibility permissions are granted
      const result = execSync('osascript -e "tell application \\"System Events\\" to get name of every process"', { encoding: 'utf8' });
      console.log('✅ macOS Accessibility API initialized successfully');
    } catch (error) {
      console.error('❌ macOS Accessibility permissions required:', error);
      throw new Error('Accessibility permissions required for UI indexing');
    }
  }

  async getActiveApplication() {
    try {
      // Get active application name
      const appScript = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          return frontApp
        end tell
      `;
      const appName = execSync(`osascript -e '${appScript}'`, { encoding: 'utf8' }).trim();
      
      // Get active window title
      const windowScript = `
        tell application "System Events"
          tell process "${appName}"
            try
              set windowTitle to name of front window
              return windowTitle
            on error
              return ""
            end try
          end tell
        end tell
      `;
      const windowTitle = execSync(`osascript -e '${windowScript}'`, { encoding: 'utf8' }).trim();
      
      return { name: appName, windowTitle };
    } catch (error) {
      console.error('❌ Failed to get active application:', error);
      return { name: 'Unknown', windowTitle: 'Unknown' };
    }
  }

  mapRoleToClassName(role) {
    const roleMap = {
      'button': 'NSButton',
      'text field': 'NSTextField',
      'static text': 'NSTextField',
      'image': 'NSImageView',
      'menu': 'NSMenu',
      'menu item': 'NSMenuItem',
      'window': 'NSWindow',
      'group': 'NSView',
      'scroll area': 'NSScrollView',
      'table': 'NSTableView',
      'outline': 'NSOutlineView',
      'tab group': 'NSTabView',
      'checkbox': 'NSButton',
      'radio button': 'NSButton',
      'slider': 'NSSlider',
      'progress indicator': 'NSProgressIndicator',
      'text area': 'NSTextView',
      'combo box': 'NSComboBox',
      'pop up button': 'NSPopUpButton',
      'toolbar': 'NSToolbar',
      'split group': 'NSSplitView'
    };
    
    return roleMap[role.toLowerCase()] || 'NSView';
  }

  calculateConfidenceScore(role, title, value) {
    let score = 0.5; // Base score
    
    // Higher confidence for interactive elements
    const interactiveRoles = ['button', 'text field', 'checkbox', 'radio button', 'menu item', 'combo box'];
    if (interactiveRoles.includes(role.toLowerCase())) {
      score += 0.3;
    }
    
    // Higher confidence if element has a title/label
    if (title && title.trim().length > 0) {
      score += 0.2;
    }
    
    // Higher confidence if element has a value
    if (value && value.trim().length > 0) {
      score += 0.1;
    }
    
    return Math.min(score, 1.0);
  }

  isRelevantElement(element) {
    // Skip elements that are too small
    if (element.width < 5 || element.height < 5) {
      return false;
    }
    
    // Skip invisible elements
    if (!element.isVisible) {
      return false;
    }
    
    // Include all potentially interactive elements
    const interactiveRoles = [
      'button', 'text field', 'checkbox', 'radio button', 'menu item', 
      'combo box', 'slider', 'tab', 'link', 'pop up button',
      'AXButton', 'AXTextField', 'AXCheckBox', 'AXRadioButton', 'AXMenuItem',
      'AXComboBox', 'AXSlider', 'AXTab', 'AXLink', 'AXPopUpButton',
      'AXTextArea', 'AXSearchField', 'AXSecureTextField', 'AXTable', 'AXOutline',
      'AXList', 'AXScrollBar', 'AXSplitter', 'AXToolbar', 'AXTabGroup'
    ];
    
    const roleToCheck = element.elementRole.toLowerCase();
    if (interactiveRoles.some(role => roleToCheck.includes(role.toLowerCase()))) {
      return true;
    }
    
    // Include informative elements
    const informativeRoles = [
      'static text', 'image', 'heading', 'text', 'label',
      'AXStaticText', 'AXImage', 'AXHeading', 'AXText', 'AXLabel'
    ];
    if (informativeRoles.some(role => roleToCheck.includes(role.toLowerCase()))) {
      if (element.elementLabel.length > 0 || 
          (element.elementValue && element.elementValue.length > 0) ||
          (element.width > 20 && element.height > 10)) {
        return true;
      }
    }
    
    // Include containers
    const containerRoles = [
      'group', 'window', 'dialog', 'sheet', 'scroll area', 'split group',
      'AXGroup', 'AXWindow', 'AXDialog', 'AXSheet', 'AXScrollArea', 'AXSplitGroup',
      'AXApplication', 'AXWebArea', 'AXGenericElement'
    ];
    if (containerRoles.some(role => roleToCheck.includes(role.toLowerCase()))) {
      if (element.width > 50 && element.height > 20) {
        return true;
      }
    }
    
    // Catch-all: include any element with meaningful content
    if ((element.elementLabel && element.elementLabel.length > 2) ||
        (element.elementValue && element.elementValue.length > 2) ||
        (element.width > 100 && element.height > 30)) {
      return true;
    }
    
    return false;
  }

  async scanActiveWindows() {
    const elements = [];
    
    try {
      // Get the active application
      const activeApp = await this.getActiveApplication();
      if (!activeApp || activeApp.name === 'Unknown') {
        console.warn('⚠️ No active application found');
        return elements;
      }
      
      console.log(`🔍 Scanning UI elements for: ${activeApp.name} - ${activeApp.windowTitle}`);
      
      // Enhanced AppleScript with better element detection
      const uiScript = `
        tell application "System Events"
          tell process "${activeApp.name}"
            try
              set frontWindow to front window
              set resultString to ""
              
              -- Process all UI elements in the front window
              try
                set windowElements to UI elements of frontWindow
                repeat with windowElement in windowElements
                  try
                    set elementRole to "unknown"
                    set elementTitle to ""
                    set elementValue to ""
                    set elementDescription to ""
                    set elementPos to {0, 0}
                    set elementSz to {10, 10}
                    set isEnabled to true
                    set isVisible to true
                    set elementHelp to ""
                    
                    -- Safely get all available properties
                    try
                      set elementRole to role of windowElement
                    end try
                    try
                      set elementTitle to title of windowElement
                    end try
                    try
                      set elementValue to value of windowElement as string
                    end try
                    try
                      set elementDescription to description of windowElement
                    end try
                    try
                      set elementPos to position of windowElement
                    end try
                    try
                      set elementSz to size of windowElement
                    end try
                    try
                      set isEnabled to enabled of windowElement
                    end try
                    try
                      set isVisible to (position of windowElement is not missing value)
                    end try
                    try
                      set elementHelp to help of windowElement
                    end try
                    
                    -- Combine all text content
                    set combinedText to elementTitle & "|" & elementValue & "|" & elementDescription & "|" & elementHelp
                    
                    -- Format as structured string
                    set elementData to "ELEMENT:" & elementRole & ":" & combinedText & ":" & (item 1 of elementPos) & "," & (item 2 of elementPos) & ":" & (item 1 of elementSz) & "," & (item 2 of elementSz) & ":" & isEnabled & ":" & isVisible
                    set resultString to resultString & elementData & "\n"
                    
                    -- Process child elements for containers
                    if elementRole contains "group" or elementRole contains "scroll" or elementRole contains "tab" then
                      try
                        set childElements to UI elements of windowElement
                        repeat with childElement in childElements
                          try
                            set childRole to role of childElement
                            set childTitle to ""
                            set childValue to ""
                            set childPos to {0, 0}
                            set childSz to {10, 10}
                            
                            try
                              set childTitle to title of childElement
                            end try
                            try
                              set childValue to value of childElement as string
                            end try
                            try
                              set childPos to position of childElement
                            end try
                            try
                              set childSz to size of childElement
                            end try
                            
                            set childCombinedText to childTitle & "|" & childValue & "|||"
                            set childData to "ELEMENT:" & childRole & ":" & childCombinedText & ":" & (item 1 of childPos) & "," & (item 2 of childPos) & ":" & (item 1 of childSz) & "," & (item 2 of childSz) & ":true:true"
                            set resultString to resultString & childData & "\n"
                          end try
                        end repeat
                      end try
                    end if
                    
                  on error
                    -- Skip problematic elements
                  end try
                end repeat
              end try
              
              return resultString
              
            on error windowError
              return "ERROR: " & windowError
            end try
          end tell
        end tell
      `;
      
      console.log('🔄 Executing AppleScript for UI scanning...');
      
      const result = execSync(`osascript -e '${uiScript}'`, { 
        encoding: 'utf8',
        timeout: 15000, // 15 second timeout
        maxBuffer: 2 * 1024 * 1024 // 2MB buffer
      });
      
      console.log(`📊 AppleScript result length: ${result.length} characters`);
      
      // Parse AppleScript result
      if (result.startsWith('ERROR:')) {
        console.error('❌ AppleScript execution error:', result);
        return elements;
      }
      
      if (!result.trim()) {
        console.warn('⚠️ AppleScript returned empty result');
        return elements;
      }
      
      const lines = result.split('\n').filter(line => line.trim() && line.startsWith('ELEMENT:'));
      console.log(`🔍 Processing ${lines.length} UI element lines`);
      
      for (const line of lines) {
        try {
          // Parse format: ELEMENT:role:combinedText:x,y:width,height:enabled:visible
          const parts = line.substring(8).split(':'); // Remove 'ELEMENT:' prefix
          
          if (parts.length < 2) {
            continue;
          }
          
          const role = parts[0] || 'unknown';
          const combinedText = parts[1] || '';
          
          // Parse combined text: title|value|description|help
          const textParts = combinedText.split('|');
          const title = textParts[0] === 'missing value' ? '' : (textParts[0] || '');
          const value = textParts[1] === 'missing value' ? '' : (textParts[1] || '');
          const description = textParts[2] === 'missing value' ? '' : (textParts[2] || '');
          const help = textParts[3] === 'missing value' ? '' : (textParts[3] || '');
          
          // Handle coordinate parsing
          let x = 0, y = 0, width = 100, height = 30;
          let enabledStr = 'true', visibleStr = 'true';
          
          if (parts.length >= 4) {
            const positionStr = parts[2] || '0,0';
            const sizeStr = parts[3] || '100,30';
            
            if (positionStr !== 'missing value' && positionStr.includes(',')) {
              try {
                const [xStr, yStr] = positionStr.split(',');
                const parsedX = parseInt(xStr, 10);
                const parsedY = parseInt(yStr, 10);
                if (!isNaN(parsedX) && !isNaN(parsedY)) {
                  x = parsedX;
                  y = parsedY;
                }
              } catch (e) {
                console.debug('Failed to parse position:', positionStr);
              }
            }
            
            if (sizeStr !== 'missing value' && sizeStr.includes(',')) {
              try {
                const [widthStr, heightStr] = sizeStr.split(',');
                const parsedWidth = parseInt(widthStr, 10);
                const parsedHeight = parseInt(heightStr, 10);
                if (!isNaN(parsedWidth) && !isNaN(parsedHeight) && parsedWidth > 0 && parsedHeight > 0) {
                  width = parsedWidth;
                  height = parsedHeight;
                }
              } catch (e) {
                console.debug('Failed to parse size:', sizeStr);
              }
            }
          }
          
          if (parts.length >= 5 && parts[4] !== 'missing value') {
            enabledStr = parts[4];
          }
          if (parts.length >= 6 && parts[5] !== 'missing value') {
            visibleStr = parts[5];
          }
            
          // Skip elements with invalid coordinates
          if (x < 0 || y < 0 || width <= 0 || height <= 0) {
            continue;
          }
          
          // Create UIElement
          const bestLabel = title || description || help || value || 'unlabeled';
          const element = new UIElement({
            appName: activeApp.name,
            windowTitle: activeApp.windowTitle,
            elementRole: role || 'unknown',
            elementLabel: bestLabel,
            elementValue: value || description || help || '',
            x,
            y,
            width,
            height,
            accessibilityId: `${activeApp.name}_${role}_${x}_${y}`,
            className: this.mapRoleToClassName(role),
            automationId: `${role}_${bestLabel.substring(0, 20)}_${elements.length}`,
            isEnabled: enabledStr === 'true',
            isVisible: visibleStr === 'true',
            confidenceScore: this.calculateConfidenceScore(role, bestLabel, value || description),
            lastSeen: new Date()
          });
          
          // Only include relevant interactive elements
          if (this.isRelevantElement(element)) {
            elements.push(element);
            console.log(`✅ Added UI element: ${role} "${title}" at (${x},${y})`);
          }
        } catch (error) {
          console.debug('Failed to parse UI element line:', error.message);
        }
      }
      
      console.log(`✅ Successfully scanned ${elements.length} relevant UI elements from ${activeApp.name}`);
      
    } catch (error) {
      console.error('❌ Failed to scan active windows:', error.message);
    }
    
    return elements;
  }

  async cleanup() {
    if (this.axObserver) {
      this.axObserver = null;
    }
  }
}

// Windows Scanner (placeholder)
class WindowsScanner extends PlatformScanner {
  async initialize() {
    console.log('Windows UI scanner initialized (placeholder)');
  }

  async getActiveApplication() {
    return { name: 'Windows App', windowTitle: 'Windows Window' };
  }

  async scanActiveWindows() {
    return [];
  }

  async cleanup() {}
}

// Linux Scanner (placeholder)
class LinuxScanner extends PlatformScanner {
  async initialize() {
    console.log('Linux UI scanner initialized (placeholder)');
  }

  async getActiveApplication() {
    return { name: 'Linux App', windowTitle: 'Linux Window' };
  }

  async scanActiveWindows() {
    return [];
  }

  async cleanup() {}
}

// Main UI Indexer Daemon
class UIIndexerDaemon extends EventEmitter {
  constructor(backendUrl = 'http://localhost:3001') {
    super();
    
    // Initialize platform-specific scanner
    const platform = process.platform;
    switch (platform) {
      case 'darwin':
        this.scanner = new MacOSScanner();
        break;
      case 'win32':
        this.scanner = new WindowsScanner();
        break;
      case 'linux':
        this.scanner = new LinuxScanner();
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    this.backendUrl = backendUrl;
    this.authToken = null;
    this.scanInterval = null;
    this.isRunning = false;
    this.SCAN_INTERVAL_MS = 3000; // 3 seconds
  }

  async initialize() {
    try {
      console.log('🔧 Initializing UI Indexer Daemon...');
      
      await this.scanner.initialize();
      
      // Test backend connection
      await this.testBackendConnection();
      
      console.log('✅ UI Indexer Daemon initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize UI Indexer Daemon:', error);
      throw error;
    }
  }

  async testBackendConnection() {
    try {
      const response = await axios.get(`${this.backendUrl}/api/health`, {
        timeout: 5000
      });
      
      if (response.status === 200) {
        console.log('✅ Backend connection successful');
        return true;
      }
    } catch (error) {
      console.warn('⚠️ Backend connection failed, will continue without backend sync:', error.message);
      return false;
    }
  }

  async authenticate(apiKey) {
    try {
      const response = await axios.post(`${this.backendUrl}/api/auth/login`, {
        apiKey
      });

      this.authToken = response.data.token;
      console.log('✅ Authenticated with backend');
      return true;
    } catch (error) {
      console.error('❌ Authentication failed:', error.message);
      return false;
    }
  }

  getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  async start() {
    if (this.isRunning) {
      console.warn('⚠️ UI Indexer Daemon is already running');
      return;
    }

    try {
      await this.initialize();
      
      this.isRunning = true;
      console.log('🚀 Starting UI Indexer Daemon...');
      
      // Initial scan
      await this.performScan();
      
      // Set up periodic scanning
      this.scanInterval = setInterval(async () => {
        try {
          await this.performScan();
        } catch (error) {
          console.error('❌ Scan interval error:', error);
        }
      }, this.SCAN_INTERVAL_MS);
      
      console.log(`✅ UI Indexer Daemon started (scanning every ${this.SCAN_INTERVAL_MS}ms)`);
      this.emit('started');
      
    } catch (error) {
      console.error('❌ Failed to start UI Indexer Daemon:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping UI Indexer Daemon...');
    
    this.isRunning = false;
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    await this.scanner.cleanup();
    
    console.log('✅ UI Indexer Daemon stopped');
    this.emit('stopped');
  }

  async performScan() {
    try {
      const startTime = Date.now();
      
      // Scan UI elements
      const elements = await this.scanner.scanActiveWindows();
      
      if (elements.length > 0) {
        // Send to backend
        await this.syncElementsToBackend(elements);
        
        const scanTime = Date.now() - startTime;
        console.log(`📊 UI scan completed: ${elements.length} elements in ${scanTime}ms`);
        
        this.emit('scan-completed', { elementCount: elements.length, scanTime });
      }
      
    } catch (error) {
      console.error('❌ UI scan failed:', error);
      this.emit('scan-error', error);
    }
  }

  async syncElementsToBackend(elements) {
    try {
      const response = await axios.post(
        `${this.backendUrl}/api/ui-elements/sync`,
        { elements },
        {
          headers: this.getAuthHeaders(),
          timeout: 10000
        }
      );
      
      console.log(`✅ Synced ${elements.length} UI elements to backend`);
      return response.data;
    } catch (error) {
      console.warn('⚠️ Failed to sync UI elements to backend:', error.message);
      // Continue without backend sync
    }
  }

  // Public API methods
  async getCurrentActiveApplication() {
    if (!this.isRunning) {
      console.warn('⚠️ UI Indexer Daemon is not running');
      return { name: 'Unknown', windowTitle: 'Unknown' };
    }
    
    try {
      return await this.scanner.getActiveApplication();
    } catch (error) {
      console.error('❌ Failed to get current active application:', error);
      return { name: 'Unknown', windowTitle: 'Unknown' };
    }
  }

  async scanCurrentApplication() {
    if (!this.isRunning) {
      console.warn('⚠️ UI Indexer Daemon is not running');
      return null;
    }
    
    try {
      console.log('🔍 Triggering on-demand scan of current active application...');
      
      const activeApp = await this.scanner.getActiveApplication();
      if (!activeApp || activeApp.name === 'Unknown') {
        console.warn('⚠️ No active application found for scanning');
        return null;
      }
      
      console.log(`🎯 Scanning UI elements for: ${activeApp.name} - ${activeApp.windowTitle}`);
      
      const elements = await this.scanner.scanActiveWindows();
      
      if (elements && elements.length > 0) {
        console.log(`📊 Found ${elements.length} UI elements, syncing to backend...`);
        
        await this.syncElementsToBackend(elements);
        
        console.log(`✅ Successfully processed ${elements.length} UI elements for ${activeApp.name}`);
        
        return {
          elements,
          appName: activeApp.name,
          windowTitle: activeApp.windowTitle
        };
      } else {
        console.warn(`⚠️ No UI elements found for ${activeApp.name}`);
        return {
          elements: [],
          appName: activeApp.name,
          windowTitle: activeApp.windowTitle
        };
      }
    } catch (error) {
      console.error('❌ Failed to scan current application:', error);
      return null;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      scanInterval: this.SCAN_INTERVAL_MS,
      platform: process.platform,
      backendUrl: this.backendUrl,
      authenticated: !!this.authToken
    };
  }
}

// Singleton instance
const uiIndexerDaemon = new UIIndexerDaemon();

module.exports = { UIIndexerDaemon, UIElement, MacOSScanner, uiIndexerDaemon };
