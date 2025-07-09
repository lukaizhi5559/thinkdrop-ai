/**
 * Backend API Context Provider
 * Integrates backend API client with React context for global access
 */

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import useBackendAPI, { APIStatus } from '../hooks/useBackendAPI';
import configService from '../services/config';
import apiClient from '../services/apiClient';

interface BackendAPIContextType {
  // API Status
  status: APIStatus;
  checkConnection: () => Promise<boolean>;
  
  // Configuration
  updateAPIConfig: (config: { baseUrl?: string; apiKey?: string; jwtToken?: string }) => void;
  
  // Agent Management
  agents: any[];
  agentsLoading: boolean;
  agentsError?: string;
  createAgent: (request: string, context?: Record<string, any>) => Promise<any>;
  deleteAgent: (name: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
  
  // Orchestration
  orchestrate: (request: string, context?: Record<string, any>) => Promise<any>;
  parseIntent: (text: string, context?: Record<string, any>) => Promise<any>;
  orchestrationLoading: boolean;
  orchestrationError?: string;
  
  // Memory Management
  memories: any[];
  memoriesLoading: boolean;
  memoriesError?: string;
  addMemory: (content: string, tags?: string[], metadata?: Record<string, any>) => Promise<any>;
  forgetMemory: (memoryId: string) => Promise<void>;
  queryMemory: (query: string) => Promise<any[]>;
  refreshMemories: () => Promise<void>;
  
  // Communication Logs
  communicationLogs: any[];
  logsLoading: boolean;
  logsError?: string;
  refreshLogs: () => Promise<void>;
}

const BackendAPIContext = createContext<BackendAPIContextType | undefined>(undefined);

interface BackendAPIProviderProps {
  children: ReactNode;
  userId?: string;
}

export function BackendAPIProvider({ children, userId }: BackendAPIProviderProps) {
  const {
    status,
    checkConnection,
    useAgents,
    useOrchestration,
    useUserMemory,
    useCommunicationLogs
  } = useBackendAPI();

  // Initialize API client with configuration
  useEffect(() => {
    const config = configService.getAPIConfig();
    
    // Set API base URL if different from default
    if (config.baseUrl !== 'http://localhost:4000') {
      // Note: We'd need to modify apiClient to support dynamic base URL changes
      console.log('API Base URL:', config.baseUrl);
    }
    
    // Set authentication if available
    if (config.apiKey) {
      apiClient.setApiKey(config.apiKey);
    }
    if (config.jwtToken) {
      apiClient.setJwtToken(config.jwtToken);
    }
  }, []);

  // Agent management
  const {
    agents,
    loading: agentsLoading,
    error: agentsError,
    fetchAgents: refreshAgents,
    createAgent,
    deleteAgent
  } = useAgents();

  // Orchestration
  const {
    loading: orchestrationLoading,
    error: orchestrationError,
    orchestrate: orchestrateRaw,
    parseIntent
  } = useOrchestration();

  // Memory management
  const {
    memories,
    loading: memoriesLoading,
    error: memoriesError,
    fetchMemories: refreshMemories,
    addMemory: addMemoryRaw,
    forgetMemory,
    queryMemory
  } = useUserMemory(userId);

  // Communication logs
  const {
    logs: communicationLogs,
    loading: logsLoading,
    error: logsError,
    fetchLogs: refreshLogs
  } = useCommunicationLogs();

  // Wrapper functions to match context interface
  const orchestrate = async (request: string, context?: Record<string, any>) => {
    return orchestrateRaw({
      request,
      userId,
      enrichWithUserContext: true,
      context
    });
  };

  const addMemory = async (content: string, tags?: string[], metadata?: Record<string, any>) => {
    if (!userId) {
      throw new Error('User ID required for memory operations');
    }
    return addMemoryRaw({ content, tags, metadata });
  };

  const updateAPIConfig = (config: { baseUrl?: string; apiKey?: string; jwtToken?: string }) => {
    // Update configuration service
    if (config.baseUrl || config.apiKey) {
      configService.updateAPIConfig({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey
      });
    }
    
    // Update API client
    if (config.apiKey) {
      apiClient.setApiKey(config.apiKey);
    }
    if (config.jwtToken) {
      apiClient.setJwtToken(config.jwtToken);
    }
  };

  const contextValue: BackendAPIContextType = {
    // API Status
    status,
    checkConnection,
    
    // Configuration
    updateAPIConfig,
    
    // Agent Management
    agents,
    agentsLoading,
    agentsError,
    createAgent,
    deleteAgent,
    refreshAgents,
    
    // Orchestration
    orchestrate,
    parseIntent,
    orchestrationLoading,
    orchestrationError,
    
    // Memory Management
    memories,
    memoriesLoading,
    memoriesError,
    addMemory,
    forgetMemory,
    queryMemory,
    refreshMemories,
    
    // Communication Logs
    communicationLogs,
    logsLoading,
    logsError,
    refreshLogs
  };

  return (
    <BackendAPIContext.Provider value={contextValue}>
      {children}
    </BackendAPIContext.Provider>
  );
}

export function useBackendAPIContext(): BackendAPIContextType {
  const context = useContext(BackendAPIContext);
  if (context === undefined) {
    throw new Error('useBackendAPIContext must be used within a BackendAPIProvider');
  }
  return context;
}

export default BackendAPIContext;
