/**
 * Web Search Loading Component
 * 
 * Displays while search is in progress
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { Loader2 } from 'lucide-react';

interface WebSearchLoadingProps {
  payload: OverlayPayload;
}

export default function WebSearchLoading({ payload }: WebSearchLoadingProps) {
  const { slots } = payload;
  const loadingMessage = slots.loadingMessage || `Searching for ${slots.subject || '...'}`;

  return (
    <div className="fixed bottom-32 left-1/2 transform -translate-x-1/2 fade-in">
      <div className="glass-dark rounded-2xl shadow-2xl px-6 py-4 flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />
        <span className="text-white text-sm">{loadingMessage}</span>
      </div>
    </div>
  );
}
