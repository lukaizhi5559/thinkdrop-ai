import React, { useState, useEffect } from 'react';
import { Database, X } from 'lucide-react';
import './MemoryDebugger.css';

/**
 * MemoryDebugger component for viewing and debugging user memories in DuckDB
 */
const MemoryDebugger = () => {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const loadMemories = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Check if electronAPI is available
      if (!window.electronAPI?.getAllUserMemories) {
        throw new Error('Electron API not available - running in web mode');
      }
      
      const result = await window.electronAPI.getAllUserMemories();
      setMemories(result || []);
    } catch (err) {
      console.error('Failed to load memories:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError('Failed to load memories: ' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
  }, []);

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

  return (
    <div className="w-full h-screen flex flex-col bg-gray-900/95">
      {/* Draggable Header */}
      <div
        className="flex items-center space-x-2 p-4 pb-2 border-b border-white/10 cursor-move flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-6 h-6 bg-gradient-to-br from-purple-400 to-blue-500 rounded-lg flex items-center justify-center">
          <Database className="w-3 h-3 text-white" />
        </div>
        <span className="text-white/90 font-medium text-sm">Memory Debugger</span>
        <div className="flex-1" />
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
            onClick={loadMemories}
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
