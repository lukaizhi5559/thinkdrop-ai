/**
 * LocalLLMContext - React context for LocalLLMAgent integration
 * Provides centralized access to LocalLLMAgent orchestration capabilities
 */
import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

// Types for LocalLLMAgent integration
export interface AgentHealth {
  timestamp: string;
  initialized: boolean;
  localLLMAvailable: boolean;
  currentModel: string | null;
  databaseConnected: boolean;
  agentCacheSize: number;
  orchestrationCacheSize: number;
}

export interface CachedAgent {
  name: string;
  id: string;
  description: string;
  parameters: string;
  dependencies: string;
  execution_target: string;
  requires_database: boolean;
  database_type: string | null;
  code: string;
  config: string;
  secrets: string;
  orchestrator_metadata: string;
  memory: string;
  capabilities: string;
  created_at: string;
  updated_at: string;
  version: string;
  cached_at: string;
  last_accessed: string;
  access_count: number;
  source: string;
}

export interface AgentCommunication {
  id: string;
  timestamp: string;
  from_agent: string;
  to_agent: string;
  message_type: string;
  content: string;
  context: string;
  success: boolean;
  error_message: string | null;
  execution_time_ms: number;
  synced_to_backend: boolean;
  sync_attempts: number;
  device_id: string;
  log_level: string;
  execution_id: string | null;
  agent_version: string | null;
  injected_secrets: string | null;
  context_used: boolean;
  retry_count: number;
}

export interface OrchestrationResult {
  success: boolean;
  sessionId: string;
  response: string;
  handledBy: string;
  escalationReason?: string;
  timestamp: string;
  executionTime?: number;
}

export interface LocalLLMContextType {
  // Health and status
  health: AgentHealth | null;
  isInitialized: boolean;
  isLocalLLMAvailable: boolean;
  
  // Core orchestration
  orchestrateAgents: (userInput: string, context?: any) => Promise<OrchestrationResult>;
  queryLocalLLM: (prompt: string, options?: any) => Promise<string>;
  queryLLM: (prompt: string, context?: any) => Promise<string>; // New ultra-fast pipeline
  
  // Configuration
  useNewPipeline: boolean;
  setUseNewPipeline: (enabled: boolean) => void;
  
  // Agent management
  cachedAgents: CachedAgent[];
  refreshCachedAgents: () => Promise<void>;
  clearAgentCache: () => Promise<void>;
  
  // Communication logs
  communications: AgentCommunication[];
  refreshCommunications: (limit?: number) => Promise<void>;
  
  // Health monitoring
  refreshHealth: () => Promise<void>;
  
  // Loading states
  isOrchestrating: boolean;
  isQuerying: boolean;
  isRefreshing: boolean;
  
  // Error handling
  lastError: string | null;
  clearError: () => void;
}

const LocalLLMContext = createContext<LocalLLMContextType | undefined>(undefined);

interface LocalLLMProviderProps {
  children: ReactNode;
}

