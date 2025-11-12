import React, { useState, useEffect } from 'react';
import { RefreshCw, ExternalLink, Tag, Lightbulb, Loader2, AlertCircle, MessageSquare, History, Trash2, Youtube } from 'lucide-react';
import { RichContentRenderer } from './rich-content';
import ConfirmDialog from './ConfirmDialog';

interface InsightLink {
  title: string;
  url: string;
  snippet: string;
}

interface VideoLink {
  title: string;
  url: string;
  thumbnail?: string;
  platform: string;
  duration?: string;
  viewCount?: number;
  channel?: string;
  publishedAt?: string;
}

interface PageInsight {
  id?: string;
  type: 'page' | 'highlight';
  query: string;
  summary: string;
  links: InsightLink[];
  videoLinks?: VideoLink[];
  concepts: string[];
  timestamp: number;
  window_title?: string;
  created_at?: string;
}

interface InsightPanelProps {
  onRefresh?: () => void;
}

type TabType = 'current' | 'history';
type LinkTabType = 'web' | 'video';

export default function InsightPanel({ onRefresh }: InsightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [activeLinkTab, setActiveLinkTab] = useState<LinkTabType>('web');
  const [insight, setInsight] = useState<PageInsight | null>(null);
  const [history, setHistory] = useState<PageInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deleteInsightId, setDeleteInsightId] = useState<string | null>(null);

  useEffect(() => {
    // Listen for insight updates from main process
    if (window.electronAPI?.onInsightUpdate) {
      window.electronAPI.onInsightUpdate((_: any, data: PageInsight) => {
        console.log('📥 [INSIGHT_PANEL] Received insight update:', data);
        setInsight(data);
        setLoading(false);
        setError(null);
        loadHistory(); // Reload history when new insight is generated
      });
    }

    // Listen for insight loading state
    if (window.electronAPI?.onInsightLoading) {
      window.electronAPI.onInsightLoading((_: any, isLoading: boolean) => {
        console.log('⏳ [INSIGHT_PANEL] Loading state:', isLoading);
        setLoading(isLoading);
        if (isLoading) {
          setError(null);
        }
      });
    }

    // Listen for insight errors
    if (window.electronAPI?.onInsightError) {
      window.electronAPI.onInsightError((_: any, errorMsg: string) => {
        console.error('❌ [INSIGHT_PANEL] Error:', errorMsg);
        setError(errorMsg);
        setLoading(false);
      });
    }

    // Load history on mount
    loadHistory();

    return () => {
      // Cleanup listeners
    };
  }, []);

  const loadHistory = async () => {
    try {
      const result = await (window.electronAPI as any)?.invoke('insight-history:list', { limit: 50 });
      if (result?.success) {
        setHistory(result.insights);
      }
    } catch (error) {
      console.error('Failed to load insight history:', error);
    }
  };

  const handleDeleteInsight = async () => {
    if (!deleteInsightId) return;
    try {
      const result = await (window.electronAPI as any)?.invoke('insight-history:delete', deleteInsightId);
      if (result?.success) {
        loadHistory();
        setDeleteInsightId(null);
      }
    } catch (error) {
      console.error('Failed to delete insight:', error);
    }
  };

  const handleClearHistory = async () => {
    try {
      const result = await (window.electronAPI as any)?.invoke('insight-history:clear');
      if (result?.success) {
        setHistory([]);
        setShowClearConfirm(false);
      }
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  };

  const handleViewHistoryInsight = async (insightId: string) => {
    try {
      const result = await (window.electronAPI as any)?.invoke('insight-history:get', insightId);
      if (result?.success) {
        setInsight(result.insight);
        setActiveTab('current');
      }
    } catch (error) {
      console.error('Failed to load insight:', error);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    if (window.electronAPI?.refreshInsight) {
      window.electronAPI.refreshInsight();
    }
    onRefresh?.();
  };

  const handleLinkClick = (url: string) => {
    window.electronAPI?.openExternal(url);
  };

  const handleFollowUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (followUpQuestion.trim()) {
      // Regenerate the Page Insight with the follow-up question included
      // This makes the insight more focused and relevant
      window.electronAPI?.refreshInsightWithQuery?.(followUpQuestion);
      setFollowUpQuestion('');
    }
  };


  const formatTimestamp = (timestamp: number | string) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const formatViewCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M views`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K views`;
    } else {
      return `${count} views`;
    }
  };

  const formatPublishDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] text-white">
      {/* Header with Tabs */}
      <div className="flex-shrink-0 border-b border-white/10">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center space-x-2">
            <Lightbulb className="w-5 h-5 text-yellow-400" />
            <h2 className="text-lg font-semibold">Live Insights</h2>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh insights"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-white/10">
          <button
            onClick={() => setActiveTab('current')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'current'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-white/60 hover:text-white/80'
            }`}
          >
            <div className="flex items-center justify-center space-x-2">
              <Lightbulb className="w-4 h-4" />
              <span>Page Insight</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-white/60 hover:text-white/80'
            }`}
          >
            <div className="flex items-center justify-center space-x-2">
              <History className="w-4 h-4" />
              <span>History ({history.length})</span>
            </div>
          </button>
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'current' && (
          <>
            {loading && (
              <div className="flex flex-col items-center justify-center h-full space-y-3">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                <p className="text-sm text-white/60">Generating insights...</p>
              </div>
            )}

            {error && !loading && (
              <div className="flex flex-col items-center justify-center h-full space-y-3 p-6">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-white/60 text-center">{error}</p>
                <button
                  onClick={handleRefresh}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-sm transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}

            {!loading && !error && !insight && (
              <div className="flex flex-col items-center justify-center h-full space-y-3 p-6">
                <Lightbulb className="w-12 h-12 text-white/20" />
                <p className="text-sm text-white/40 text-center">
                  Insights will appear here when you view a page
                </p>
              </div>
            )}

            {!loading && !error && insight && (
          <div className="p-4 space-y-6">
            {/* Timestamp */}
            <div className="text-xs text-white/40">
              Updated {formatTimestamp(insight.timestamp)}
            </div>

            {/* Summary */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-white/90 flex items-center space-x-2">
                <span>📝</span>
                <span>Summary</span>
              </h3>
              <div className="text-sm text-white/70 leading-relaxed prose prose-invert prose-sm max-w-none">
                <RichContentRenderer content={insight.summary} animated={true} />
              </div>
            </div>

            {/* Related Links with Sub-tabs */}
            {(insight.links.length > 0 || (insight.videoLinks && insight.videoLinks.length > 0)) && (
              <div className="space-y-3">
                {/* Sub-tabs for Web Links and Video Links */}
                <div className="flex border-b border-white/10">
                  <button
                    onClick={() => setActiveLinkTab('web')}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      activeLinkTab === 'web'
                        ? 'text-blue-400 border-b-2 border-blue-400'
                        : 'text-white/60 hover:text-white/80'
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-1">
                      <ExternalLink className="w-3 h-3" />
                      <span>Related Links ({insight.links.length})</span>
                    </div>
                  </button>
                  <button
                    onClick={() => setActiveLinkTab('video')}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      activeLinkTab === 'video'
                        ? 'text-red-400 border-b-2 border-red-400'
                        : 'text-white/60 hover:text-white/80'
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-1">
                      <Youtube className="w-3 h-3" />
                      <span>Video Links ({insight.videoLinks?.length || 0})</span>
                    </div>
                  </button>
                </div>

                {/* Web Links Tab Content */}
                {activeLinkTab === 'web' && (
                  <div className="space-y-2">
                    {insight.links.length > 0 ? (
                      insight.links.map((link, index) => (
                        <button
                          key={`web-${index}`}
                          onClick={() => handleLinkClick(link.url)}
                          className="w-full text-left p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group"
                        >
                          <div className="flex items-start space-x-2">
                            <ExternalLink className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-white/90 group-hover:text-blue-400 transition-colors line-clamp-2">
                                {link.title}
                              </div>
                              {link.snippet && (
                                <div className="text-xs text-white/50 line-clamp-2 prose prose-invert prose-xs max-w-none">
                                  <RichContentRenderer content={link.snippet} animated={false} />
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="text-center text-white/40 text-sm py-4">
                        No web links available
                      </div>
                    )}
                  </div>
                )}

                {/* Video Links Tab Content */}
                {activeLinkTab === 'video' && (
                  <div className="space-y-2">
                    {insight.videoLinks && insight.videoLinks.length > 0 ? (
                      insight.videoLinks.map((video, index) => (
                          <button
                            key={`video-${index}`}
                            onClick={() => handleLinkClick(video.url)}
                            className="w-full text-left p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group"
                          >
                            <div className="flex items-start space-x-3">
                              {video.thumbnail ? (
                                <img 
                                  src={video.thumbnail} 
                                  alt={video.title}
                                  className="w-16 h-12 object-cover rounded flex-shrink-0"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    target.nextElementSibling?.classList.remove('hidden');
                                  }}
                                />
                              ) : null}
                              <Youtube className={`w-4 h-4 text-red-500 mt-0.5 flex-shrink-0 ${video.thumbnail ? 'hidden' : ''}`} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-white/90 group-hover:text-red-400 transition-colors line-clamp-2 mb-1">
                                  {video.title}
                                </div>
                                
                                <div className="flex items-center space-x-2 text-xs text-white/50 mb-1">
                                  {video.channel && <span>{video.channel}</span>}
                                  {video.duration && (
                                    <>
                                      {video.channel && <span>•</span>}
                                      <span>{video.duration}</span>
                                    </>
                                  )}
                                </div>
                                
                                <div className="flex items-center space-x-2 text-xs text-white/40">
                                  {video.viewCount && <span>{formatViewCount(video.viewCount)}</span>}
                                  {video.publishedAt && (
                                    <>
                                      {video.viewCount && <span>•</span>}
                                      <span>{formatPublishDate(video.publishedAt)}</span>
                                    </>
                                  )}
                                  <div className="text-xs text-white/30 ml-auto">YouTube</div>
                                </div>
                              </div>
                            </div>
                          </button>
                        ))
                    ) : (
                      <div className="text-center text-white/40 text-sm py-4">
                        No video links available
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Key Concepts */}
            {insight.concepts.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white/90 flex items-center space-x-2">
                  <span>🏷️</span>
                  <span>Key Concepts</span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {insight.concepts.map((concept, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center space-x-1 px-3 py-1 bg-white/10 hover:bg-white/15 rounded-full text-xs text-white/80 transition-colors cursor-default"
                    >
                      <Tag className="w-3 h-3" />
                      <span>{concept}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>
            )}
          </>
        )}

        {activeTab === 'history' && (
          <div className="p-4 space-y-3">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 space-y-3">
                <History className="w-12 h-12 text-white/20" />
                <p className="text-sm text-white/40 text-center">
                  No insight history yet
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white/70">
                    {history.length} {history.length === 1 ? 'Insight' : 'Insights'}
                  </h3>
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Clear All
                  </button>
                </div>

                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group"
                  >
                    <div className="flex items-start justify-between space-x-2">
                      <button
                        onClick={() => handleViewHistoryInsight(item.id!)}
                        className="flex-1 text-left"
                      >
                        <div className="text-sm font-medium text-white/90 line-clamp-2 mb-1">
                          {item.window_title || item.query}
                        </div>
                        <div className="text-xs text-white/50 line-clamp-1 mb-2">
                          {item.summary}
                        </div>
                        <div className="text-xs text-white/40">
                          {formatTimestamp(item.created_at || item.timestamp)}
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteInsightId(item.id!);
                        }}
                        className="p-2 hover:bg-red-500/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete insight"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Follow-up Question - Fixed at bottom */}
      {activeTab === 'current' && !loading && !error && insight && (
        <div className="flex-shrink-0 p-4 border-t border-white/10 bg-[#1e1e1e]">
          <h3 className="text-sm font-semibold text-white/90 flex items-center space-x-2 mb-3">
            <MessageSquare className="w-4 h-4" />
            <span>Something to add?</span>
          </h3>
          <form onSubmit={handleFollowUpSubmit} className="flex space-x-2">
                <input
                  type="text"
                  value={followUpQuestion}
                  onChange={(e) => setFollowUpQuestion(e.target.value)}
                  placeholder="Type your question..."
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-blue-400 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!followUpQuestion.trim()}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-white/10 disabled:text-white/40 rounded-lg text-sm font-medium transition-colors"
                >
                  Ask
            </button>
          </form>
        </div>
      )}

      {/* Clear All Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear Insight History?"
        message="Are you sure you want to clear all insight history?"
        onConfirm={handleClearHistory}
        onCancel={() => setShowClearConfirm(false)}
        confirmText="OK"
        cancelText="Cancel"
        icon={<Lightbulb className="w-8 h-8 text-yellow-400" />}
      />

      {/* Delete Single Insight Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteInsightId !== null}
        title="Delete Insight?"
        message="Are you sure you want to delete this insight?"
        onConfirm={handleDeleteInsight}
        onCancel={() => setDeleteInsightId(null)}
        confirmText="Delete"
        cancelText="Cancel"
        icon={<Trash2 className="w-8 h-8 text-red-400" />}
      />
    </div>
  );
}
