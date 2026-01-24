/**
 * Vision-Based Automation Driver
 * 
 * Fallback driver using OmniParser/VLM for element detection
 * Uses nut.js for execution
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

export class VisionDriver implements AutomationDriver {
  name = 'vision';
  capabilities: DriverCapabilities = {
    canFindElement: true,
    canClick: true,
    canType: true,
    canGetValue: false,
    canWaitFor: true,
    canNavigate: false,
    canExecuteScript: false,
  };

  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('👁️ [VISION] Initializing Vision driver');
    this.initialized = true;
    console.log('✅ [VISION] Driver initialized');
  }

  async cleanup(): Promise<void> {
    if (!this.initialized) return;
    
    console.log('🧹 [VISION] Cleaning up Vision driver');
    this.initialized = false;
  }

  async isAvailable(): Promise<boolean> {
    return ipcRenderer !== undefined;
  }

  async findElement(selector: ElementSelector): Promise<Element | null> {
    console.log('🔍 [VISION] Finding element with vision:', selector);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    if (!selector.description) {
      throw new Error('Vision driver requires description in selector');
    }

    // Capture screenshot
    const screenshot = await this.captureScreenshot();

    // Use Vision API to find element
    const result = await ipcRenderer.invoke('vision:find-element', { 
      screenshot,
      description: selector.description 
    });

    if (!result.success || !result.coordinates) {
      console.warn('⚠️ [VISION] Element not found');
      return null;
    }

    // Vision API returns center coordinates, estimate bounds
    const estimatedSize = 50; // Rough estimate
    return {
      bounds: {
        x: result.coordinates.x - estimatedSize / 2,
        y: result.coordinates.y - estimatedSize / 2,
        width: estimatedSize,
        height: estimatedSize,
      },
      selector,
      driver: 'vision',
      metadata: { confidence: result.confidence },
    };
  }

  async findElements(selector: ElementSelector): Promise<Element[]> {
    console.log('🔍 [VISION] Finding multiple elements with vision:', selector);
    
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    if (!selector.description) {
      throw new Error('Vision driver requires description in selector');
    }

    // Capture screenshot
    const screenshot = await this.captureScreenshot();

    // Use Vision API to find all matching elements
    const result = await ipcRenderer.invoke('vision:find-elements', { 
      screenshot,
      description: selector.description 
    });

    if (!result.success || !result.elements) {
      return [];
    }

    const estimatedSize = 50;
    return result.elements.map((coords: { x: number; y: number; confidence?: number }) => ({
      bounds: {
        x: coords.x - estimatedSize / 2,
        y: coords.y - estimatedSize / 2,
        width: estimatedSize,
        height: estimatedSize,
      },
      selector,
      driver: 'vision' as const,
      metadata: { confidence: coords.confidence },
    }));
  }

  async click(element: Element): Promise<ActionResult> {
    console.log('🖱️ [VISION] Clicking element via nut.js');
    
    try {
      // Use nut.js to perform the actual click
      const centerX = element.bounds.x + element.bounds.width / 2;
      const centerY = element.bounds.y + element.bounds.height / 2;
      
      await nutjsDetector.clickAtCoordinates(centerX, centerY);
      
      console.log('✅ [VISION] Click successful');
      return { success: true };
    } catch (error: any) {
      console.error('❌ [VISION] Click failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async type(element: Element, text: string): Promise<ActionResult> {
    console.log(`⌨️ [VISION] Typing text: "${text}"`);
    
    try {
      // First, click to focus the element
      await this.click(element);
      
      // Wait a bit for focus
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Use nut.js to type
      await nutjsDetector.typeText(text);
      
      console.log('✅ [VISION] Type successful');
      return { success: true };
    } catch (error: any) {
      console.error('❌ [VISION] Type failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getValue(_element: Element): Promise<string> {
    throw new Error('Vision driver does not support getValue - use OCR instead');
  }

  async waitForElement(
    selector: ElementSelector, 
    timeout: number = 5000
  ): Promise<Element | null> {
    console.log('⏳ [VISION] Waiting for element:', selector);
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const element = await this.findElement(selector);
      if (element) {
        console.log('✅ [VISION] Element found');
        return element;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.warn('⚠️ [VISION] Element not found within timeout');
    return null;
  }

  async waitForCondition(
    condition: () => Promise<boolean>, 
    timeout: number = 5000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        if (await condition()) {
          return true;
        }
      } catch (error) {
        // Continue waiting even if condition check fails
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return false;
  }

  private async captureScreenshot(): Promise<string> {
    if (!ipcRenderer) {
      throw new Error('IPC renderer not available');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Screenshot capture timeout'));
      }, 10000);

      ipcRenderer.once('screenshot:captured', (_event: any, screenshot: string) => {
        clearTimeout(timeout);
        resolve(screenshot);
      });

      ipcRenderer.once('screenshot:error', (_event: any, error: string) => {
        clearTimeout(timeout);
        reject(new Error(error));
      });

      ipcRenderer.send('screenshot:capture');
    });
  }
}