export const LocalLLMProvider: React.FC<LocalLLMProviderProps> = ({ children }) => {
  // State management
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [cachedAgents, setCachedAgents] = useState<CachedAgent[]>([]);
  const [communications, setCommunications] = useState<AgentCommunication[]>([]);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  
  // Configuration for pipeline selection
  const [useNewPipeline, setUseNewPipeline] = useState<boolean>(() => {
    const stored = localStorage.getItem('thinkdrop-use-new-pipeline');
    return stored ? JSON.parse(stored) : false; // Default to old pipeline for stability
  });
  
  // Update localStorage when pipeline preference changes
  const handleSetUseNewPipeline = useCallback((enabled: boolean) => {
    setUseNewPipeline(enabled);
    localStorage.setItem('thinkdrop-use-new-pipeline', JSON.stringify(enabled));
    console.log(`🔄 Pipeline switched to: ${enabled ? 'NEW (llm-query)' : 'OLD (llm-query-local)'}`);
  }, []);

  // Computed properties
  const isInitialized = health?.initialized || false;
  const isLocalLLMAvailable = health?.localLLMAvailable || false;

  // Error handling helper
  const handleError = useCallback((error: any, context: string) => {
    const errorMessage = error?.message || error || 'Unknown error';
    console.error(`LocalLLMContext ${context}:`, errorMessage);
    setLastError(`${context}: ${errorMessage}`);
  }, []);

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  // Health monitoring
  const refreshHealth = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      const result = await window.electronAPI.llmGetHealth();
      if (result.success) {
        setHealth(result.data);
        clearError();
      } else {
        handleError(result.error, 'Health check failed');
      }
    } catch (error) {
      handleError(error, 'Health check error');
    }
  }, [handleError, clearError]);

  // Agent management
  const refreshCachedAgents = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      setIsRefreshing(true);
      const result = await window.electronAPI.llmGetCachedAgents();
      if (result.success) {
        setCachedAgents(result.data);
        clearError();
      } else {
        handleError(result.error, 'Failed to fetch cached agents');
      }
    } catch (error) {
      handleError(error, 'Cached agents fetch error');
    } finally {
      setIsRefreshing(false);
    }
  }, [handleError, clearError]);

  const clearAgentCache = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      setIsRefreshing(true);
      const result = await window.electronAPI.llmClearCache();
      if (result.success) {
        await refreshCachedAgents();
        clearError();
      } else {
        handleError(result.error, 'Failed to clear agent cache');
      }
    } catch (error) {
      handleError(error, 'Cache clear error');
    } finally {
      setIsRefreshing(false);
    }
  }, [handleError, clearError, refreshCachedAgents]);

  // Communication logs
  const refreshCommunications = useCallback(async (limit: number = 50) => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      setIsRefreshing(true);
      const result = await window.electronAPI.llmGetCommunications(limit);
      if (result.success) {
        setCommunications(result.data);
        clearError();
      } else {
        handleError(result.error, 'Failed to fetch communications');
      }
    } catch (error) {
      handleError(error, 'Communications fetch error');
    } finally {
      setIsRefreshing(false);
    }
  }, [handleError, clearError]);

  // Core orchestration
  const orchestrateAgents = useCallback(async (userInput: string, context: any = {}): Promise<OrchestrationResult> => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      setIsOrchestrating(true);
      clearError();
      
      const result = await window.electronAPI.llmOrchestrate(userInput, context);
      
      if (result.success) {
        // Refresh communications to show the new interaction
        setTimeout(() => refreshCommunications(), 1000);
        return result.data;
      } else {
        handleError(result.error, 'Orchestration failed');
        throw new Error(result.error);
      }
    } catch (error) {
      handleError(error, 'Orchestration error');
      throw error;
    } finally {
      setIsOrchestrating(false);
    }
  }, [handleError, clearError, refreshCommunications]);

  // Local LLM querying (old pipeline)
  const queryLocalLLM = useCallback(async (prompt: string, options: any = {}): Promise<string> => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      setIsQuerying(true);
      clearError();
      
      const result = await window.electronAPI.llmQueryLocal(prompt, options);
      
      if (result.success) {
        return result.data;
      } else {
        handleError(result.error, 'Local LLM query failed');
        throw new Error(result.error);
      }
    } catch (error) {
      handleError(error, 'Local LLM query error');
      throw error;
    } finally {
      setIsQuerying(false);
    }
  }, [handleError, clearError]);

  // New ultra-fast LLM querying
  const queryLLM = useCallback(async (prompt: string, context: any = {}): Promise<string> => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      setIsQuerying(true);
      clearError();
      
      const result = await window.electronAPI.llmQuery(prompt, context);
      
      if (result.success) {
        return result.data;
      } else {
        handleError(result.error, 'New LLM query failed');
        throw new Error(result.error);
      }
    } catch (error) {
      handleError(error, 'New LLM query error');
      throw error;
    } finally {
      setIsQuerying(false);
    }
  }, [handleError, clearError]);

  // Initialize on mount with proper readiness check
  useEffect(() => {
    const waitForLocalLLMAgent = async () => {
      // Poll for LocalLLMAgent readiness instead of using fixed delay
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds max wait
      
      while (attempts < maxAttempts) {
        try {
          if (!window.electronAPI) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
            continue;
          }
          
          // Try a simple health check to see if LocalLLMAgent is ready
          const healthResult = await window.electronAPI.llmGetHealth();
          if (healthResult.success && healthResult.data?.initialized) {
            console.log('✅ LocalLLMAgent is ready, initializing context');
            break;
          }
          
          // Wait 1 second before next attempt
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
          
        } catch (error) {
          // LocalLLMAgent not ready yet, continue waiting
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }
      }
      
      if (attempts >= maxAttempts) {
        console.warn('⚠️ LocalLLMAgent readiness timeout, proceeding with initialization anyway');
      }
      
      return attempts < maxAttempts;
    };
    
    const initialize = async () => {
      // Skip initialization in MCP Private Mode
      const USE_MCP_PRIVATE_MODE = true; // TODO: Make this configurable
      if (USE_MCP_PRIVATE_MODE) {
        console.log('⏭️ [LocalLLMContext] Skipping initialization - MCP Private Mode active');
        return;
      }
      
      await waitForLocalLLMAgent();
      
      try {
        await refreshHealth();
        await refreshCachedAgents();
        await refreshCommunications();
        console.log('✅ LocalLLMContext initialized successfully');
      } catch (error) {
        console.warn('LocalLLMContext initialization failed:', error);
        // Single retry after 3 seconds
        setTimeout(async () => {
          try {
            await refreshHealth();
            await refreshCachedAgents();
            await refreshCommunications();
            console.log('✅ LocalLLMContext retry successful');
          } catch (retryError) {
            console.error('❌ LocalLLMContext retry failed:', retryError);
          }
        }, 3000);
      }
    };

    initialize();

    // TEMPORARILY DISABLED: Set up periodic health checks (LocalLLMAgent disabled)
    // const healthInterval = setInterval(async () => {
    //   try {
    //     await refreshHealth();
    //   } catch (error) {
    //     console.warn('Health check failed:', error);
    //   }
    // }, 30000); // Every 30 seconds

    return () => {
      // clearInterval(healthInterval); // DISABLED: healthInterval is commented out
    };
  }, [refreshHealth, refreshCachedAgents, refreshCommunications]);

  // Context value
  const contextValue: LocalLLMContextType = {
    // Health and status
    health,
    isInitialized,
    isLocalLLMAvailable,
    
    // Core orchestration
    orchestrateAgents,
    queryLocalLLM,
    queryLLM,
    
    // Configuration
    useNewPipeline,
    setUseNewPipeline: handleSetUseNewPipeline,
    
    // Agent management
    cachedAgents,
    refreshCachedAgents,
    clearAgentCache,
    
    // Communication logs
    communications,
    refreshCommunications,
    
    // Health monitoring
    refreshHealth,
    
    // Loading states
    isOrchestrating,
    isQuerying,
    isRefreshing,
    
    // Error handling
    lastError,
    clearError
  };

  return (
    <LocalLLMContext.Provider value={contextValue}>
      {children}
    </LocalLLMContext.Provider>
  );
};

