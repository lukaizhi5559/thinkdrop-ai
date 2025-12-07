/**
 * Web Search Results Component
 * 
 * Displays search results in a person/info card
 * Can be anchored to screen entity or positioned freely
 */

import { OverlayPayload } from '../../../../types/overlay-intents';
import { ExternalLink, X, ChevronDown, ChevronUp, Globe } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface WebSearchResultsProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function WebSearchResults({ payload, onEvent }: WebSearchResultsProps) {
  const { slots, conversationId, correlationId } = payload;
  const [isVisible, setIsVisible] = useState(true);
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Get query and answer from slots
  const query = slots.query || slots.subject || 'Search Results';
  const answer = slots.answer || slots.finalAnswer || '';
  const results = slots.results || [];

  // Listen for visibility toggle from PromptBar
  useEffect(() => {
    const electronAPI = (window as any).electron;
    if (!electronAPI?.ipcRenderer) return;

    const handleVisibilityToggle = (_event: any, visible: boolean) => {
      setIsVisible(visible);
    };

    electronAPI.ipcRenderer.on('web-search:set-visibility', handleVisibilityToggle);
    return () => {
      if (electronAPI.ipcRenderer.removeListener) {
        electronAPI.ipcRenderer.removeListener('web-search:set-visibility', handleVisibilityToggle);
      }
    };
  }, []);

  // Handle mouse events to make window click-through except over card
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const element = cardRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const isOverElement = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );

      // Set window to ignore mouse events when not over element
      const electronAPI = (window as any).electron;
      if (electronAPI?.ipcRenderer) {
        electronAPI.ipcRenderer.send('intent-window:set-ignore-mouse', !isOverElement);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Extract unique domains for favicon display
  const getDomain = (url: string) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return '';
    }
  };

  const getFaviconUrl = (url: string) => {
    const domain = getDomain(url);
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  };

  // Position window to match PromptBar centering (60% width, centered)
  useEffect(() => {
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) return;

    const timer = setTimeout(() => {
      const screenWidth = window.screen.availWidth;
      const screenHeight = window.screen.availHeight;
      
      // Match PromptBar sizing: 60% width, centered
      const cardWidth = Math.floor(screenWidth * 0.6);
      const cardHeight = Math.floor(screenHeight * 0.8); // 80% height
      const x = Math.floor((screenWidth - cardWidth) / 2);
      const y = Math.floor((screenHeight - cardHeight) / 2);
      
      ipcRenderer.send('overlay:position-intent', {
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        animate: false
      });
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    // Send IPC to hide the window
    const electronAPI = (window as any).electron;
    if (electronAPI?.ipcRenderer) {
      electronAPI.ipcRenderer.send('web-search:toggle');
    }
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
    
    // Open link in default browser using electronAPI
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openExternal) {
      electronAPI.openExternal(url);
    }
  };

  // Hide window when not visible
  if (!isVisible) {
    return null;
  }

  // Show full card
  return (
    <div 
      ref={cardRef}
      className="w-full bg-gray-800 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 flex flex-col 
        animate-in fade-in slide-in-from-top-4"
    >
        {/* Header with Close Button */}
        <div className="px-6 py-4 flex items-start justify-between flex-shrink-0">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-teal-500/20 rounded-lg">
                <Globe className="w-5 h-5 text-teal-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">
                {query}
              </h3>
            </div>
            {answer && (
              <p className="text-sm text-white/80 leading-relaxed">
                {answer}
              </p>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔄 [WebSearchResults] Toggling sources:', !isSourcesExpanded);
                setIsSourcesExpanded(prev => !prev);
              }}
              className="
                w-full flex items-center gap-2 py-2 px-3 rounded-lg
                hover:bg-white/5 transition-all duration-200
                group cursor-pointer
              "
            >
              {/* Favicon Icons */}
              <div className="flex items-center -space-x-2">
                {results.slice(0, 5).map((result: any, index: number) => (
                  <div
                    key={index}
                    className="w-5 h-5 rounded-full bg-white/10 border border-white/20 overflow-hidden flex-shrink-0"
                    style={{ zIndex: 5 - index }}
                  >
                    <img
                      src={getFaviconUrl(result.url || result.href)}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Sources Text */}
              <span className="text-white/60 text-sm group-hover:text-white/80 transition-colors">
                Reviewed {results.length} source{results.length !== 1 ? 's' : ''}
              </span>

              {/* Chevron Icon */}
              {isSourcesExpanded ? (
                <ChevronUp className="w-4 h-4 text-white/40 ml-auto" />
              ) : (
                <ChevronDown className="w-4 h-4 text-white/40 ml-auto" />
              )}
            </button>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 ml-3"
            title="Hide Search Results"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Sources Section - Collapsed by default */}
        <div className="px-6 pb-4 flex-1 overflow-y-auto min-h-0">
          

          {/* Expanded Sources List */}
          {isSourcesExpanded && (
            <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {results.length === 0 ? (
                <p className="text-white/50 text-sm text-center py-4">
                  No sources found
                </p>
              ) : (
                results.map((result: any, index: number) => (
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
                    <div className="flex items-start gap-3">
                      {/* Favicon */}
                      <div className="w-5 h-5 rounded flex-shrink-0 bg-white/10 overflow-hidden mt-0.5">
                        <img
                          src={getFaviconUrl(result.url || result.href)}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white font-medium text-sm mb-1 group-hover:text-teal-400 transition-colors line-clamp-1">
                          {result.title || result.label}
                        </h4>
                        <p className="text-white/40 text-xs truncate">
                          {getDomain(result.url || result.href)}
                        </p>
                      </div>

                      {/* External Link Icon */}
                      <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-teal-400 flex-shrink-0 transition-colors mt-1" />
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 flex-shrink-0">
          <p className="text-white/40 text-xs text-center">
            Thinkdrop can make mistakes. Check important info.
          </p>
        </div>
    </div>
  );
}
