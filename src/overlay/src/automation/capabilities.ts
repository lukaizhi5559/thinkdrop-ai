/**
 * Automation Capabilities
 * 
 * Wrapper functions for NutJS automation primitives
 * These are called by the PlanInterpreter to execute automation steps
 */

import * as nutjsDetector from './nutjs-detector';
import type { DetectionLocator, DetectionResult } from './nutjs-detector';

const ipcRenderer = (window as any).electron?.ipcRenderer;

/**
 * Capture screenshot of the current screen
 * @returns Base64-encoded PNG screenshot
 */
export async function captureScreenshot(): Promise<string> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  // Hide ALL overlays to prevent AI reasoning card from appearing in screenshot
  // console.log('👻 [CAPABILITIES] Hiding all overlays for clean screenshot');
  // ipcRenderer.send('intent-overlay:hide');
  // ipcRenderer.send('ghost-overlay:hide');
  
  // Wait for overlays to fully hide (increased delay to ensure complete hiding)
  await new Promise(resolve => setTimeout(resolve, 500));

  // Show camera icon indicator before screenshot
  console.log('📸 [CAPABILITIES] Showing camera indicator');
  ipcRenderer.send('screenshot:start-indicator');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcRenderer.removeAllListeners('screenshot:captured');
      ipcRenderer.removeAllListeners('screenshot:error');
      ipcRenderer.send('screenshot:end-indicator');
      reject(new Error('Screenshot capture timeout'));
    }, 10000);

    const handleCaptured = (_event: any, screenshot: string) => {
      clearTimeout(timeout);
      ipcRenderer.removeAllListeners('screenshot:captured');
      ipcRenderer.removeAllListeners('screenshot:error');
      console.log('📸 [CAPABILITIES] Screenshot captured');
      ipcRenderer.send('screenshot:end-indicator');
      
      // Show all overlays again after screenshot
      // console.log('👻 [CAPABILITIES] Showing all overlays again');
      // ipcRenderer.send('intent-overlay:show');
      // ipcRenderer.send('ghost-overlay:show');
      
      resolve(screenshot);
    };

    const handleError = (_event: any, error: string) => {
      clearTimeout(timeout);
      ipcRenderer.removeAllListeners('screenshot:captured');
      ipcRenderer.removeAllListeners('screenshot:error');
      ipcRenderer.send('screenshot:end-indicator');
      
      // Show all overlays again even on error
      // console.log('👻 [CAPABILITIES] Showing all overlays again (after error)');
      // ipcRenderer.send('intent-overlay:show');
      // ipcRenderer.send('ghost-overlay:show');
      
      reject(new Error(error));
    };

    ipcRenderer.once('screenshot:captured', handleCaptured);
    ipcRenderer.once('screenshot:error', handleError);

    ipcRenderer.send('screenshot:capture');
  });
}

/**
 * Fullscreen the active application
 */
export async function fullscreen(): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log('🖥️ [CAPABILITIES] Sending automation:fullscreen IPC');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('⏱️ [CAPABILITIES] Timeout (5s) waiting for fullscreen result');
      reject(new Error('Timeout fullscreening app'));
    }, 5000);

    ipcRenderer.once('automation:fullscreen:result', (_event: any, result: any) => {
      clearTimeout(timeout);
      console.log('📥 [CAPABILITIES] Received fullscreen result:', result);
      
      if (result.success) {
        console.log('✅ [CAPABILITIES] Fullscreen successful');
        resolve();
      } else {
        console.error('❌ [CAPABILITIES] Fullscreen failed:', result.error);
        reject(new Error(result.error || 'Failed to fullscreen'));
      }
    });

    ipcRenderer.send('automation:fullscreen');
  });
}

/**
 * Launch an application by name (opens if not running)
 * @param appName - Name of the application (e.g., "Chrome", "Safari", "Slack")
 */
export async function launchApp(appName: string): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`🚀 [CAPABILITIES] Launching app: ${appName}`);

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:launch-app:result', (_event: any, result: any) => {
      if (result.success) {
        console.log(`✅ [CAPABILITIES] App launched: ${appName}`);
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to launch app'));
      }
    });

    ipcRenderer.send('automation:launch-app', { appName });
  });
}

