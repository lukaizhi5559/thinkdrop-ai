import React from 'react';
import { MessageSquare, ChevronRight } from 'lucide-react';
import { useConversationSignals } from '../hooks/useConversationSignals';

interface SidebarToggleProps {
  className?: string;
}

export const SidebarToggle: React.FC<SidebarToggleProps> = ({ className = '' }) => {
  const { signals, toggleSidebar } = useConversationSignals();
  
  // Extract values from signals
  const isSidebarOpen = signals.isSidebarOpen.value;
  const sessions = signals.sessions.value;
  const activeSessionId = signals.activeSessionId.value;

  // Get active session info
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const totalUnread = sessions.reduce((sum, session) => sum + (session.unreadCount || 0), 0);

  return (
    <button
      onClick={toggleSidebar}
      className={`
        group relative flex items-center gap-3 px-4 py-3 rounded-xl
        bg-gray-900/50 backdrop-blur-xl border border-gray-700/50
        hover:bg-gray-800/80 hover:border-gray-600/50
        text-white transition-all duration-200
        shadow-lg hover:shadow-xl
        ${isSidebarOpen ? 'bg-teal-600/20 border-teal-500/30' : ''}
        ${className}
      `}
      title={isSidebarOpen ? 'Close Conversations' : 'Open Conversations'}
    >
      {/* Icon with rotation animation */}
      <div className={`
        flex items-center justify-center transition-transform duration-300
        ${isSidebarOpen ? 'rotate-180' : ''}
      `}>
        {isSidebarOpen ? (
          <ChevronRight className="h-5 w-5 text-teal-400" />
        ) : (
          <MessageSquare className="h-5 w-5 text-teal-400" />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col items-start min-w-0 flex-1">
        {/* Main label */}
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">
            {isSidebarOpen ? 'Close' : ''}
          </span>
          
          {/* Unread badge */}
          {totalUnread > 0 && !isSidebarOpen && (
            <span className="bg-teal-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </div>

        {/* Active session info (when sidebar is closed) */}
        {!isSidebarOpen && activeSession && (
          <span className="text-xs text-gray-400 truncate max-w-[200px]">
            {activeSession.title}
            {activeSession.isHibernated && ' (hibernated)'}
          </span>
        )}
      </div>

      {/* Session count indicator */}
      {!isSidebarOpen && sessions.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span>{sessions.length}</span>
          <div className="w-1 h-1 rounded-full bg-gray-500"></div>
        </div>
      )}

      {/* Hover effect */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-teal-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
    </button>
  );
};
