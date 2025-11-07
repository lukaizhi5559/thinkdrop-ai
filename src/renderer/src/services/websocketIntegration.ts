/**
 * WebSocket Integration Service for ThinkDrop AI Frontend
 * Connects React frontend to bibscrip-backend WebSocket streaming
 */

// Browser-compatible EventEmitter implementation
class SimpleEventEmitter {
  private events: { [key: string]: Function[] } = {};

  on(event: string, listener: Function) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  emit(event: string, ...args: any[]) {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
    }
  }

  off(event: string, listener: Function) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(l => l !== listener);
    }
  }

  removeAllListeners(event?: string) {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }
  }
}

// TypeScript interfaces matching the integration guide
export interface StreamingMessage {
  id: string;
  type: StreamingMessageType;
  payload: any;
  timestamp: number;
  parentId?: string;
  metadata?: StreamingMetadata;
}

export interface StreamingMetadata {
  source: 'local_llm' | 'backend_llm' | 'voice_service' | 'orchestration';
  provider?: string;
  sessionId?: string;
  userId?: string;
  clientId?: string;
}

export type StreamingMessageType = 
  | 'connection_status'
  | 'llm_request'
  | 'llm_stream_start'
  | 'llm_stream_chunk'
  | 'llm_stream_end'
  | 'voice_stt_start'
  | 'voice_stt_chunk'
  | 'voice_stt_end'
  | 'voice_tts_request'
  | 'voice_tts_chunk'
  | 'voice_tts_end'
  | 'conversation_chunk'
  | 'interrupt'
  | 'cancel'
  | 'error';

export interface StreamingError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface LLMStreamRequest {
  prompt: string;
  provider?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    taskType?: 'ask' | 'generate_agent' | 'orchestrate';
    [key: string]: any;
  };
  context?: {
    recentContext?: Array<{
      role: string;
      content: string;
      timestamp: string;
      messageId: string;
    }>;
    [key: string]: any;
  };
}

export interface WebSocketConfig {
  backendHost?: string;
  websocketUrl?: string;
  apiKey: string;
  userId?: string;
  clientId?: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  autoConnect?: boolean;
}

/**
 * Get WebSocket configuration for browser/Electron renderer environment
 */
export function getWebSocketConfig(): Partial<WebSocketConfig> {
  // Default configuration that works in browser/Electron renderer
  const config: Partial<WebSocketConfig> = {
    websocketUrl: 'ws://localhost:4000/ws/stream',
    backendHost: 'localhost:4000',
    apiKey: 'test-api-key-123',
    userId: 'default-user',
    clientId: `client-${Date.now()}`
  };
  
  // Try to get config from window object if available (set by main process)
  if (typeof window !== 'undefined' && (window as any).electronAPI?.getConfig) {
    try {
      const electronConfig = (window as any).electronAPI.getConfig();
      if (electronConfig.websocketUrl) config.websocketUrl = electronConfig.websocketUrl;
      if (electronConfig.backendHost) config.backendHost = electronConfig.backendHost;
      if (electronConfig.apiKey) config.apiKey = electronConfig.apiKey;
      if (electronConfig.userId) config.userId = electronConfig.userId;
      if (electronConfig.clientId) config.clientId = electronConfig.clientId;
    } catch (error) {
      console.warn('Could not load Electron config, using defaults:', error);
    }
  }
  
  return config;
}