/**
 * Focus/activate an application by name
 * @param appName - Name of the application (e.g., "Chrome", "Safari")
 * @returns The actual app name that was focused (from macOS)
 */
export async function focusApp(appName: string): Promise<string> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:focus-app:result', (_event: any, result: any) => {
      if (result.success) {
        resolve(result.actualApp || appName);
      } else {
        reject(new Error(result.error || 'Failed to focus app'));
      }
    });

    ipcRenderer.send('automation:focus-app', { appName });
  });
}

/**
 * Check if an application is in fullscreen mode
 * @param appName - Name of the application to check (e.g., "Slack", "Chrome")
 * @returns Promise<boolean> - true if app is in fullscreen, false otherwise
 */
export async function checkFullscreen(appName: string): Promise<boolean> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, _reject) => {
    ipcRenderer.once('automation:check-fullscreen:result', (_event: any, result: any) => {
      if (result.success) {
        resolve(result.isFullscreen || false);
      } else {
        // If check fails, assume not fullscreen
        console.warn(`⚠️ [CAPABILITIES] Fullscreen check failed: ${result.error}`);
        resolve(false);
      }
    });

    ipcRenderer.send('automation:check-fullscreen', { appName });
  });
}

/**
 * Quit an application by name
 * @param appName - Name of the application to quit (e.g., "Slack", "Chrome")
 */
export async function quitApp(appName: string): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:quit-app:result', (_event: any, result: any) => {
      if (result.success) {
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to quit app'));
      }
    });

    ipcRenderer.send('automation:quit-app', { appName });
  });
}

/**
 * Find and focus a window by title pattern
 * @param titlePattern - Regex pattern to match window title
 */
export async function focusWindow(titlePattern: string): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`🪟 [CAPABILITIES] Finding window: ${titlePattern}`);

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:find-window:result', (_event: any, result: any) => {
      if (result.success) {
        console.log(`✅ [CAPABILITIES] Window focused: ${result.title}`);
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to find window'));
      }
    });

    ipcRenderer.send('automation:find-window', { titlePattern });
  });
}

/**
 * Wait for browser page to finish loading
 * Polls the browser tab's loading state using AppleScript
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns Promise that resolves when page is loaded
 */
export async function waitForPageLoad(timeout: number = 10000): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`⏳ [CAPABILITIES] Waiting for page to load (timeout: ${timeout}ms)`);

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      ipcRenderer.removeAllListeners('automation:wait-page-load:result');
      console.warn(`⚠️ [CAPABILITIES] Page load timeout after ${timeout}ms, proceeding anyway`);
      resolve(); // Don't reject, just proceed
    }, timeout);

    ipcRenderer.once('automation:wait-page-load:result', (_event: any, result: any) => {
      clearTimeout(timeoutId);
      
      if (result.success) {
        console.log(`✅ [CAPABILITIES] Page loaded after ${result.duration}ms`);
        resolve();
      } else {
        console.warn(`⚠️ [CAPABILITIES] Page load check failed: ${result.error}, proceeding anyway`);
        resolve(); // Don't reject, just proceed
      }
    });

    ipcRenderer.send('automation:wait-page-load', { timeout });
  });
}

/**
 * Wait for app window to stabilize after focus
 * Ensures the app window is fully rendered and ready
 * @param appName - Name of the app to check
 * @param timeout - Maximum time to wait in milliseconds (default: 3000)
 * @returns Promise that resolves when app is stable
 */
export async function waitForAppStability(appName: string, timeout: number = 3000): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`⏳ [CAPABILITIES] Waiting for ${appName} to stabilize (timeout: ${timeout}ms)`);

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      ipcRenderer.removeAllListeners('automation:wait-app-stability:result');
      console.warn(`⚠️ [CAPABILITIES] App stability timeout after ${timeout}ms, proceeding anyway`);
      resolve(); // Don't reject, just proceed
    }, timeout);

    ipcRenderer.once('automation:wait-app-stability:result', (_event: any, result: any) => {
      clearTimeout(timeoutId);
      
      if (result.success) {
        console.log(`✅ [CAPABILITIES] ${appName} stabilized after ${result.duration}ms`);
        resolve();
      } else {
        console.warn(`⚠️ [CAPABILITIES] App stability check failed: ${result.error}, proceeding anyway`);
        resolve(); // Don't reject, just proceed
      }
    });

    ipcRenderer.send('automation:wait-app-stability', { appName, timeout });
  });
}

