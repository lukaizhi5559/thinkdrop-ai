import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, AlertCircle, Clock, Cpu, MemoryStick, Zap } from 'lucide-react';
import { useLocalLLM } from '../contexts/LocalLLMContext';

interface AgentStatus {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'error' | 'loading';
  lastActivity: string;
  cpuUsage: number;
  memoryUsage: number;
  tasksCompleted: number;
  uptime: string;
}

const AgentStatusPanel: React.FC = () => {
  const { cachedAgents } = useLocalLLM();
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  // Mock agent data generation
  useEffect(() => {
    const generateMockAgents = (): AgentStatus[] => {
      const baseAgents: AgentStatus[] = [
        {
          id: 'agent-1',
          name: 'Chat Assistant',
          status: 'active',
          lastActivity: new Date(Date.now() - 30000).toISOString(),
          cpuUsage: Math.random() * 20 + 10,
          memoryUsage: Math.random() * 30 + 40,
          tasksCompleted: Math.floor(Math.random() * 50) + 20,
          uptime: '2h 15m'
        },
        {
          id: 'agent-2',
          name: 'Code Analyzer',
          status: 'idle',
          lastActivity: new Date(Date.now() - 120000).toISOString(),
          cpuUsage: Math.random() * 5 + 2,
          memoryUsage: Math.random() * 20 + 15,
          tasksCompleted: Math.floor(Math.random() * 30) + 10,
          uptime: '1h 45m'
        },
        {
          id: 'agent-3',
          name: 'Memory Indexer',
          status: 'loading',
          lastActivity: new Date(Date.now() - 5000).toISOString(),
          cpuUsage: Math.random() * 40 + 30,
          memoryUsage: Math.random() * 25 + 50,
          tasksCompleted: Math.floor(Math.random() * 20) + 5,
          uptime: '45m'
        }
      ];

      // Add cached agents from context
      const contextAgents: AgentStatus[] = cachedAgents.map((agent, index) => ({
        id: `cached-${index}`,
        name: agent.name || `Agent ${index + 1}`,
        status: 'active' as const,
        lastActivity: new Date().toISOString(),
        cpuUsage: Math.random() * 15 + 5,
        memoryUsage: Math.random() * 25 + 20,
        tasksCompleted: Math.floor(Math.random() * 40) + 15,
        uptime: `${Math.floor(Math.random() * 3) + 1}h ${Math.floor(Math.random() * 60)}m`
      }));

      return [...baseAgents, ...contextAgents];
    };

    const updateAgents = () => {
      setAgents(generateMockAgents());
    };

    updateAgents();
    const interval = setInterval(updateAgents, refreshInterval);

    return () => clearInterval(interval);
  }, [cachedAgents, refreshInterval]);

  const getStatusIcon = (status: AgentStatus['status']) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'idle':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'loading':
        return <Activity className="w-4 h-4 text-blue-500 animate-spin" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: AgentStatus['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'idle':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'error':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'loading':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const formatLastActivity = (timestamp: string) => {
    const now = new Date();
    const activity = new Date(timestamp);
    const diffMs = now.getTime() - activity.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <div className="h-full overflow-auto">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-teal-400" />
            <h3 className="text-lg font-semibold text-white">Agent Status</h3>
          </div>
          <div className="flex items-center space-x-2">
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
            >
              <option value={1000}>1s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>
            <span className="text-xs text-gray-400">refresh</span>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center space-x-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-gray-300">Active</span>
            </div>
            <div className="text-xl font-bold text-white mt-1">
              {agents.filter(a => a.status === 'active').length}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-yellow-500" />
              <span className="text-sm text-gray-300">Idle</span>
            </div>
            <div className="text-xl font-bold text-white mt-1">
              {agents.filter(a => a.status === 'idle').length}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-gray-300">Loading</span>
            </div>
            <div className="text-xl font-bold text-white mt-1">
              {agents.filter(a => a.status === 'loading').length}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-gray-300">Errors</span>
            </div>
            <div className="text-xl font-bold text-white mt-1">
              {agents.filter(a => a.status === 'error').length}
            </div>
          </div>
        </div>

        {/* Agent List */}
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-gray-800/30 border border-gray-700 rounded-lg p-4 hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(agent.status)}
                  <div>
                    <h4 className="font-medium text-white">{agent.name}</h4>
                    <p className="text-sm text-gray-400">ID: {agent.id}</p>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(agent.status)}`}>
                  {agent.status.toUpperCase()}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-blue-400" />
                  <span className="text-gray-300">CPU: {agent.cpuUsage.toFixed(1)}%</span>
                </div>
                <div className="flex items-center space-x-2">
                  <MemoryStick className="w-4 h-4 text-purple-400" />
                  <span className="text-gray-300">RAM: {agent.memoryUsage.toFixed(1)}%</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-gray-300">Tasks: {agent.tasksCompleted}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-green-400" />
                  <span className="text-gray-300">Up: {agent.uptime}</span>
                </div>
              </div>

              <div className="mt-2 text-xs text-gray-500">
                Last activity: {formatLastActivity(agent.lastActivity)}
              </div>
            </div>
          ))}
        </div>

        {agents.length === 0 && (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No agents currently running</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentStatusPanel;
