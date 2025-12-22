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
      resolve(screenshot);
    };

    const handleError = (_event: any, error: string) => {
      clearTimeout(timeout);
      ipcRenderer.removeAllListeners('screenshot:captured');
      ipcRenderer.removeAllListeners('screenshot:error');
      ipcRenderer.send('screenshot:end-indicator');
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
 * Focus/activate an application by name
 * @param appName - Name of the application (e.g., "Chrome", "Safari")
 */
export async function focusApp(appName: string): Promise<void> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:focus-app:result', (_event: any, result: any) => {
      if (result.success) {
        resolve();
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
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`🖱️ [CAPABILITIES] Sending automation:click IPC to (${x}, ${y})`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error(`⏱️ [CAPABILITIES] Timeout (5s) waiting for click result at (${x}, ${y})`);
      reject(new Error(`Timeout clicking at (${x}, ${y})`));
    }, 5000);

    ipcRenderer.once('automation:click:result', (_event: any, result: any) => {
      clearTimeout(timeout);
      console.log(`📥 [CAPABILITIES] Received click result:`, result);
      
      if (result.success) {
        console.log(`✅ [CAPABILITIES] Click successful at (${x}, ${y})`);
        resolve();
      } else {
        console.error(`❌ [CAPABILITIES] Click failed:`, result.error);
        reject(new Error(result.error || 'Failed to click'));
      }
    });

    ipcRenderer.send('automation:click', { x, y });
  });
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
        coordinates: coords
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
  
  // If native detection fails, fall back to Vision API
  // Use description if available, otherwise use value as description
  const fallbackDescription = locator.description || locator.value;
  
  if (fallbackDescription) {
    console.warn(`⚠️ [CAPABILITIES] Native ${locator.strategy} detection failed, falling back to Vision API`);
    console.log(`🔍 [CAPABILITIES] Searching for: "${fallbackDescription}"`);
    
    try {
      const coords = await findElementWithVision(fallbackDescription, 'vision');
      await nutjsDetector.clickAtCoordinates(coords.x, coords.y);
      return {
        success: true,
        coordinates: coords
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
 * @returns Coordinates of the element
 */
export async function findElementWithVision(description: string, strategy?: string): Promise<{ x: number; y: number }> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  console.log(`🔍 [CAPABILITIES] Finding element with vision: "${description}"`);
  
  // First, take a screenshot
  const screenshot = await captureScreenshot();
  console.log(`📸 [CAPABILITIES] Screenshot captured, size: ${screenshot.length} bytes`);
  
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
      screenshot, 
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
