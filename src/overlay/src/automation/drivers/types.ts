/**
 * Automation Driver Types
 * 
 * Common interfaces for multi-driver automation system
 */

export interface ElementSelector {
  // Web selectors (Playwright)
  css?: string;
  xpath?: string;
  text?: string;
  role?: string;
  testId?: string;
  
  // Desktop selectors (Accessibility)
  axRole?: string;      // macOS: AXButton, AXTextField, etc.
  axTitle?: string;     // macOS: element title/label
  uiaType?: string;     // Windows: Button, Edit, etc.
  uiaName?: string;     // Windows: element name
  
  // Vision fallback
  description?: string;
  
  // Direct coordinates
  x?: number;
  y?: number;
}

export interface Element {
  bounds: { x: number; y: number; width: number; height: number };
  selector: ElementSelector;
  driver: 'web' | 'desktop' | 'vision';
  metadata?: any;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  metadata?: any;
}

export interface DriverCapabilities {
  canFindElement: boolean;
  canClick: boolean;
  canType: boolean;
  canGetValue: boolean;
  canWaitFor: boolean;
  canNavigate: boolean;
  canExecuteScript: boolean;
}

/**
 * Base automation driver interface
 */
export interface AutomationDriver {
  name: string;
  capabilities: DriverCapabilities;
  
  // Lifecycle
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  isAvailable(): Promise<boolean>;
  
  // Element operations
  findElement(selector: ElementSelector): Promise<Element | null>;
  findElements(selector: ElementSelector): Promise<Element[]>;
  
  // Actions
  click(element: Element): Promise<ActionResult>;
  type(element: Element, text: string): Promise<ActionResult>;
  getValue(element: Element): Promise<string>;
  
  // Waiting
  waitForElement(selector: ElementSelector, timeout?: number): Promise<Element | null>;
  waitForCondition(condition: () => Promise<boolean>, timeout?: number): Promise<boolean>;
  
  // Navigation (web only)
  navigate?(url: string): Promise<ActionResult>;
  
  // Script execution (web only)
  executeScript?(script: string, ...args: any[]): Promise<any>;
}

/**
 * Target detection result
 */
export interface AutomationTarget {
  type: 'web' | 'desktop' | 'unknown';
  appName?: string;
  url?: string;
  title?: string;
  hasAccessibility?: boolean;
  confidence: number;
}
