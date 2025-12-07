/**
 * Conversation Types
 * Shared types for conversation sessions and messages
 */

export interface ConversationSession {
  id: string;
  type: 'user-initiated' | 'ai-initiated';
  title: string;
  triggerReason: 'manual' | 'context-similarity' | 'time-pattern' | 'activity-change' | 'idle-return';
  triggerConfidence: number;
  contextData: Record<string, any>;
  relatedMemories: string[];
  currentActivity: Record<string, any>;
  isActive: boolean;
  isHibernated: boolean;
  hibernationData?: Record<string, any>;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  lastMessage?: string;
  unreadCount?: number;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: string;
  sessionId: string;
  metadata?: Record<string, any>;
}
