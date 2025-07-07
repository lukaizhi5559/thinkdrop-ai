/**
 * React Hook for Backend API Client
 * Provides easy access to backend API with React integration
 */

import { useState, useEffect, useCallback } from 'react';
import apiClient, { 
  Agent, 
  OrchestrationRequest, 
  OrchestrationResult, 
  AgentGenerationResult,
  IntentResult,
  ExecutionLog,
  BibscripAPIError 
} from '../services/apiClient';

export interface APIStatus {
  connected: boolean;
  loading: boolean;
  error?: string;
  lastChecked?: Date;
}

export function useBackendAPI() {
  const [status, setStatus] = useState<APIStatus>({
    connected: false,
    loading: true
  });

  // Test connection and update status
  const checkConnection = useCallback(async () => {
    setStatus(prev => ({ ...prev, loading: true, error: undefined }));
    
    try {
      const isConnected = await apiClient.testConnection();
      setStatus({
        connected: isConnected,
        loading: false,
        lastChecked: new Date()
      });
      return isConnected;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      setStatus({
        connected: false,
        loading: false,
        error: errorMessage,
        lastChecked: new Date()
      });
      return false;
    }
  }, []);

  // Initialize connection check on mount
  useEffect(() => {
    checkConnection();
    
    // Set up periodic health checks every 30 seconds
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  // Agent Management Hooks
  const useAgents = () => {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    const fetchAgents = useCallback(async () => {
      setLoading(true);
      setError(undefined);
      
      try {
        const fetchedAgents = await apiClient.getAgents();
        setAgents(fetchedAgents);
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to fetch agents';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }, []);

    const createAgent = useCallback(async (request: string, context?: Record<string, any>) => {
      try {
        const result = await apiClient.createAgent(request, context);
        if (result.status === 'success' && result.agent) {
          setAgents(prev => [...prev, result.agent!]);
        }
        return result;
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to create agent';
        setError(errorMessage);
        throw err;
      }
    }, []);

    const deleteAgent = useCallback(async (name: string) => {
      try {
        await apiClient.deleteAgent(name);
        setAgents(prev => prev.filter(agent => agent.name !== name));
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to delete agent';
        setError(errorMessage);
        throw err;
      }
    }, []);

    useEffect(() => {
      if (status.connected) {
        fetchAgents();
      }
    }, [status.connected, fetchAgents]);

    return {
      agents,
      loading,
      error,
      fetchAgents,
      createAgent,
      deleteAgent
    };
  };

  // Orchestration Hook
  const useOrchestration = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const [lastResult, setLastResult] = useState<OrchestrationResult>();

    const orchestrate = useCallback(async (request: OrchestrationRequest) => {
      setLoading(true);
      setError(undefined);
      
      try {
        const result = await apiClient.orchestrate(request);
        setLastResult(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Orchestration failed';
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    }, []);

    const parseIntent = useCallback(async (text: string, context?: Record<string, any>) => {
      try {
        return await apiClient.parseIntent(text, context);
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Intent parsing failed';
        setError(errorMessage);
        throw err;
      }
    }, []);

    return {
      loading,
      error,
      lastResult,
      orchestrate,
      parseIntent
    };
  };

  // Memory Management Hook
  const useUserMemory = (userId?: string) => {
    const [memories, setMemories] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    const fetchMemories = useCallback(async (filters?: {
      tags?: string[];
      timeRange?: { start: string; end: string };
    }) => {
      if (!userId) return;
      
      setLoading(true);
      setError(undefined);
      
      try {
        const fetchedMemories = await apiClient.getUserMemories(userId, filters);
        setMemories(fetchedMemories);
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to fetch memories';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }, [userId]);

    const addMemory = useCallback(async (memory: {
      content: string;
      tags?: string[];
      metadata?: Record<string, any>;
    }) => {
      if (!userId) return;
      
      try {
        const newMemory = await apiClient.addUserMemory(userId, memory);
        setMemories(prev => [...prev, newMemory]);
        return newMemory;
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to add memory';
        setError(errorMessage);
        throw err;
      }
    }, [userId]);

    const forgetMemory = useCallback(async (memoryId: string) => {
      if (!userId) return;
      
      try {
        await apiClient.forgetUserMemory(userId, memoryId);
        setMemories(prev => prev.filter(memory => memory.id !== memoryId));
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to forget memory';
        setError(errorMessage);
        throw err;
      }
    }, [userId]);

    const queryMemory = useCallback(async (query: string) => {
      if (!userId) return [];
      
      try {
        return await apiClient.queryUserMemory(userId, query);
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Memory query failed';
        setError(errorMessage);
        throw err;
      }
    }, [userId]);

    useEffect(() => {
      if (status.connected && userId) {
        fetchMemories();
      }
    }, [status.connected, userId, fetchMemories]);

    return {
      memories,
      loading,
      error,
      fetchMemories,
      addMemory,
      forgetMemory,
      queryMemory
    };
  };

  // Communication Logs Hook
  const useCommunicationLogs = () => {
    const [logs, setLogs] = useState<ExecutionLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    const fetchLogs = useCallback(async (filters?: {
      agentName?: string;
      timeRange?: { start: string; end: string };
      logLevel?: string;
    }) => {
      setLoading(true);
      setError(undefined);
      
      try {
        const fetchedLogs = await apiClient.getAgentCommunications(filters);
        setLogs(fetchedLogs);
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to fetch communication logs';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }, []);

    const logCommunication = useCallback(async (log: ExecutionLog) => {
      try {
        await apiClient.logAgentCommunication(log);
        setLogs(prev => [log, ...prev]);
      } catch (err) {
        const errorMessage = err instanceof BibscripAPIError 
          ? err.message 
          : 'Failed to log communication';
        setError(errorMessage);
        throw err;
      }
    }, []);

    return {
      logs,
      loading,
      error,
      fetchLogs,
      logCommunication
    };
  };

  return {
    // Connection status
    status,
    checkConnection,
    
    // Direct API client access
    apiClient,
    
    // Specialized hooks
    useAgents,
    useOrchestration,
    useUserMemory,
    useCommunicationLogs
  };
}

export default useBackendAPI;
