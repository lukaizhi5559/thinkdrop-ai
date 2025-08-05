// Declare global for TypeScript - Electron API interface
declare global {
  interface Window {
    electronAPI?: {
      toggleOverlay: () => Promise<void>;
      hideOverlay: () => Promise<void>;
      showOverlay: () => Promise<void>;
      hideAllWindows: () => Promise<void>;
      getGlobalVisibility: () => Promise<boolean>;
      toggleChat: () => Promise<void>;
      showChat: () => Promise<void>;
      hideChat: () => Promise<void>;
      showChatMessages: () => Promise<void>;
      hideChatMessages: () => Promise<void>;
      sendChatMessage: (message: any) => Promise<void>;
      onChatMessage: (callback: (event: any, message: any) => void) => void;
      adjustChatMessagesHeight: (height: number) => Promise<void>;
      
      // Insight window methods
      showInsight: () => Promise<void>;
      hideInsight: () => Promise<void>;
      onInsightUpdate: (callback: (event: any, data: any) => void) => void;
      
      // Memory debugger window methods
      showMemoryDebugger: () => Promise<void>;
      hideMemoryDebugger: () => Promise<void>;
      
      // Focus management between chat windows
      focusChatInput: () => Promise<void>;
      onMessageLoaded: (callback: () => void) => void;
      notifyMessageLoaded: () => Promise<void>;
      startAudioCapture: () => Promise<void>;
      stopAudioCapture: () => Promise<void>;
      onTranscriptUpdate: (callback: (event: any, data: any) => void) => void;
      onAgentResponse: (callback: (event: any, data: any) => void) => void;
      
      // LocalLLMAgent methods
      llmOrchestrate: (userInput: string, context?: any) => Promise<any>;
      llmQueryLocal: (prompt: string, options?: any) => Promise<any>;
      llmGetHealth: () => Promise<any>;
      llmGetCachedAgents: () => Promise<any>;
      llmGetCommunications: (limit?: number) => Promise<any>;
      llmClearCache: () => Promise<any>;
      
      // Dynamic CoreAgent IPC handlers
      agentExecute: (request: { agentName: string; message?: string; input?: string; action?: string; options?: any }) => Promise<any>;
      agentScreenshot: (options?: any) => Promise<any>;
      agentMemoryStore: (data: { content: string; type?: string; tags?: string[]; source?: string }) => Promise<any>;
      agentMemoryQuery: (query: string) => Promise<any>;
      agentMemoryDelete: (memoryId: string) => Promise<any>;
      queryMemoriesDirect: (params: { limit: number; offset: number; searchQuery?: string | null }) => Promise<any>;
      deleteMemoryDirect: (memoryId: string) => Promise<{ success: boolean; deletedCount?: number; error?: string }>;
      agentOrchestrate: (intentPayload: any) => Promise<any>;
      openScreenshotWindow: (imageData: Uint8Array | string) => Promise<{ success: boolean }>;
      
      // Orchestration workflow communication
      onOrchestrationUpdate: (callback: (event: any, data: any) => void) => void;
      onInsightOrchestrationUpdate: (callback: (event: any, data: any) => void) => void;
      onClarificationRequest: (callback: (event: any, data: any) => void) => void;
      submitClarificationResponse: (stepId: string, response: string | boolean) => Promise<any>;
      startOrchestrationWorkflow: (userInput: string, context?: any) => Promise<any>;
      getOrchestrationStatus: (workflowId: string) => Promise<any>;
      pauseOrchestrationWorkflow: (workflowId: string) => Promise<any>;
      resumeOrchestrationWorkflow: (workflowId: string) => Promise<any>;
      
      platform: string;
    };
  }
}

export {}; // Make this file a module
