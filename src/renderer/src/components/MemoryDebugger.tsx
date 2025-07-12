import React, { useState, useEffect } from 'react';
import { Database, X, Check, AlertCircle, Eye, Brain, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import './MemoryDebugger.css';

/**
 * MemoryDebugger component for viewing and debugging user memories in DuckDB
 * Updated to support new intent classification schema
 */
interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  timestamp: number;
}

interface IntentMemory {
  id: string;
  timestamp: string;
  user_id: string;
  type: string;
  primary_intent: string;
  requires_memory_access: boolean;
  requires_external_data: boolean;
  suggested_response: string;
  source_text: string;
  metadata: string;
  screenshot: Uint8Array | string | null;
  extracted_text: string | null;
  synced_to_backend: boolean;
  backend_memory_id: string | null;
  created_at: string;
  updated_at: string;
  intents?: Array<{ intent: string; confidence: number; reasoning: string }>;
  entities?: string[];
}

const MemoryDebugger = () => {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastMemoryCount, setLastMemoryCount] = useState(0);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  const populateTestData = async () => {
    if (!window.electronAPI?.agentOrchestrate) {
      console.error('❌ Agent orchestration API not available');
      setError('Agent orchestration API not available');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      console.log('🧪 Populating test data via agent orchestration...');
      
      // Create UserMemoryAgent payload to populate test data
      const agentPayload = {
        intents: [{
          intent: 'test_populate',
          confidence: 1.0,
          agent: 'UserMemoryAgent',
          action: 'test_populate'
        }],
        primaryIntent: 'test_populate',
        entities: [],
        requiresMemoryAccess: true,
        sourceText: 'MemoryDebugger requesting test data population'
      };
      
      console.log('🧪 Sending test data population request:', agentPayload);
      
      const result = await window.electronAPI.agentOrchestrate(agentPayload);
      console.log('📥 Test data population result:', result);
      
      if (result?.success) {
        console.log('✅ Test data populated successfully', result);
        // Automatically refresh to show the new data
        await loadMemories(agentPayload);
      } else {
        console.error('❌ Test data population failed:', result);
        setError('Failed to populate test data');
      }
      
    } catch (error) {
      console.error('❌ Error populating test data:', error);
      setError(`Error populating test data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const loadMemories = async (agentPayloadOverride: any = null) => {
    try {
      setLoading(true);
      setError(null);
      
      // Debug logging
      console.log('🔍 MemoryDebugger: Starting memory load...');
      console.log('🔍 window.electronAPI exists:', !!window.electronAPI);
      console.log('🔍 agentOrchestrate exists:', !!window.electronAPI?.agentOrchestrate);
      
      // Use proper agent orchestration architecture
      if (window.electronAPI?.agentOrchestrate) {
        // Create UserMemoryAgent payload to retrieve all intent classification memories
        const agentPayload = agentPayloadOverride ? agentPayloadOverride : {
          intents: [{
            intent: 'memory_retrieve',
            confidence: 1.0,
            agent: 'UserMemoryAgent',
            action: 'query_intent_memories', // Use correct action for intent memories
            query: '*' // Retrieve all memories
          }],
          primaryIntent: 'memory_retrieve',
          entities: [],
          requiresMemoryAccess: true,
          sourceText: 'MemoryDebugger requesting all stored intent classification memories'
        };
        
        console.log('🔍 Sending agent orchestration request:', agentPayload);
        const result = await (window.electronAPI as any).agentOrchestrate(agentPayload);
        
        console.log('📥 Agent orchestration result:', result);
        
        if (result.success && result.data) {
          console.log('🔍 Full result.data structure:', result.data);
          
          // Extract memory data from the correct structure
          // result.data.intentsProcessed is the array of processed intents
          if (result.data.intentsProcessed && Array.isArray(result.data.intentsProcessed)) {
            const memoryIntent = result.data.intentsProcessed.find((intent: any) => 
              intent.intent === 'memory_retrieve'
            );
            
            console.log('🔍 Memory intent found:', memoryIntent);
            
            if (memoryIntent && memoryIntent.result) {
              console.log('🔍 Raw result from UserMemoryAgent:', memoryIntent.result);
              
              // UserMemoryAgent returns { memories: [...], total: ..., userId: ..., retrievedAt: ... }
              // Extract the memories array from the result object
              let memoryData = [];
              
              if (Array.isArray(memoryIntent.result)) {
                // Direct array (legacy format)
                memoryData = memoryIntent.result;
              } else if (memoryIntent.result && Array.isArray(memoryIntent.result.memories)) {
                // New format: { memories: [...], ... }
                memoryData = memoryIntent.result.memories;
                console.log('🔍 UserMemoryAgent metadata:', {
                  total: memoryIntent.result.total,
                  userId: memoryIntent.result.userId,
                  retrievedAt: memoryIntent.result.retrievedAt
                });
              } else {
                console.warn('🔍 Unexpected result format:', memoryIntent.result);
              }
              
              console.log('🔍 Extracted memory data:', memoryData);
              console.log('✅ Retrieved memories via agent orchestration:', memoryData.length);
              
              if (memoryData.length > 0) {
                console.log('🔍 First memory item:', memoryData[0]);
              }
              
              setMemories(memoryData);
            } else {
              console.warn('No memory result found in intent:', memoryIntent);
              setMemories([]);
            }
          } else {
            console.warn('No intentsProcessed found in result.data:', result.data);
            setMemories([]);
          }
        } else {
          console.warn('Agent orchestration failed or returned no results:', result);
          setMemories([]);
        }
      } else {
        throw new Error('Agent orchestration not available - running in web mode');
      }
      
      setLastRefreshTime(new Date());
    } catch (err) {
      console.error('Failed to load memories:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError('Failed to load memories: ' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Add a notification to the list
  const addNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const newNotification: Notification = {
      id: Date.now().toString(),
      message,
      type,
      timestamp: Date.now()
    };
    
    setNotifications(prev => [newNotification, ...prev.slice(0, 4)]); // Keep only 5 most recent notifications
    
    // Auto-remove notification after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== newNotification.id));
    }, 5000);
  };

  // Delete a specific memory
  const deleteMemory = async (memoryId: string) => {
    try {
      if (window.electronAPI?.agentMemoryDelete) {
        // Use dedicated delete method for intent memories
        const result = await window.electronAPI.agentMemoryDelete(memoryId);
        if (result.success) {
          addNotification('Memory deleted successfully', 'success');
          await loadMemories(); // Refresh the list
        } else {
          addNotification(`Failed to delete memory: ${result.error || 'Unknown error'}`, 'error');
        }
      } else if (window.electronAPI?.agentMemoryQuery) {
        // Fallback to query-based delete
        const result = await window.electronAPI.agentMemoryQuery(`DELETE:${memoryId}`);
        if (result.success) {
          addNotification('Memory deleted successfully', 'success');
          await loadMemories();
        } else {
          addNotification(`Failed to delete memory: ${result.error || 'Unknown error'}`, 'error');
        }
      } else {
        addNotification('Delete functionality not available', 'error');
      }
    } catch (err) {
      console.error('Failed to delete memory:', err);
      addNotification(`Failed to delete memory: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  // View screenshot for a memory
  const viewScreenshot = async (memory: IntentMemory) => {
    if (!memory.screenshot) {
      addNotification('No screenshot available for this memory', 'info');
      return;
    }
    
    try {
      // Log the screenshot data for debugging
      console.log('Screenshot data type:', typeof memory.screenshot);
      console.log('Screenshot data:', memory.screenshot);
      
      // Use Electron IPC to open screenshot in always-on-top window
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      
      const result = await window.electronAPI.openScreenshotWindow(memory.screenshot);
      
      if (!result.success) {
        throw new Error('Failed to open screenshot window');
      }
    } catch (err) {
      console.error('Failed to view screenshot:', err);
      addNotification('Failed to view screenshot', 'error');
    }
  };

  // Load memories and check for new ones
  useEffect(() => {
    loadMemories(); // Initial load with full logging
    
    // Set up polling to check for new memories every 5 seconds (quiet mode)
    // const intervalId = setInterval(() => {
    //   loadMemories(); // Use quiet mode for polling to reduce log spam
    // }, 5000);
    
    // return () => clearInterval(intervalId);
  }, []);
  
  // Check for new memories when memories array changes
  useEffect(() => {
    if (lastMemoryCount > 0 && memories.length > lastMemoryCount) {
      // New memories were added
      const newCount = memories.length - lastMemoryCount;
      addNotification(`${newCount} new ${newCount === 1 ? 'memory' : 'memories'} added!`, 'success');
    }
    setLastMemoryCount(memories.length);
  }, [memories.length]);

  // Debug memory structure
  useEffect(() => {
    if (memories.length > 0) {
      console.log('🔍 Memory structure debug:', memories[0]);
    }
  }, [memories]);

  // Filter memories based on search term
  const filteredMemories = memories.filter((memory: IntentMemory | any) => {
    if (!filter) return true;
    const searchTerm = filter.toLowerCase();
    
    // Handle both camelCase and snake_case property names
    const primaryIntent = memory.primaryIntent || memory.primary_intent;
    const sourceText = memory.sourceText || memory.source_text;
    const extractedText = memory.extractedText || memory.extracted_text;
    const suggestedResponse = memory.suggestedResponse || memory.suggested_response;
    
    if (memory.id && (primaryIntent || memory.intents)) {
      return (
        memory.id.toLowerCase().includes(searchTerm) ||
        (primaryIntent && primaryIntent.toLowerCase().includes(searchTerm)) ||
        (sourceText && sourceText.toLowerCase().includes(searchTerm)) ||
        (extractedText && extractedText.toLowerCase().includes(searchTerm)) ||
        (suggestedResponse && suggestedResponse.toLowerCase().includes(searchTerm))
      );
    }
    
    // Handle legacy memory format
    return (
      (memory.key && memory.key.toLowerCase().includes(searchTerm)) ||
      (memory.value && JSON.stringify(memory.value).toLowerCase().includes(searchTerm))
    );
  });

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return dateString;
    }
  };

  const formatValue = (value: any) => {
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const handleClose = () => {
    // Hide the memory debugger window via Electron IPC
    if (window.electronAPI?.hideMemoryDebugger) {
      window.electronAPI.hideMemoryDebugger();
    } else {
      console.log('Memory debugger window close requested - Electron API not available');
    }
  };

  // Notification component
  const NotificationItem = ({ notification }: { notification: Notification }) => {
    const icon = notification.type === 'success' ? (
      <Check className="w-4 h-4 text-green-400" />
    ) : notification.type === 'error' ? (
      <AlertCircle className="w-4 h-4 text-red-400" />
    ) : (
      <Database className="w-4 h-4 text-blue-400" />
    );

    return (
      <div 
        className={`flex items-center p-2 mb-2 rounded-md text-sm animate-fadeIn ${
          notification.type === 'success' ? 'bg-green-500/20 border-l-2 border-green-500' : 
          notification.type === 'error' ? 'bg-red-500/20 border-l-2 border-red-500' : 
          'bg-blue-500/20 border-l-2 border-blue-500'
        }`}
      >
        <div className="mr-2">{icon}</div>
        <div className="flex-1">{notification.message}</div>
      </div>
    );
  };

  return (
    <div className="w-full h-screen flex flex-col bg-gray-900/95">
      {/* Notifications */}
      <div className="fixed top-4 right-4 z-50 w-64 max-w-sm space-y-2">
        {notifications.map(notification => (
          <NotificationItem key={notification.id} notification={notification} />
        ))}
      </div>

      {/* Draggable Header */}
      <div
        className="flex items-center space-x-2 p-4 pb-2 border-b border-white/10 cursor-move flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-8 h-8 bg-gradient-to-br from-purple-400 to-blue-500 rounded-lg flex items-center justify-center">
          <Database className="w-3 h-3 text-white" />
        </div>
        <span className="text-white/90 font-medium text-sm">Memory Debugger</span>
        <div className="flex-1" />
        <span className="text-white/50 text-xs mr-2">
          {lastRefreshTime ? `Last refreshed: ${lastRefreshTime.toLocaleTimeString()}` : 'Not refreshed yet'}
        </span>
        <button 
          onClick={() => loadMemories()} 
          disabled={loading}
          className="px-2 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-md mr-2 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <span className="text-white/50 text-xs">Drag to move</span>
        <button
          onClick={handleClose}
          className="h-6 w-6 p-0 text-white/50 hover:text-white/90 hover:bg-white/10 rounded transition-colors flex items-center justify-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Controls Section */}
      <div 
        className="p-4 border-b border-white/10 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-4 mb-4">
          <input
            type="text"
            placeholder="Filter memories..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 bg-thinkdrop-dark/30 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-white/20"
          />
          <button 
            onClick={populateTestData}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Database className="w-4 h-4" />
            {loading ? 'Loading...' : 'Test Data'}
          </button>
          <button 
            onClick={() => loadMemories()}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ml-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Content Area - Scrollable */}
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden p-4"
        style={{ 
          WebkitAppRegion: 'no-drag',
          minHeight: 0, // Important for flex child to shrink
          maxHeight: '100%'
        } as React.CSSProperties}
      >
        {error && (
          <div className="bg-red-900/30 text-red-200 rounded px-3 py-2 mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="text-xs text-gray-400 mb-4">
          {filteredMemories.length} memories found
        </div>

        <div className="space-y-3">
        {filteredMemories.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {loading ? 'Loading memories...' : 'No memories found'}
          </div>
        ) : (
          filteredMemories.map((memory: IntentMemory | any, index) => {
            // Handle both camelCase and snake_case property names
            const primaryIntent = memory.primaryIntent || memory.primary_intent;
            const sourceText = memory.sourceText || memory.source_text;
            const extractedText = memory.extractedText || memory.extracted_text;
            const suggestedResponse = memory.suggestedResponse || memory.suggested_response;
            const syncedToBackend = memory.syncedToBackend || memory.synced_to_backend;
            const screenshot = memory.screenshot;
            const timestamp = memory.timestamp || memory.created_at;
            
            // Handle new intent memory format
            if (memory.id && (primaryIntent || memory.intents)) {
              return (
                <div key={memory.id || index} className="bg-thinkdrop-dark/50 rounded p-4 border border-white/10">
                  {/* Header with ID and actions */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center space-x-2">
                      <Brain className="h-4 w-4 text-thinkdrop-teal" />
                      <div className="font-mono text-thinkdrop-teal text-xs break-all flex-1">{memory.id}</div>
                    </div>
                    <div className="flex items-center space-x-1">
                      {screenshot && (
                        <button
                          onClick={() => viewScreenshot(memory)}
                          className="p-1 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                          title="View screenshot"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                      )}
                      <div title={syncedToBackend ? "Synced to backend" : "Not synced"}>
                        {syncedToBackend ? (
                          <Cloud className="h-3 w-3 text-green-400" />
                        ) : (
                          <CloudOff className="h-3 w-3 text-yellow-400" />
                        )}
                      </div>
                      <button
                        onClick={() => deleteMemory(memory.id)}
                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete memory"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Primary Intent and Timestamp */}
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Primary Intent:</div>
                      <div className="text-sm text-white bg-thinkdrop-teal/20 px-2 py-1 rounded inline-block">
                        {primaryIntent}
                      </div>
                    </div>
                    {timestamp && (
                      <div className="text-right">
                        <div className="text-xs text-gray-400 mb-1">Created:</div>
                        <div className="text-xs text-gray-400">{formatDate(timestamp)}</div>
                      </div>
                    )}
                  </div>

                  {/* Source Text */}
                  {sourceText && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-400 mb-1">Source Text:</div>
                      <div className="text-xs text-gray-200 bg-black/20 p-2 rounded">
                        {sourceText}
                      </div>
                    </div>
                  )}

                  {/* Extracted Text (from OCR) */}
                  {extractedText && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-400 mb-1">Extracted Text (OCR):</div>
                      <div className="text-xs text-gray-200 bg-black/20 p-2 rounded max-h-24 overflow-y-auto">
                        {extractedText}
                      </div>
                    </div>
                  )}

                  {/* Suggested Response */}
                  {suggestedResponse && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-400 mb-1">Suggested Response:</div>
                      <div className="text-xs text-gray-200 bg-black/20 p-2 rounded">
                        {suggestedResponse}
                      </div>
                    </div>
                  )}

                  {/* Intent Candidates */}
                  {memory.intents && memory.intents.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-400 mb-1">Intent Candidates:</div>
                      <div className="space-y-1">
                        {memory.intents.map((intent: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center text-xs bg-black/20 px-2 py-1 rounded">
                            <span className="text-gray-200">{intent.intent}</span>
                            <span className="text-thinkdrop-teal">{(intent.confidence * 100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Entities */}
                  {memory.entities && memory.entities.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-400 mb-1">Entities:</div>
                      <div className="flex flex-wrap gap-1">
                        {memory.entities.map((entity: string, idx: number) => (
                          <span key={idx} className="text-xs bg-purple-900/30 text-purple-200 px-2 py-1 rounded">
                            {entity}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Flags */}
                  <div className="flex items-center space-x-4 mb-2 text-xs">
                    {memory.requires_memory_access && (
                      <span className="text-blue-300 bg-blue-900/30 px-2 py-1 rounded">Memory Access</span>
                    )}
                    {memory.requires_external_data && (
                      <span className="text-orange-300 bg-orange-900/30 px-2 py-1 rounded">External Data</span>
                    )}
                    {memory.screenshot && (
                      <span className="text-green-300 bg-green-900/30 px-2 py-1 rounded">Has Screenshot</span>
                    )}
                  </div>

                  {/* Timestamps */}
                  <div className="flex justify-between text-[11px] text-gray-500 pt-2 border-t border-white/10">
                    <div>Created: {formatDate(memory.created_at)}</div>
                    <div>Updated: {formatDate(memory.updated_at)}</div>
                    {memory.backend_memory_id && (
                      <div>Backend ID: {memory.backend_memory_id.substring(0, 8)}...</div>
                    )}
                  </div>
                </div>
              );
            } else {
              // Handle legacy memory format
              return (
                <div key={memory.key || index} className="bg-thinkdrop-dark/50 rounded p-3">
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-mono text-thinkdrop-teal text-xs break-all flex-1">{memory.key}</div>
                    <button
                      onClick={() => deleteMemory(memory.key)}
                      className="ml-2 p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors flex-shrink-0"
                      title="Delete memory"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="memory-value text-xs text-gray-200 mb-1">
                    <pre className="whitespace-pre-wrap break-all">{formatValue(memory.value)}</pre>
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-500 mt-1">
                    <div>Created: {formatDate(memory.created_at)}</div>
                    <div>Updated: {formatDate(memory.updated_at)}</div>
                  </div>
                </div>
              );
            }
          })
        )}
        </div>
      </div>
    </div>
  );
};

export default MemoryDebugger;
