/**
 * Check Cache Readiness Node
 * 
 * Ensures screen cache is ready for the active window before processing screen intelligence queries.
 * This prevents race conditions where activeWindowId updates before cache is populated.
 * 
 * Flow:
 * 1. Check if intent is screen_intelligence
 * 2. Verify cache exists for active window
 * 3. If not ready: Wait up to 5 seconds with user feedback
 * 4. If timeout: Proceed anyway (will trigger fresh analysis)
 */

/**
 * Wait for cache to be ready with user feedback
 * @param {string} activeWindowId - The window ID we're waiting for
 * @param {number} maxWaitMs - Maximum time to wait (default 5000ms)
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Promise<boolean>} True if cache became ready, false if timeout
 */
async function waitForCache(activeWindowId, maxWaitMs = 5000, onProgress = null) {
  const startTime = Date.now();
  const checkInterval = 200; // Check every 200ms
  let attempts = 0;
  const maxAttempts = Math.floor(maxWaitMs / checkInterval);
  
  while (Date.now() - startTime < maxWaitMs) {
    attempts++;
    
    // Check if cache is ready
    const hasCache = global.screenWorkerCache?.has(activeWindowId);
    
    if (hasCache) {
      const elapsed = Date.now() - startTime;
      console.log(`✅ [NODE:CACHE_READINESS] Cache ready after ${elapsed}ms (${attempts} attempts)`);
      return true;
    }
    
    // Send progress update
    if (onProgress) {
      const progress = Math.min(100, Math.floor((attempts / maxAttempts) * 100));
      onProgress(progress, attempts);
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  console.log(`⏰ [NODE:CACHE_READINESS] Timeout after ${maxWaitMs}ms - proceeding without cache`);
  return false;
}

/**
 * Send thinking indicator update to frontend
 * @param {string} message - Message to display
 * @param {string} sessionId - Session ID
 */
function sendThinkingUpdate(message, sessionId) {
  try {
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    
    if (mainWindow) {
      mainWindow.webContents.send('thinking-indicator-update', {
        message,
        sessionId,
        timestamp: Date.now()
      });
      console.log(`💭 [NODE:CACHE_READINESS] Sent thinking update: "${message}"`);
    }
  } catch (error) {
    console.warn('⚠️ [NODE:CACHE_READINESS] Failed to send thinking update:', error.message);
  }
}

/**
 * Check if screen cache is ready for the active window
 * @param {Object} state - Current state
 * @returns {Object} Updated state
 */
async function checkCacheReadiness(state) {
  const { intent, sessionId, message } = state;
  
  // Only check for screen intelligence intents
  const screenIntents = ['screen_intelligence', 'screen_analysis', 'screen_query', 'vision'];
  const isScreenIntent = screenIntents.includes(intent?.type);
  
  if (!isScreenIntent) {
    console.log('⏭️ [NODE:CACHE_READINESS] Not a screen intent, skipping cache check');
    return state;
  }
  
  console.log('🔍 [NODE:CACHE_READINESS] Screen intent detected, checking cache readiness...');
  
  // Get active window ID
  const activeWindowId = global.activeWindowId;
  
  if (!activeWindowId) {
    console.log('⚠️ [NODE:CACHE_READINESS] No active window tracked, proceeding without cache check');
    return state;
  }
  
  console.log(`🎯 [NODE:CACHE_READINESS] Active window: ${activeWindowId}`);
  
  // Check if cache exists for active window
  const hasCache = global.screenWorkerCache?.has(activeWindowId);
  
  if (hasCache) {
    const cache = global.screenWorkerCache.get(activeWindowId);
    const cacheAge = Math.round((Date.now() - cache.timestamp) / 1000);
    console.log(`✅ [NODE:CACHE_READINESS] Cache ready (${cacheAge}s old)`);
    return state;
  }
  
  // Cache not ready - check available caches
  const availableCaches = global.screenWorkerCache 
    ? Array.from(global.screenWorkerCache.keys()) 
    : [];
  
  console.log(`⚠️ [NODE:CACHE_READINESS] Cache not ready for active window`);
  console.log(`   Active window: ${activeWindowId}`);
  console.log(`   Available caches: ${availableCaches.join(', ') || 'none'}`);
  console.log(`   This indicates a race condition - analysis may be in progress`);
  
  // Send initial thinking message
  sendThinkingUpdate('Scanning the page now...', sessionId);
  
  // Wait for cache with progress updates
  let lastProgress = 0;
  const cacheReady = await waitForCache(
    activeWindowId,
    5000, // Wait up to 5 seconds
    (progress, attempts) => {
      // Send progress updates every 25%
      if (progress >= lastProgress + 25) {
        const dots = '.'.repeat(Math.floor(attempts / 5) % 4);
        sendThinkingUpdate(`Scanning the page now${dots}`, sessionId);
        lastProgress = progress;
      }
    }
  );
  
  if (cacheReady) {
    // Cache became ready
    sendThinkingUpdate('Page scan complete!', sessionId);
    
    // Clear thinking message after short delay
    setTimeout(() => {
      sendThinkingUpdate(null, sessionId);
    }, 500);
    
    return {
      ...state,
      cacheWaitResult: 'ready',
      cacheWaitTime: Date.now() - state.startTime
    };
  } else {
    // Timeout - proceed anyway
    console.log('⏰ [NODE:CACHE_READINESS] Timeout - proceeding with fresh analysis');
    sendThinkingUpdate('Analyzing screen...', sessionId);
    
    return {
      ...state,
      cacheWaitResult: 'timeout',
      cacheWaitTime: 5000,
      forceFreshAnalysis: true // Signal to skip cache and force fresh analysis
    };
  }
}

module.exports = checkCacheReadiness;
