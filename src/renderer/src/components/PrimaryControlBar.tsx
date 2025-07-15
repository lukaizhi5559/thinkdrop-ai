import React from 'react';
import { Button } from './ui/button';
import { 
  Mic, 
  MicOff, 
  Droplet,
  Lightbulb,
  EyeOff,
  Database
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
  handleHideAll
}) => {
  return (
    <div 
      className="rounded-2xl bg-gray-900/95 backdrop-blur-sm px-6 py-2 min-w-[400px]"
      style={{
        WebkitAppRegion: 'drag',
        // backdropFilter: 'blur(25px) saturate(180%)',
        // background: 'rgba(0, 0, 0, 0.35)'
      } as React.CSSProperties}
    >
      <div className="flex items-center justify-between">
        {/* Left - ThinkDrop Branding */}
        {/* Chat Button */}
        <Button
            variant="ghost"
            size="lg"
            className={`text-white/80 hover:text-white hover:bg-white/10 rounded-xl p-2 transition-all duration-200 ${
              isChatOpen ? 'bg-white/10 text-white' : ''
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={handleToggleChat}
          >
            <div className="flex items-center space-x-3">
              <div className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center ${
                isChatOpen ? 'from-teal-300 to-blue-400' : 'from-teal-400 to-blue-500'
              }`}>
                <Droplet className="w-4 h-4 text-white" />
              </div>
              <span className="text-white/90 text-base font-medium">
                {isChatOpen ? 'Ask?' : 'Ask?'}
              </span>
            </div>
          </Button>
        
        {/* Center - Main Listen Button */}
        <Button
          onClick={toggleListening}
          className={`w-24 h-10 rounded-xl transition-all duration-300 shadow-lg font-medium ${
            isListening
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isListening ? (
            <div className="flex items-center space-x-2">
              <MicOff className="w-4 h-4" />
              <span className="text-sm">Stop</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Mic className="w-4 h-4" />
              <span className="text-sm">Listen</span>
            </div>
          )}
        </Button>

        {/* Right - Action Buttons */}
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
  );
};

export default PrimaryControlBar;
