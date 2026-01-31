/**
 * Communication Agent Service
 * 
 * Manages Socket.IO connection to backend Communication Agent
 * Handles streaming responses, progress updates, and worker coordination
 * Uses polling transport only (no WebSocket) due to protocol issues
 */

import { io, Socket } from 'socket.io-client';

// Electron IPC for worker coordination
const ipcRenderer = (window as any).electron?.ipcRenderer;

// Global singleton instance reference for IPC callbacks
let globalInstance: CommunicationAgent | null = null;

// Set up global IPC listeners at module load time (before singleton is created)
if (ipcRenderer) {
  console.log('🔧 [COMM_AGENT] Setting up global Worker Agent IPC listeners');

  // Listen for Worker Agent progress
  ipcRenderer.on('worker:progress', (_event: any, progress: any) => {
    console.log('📊 [COMM_AGENT] Worker progress received (global):', {
      nodeName: progress.nodeName,
      status: progress.status,
      hasInstance: !!globalInstance
    });
    
    if (globalInstance) {
      globalInstance.handleWorkerProgress(progress);
    } else {
      console.warn('⚠️ [COMM_AGENT] No instance available to handle worker progress');
    }
  });

  // Listen for Worker Agent stream tokens
  ipcRenderer.on('worker:stream-token', (_event: any, data: any) => {
    console.log('💬 [COMM_AGENT] Worker stream token received (global):', {
      tokenLength: data.token?.length || 0,
      hasInstance: !!globalInstance
    });
    
    if (globalInstance) {
      globalInstance.handleWorkerStreamToken(data.token);
    } else {
      console.warn('⚠️ [COMM_AGENT] No instance available to handle stream token');
    }
  });

  // Listen for Worker Agent completion
  ipcRenderer.on('worker:completed', (_event: any, data: any) => {
    console.log('✅ [COMM_AGENT] Worker completed (global):', {
      hasResult: !!data.result,
      hasInstance: !!globalInstance
    });
    
    if (globalInstance) {
      globalInstance.handleWorkerCompleted(data);
    } else {
      console.warn('⚠️ [COMM_AGENT] No instance available to handle completion');
    }
  });

  // Listen for Worker Agent errors
  ipcRenderer.on('worker:error', (_event: any, data: any) => {
    console.error('❌ [COMM_AGENT] Worker error received (global):', {
      error: data.error,
      hasInstance: !!globalInstance
    });
    
    if (globalInstance) {
      globalInstance.handleWorkerError(data);
    } else {
      console.warn('⚠️ [COMM_AGENT] No instance available to handle error');
    }
  });

  console.log('✅ [COMM_AGENT] Global Worker Agent IPC listeners registered');
}

/**
 * Set the global instance reference for IPC callbacks
 */
export function setGlobalInstance(instance: CommunicationAgent | null) {
  globalInstance = instance;
  console.log('🔗 [COMM_AGENT] Global instance reference set:', !!instance);
}

export interface WebSocketMessage {
  type: string;
  data?: any;
  sessionId?: string;
  route?: 'direct' | 'worker';
  [key: string]: any;
}

export interface WorkerProgress {
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

export interface CommunicationAgentConfig {
  serverUrl: string;
  onMessage?: (message: any) => void;
  onProgress?: (progress: any) => void;
  onStreamToken?: (token: string) => void;
  onError?: (error: string) => void;
}

export class CommunicationAgent {
  private socket: Socket | null = null;
  private config: CommunicationAgentConfig;
  private sessionId: string;
  private isConnected: boolean = false;
  private lastSentMessage: string = ''; // Track last message for worker routing
  
  // Polling configuration
  private pollingInterval: NodeJS.Timeout | null = null;
  private pollingIntervalMs = 2000; // Poll every 2 seconds
  private activeWorkerSessions: Set<string> = new Set();
  private lastKnownStatus: Map<string, any> = new Map();

  constructor(config: CommunicationAgentConfig) {
    this.config = config;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Set up Worker Agent IPC bridge
    this.setupWorkerBridge();
  }

  /**
   * Update configuration (used when ResultsWindow mounts and provides real callbacks)
   */
  public updateConfig(config: CommunicationAgentConfig) {
    console.log('🔄 [COMM_AGENT] Updating config with new callbacks');
    this.config = {
      ...this.config,
      ...config
    };
  }

