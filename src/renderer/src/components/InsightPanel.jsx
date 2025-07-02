import React from 'react';

const InsightPanel = ({ insights, onActionClick }) => {
  return (
    <div className="agent-window">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">AI Insights</h2>
        <div className="text-xs text-gray-400">
          {insights.length} insights
        </div>
      </div>

      <div className="space-y-4 max-h-[400px] overflow-y-auto">
        {insights.length > 0 ? (
          insights.map((insight, index) => (
            <div key={index} className="insight-card">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="text-sm">
                    {insight.type === 'summary' && '📝'}
                    {insight.type === 'action' && '⚡'}
                    {insight.type === 'context' && '🧠'}
                  </span>
                  <span className="text-sm font-medium text-white capitalize">
                    {insight.type}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>

              <p className="text-sm text-gray-200 mb-3 leading-relaxed">
                {insight.content}
              </p>

              {insight.actions && insight.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {insight.actions.map((action, actionIndex) => (
                    <button
                      key={actionIndex}
                      onClick={() => onActionClick(action)}
                      className="text-xs bg-thinkdrop-teal/20 text-thinkdrop-teal hover:bg-thinkdrop-teal/30 px-2 py-1 rounded transition-colors"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-thinkdrop-teal/10 rounded-full flex items-center justify-center">
              <span className="text-2xl text-thinkdrop-teal">🧠</span>
            </div>
            <p className="text-gray-500 text-sm">
              AI insights will appear here as you interact with the system
            </p>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={() => onActionClick('summarize-all')}
            className="text-xs glass-effect px-3 py-2 rounded hover:bg-white/10 transition-colors"
          >
            📝 Summarize All
          </button>
          <button 
            onClick={() => onActionClick('export-notes')}
            className="text-xs glass-effect px-3 py-2 rounded hover:bg-white/10 transition-colors"
          >
            📄 Export Notes
          </button>
          <button 
            onClick={() => onActionClick('find-actions')}
            className="text-xs glass-effect px-3 py-2 rounded hover:bg-white/10 transition-colors"
          >
            ⚡ Find Actions
          </button>
          <button 
            onClick={() => onActionClick('clear-history')}
            className="text-xs glass-effect px-3 py-2 rounded hover:bg-white/10 transition-colors"
          >
            🗑️ Clear History
          </button>
        </div>
      </div>
    </div>
  );
};

export default InsightPanel;