// Custom hook for using LocalLLMContext
export const useLocalLLM = (): LocalLLMContextType => {
  const context = useContext(LocalLLMContext);
  if (context === undefined) {
    throw new Error('useLocalLLM must be used within a LocalLLMProvider');
  }
  return context;
};

// Helper hook for orchestration with error handling
export const useOrchestration = () => {
  const { orchestrateAgents, isOrchestrating, lastError, clearError } = useLocalLLM();
  
  const orchestrate = useCallback(async (userInput: string, context?: any) => {
    try {
      clearError();
      const result = await orchestrateAgents(userInput, context);
      return { success: true, data: result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }, [orchestrateAgents, clearError]);
  
  return {
    orchestrate,
    isOrchestrating,
    lastError,
    clearError
  };
};

// Helper hook for local LLM queries (automatically selects pipeline)
export const useLocalLLMQuery = () => {
  const { 
    queryLocalLLM, 
    queryLLM, 
    useNewPipeline, 
    setUseNewPipeline,
    isQuerying, 
    isLocalLLMAvailable, 
    lastError, 
    clearError 
  } = useLocalLLM();
  
  const query = useCallback(async (prompt: string, options?: any) => {
    if (!isLocalLLMAvailable) {
      return { 
        success: false, 
        error: 'Local LLM not available' 
      };
    }
    
    try {
      clearError();
      
      // Debug pipeline selection
      console.log(`🔍 [PIPELINE-DEBUG] useNewPipeline state: ${useNewPipeline}`);
      console.log(`🔍 [PIPELINE-DEBUG] About to call: ${useNewPipeline ? 'queryLLM (NEW)' : 'queryLocalLLM (OLD)'}`);
      
      // Automatically select pipeline based on configuration
      const result = useNewPipeline 
        ? await queryLLM(prompt, options) 
        : await queryLocalLLM(prompt, options);
        
      console.log(`🚀 Query executed via ${useNewPipeline ? 'NEW' : 'OLD'} pipeline`);
      return { success: true, data: result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }, [queryLocalLLM, queryLLM, useNewPipeline, isLocalLLMAvailable, clearError]);
  
  return {
    query,
    isQuerying,
    isLocalLLMAvailable,
    lastError,
    clearError,
    useNewPipeline,
    setUseNewPipeline,
    // Direct access to both pipelines for testing
    queryOld: queryLocalLLM,
    queryNew: queryLLM
  };
};

export default LocalLLMContext;
