import React from 'react';
import { Button } from './ui/button';
import { 
  Mic, 
  MicOff, 
  Droplet,
  Lightbulb,
  EyeOff,
  Database,
  Plug
} from 'lucide-react';

interface PrimaryControlBarProps {
  // Chat state
  isChatOpen: boolean;
  handleToggleChat: () => void;
  
  // Listening state
  isListening: boolean;
  toggleListening: () => void;
  
  // Insight state
  isGatheringInsight: boolean;
  isInsightOpen: boolean;
  handleToggleInsight: () => void;
  
  // Memory debugger state
  isMemoryDebuggerOpen: boolean;
  handleToggleMemoryDebugger: () => void;
  
  // MCP panel state
  isMCPPanelOpen: boolean;
  handleToggleMCPPanel: () => void;
  
  // Hide all
  handleHideAll: () => void;
}

const PrimaryControlBar: React.FC<PrimaryControlBarProps> = ({
  isChatOpen,
  handleToggleChat,
  isListening,
  toggleListening,
  isGatheringInsight,
  isInsightOpen,
  handleToggleInsight,
  isMemoryDebuggerOpen,
  handleToggleMemoryDebugger,
  isMCPPanelOpen,
  handleToggleMCPPanel,
  handleHideAll
}) => {
  return (
    <div 
      className="rounded-2xl bg-gray-900/95 backdrop-blur-sm px-6 py-2 min-w-[200px]"
      style={{
        WebkitAppRegion: 'drag',
        boxShadow: 'none',
        // backdropFilter: 'blur(25px) saturate(180%)',
        // background: 'rgba(0, 0, 0, 0.35)'
      } as React.CSSProperties}
    >
     
      <div className="flex items-center justify-center space-x-3">
        {/* Left - ThinkDrop Branding */}
        {/* Chat Button */}
        <Button
            variant="ghost"
            size="sm"
            className={`text-white/70 hover:text-white hover:bg-white/10  w-10 h-10 p-0 rounded-xl transition-all duration-200 ${
              isChatOpen ? 'bg-blue-500/20 text-blue-400' : ''
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={handleToggleChat}
          >
            <Droplet className="w-5 h-5" />
          </Button>
        
        {/* Right - Mic and Action Buttons */}
        <div className="flex items-center space-x-3">
          {/* Main Listen Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleListening}
            className={`text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200 ${
              isListening ? 'bg-red-500/20 text-red-400' : ''
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={isListening ? 'Stop Listening' : 'Start Listening'}
          >
            {isListening ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </Button>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
          {/* Insight Button */}
          <Button
            variant="ghost"
            size="sm"
            className={`text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200 ${
              isGatheringInsight ? 'animate-pulse bg-yellow-500/20 text-yellow-400' : ''
            } ${
              isInsightOpen ? 'bg-yellow-500/20 text-yellow-400' : ''
            }`}
            onClick={handleToggleInsight}
            disabled={isGatheringInsight}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={isInsightOpen ? 'Close Insight' : 'Open Insight'}
          >
            <Lightbulb className="w-5 h-5" />
          </Button>
          
          {/* Memory Debugger Button */}
          <Button
            variant="ghost"
            size="sm"
            className={`text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200 ${
              isMemoryDebuggerOpen ? 'bg-purple-500/20 text-purple-400' : ''
            }`}
            onClick={handleToggleMemoryDebugger}
            title={isMemoryDebuggerOpen ? 'Close Memory Debugger' : 'Open Memory Debugger'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Database className="w-5 h-5" />
          </Button>
          
          {/* MCP Panel Button */}
          <Button
            variant="ghost"
            size="sm"
            className={`text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200 ${
              isMCPPanelOpen ? 'bg-green-500/20 text-green-400' : ''
            }`}
            onClick={handleToggleMCPPanel}
            title={isMCPPanelOpen ? 'Close MCP Panel' : 'Open MCP Panel'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Plug className="w-5 h-5" />
          </Button>
          
          {/* Hide All Button */}
          <Button
            variant="ghost"
            size="sm"
            className="text-white/70 hover:text-white hover:bg-white/10 w-10 h-10 p-0 rounded-xl transition-all duration-200"
            onClick={handleHideAll}
            title="Hide ThinkDrop AI"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <EyeOff className="w-5 h-5" />
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrimaryControlBar;