/**
 * Open a URL in the default browser
 * @param url - URL to open
 */
export async function openUrl(url: string): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`📤 [CAPABILITIES] Sending open-url IPC:`, url);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for open-url response'));
    }, 5000);

    ipcRenderer.once('automation:open-url:result', (_event: any, result: any) => {
      clearTimeout(timeout);
      console.log(`📥 [CAPABILITIES] Received open-url result:`, result);
      
      if (result.success) {
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to open URL'));
      }
    });

    ipcRenderer.send('automation:open-url', { url });
  });
}

/**
 * Type text using keyboard
 * @param text - Text to type
 * @param submit - Whether to press Enter after typing
 */
export async function typeText(text: string, submit: boolean = false): Promise<void> {
  // Try nut.js native typing first (faster, more reliable)
  try {
    console.log(`⌨️ [CAPABILITIES] Using native nut.js typing`);
    await nutjsDetector.typeText(text);
    if (submit) {
      await nutjsDetector.pressKey('Return');
    }
    return;
  } catch (error: any) {
    console.warn(`⚠️ [CAPABILITIES] Native typing failed, falling back to IPC:`, error.message);
  }
  
  // Fallback to IPC if nut.js fails
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:type-text:result', (_event: any, result: any) => {
      if (result.success) {
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to type text'));
      }
    });

    ipcRenderer.send('automation:type-text', { text, submit });
  });
}

/**
 * Press a hotkey combination
 * @param keys - Array of keys to press (e.g., ["Command", "Space"])
 */
export async function pressHotkey(keys: string[]): Promise<void> {
  // Try nut.js native key press first
  try {
    console.log(`⌨️ [CAPABILITIES] Using native nut.js hotkey`);
    const modifiers = keys.slice(0, -1);
    const mainKey = keys[keys.length - 1];
    await nutjsDetector.pressKey(mainKey, modifiers);
    return;
  } catch (error: any) {
    console.warn(`⚠️ [CAPABILITIES] Native hotkey failed, falling back to IPC:`, error.message);
  }
  
  // Fallback to IPC if nut.js fails
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:hotkey:result', (_event: any, result: any) => {
      if (result.success) {
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to press hotkey'));
      }
    });

    ipcRenderer.send('automation:hotkey', { keys });
  });
}

/**
 * Click at specific coordinates
 * @param x - X coordinate
 * @param y - Y coordinate
 */
export async function clickAt(x: number, y: number): Promise<void> {
  console.log(`🖱️ [CAPABILITIES] Clicking at (${x}, ${y}) using native nut.js`);
  
  try {
    await nutjsDetector.clickAtCoordinates(x, y);
    console.log(`✅ [CAPABILITIES] Click successful at (${x}, ${y})`);
  } catch (error: any) {
    console.error(`❌ [CAPABILITIES] Click failed at (${x}, ${y}):`, error.message);
    throw new Error(`Failed to click at (${x}, ${y}): ${error.message}`);
  }
}

/**
 * Scroll by a specified amount
 * @param amount - Amount to scroll
 * @param direction - Direction to scroll (up or down)
 */
export async function scroll(amount: number = 5, direction: 'down' | 'up' = 'down'): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:scroll:result', (_event: any, result: any) => {
      if (result.success) {
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to scroll'));
      }
    });

    ipcRenderer.send('automation:scroll', { amount, direction });
  });
}

/**
 * Invoke a backend skill/API action
 * @param skill - Skill name (e.g., "amazon.search")
 * @param params - Skill parameters
 */
export async function invokeSkill(skill: string, params: Record<string, any>): Promise<any> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:skill:result', (_event: any, result: any) => {
      if (result.success) {
        resolve(result.data);
      } else {
        reject(new Error(result.error || 'Failed to invoke skill'));
      }
    });

    ipcRenderer.send('automation:skill', { skill, params });
  });
}

/**
 * Wait for a specified duration
 * @param ms - Milliseconds to wait
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send ghost mouse move event for visual feedback
 * @param x - X coordinate
 * @param y - Y coordinate
 */
