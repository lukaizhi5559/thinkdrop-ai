import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { 
  Plug, 
  PlugZap,
  Settings,
  CheckCircle2,
  XCircle,
  Loader2,
  Search
} from 'lucide-react';

interface MCPService {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  connected: boolean;
  toolCount?: number;
  icon?: string;
  status?: 'connected' | 'disconnected' | 'error' | 'authenticating';
  requiresAuth?: boolean;
  authenticated?: boolean;
  settings?: {
    label: string;
    action: () => void;
  }[];
}

interface MCPPanelProps {
  isOpen: boolean;
}

const MCPPanel: React.FC<MCPPanelProps> = ({ isOpen }) => {
  const [mcpServices, setMcpServices] = useState<MCPService[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Load MCP services
  useEffect(() => {
    loadMCPServices();
  }, []);

  const loadMCPServices = async () => {
    // TODO: Load from actual MCP registry
    // For now, hardcoded with command service
    const services: MCPService[] = [
      {
        id: 'command-service',
        name: 'Command Service',
        description: 'Execute shell commands with natural language using Gemini AI',
        enabled: true,
        connected: true,
        toolCount: 3,
        icon: '⚡',
        status: 'connected',
        requiresAuth: true,
        authenticated: false, // Will be updated from API
        settings: [
          {
            label: 'Connect to Gemini',
            action: () => handleGeminiOAuth()
          }
        ]
      },
      {
        id: 'conversation-service',
        name: 'Conversation Service',
        description: 'Store and retrieve conversation history with semantic search',
        enabled: true,
        connected: true,
        toolCount: 5,
        icon: '💬',
        status: 'connected'
      },
      {
        id: 'memory',
        name: 'Memory',
        description: 'Knowledge graph for persistent context and learning',
        enabled: true,
        connected: true,
        toolCount: 9,
        icon: '🧠',
        status: 'connected'
      }
    ];

    // Check command service Gemini status
    try {
      const response = await fetch('http://localhost:3007/gemini.status', {
        method: 'POST',
        headers: {
          'Authorization': 'q6E53kWzIGoxkohxuih3A4xVS06PZn1I',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'gemini.status',
          payload: {}
        })
      });

      const data = await response.json();
      if (data.success && data.gemini) {
        const commandService = services.find(s => s.id === 'command-service');
        if (commandService) {
          commandService.authenticated = data.gemini.authenticated;
          commandService.status = data.gemini.authenticated ? 'connected' : 'disconnected';
        }
      }
    } catch (error) {
      console.error('Failed to check Gemini status:', error);
    }

    setMcpServices(services);
  };

  const handleGeminiOAuth = async () => {
    setIsAuthenticating(true);
    
    try {
      // Call IPC handler instead of direct fetch
      const result = await window.electronAPI?.geminiOAuthStart();
      
      if (result?.success) {
        // Reload services to update auth status
        await loadMCPServices();
        alert('✅ Successfully connected to Gemini!');
      } else {
        alert(`❌ Failed to connect: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('OAuth failed:', error);
      alert('❌ Failed to start OAuth flow');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleToggleMCP = async (mcpId: string) => {
    // TODO: Implement enable/disable logic
    setMcpServices(prev => 
      prev.map(mcp => 
        mcp.id === mcpId 
          ? { ...mcp, enabled: !mcp.enabled }
          : mcp
      )
    );
  };

  const filteredServices = mcpServices.filter(mcp =>
    mcp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    mcp.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const installedServices = filteredServices.filter(mcp => mcp.enabled);
  const availableServices = filteredServices.filter(mcp => !mcp.enabled);

  if (!isOpen) return null;

  return (
    <div className="w-full h-full flex flex-col bg-transparent overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white mb-3">MCP Marketplace</h2>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[600px] overflow-y-auto">
        {/* Installed MCPs */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white/70">
              Installed MCPs
              <span className="ml-2 text-white/40">{installedServices.length} / 100 tools</span>
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/40 hover:text-white h-6 w-6 p-0"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {installedServices.map((mcp) => (
              <div
                key={mcp.id}
                className="bg-white/5 rounded-lg p-3 border border-white/10 hover:border-white/20 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1">
                    {/* Icon */}
                    <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
                      {mcp.icon || '📦'}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h4 className="text-sm font-medium text-white">{mcp.name}</h4>
                        {mcp.requiresAuth && (
                          <span className="text-xs text-blue-400">OAuth</span>
                        )}
                      </div>
                      
                      {/* Status */}
                      <div className="flex items-center space-x-2 mb-2">
                        {mcp.authenticated ? (
                          <div className="flex items-center space-x-1 text-xs text-green-400">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Authenticated</span>
                          </div>
                        ) : mcp.requiresAuth ? (
                          <div className="flex items-center space-x-1 text-xs text-yellow-400">
                            <XCircle className="w-3 h-3" />
                            <span>Not authenticated</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1 text-xs text-green-400">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Enabled</span>
                          </div>
                        )}
                        
                        {mcp.toolCount && (
                          <span className="text-xs text-white/40">
                            {mcp.toolCount} / {mcp.toolCount} tools
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-white/50 line-clamp-2">
                        {mcp.description}
                      </p>

                      {/* Settings/Actions */}
                      {mcp.settings && mcp.settings.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {mcp.settings.map((setting, idx) => (
                            <Button
                              key={idx}
                              variant="ghost"
                              size="sm"
                              onClick={setting.action}
                              disabled={isAuthenticating}
                              className="h-7 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                            >
                              {isAuthenticating ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  Authenticating...
                                </>
                              ) : (
                                <>
                                  <PlugZap className="w-3 h-3 mr-1" />
                                  {setting.label}
                                </>
                              )}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => handleToggleMCP(mcp.id)}
                    className={`ml-2 w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                      mcp.enabled ? 'bg-green-500' : 'bg-white/20'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 bg-white rounded-full transition-transform ${
                        mcp.enabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Available MCPs */}
        {availableServices.length > 0 && (
          <div className="p-4 border-t border-white/10">
            <h3 className="text-sm font-medium text-white/70 mb-3">Available MCPs</h3>
            
            <div className="space-y-2">
              {availableServices.map((mcp) => (
                <div
                  key={mcp.id}
                  className="bg-white/5 rounded-lg p-3 border border-white/10 hover:border-white/20 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3 flex-1">
                      <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
                        {mcp.icon || '📦'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-white mb-1">{mcp.name}</h4>
                        <p className="text-xs text-white/50 line-clamp-2">
                          {mcp.description}
                        </p>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleMCP(mcp.id)}
                      className="ml-2 h-7 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                    >
                      <Plug className="w-3 h-3 mr-1" />
                      Install
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MCPPanel;
