const { contextBridge, ipcRenderer, shell } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Overlay controls
  toggleOverlay: () => ipcRenderer.invoke('toggle-overlay'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  showOverlay: () => ipcRenderer.invoke('show-overlay'),
  
  // Window visibility for automation (hide during command execution)
  hideWindow: () => ipcRenderer.invoke('window-hide'),
  showWindow: () => ipcRenderer.invoke('window-show'),
  
  // Global visibility controls
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
  onInsightUpdate: (callback) => ipcRenderer.on('insight:update', callback),
  onInsightLoading: (callback) => ipcRenderer.on('insight:loading', callback),
  onInsightError: (callback) => ipcRenderer.on('insight:error', callback),
  refreshInsight: () => ipcRenderer.send('insight:refresh'),
  refreshInsightWithQuery: (query) => ipcRenderer.send('insight:refresh-with-query', query),
  requestHighlightInsight: (selectedText, context) => ipcRenderer.send('insight:highlight', selectedText, context),
  
  // Insight History
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  
  // Memory debugger window controls
  showMemoryDebugger: () => ipcRenderer.invoke('show-memory-debugger'),
  hideMemoryDebugger: () => ipcRenderer.invoke('hide-memory-debugger'),
  
  // Chat messaging system
  sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
  onChatMessage: (callback) => ipcRenderer.on('chat-message', callback),
  onPopulateChatInput: (callback) => ipcRenderer.on('populate-chat-input', callback),
  onThinkingIndicatorUpdate: (callback) => ipcRenderer.on('thinking-indicator-update', callback),
  onActiveWindowUpdate: (callback) => ipcRenderer.on('active-window-update', callback),
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
  agentExecute: (request) => ipcRenderer.invoke('agent-execute', request),
  agentOrchestrate: (request) => ipcRenderer.invoke('agent-orchestrate', request),
  openScreenshotWindow: (imageData) => ipcRenderer.invoke('open-screenshot-window', imageData),
  
  // Direct memory queries for fast loading
  queryMemoriesDirect: (params) => ipcRenderer.invoke('query-memories-direct', params),
  deleteMemoryDirect: (memoryId) => ipcRenderer.invoke('delete-memory-direct', memoryId),
  
  // Conversation session management
  'conversation-session-list': (params) => ipcRenderer.invoke('conversation-session-list', params),
  'conversation-session-create': (params) => ipcRenderer.invoke('conversation-session-create', params),
  'conversation-session-update': (params) => ipcRenderer.invoke('conversation-session-update', params),
  'conversation-session-delete': (params) => ipcRenderer.invoke('conversation-session-delete', params),
  'conversation-session-get': (params) => ipcRenderer.invoke('conversation-session-get', params),
  'conversation-message-add': (sessionId, message) => ipcRenderer.invoke('conversation-message-add', sessionId, message),
  'conversation-message-list': (params) => ipcRenderer.invoke('conversation-message-list', params),
  'conversation-message-update': (params) => ipcRenderer.invoke('conversation-message-update', params),
  
  // LocalLLMAgent communication (DEPRECATED - use MCP Private Mode)
  getLocalLLMHealth: () => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  processLocalLLMMessage: (message) => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  llmOrchestrate: (userInput, context) => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  llmQueryLocal: (prompt, options) => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  llmQuery: (prompt, context) => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  llmGetHealth: () => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  llmGetCachedAgents: () => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  llmGetCommunications: (limit) => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),
  llmClearCache: () => Promise.resolve({ success: false, error: 'Deprecated: Use MCP mode' }),

  // Progressive search APIs
  localLLMProgressiveSearch: (prompt, context) => ipcRenderer.invoke('local-llm-progressive-search', { prompt, context }),
  localLLMStage1Search: (prompt, context) => ipcRenderer.invoke('local-llm-stage1-search', { prompt, context }),
  localLLMStage2Search: (prompt, context) => ipcRenderer.invoke('local-llm-stage2-search', { prompt, context }),
  localLLMStage3Search: (prompt, context) => ipcRenderer.invoke('local-llm-stage3-search', { prompt, context }),
  onProgressiveSearchIntermediate: (callback) => ipcRenderer.on('progressive-search-intermediate', callback),
  
  // MCP Private Mode
  privateModeProcess: (params) => ipcRenderer.invoke('private-mode:process', params),
  onPrivateModeProgress: (callback) => ipcRenderer.on('private-mode:progress', callback),
  onPrivateModeEarlyResponse: (callback) => ipcRenderer.on('private-mode:early-response', callback),
  onPrivateModeStreamToken: (callback) => ipcRenderer.on('private-mode:stream-token', callback),
  onPrivateModeSelectionDetected: (callback) => ipcRenderer.on('private-mode:selection-detected', callback),
  removePrivateModeListeners: () => {
    ipcRenderer.removeAllListeners('private-mode:progress');
    ipcRenderer.removeAllListeners('private-mode:early-response');
    ipcRenderer.removeAllListeners('private-mode:stream-token');
    ipcRenderer.removeAllListeners('private-mode:selection-detected');
  },
  
  // Selection Detection
  checkSelection: () => ipcRenderer.invoke('selection:check'),
  clearPersistedSelection: () => ipcRenderer.send('selection:clear'),
  onSelectionAvailable: (callback) => ipcRenderer.on('selection:available', callback),
  removeSelectionListener: () => ipcRenderer.removeAllListeners('selection:available'),
  
  // Selection Overlay (for floating ThinkDrop button)
  send: (channel, data) => ipcRenderer.send(channel, data),
  receive: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),
  
  // MCP Service Communication
  mcpCall: (params) => ipcRenderer.invoke('mcp:service:call', params),
  
  // MCP Workflow Performance Monitoring
  getWorkflowTraces: (params) => ipcRenderer.invoke('mcp:workflow:traces', params),
  clearWorkflowTraces: () => ipcRenderer.invoke('mcp:workflow:clear-traces'),
  
  // MCP Streaming Service Communication
  mcpCallStream: (params, onToken, onProgress) => {
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Set up event listeners for this stream
    const tokenListener = (event, data) => {
      if (onToken) onToken(data.token);
    };
    
    const progressListener = (event, data) => {
      if (onProgress) onProgress(data);
    };
    
    const doneListener = (event, data) => {
      // Clean up listeners when done
      ipcRenderer.removeListener(`mcp:stream:token:${streamId}`, tokenListener);
      ipcRenderer.removeListener(`mcp:stream:progress:${streamId}`, progressListener);
      ipcRenderer.removeListener(`mcp:stream:done:${streamId}`, doneListener);
      ipcRenderer.removeListener(`mcp:stream:error:${streamId}`, errorListener);
    };
    
    const errorListener = (event, data) => {
      // Clean up listeners on error
      ipcRenderer.removeListener(`mcp:stream:token:${streamId}`, tokenListener);
      ipcRenderer.removeListener(`mcp:stream:progress:${streamId}`, progressListener);
      ipcRenderer.removeListener(`mcp:stream:done:${streamId}`, doneListener);
      ipcRenderer.removeListener(`mcp:stream:error:${streamId}`, errorListener);
    };
    
    // Register listeners
    ipcRenderer.on(`mcp:stream:token:${streamId}`, tokenListener);
    ipcRenderer.on(`mcp:stream:progress:${streamId}`, progressListener);
    ipcRenderer.on(`mcp:stream:done:${streamId}`, doneListener);
    ipcRenderer.on(`mcp:stream:error:${streamId}`, errorListener);
    
    // Start the stream
    return ipcRenderer.invoke('mcp:service:call:stream', { ...params, streamId });
  },
  
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
  
  // External link handling
  openExternal: (url) => ipcRenderer.invoke('open-external-link', url),
  
  // Gemini OAuth
  geminiOAuthStart: () => ipcRenderer.invoke('gemini:oauth:start'),
  geminiOAuthRevoke: () => ipcRenderer.invoke('gemini:oauth:revoke'),
  geminiStatus: () => ipcRenderer.invoke('gemini:status'),
  
  // Vision OAuth
  visionOAuthStart: () => ipcRenderer.invoke('vision:oauth:start'),
  visionOAuthRevoke: () => ipcRenderer.invoke('vision:oauth:revoke'),
  visionStatus: () => ipcRenderer.invoke('vision:status'),
  
  // Screen Intelligence Overlay
  onScreenIntelligence: (channel, callback) => {
    const validChannels = [
      'show-highlights',
      'show-discovery',
      'show-toast',
      'hide-toast',
      'show-guide',
      'clear-all'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(`screen-intelligence:${channel}`, (event, data) => callback(data));
    }
  },
  setOverlayClickable: (isClickable) => {
    ipcRenderer.send('overlay:set-clickable', isClickable);
  },
  highlightElement: (elementData) => {
    ipcRenderer.send('screen-intelligence:highlight', elementData);
  },
  
  // Generic IPC methods for custom communication
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, callback) => ipcRenderer.on(channel, callback),
  
  // System info
  platform: process.platform,
  version: process.versions.electron
});
