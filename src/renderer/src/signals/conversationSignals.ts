import { signal, computed } from '@preact/signals-react';
import type { ConversationSession, ChatMessage } from '../contexts/ConversationContext';

// Core state signals
export const sessions = signal<ConversationSession[]>([]);
export const activeSessionId = signal<string | null>(null);
export const messages = signal<Record<string, ChatMessage[]>>({});
export const isSidebarOpen = signal(true);
export const isLoading = signal(false);
export const error = signal<string | null>(null);

// Computed values - these automatically update when dependencies change
export const activeSession = computed(() => 
  sessions.value.find(s => s.id === activeSessionId.value) || null
);

export const activeMessages = computed(() => 
  activeSessionId.value ? messages.value[activeSessionId.value] || [] : []
);

export const sessionsCount = computed(() => sessions.value.length);

export const hasActiveSession = computed(() => activeSessionId.value !== null);

// Debug helpers
export const debugState = computed(() => ({
  activeSessionId: activeSessionId.value,
  sessionsCount: sessions.value.length,
  activeMessagesCount: activeMessages.value.length,
  sidebarOpen: isSidebarOpen.value,
  loading: isLoading.value,
  error: error.value
}));