export function sendGhostMouseMove(x: number, y: number): void {
  if (!ipcRenderer) {
    console.warn('[CAPABILITIES] IPC renderer not available for ghost mouse');
    return;
  }
  
  console.log(`👻 [CAPABILITIES] Sending ghost:mouse-move IPC to (${x}, ${y})`);
  ipcRenderer.send('ghost:mouse-move', { x, y });
}

/**
 * Send ghost mouse click event for visual feedback
 * @param x - X coordinate
 * @param y - Y coordinate
 */
export function sendGhostMouseClick(x: number, y: number): void {
  if (!ipcRenderer) {
    console.warn('[CAPABILITIES] IPC renderer not available for ghost mouse');
    return;
  }
  
  console.log(`👻 [CAPABILITIES] Sending ghost:mouse-click IPC at (${x}, ${y})`);
  ipcRenderer.send('ghost:mouse-click', { x, y });
}

/**
 * Find element using nut.js native detection (FAST) - without clicking
 * Used for verification (waitForElement)
 * @param locator - Detection locator with strategy and value
 * @returns Detection result with coordinates
 */
export async function findElement(locator: DetectionLocator): Promise<DetectionResult> {
  console.log(`🔍 [CAPABILITIES] Finding element (no click):`, locator);
  
  // Try native nut.js detection without clicking
  const result = await nutjsDetector.detect(locator);
  
  if (result.success) {
    console.log(`✅ [CAPABILITIES] Element found:`, result.coordinates);
    return result;
  }
  
  // If native detection fails, fall back to Vision API
  const fallbackDescription = locator.description || locator.value;
  
  if (fallbackDescription) {
    console.warn(`⚠️ [CAPABILITIES] Native ${locator.strategy} detection failed, trying Vision API`);
    
    try {
      const coords = await findElementWithVision(fallbackDescription, 'vision');
      return {
        success: true,
        coordinates: coords,
        usedVisionAPI: true  // Mark that Vision API was used
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Both native and Vision API detection failed: ${error.message}`
      };
    }
  }
  
  return result;
}

/**
 * Find and click element using nut.js native detection (FAST)
 * Supports text, image, and element strategies
 * Falls back to Vision API if native detection fails
 * @param locator - Detection locator with strategy and value
 * @returns Detection result with coordinates
 */
export async function findAndClickElement(locator: DetectionLocator): Promise<DetectionResult> {
  console.log(`🎯 [CAPABILITIES] Finding element with native detection:`, locator);
  
  // Try native nut.js detection first (100x faster)
  const result = await nutjsDetector.detectAndClick(locator);
  
  if (result.success) {
    console.log(`✅ [CAPABILITIES] Native detection successful:`, result.coordinates);
    return result;
  }
  
  // If native detection fails, provide better error context
  const fallbackDescription = locator.description || locator.value;
  
  // For simple tasks (app launching, window switching), don't use Vision API
  const isSimpleTask = locator.strategy === 'element' && 
    /open|launch|switch|focus|activate/i.test(fallbackDescription || '');
  
  if (isSimpleTask) {
    console.warn(`⚠️ [CAPABILITIES] Simple task failed with native detection. Consider using focusApp() or launchApp() instead.`);
    return {
      success: false,
      error: `Native detection failed. For app launching/switching, use focusApp() capability instead of findAndClickElement().`
    };
  }
  
  // For complex UI interactions, fall back to Vision API
  if (fallbackDescription) {
    console.warn(`⚠️ [CAPABILITIES] Native ${locator.strategy} detection failed, falling back to Vision API`);
    console.log(`🔍 [CAPABILITIES] Searching for: "${fallbackDescription}"`);
    
    try {
      const coords = await findElementWithVision(fallbackDescription, 'vision');
      await nutjsDetector.clickAtCoordinates(coords.x, coords.y);
      return {
        success: true,
        coordinates: coords,
        usedVisionAPI: true  // Mark that Vision API was used
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Both native and Vision API detection failed: ${error.message}`
      };
    }
  }
  
  return result;
}

/**
 * Find element using Vision API and return coordinates (LEGACY FALLBACK)
 * @param description - Description of element to find
 * @param strategy - Vision strategy (optional)
 * @param screenshot - Optional pre-captured screenshot (for performance optimization)
 * @returns Coordinates of the element
 */
