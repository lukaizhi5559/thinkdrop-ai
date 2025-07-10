/**
 * React Hook for WebSocket Integration
 * Provides easy access to WebSocket streaming functionality in React components
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import WebSocketIntegration, { 
  StreamingMessage, 
  WebSocketConfig, 
  LLMStreamRequest,
  getWebSocketConfig 
} from '../services/websocketIntegration';

export interface UseWebSocketOptions extends Partial<WebSocketConfig> {
  onMessage?: (message: StreamingMessage) => void;
  onConnected?: () => void;
  onDisconnected?: (event: { code: number; reason: string }) => void;
  onError?: (error: any) => void;
}

export interface WebSocketState {
  isConnected: boolean;
  reconnectCount: number;
  activeRequests: number;
  queuedMessages: number;
  lastError?: any;
}

export interface UseWebSocketReturn {
  // Connection state
  state: WebSocketState;
  
  // Connection methods
  connect: () => Promise<void>;
  disconnect: () => void;
  
  // LLM methods
  sendLLMRequest: (request: LLMStreamRequest) => Promise<string>;
  generateAgent: (description: string, options?: Record<string, any>) => Promise<string>;
  orchestrateWorkflow: (command: string, options?: Record<string, any>) => Promise<string>;
  
  // Voice methods
  startVoiceSTT: (options?: Record<string, any>) => string;
  sendAudioChunk: (requestId: string, audioData: string, options?: Record<string, any>) => void;
  endVoiceSTT: (requestId: string) => void;
  requestTTS: (text: string, options?: Record<string, any>) => Promise<string>;
  
  // Control methods
  interrupt: (targetId: string) => void;
  cancel: (targetId: string) => void;
  
  // Streaming response handlers
  onLLMStreamChunk: (callback: (message: StreamingMessage) => void) => () => void;
  onLLMStreamEnd: (callback: (message: StreamingMessage) => void) => () => void;
  onVoiceSTTChunk: (callback: (message: StreamingMessage) => void) => () => void;
  onVoiceTTSChunk: (callback: (message: StreamingMessage) => void) => () => void;
  onConversationChunk: (callback: (message: StreamingMessage) => void) => () => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const wsRef = useRef<WebSocketIntegration | null>(null);
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    reconnectCount: 0,
    activeRequests: 0,
    queuedMessages: 0
  });

  // Initialize WebSocket service
  useEffect(() => {
    // Merge environment config with provided options
    const envConfig = getWebSocketConfig();
    const config: WebSocketConfig = {
      ...envConfig,
      ...options, // Options override environment
      apiKey: options.apiKey || envConfig.apiKey || '',
      autoConnect: options.autoConnect ?? true
    };

    wsRef.current = new WebSocketIntegration(config);

    // Set up event listeners
    const ws = wsRef.current;

    const updateState = () => {
      const status = ws.getConnectionStatus();
      setState({
        isConnected: status.isConnected,
        reconnectCount: status.reconnectCount,
        activeRequests: status.activeRequests,
        queuedMessages: status.queuedMessages
      });
    };

    const handleConnected = () => {
      updateState();
      options.onConnected?.();
    };

    const handleDisconnected = (event: { code: number; reason: string }) => {
      updateState();
      options.onDisconnected?.(event);
    };

    const handleError = (error: any) => {
      setState(prev => ({ ...prev, lastError: error }));
      options.onError?.(error);
    };

    const handleMessage = (message: StreamingMessage) => {
      options.onMessage?.(message);
    };

    // Add event listeners
    ws.on('connected', handleConnected);
    ws.on('disconnected', handleDisconnected);
    ws.on('error', handleError);
    ws.on('message', handleMessage);

    // Update state periodically
    const stateInterval = setInterval(updateState, 1000);

    return () => {
      clearInterval(stateInterval);
      ws.removeAllListeners();
      ws.disconnect();
      wsRef.current = null;
    };
  }, [options.backendHost, options.apiKey, options.userId, options.clientId]);

  // Connection methods
  const connect = useCallback(async () => {
    if (wsRef.current) {
      await wsRef.current.connect();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.disconnect();
    }
  }, []);

  // LLM methods
  const sendLLMRequest = useCallback(async (request: LLMStreamRequest): Promise<string> => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    return wsRef.current.sendLLMRequest(request);
  }, []);

  const generateAgent = useCallback(async (description: string, options?: Record<string, any>): Promise<string> => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    return wsRef.current.generateAgent(description, options);
  }, []);

  const orchestrateWorkflow = useCallback(async (command: string, options?: Record<string, any>): Promise<string> => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    return wsRef.current.orchestrateWorkflow(command, options);
  }, []);

  // Voice methods
  const startVoiceSTT = useCallback((options?: Record<string, any>): string => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    return wsRef.current.startVoiceSTT(options);
  }, []);

  const sendAudioChunk = useCallback((requestId: string, audioData: string, options?: Record<string, any>) => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    wsRef.current.sendAudioChunk(requestId, audioData, options);
  }, []);

  const endVoiceSTT = useCallback((requestId: string) => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    wsRef.current.endVoiceSTT(requestId);
  }, []);

  const requestTTS = useCallback(async (text: string, options?: Record<string, any>): Promise<string> => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    return wsRef.current.requestTTS(text, options);
  }, []);

  // Control methods
  const interrupt = useCallback((targetId: string) => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    wsRef.current.interrupt(targetId);
  }, []);

  const cancel = useCallback((targetId: string) => {
    if (!wsRef.current) throw new Error('WebSocket not initialized');
    wsRef.current.cancel(targetId);
  }, []);

  // Streaming response handlers
  const onLLMStreamChunk = useCallback((callback: (message: StreamingMessage) => void) => {
    if (!wsRef.current) return () => {};
    
    wsRef.current.on('llm_stream_chunk', callback);
    return () => {
      wsRef.current?.off('llm_stream_chunk', callback);
    };
  }, []);

  const onLLMStreamEnd = useCallback((callback: (message: StreamingMessage) => void) => {
    if (!wsRef.current) return () => {};
    
    wsRef.current.on('llm_stream_end', callback);
    return () => {
      wsRef.current?.off('llm_stream_end', callback);
    };
  }, []);

  const onVoiceSTTChunk = useCallback((callback: (message: StreamingMessage) => void) => {
    if (!wsRef.current) return () => {};
    
    wsRef.current.on('voice_stt_chunk', callback);
    return () => {
      wsRef.current?.off('voice_stt_chunk', callback);
    };
  }, []);

  const onVoiceTTSChunk = useCallback((callback: (message: StreamingMessage) => void) => {
    if (!wsRef.current) return () => {};
    
    wsRef.current.on('voice_tts_chunk', callback);
    return () => {
      wsRef.current?.off('voice_tts_chunk', callback);
    };
  }, []);

  const onConversationChunk = useCallback((callback: (message: StreamingMessage) => void) => {
    if (!wsRef.current) return () => {};
    
    wsRef.current.on('conversation_chunk', callback);
    return () => {
      wsRef.current?.off('conversation_chunk', callback);
    };
  }, []);

  return {
    state,
    connect,
    disconnect,
    sendLLMRequest,
    generateAgent,
    orchestrateWorkflow,
    startVoiceSTT,
    sendAudioChunk,
    endVoiceSTT,
    requestTTS,
    interrupt,
    cancel,
    onLLMStreamChunk,
    onLLMStreamEnd,
    onVoiceSTTChunk,
    onVoiceTTSChunk,
    onConversationChunk
  };
}

export default useWebSocket;
