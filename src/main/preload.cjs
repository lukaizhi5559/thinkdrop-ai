const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Overlay controls
  toggleOverlay: () => ipcRenderer.invoke('toggle-overlay'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  showOverlay: () => ipcRenderer.invoke('show-overlay'),
  
  // Global visibility controls
  hideAllWindows: () => ipcRenderer.invoke('hide-all-windows'),
  showAllWindows: () => ipcRenderer.invoke('show-all-windows'),
  getGlobalVisibility: () => ipcRenderer.invoke('get-global-visibility'),
  
  // Chat window controls
  toggleChat: () => ipcRenderer.invoke('toggle-chat'),
  showChat: () => ipcRenderer.invoke('show-chat'),
  hideChat: () => ipcRenderer.invoke('hide-chat'),
  showChatMessages: () => ipcRenderer.invoke('show-chat-messages'),
  hideChatMessages: () => ipcRenderer.invoke('hide-chat-messages'),
  
  // Insight window controls
  showInsight: () => ipcRenderer.invoke('show-insight'),
  hideInsight: () => ipcRenderer.invoke('hide-insight'),
  onInsightUpdate: (callback) => ipcRenderer.on('insight-update', callback),
  
  // Memory debugger window controls
  showMemoryDebugger: () => ipcRenderer.invoke('show-memory-debugger'),
  hideMemoryDebugger: () => ipcRenderer.invoke('hide-memory-debugger'),
  
  // Chat messaging system
  sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
  onChatMessage: (callback) => ipcRenderer.on('chat-message', callback),
  adjustChatMessagesHeight: (height) => ipcRenderer.invoke('adjust-chat-messages-height', height),
  
  // Focus management between chat windows
  focusChatInput: () => ipcRenderer.invoke('focus-chat-input'),
  onMessageLoaded: (callback) => ipcRenderer.on('message-loaded', callback),
  notifyMessageLoaded: () => ipcRenderer.invoke('notify-message-loaded'),
  
  // Core engine communication
  startAudioCapture: () => ipcRenderer.invoke('start-audio-capture'),
  stopAudioCapture: () => ipcRenderer.invoke('stop-audio-capture'),
  startClipboardMonitoring: () => ipcRenderer.invoke('start-clipboard-monitoring'),
  stopClipboardMonitoring: () => ipcRenderer.invoke('stop-clipboard-monitoring'),
  startScreenMonitoring: () => ipcRenderer.invoke('start-screen-monitoring'),
  stopScreenMonitoring: () => ipcRenderer.invoke('stop-screen-monitoring'),
  
  // Agent communication
  processInput: (inputData) => ipcRenderer.invoke('process-input', inputData),
  getSystemHealth: () => ipcRenderer.invoke('get-system-health'),
  
  // LocalLLMAgent communication
  getLocalLLMHealth: () => ipcRenderer.invoke('local-llm:health'),
  processLocalLLMMessage: (message) => ipcRenderer.invoke('local-llm:process-message', message),
  getAllUserMemories: (options = {}) => ipcRenderer.invoke('local-llm:get-all-memories', options),
  llmOrchestrate: (userInput, context) => ipcRenderer.invoke('llm-orchestrate', userInput, context),
  llmQueryLocal: (prompt, options) => ipcRenderer.invoke('llm-query-local', prompt, options),
  llmGetHealth: () => ipcRenderer.invoke('llm-get-health'),
  llmGetCachedAgents: () => ipcRenderer.invoke('llm-get-cached-agents'),
  llmGetCommunications: (limit) => ipcRenderer.invoke('llm-get-communications', limit),
  llmClearCache: () => ipcRenderer.invoke('llm-clear-cache'),
  
  // Orchestration workflow communication
  onOrchestrationUpdate: (callback) => ipcRenderer.on('orchestration-update', callback),
  onInsightOrchestrationUpdate: (callback) => ipcRenderer.on('insight-orchestration-update', callback),
  onClarificationRequest: (callback) => ipcRenderer.on('clarification-request', callback),
  submitClarificationResponse: (stepId, response) => ipcRenderer.invoke('submit-clarification-response', stepId, response),
  startOrchestrationWorkflow: (userInput, context) => ipcRenderer.invoke('start-orchestration-workflow', userInput, context),
  getOrchestrationStatus: (workflowId) => ipcRenderer.invoke('get-orchestration-status', workflowId),
  pauseOrchestrationWorkflow: (workflowId) => ipcRenderer.invoke('pause-orchestration-workflow', workflowId),
  resumeOrchestrationWorkflow: (workflowId) => ipcRenderer.invoke('resume-orchestration-workflow', workflowId),
  
  // Event listeners
  onTranscriptUpdate: (callback) => ipcRenderer.on('transcript-update', callback),
  onClipboardChange: (callback) => ipcRenderer.on('clipboard-change', callback),
  onScreenTextDetected: (callback) => ipcRenderer.on('screen-text-detected', callback),
  onAgentResponse: (callback) => ipcRenderer.on('agent-response', callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // System info
  platform: process.platform,
  version: process.versions.electron
});