export async function findElementWithVision(
  description: string, 
  strategy?: string,
  screenshot?: string
): Promise<{ x: number; y: number }> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`🔍 [CAPABILITIES] Finding element with vision: "${description}"`);
  
  // Use provided screenshot or capture new one
  const imageData = screenshot || await captureScreenshot();
  
  if (screenshot) {
    console.log(`📸 [CAPABILITIES] Using pre-captured screenshot (${screenshot.length} bytes)`);
  } else {
    console.log(`📸 [CAPABILITIES] Screenshot captured, size: ${imageData.length} bytes`);
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error(`⏱️  [CAPABILITIES] Timeout (15s) finding element: ${description}`);
      reject(new Error(`Timeout finding element: ${description}`));
    }, 15000);

    ipcRenderer.once('automation:find-element:result', (_event: any, result: any) => {
      clearTimeout(timeout);
      
      console.log(`📥 [CAPABILITIES] Received find-element result:`, result);
      
      if (result.success && result.coordinates) {
        console.log(`✅ [CAPABILITIES] Element found at (${result.coordinates.x}, ${result.coordinates.y})`);
        resolve(result.coordinates);
      } else {
        console.error(`❌ [CAPABILITIES] Element not found:`, result.error);
        reject(new Error(result.error || `Could not find element: ${description}`));
      }
    });

    console.log(`📤 [CAPABILITIES] Sending find-element IPC request`);
    ipcRenderer.send('automation:find-element', { 
      screenshot: imageData, 
      description,
      strategy: strategy || 'vision'
    });
  });
}

/**
 * Verify step completion using Vision API
 * @param expectedState - Description of expected state after step
 * @param stepDescription - Description of the step that was executed
 * @returns Verification result with confidence score
 */
export async function verifyStepWithVision(
  expectedState: string, 
  stepDescription: string
): Promise<{ verified: boolean; confidence: number; reasoning: string }> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  // Take a screenshot of current state
  const screenshot = await captureScreenshot();
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout verifying step'));
    }, 15000);

    ipcRenderer.once('automation:verify-step:result', (_event: any, result: any) => {
      clearTimeout(timeout);
      
      if (result.success) {
        resolve({
          verified: result.verified,
          confidence: result.confidence,
          reasoning: result.reasoning
        });
      } else {
        reject(new Error(result.error || 'Verification failed'));
      }
    });

    ipcRenderer.send('automation:verify-step', { 
      screenshot, 
      expectedState,
      stepDescription,
      verificationStrategy: 'vision_check'
    });
  });
}

/**
 * Resolve a locator to screen coordinates
 * Supports text, image, element, vision, and bbox strategies
 * @param locator - Detection locator
 * @param screenshot - Optional screenshot for Vision API (to resolve multiple locators from same screenshot)
 * @returns Coordinates { x, y }
 */
export async function resolveLocator(
  locator: DetectionLocator, 
  screenshot?: string
): Promise<{ x: number; y: number }> {
  console.log(`🔍 [CAPABILITIES] Resolving locator:`, locator);
  
  switch (locator.strategy) {
    case 'vision':
      // Use Vision API for element detection
      if (!locator.description) {
        throw new Error('Vision strategy requires description');
      }
      
      // Pass screenshot to Vision API for reuse optimization
      return await findElementWithVision(locator.description, 'vision', screenshot);
      
    case 'text':
    case 'image':
    case 'element':
      // Use native nut.js detection
      const result = await nutjsDetector.detect(locator);
      if (!result.success || !result.coordinates) {
        throw new Error(`Failed to detect element: ${result.error || 'Not found'}`);
      }
      return result.coordinates;
      
    case 'bbox':
      // Direct coordinates from bounding box
      if (!locator.bbox || locator.bbox.length !== 4) {
        throw new Error('bbox strategy requires [x, y, width, height] array');
      }
      const [x, y, width, height] = locator.bbox;
      return { x: x + width / 2, y: y + height / 2 };
      
    default:
      throw new Error(`Unsupported locator strategy: ${locator.strategy}`);
  }
}

