import React, { useState, useEffect, useRef } from 'react';
import {
  MessageCircle,
  Lightbulb,
  Database,
  Search,
  Bot,
  Network,
  MoreVertical,
  X,
  Droplet,
  ArrowLeft,
  Plug,
  Eye
} from 'lucide-react';
import { Button } from './ui/button';
import ChatMessages from './ChatMessages';
import InsightPanel from './InsightPanel';
import MemoryDebugger from './MemoryDebugger';
import SemanticSearchPanel from './SemanticSearchPanel';
import AgentStatusPanel from './AgentStatusPanel';
import OrchestrationDashboard from './OrchestrationDashboard';
import MCPPanel from './MCPPanel';
import VisionPanel from './VisionPanel';
import { CommandConfirmation } from './CommandConfirmation';
import { useConversationSignals } from '../hooks/useConversationSignals';
import { ViewType } from '@/types/view';
interface UnifiedInterfaceProps {
  isListening: boolean;
  toggleListening: () => void;
  isAnalyzing: boolean;
  isGatheringInsight: boolean;
  showResponse: boolean;
  setShowResponse: (show: boolean) => void;
  onViewChange: (view: ViewType) => void;
}

const UnifiedInterface: React.FC<UnifiedInterfaceProps> = ({
  onViewChange
}) => {
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [showMenu, setShowMenu] = useState(false);
  
  // Command confirmation state (lifted from ChatMessages)
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    command: string;
    category: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    resolvedMessage: string;
    originalMessage: string;
  } | null>(null);
  
  // Conversation context for sidebar integration
  const { signals, addMessage: signalsAddMessage, toggleSidebar } = useConversationSignals();
  const isSidebarOpen = signals.isSidebarOpen.value;
  
  // Ref for the menu modal to detect clicks outside
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Handle click outside menu to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    // Add event listener when menu is open
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    // Cleanup event listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  // Handle view changes
  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
    onViewChange(view);
    setShowMenu(false); // Close menu when switching views
  };

  // Handle back to chat (for new tabs)
  const handleBackToChat = () => {
    setCurrentView('chat');
  };

  // Handle close/minimize
  const handleClose = async () => {
    setShowMenu(false);
  };

  // Command confirmation handlers
  const handleApproveCommand = async () => {
    if (!pendingConfirmation) return;
    
    const activeSessionId = signals.activeSessionId.value;
    if (!activeSessionId) return;
    
    console.log('✅ [CONFIRMATION] User approved command:', pendingConfirmation.command);
    
    try {
      // Re-send the resolved message with bypass flag
      const result = await window.electronAPI?.privateModeProcess({
        message: pendingConfirmation.resolvedMessage,
        context: {
          sessionId: activeSessionId,
          userId: 'default_user',
          timestamp: new Date().toISOString(),
          conversationHistory: [],
          useOnlineMode: false,
          bypassConfirmation: true
        }
      });
      
      // Clear confirmation
      setPendingConfirmation(null);
      
      // Add AI response message
      if (result?.success && result.response && signalsAddMessage) {
        await signalsAddMessage(activeSessionId, {
          text: result.response,
          sender: 'ai',
          sessionId: activeSessionId,
          metadata: { 
            action: result.action,
            mcpPrivateMode: true,
            commandApproved: true
          }
        });
      } else if (result?.error && signalsAddMessage) {
        // Show error message
        await signalsAddMessage(activeSessionId, {
          text: `Command execution failed: ${result.error}`,
          sender: 'ai',
          sessionId: activeSessionId,
          metadata: { error: true }
        });
      }
    } catch (error: any) {
      console.error('❌ [CONFIRMATION] Error executing approved command:', error);
      setPendingConfirmation(null);
    }
  };

  const handleRejectCommand = async () => {
    if (!pendingConfirmation) return;
    
    const activeSessionId = signals.activeSessionId.value;
    if (!activeSessionId) return;
    
    console.log('❌ [CONFIRMATION] User rejected command:', pendingConfirmation.command);
    
    // Clear pending confirmation
    setPendingConfirmation(null);
    
    // Add cancellation message
    if (signalsAddMessage) {
      await signalsAddMessage(activeSessionId, {
        text: "Command cancelled by user.",
        sender: 'ai',
        sessionId: activeSessionId,
        metadata: { action: 'command_cancelled' }
      });
    }
  };

  // Dynamic header renderer based on current view with original functionality
  const renderBranding = () => {
    switch (currentView) {
      case 'chat':
        return (
          <button
            onClick={() => {
              console.log('🔍 [UnifiedInterface] Messages button clicked! Sidebar state:', isSidebarOpen);
              toggleSidebar();
            }}
            className="flex items-center space-x-3 hover:bg-white/5 rounded-lg px-2 py-1 transition-colors group"
            title={isSidebarOpen ? 'Close Conversations' : 'Open Conversations'}
          >
            <div className={`w-6 h-6 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform ${
              isSidebarOpen ? 'ring-2 ring-teal-400/50' : ''
            }`}>
              <MessageCircle className="w-3 h-3 text-white" />
            </div>
            <div className="text-white/90 font-medium text-sm group-hover:text-white">
              {'Messages'}
            </div>
          </button>
        );
      case 'insight':
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
              <Droplet className="w-3 h-3 text-white" />
            </div>
            <div className="text-white/90 font-medium text-sm">
              Live Insights
            </div>
          </>
        );
      case 'memory':
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-purple-400 to-blue-500 rounded-lg flex items-center justify-center">
              <Database className="w-3 h-3 text-white" />
            </div>
            <span className="text-white/90 font-medium text-sm">Memory</span>
          </>
        );
      case 'search':
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-teal-500 rounded-lg flex items-center justify-center">
              <Search className="w-3 h-3 text-white" />
            </div>
            <span className="text-white/90 font-medium text-sm">Semantic Search</span>
          </>
        );
      case 'agents':
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-lg flex items-center justify-center">
              <Bot className="w-3 h-3 text-white" />
            </div>
            <span className="text-white/90 font-medium text-sm">Agent Status</span>
          </>
        );
      case 'orchestration':
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-lg flex items-center justify-center">
              <Network className="w-3 h-3 text-white" />
            </div>
            <span className="text-white/90 font-medium text-sm">Orchestration Dashboard</span>
          </>
        );
      case 'mcp':
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-emerald-500 rounded-lg flex items-center justify-center">
              <Plug className="w-3 h-3 text-white" />
            </div>
            <span className="text-white/90 font-medium text-sm">MCPs</span>
          </>
        );
      case 'vision':
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-purple-400 to-pink-500 rounded-lg flex items-center justify-center">
              <Eye className="w-3 h-3 text-white" />
            </div>
            <span className="text-white/90 font-medium text-sm">Vision Panel</span>
          </>
        );
      default:
        return (
          <>
            <div className="w-6 h-6 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center">
              <Droplet className="w-3 h-3 text-white" />
            </div>
            <div className="text-white/90 font-medium text-sm">
              Messages
            </div>
          </>
        );
    }
  };

  // Render navigation header - always visible with ThinkDrop AI branding
  const renderHeader = () => (
    <div 
      className="flex items-center px-3 py-2 border-b border-white/10 bg-gray-800/50"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Render branding - Start */}
      <div className="flex flex-1 items-center space-x-3">
        {/* Back button for new tabs */}
        {(currentView === 'search' || currentView === 'agents' || currentView === 'orchestration') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToChat}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        {renderBranding()}
      </div>
      {/* Render branding - End */}
      
      <div className="flex items-center justify-end">
        {/* Right side - Navigation buttons */}
        <div className="flex items-center space-x-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Chat button - also toggles sidebar when in chat view */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              console.log('🔍 [UnifiedInterface] Chat button clicked! View:', currentView, 'Sidebar:', isSidebarOpen);
              if (currentView === 'chat') {
                toggleSidebar();
              } else {
                handleViewChange('chat');
              }
            }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              currentView === 'chat' 
                ? `bg-teal-500/20 text-teal-400 border border-teal-500/30 ${
                    isSidebarOpen ? 'ring-1 ring-teal-400/50' : ''
                  }` 
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
            title={currentView === 'chat' ? (isSidebarOpen ? 'Close Conversations' : 'Open Conversations') : 'Switch to Chat'}
          >
            <MessageCircle className="w-4 h-4" />
          </Button>
          
          {/* Insight button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewChange('insight')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              currentView === 'insight' 
                ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' 
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            <Lightbulb className="w-4 h-4" />
          </Button>
          
          {/* MCP button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewChange('mcp')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              currentView === 'mcp' 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
            title="MCPs"
          >
            <Plug className="w-4 h-4" />
          </Button>
          
          {/* Divider */}
          <div className="w-px h-5 bg-white/10 mx-1" />
          
          {/* Settings button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMenu(!showMenu)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            <MoreVertical className="w-4 h-4" />
          </Button>

          {/* Close button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  // Render content based on current view
  const renderContent = () => {
    switch (currentView) {
      case 'chat':
        return <ChatMessages onPendingConfirmation={setPendingConfirmation} />;
      case 'insight':
        return <InsightPanel />;
      case 'memory':
        return <MemoryDebugger />;
      case 'search':
        return <SemanticSearchPanel />;
      case 'agents':
        return <AgentStatusPanel />;
      case 'orchestration':
        return <OrchestrationDashboard />;
      case 'mcp':
        return <MCPPanel isOpen={true} />;
      case 'vision':
        return <VisionPanel />;
      default:
        return <ChatMessages onPendingConfirmation={setPendingConfirmation} />;
    }
  };

  return (
    <div className="w-full h-full bg-gray-900/85 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
      {/* Header - always visible */}
      {renderHeader()}
      
      {/* Content area with slide animation */}
      <div className="h-[calc(100%-60px)] overflow-hidden">
        <div 
          key={currentView}
          className="h-full animate-in slide-in-from-right-5 fade-in duration-300"
        >
          {renderContent()}
        </div>
      </div>

      {/* Command Confirmation Overlay */}
      {pendingConfirmation && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-xl z-50 flex items-center justify-center p-8">
          <CommandConfirmation
            command={pendingConfirmation.command}
            category={pendingConfirmation.category}
            riskLevel={pendingConfirmation.riskLevel}
            onApprove={handleApproveCommand}
            onReject={handleRejectCommand}
          />
        </div>
      )}

      {/* Menu overlay */}
      {showMenu && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div 
            ref={menuRef}
            className="bg-gray-800/90 backdrop-blur-lg rounded-xl border border-white/10 p-2 m-4 min-w-[100px]"
          >
            <div className="space-y-2">
              {/* <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('chat')}
              >
                <MessageCircle className="w-4 h-4 mr-3" />
                Chat
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('insight')}
              >
                <Lightbulb className="w-4 h-4 mr-3" />
                Insights
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('memory')}
              >
                <Database className="w-4 h-4 mr-3" />
                Memory
              </Button>
              <hr className="border-white/10 my-2" /> */}
              {/* <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('search')}
              >
                <Search className="w-4 h-4 mr-3" />
                Semantic Search
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('agents')}
              >
                <Bot className="w-4 h-4 mr-3" />
                Agents
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('orchestration')}
              >
                <Network className="w-4 h-4 mr-3" />
                Orchestration
              </Button> */}
              <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('memory')}
              >
                <Database className="w-4 h-4 mr-3" />
                Memory Debugger
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => handleViewChange('vision')}
              >
                <Eye className="w-4 h-4 mr-3" />
                Vision Panel
              </Button>
              <hr className="border-white/10 my-2" />
              <Button
                variant="ghost"
                className="w-full justify-start text-white/80 hover:text-white hover:bg-white/10"
                onClick={handleClose}
              >
                <X className="w-4 h-4 mr-3" />
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedInterface;
