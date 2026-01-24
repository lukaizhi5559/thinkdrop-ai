/**
 * Driver Router
 * 
 * Routes automation actions to the appropriate driver:
 * - Web (Playwright) for browser automation
 * - Desktop (AX/UIA) for native apps
 * - Vision (OmniParser) as fallback
 */

import type { AutomationDriver, ElementSelector, AutomationTarget } from './types';
import { PlaywrightDriver } from './PlaywrightDriver';
import { DesktopDriver } from './DesktopDriver';
import { VisionDriver } from './VisionDriver';

const ipcRenderer = (window as any).electron?.ipcRenderer;

export class DriverRouter {
  private webDriver: PlaywrightDriver;
  private desktopDriver: DesktopDriver;
  private visionDriver: VisionDriver;
  
  private currentDriver: AutomationDriver | null = null;
  private initialized = false;

  constructor() {
    this.webDriver = new PlaywrightDriver();
    this.desktopDriver = new DesktopDriver();
    this.visionDriver = new VisionDriver();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🚦 [ROUTER] Initializing driver router');
    
    // Initialize all drivers (they'll check availability internally)
    await Promise.all([
      this.webDriver.initialize().catch(err => 
        console.warn('⚠️ [ROUTER] Web driver init failed:', err.message)
      ),
      this.desktopDriver.initialize().catch(err => 
        console.warn('⚠️ [ROUTER] Desktop driver init failed:', err.message)
      ),
      this.visionDriver.initialize().catch(err => 
        console.warn('⚠️ [ROUTER] Vision driver init failed:', err.message)
      ),
    ]);
    
    this.initialized = true;
    console.log('✅ [ROUTER] Driver router initialized');
  }

  async cleanup(): Promise<void> {
    if (!this.initialized) return;
    
    console.log('🧹 [ROUTER] Cleaning up driver router');
    
    await Promise.all([
      this.webDriver.cleanup(),
      this.desktopDriver.cleanup(),
      this.visionDriver.cleanup(),
    ]);
    
    this.initialized = false;
  }

  /**
   * Detect the current automation target
   */
  async detectTarget(): Promise<AutomationTarget> {
    if (!ipcRenderer) {
      return { type: 'unknown', confidence: 0 };
    }

    try {
      const result = await ipcRenderer.invoke('automation:detect-target');
      
      if (result.success) {
        console.log('🎯 [ROUTER] Target detected:', result.target);
        return result.target;
      }
    } catch (error: any) {
      console.warn('⚠️ [ROUTER] Target detection failed:', error.message);
    }

    return { type: 'unknown', confidence: 0 };
  }

  /**
   * Select the best driver for the current context
   */
  async selectDriver(selector?: ElementSelector): Promise<AutomationDriver> {
    // If selector explicitly specifies a driver strategy, use it
    if (selector) {
      if (selector.css || selector.xpath || selector.role || selector.testId) {
        console.log('🌐 [ROUTER] Using web driver (selector-based)');
        this.currentDriver = this.webDriver;
        return this.webDriver;
      }
      
      if (selector.axRole || selector.axTitle || selector.uiaType || selector.uiaName) {
        console.log('🖥️ [ROUTER] Using desktop driver (selector-based)');
        this.currentDriver = this.desktopDriver;
        return this.desktopDriver;
      }
      
      if (selector.description && !selector.css && !selector.axRole) {
        console.log('👁️ [ROUTER] Using vision driver (selector-based)');
        this.currentDriver = this.visionDriver;
        return this.visionDriver;
      }
    }

    // Auto-detect based on current target
    const target = await this.detectTarget();
    
    switch (target.type) {
      case 'web':
        if (await this.webDriver.isAvailable()) {
          console.log('🌐 [ROUTER] Using web driver (auto-detected)');
          this.currentDriver = this.webDriver;
          return this.webDriver;
        }
        break;
        
      case 'desktop':
        if (target.hasAccessibility && await this.desktopDriver.isAvailable()) {
          console.log('🖥️ [ROUTER] Using desktop driver (auto-detected)');
          this.currentDriver = this.desktopDriver;
          return this.desktopDriver;
        }
        break;
    }

    // Fallback to vision
    console.log('👁️ [ROUTER] Using vision driver (fallback)');
    this.currentDriver = this.visionDriver;
    return this.visionDriver;
  }

  /**
   * Get the current active driver
   */
  getCurrentDriver(): AutomationDriver | null {
    return this.currentDriver;
  }

  /**
   * Get a specific driver by name
   */
  getDriver(name: 'web' | 'desktop' | 'vision'): AutomationDriver {
    switch (name) {
      case 'web':
        return this.webDriver;
      case 'desktop':
        return this.desktopDriver;
      case 'vision':
        return this.visionDriver;
    }
  }

  /**
   * Check driver availability
   */
  async getAvailableDrivers(): Promise<{
    web: boolean;
    desktop: boolean;
    vision: boolean;
  }> {
    const [web, desktop, vision] = await Promise.all([
      this.webDriver.isAvailable(),
      this.desktopDriver.isAvailable(),
      this.visionDriver.isAvailable(),
    ]);

    return { web, desktop, vision };
  }
}

// Singleton instance
let routerInstance: DriverRouter | null = null;

export function getDriverRouter(): DriverRouter {
  if (!routerInstance) {
    routerInstance = new DriverRouter();
  }
  return routerInstance;
}