/**
 * Execute click and drag action
 * Drags from one element to another
 * @param fromLocator - Starting element locator
 * @param toLocator - Destination element locator
 * @returns Detection result with usedVisionAPI flag
 */
export async function clickAndDrag(
  fromLocator: DetectionLocator,
  toLocator: DetectionLocator
): Promise<DetectionResult> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`🎯 [CAPABILITIES] Executing clickAndDrag`);
  console.log(`  From:`, fromLocator);
  console.log(`  To:`, toLocator);
  
  // Determine if we need Vision API
  const usesVisionAPI = 
    fromLocator.strategy === 'vision' || 
    toLocator.strategy === 'vision';
  
  try {
    // Capture screenshot once if either locator uses Vision API
    let screenshot: string | undefined;
    if (usesVisionAPI) {
      screenshot = await captureScreenshot();
      console.log(`📸 [CAPABILITIES] Screenshot captured for Vision API resolution`);
    }
    
    // Resolve both coordinates (from same screenshot if Vision API is used)
    const fromCoords = await resolveLocator(fromLocator, screenshot);
    const toCoords = await resolveLocator(toLocator, screenshot);
    
    console.log(`✅ [CAPABILITIES] Coordinates resolved:`, { fromCoords, toCoords });
    
    // Validate coordinates are within screen bounds
    // TODO: Get actual screen dimensions
    if (fromCoords.x < 0 || fromCoords.y < 0 || toCoords.x < 0 || toCoords.y < 0) {
      throw new Error('Coordinates out of bounds (negative values)');
    }
    
    // Send to main process for execution
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout executing clickAndDrag'));
      }, 10000);

      ipcRenderer.once('automation:click-and-drag:result', (_event: any, result: any) => {
        clearTimeout(timeout);
        
        if (result.success) {
          console.log('✅ [CAPABILITIES] clickAndDrag successful');
          resolve({
            success: true,
            coordinates: toCoords,
            usedVisionAPI: usesVisionAPI
          });
        } else {
          console.error('❌ [CAPABILITIES] clickAndDrag failed:', result.error);
          reject(new Error(result.error || 'Failed to execute clickAndDrag'));
        }
      });

      ipcRenderer.send('automation:click-and-drag', { 
        fromCoords, 
        toCoords 
      });
    });
  } catch (error: any) {
    console.error('❌ [CAPABILITIES] clickAndDrag error:', error.message);
    return {
      success: false,
      error: error.message,
      usedVisionAPI: usesVisionAPI
    };
  }
}

/**
 * Execute zoom action
 * @param direction - 'in' or 'out'
 * @param level - Optional zoom level
 * @param activeApp - Currently active application name for context-aware strategy
 * @returns Success result
 */
export async function zoom(
  direction: 'in' | 'out',
  level?: number,
  activeApp?: string
): Promise<{ success: boolean; error?: string }> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`🔍 [CAPABILITIES] Executing zoom ${direction}`, { level, activeApp });
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout executing zoom'));
    }, 5000);

    ipcRenderer.once('automation:zoom:result', (_event: any, result: any) => {
      clearTimeout(timeout);
      
      if (result.success) {
        console.log('✅ [CAPABILITIES] Zoom successful');
        resolve({ success: true });
      } else {
        console.error('❌ [CAPABILITIES] Zoom failed:', result.error);
        reject(new Error(result.error || 'Failed to execute zoom'));
      }
    });

    ipcRenderer.send('automation:zoom', { 
      direction, 
      level,
      activeApp 
    });
  });
}

/**
 * Hide the system cursor during automation
 */
export function hideSystemCursor(): void {
  if (!ipcRenderer) {
    console.warn('⚠️ [CAPABILITIES] IPC renderer not available, cannot hide cursor');
    return;
  }
  
  console.log('👻 [CAPABILITIES] Hiding system cursor');
  ipcRenderer.send('automation:hide-cursor');
}

/**
 * Show the system cursor after automation
 */
export function showSystemCursor(): void {
  if (!ipcRenderer) {
    console.warn('⚠️ [CAPABILITIES] IPC renderer not available, cannot show cursor');
    return;
  }
  
  console.log('👁️ [CAPABILITIES] Showing system cursor');
  ipcRenderer.send('automation:show-cursor');
}
