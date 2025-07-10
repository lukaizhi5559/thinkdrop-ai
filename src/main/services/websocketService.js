/**
 * WebSocket Service for Bibscrip-Backend Integration
 * Handles real-time streaming communication for LLM, voice, and agent orchestration
 */

import { EventEmitter } from 'events';

export class WebSocketService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      backendHost: options.backendHost || 'localhost:8000',
      apiKey: options.apiKey || '',
      userId: options.userId || '',
      clientId: options.clientId || `client_${Date.now()}`,
      reconnectAttempts: options.reconnectAttempts || 5,
      reconnectDelay: options.reconnectDelay || 1000,
      ...options
    };
    
    this.ws = null;
    this.isConnected = false;
    this.reconnectCount = 0;
    this.activeRequests = new Map(); // Track active streaming requests
    this.messageQueue = []; // Queue messages when disconnected
    
    this.logger = options.logger || console;
  }

  /**
   * Establish WebSocket connection to backend
   */
  async connect() {
    try {
      const protocol = this.config.backendHost.includes('localhost') ? 'ws' : 'wss';
      const url = new URL(`${protocol}://${this.config.backendHost}/ws/stream`);
      
      // Add required query parameters
      url.searchParams.set('apiKey', this.config.apiKey);
      if (this.config.userId) {
        url.searchParams.set('userId', this.config.userId);
      }
      url.searchParams.set('clientId', this.config.clientId);
      
      this.logger.info(`🔌 Connecting to WebSocket: ${url.toString()}`);
      
      this.ws = new WebSocket(url.toString());
      
      // Set up event handlers
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      
      // Return promise that resolves when connected
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);
        
        this.once('connected', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        this.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      
    } catch (error) {
      this.logger.error(`❌ WebSocket connection failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle WebSocket connection opened
   */
  handleOpen() {
    this.logger.info('✅ WebSocket connected successfully');
    this.isConnected = true;
    this.reconnectCount = 0;
    
    // Process queued messages
    this.processMessageQueue();
    
    this.emit('connected');
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      this.logger.debug(`📨 Received message: ${message.type}`, message);
      
      // Handle different message types
      switch (message.type) {
        case 'connection_status':
          this.handleConnectionStatus(message);
          break;
        case 'llm_stream_start':
          this.handleLLMStreamStart(message);
          break;
        case 'llm_stream_chunk':
          this.handleLLMStreamChunk(message);
          break;
        case 'llm_stream_end':
          this.handleLLMStreamEnd(message);
          break;
        case 'voice_stt_chunk':
          this.handleVoiceSTTChunk(message);
          break;
        case 'voice_tts_chunk':
          this.handleVoiceTTSChunk(message);
          break;
        case 'voice_tts_end':
          this.handleVoiceTTSEnd(message);
          break;
        case 'conversation_chunk':
          this.handleConversationChunk(message);
          break;
        case 'error':
          this.handleStreamingError(message);
          break;
        default:
          this.logger.warn(`Unknown message type: ${message.type}`);
          this.emit('message', message);
      }
      
    } catch (error) {
      this.logger.error(`Failed to parse WebSocket message: ${error.message}`);
    }
  }

  /**
   * Handle WebSocket connection closed
   */
  handleClose(event) {
    this.logger.warn(`🔌 WebSocket connection closed: ${event.code} - ${event.reason}`);
    this.isConnected = false;
    this.ws = null;
    
    this.emit('disconnected', { code: event.code, reason: event.reason });
    
    // Attempt reconnection if not a clean close
    if (event.code !== 1000 && this.reconnectCount < this.config.reconnectAttempts) {
      this.attemptReconnect();
    }
  }

  /**
   * Handle WebSocket errors
   */
  handleError(error) {
    this.logger.error(`❌ WebSocket error: ${error.message}`);
    this.emit('error', error);
  }

  /**
   * Attempt to reconnect to WebSocket
   */
  async attemptReconnect() {
    this.reconnectCount++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectCount - 1);
    
    this.logger.info(`🔄 Attempting reconnection ${this.reconnectCount}/${this.config.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.logger.error(`Reconnection attempt ${this.reconnectCount} failed: ${error.message}`);
        
        if (this.reconnectCount >= this.config.reconnectAttempts) {
          this.logger.error('❌ Max reconnection attempts reached');
          this.emit('reconnect_failed');
        }
      }
    }, delay);
  }

  /**
   * Send message to WebSocket server
   */
  sendMessage(message) {
    if (!this.isConnected) {
      this.logger.warn('WebSocket not connected, queueing message');
      this.messageQueue.push(message);
      return;
    }
    
    try {
      const messageWithTimestamp = {
        ...message,
        timestamp: Date.now()
      };
      
      this.ws.send(JSON.stringify(messageWithTimestamp));
      this.logger.debug(`📤 Sent message: ${message.type}`, messageWithTimestamp);
      
    } catch (error) {
      this.logger.error(`Failed to send WebSocket message: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process queued messages when connection is restored
   */
  processMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.sendMessage(message);
    }
  }

  // =============================================================================
  // LLM STREAMING METHODS
  // =============================================================================

  /**
   * Send LLM request for text-to-text streaming
   */
  async sendLLMRequest(prompt, options = {}) {
    const requestId = `req_${Date.now()}`;
    
    const message = {
      id: requestId,
      type: 'llm_request',
      payload: {
        prompt,
        provider: options.provider || 'claude',
        options: {
          temperature: options.temperature || 0.7,
          taskType: options.taskType || 'ask',
          maxTokens: options.maxTokens || 1000,
          ...options
        }
      }
    };
    
    this.sendMessage(message);
    this.activeRequests.set(requestId, { type: 'llm', startTime: Date.now() });
    
    return requestId;
  }

  /**
   * Generate a new agent/Drop
   */
  async generateAgent(description, options = {}) {
    const requestId = `req_gen_agent_${Date.now()}`;
    
    const message = {
      id: requestId,
      type: 'llm_request',
      payload: {
        prompt: description,
        options: {
          taskType: 'generate_agent', // Critical for agent generation
          ...options
        }
      }
    };
    
    this.sendMessage(message);
    this.activeRequests.set(requestId, { type: 'agent_generation', startTime: Date.now() });
    
    return requestId;
  }

  /**
   * Orchestrate a workflow
   */
  async orchestrateWorkflow(command, options = {}) {
    const requestId = `req_orch_${Date.now()}`;
    
    const message = {
      id: requestId,
      type: 'llm_request',
      payload: {
        prompt: command,
        options: {
          taskType: 'orchestrate',
          ...options
        }
      }
    };
    
    this.sendMessage(message);
    this.activeRequests.set(requestId, { type: 'orchestration', startTime: Date.now() });
    
    return requestId;
  }

  // =============================================================================
  // VOICE STREAMING METHODS
  // =============================================================================

  /**
   * Start voice-to-text streaming
   */
  startVoiceSTT(options = {}) {
    const requestId = `stt_${Date.now()}`;
    
    const message = {
      id: requestId,
      type: 'voice_stt_start',
      payload: {
        format: options.format || 'webm',
        sampleRate: options.sampleRate || 44100,
        channels: options.channels || 1,
        ...options
      }
    };
    
    this.sendMessage(message);
    this.activeRequests.set(requestId, { type: 'stt', startTime: Date.now() });
    
    return requestId;
  }

  /**
   * Send audio chunk for STT
   */
  sendAudioChunk(requestId, audioData, options = {}) {
    const message = {
      id: `stt_chunk_${Date.now()}`,
      type: 'voice_stt_chunk',
      payload: {
        audioData, // Base64 encoded audio
        format: options.format || 'webm',
        sampleRate: options.sampleRate || 44100,
        channels: options.channels || 1,
        duration: options.duration || 100,
        ...options
      },
      parentId: requestId
    };
    
    this.sendMessage(message);
  }

  /**
   * End voice-to-text streaming
   */
  endVoiceSTT(requestId) {
    const message = {
      id: `stt_end_${Date.now()}`,
      type: 'voice_stt_end',
      payload: {},
      parentId: requestId
    };
    
    this.sendMessage(message);
  }

  /**
   * Request text-to-speech
   */
  async requestTTS(text, options = {}) {
    const requestId = `tts_req_${Date.now()}`;
    
    const message = {
      id: requestId,
      type: 'voice_tts_request',
      payload: {
        text,
        voice: options.voice || 'alloy',
        speed: options.speed || 1.0,
        pitch: options.pitch || 1.0,
        provider: options.provider || 'openai',
        ...options
      }
    };
    
    this.sendMessage(message);
    this.activeRequests.set(requestId, { type: 'tts', startTime: Date.now() });
    
    return requestId;
  }

  // =============================================================================
  // CONTROL METHODS
  // =============================================================================

  /**
   * Interrupt current stream (e.g., stop TTS playback)
   */
  interrupt(targetId) {
    const message = {
      id: `ctrl_${Date.now()}`,
      type: 'interrupt',
      payload: {
        targetId
      }
    };
    
    this.sendMessage(message);
  }

  /**
   * Cancel entire request
   */
  cancel(targetId) {
    const message = {
      id: `ctrl_${Date.now()}`,
      type: 'cancel',
      payload: {
        targetId
      }
    };
    
    this.sendMessage(message);
    this.activeRequests.delete(targetId);
  }

  // =============================================================================
  // MESSAGE HANDLERS
  // =============================================================================

  handleConnectionStatus(message) {
    this.logger.info('📡 Connection status received:', message.payload);
    this.emit('connection_status', message.payload);
  }

  handleLLMStreamStart(message) {
    this.logger.info(`🚀 LLM stream started: ${message.id}`);
    this.emit('llm_stream_start', message);
  }

  handleLLMStreamChunk(message) {
    this.emit('llm_stream_chunk', message);
  }

  handleLLMStreamEnd(message) {
    this.logger.info(`✅ LLM stream ended: ${message.id}`);
    this.activeRequests.delete(message.parentId || message.id);
    this.emit('llm_stream_end', message);
  }

  handleVoiceSTTChunk(message) {
    this.emit('voice_stt_chunk', message);
  }

  handleVoiceTTSChunk(message) {
    this.emit('voice_tts_chunk', message);
  }

  handleVoiceTTSEnd(message) {
    this.logger.info(`🔊 TTS stream ended: ${message.id}`);
    this.activeRequests.delete(message.parentId || message.id);
    this.emit('voice_tts_end', message);
  }

  handleConversationChunk(message) {
    this.emit('conversation_chunk', message);
  }

  handleStreamingError(message) {
    this.logger.error(`❌ Streaming error: ${message.payload.message}`);
    this.emit('streaming_error', message.payload);
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

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
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.isConnected = false;
    this.activeRequests.clear();
    this.messageQueue.length = 0;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

export default WebSocketService;
