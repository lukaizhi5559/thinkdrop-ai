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
