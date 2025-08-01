import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageCircle, 
  Lightbulb, 
  Database, 
  MoreVertical,
  X,
  Droplet
} from 'lucide-react';
import { Button } from './ui/button';
import ChatMessages from './ChatMessages';
import InsightWindow from './InsightWindow';
import MemoryDebugger from './MemoryDebugger';

type ViewType = 'chat' | 'insight' | 'memory';

interface UnifiedInterfaceProps {
  isListening: boolean;
  toggleListening: () => void;
  isAnalyzing: boolean;
  isGatheringInsight: boolean;
  showResponse: boolean;
  setShowResponse: (show: boolean) => void;
}

const UnifiedInterface: React.FC<UnifiedInterfaceProps> = () => {
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [showMenu, setShowMenu] = useState(false);
  
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
  const handleViewChange = (view: 'chat' | 'insight' | 'memory') => {
    setCurrentView(view);
    setShowMenu(false); // Close menu when switching views
  };

  // Handle close/minimize
  const handleClose = async () => {
    setShowMenu(false);
  };

  // Dynamic header renderer based on current view with original functionality
  const renderBranding = () => {
    switch (currentView) {
      case 'chat':
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
        {renderBranding()}
      </div>
      {/* Render branding - End */}
      
      <div className="flex items-center justify-end">
        {/* Right side - Navigation buttons */}
        <div className="flex items-center space-x-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Chat button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewChange('chat')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              currentView === 'chat' 
                ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' 
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
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
          
          {/* Memory button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewChange('memory')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              currentView === 'memory' 
                ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' 
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            <Database className="w-4 h-4" />
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
        return <ChatMessages />;
      case 'insight':
        return <InsightWindow />;
      case 'memory':
        return <MemoryDebugger />;
      default:
        return <ChatMessages />;
    }
  };

  return (
    <div className="w-full h-full bg-gray-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
      {/* Header - always visible */}
      {renderHeader()}
      
      {/* Content area */}
      <div className="h-[calc(100%-60px)] overflow-hidden">
        {renderContent()}
      </div>

      {/* Menu overlay */}
      {showMenu && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div 
            ref={menuRef}
            className="bg-gray-800/90 backdrop-blur-lg rounded-xl border border-white/10 p-2 m-4 min-w-[100px]"
          >
            <div className="space-y-2">
              <Button
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
