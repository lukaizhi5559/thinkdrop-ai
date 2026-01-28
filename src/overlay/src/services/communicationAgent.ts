/**
 * Communication Agent Service
 * 
 * Frontend service that connects to backend Communication Agent (/ws/stream)
 * Bridges between Communication Agent and Worker Agent (StateGraph)
 * Handles routing, progress streaming, and user interaction
 */

const ipcRenderer = (window as any).electron?.ipcRenderer;

interface WorkerProgress {
  sessionId: string;
  nodeName: string;
  status: 'started' | 'completed' | 'step' | 'action';
  duration?: number;
  stepDescription?: string;
  actionDescription?: string;
  intentType?: string;
  currentNode?: string;
  timestamp: number;
}

interface CommunicationAgentConfig {
  wsUrl: string;
  onMessage?: (message: any) => void;
  onProgress?: (progress: WorkerProgress) => void;
  onStreamToken?: (token: string) => void;
  onError?: (error: string) => void;
}

export class CommunicationAgent {
  private ws: WebSocket | null = null;
  private config: CommunicationAgentConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private sessionId: string;
  private isConnected = false;
  
  // Polling configuration
  private pollingInterval: NodeJS.Timeout | null = null;
  private pollingIntervalMs = 2000; // Poll every 2 seconds
  private activeWorkerSessions: Set<string> = new Set();
  private lastKnownStatus: Map<string, any> = new Map();

  constructor(config: CommunicationAgentConfig) {
    this.config = config;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.setupWorkerBridge();
  }

  /**
   * Connect to Communication Agent WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.wsUrl);

        this.ws.onopen = () => {
          console.log('✅ [COMM_AGENT] Connected to Communication Agent');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('❌ [COMM_AGENT] Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('❌ [COMM_AGENT] WebSocket error:', error);
          this.config.onError?.('WebSocket connection error');
        };

        this.ws.onclose = () => {
          console.log('🔌 [COMM_AGENT] Disconnected from Communication Agent');
          this.isConnected = false;
          this.attemptReconnect();
        };

      } catch (error) {
        console.error('❌ [COMM_AGENT] Connection failed:', error);
        reject(error);
      }
    });
  }

  /**
   * Setup bridge to Worker Agent via IPC
   */
  private setupWorkerBridge() {
    if (!ipcRenderer) {
      console.warn('⚠️ [COMM_AGENT] IPC not available - Worker bridge disabled');
      return;
    }

    // Listen for Worker Agent progress
    ipcRenderer.on('worker:progress', (_event: any, progress: WorkerProgress) => {
      console.log('📊 [COMM_AGENT] Worker progress:', progress);
      
      // Forward to Communication Agent
      this.sendToBackend({
        type: 'worker_progress',
        sessionId: this.sessionId,
        data: progress
      });

      // Also notify local listeners
      this.config.onProgress?.(progress);
    });

    // Listen for Worker Agent stream tokens
    ipcRenderer.on('worker:stream-token', (_event: any, data: any) => {
      console.log('💬 [COMM_AGENT] Worker stream token:', data.token);
      this.config.onStreamToken?.(data.token);
    });

    // Listen for Worker Agent completion
    ipcRenderer.on('worker:completed', (_event: any, data: any) => {
      console.log('✅ [COMM_AGENT] Worker completed:', data);
      
      this.sendToBackend({
        type: 'worker_completed',
        sessionId: this.sessionId,
        data: data.result
      });
    });

    // Listen for Worker Agent errors
    ipcRenderer.on('worker:error', (_event: any, data: any) => {
      console.error('❌ [COMM_AGENT] Worker error:', data);
      
      this.sendToBackend({
        type: 'worker_error',
        sessionId: this.sessionId,
        error: data.error
      });
    });
  }

  /**
   * Handle incoming message from Communication Agent
   */
  private handleMessage(message: any) {
    console.log('📨 [COMM_AGENT] Received message:', message.type);

    switch (message.type) {
      case 'llm_stream_chunk':
        // Direct LLM response (simple query)
        this.config.onStreamToken?.(message.payload);
        break;

      case 'llm_stream_end':
        // LLM response complete
        this.config.onMessage?.(message);
        break;

      case 'route_to_worker':
        // Communication Agent decided to route to Worker Agent
        console.log('🔀 [COMM_AGENT] Routing to Worker Agent');
        this.executeWithWorker(message.data);
        break;

      case 'status':
        // Status update from Communication Agent
        console.log('ℹ️ [COMM_AGENT] Status:', message.message);
        break;

      case 'error':
        // Error from Communication Agent
        console.error('❌ [COMM_AGENT] Error:', message.error);
        this.config.onError?.(message.error);
        break;

      default:
        // Forward to general message handler
        this.config.onMessage?.(message);
    }
  }

