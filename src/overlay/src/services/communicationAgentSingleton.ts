/**
 * Communication Agent Singleton
 * 
 * Ensures only ONE WebSocket connection is created and shared across all components
 */

import { CommunicationAgent, CommunicationAgentConfig, setGlobalInstance } from './communicationAgent';

let instance: CommunicationAgent | null = null;

export function getCommunicationAgent(config?: CommunicationAgentConfig): CommunicationAgent {
  if (!instance && config) {
    console.log('🌐 [SINGLETON] Creating Communication Agent instance');
    instance = new CommunicationAgent(config);
    // Set global instance so IPC listeners can forward events to it
    setGlobalInstance(instance);
  } else if (config && instance) {
    // Update config on existing instance
    console.log('🔄 [SINGLETON] Updating Communication Agent config');
    instance.updateConfig(config);
  }
  
  if (!instance) {
    throw new Error('Communication Agent not initialized. Call with config first.');
  }
  
  return instance;
}

export function destroyCommunicationAgent() {
  if (instance) {
    console.log('🗑️ [SINGLETON] Destroying Communication Agent instance');
    instance.disconnect();
    instance = null;
  }
}

export function hasCommunicationAgent(): boolean {
  return instance !== null;
}
