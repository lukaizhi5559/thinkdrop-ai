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
  const [filter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastMemoryCount, setLastMemoryCount] = useState(0);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [paginationInfo, setPaginationInfo] = useState<any>(null);

  const loadMemories = async (loadMore: boolean = false, searchQuery: string = '') => {
    try {
      if (!loadMore) {
        setLoading(true);
        setError(null);
      }
      
      // Calculate pagination parameters
      const limit = 25; // Load 25 memories at a time for better performance
      const offset = loadMore ? memories.length : 0;
      
      console.log(`🔍 MemoryDebugger: Loading memories (offset: ${offset}, limit: ${limit}, search: '${searchQuery}')`);
      
      // Use direct memory query for fast loading
      if (window.electronAPI?.queryMemoriesDirect) {
        const result = await (window.electronAPI as any).queryMemoriesDirect({
          limit,
          offset,
          searchQuery: searchQuery || null
        });
        
        console.log('📥 Direct memory query result:', result);
        
        if (result.success && result.data) {
          console.log('🔍 Direct query result structure:', result.data);
          
          // Handle direct query response format: { memories: [...], pagination: {...} }
          const { memories: newMemories, pagination } = result.data;
          
          if (Array.isArray(newMemories)) {
            console.log(`✅ Retrieved ${newMemories.length} memories directly (${pagination.offset}-${pagination.offset + newMemories.length} of ${pagination.total})`);
            
            if (newMemories.length > 0) {
              console.log('🔍 First memory item:', newMemories[0]);
            }
            
            // Update memories: append if loading more, replace if fresh load
            if (loadMore) {
              setMemories(prev => [...prev, ...newMemories]);
            } else {
              setMemories(newMemories);
            }
            
            // Store pagination info for "Load More" functionality
            setPaginationInfo(pagination);
          } else {
            console.warn('🔍 No memories array found in direct query result:', result.data);
            if (!loadMore) {
              setMemories([]);
            }
          }
        } else {
          console.warn('Direct memory query failed:', result);
          if (!loadMore) {
            setMemories([]);
          }
        }
      } else {
        // Fallback to old agent orchestration method if direct query not available
        console.log('⚠️ Direct query not available, falling back to agent orchestration...');
        const result = await (window.electronAPI as any).agentOrchestrate({
          intents: [{
            intent: 'memory_retrieve',
            confidence: 1.0,
            agent: 'UserMemoryAgent',
            action: 'query_intent_memories',
            query: searchQuery || '*'
          }],
          primaryIntent: 'memory_retrieve',
          entities: [],
          requiresMemoryAccess: true,
          sourceText: 'MemoryDebugger requesting stored memories'
        });

        console.log('THE MEMORY RESULTS:', result)
        
        if (result.success && result.data?.intentsProcessed) {
          const memoryIntent = result.data.intentsProcessed.find((intent: any) => 
            intent.intent === 'memory_retrieve'
          );
          
          if (memoryIntent?.result?.memories) {
            const newMemories = memoryIntent.result.memories;
            if (loadMore) {
              setMemories(prev => [...prev, ...newMemories]);
            } else {
              setMemories(newMemories);
            }
          }
        } else {
          throw new Error('Agent orchestration not available - running in web mode');
        }
      }
      
      setLastRefreshTime(new Date());
      console.log('✅ Memory loading completed successfully, component should remain visible');
    } catch (err) {
      console.error('Failed to load memories:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError('Failed to load memories: ' + errorMessage);
    } finally {
      setLoading(false);
      console.log('🔄 Loading state set to false, component render cycle complete');
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
      console.log('🗑️ Attempting to delete memory with ID:', memoryId);
      console.log('🗑️ Memory ID type:', typeof memoryId);
      console.log('🗑️ Memory ID length:', memoryId?.length);
      
      if (window.electronAPI?.deleteMemoryDirect) {
        // Use new direct delete method for fast deletion
        const result = await window.electronAPI.deleteMemoryDirect(memoryId);
        if (result.success) {
          console.log('✅ Memory deleted successfully:', result);
          addNotification(`Memory deleted successfully (${result.deletedCount} record removed)`, 'success');
          await loadMemories(false, searchQuery); // Refresh the list with current search
        } else {
          console.error('❌ Delete failed:', result.error);
          addNotification(`Failed to delete memory: ${result.error || 'Unknown error'}`, 'error');
        }
      } else if (window.electronAPI?.agentMemoryDelete) {
        // Fallback to legacy delete method
        const result = await window.electronAPI.agentMemoryDelete(memoryId);
        if (result.success) {
          addNotification('Memory deleted successfully', 'success');
          await loadMemories(false, searchQuery);
        } else {
          addNotification(`Failed to delete memory: ${result.error || 'Unknown error'}`, 'error');
        }
      } else {
        console.error('❌ No delete functionality available');
        addNotification('Delete functionality not available', 'error');
      }
    } catch (err) {
      console.error('❌ Failed to delete memory:', err);
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
      console.log('Screenshot data length:', memory.screenshot instanceof Uint8Array ? memory.screenshot.length : memory.screenshot.length);
      
      // Log first few characters to see what we're dealing with
      if (memory.screenshot instanceof Uint8Array) {
        const preview = Array.from(memory.screenshot.slice(0, 50), byte => String.fromCharCode(byte)).join('');
        console.log('Uint8Array preview (first 50 chars):', preview);
      } else if (typeof memory.screenshot === 'string') {
        console.log('String preview (first 100 chars):', memory.screenshot.substring(0, 100));
      }
      
      let screenshotData: string;
      
      // Handle different screenshot data formats
      if (memory.screenshot instanceof Uint8Array) {
        // The Uint8Array likely contains ASCII codes of a base64 string, not raw binary
        const base64String = Array.from(memory.screenshot, byte => String.fromCharCode(byte)).join('');
        
        // Check if it's already a valid base64 string (no need to btoa again)
        if (base64String.match(/^[A-Za-z0-9+/]*={0,2}$/)) {
          screenshotData = `data:image/png;base64,${base64String}`;
          console.log('📸 Converted Uint8Array (base64 ASCII) to data URL');
        } else {
          // If it's not base64, treat as raw binary and encode
          screenshotData = `data:image/png;base64,${btoa(base64String)}`;
          console.log('📸 Converted Uint8Array (raw binary) to data URL');
        }
      } else if (typeof memory.screenshot === 'string') {
        // Handle base64 string (add data URL prefix if missing)
        if (memory.screenshot.startsWith('data:image')) {
          screenshotData = memory.screenshot;
        } else {
          screenshotData = `data:image/png;base64,${memory.screenshot}`;
        }
        console.log('📸 Using string screenshot data');
      } else {
        throw new Error(`Unsupported screenshot data type: ${typeof memory.screenshot}`);
      }
      
      // Use Electron IPC to open screenshot in chromeless overlay window
      if (!window.electronAPI) {
        // Fallback: open in new browser tab for debugging
        console.log('Electron API not available, opening in new tab');
        const newWindow = window.open();
        if (newWindow) {
          newWindow.document.write(`<img src="${screenshotData}" style="max-width: 100%; height: auto;" />`);
          addNotification('Screenshot opened in new tab (fallback)', 'info');
        } else {
          throw new Error('Could not open screenshot window');
        }
        return;
      }
      
      console.log('Frontend - About to send screenshot data to Electron:');
      console.log('Frontend - Data type:', typeof screenshotData);
      console.log('Frontend - Data length:', screenshotData?.length || 'N/A');
      console.log('Frontend - Data preview:', screenshotData.substring(0, 100));
      console.log('Frontend - Starts with data URL:', screenshotData.startsWith('data:'));
      
      const result = await window.electronAPI.openScreenshotWindow(screenshotData);
      
      console.log('Frontend - Screenshot window result:', result);
      
      if (result && result.success) {
        addNotification('Screenshot opened successfully', 'success');
      } else {
        console.error('Electron screenshot window failed, trying fallback');
        console.error('Result object:', result);
        // Fallback: open in new browser tab
        const newWindow = window.open();
        if (newWindow) {
          newWindow.document.write(`<img src="${screenshotData}" style="max-width: 100%; height: auto;" />`);
          addNotification('Screenshot opened in new tab (fallback)', 'info');
        } else {
          throw new Error('Failed to open screenshot window and fallback failed');
        }
      }
    } catch (err) {
      console.error('Failed to view screenshot:', err);
      addNotification(`Failed to view screenshot: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  // Load memories on component mount
  useEffect(() => {
    console.log('🚀 MemoryDebugger component mounted, loading memories...');
    loadMemories(false, '');
    
    // Cleanup function to track unmounting
    return () => {
      console.log('🚨 MemoryDebugger component unmounting!');
    };
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

      {/* Memory Header removed - now rendered in UnifiedInterface */}

      {/* Controls Section */}
      <div 
        className="p-4 border-b border-white/10 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex flex-1text-white/50 text-xs mr-2">
            {lastRefreshTime ? `Last refreshed: ${lastRefreshTime.toLocaleTimeString()}` : 'Not refreshed yet'}
          </div>
          <button 
            onClick={() => loadMemories(false, searchQuery)} 
            disabled={loading}
            className="px-2 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-md mr-2 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) {
                loadMemories(false, searchQuery);
              }
            }}
            className="flex-1 bg-thinkdrop-dark/30 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-white/20"
          />
          {/* <button 
            onClick={() => loadMemories(false, searchQuery)}
            disabled={loading}
            className="px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-md transition-colors flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Search
          </button> */}          
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
                        {memory.entities.map((entity: any, idx: number) => {
                          // Handle both old string format and new object format
                          const entityValue = typeof entity === 'string' ? entity : entity.value || entity;
                          const entityType = typeof entity === 'object' ? entity.type : null;
                          const normalizedValue = typeof entity === 'object' ? entity.normalized_value : null;
                          
                          return (
                            <div key={idx} className="text-xs bg-purple-900/30 text-purple-200 px-2 py-1 rounded flex flex-col">
                              <div className="flex items-center gap-1">
                                <span>{entityValue}</span>
                                {entityType && (
                                  <span className="text-purple-300 text-[10px] opacity-70">({entityType})</span>
                                )}
                              </div>
                              {normalizedValue && normalizedValue !== entityValue && (
                                <div className="text-purple-300 text-[10px] opacity-70 mt-0.5">
                                  → {normalizedValue}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Flags */}
                  <div className="flex items-center space-x-4 mb-2 text-xs">
                    {memory.requires_memory_access > 0 && (
                      <span className="text-blue-300 bg-blue-900/30 px-2 py-1 rounded">Memory Access</span>
                    )}
                    {memory.requires_external_data > 0 && (
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
        
        {/* Load More Button for Pagination */}
        {memories.length > 0 && paginationInfo && paginationInfo.hasMore && (
          <div className="flex justify-center mt-4 pt-4 border-t border-white/10">
            <button
              onClick={() => loadMemories(true, searchQuery)}
              disabled={loading}
              className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  Load More ({Number(paginationInfo.total) - memories.length} remaining)
                </>
              )}
            </button>
          </div>
        )}
        
        {/* Pagination Info */}
        {paginationInfo && (
          <div className="text-center mt-2 text-xs text-gray-400">
            Showing {memories.length} of {Number(paginationInfo.total)} memories
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default MemoryDebugger;
