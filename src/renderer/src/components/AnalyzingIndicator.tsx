import React from 'react';
import { Droplet } from 'lucide-react';

interface ThinkingIndicatorProps {
  isVisible: boolean;
  message?: string;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ 
  isVisible, 
  message = "Thinking" 
}) => {
  if (!isVisible) return null;

  return (
    <div className="flex items-start space-x-3 mb-4 animate-fade-in">
      {/* ThinkDrop AI Avatar */}
      <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center flex-shrink-0 animate-pulse">
        <Droplet className="w-4 h-4 text-white" />
      </div>
      
      {/* Thinking Message Bubble */}
      <div className="bg-gray-800/60 backdrop-blur-sm border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-xs">
        <div className="flex items-center space-x-2">
          <span className="text-white/90 text-sm font-medium">{message}...</span>
          <div className="flex space-x-1">
            <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"></div>
            <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Legacy export for backward compatibility
export const AnalyzingIndicator = ThinkingIndicator;

export default AnalyzingIndicator;
