import { loadSessions } from './conversationActions';
import { debugState } from './conversationSignals';

// Initialize signals when app starts
export const initializeConversationSignals = async () => {
  console.log('🚀 [SIGNALS] Initializing conversation signals...');
  
  try {
    // Load existing sessions from backend
    await loadSessions();
    
    // Set up debug logging
    if (process.env.NODE_ENV === 'development') {
      // Log state changes in development
      debugState.subscribe((state) => {
        console.log('🔍 [SIGNALS STATE]', state);
      });
    }
    
    console.log('✅ [SIGNALS] Conversation signals initialized successfully');
  } catch (error) {
    console.error('❌ [SIGNALS] Failed to initialize conversation signals:', error);
  }
};

// Clean up function for when app closes
export const cleanupConversationSignals = () => {
  console.log('🧹 [SIGNALS] Cleaning up conversation signals...');
  // Any cleanup logic if needed
};
