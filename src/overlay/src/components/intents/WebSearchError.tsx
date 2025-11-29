/**
 * Web Search Error Component
 * 
 * Displays when search fails or no results found
 * Provides retry and cancel options
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

interface WebSearchErrorProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function WebSearchError({ payload, onEvent }: WebSearchErrorProps) {
  const { slots, conversationId, correlationId } = payload;
  const [isDismissed, setIsDismissed] = useState(false);

  const subject = slots.subject || 'Search';
  const errorMessage = slots.errorMessage || `Couldn't find information about ${subject}`;

  const handleRetry = () => {
    onEvent({
      type: 'intent.continuation',
      intent: 'web_search',
      slots: {
        ...slots,
        error: null,
        errorMessage: null,
      },
      conversationId,
      correlationId,
      bypassParseIntent: true,
      uiActionId: 'clicked_retry',
      sourceComponent: 'webSearch.error',
    });
  };

  const handleCancel = () => {
    setIsDismissed(true);
    onEvent({
      type: 'ui.action',
      intent: 'web_search',
      slots,
      conversationId,
      correlationId,
      bypassParseIntent: true,
      uiActionId: 'clicked_cancel',
      sourceComponent: 'webSearch.error',
    });
  };

  if (isDismissed) return null;

  return (
    <div className="fixed bottom-32 left-1/2 transform -translate-x-1/2 slide-up">
      <div className="glass-dark rounded-2xl shadow-2xl p-6 min-w-[400px] max-w-[500px]">
        {/* Error Icon & Message */}
        <div className="flex items-start gap-4 mb-6">
          <div className="p-2 rounded-lg bg-red-500/20">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1">
              {subject}
            </h3>
            <p className="text-white/70 text-sm">
              {errorMessage}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleRetry}
            className="
              flex-1 flex items-center justify-center gap-2
              px-4 py-3 rounded-lg
              bg-gradient-to-r from-teal-500 to-blue-500
              text-white font-medium
              hover:shadow-lg hover:scale-102
              transition-all duration-200
            "
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
          <button
            onClick={handleCancel}
            className="
              flex items-center justify-center gap-2
              px-4 py-3 rounded-lg
              bg-white/10 hover:bg-white/20
              text-white/70 hover:text-white
              transition-all duration-200
            "
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