  /**
   * Connect to Communication Agent via Socket.IO (OPTIONAL)
   * All queries now route directly to Worker Agent via IPC
   * Socket.IO connection maintained for backward compatibility only
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔌 [COMM_AGENT] Socket.IO connection is optional - all queries route to Worker Agent');
        console.log('ℹ️ [COMM_AGENT] Attempting Socket.IO connection for backward compatibility:', this.config.serverUrl);
        
        // Create Socket.IO connection with polling transport only
        this.socket = io(this.config.serverUrl, {
          path: '/socket.io',
          transports: ['polling'], // CRITICAL: Only use polling, no WebSocket
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: 3, // Reduced attempts since it's optional
          timeout: 5000 // 5 second timeout
        });

        this.socket.on('connect', () => {
          console.log('✅ [COMM_AGENT] Socket.IO connected (optional - not required for queries)');
          this.isConnected = true;
          resolve();
        });

        this.socket.on('connection_status', (data) => {
          console.log('� [COMM_AGENT] Connection status:', data);
        });

        this.socket.on('message', (message) => {
          try {
            console.log('📨 [COMM_AGENT] Message received from backend:', message);
            this.handleMessage(message);
          } catch (error) {
            console.error('❌ [COMM_AGENT] Failed to handle message:', error);
          }
        });

        this.socket.on('heartbeat', (data) => {
          console.log('💓 [COMM_AGENT] Heartbeat received:', data);
          // Respond to heartbeat to keep connection alive
          if (this.socket) {
            this.socket.emit('heartbeat_response');
            console.log('💓 [COMM_AGENT] Heartbeat response sent');
          }
        });

        this.socket.on('error', (error) => {
          console.error('❌ [COMM_AGENT] Socket.IO error (non-critical):', error);
        });

        this.socket.on('disconnect', (reason) => {
          console.log('🔌 [COMM_AGENT] Socket.IO disconnected (non-critical):', reason);
          this.isConnected = false;
        });

        this.socket.on('connect_error', (error) => {
          console.warn('⚠️ [COMM_AGENT] Socket.IO connection failed (non-critical):', error.message);
          // Resolve anyway since Socket.IO is optional
          resolve();
        });

        // Timeout fallback - resolve after 5 seconds even if connection fails
        setTimeout(() => {
          if (!this.isConnected) {
            console.log('ℹ️ [COMM_AGENT] Socket.IO connection timeout - continuing without backend (queries route to Worker Agent)');
            resolve();
          }
        }, 5000);

      } catch (error) {
        console.warn('⚠️ [COMM_AGENT] Socket.IO setup failed (non-critical):', error);
        // Resolve anyway since Socket.IO is optional
        resolve();
      }
    });
  }

  /**
   * Public handler methods for global IPC listeners
   */
  public handleWorkerProgress(progress: WorkerProgress) {
    console.log('📊 [COMM_AGENT] Handling worker progress:', progress);
    this.config.onProgress?.(progress);
  }

  public handleWorkerStreamToken(token: string) {
    console.log('💬 [COMM_AGENT] Handling worker stream token:', token?.substring(0, 20));
    this.config.onStreamToken?.(token);
  }

  public handleWorkerCompleted(data: any) {
    console.log('✅ [COMM_AGENT] Handling worker completion');
    // Could forward to backend or handle locally
  }

  public handleWorkerError(data: any) {
    console.error('❌ [COMM_AGENT] Handling worker error:', data.error);
    this.config.onError?.(data.error);
  }

  /**
   * Setup bridge to Worker Agent via IPC
   * NOTE: IPC listeners are now set up globally at module load time
   */
  private setupWorkerBridge() {
    if (!ipcRenderer) {
      console.warn('⚠️ [COMM_AGENT] IPC not available - Worker bridge disabled');
      return;
    }

    console.log('🔧 [COMM_AGENT] Setting up Worker Agent IPC bridge');
    
    // NOTE: IPC listeners are set up globally at module load time (lines 18-78)
    // Global listeners forward events to the singleton instance via public handler methods
    // No need for per-instance listeners - they cause duplication!
    
    console.log('✅ [COMM_AGENT] Worker Agent IPC bridge setup complete (using global listeners)');
  }

  /**
   * Handle incoming message from Communication Agent
   */
  private handleMessage(message: any) {
    console.log('📨 [COMM_AGENT] Received message:', message.type);
    console.log('📦 [COMM_AGENT] Full message:', message);

    // Socket.IO message handling is now deprecated
    // All messages route directly to Worker Agent (StateGraph) via executeWithWorker
    // Keeping this handler for backward compatibility with backend if needed
    
    switch (message.type) {
      case 'error':
        // Error from backend (if Socket.IO is still connected)
        const errorMsg = message.error || message.payload?.error || message.payload?.message || message.payload || 'Unknown error';
        console.error('❌ [COMM_AGENT] Backend error:', errorMsg);
        console.error('📦 [COMM_AGENT] Full error message:', message);
        this.config.onError?.(errorMsg);
        break;

      default:
        // Log unhandled messages for debugging
        console.log('ℹ️ [COMM_AGENT] Unhandled message type (all queries now route to Worker Agent):', message.type);
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
        context: {
          ...data.context,
          useOnlineMode: true // Enable online mode for screen intelligence
        }
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
   * Send message to Communication Agent
   * Routes directly to Worker Agent (StateGraph) for all queries
   * This ensures unified conversation history and context management
   */
  async sendMessage(message: string, context?: any): Promise<void> {
    console.log('📤 [COMM_AGENT] Sending message:', message);
    console.log('🔀 [COMM_AGENT] Routing directly to Worker Agent (StateGraph)');
    
    // Store the message for logging
    this.lastSentMessage = message;

    // Route directly to Worker Agent (StateGraph) - bypassing Socket.IO backend
    // This ensures all queries go through StateGraph for:
    // - Unified conversation history
    // - Context-aware responses
    // - Streaming via IPC
    // - Memory and entity extraction
    await this.executeWithWorker({
      message: message,
      context: {
        ...context,
        userId: 'default_user', // Hardcoded for now, can be made dynamic later
        sessionId: this.sessionId,
        useOnlineMode: true // Enable online mode for screen intelligence
      }
    });
  }

  /**
   * Send data to backend Communication Agent
   */
  private sendToBackend(data: any) {
    if (!this.isConnected || !this.socket) {
      console.warn('⚠️ [COMM_AGENT] Cannot send to backend - not connected');
      return;
    }

    const payload = {
      ...data,
      timestamp: Date.now()
    };

    console.log('📤 [COMM_AGENT] Sending to backend via Socket.IO:', {
      type: payload.type,
      sessionId: payload.sessionId,
      messagePreview: payload.message?.substring(0, 50),
      hasContext: !!payload.context
    });

    this.socket.emit('message', payload);
  }

  /**
   * Disconnect from Communication Agent
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
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
