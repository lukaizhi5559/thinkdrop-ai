/**
 * WebSocket Test Component
 * Test WebSocket integration with bibscrip-backend
 */

import React, { useState, useEffect } from 'react';
import useWebSocket from '../hooks/useWebSocket';
import { getWebSocketConfig } from '../services/websocketIntegration';

const WebSocketTest: React.FC = () => {
  const [messages, setMessages] = useState<string[]>([]);
  const [testInput, setTestInput] = useState('Hello from ThinkDrop AI!');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  // Get configuration from environment
  const envConfig = getWebSocketConfig();
  
  const {
    state,
    connect,
    disconnect,
    sendLLMRequest,
    generateAgent,
    orchestrateWorkflow,
    onLLMStreamChunk,
    onLLMStreamEnd
  } = useWebSocket({
    autoConnect: false, // Disable auto-connect to prevent conflicts with manual testing
    ...envConfig,
    apiKey: envConfig.apiKey || 'test-api-key', // Fallback for testing
    onConnected: () => addMessage('✅ Connected to WebSocket'),
    onDisconnected: (event) => addMessage(`❌ Disconnected: ${event.code} - ${event.reason}`),
    onError: (error) => addMessage(`🚨 Error: ${error.message || error}`),
    onMessage: (message) => addMessage(`📨 Message: ${message.type} - ${JSON.stringify(message.payload)}`)
  });

  const addMessage = (message: string) => {
    setMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Set up streaming handlers
  useEffect(() => {
    const unsubscribeChunk = onLLMStreamChunk((message) => {
      if (message.parentId === currentRequestId || message.id === currentRequestId) {
        setStreamingResponse(prev => prev + (message.payload.text || message.payload.chunk || ''));
      }
    });

    const unsubscribeEnd = onLLMStreamEnd((message) => {
      if (message.parentId === currentRequestId || message.id === currentRequestId) {
        addMessage(`✅ Stream completed: ${message.payload.totalTokens || 'unknown'} tokens`);
        setCurrentRequestId(null);
      }
    });

    return () => {
      unsubscribeChunk();
      unsubscribeEnd();
    };
  }, [currentRequestId, onLLMStreamChunk, onLLMStreamEnd]);

  const handleLLMTest = async () => {
    try {
      setStreamingResponse('');
      addMessage(`🚀 Sending LLM request: "${testInput}"`);
      
      const requestId = await sendLLMRequest({
        prompt: testInput,
        options: {
          temperature: 0.7,
          maxTokens: 150,
          taskType: 'ask'
        }
      });
      
      setCurrentRequestId(requestId);
      addMessage(`📤 Request sent with ID: ${requestId}`);
    } catch (error: any) {
      addMessage(`❌ LLM request failed: ${error.message}`);
    }
  };

  const handleAgentGeneration = async () => {
    try {
      addMessage(`🤖 Generating agent: "${testInput}"`);
      
      const requestId = await generateAgent(testInput, {
        complexity: 'simple',
        category: 'utility'
      });
      
      addMessage(`📤 Agent generation request sent with ID: ${requestId}`);
    } catch (error: any) {
      addMessage(`❌ Agent generation failed: ${error.message}`);
    }
  };

  const handleOrchestration = async () => {
    try {
      addMessage(`🎭 Orchestrating workflow: "${testInput}"`);
      
      const requestId = await orchestrateWorkflow(testInput, {
        priority: 'normal',
        timeout: 30000
      });
      
      addMessage(`📤 Orchestration request sent with ID: ${requestId}`);
    } catch (error: any) {
      addMessage(`❌ Orchestration failed: ${error.message}`);
    }
  };

  const clearMessages = () => {
    setMessages([]);
    setStreamingResponse('');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto overflow-y-auto max-h-[600px] bg-white rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">WebSocket Integration Test</h1>
      
      {/* Connection Status */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Connection Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="font-medium">Status:</span>
            <span className={`ml-2 px-2 py-1 rounded ${state.isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {state.isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div>
            <span className="font-medium">Reconnects:</span>
            <span className="ml-2">{state.reconnectCount}</span>
          </div>
          <div>
            <span className="font-medium">Active Requests:</span>
            <span className="ml-2">{state.activeRequests}</span>
          </div>
          <div>
            <span className="font-medium">Queued:</span>
            <span className="ml-2">{state.queuedMessages}</span>
          </div>
        </div>
      </div>

      {/* Configuration Display */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg text-black">
        <h2 className="text-lg font-semibold mb-2">Configuration</h2>
        <div className="text-sm space-y-1">
          <div><span className="font-medium">WebSocket URL:</span> {envConfig.websocketUrl || 'Not set'}</div>
          <div><span className="font-medium">Backend Host:</span> {envConfig.backendHost || 'localhost:8000'}</div>
          <div><span className="font-medium">API Key:</span> {envConfig.apiKey ? '***' + envConfig.apiKey.slice(-4) : 'Not set'}</div>
          <div><span className="font-medium">User ID:</span> {envConfig.userId || 'Not set'}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-6 space-y-4 text-black">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Test Input:
          </label>
          <input
            type="text"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter test message or command..."
          />
        </div>
        
        <div className="flex flex-wrap gap-2">
          <button
            onClick={connect}
            disabled={state.isConnected}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            disabled={!state.isConnected}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            Disconnect
          </button>
          <button
            onClick={handleLLMTest}
            disabled={!state.isConnected}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Test LLM
          </button>
          <button
            onClick={handleAgentGeneration}
            disabled={!state.isConnected}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
          >
            Generate Agent
          </button>
          <button
            onClick={handleOrchestration}
            disabled={!state.isConnected}
            className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
          >
            Orchestrate
          </button>
          <button
            onClick={clearMessages}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Streaming Response */}
      {streamingResponse && (
        <div className="mb-6 p-4 bg-green-50 rounded-lg text-black">
          <h2 className="text-lg font-semibold mb-2">Streaming Response</h2>
          <div className="bg-white p-3 rounded border text-sm font-mono whitespace-pre-wrap">
            {streamingResponse}
            {currentRequestId && <span className="animate-pulse">|</span>}
          </div>
        </div>
      )}

      {/* Message Log */}
      <div className="p-4 bg-gray-50 rounded-lg text-black">
        <h2 className="text-lg font-semibold mb-2">Message Log</h2>
        <div className="bg-white p-3 rounded border h-64 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-gray-500 text-sm">No messages yet...</p>
          ) : (
            messages.map((message, index) => (
              <div key={index} className="text-sm font-mono mb-1 break-words">
                {message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default WebSocketTest;
