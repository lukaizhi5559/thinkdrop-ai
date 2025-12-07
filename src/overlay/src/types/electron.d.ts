// Type definitions for Electron API exposed via preload script

interface ElectronAPI {
  // MCP Service calls
  mcpCall: (params: {
    serviceName: string;
    action: string;
    payload?: any;
  }) => Promise<any>;

  // Agent execution
  agentExecute: (params: {
    agentName: string;
    action: string;
    options?: any;
  }) => Promise<any>;

  // IPC communication
  send: (channel: string, ...args: any[]) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  once: (channel: string, callback: (...args: any[]) => void) => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;
  removeAllListeners: (channel: string) => void;

  // Selection handling
  onSelectionAvailable?: (callback: (event: any, data: any) => void) => void;
  removeSelectionListener?: () => void;
  clearPersistedSelection?: () => void;
  getSelectionWithContext?: () => Promise<any>;

  // Private mode / MCP streaming
  privateModeProcess?: (params: any) => Promise<any>;
  onPrivateModeEarlyResponse?: (callback: (event: any, data: any) => void) => void;
  onPrivateModeProgress?: (callback: (event: any, data: any) => void) => void;
  onPrivateModeStreamToken?: (callback: (event: any, data: any) => void) => void;
  removePrivateModeListeners?: () => void;

  // Thinking indicators and chat messages
  onThinkingIndicatorUpdate?: (callback: (event: any, data: any) => void) => void;
  onChatMessage?: (callback: (event: any, data: any) => void) => void;
  onOrchestrationUpdate?: (callback: (event: any, data: any) => void) => void;

  // System
  getSystemInfo?: () => Promise<any>;
  captureScreen?: () => Promise<any>;
}

interface Window {
  electronAPI: ElectronAPI;
  electron?: {
    ipcRenderer: {
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => void;
      once: (channel: string, callback: (...args: any[]) => void) => void;
      removeListener: (channel: string, callback: (...args: any[]) => void) => void;
    };
  };
}
