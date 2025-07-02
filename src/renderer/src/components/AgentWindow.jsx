import React from 'react';

const AgentWindow = ({ agentType, data, onClose }) => {
  const getAgentIcon = (type) => {
    const icons = {
      summarizer: '📝',
      clipboard: '📋',
      docGeneration: '📄',
      action: '⚡',
      tts: '🔊'
    };
    return icons[type] || '🤖';
  };

  const getAgentTitle = (type) => {
    const titles = {
      summarizer: 'Summarizer Agent',
      clipboard: 'Clipboard Agent', 
      docGeneration: 'Document Generator',
      action: 'Action Agent',
      tts: 'Text-to-Speech'
    };
    return titles[type] || 'AI Agent';
  };

  return (
    <div className="floating-window w-80 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <span className="text-lg">{getAgentIcon(agentType)}</span>
          <h3 className="font-semibold text-white">{getAgentTitle(agentType)}</h3>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        {/* Simulated Response Content */}
        {agentType === 'summarizer' && (
          <div>
            <p className="text-sm text-gray-300 mb-2">Summary generated:</p>
            <div className="bg-thinkdrop-dark/50 p-3 rounded text-sm text-gray-200">
              "This is a simulated response from the summarizer agent. Key points extracted and processed."
            </div>
            <div className="flex space-x-2 mt-3">
              <button className="action-button text-xs">Save Notes</button>
              <button className="glass-effect px-2 py-1 rounded text-xs">Share</button>
            </div>
          </div>
        )}

        {agentType === 'clipboard' && (
          <div>
            <p className="text-sm text-gray-300 mb-2">Clipboard analysis:</p>
            <div className="bg-thinkdrop-dark/50 p-3 rounded text-sm text-gray-200">
              Text content analyzed. Suggested actions available.
            </div>
            <div className="flex space-x-2 mt-3">
              <button className="action-button text-xs">Create Note</button>
              <button className="glass-effect px-2 py-1 rounded text-xs">Format</button>
            </div>
          </div>
        )}

        {agentType === 'docGeneration' && (
          <div>
            <p className="text-sm text-gray-300 mb-2">Document ready:</p>
            <div className="bg-thinkdrop-dark/50 p-3 rounded text-sm text-gray-200">
              📄 meeting-notes-2024.md<br/>
              <span className="text-xs text-gray-400">350 words generated</span>
            </div>
            <div className="flex space-x-2 mt-3">
              <button className="action-button text-xs">Open Doc</button>
              <button className="glass-effect px-2 py-1 rounded text-xs">Export</button>
            </div>
          </div>
        )}

        {agentType === 'action' && (
          <div>
            <p className="text-sm text-gray-300 mb-2">Action completed:</p>
            <div className="bg-green-900/30 p-3 rounded text-sm text-green-200">
              ✅ Message sent to #team-updates<br/>
              <span className="text-xs text-gray-400">Sent via Slack integration</span>
            </div>
          </div>
        )}

        {agentType === 'tts' && (
          <div>
            <p className="text-sm text-gray-300 mb-2">Audio ready:</p>
            <div className="bg-thinkdrop-dark/50 p-3 rounded text-sm text-gray-200">
              🔊 30s audio generated<br/>
              <span className="text-xs text-gray-400">Neural voice synthesis</span>
            </div>
            <div className="flex space-x-2 mt-3">
              <button className="action-button text-xs">▶ Play</button>
              <button className="glass-effect px-2 py-1 rounded text-xs">Download</button>
            </div>
          </div>
        )}

        {/* Timestamp */}
        <div className="text-xs text-gray-500 border-t border-gray-700 pt-2 mt-3">
          {data?.simulated && <span className="text-yellow-400">🎭 Simulated • </span>}
          {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};

export default AgentWindow;
