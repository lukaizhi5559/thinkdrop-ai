import React, { useState, useCallback } from 'react';
import { 
  MessageSquare, 
  Plus, 
  X, 
  MoreHorizontal, 
  Edit2, 
  Trash2, 
  Pause, 
  Play,
  Clock,
  Bot,
  User,
  ChevronLeft,
  Search
} from 'lucide-react';
import { useConversationSignals } from '../hooks/useConversationSignals';
import { formatDistanceToNow } from 'date-fns';

interface ConversationSidebarProps {
  className?: string;
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({ className = '' }) => {
  const {
    signals,
    activeSessionId,
    createSession,
    switchToSession,
    toggleSidebar,
    updateSession,
    deleteSession,
    hibernateSession,
    resumeSession
  } = useConversationSignals();

  // Extract values from signals
  const sessions = signals.sessions.value;
  const isSidebarOpen = signals.isSidebarOpen.value;
  const isLoading = signals.isLoading.value;
  
  // Sidebar actions - use the closeSidebar from signals
  const closeSidebar = () => {
    if (isSidebarOpen) {
      toggleSidebar();
    }
  };
  
  // Debug logging for sidebar state
  React.useEffect(() => {
    console.log('🔍 [ConversationSidebar] State update:', {
      isSidebarOpen,
      sessionsCount: sessions.length,
      activeSessionId,
      isLoading
    });
  }, [isSidebarOpen, sessions.length, activeSessionId, isLoading]);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);

