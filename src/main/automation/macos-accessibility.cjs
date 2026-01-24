/**
 * macOS Accessibility API Integration
 * 
 * Uses AppleScript and system commands to query the Accessibility tree
 * for reliable desktop automation
 */

const { execSync, exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const logger = require('../utils/logger.cjs');

/**
 * Get the frontmost application's UI element tree
 */
async function getFrontmostAppUITree() {
  try {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        return appName
      end tell
    `;
    
    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const appName = stdout.trim();
    
    logger.info(`🔍 [AX] Frontmost app: ${appName}`);
    return appName;
  } catch (error) {
    logger.error('❌ [AX] Failed to get frontmost app:', error);
    throw error;
  }
}

/**
 * Find UI elements by role and title using AppleScript
 */
async function findElementByRoleAndTitle(axRole, axTitle) {
  try {
    logger.info(`🔍 [AX] Searching for element: role=${axRole}, title=${axTitle}`);
    
    // Map common AX roles to AppleScript element types
    const roleMap = {
      'AXButton': 'button',
      'AXTextField': 'text field',
      'AXStaticText': 'static text',
      'AXWindow': 'window',
      'AXMenuItem': 'menu item',
      'AXMenuButton': 'menu button',
      'AXCheckBox': 'checkbox',
      'AXRadioButton': 'radio button',
      'AXGroup': 'group',
      'AXScrollArea': 'scroll area',
      'AXTable': 'table',
      'AXRow': 'row',
      'AXCell': 'cell',
      'AXImage': 'image',
      'AXLink': 'link'
    };
    
    const elementType = roleMap[axRole] || axRole.replace('AX', '').toLowerCase();
    
    // Build AppleScript to find element
    let script;
    if (axTitle) {
      // Search by both role and title
      script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          try
            set targetElement to first ${elementType} of frontApp whose title is "${axTitle}" or name is "${axTitle}" or description is "${axTitle}"
            set elementPosition to position of targetElement
            set elementSize to size of targetElement
            return (item 1 of elementPosition as string) & "," & (item 2 of elementPosition as string) & "," & (item 1 of elementSize as string) & "," & (item 2 of elementSize as string)
          on error errMsg
            return "ERROR:" & errMsg
          end try
        end tell
      `;
    } else {
      // Search by role only (get first match)
      script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          try
            set targetElement to first ${elementType} of frontApp
            set elementPosition to position of targetElement
            set elementSize to size of targetElement
            return (item 1 of elementPosition as string) & "," & (item 2 of elementPosition as string) & "," & (item 1 of elementSize as string) & "," & (item 2 of elementSize as string)
          on error errMsg
            return "ERROR:" & errMsg
          end try
        end tell
      `;
    }
    
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const result = stdout.trim();
    
    if (result.startsWith('ERROR:')) {
      logger.warn(`⚠️ [AX] Element not found: ${result}`);
      return null;
    }
    
    // Parse position and size: "x,y,width,height"
    const [x, y, width, height] = result.split(',').map(Number);
    
    logger.info(`✅ [AX] Element found at (${x}, ${y}) with size ${width}x${height}`);
    
    return {
      bounds: { x, y, width, height },
      metadata: { axRole, axTitle, elementType }
    };
  } catch (error) {
    logger.error('❌ [AX] Failed to find element:', error);
    return null;
  }
}

/**
 * Find all UI elements of a specific role
 */
async function findElementsByRole(axRole) {
  try {
    logger.info(`🔍 [AX] Finding all elements with role: ${axRole}`);
    
    const roleMap = {
      'AXButton': 'button',
      'AXTextField': 'text field',
      'AXStaticText': 'static text',
      'AXWindow': 'window',
      'AXMenuItem': 'menu item'
    };
    
    const elementType = roleMap[axRole] || axRole.replace('AX', '').toLowerCase();
    
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        try
          set allElements to every ${elementType} of frontApp
          set elementData to {}
          repeat with elem in allElements
            try
              set elemPos to position of elem
              set elemSize to size of elem
              set elemTitle to ""
              try
                set elemTitle to title of elem
              end try
              if elemTitle is missing value then set elemTitle to ""
              set end of elementData to ((item 1 of elemPos) as string) & "," & (item 2 of elemPos) as string & "," & (item 1 of elemSize) as string & "," & (item 2 of elemSize) as string & "," & elemTitle
            end try
          end repeat
          return elementData as string
        on error errMsg
          return "ERROR:" & errMsg
        end try
      end tell
    `;
    
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const result = stdout.trim();
    
    if (result.startsWith('ERROR:') || !result) {
      logger.warn(`⚠️ [AX] No elements found for role: ${axRole}`);
      return [];
    }
    
    // Parse results
    const elements = result.split(', ').map(item => {
      const [x, y, width, height, title] = item.split(',');
      return {
        bounds: {
          x: Number(x),
          y: Number(y),
          width: Number(width),
          height: Number(height)
        },
        metadata: { axRole, title, elementType }
      };
    });
    
    logger.info(`✅ [AX] Found ${elements.length} elements`);
    return elements;
  } catch (error) {
    logger.error('❌ [AX] Failed to find elements:', error);
    return [];
  }
}

/**
 * Get value of a text field or other input element
 */
async function getElementValue(axRole, axTitle) {
  try {
    logger.info(`📖 [AX] Getting value for: role=${axRole}, title=${axTitle}`);
    
    const roleMap = {
      'AXTextField': 'text field',
      'AXTextArea': 'text area',
      'AXStaticText': 'static text'
    };
    
    const elementType = roleMap[axRole] || 'text field';
    
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        try
          set targetElement to first ${elementType} of frontApp whose title is "${axTitle}" or name is "${axTitle}"
          return value of targetElement
        on error errMsg
          return "ERROR:" & errMsg
        end try
      end tell
    `;
    
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const result = stdout.trim();
    
    if (result.startsWith('ERROR:')) {
      logger.warn(`⚠️ [AX] Failed to get value: ${result}`);
      return '';
    }
    
    logger.info(`✅ [AX] Got value: ${result}`);
    return result;
  } catch (error) {
    logger.error('❌ [AX] Failed to get element value:', error);
    return '';
  }
}

/**
 * Click an element using Accessibility API
 * Note: This returns the element bounds, actual clicking is done by nut.js
 */
async function clickElement(axRole, axTitle) {
  // Find element first
  const element = await findElementByRoleAndTitle(axRole, axTitle);
  
  if (!element) {
    throw new Error(`Element not found: ${axRole} "${axTitle}"`);
  }
  
  // Return bounds for nut.js to click
  return element;
}

/**
 * Perform a more advanced UI element search using AppleScript
 * Searches recursively through the UI hierarchy
 */
async function searchUIHierarchy(searchCriteria) {
  try {
    const { axRole, axTitle, axDescription } = searchCriteria;
    
    logger.info(`🔍 [AX] Deep search: role=${axRole}, title=${axTitle}, description=${axDescription}`);
    
    // Build search script that recursively searches UI elements
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        
        on searchElement(elem, targetRole, targetTitle)
          try
            set elemRole to role of elem
            set elemTitle to ""
            try
              set elemTitle to title of elem
            end try
            
            -- Check if this element matches
            if elemRole contains targetRole then
              if targetTitle is "" or elemTitle contains targetTitle then
                return elem
              end if
            end if
            
            -- Search children recursively
            try
              set children to UI elements of elem
              repeat with child in children
                set foundElem to my searchElement(child, targetRole, targetTitle)
                if foundElem is not missing value then
                  return foundElem
                end if
              end repeat
            end try
          end try
          
          return missing value
        end searchElement
        
        try
          set foundElement to my searchElement(frontApp, "${axRole}", "${axTitle || ''}")
          
          if foundElement is not missing value then
            set elementPosition to position of foundElement
            set elementSize to size of foundElement
            return (item 1 of elementPosition as string) & "," & (item 2 of elementPosition as string) & "," & (item 1 of elementSize as string) & "," & (item 2 of elementSize as string)
          else
            return "ERROR:Element not found"
          end if
        on error errMsg
          return "ERROR:" & errMsg
        end try
      end tell
    `;
    
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 10000 // 10 second timeout for deep search
    });
    const result = stdout.trim();
    
    if (result.startsWith('ERROR:')) {
      logger.warn(`⚠️ [AX] Deep search failed: ${result}`);
      return null;
    }
    
    const [x, y, width, height] = result.split(',').map(Number);
    
    logger.info(`✅ [AX] Deep search found element at (${x}, ${y})`);
    
    return {
      bounds: { x, y, width, height },
      metadata: { axRole, axTitle, searchMethod: 'deep' }
    };
  } catch (error) {
    logger.error('❌ [AX] Deep search failed:', error);
    return null;
  }
}

/**
 * Check if Accessibility permissions are granted
 */
async function checkAccessibilityPermissions() {
  try {
    const script = `
      tell application "System Events"
        try
          set frontApp to first application process whose frontmost is true
          return "granted"
        on error
          return "denied"
        end try
      end tell
    `;
    
    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const result = stdout.trim();
    
    const granted = result === 'granted';
    logger.info(`🔐 [AX] Accessibility permissions: ${granted ? 'GRANTED' : 'DENIED'}`);
    
    return granted;
  } catch (error) {
    logger.error('❌ [AX] Failed to check permissions:', error);
    return false;
  }
}

module.exports = {
  getFrontmostAppUITree,
  findElementByRoleAndTitle,
  findElementsByRole,
  getElementValue,
  clickElement,
  searchUIHierarchy,
  checkAccessibilityPermissions
};
