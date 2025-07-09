import React, { useState, useEffect } from 'react';
import { Database, X, Check, AlertCircle } from 'lucide-react';
// import './MemoryDebugger.css';

/**
 * MemoryDebugger component for viewing and debugging user memories in DuckDB
 */
interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  timestamp: number;
}

const MemoryDebugger = () => {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastMemoryCount, setLastMemoryCount] = useState(0);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  const loadMemories = async (quiet = false) => {
    try {
      setLoading(true);
      setError(null);
      
      // Check if electronAPI is available
      if (!window.electronAPI?.getAllUserMemories) {
        throw new Error('Electron API not available - running in web mode');
      }
      
      const result = await window.electronAPI.getAllUserMemories({ quiet });
      setMemories(result || []);
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

  // Load memories and check for new ones
  useEffect(() => {
    loadMemories(false); // Initial load with full logging
    
    // Set up polling to check for new memories every 5 seconds (quiet mode)
    const intervalId = setInterval(() => {
      loadMemories(true); // Use quiet mode for polling to reduce log spam
    }, 5000);
    
    return () => clearInterval(intervalId);
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

  const filteredMemories = memories.filter(memory => {
    const searchTerm = filter.toLowerCase();
    if (!searchTerm) return true;
    
    const key = memory.key?.toLowerCase() || '';
    const value = JSON.stringify(memory.value).toLowerCase();
    
    return key.includes(searchTerm) || value.includes(searchTerm);
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
        <div className="w-3 h-6 bg-gradient-to-br from-purple-400 to-blue-500 rounded-lg flex items-center justify-center">
          <Database className="w-3 h-3 text-white" />
        </div>
        <span className="text-white/90 font-medium text-sm">Memory Debugger</span>
        <div className="flex-1" />
        <span className="text-white/50 text-xs mr-2">
          {lastRefreshTime ? `Last refreshed: ${lastRefreshTime.toLocaleTimeString()}` : 'Not refreshed yet'}
        </span>
        <button 
          onClick={() => loadMemories(false)} 
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
        <div className="flex space-x-2">
          <input
            type="text"
            placeholder="Filter memories..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 bg-thinkdrop-dark/30 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-white/20"
          />
          <button
            onClick={() => loadMemories(false)}
            disabled={loading}
            className="px-4 py-2 rounded text-sm text-white/90 hover:bg-white/10 transition-colors border border-white/10 disabled:opacity-60 bg-white/5"
          >
            {loading ? 'Loading...' : 'Refresh'}
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
          filteredMemories.map((memory, index) => (
            <div key={index} className="bg-thinkdrop-dark/50 rounded p-3">
              <div className="font-mono text-thinkdrop-teal text-xs mb-1 break-all">{memory.key}</div>
              <div className="memory-value text-xs text-gray-200 mb-1">
                <pre className="whitespace-pre-wrap break-all">{formatValue(memory.value)}</pre>
              </div>
              <div className="flex justify-between text-[11px] text-gray-500 mt-1">
                <div>Created: {formatDate(memory.created_at)}</div>
                <div>Updated: {formatDate(memory.updated_at)}</div>
              </div>
            </div>
          ))
        )}
        </div>
      </div>
    </div>
  );
};

export default MemoryDebugger;
