/**
 * Web Search Loading Component
 * 
 * Displays while search is in progress
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { Droplet } from 'lucide-react';

interface WebSearchLoadingProps {
  payload: OverlayPayload;
}

export default function WebSearchLoading({ payload }: WebSearchLoadingProps) {
  const { slots } = payload;
  
  // Loading message comes from backend via IntentResponses
  const loadingMessage = slots.loadingMessage || `Searching for ${slots.subject || '...'}`;

  return (
    <div className="w-full h-full flex items-center justify-center gap-3 animate-in fade-in duration-500">
      {/* ThinkDrop AI Avatar */}
      <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-blue-500 rounded-lg flex items-center justify-center flex-shrink-0 animate-pulse">
        <Droplet className="w-4 h-4 text-white" />
      </div>
      
      {/* Thinking Message Bubble */}
      <div className="bg-gray-800/80 backdrop-blur-sm border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-xs">
        <div className="flex items-center space-x-2">
          <span className="text-white/90 text-sm font-medium">{loadingMessage}</span>
          <div className="flex space-x-1">
            <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"></div>
            <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}
