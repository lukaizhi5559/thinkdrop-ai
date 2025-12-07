/**
 * Web Search Choice Component
 * 
 * Displays when multiple search channels are available
 * User selects which channel to search (LinkedIn, Twitter, etc.)
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { ExternalLink } from 'lucide-react';

interface WebSearchChoiceProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function WebSearchChoice({ payload, onEvent }: WebSearchChoiceProps) {
  const { slots, conversationId, correlationId } = payload;
  const subject = slots.subject || 'Unknown';
  const candidateChannels = slots.candidateChannels || [];

  const handleChannelSelect = (channelId: string) => {
    // Send overlay event back to main process
    onEvent({
      type: 'intent.continuation',
      intent: 'web_search',
      slots: {
        ...slots,
        channel: channelId,
      },
      conversationId,
      correlationId,
      bypassParseIntent: true,
      uiActionId: `clicked_${channelId}`,
      sourceComponent: 'webSearch.choice',
    });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="glass-dark rounded-2xl shadow-2xl p-6 min-w-[400px] max-w-[600px]">
        {/* Title */}
        <div className="mb-4">
          <h3 className="text-xl font-semibold text-white mb-1">
            {subject}
          </h3>
          <p className="text-white/70 text-sm">
            What would you like to explore?
          </p>
        </div>

        {/* Channel Buttons */}
        <div className="flex flex-col gap-2">
          {candidateChannels.map((channel: any) => (
            <button
              key={channel.id}
              onClick={() => handleChannelSelect(channel.id)}
              className="
                flex items-center justify-between
                px-4 py-3 rounded-lg
                bg-white/10 hover:bg-white/20
                text-white text-left
                transition-all duration-200
                hover:scale-102 hover:shadow-lg
                group
              "
            >
              <span className="font-medium">{channel.label}</span>
              <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>

        {/* Dismiss hint */}
        <p className="text-white/40 text-xs text-center mt-4">
          Press ESC to dismiss
        </p>
      </div>
    </div>
  );
}
