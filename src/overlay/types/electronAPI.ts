/**
 * Type definitions for electronAPI in overlay windows
 * Matches the preload.cjs exposed API
 */

export interface ElectronAPI {
  // IPC send
  send: (channel: string, data?: any) => void;
  
  // IPC receive
  receive: (channel: string, func: (event: any, ...args: any[]) => void) => void;
  
  // Active window updates
  onActiveWindowUpdate: (callback: (event: any, data: { windowName: string; app: string; url?: string; windowId?: string }) => void) => void;
  
  // Other methods from preload
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, func: (...args: any[]) => void) => void;
  once: (channel: string, func: (...args: any[]) => void) => void;
  removeListener: (channel: string, func: (...args: any[]) => void) => void;
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