export class WebSocketIntegration extends SimpleEventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<Omit<WebSocketConfig, 'websocketUrl'>> & { websocketUrl?: string };
  private isConnected = false;
  private reconnectCount = 0;
  private activeRequests = new Map<string, { type: string; startTime: number }>();
  private messageQueue: StreamingMessage[] = [];
  private reconnectTimer: any | null = null;
  private heartbeatTimer: any | null = null;
  private heartbeatInterval = 30000; // Send ping every 30 seconds

  constructor(config: WebSocketConfig) {
    super();
    
    this.config = {
      backendHost: config.backendHost || 'localhost:4000',
      websocketUrl: config.websocketUrl,
      apiKey: config.apiKey,
      userId: config.userId || '',
      clientId: config.clientId || `client_${Date.now()}`,
      reconnectAttempts: config.reconnectAttempts || 5,
      reconnectDelay: config.reconnectDelay || 1000,
      autoConnect: config.autoConnect ?? true
    };

    if (this.config.autoConnect) {
      this.connect().catch(console.error);
    }
  }

  /**
   * Establish WebSocket connection
   */
  async connect(): Promise<void> {
    try {
      let url: URL;
      
      if (this.config.websocketUrl) {
        // Use direct WebSocket URL if provided
        url = new URL(this.config.websocketUrl);
      } else {
        // Construct URL from backend host
        const protocol = this.config.backendHost.includes('localhost') ? 'ws' : 'wss';
        url = new URL(`${protocol}://${this.config.backendHost}/ws/stream`);
      }
      
      // Add authentication parameters
      url.searchParams.set('apiKey', this.config.apiKey);
      if (this.config.userId) {
        url.searchParams.set('userId', this.config.userId);
      }
      url.searchParams.set('clientId', this.config.clientId);
      
      // Connecting to WebSocket
      this.ws = new WebSocket(url.toString());
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);
        
        this.ws!.onopen = () => {
          clearTimeout(timeout);
          this.handleOpen();
          resolve();
        };
        
        this.ws!.onmessage = this.handleMessage.bind(this);
        this.ws!.onclose = this.handleClose.bind(this);
        this.ws!.onerror = (error) => {
          clearTimeout(timeout);
          this.handleError(error);
          reject(error);
        };
      });
      
    } catch (error) {
      console.error(`❌ WebSocket connection failed:`, error);
      throw error;
    }
  }

  private handleOpen(): void {
    // WebSocket connected
    this.isConnected = true;
    this.reconnectCount = 0;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Start heartbeat to keep connection alive
    this.startHeartbeat();
    
    // Process queued messages
    this.processMessageQueue();
    
    this.emit('connected');
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message: StreamingMessage = JSON.parse(event.data);
      // Skip logging for reduced noise
      
      // Emit specific event types
      this.emit(message.type, message);
      this.emit('message', message);
      
      // Handle request completion
      if (message.type === 'llm_stream_end' || message.type === 'voice_tts_end') {
        this.activeRequests.delete(message.parentId || message.id);
      }
      
    } catch (error) {
      console.error(`Failed to parse WebSocket message:`, error);
    }
  }

  private handleClose(event: CloseEvent): void {
    // WebSocket connection closed
    this.isConnected = false;
    this.ws = null;
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    this.emit('disconnected', { code: event.code, reason: event.reason });
    
    // Attempt reconnection if not a clean close
    if (event.code !== 1000 && this.reconnectCount < this.config.reconnectAttempts) {
      this.attemptReconnect();
    }
  }

  private handleError(error: Event): void {
    console.error(`❌ WebSocket error:`, error);
    this.emit('error', error);
  }

  private attemptReconnect(): void {
    this.reconnectCount++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectCount - 1);
        // Attempting reconnection
      this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error(`Reconnection attempt ${this.reconnectCount} failed:`, error);
        
        if (this.reconnectCount >= this.config.reconnectAttempts) {
          console.error('❌ Max reconnection attempts reached');
          this.emit('reconnect_failed');
        }
      }
    }, delay);
  }

  /**
   * Send message to WebSocket server
   */
  private sendMessage(message: Omit<StreamingMessage, 'timestamp'>): void {
    if (!this.isConnected || !this.ws) {
      console.warn('WebSocket not connected, queueing message');
      this.messageQueue.push({ ...message, timestamp: Date.now() });
      return;
    }
    
    try {
      const messageWithTimestamp: StreamingMessage = {
        ...message,
        timestamp: Date.now()
      };
      
      this.ws.send(JSON.stringify(messageWithTimestamp));
      // Message sent: ${message.type}
      
    } catch (error) {
      console.error(`Failed to send WebSocket message:`, error);
      throw error;
    }
  }

  private processMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.sendMessage(message);
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    // Clear any existing heartbeat
    this.stopHeartbeat();
    
    // Send ping every 30 seconds to keep connection alive
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws) {
        try {
          // Send a ping message to keep connection alive
          this.sendMessage({
            id: `ping_${Date.now()}`,
            type: 'connection_status',
            payload: { status: 'ping' }
          });
        } catch (error) {
          console.error('❌ Failed to send heartbeat:', error);
        }
      }
    }, this.heartbeatInterval);
    
    // Heartbeat started
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      // Heartbeat stopped
    }
  }

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  /**
   * Send LLM request for text-to-text streaming
   */
  async sendLLMRequest(request: LLMStreamRequest): Promise<string> {
    const requestId = `req_${Date.now()}`;
    
    this.sendMessage({
      id: requestId,
      type: 'llm_request',
      payload: request
    });
    
    this.activeRequests.set(requestId, { type: 'llm', startTime: Date.now() });
    return requestId;
  }

  /**
   * Generate a new agent/Drop
   */
  async generateAgent(description: string, options: Record<string, any> = {}): Promise<string> {
    const requestId = `req_gen_agent_${Date.now()}`;
    
    this.sendMessage({
      id: requestId,
      type: 'llm_request',
      payload: {
        prompt: description,
        options: {
          taskType: 'generate_agent',
          ...options
        }
      }
    });
    
    this.activeRequests.set(requestId, { type: 'agent_generation', startTime: Date.now() });
    return requestId;
  }

  /**
   * Orchestrate a workflow
   */
  async orchestrateWorkflow(command: string, options: Record<string, any> = {}): Promise<string> {
    const requestId = `req_orch_${Date.now()}`;
    
    this.sendMessage({
      id: requestId,
      type: 'llm_request',
      payload: {
        prompt: command,
        options: {
          taskType: 'orchestrate',
          ...options
        }
      }
    });
    
    this.activeRequests.set(requestId, { type: 'orchestration', startTime: Date.now() });
    return requestId;
  }

  /**
   * Start voice-to-text streaming
   */
  startVoiceSTT(options: Record<string, any> = {}): string {
    const requestId = `stt_${Date.now()}`;
    
    this.sendMessage({
      id: requestId,
      type: 'voice_stt_start',
      payload: {
        format: 'webm',
        sampleRate: 44100,
        channels: 1,
        ...options
      }
    });
    
    this.activeRequests.set(requestId, { type: 'stt', startTime: Date.now() });
    return requestId;
  }

  /**
   * Send audio chunk for STT
   */
  sendAudioChunk(requestId: string, audioData: string, options: Record<string, any> = {}): void {
    this.sendMessage({
      id: `stt_chunk_${Date.now()}`,
      type: 'voice_stt_chunk',
      payload: {
        audioData,
        format: 'webm',
        sampleRate: 44100,
        channels: 1,
        duration: 100,
        ...options
      },
      parentId: requestId
    });
  }

  /**
   * End voice-to-text streaming
   */
  endVoiceSTT(requestId: string): void {
    this.sendMessage({
      id: `stt_end_${Date.now()}`,
      type: 'voice_stt_end',
      payload: {},
      parentId: requestId
    });
  }

  /**
   * Request text-to-speech
   */
  async requestTTS(text: string, options: Record<string, any> = {}): Promise<string> {
    const requestId = `tts_req_${Date.now()}`;
    
    this.sendMessage({
      id: requestId,
      type: 'voice_tts_request',
      payload: {
        text,
        voice: 'alloy',
        speed: 1.0,
        pitch: 1.0,
        provider: 'openai',
        ...options
      }
    });
    
    this.activeRequests.set(requestId, { type: 'tts', startTime: Date.now() });
    return requestId;
  }

  /**
   * Interrupt current stream
   */
  interrupt(targetId: string): void {
    this.sendMessage({
      id: `ctrl_${Date.now()}`,
      type: 'interrupt',
      payload: { targetId }
    });
  }

  /**
   * Cancel entire request
   */
  cancel(targetId: string): void {
    this.sendMessage({
      id: `ctrl_${Date.now()}`,
      type: 'cancel',
      payload: { targetId }
    });
    
    this.activeRequests.delete(targetId);
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      reconnectCount: this.reconnectCount,
      activeRequests: this.activeRequests.size,
      queuedMessages: this.messageQueue.length
    };
  }

  /**
   * Get active requests
   */
  getActiveRequests() {
    return Array.from(this.activeRequests.entries()).map(([id, info]) => ({
      id,
      type: info.type,
      duration: Date.now() - info.startTime
    }));
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<WebSocketConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    this.isConnected = false;
    this.activeRequests.clear();
    this.messageQueue.length = 0;
  }
}

export default WebSocketIntegration;
