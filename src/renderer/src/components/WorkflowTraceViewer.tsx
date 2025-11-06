import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Zap,
  TrendingUp,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  BarChart3
} from 'lucide-react';

/**
 * WorkflowTraceViewer - Visualize StateGraph execution performance
 * 
 * Features:
 * - Real-time workflow execution tracking
 * - Node-by-node performance breakdown
 * - Bottleneck detection and highlighting
 * - Visual timeline with color-coded durations
 * - Historical trace comparison
 */

interface TraceStep {
  node: string;
  duration: number;
  timestamp: string;
  input?: any;
  output?: any;
  success: boolean;
  error?: string;
}

interface WorkflowTrace {
  id: string;
  message: string;
  sessionId: string;
  intentType?: string;
  startTime: number;
  elapsedMs: number;
  iterations: number;
  success: boolean;
  trace: TraceStep[];
  error?: string;
  fromCache?: boolean;
  cacheAge?: number;
}

interface NodeStats {
  node: string;
  totalDuration: number;
  avgDuration: number;
  count: number;
  successRate: number;
  percentage: number;
}

const WorkflowTraceViewer: React.FC = () => {
  const [traces, setTraces] = useState<WorkflowTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<WorkflowTrace | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [showDetails, setShowDetails] = useState(false); // For mobile navigation

  // Load traces from backend
  const loadTraces = async () => {
    try {
      setLoading(true);
      
      if (window.electronAPI?.getWorkflowTraces) {
        const result = await window.electronAPI.getWorkflowTraces({
          limit: 50,
          includeCache: true
        });
        
        if (result.success && result.traces) {
          setTraces(result.traces);
          
          // Auto-select most recent trace if none selected
          if (!selectedTrace && result.traces.length > 0) {
            setSelectedTrace(result.traces[0]);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load workflow traces:', error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh setup
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(loadTraces, 2000); // Refresh every 2 seconds
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    } else if (refreshInterval) {
      clearInterval(refreshInterval);
      setRefreshInterval(null);
    }
  }, [autoRefresh]);

  // Initial load
  useEffect(() => {
    loadTraces();
  }, []);

  // Toggle node expansion
  const toggleNodeExpansion = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  // Calculate node statistics
  const calculateNodeStats = (trace: WorkflowTrace): NodeStats[] => {
    const nodeMap = new Map<string, { durations: number[]; successes: number; total: number }>();
    
    trace.trace.forEach(step => {
      if (!nodeMap.has(step.node)) {
        nodeMap.set(step.node, { durations: [], successes: 0, total: 0 });
      }
      const stats = nodeMap.get(step.node)!;
      stats.durations.push(step.duration);
      stats.total += 1;
      if (step.success) stats.successes += 1;
    });
    
    return Array.from(nodeMap.entries()).map(([node, stats]) => {
      const totalDuration = stats.durations.reduce((sum, d) => sum + d, 0);
      return {
        node,
        totalDuration,
        avgDuration: totalDuration / stats.durations.length,
        count: stats.total,
        successRate: (stats.successes / stats.total) * 100,
        percentage: (totalDuration / trace.elapsedMs) * 100
      };
    }).sort((a, b) => b.totalDuration - a.totalDuration);
  };

  // Find bottleneck (slowest node)
  const findBottleneck = (trace: WorkflowTrace): TraceStep | null => {
    if (!trace.trace || trace.trace.length === 0) return null;
    return trace.trace.reduce((slowest, step) => 
      step.duration > slowest.duration ? step : slowest
    );
  };

  // Get duration color based on speed
  const getDurationColor = (duration: number): string => {
    if (duration < 100) return 'text-green-400';
    if (duration < 500) return 'text-yellow-400';
    if (duration < 1000) return 'text-orange-400';
    return 'text-red-400';
  };

  // Get duration background color for bars
  const getDurationBgColor = (duration: number): string => {
    if (duration < 100) return 'bg-green-500';
    if (duration < 500) return 'bg-yellow-500';
    if (duration < 1000) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  // Render trace list
  const renderTraceList = () => (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Recent Workflows ({traces.length})
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1 rounded text-sm flex items-center gap-1 ${
              autoRefresh 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : 'bg-white/5 text-white/60 border border-white/10'
            }`}
          >
            <RefreshCw className={`h-3 w-3 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto-refresh
          </button>
          <button
            onClick={loadTraces}
            disabled={loading}
            className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white/80 rounded text-sm border border-white/10 flex items-center gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {traces.map(trace => {
          const bottleneck = findBottleneck(trace);
          const isSelected = selectedTrace?.id === trace.id;
          
          return (
            <div
              key={trace.id}
              onClick={() => {
                setSelectedTrace(trace);
                setShowDetails(true); // Show details on mobile
              }}
              className={`p-3 rounded-lg cursor-pointer transition-all ${
                isSelected 
                  ? 'bg-blue-500/20 border-blue-500/50' 
                  : 'bg-white/5 hover:bg-white/10 border-white/10'
              } border`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {trace.success ? (
                      <CheckCircle className="h-4 w-4 text-green-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-white/90 text-sm font-medium truncate">
                      {trace.message}
                    </span>
                    {trace.fromCache && (
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded border border-purple-500/30">
                        Cached
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3 text-xs text-white/50">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(trace.elapsedMs)}
                    </span>
                    {trace.intentType && (
                      <span className="px-2 py-0.5 bg-white/5 rounded">
                        {trace.intentType}
                      </span>
                    )}
                    <span>{trace.trace.length} nodes</span>
                  </div>
                </div>
                
                {bottleneck && (
                  <div className="text-right ml-2">
                    <div className="text-xs text-white/50">Bottleneck</div>
                    <div className={`text-sm font-mono ${getDurationColor(bottleneck.duration)}`}>
                      {bottleneck.node}
                    </div>
                    <div className="text-xs text-white/40">
                      {formatDuration(bottleneck.duration)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Render timeline visualization
  const renderTimeline = (trace: WorkflowTrace) => {
    const maxDuration = Math.max(...trace.trace.map(s => s.duration));
    
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-white/80 flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4" />
          Execution Timeline
        </h4>
        
        {trace.trace.map((step, index) => {
          const widthPercent = (step.duration / maxDuration) * 100;
          const isExpanded = expandedNodes.has(`${trace.id}-${index}`);
          
          return (
            <div key={index} className="space-y-1">
              <div 
                onClick={() => toggleNodeExpansion(`${trace.id}-${index}`)}
                className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-2 rounded transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-white/50 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-white/50 flex-shrink-0" />
                )}
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {step.success ? (
                      <CheckCircle className="h-3 w-3 text-green-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-sm text-white/90 font-mono">
                      {step.node}
                    </span>
                    <span className={`text-xs font-mono ${getDurationColor(step.duration)}`}>
                      {formatDuration(step.duration)}
                    </span>
                  </div>
                  
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${getDurationBgColor(step.duration)} transition-all duration-300`}
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                </div>
              </div>
              
              {isExpanded && (
                <div className="ml-6 pl-4 border-l border-white/10 space-y-2 text-xs">
                  <div className="bg-white/5 rounded p-2">
                    <div className="text-white/50 mb-1">Timestamp</div>
                    <div className="text-white/80 font-mono">{formatTimestamp(step.timestamp)}</div>
                  </div>
                  
                  {step.error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
                      <div className="text-red-400 mb-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Error
                      </div>
                      <div className="text-red-300/80 font-mono text-xs">{step.error}</div>
                    </div>
                  )}
                  
                  {step.input && (
                    <div className="bg-white/5 rounded p-2">
                      <div className="text-white/50 mb-1">Input State</div>
                      <pre className="text-white/70 font-mono text-xs overflow-x-auto">
                        {JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  
                  {step.output && (
                    <div className="bg-white/5 rounded p-2">
                      <div className="text-white/50 mb-1">Output State</div>
                      <pre className="text-white/70 font-mono text-xs overflow-x-auto">
                        {JSON.stringify(step.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Render performance stats
  const renderStats = (trace: WorkflowTrace) => {
    const stats = calculateNodeStats(trace);
    const bottleneck = findBottleneck(trace);
    
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Performance Analysis
        </h4>
        
        {/* Overall metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Total Duration</div>
            <div className={`text-lg font-mono font-semibold ${getDurationColor(trace.elapsedMs)}`}>
              {formatDuration(trace.elapsedMs)}
            </div>
          </div>
          
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Nodes Executed</div>
            <div className="text-lg font-mono font-semibold text-white/90">
              {trace.trace.length}
            </div>
          </div>
          
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Success Rate</div>
            <div className="text-lg font-mono font-semibold text-green-400">
              {((trace.trace.filter(s => s.success).length / trace.trace.length) * 100).toFixed(0)}%
            </div>
          </div>
          
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Iterations</div>
            <div className="text-lg font-mono font-semibold text-white/90">
              {trace.iterations}
            </div>
          </div>
        </div>

        {/* Bottleneck highlight */}
        {bottleneck && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="text-sm font-semibold text-red-400">Bottleneck Detected</span>
            </div>
            <div className="text-white/80">
              <span className="font-mono text-sm">{bottleneck.node}</span>
              <span className="text-white/50 mx-2">took</span>
              <span className={`font-mono font-semibold ${getDurationColor(bottleneck.duration)}`}>
                {formatDuration(bottleneck.duration)}
              </span>
              <span className="text-white/50 ml-2">
                ({((bottleneck.duration / trace.elapsedMs) * 100).toFixed(1)}% of total)
              </span>
            </div>
          </div>
        )}

        {/* Node breakdown */}
        <div>
          <h5 className="text-xs font-semibold text-white/70 mb-2">Node Performance Breakdown</h5>
          <div className="space-y-2">
            {stats.map((stat) => (
              <div key={stat.node} className="bg-white/5 rounded p-2 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-mono text-white/90">{stat.node}</span>
                  <span className={`text-sm font-mono font-semibold ${getDurationColor(stat.totalDuration)}`}>
                    {formatDuration(stat.totalDuration)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-white/50">
                  <span>{stat.percentage.toFixed(1)}% of total</span>
                  <span>•</span>
                  <span>{stat.count} call{stat.count > 1 ? 's' : ''}</span>
                  <span>•</span>
                  <span>Avg: {formatDuration(stat.avgDuration)}</span>
                </div>
                <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${getDurationBgColor(stat.totalDuration)}`}
                    style={{ width: `${stat.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-14">
    <div className="bg-black/40 backdrop-blur-xl rounded-lg border border-white/10">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          {/* Back button for mobile when viewing details */}
          {showDetails && selectedTrace && (
            <button
              onClick={() => setShowDetails(false)}
              className="lg:hidden p-2 hover:bg-white/10 rounded text-white/80 transition-colors"
            >
              <ChevronRight className="h-5 w-5 rotate-180" />
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              Workflow Performance Monitor
            </h2>
            <p className="text-sm text-white/50 mt-1">
              Real-time StateGraph execution analysis and bottleneck detection
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {/* Responsive layout: stack on mobile, side-by-side on desktop */}
        <div className="h-full lg:grid lg:grid-cols-2 gap-4 p-4">
          {/* Trace list - hidden on mobile when showing details */}
          <div className={`h-full overflow-y-auto ${
            showDetails && selectedTrace ? 'hidden lg:block' : 'block'
          }`}>
            {renderTraceList()}
          </div>

          {/* Selected trace details - hidden on mobile when not showing details */}
          <div className={`h-full overflow-y-auto space-y-6 ${
            showDetails || !selectedTrace ? 'block' : 'hidden lg:block'
          }`}>
            {selectedTrace ? (
              <>
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {selectedTrace.message}
                  </h3>
                  <div className="flex items-center gap-3 text-sm text-white/60">
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {formatDuration(selectedTrace.elapsedMs)}
                    </span>
                    {selectedTrace.intentType && (
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded border border-blue-500/30">
                        {selectedTrace.intentType}
                      </span>
                    )}
                    {selectedTrace.fromCache && (
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded border border-purple-500/30">
                        Cached ({formatDuration(selectedTrace.cacheAge || 0)} old)
                      </span>
                    )}
                  </div>
                </div>

                {renderStats(selectedTrace)}
                {renderTimeline(selectedTrace)}
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-white/40">
                <div className="text-center">
                  <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Select a workflow trace to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};

export default WorkflowTraceViewer;
