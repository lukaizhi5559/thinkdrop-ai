import React from 'react';
import { Activity, Settings, Zap, Eye, Headphones, Clipboard } from 'lucide-react';

const ControlPanel = ({ isActive, onToggle, systemStatus }) => {
  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
      <div 
        className="bg-black/15 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl px-6 py-4 min-w-[480px]"
        style={{
          backdropFilter: 'blur(25px) saturate(180%)',
          background: 'rgba(0, 0, 0, 0.12)'
        }}
      >
        <div className="flex items-center justify-between">
          {/* Left - System Status Indicators */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  systemStatus.audio ? 'bg-green-400 shadow-lg shadow-green-400/50' : 'bg-gray-500'
                }`}></div>
                <Headphones className="w-4 h-4 text-white/70" />
                <span className="text-white/70 text-sm">Audio</span>
              </div>
              
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  systemStatus.screen ? 'bg-green-400 shadow-lg shadow-green-400/50' : 'bg-gray-500'
                }`}></div>
                <Eye className="w-4 h-4 text-white/70" />
                <span className="text-white/70 text-sm">Screen</span>
              </div>
              
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  systemStatus.clipboard ? 'bg-green-400 shadow-lg shadow-green-400/50' : 'bg-gray-500'
                }`}></div>
                <Clipboard className="w-4 h-4 text-white/70" />
                <span className="text-white/70 text-sm">Clipboard</span>
              </div>
            </div>
          </div>
          
          {/* Center - Main Control */}
          <div className="flex items-center space-x-4">
            <button
              onClick={onToggle}
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 flex items-center space-x-2 ${
                isActive
                  ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg shadow-red-500/30'
                  : 'bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white shadow-lg shadow-teal-500/30'
              }`}
            >
              {isActive ? (
                <>
                  <Activity className="w-4 h-4" />
                  <span>Stop System</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Start System</span>
                </>
              )}
            </button>
          </div>
          
          {/* Right - Agent Count & Settings */}
          <div className="flex items-center space-x-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
              <div className="text-sm text-white/90">
                <span className="text-white/60">Agents:</span>{' '}
                <span className="text-teal-300 font-medium">{systemStatus.agents}</span>
              </div>
            </div>
            
            <div className="flex space-x-1">
              <button className="bg-white/10 hover:bg-white/20 backdrop-blur-sm px-3 py-2 rounded-lg text-xs text-white/70 hover:text-white transition-all duration-200 border border-white/10">
                Settings
              </button>
              <button className="bg-white/10 hover:bg-white/20 backdrop-blur-sm px-3 py-2 rounded-lg text-xs text-white/70 hover:text-white transition-all duration-200 border border-white/10 flex items-center space-x-1">
                <Activity className="w-3 h-3" />
                <span>Health</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ControlPanel;