  /**
   * Execute task with Worker Agent (StateGraph)
   */
  private async executeWithWorker(data: any) {
    if (!ipcRenderer) {
      console.error('❌ [COMM_AGENT] Cannot execute with Worker - IPC not available');
      return;
    }

    try {
      // Track this session for polling
      this.activeWorkerSessions.add(this.sessionId);
      
      // Start polling if not already running
      this.startPolling();

      const result = await ipcRenderer.invoke('worker:execute', {
        sessionId: this.sessionId,
        message: data.message,
        context: data.context
      });

      console.log('✅ [COMM_AGENT] Worker execution complete:', result);
      
      // Remove from active sessions
      this.activeWorkerSessions.delete(this.sessionId);
      
      // Stop polling if no active sessions
      if (this.activeWorkerSessions.size === 0) {
        this.stopPolling();
      }
    } catch (error: any) {
      console.error('❌ [COMM_AGENT] Worker execution failed:', error);
      this.config.onError?.(error.message);
      
      // Clean up on error
      this.activeWorkerSessions.delete(this.sessionId);
      if (this.activeWorkerSessions.size === 0) {
        this.stopPolling();
      }
    }
  }

  /**
   * Start polling Worker Agent status
   */
  private startPolling() {
    if (this.pollingInterval) {
      return; // Already polling
    }

    console.log('🔄 [COMM_AGENT] Starting Worker status polling');
    
    this.pollingInterval = setInterval(() => {
      this.pollWorkerStatus();
    }, this.pollingIntervalMs);
  }

  /**
   * Stop polling Worker Agent status
   */
  private stopPolling() {
    if (this.pollingInterval) {
      console.log('⏹️  [COMM_AGENT] Stopping Worker status polling');
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Poll Worker Agent status for all active sessions
   */
  private async pollWorkerStatus() {
    if (!ipcRenderer || this.activeWorkerSessions.size === 0) {
      return;
    }

    for (const sessionId of this.activeWorkerSessions) {
      try {
        const status = await ipcRenderer.invoke('worker:get-status', { sessionId });
        
        // Check if status changed
        const lastStatus = this.lastKnownStatus.get(sessionId);
        
        if (!lastStatus || this.hasStatusChanged(lastStatus, status)) {
          console.log('📊 [COMM_AGENT] Worker status update (polled)', {
            sessionId,
            status: status.status,
            currentStep: status.currentStep
          });

          // Update last known status
          this.lastKnownStatus.set(sessionId, status);

          // Forward to Communication Agent
          this.sendToBackend({
            type: 'worker_status_poll',
            sessionId,
            data: status
          });

          // Handle completion/error detected via polling
          if (status.status === 'completed') {
            console.log('✅ [COMM_AGENT] Worker completion detected via polling');
            this.activeWorkerSessions.delete(sessionId);
            this.lastKnownStatus.delete(sessionId);
          } else if (status.status === 'error') {
            console.error('❌ [COMM_AGENT] Worker error detected via polling');
            this.activeWorkerSessions.delete(sessionId);
            this.lastKnownStatus.delete(sessionId);
          }
        }
      } catch (error: any) {
        console.error('❌ [COMM_AGENT] Polling failed for session', sessionId, error);
      }
    }

    // Stop polling if no active sessions
    if (this.activeWorkerSessions.size === 0) {
      this.stopPolling();
    }
  }

  /**
   * Check if Worker status has changed
   */
  private hasStatusChanged(oldStatus: any, newStatus: any): boolean {
    return (
      oldStatus.status !== newStatus.status ||
      oldStatus.currentNode !== newStatus.currentNode ||
      oldStatus.currentStep !== newStatus.currentStep ||
      oldStatus.lastUpdate !== newStatus.lastUpdate
    );
  }

  /**
   * Send message to user (via Communication Agent)
   */
  async sendMessage(message: string, context?: any): Promise<void> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to Communication Agent');
    }

    const payload = {
      type: 'llm_request',
      id: `req_${Date.now()}`,
      payload: {
        prompt: message,
        context: context || {}
      },
      sessionId: this.sessionId,
      timestamp: Date.now()
    };

    console.log('📤 [COMM_AGENT] Sending message to Communication Agent');
    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Send data to backend Communication Agent
   */
  private sendToBackend(data: any) {
    if (!this.isConnected || !this.ws) {
      console.warn('⚠️ [COMM_AGENT] Cannot send to backend - not connected');
      return;
    }

    this.ws.send(JSON.stringify({
      ...data,
      timestamp: Date.now()
    }));
  }

  /**
   * Attempt to reconnect to Communication Agent
   */
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ [COMM_AGENT] Max reconnect attempts reached');
      this.config.onError?.('Failed to reconnect to Communication Agent');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`🔄 [COMM_AGENT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('❌ [COMM_AGENT] Reconnect failed:', error);
      });
    }, delay);
  }

  /**
   * Disconnect from Communication Agent
   */
  disconnect() {
    // Stop polling
    this.stopPolling();
    
    // Clear active sessions
    this.activeWorkerSessions.clear();
    this.lastKnownStatus.clear();
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Check if connected
   */
  isConnectedToAgent(): boolean {
    return this.isConnected;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}
