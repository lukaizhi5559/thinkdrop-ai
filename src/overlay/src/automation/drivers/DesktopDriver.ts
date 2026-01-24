/**
 * Desktop Accessibility Driver
 * 
 * Uses macOS Accessibility API (AX) or Windows UIAutomation
 * Falls back to nut.js for execution
 */

import type { 
  AutomationDriver, 
  ElementSelector, 
  Element, 
  ActionResult, 
  DriverCapabilities 
} from './types';
import * as nutjsDetector from '../nutjs-detector';

const ipcRenderer = (window as any).electron?.ipcRenderer;

export class DesktopDriver implements AutomationDriver {
  name = 'desktop';
  capabilities: DriverCapabilities = {
    canFindElement: true,
    canClick: true,
    canType: true,
    canGetValue: true,
    canWaitFor: true,
    canNavigate: false,
    canExecuteScript: false,
  };

  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🖥️ [DESKTOP] Initializing Desktop driver');
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    // Request main process to initialize accessibility APIs
    const result = await ipcRenderer.invoke('desktop:initialize');
    
    if (!result.success) {
      throw new Error(`Failed to initialize Desktop driver: ${result.error}`);
    }

    this.initialized = true;
    console.log('✅ [DESKTOP] Driver initialized');
  }

  async cleanup(): Promise<void> {
    if (!this.initialized) return;
    
    console.log('🧹 [DESKTOP] Cleaning up Desktop driver');
    
    if (ipcRenderer) {
      await ipcRenderer.invoke('desktop:cleanup');
    }
    
    this.initialized = false;
  }

  async isAvailable(): Promise<boolean> {
    if (!ipcRenderer) return false;
    
    try {
      const result = await ipcRenderer.invoke('desktop:check-availability');
      return result.available;
    } catch {
      return false;
    }
  }

  async findElement(selector: ElementSelector): Promise<Element | null> {
    console.log('🔍 [DESKTOP] Finding element:', selector);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    // Query accessibility tree
    const result = await ipcRenderer.invoke('desktop:find-element', { selector });
    
    if (!result.success || !result.element) {
      console.warn('⚠️ [DESKTOP] Element not found in accessibility tree');
      return null;
    }

    return {
      bounds: result.element.bounds,
      selector,
      driver: 'desktop',
      metadata: result.element.metadata,
    };
  }

  async findElements(selector: ElementSelector): Promise<Element[]> {
    console.log('🔍 [DESKTOP] Finding elements:', selector);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    const result = await ipcRenderer.invoke('desktop:find-elements', { selector });
    
    if (!result.success || !result.elements) {
      return [];
    }

    return result.elements.map((el: any) => ({
      bounds: el.bounds,
      selector,
      driver: 'desktop' as const,
      metadata: el.metadata,
    }));
  }

  async click(element: Element): Promise<ActionResult> {
    console.log('🖱️ [DESKTOP] Clicking element via nut.js');
    
    try {
      // Use nut.js to perform the actual click
      const centerX = element.bounds.x + element.bounds.width / 2;
      const centerY = element.bounds.y + element.bounds.height / 2;
      
      await nutjsDetector.clickAtCoordinates(centerX, centerY);
      
      console.log('✅ [DESKTOP] Click successful');
      return { success: true };
    } catch (error: any) {
      console.error('❌ [DESKTOP] Click failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async type(element: Element, text: string): Promise<ActionResult> {
    console.log(`⌨️ [DESKTOP] Typing text: "${text}"`);
    
    try {
      // First, click to focus the element
      await this.click(element);
      
      // Wait a bit for focus
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Use nut.js to type
      await nutjsDetector.typeText(text);
      
      console.log('✅ [DESKTOP] Type successful');
      return { success: true };
    } catch (error: any) {
      console.error('❌ [DESKTOP] Type failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getValue(element: Element): Promise<string> {
    console.log('📖 [DESKTOP] Getting element value');
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    // Query accessibility API for element value
    const result = await ipcRenderer.invoke('desktop:get-value', { 
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
    console.log('⏳ [DESKTOP] Waiting for element:', selector);
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const element = await this.findElement(selector);
      if (element) {
        console.log('✅ [DESKTOP] Element found');
        return element;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.warn('⚠️ [DESKTOP] Element not found within timeout');
    return null;
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
}