  // Filter sessions based on search query
  const filteredSessions = sessions.filter(session =>
    session.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    session.lastMessage?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle new chat creation
  const handleNewChat = useCallback(async () => {
    try {
      const sessionId = await createSession('user-initiated', {
        title: `Chat ${sessions.length + 1}`
      });
      switchToSession(sessionId);
      
      // Close sidebar on mobile
      if (window.innerWidth < 768) {
        closeSidebar();
      }
    } catch (error) {
      console.error('Failed to create new chat:', error);
    }
  }, [createSession, switchToSession, closeSidebar, sessions.length]);

  // Handle session title editing
  const handleStartEdit = useCallback((sessionId: string, currentTitle: string) => {
    setEditingSessionId(sessionId);
    setEditingTitle(currentTitle);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (editingSessionId && editingTitle.trim()) {
      await updateSession(editingSessionId, { title: editingTitle.trim() });
      setEditingSessionId(null);
      setEditingTitle('');
    }
  }, [editingSessionId, editingTitle, updateSession]);

  const handleCancelEdit = useCallback(() => {
    setEditingSessionId(null);
    setEditingTitle('');
  }, []);

  // Handle actions menu toggle
  const handleToggleMenu = useCallback((sessionId: string) => {
    setOpenMenuSessionId(prev => prev === sessionId ? null : sessionId);
  }, []);

  // Handle session hibernation/resumption
  const handleToggleHibernation = useCallback(async (sessionId: string, isHibernated: boolean) => {
    if (isHibernated) {
      await resumeSession(sessionId);
    } else {
      await hibernateSession(sessionId);
    }
  }, [hibernateSession, resumeSession]);

  // Handle session deletion
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (window.confirm('Are you sure you want to delete this conversation?')) {
      await deleteSession(sessionId);
    }
  }, [deleteSession]);

  // Format relative time
  const formatTime = useCallback((dateString: string) => {
    try {
      if (!dateString) return 'Unknown';
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Unknown';
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Unknown';
    }
  }, []);

  console.log('[filteredSessions]', filteredSessions)

  return (
    <>
      {/* Backdrop for mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed top-0 left-0 h-full bg-gray-900/95 backdrop-blur-xl border-r border-gray-700/50
        transform transition-transform duration-300 ease-in-out z-50
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        w-80 md:w-96 flex flex-col
        ${className}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-5 w-5 text-teal-400" />
            <h2 className="text-lg font-semibold text-white">Conversations</h2>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewChat}
              disabled={isLoading}
              className="p-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-50"
              title="New Chat"
            >
              <Plus className="h-4 w-4" />
            </button>
            
            <button
              onClick={closeSidebar}
              className="p-2 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors md:hidden"
              title="Close Sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            
            <button
              onClick={closeSidebar}
              className="p-2 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors hidden md:block"
              title="Close Sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-700/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-gray-400">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-400 mx-auto mb-2"></div>
              Loading conversations...
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-4 text-center text-gray-400">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </div>
          ) : (
            <div className="p-2">
              {filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className={`
                    group relative p-3 mb-2 rounded-lg cursor-pointer transition-all duration-200
                    ${activeSessionId === session.id 
                      ? 'bg-teal-600/20 border border-teal-500/30' 
                      : 'hover:bg-gray-700/30 border border-transparent'
                    }
                    ${session.isHibernated ? 'opacity-60' : ''}
                  `}
                  onClick={() => {
                    console.log('🖱️ [ConversationSidebar] Session clicked:', session.id, session.title);
                    if (editingSessionId !== session.id) {
                      console.log('🔄 [ConversationSidebar] Calling switchToSession for:', session.id);
                      switchToSession(session.id);
                      // Also close sidebar directly from here as backup
                      console.log('🚪 [ConversationSidebar] Closing sidebar directly');
                      closeSidebar();
                    } else {
                      console.log('⚠️ [ConversationSidebar] Session is being edited, ignoring click');
                    }
                  }}
                >
                  {/* Session Header */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      
                      {/* Title */}
                      {editingSessionId === session.id ? (
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <h3 className="font-medium text-white truncate flex-1">
                          {session.lastMessage || session.title || 'New Chat'}
                        </h3>
                      )}

                      {/* Unread Count */}
                      {session.unreadCount && session.unreadCount > 0 && (
                        <span className="flex-shrink-0 bg-teal-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
                          {session.unreadCount > 99 ? '99+' : session.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* Actions Menu */}
                    <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="relative">
                        <button 
                          className="p-1 rounded hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleMenu(session.id);
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        
                        {/* Quick Actions (visible on click) */}
                        {openMenuSessionId === session.id && (
                        <div className="absolute right-0 top-6 bg-gray-800 border border-gray-600 rounded-lg shadow-lg py-1 z-10">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(session.id, session.title);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white w-full text-left"
                          >
                            <Edit2 className="h-3 w-3" />
                            Rename
                          </button>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleHibernation(session.id, session.isHibernated);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white w-full text-left"
                          >
                            {session.isHibernated ? (
                              <>
                                <Play className="h-3 w-3" />
                                Resume
                              </>
                            ) : (
                              <>
                                <Pause className="h-3 w-3" />
                                Hibernate
                              </>
                            )}
                          </button>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 hover:text-red-300 w-full text-left"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Last Message Preview */}
                  {session.lastMessage && (
                    <p className="text-sm text-gray-400 truncate mb-2">
                      {session.lastMessage}
                    </p>
                  )}

                  {/* Session Metadata */}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {session.messageCount || 0}
                      </span>
                      
                      {session.isHibernated && (
                        <span className="flex items-center gap-1 text-yellow-500">
                          <Pause className="h-3 w-3" />
                          Hibernated
                        </span>
                      )}
                      
                      {session.type === 'ai-initiated' && (
                        <span className="flex items-center gap-1 text-purple-400">
                          <Bot className="h-3 w-3" />
                          AI
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTime(session.lastActivityAt)}
                    </div>
                  </div>

                  {/* Trigger Information for AI-initiated sessions */}
                  {session.type === 'ai-initiated' && session.triggerReason !== 'manual' && (
                    <div className="mt-2 text-xs text-purple-400 bg-purple-500/10 rounded px-2 py-1">
                      Triggered by {session.triggerReason.replace('-', ' ')} 
                      {session.triggerConfidence > 0 && ` (${Math.round(session.triggerConfidence * 100)}%)`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700/50">
          <div className="text-xs text-gray-500 text-center">
            {sessions.length} conversation{sessions.length !== 1 ? 's' : ''}
            {sessions.filter(s => s.isHibernated).length > 0 && (
              <span className="ml-2">
                ({sessions.filter(s => s.isHibernated).length} hibernated)
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
