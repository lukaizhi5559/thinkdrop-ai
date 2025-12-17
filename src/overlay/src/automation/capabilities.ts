/**
 * Automation Capabilities
 * 
 * Wrapper functions for NutJS automation primitives
 * These are called by the PlanInterpreter to execute automation steps
 */

const ipcRenderer = (window as any).electron?.ipcRenderer;

/**
 * Capture screenshot of the current screen
 * @returns Base64-encoded PNG screenshot
 */
export async function captureScreenshot(): Promise<string> {
  if (!ipcRenderer) {
    throw new Error('IPC renderer not available');
  }

  return new Promise((resolve, reject) => {
    ipcRenderer.once('screenshot:captured', (_event: any, screenshot: string) => {
      resolve(screenshot);
    });

    ipcRenderer.once('screenshot:error', (_event: any, error: string) => {
      reject(new Error(error));
    });

    ipcRenderer.send('screenshot:capture');
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

  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:click:result', (_event: any, result: any) => {
      if (result.success) {
        resolve();
      } else {
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
 * Find element using Vision API and return coordinates
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
