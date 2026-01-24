/**
 * Playwright Web Automation Driver
 * 
 * High-reliability web automation using Playwright's CDP connection
 */

import type { 
  AutomationDriver, 
  ElementSelector, 
  Element, 
  ActionResult, 
  DriverCapabilities 
} from './types';

const ipcRenderer = (window as any).electron?.ipcRenderer;

export class PlaywrightDriver implements AutomationDriver {
  name = 'playwright';
  capabilities: DriverCapabilities = {
    canFindElement: true,
    canClick: true,
    canType: true,
    canGetValue: true,
    canWaitFor: true,
    canNavigate: true,
    canExecuteScript: true,
  };

  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🌐 [PLAYWRIGHT] Initializing Playwright driver');
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    // Request main process to initialize Playwright
    const result = await ipcRenderer.invoke('playwright:initialize');
    
    if (!result.success) {
      throw new Error(`Failed to initialize Playwright: ${result.error}`);
    }

    this.initialized = true;
    console.log('✅ [PLAYWRIGHT] Driver initialized');
  }

  async cleanup(): Promise<void> {
    if (!this.initialized) return;
    
    console.log('🧹 [PLAYWRIGHT] Cleaning up Playwright driver');
    
    if (ipcRenderer) {
      await ipcRenderer.invoke('playwright:cleanup');
    }
    
    this.initialized = false;
  }

  async isAvailable(): Promise<boolean> {
    if (!ipcRenderer) return false;
    
    try {
      const result = await ipcRenderer.invoke('playwright:check-availability');
      return result.available;
    } catch {
      return false;
    }
  }

  async findElement(selector: ElementSelector): Promise<Element | null> {
    console.log('🔍 [PLAYWRIGHT] Finding element:', selector);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:find-element', { selector });
    
    if (!result.success || !result.element) {
      console.warn('⚠️ [PLAYWRIGHT] Element not found');
      return null;
    }

    return {
      bounds: result.element.bounds,
      selector,
      driver: 'web',
      metadata: result.element.metadata,
    };
  }

  async findElements(selector: ElementSelector): Promise<Element[]> {
    console.log('🔍 [PLAYWRIGHT] Finding elements:', selector);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:find-elements', { selector });
    
    if (!result.success || !result.elements) {
      return [];
    }

    return result.elements.map((el: any) => ({
      bounds: el.bounds,
      selector,
      driver: 'web' as const,
      metadata: el.metadata,
    }));
  }

  async click(element: Element): Promise<ActionResult> {
    console.log('🖱️ [PLAYWRIGHT] Clicking element');
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:click', { 
      selector: element.selector 
    });

    if (result.success) {
      console.log('✅ [PLAYWRIGHT] Click successful');
    } else {
      console.error('❌ [PLAYWRIGHT] Click failed:', result.error);
    }

    return result;
  }

  async type(element: Element, text: string): Promise<ActionResult> {
    console.log(`⌨️ [PLAYWRIGHT] Typing text: "${text}"`);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:type', { 
      selector: element.selector,
      text 
    });

    if (result.success) {
      console.log('✅ [PLAYWRIGHT] Type successful');
    } else {
      console.error('❌ [PLAYWRIGHT] Type failed:', result.error);
    }

    return result;
  }

  async getValue(element: Element): Promise<string> {
    console.log('📖 [PLAYWRIGHT] Getting element value');
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:get-value', { 
      selector: element.selector 
    });

    if (!result.success) {
      throw new Error(`Failed to get value: ${result.error}`);
    }

    return result.value;
  }

  async waitForElement(
    selector: ElementSelector, 
    timeout: number = 5000
  ): Promise<Element | null> {
    console.log('⏳ [PLAYWRIGHT] Waiting for element:', selector);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:wait-for-element', { 
      selector,
      timeout 
    });

    if (!result.success || !result.element) {
      console.warn('⚠️ [PLAYWRIGHT] Element not found within timeout');
      return null;
    }

    return {
      bounds: result.element.bounds,
      selector,
      driver: 'web',
      metadata: result.element.metadata,
    };
  }

  async waitForCondition(
    condition: () => Promise<boolean>, 
    timeout: number = 5000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return false;
  }

  async navigate(url: string): Promise<ActionResult> {
    console.log('🌐 [PLAYWRIGHT] Navigating to:', url);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:navigate', { url });

    if (result.success) {
      console.log('✅ [PLAYWRIGHT] Navigation successful');
    } else {
      console.error('❌ [PLAYWRIGHT] Navigation failed:', result.error);
    }

    return result;
  }

  async executeScript(script: string, ...args: any[]): Promise<any> {
    console.log('📜 [PLAYWRIGHT] Executing script');
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('playwright:execute-script', { 
      script,
      args 
    });

    if (!result.success) {
      throw new Error(`Script execution failed: ${result.error}`);
    }

    return result.value;
  }
}
