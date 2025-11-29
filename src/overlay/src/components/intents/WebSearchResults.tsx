/**
 * Web Search Results Component
 * 
 * Displays search results in a person/info card
 * Can be anchored to screen entity or positioned freely
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { ExternalLink, X } from 'lucide-react';
import { useState } from 'react';

interface WebSearchResultsProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function WebSearchResults({ payload, onEvent }: WebSearchResultsProps) {
  const { slots, conversationId, correlationId } = payload;
  const [isDismissed, setIsDismissed] = useState(false);

  const subject = slots.subject || 'Results';
  const channelLabel = slots.channelLabel || 'Search Results';
  const results = slots.results || [];
  const anchorEntityId = slots.anchorEntityId;

  const handleDismiss = () => {
    setIsDismissed(true);
    onEvent({
      type: 'ui.action',
      intent: 'web_search',
      slots,
      conversationId,
      correlationId,
      bypassParseIntent: true,
      uiActionId: 'dismissed_results',
      sourceComponent: 'webSearch.results',
    });
  };

  const handleLinkClick = (url: string, index: number) => {
    onEvent({
      type: 'ui.action',
      intent: 'web_search',
      slots: { ...slots, clickedUrl: url, clickedIndex: index },
      conversationId,
      correlationId,
      bypassParseIntent: true,
      uiActionId: `clicked_result_${index}`,
      sourceComponent: 'webSearch.results',
    });
    
    // Open link in default browser
    if ((window as any).electron?.shell) {
      (window as any).electron.shell.openExternal(url);
    }
  };

  if (isDismissed) return null;

  // TODO: Implement OCR entity anchoring
  // For now, position at bottom-right
  const positionClass = anchorEntityId 
    ? 'fixed' // Will be positioned based on entity coordinates
    : 'fixed bottom-32 right-8';

  return (
    <div className={`${positionClass} slide-up`}>
      <div className="glass-dark rounded-2xl shadow-2xl w-[400px] max-h-[600px] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1">
              {subject}
            </h3>
            <p className="text-white/60 text-sm">
              {channelLabel}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            title="Dismiss"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Results List */}
        <div className="px-6 py-4 max-h-[500px] overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-white/50 text-sm text-center py-8">
              No results found
            </p>
          ) : (
            <div className="space-y-3">
              {results.map((result: any, index: number) => (
                <button
                  key={index}
                  onClick={() => handleLinkClick(result.url || result.href, index)}
                  className="
                    w-full text-left p-3 rounded-lg
                    bg-white/5 hover:bg-white/10
                    transition-all duration-200
                    group
                  "
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-white font-medium text-sm mb-1 truncate group-hover:text-teal-400 transition-colors">
                        {result.title || result.label}
                      </h4>
                      {result.summary && (
                        <p className="text-white/60 text-xs line-clamp-2">
                          {result.summary}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-teal-400 flex-shrink-0 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10">
          <p className="text-white/40 text-xs text-center">
            Tap a link to open • Press ESC to dismiss
          </p>
        </div>
      </div>
    </div>
  );
}
