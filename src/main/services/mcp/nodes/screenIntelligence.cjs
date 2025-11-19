/**
 * Screen Intelligence Node - Analyze screen with smart element extraction
 * 
 * Uses screen-intelligence service to:
 * 1. Detect all visible windows (or fullscreen app)
 * 2. Extract desktop items via AppleScript
 * 3. Extract browser content via AppleScript (Chrome/Safari) or OCR (Firefox)
 * 4. Extract UI elements via Accessibility API
 * 5. Filter and format results based on user query
 * 6. Show visual overlay highlighting relevant elements
 * 
 * This provides structured, queryable screen context to the LLM.
 */

const { showHighlights } = require('../../../windows/screen-intelligence-overlay.cjs');
const { getGuideWindow } = require('../../../windows/guide-window.cjs');

// Element color mapping by type
const ELEMENT_COLORS = {
  file: '#10b981',        // Green - Desktop files/folders
  window: '#3b82f6',      // Blue - Windows
  page_content: '#8b5cf6', // Purple - Browser content
  button: '#f59e0b',      // Orange - Interactive buttons
  textarea: '#f59e0b',    // Orange - Text inputs
  default: '#6b7280'      // Gray - Other elements
};

/**
 * Calculate context relevance score to determine if conversation history is needed
 * 
 * Returns score 0.0-1.0:
 * - 0.0-0.4: Self-contained query, no history needed
 * - 0.5-0.7: Moderate context dependency
 * - 0.8-1.0: High context dependency (follow-up questions)
 * 
 * @param {string} message - User query
 * @returns {Object} { score: number, reason: string }
 */
function calculateContextRelevance(message) {
  const lower = message.toLowerCase().trim();
  let score = 0.0;
  const reasons = [];
  
  // HIGH RELEVANCE SIGNALS (need conversation history)
  
  // 1. Vague pronouns/references (0.8)
  if (/\b(this|that|these|those|it|them)\b/i.test(lower)) {
    score += 0.8;
    reasons.push('vague reference');
  }
  
  // 2. Follow-up phrases (0.9)
  if (/^(anything|something|what|more|tell me|show me|explain|details|info).*(else|more|other|additional)/i.test(lower)) {
    score += 0.9;
    reasons.push('follow-up phrase');
  }
  
  // 3. Continuation words (0.7)
  if (/^(also|additionally|furthermore|moreover|besides|and|plus)\b/i.test(lower)) {
    score += 0.7;
    reasons.push('continuation word');
  }
  
  // 4. Short vague questions (0.6)
  const wordCount = lower.split(/\s+/).length;
  if (wordCount <= 3 && /^(what|how|why|when|where|who)\b/i.test(lower)) {
    score += 0.6;
    reasons.push('short vague question');
  }
  
  // LOW RELEVANCE SIGNALS (self-contained queries)
  
  // 1. Specific screen queries (-0.5)
  if (/\b(how many|count|list|show|find|get|read|extract|what'?s?|tell me about)\b.*\b(email|message|button|window|file|folder|tab|link|image|text|element|item|notification|alert)/i.test(lower)) {
    score -= 0.5;
    reasons.push('specific screen query');
  }
  
  // 2. Complete questions with clear subjects (-0.4)
  if (/\b(what|how|why|when|where|who)\b.*\b(is|are|does|do|can|should|will|would)\b/i.test(lower)) {
    score -= 0.4;
    reasons.push('complete question');
  }
  
  // 3. Direct screen commands (-0.6)
  if (/^(show|display|highlight|find|locate|click|open|close|read|extract)\b/i.test(lower)) {
    score -= 0.6;
    reasons.push('direct command');
  }
  
  // Normalize score to 0.0-1.0 range
  score = Math.max(0.0, Math.min(1.0, score));
  
  const reason = reasons.length > 0 ? reasons.join(', ') : 'neutral query';
  
  return { score, reason };
}

/**
 * Extract target entity from screen intelligence query
 * Examples:
 * - "what's in the warp console" → "warp console"
 * - "show me the chrome window" → "chrome window"
 * - "what does the error message say" → "error message"
 * 
 * @param {string} message - User query
 * @returns {string|null} - Extracted entity or null if none found
 */
function extractTargetEntity(message) {
  const lower = message.toLowerCase().trim();
  
  // Pattern 1: "what's in/on the [entity]"
  let match = lower.match(/what'?s?\s+(?:in|on)\s+(?:the\s+)?(.+?)(?:\s*\?)?$/i);
  if (match) return match[1].trim();
  
  // Pattern 2: "show/tell me about/the [entity]"
  match = lower.match(/(?:show|tell)\s+me\s+(?:about\s+)?(?:the\s+)?(.+?)(?:\s*\?)?$/i);
  if (match) return match[1].trim();
  
  // Pattern 3: "what does the [entity] say/show"
  match = lower.match(/what\s+does\s+(?:the\s+)?(.+?)\s+(?:say|show|display|contain)(?:\s*\?)?$/i);
  if (match) return match[1].trim();
  
  // Pattern 4: "read the [entity]"
  match = lower.match(/read\s+(?:the\s+)?(.+?)(?:\s*\?)?$/i);
  if (match) return match[1].trim();
  
  // Pattern 5: "who/what is in/on the [entity]"
  match = lower.match(/(?:who|what)\s+(?:is|are)\s+(?:in|on)\s+(?:the\s+)?(.+?)(?:\s*\?)?$/i);
  if (match) return match[1].trim();
  
  // Pattern 6: "what's the [entity]" (for specific UI elements)
  match = lower.match(/what'?s?\s+(?:the\s+)?(.+?)\s+(?:console|terminal|window|panel|tab|message|error|warning)(?:\s*\?)?$/i);
  if (match) return match[1].trim() + ' ' + lower.match(/(console|terminal|window|panel|tab|message|error|warning)/i)[1];
  
  return null;
}

module.exports = async function screenIntelligence(state) {
  const { mcpClient, message, context } = state;
  
  console.log('🎯 [NODE:SCREEN_INTELLIGENCE] Analyzing screen context');
  
  // Extract target entity from query
  const targetEntity = extractTargetEntity(message);
  if (targetEntity) {
    console.log(`🎯 [NODE:SCREEN_INTELLIGENCE] Target entity: "${targetEntity}"`);
    state.targetEntity = targetEntity; // Store for answer node
  }
  
  // Calculate context relevance score to decide if conversation history is needed
  const contextRelevance = calculateContextRelevance(message);
  console.log(`🎯 [NODE:SCREEN_INTELLIGENCE] Context relevance score: ${contextRelevance.score.toFixed(2)} (${contextRelevance.reason})`);
  
  // Fetch conversation history ONLY if query needs contextual understanding
  if (contextRelevance.score >= 0.5) {
    try {
      const messagesResult = await mcpClient.callService('conversation', 'message.list', {
        sessionId: context.sessionId,
        limit: 10,
        direction: 'DESC'
      });
      
      const messagesData = messagesResult.data || messagesResult;
      const conversationHistory = (messagesData.messages || [])
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text,
          timestamp: msg.timestamp
        }))
        .reverse(); // Reverse to chronological order (oldest → newest)
      
      // Add conversation history to state for answer node
      state.conversationHistory = conversationHistory;
      console.log(`📚 [NODE:SCREEN_INTELLIGENCE] Loaded ${conversationHistory.length} messages for context (relevance: ${contextRelevance.score.toFixed(2)})`);
    } catch (error) {
      console.warn('⚠️ [NODE:SCREEN_INTELLIGENCE] Failed to fetch conversation history:', error.message);
      state.conversationHistory = [];
    }
  } else {
    // Query is self-contained, no history needed
    state.conversationHistory = [];
    console.log(`📚 [NODE:SCREEN_INTELLIGENCE] Skipping conversation history (query is self-contained, relevance: ${contextRelevance.score.toFixed(2)})`);
  }
  
  try {
    // 1️⃣ Check Worker Thread cache first (instant lookup)
    let data;
    let fromCache = false;
    let cachedUrl = null;
    
    if (global.screenWorkerReady && global.screenWorkerCache) {
      // CRITICAL: Check cache for ACTIVE WINDOW, not just any recent cache
      const activeWindowId = global.activeWindowId;
      
      if (activeWindowId && global.screenWorkerCache.has(activeWindowId)) {
        const cacheEntry = global.screenWorkerCache.get(activeWindowId);
        const age = Math.round((Date.now() - cacheEntry.timestamp) / 1000);
        
        // Only use cache if it's reasonably fresh (< 30 seconds)
        // CRITICAL: Reduced from 5 minutes to 30 seconds to ensure fresh screen content
        // The cache is keyed by windowId (e.g., "Google Chrome") but screen content
        // changes frequently (LinkedIn → ChatGPT), so we need aggressive invalidation
        if (age < 30) {
          console.log(`⚡ [NODE:SCREEN_INTELLIGENCE] Using worker cache for active window (${age}s old, instant lookup)`);
          console.log(`   Active window: ${activeWindowId}`);
          console.log(`   Cached screen ID: ${cacheEntry.data?.screenId || 'unknown'}`);
          
          data = cacheEntry.data;
          fromCache = true;
          
          // Extract URL if available
          if (data.url) {
            cachedUrl = data.url;
            console.log(`🌐 [NODE:SCREEN_INTELLIGENCE] Cached URL: ${cachedUrl}`);
          }
        } else {
          console.log(`⚠️  [NODE:SCREEN_INTELLIGENCE] Cache for active window is stale (${age}s old), will request fresh analysis`);
        }
      } else {
        console.log(`⚠️  [NODE:SCREEN_INTELLIGENCE] No cache for active window: ${activeWindowId}`);
        console.log(`   Available caches: ${Array.from(global.screenWorkerCache.keys()).join(', ') || 'none'}`);
      }
    }
    
    // 2️⃣ Cache miss - call screen-intelligence service
    if (!fromCache) {
      console.log('📊 [NODE:SCREEN_INTELLIGENCE] Cache miss, calling screen/analyze...');
      
      // CRITICAL: Hide ThinkDrop AI guide window before screenshot
      // If ThinkDrop AI is the active window, we want to analyze the window BEHIND it
      const guideWindow = getGuideWindow();
      let wasGuideVisible = false;
      if (guideWindow && guideWindow.isVisible()) {
        console.log('👁️  [NODE:SCREEN_INTELLIGENCE] Hiding ThinkDrop AI panel before screenshot...');
        guideWindow.hide();
        wasGuideVisible = true;
        // Wait 100ms for window to fully hide
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const startTime = Date.now();
      
      // Screen analysis can take 30-60s when analyzing multiple browser windows with Playwright
      // Use environment variable or default to 60 seconds
      const screenTimeout = parseInt(process.env.MCP_SCREEN_TIMEOUT || '60000');
      const result = await mcpClient.callService('screen-intelligence', 'screen.analyze', {
        query: message,
        includeScreenshot: false, // We don't need screenshots for text queries
        method: 'semantic' // CRITICAL: Use semantic analysis (OCR + OWLv2), not NutJS text capture
      }, { timeout: screenTimeout });
      
      // Restore guide window if it was visible
      if (wasGuideVisible && guideWindow) {
        console.log('👁️  [NODE:SCREEN_INTELLIGENCE] Restoring ThinkDrop AI panel...');
        guideWindow.show();
      }
      
      const analysisTime = Date.now() - startTime;
      console.log(`📊 [NODE:SCREEN_INTELLIGENCE] Analysis complete (${analysisTime}ms)`);
      
      // Extract data from response
      data = result.data || result;
    }
    
    console.log('✅ [NODE:SCREEN_INTELLIGENCE] Screen analysis complete', {
      strategy: data.strategy,
      screenId: data.screenId,
      windowsAnalyzed: data.windowsAnalyzed?.length || 0,
      elementCount: data.elementCount || 0,
      hasSelectedText: !!data.selectedText,
      fromCache
    });
    
    // 🐛 DEBUG: Log full analysis data structure
    console.log('=' .repeat(80));
    console.log('🐛 [DEBUG] FULL ANALYSIS DATA STRUCTURE:');
    console.log(JSON.stringify({
      strategy: data.strategy,
      screenId: data.screenId,
      fromCache,
      elementCount: data.elementCount,
      windowsAnalyzed: data.windowsAnalyzed?.map(w => ({
        app: w.app,
        title: w.title,
        bounds: w.bounds
      })),
      elements: data.elements?.slice(0, 5).map(el => ({
        type: el.type,
        role: el.role,
        label: el.label?.substring(0, 50),
        value: el.value?.substring(0, 100),
        bounds: el.bounds
      })),
      totalElements: data.elements?.length || 0,
      hasOCR: !!data.elements?.find(el => el.role === 'full_text_content'),
      hasAccessibility: !!data.elements?.find(el => el.type === 'accessibility'),
      selectedText: data.selectedText ? data.selectedText.substring(0, 100) + '...' : null
    }, null, 2));
    console.log('=' .repeat(80));
    
    // Log selected text if found
    if (data.selectedText) {
      console.log('📝 [NODE:SCREEN_INTELLIGENCE] Found selected text:', {
        length: data.selectedText.length,
        preview: data.selectedText.substring(0, 100) + '...'
      });
    }
    
    // 🔍 Use semantic search to find relevant elements instead of passing all elements
    console.log('🔍 [NODE:SCREEN_INTELLIGENCE] Performing semantic search on indexed elements...');
    let semanticResults = [];
    try {
      // Filter by current screen ID to only get elements from the active screen
      const filters = data.screenId ? { screenId: data.screenId } : {};
      console.log(`🔍 [NODE:SCREEN_INTELLIGENCE] Filtering by screen ID: ${data.screenId || 'none (searching all screens)'}`);
      
      const searchResult = await mcpClient.callService('screen-intelligence', 'element.search', {
        query: message,
        k: 10, // Top 10 most relevant elements
        minScore: 0.3, // Lower threshold to get more results
        filters // Filter to current screen only
      }, { timeout: 5000 });
      
      semanticResults = searchResult.data?.results || searchResult.results || [];
      console.log(`✅ [NODE:SCREEN_INTELLIGENCE] Found ${semanticResults.length} relevant elements via semantic search`);
    } catch (searchError) {
      console.warn('⚠️  [NODE:SCREEN_INTELLIGENCE] Semantic search failed, will use fallback:', searchError.message);
    }
    
    // Build context from semantic search results
    const screenContext = buildScreenContextFromSearch(semanticResults, message, data.selectedText, data);
    
    // TEMPORARILY DISABLED: Overlay causes focus stealing and desktop shifts
    // Even with type: 'panel', showing the overlay window activates the Electron app
    // and causes fullscreen apps to exit fullscreen mode
    // TODO: Re-enable after fixing focus stealing issue
    // if (shouldShowOverlay(message)) {
    //   try {
    //     const filteredElements = getFilteredElementsForOverlay(data, message);
    //     // Filter out desktop items with invalid coordinates (x:-1, y:-1)
    //     const validElements = filteredElements.filter(el => 
    //       el.bounds && el.bounds.x >= 0 && el.bounds.y >= 0
    //     );
    //     
    //     if (validElements.length > 0) {
    //       console.log(`🎨 [NODE:SCREEN_INTELLIGENCE] Showing overlay for spatial query with ${validElements.length} elements`);
    //       showHighlights(validElements, 10000);
    //       state.overlayShown = true;
    //     } else {
    //       console.log(`ℹ️  [NODE:SCREEN_INTELLIGENCE] No valid elements to highlight for spatial query`);
    //     }
    //   } catch (overlayError) {
    //     console.error('⚠️  [NODE:SCREEN_INTELLIGENCE] Failed to show overlay:', overlayError);
    //     // Don't fail the entire flow if overlay fails
    //   }
    // }
    
    // Update state with screen intelligence results
    state.screenIntelligenceResult = data;
    state.screenContext = screenContext;
    
    // Add to context for answer node
    if (state.context) {
      state.context += `\n\n## Screen Context\n${screenContext}`;
    } else {
      state.context = `## Screen Context\n${screenContext}`;
    }
    
    console.log('📝 [NODE:SCREEN_INTELLIGENCE] Screen context added to state');
    console.log('=' .repeat(80));
    console.log('📊 SCREEN CONTEXT BEING PASSED TO ANSWER NODE:');
    console.log(screenContext);
    console.log('=' .repeat(80));
    
    // 🆕 Generate Page Insight if we have OCR text
    // Extract OCR text from elements
    const fullTextElement = data.elements?.find(el => el.role === 'full_text_content');
    const ocrText = fullTextElement?.value || '';
    
    if (ocrText && ocrText.length > 50) {
      try {
        console.log('💡 [NODE:SCREEN_INTELLIGENCE] Generating Page Insight...');
        
        // Send loading state to renderer
        const { sendInsightLoading, sendInsightUpdate, sendInsightError } = require('../../../handlers/ipc-handlers-insight.cjs');
        sendInsightLoading(true);
        
        const insightNode = require('./insight.cjs');
        const insightState = await insightNode({
          ...state,
          ocrText: ocrText,
          windowTitle: data.windowsAnalyzed?.[0]?.title || 'Current Page',
          insightType: 'page'
        });
        
        if (insightState.insights) {
          state.insights = insightState.insights;
          console.log(`✅ [NODE:SCREEN_INTELLIGENCE] Page Insight generated: ${insightState.insights.links.length} links`);
          
          // Send insight to renderer
          sendInsightUpdate(insightState.insights);
        } else {
          sendInsightError('No insights generated');
        }
      } catch (insightError) {
        console.warn('⚠️ [NODE:SCREEN_INTELLIGENCE] Failed to generate Page Insight:', insightError.message);
        const { sendInsightError } = require('../../../handlers/ipc-handlers-insight.cjs');
        sendInsightError(insightError.message);
        // Don't fail the entire flow if insight generation fails
      }
    }
    
    return state;
    
  } catch (error) {
    console.error('❌ [NODE:SCREEN_INTELLIGENCE] Screen analysis failed:', error);
    
    // Add error to state but don't fail the entire flow
    state.screenIntelligenceError = error.message;
    state.screenContext = '[Screen analysis unavailable]';
    
    return state;
  }
};

/**
 * Build screen context from semantic search results
 * This is the NEW approach: LLM only sees top-k relevant elements from vector search
 */
function buildScreenContextFromSearch(searchResults, query, selectedText = null, fullData = null) {
  const parts = [];
  
  // If selected text is provided, prioritize it at the top
  if (selectedText) {
    parts.push('=== SELECTED TEXT ===');
    parts.push(selectedText.substring(0, 3000));
    if (selectedText.length > 3000) {
      parts.push('... (content truncated)');
    }
    parts.push('');
  }
  
  parts.push('=== SCREEN ANALYSIS (Semantic Search Results) ===');
  parts.push(`Query: "${query}"`);
  parts.push(`Found: ${searchResults.length} relevant UI elements`);
  parts.push('');
  
  if (searchResults.length === 0) {
    parts.push('No relevant UI elements found for this query.');
    parts.push('The screen may not contain elements matching your request.');
  } else {
    parts.push('🎯 RELEVANT UI ELEMENTS (ranked by relevance):');
    parts.push('');
    
    searchResults.forEach((result, idx) => {
      const { type, text, description, score, bbox } = result;
      const relevancePercent = (score * 100).toFixed(1);
      
      // Format element with text as primary identifier
      if (text && text.trim()) {
        parts.push(`${idx + 1}. ${type.toUpperCase()}: "${text}" (${relevancePercent}% match)`);
      } else {
        parts.push(`${idx + 1}. ${type.toUpperCase()} (${relevancePercent}% match)`);
        if (description && description !== type) {
          parts.push(`   ${description}`);
        }
      }
      
      // Add human-readable location
      if (bbox) {
        const [x1, y1, x2, y2] = bbox;
        const centerX = Math.round((x1 + x2) / 2);
        const centerY = Math.round((y1 + y2) / 2);
        const position = getScreenPosition(centerX, centerY);
        parts.push(`   Location: ${position}`);
      }
      parts.push('');
    });
  }
  
  // Add window context if available
  if (fullData?.windowsAnalyzed && fullData.windowsAnalyzed.length > 0) {
    parts.push('🪟 ACTIVE WINDOWS:');
    fullData.windowsAnalyzed.forEach((win, idx) => {
      parts.push(`${idx + 1}. ${win.app} - "${win.title || 'Untitled'}"`);
    });
    parts.push('');
  }
  
  parts.push('=== END SCREEN ANALYSIS ===');
  parts.push('');
  parts.push('Note: These are the most relevant elements based on semantic similarity to your query.');
  parts.push('If you need different information, please rephrase your question.');
  
  return parts.join('\n');
}

/**
 * Convert coordinates to human-readable screen position
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} screenWidth - Screen width (default 1440)
 * @param {number} screenHeight - Screen height (default 900)
 * @returns {string} Human-readable position like "upper left", "center", "bottom right"
 */
function getScreenPosition(x, y, screenWidth = 1440, screenHeight = 900) {
  const xThird = screenWidth / 3;
  const yThird = screenHeight / 3;
  
  let vertical = '';
  if (y < yThird) vertical = 'upper';
  else if (y < yThird * 2) vertical = 'middle';
  else vertical = 'lower';
  
  let horizontal = '';
  if (x < xThird) horizontal = 'left';
  else if (x < xThird * 2) horizontal = 'center';
  else horizontal = 'right';
  
  // Special case for center-center
  if (vertical === 'middle' && horizontal === 'center') {
    return 'center of screen';
  }
  
  return `${vertical} ${horizontal}`;
}

/**
 * Build intelligent screen context from analysis results (OLD APPROACH - DEPRECATED)
 * Filters and formats based on query keywords
 * 
 * @deprecated Use buildScreenContextFromSearch instead for semantic search-based context
 */
function buildScreenContext(data, query, selectedText = null) {
  const parts = [];
  const queryLower = query.toLowerCase();
  
  // If selected text is provided, prioritize it at the top
  if (selectedText) {
    parts.push('=== SELECTED TEXT ===');
    parts.push(selectedText.substring(0, 3000)); // Limit to 3000 chars
    if (selectedText.length > 3000) {
      parts.push('... (content truncated)');
    }
    parts.push('');
    parts.push('');
  }
  
  // Start with clear header
  parts.push('=== SCREEN ANALYSIS ===');
  parts.push(`Strategy: ${data.strategy}`);
  parts.push(`Windows Analyzed: ${data.windowsAnalyzed?.length || 0}`);
  parts.push(`Total Elements: ${data.elementCount || 0}`);
  parts.push('');
  
  // Categorize elements by type
  const elementsByType = categorizeElements(data.elements || []);
  
  // Check query intent to prioritize relevant information
  const queryIntent = detectQueryIntent(queryLower);
  
  // Build context based on query intent
  if (queryIntent.type === 'desktop_files' || queryIntent.type === 'general') {
    // User asking about desktop files/folders or general screen summary
    parts.push('📁 DESKTOP ITEMS:');
    if (elementsByType.files.length > 0) {
      parts.push(formatDesktopItems(elementsByType.files));
    } else {
      parts.push('No desktop items found.');
    }
    parts.push('');
  }
  
  if (queryIntent.type === 'browser_content' || queryIntent.type === 'email' || queryIntent.type === 'webpage' || queryIntent.type === 'general') {
    // User asking about browser/email content or general screen summary
    parts.push('🌐 BROWSER CONTENT:');
    if (elementsByType.pageContent.length > 0) {
      parts.push(formatBrowserContent(elementsByType.pageContent, data.windowsAnalyzed));
    } else {
      parts.push('No browser content found.');
    }
    parts.push('');
  }
  
  if (queryIntent.type === 'windows' || queryIntent.type === 'general') {
    // User asking about windows or general screen content
    parts.push('🪟 VISIBLE WINDOWS:');
    if (data.windowsAnalyzed && data.windowsAnalyzed.length > 0) {
      parts.push(formatWindows(data.windowsAnalyzed));
    } else {
      parts.push('No windows detected.');
    }
    parts.push('');
  }
  
  if (queryIntent.type === 'ui_elements' || queryIntent.type === 'general') {
    // User asking about UI elements or buttons
    parts.push('🎯 INTERACTIVE ELEMENTS:');
    // Include buttons, links, images, textareas, modals, and menus for comprehensive coverage
    const interactiveElements = [
      ...elementsByType.buttons, 
      ...elementsByType.links,
      ...elementsByType.images,
      ...elementsByType.textareas,
      ...elementsByType.modals,
      ...elementsByType.menus
    ];
    if (interactiveElements.length > 0) {
      // Pass query to enable smart region-based filtering
      parts.push(formatUIElements(interactiveElements, 20, query)); // Increase limit to 20 for better coverage
    } else {
      parts.push('No interactive elements found.');
    }
    parts.push('');
  }
  
  // OCR text content (for non-browser apps like code editors, terminals)
  if (elementsByType.textLines.length > 0 || elementsByType.textWords.length > 0 || elementsByType.pageContent.length > 0) {
    parts.push('📝 TEXT CONTENT (with spatial coordinates):');
    
    // First, show full text content if available (fallback when OCR doesn't return structured data)
    const fullTextElements = elementsByType.pageContent.filter(el => el.role === 'full_text_content');
    if (fullTextElements.length > 0) {
      fullTextElements.forEach(el => {
        parts.push(`Full Screen Text (OCR):`);
        parts.push(el.value.substring(0, 2000)); // Show first 2000 chars
        if (el.value.length > 2000) {
          parts.push('... (content truncated)');
        }
      });
    }
    
    // Use text lines for better context (not individual words)
    if (elementsByType.textLines.length > 0) {
      // Pass query to enable smart region-based filtering
      parts.push(formatUIElements(elementsByType.textLines, 30, query)); // Higher limit for text
    } else if (elementsByType.textWords.length > 0) {
      // Fallback to words if no lines available
      parts.push(formatUIElements(elementsByType.textWords, 50, query));
    }
    parts.push('');
  }
  
  parts.push('=== END SCREEN ANALYSIS ===');
  
  return parts.join('\n');
}

/**
 * Categorize elements by type for easier filtering
 * Handles both browser elements (Playwright) and non-browser elements (OCR with bounds)
 */
function categorizeElements(elements) {
  return {
    files: elements.filter(el => el.role === 'file'),
    pageContent: elements.filter(el => el.role === 'page_content' || el.role === 'full_text_content'),
    windows: elements.filter(el => el.role === 'window'),
    buttons: elements.filter(el => (el.role === 'button' || el.role === 'ui_element') && el.label),
    links: elements.filter(el => el.role === 'link'),
    images: elements.filter(el => el.role === 'image' || el.role === 'img'),
    textareas: elements.filter(el => el.role === 'textarea' || el.role === 'dropdown' || el.role === 'search'),
    // OCR text elements (from non-browser apps like code editors, terminals)
    textLines: elements.filter(el => el.role === 'text_line'),
    textWords: elements.filter(el => el.role === 'text'),
    // Add new categories for semantic UI elements
    modals: elements.filter(el => el.role === 'modal' || el.role === 'panel'),
    menus: elements.filter(el => el.role === 'menu' || el.role === 'tab'),
    other: elements.filter(el => !['file', 'page_content', 'full_text_content', 'window', 'button', 'link', 'image', 'img', 'textarea', 'text_line', 'text', 'ui_element', 'dropdown', 'search', 'modal', 'panel', 'menu', 'tab'].includes(el.role))
  };
}

/**
 * Detect query intent to prioritize relevant information
 */
function detectQueryIntent(queryLower) {
  // Desktop files/folders
  if (queryLower.includes('desktop') || queryLower.includes('file') || queryLower.includes('folder')) {
    return { type: 'desktop_files', priority: ['files'] };
  }
  
  // Browser/email content
  if (queryLower.includes('email') || queryLower.includes('gmail') || queryLower.includes('mail')) {
    return { type: 'email', priority: ['pageContent', 'windows'] };
  }
  if (queryLower.includes('browser') || queryLower.includes('webpage') || queryLower.includes('website')) {
    return { type: 'webpage', priority: ['pageContent', 'windows'] };
  }
  
  // Windows
  if (queryLower.includes('window') || queryLower.includes('app')) {
    return { type: 'windows', priority: ['windows'] };
  }
  
  // UI elements
  if (queryLower.includes('button') || queryLower.includes('click') || queryLower.includes('element')) {
    return { type: 'ui_elements', priority: ['buttons', 'textareas'] };
  }
  
  // General query - show everything
  return { type: 'general', priority: ['all'] };
}

/**
 * Format desktop items for LLM
 */
function formatDesktopItems(files) {
  const parts = [];
  files.forEach((file, idx) => {
    parts.push(`${idx + 1}. ${file.label} (${file.value})`);
  });
  return parts.join('\n');
}

/**
 * Format browser content for LLM
 */
function formatBrowserContent(pageContent, windowsAnalyzed) {
  const parts = [];
  
  // Deduplicate content by value (same page content from multiple windows)
  const seenContent = new Set();
  const uniqueContent = pageContent.filter(content => {
    if (seenContent.has(content.value)) {
      return false;
    }
    seenContent.add(content.value);
    return true;
  });
  
  uniqueContent.forEach((content) => {
    // Find the window this content belongs to
    const window = windowsAnalyzed?.find(w => 
      w.app === content.windowApp && w.title === content.windowTitle
    );
    
    if (window) {
      parts.push(`Browser: ${window.app}`);
      parts.push(`Page Title: ${window.title}`);
      parts.push(`Extraction Method: ${window.method}`);
      parts.push('');
      parts.push('Page Content:');
      parts.push(content.value.substring(0, 3000)); // Increased limit to 3000 chars for emails
      if (content.value.length > 3000) {
        parts.push('... (content truncated)');
      }
    }
  });
  
  return parts.join('\n');
}

/**
 * Format windows for LLM
 */
function formatWindows(windows) {
  const parts = [];
  windows.forEach((win, idx) => {
    parts.push(`${idx + 1}. ${win.app} - "${win.title}"`);
    parts.push(`   Elements: ${win.elementCount}, Method: ${win.method}`);
  });
  return parts.join('\n');
}

/**
 * Get spatial region for element bounds (e.g., "upper left", "center", "lower right")
 */
function getSpatialRegion(bounds, screenWidth = 1440, screenHeight = 900) {
  if (!bounds || bounds.x === undefined || bounds.y === undefined) {
    return null;
  }
  
  // Calculate center point of element
  const centerX = bounds.x + (bounds.width || 0) / 2;
  const centerY = bounds.y + (bounds.height || 0) / 2;
  
  // Divide screen into 3x3 grid
  const horizontal = centerX < screenWidth / 3 ? 'left' : 
                     centerX > (2 * screenWidth) / 3 ? 'right' : 'center';
  const vertical = centerY < screenHeight / 3 ? 'upper' : 
                   centerY > (2 * screenHeight) / 3 ? 'lower' : 'middle';
  
  // Return combined region (e.g., "upper left", "center", "lower right")
  if (horizontal === 'center' && vertical === 'middle') {
    return 'center';
  }
  return `${vertical} ${horizontal}`;
}

/**
 * Format UI elements for LLM (limit to most relevant)
 * If query mentions a location, prioritize elements in that region
 */
function formatUIElements(elements, limit = 10, query = '') {
  const parts = [];
  
  // Check if query mentions a specific location using precise pattern matching
  const queryLower = query.toLowerCase();
  
  // Extract vertical position (upper/top/lower/bottom/middle)
  let vertical = null;
  if (/\b(upper|top)\b/.test(queryLower)) vertical = 'upper';
  else if (/\b(lower|bottom)\b/.test(queryLower)) vertical = 'lower';
  else if (/\bmiddle\b/.test(queryLower)) vertical = 'middle';
  
  // Extract horizontal position (left/right/center)
  let horizontal = null;
  if (/\bleft\b/.test(queryLower)) horizontal = 'left';
  else if (/\bright\b/.test(queryLower)) horizontal = 'right';
  else if (/\bcenter\b/.test(queryLower)) horizontal = 'center';
  
  // Combine to form target region
  let targetRegion = null;
  if (vertical && horizontal) {
    // Both specified: "upper left", "lower right", etc.
    if (horizontal === 'center' && vertical === 'middle') {
      targetRegion = 'center';
    } else {
      targetRegion = `${vertical} ${horizontal}`;
    }
  } else if (vertical === 'middle' && horizontal === 'center') {
    // Just "center" or "middle"
    targetRegion = 'center';
  } else if (vertical && !horizontal) {
    // Only vertical: "upper", "lower" - match any horizontal in that row
    targetRegion = vertical; // Will match "upper left", "upper center", "upper right"
  } else if (horizontal && !vertical) {
    // Only horizontal: "left", "right" - match any vertical in that column
    targetRegion = horizontal; // Will match "upper left", "middle left", "lower left"
  }
  
  // Filter and sort elements
  let relevantElements = elements.filter(el => el.label || el.value);
  
  // If user asked about a specific region, prioritize those elements
  if (targetRegion) {
    const regionElements = relevantElements.filter(el => {
      // Use pre-computed region from OCR if available, otherwise calculate it
      const region = el.region || getSpatialRegion(el.bounds);
      if (!region) return false;
      
      // Exact match: "upper left" === "upper left"
      if (region === targetRegion) return true;
      
      // Partial match: "left" matches "upper left", "middle left", "lower left"
      // Or "upper" matches "upper left", "upper center", "upper right"
      if (targetRegion === 'left' || targetRegion === 'right' || targetRegion === 'center') {
        return region.includes(targetRegion);
      }
      if (targetRegion === 'upper' || targetRegion === 'lower' || targetRegion === 'middle') {
        return region.startsWith(targetRegion);
      }
      
      return false;
    });
    
    // Prioritize links and images over buttons (products over UI controls)
    const priorityOrder = { 'link': 1, 'image': 2, 'img': 2, 'button': 3, 'textarea': 4 };
    regionElements.sort((a, b) => {
      const aPriority = priorityOrder[a.role] || 5;
      const bPriority = priorityOrder[b.role] || 5;
      return aPriority - bPriority;
    });
    
    // Show region-specific elements first, then others
    const otherElements = relevantElements.filter(el => {
      // Use pre-computed region from OCR if available, otherwise calculate it
      const region = el.region || getSpatialRegion(el.bounds);
      if (!region) return true;
      
      // Check if this element was already included in regionElements
      if (region === targetRegion) return false;
      if (targetRegion === 'left' || targetRegion === 'right' || targetRegion === 'center') {
        return !region.includes(targetRegion);
      }
      if (targetRegion === 'upper' || targetRegion === 'lower' || targetRegion === 'middle') {
        return !region.startsWith(targetRegion);
      }
      
      return true;
    });
    
    relevantElements = [...regionElements.slice(0, limit), ...otherElements.slice(0, Math.max(0, limit - regionElements.length))];
  } else {
    // No specific region - take first N elements
    relevantElements = relevantElements.slice(0, limit);
  }
  
  relevantElements.forEach((el, idx) => {
    // Truncate long labels to prevent line wrapping that confuses the LLM
    const rawLabel = el.label || 'Unlabeled';
    const label = rawLabel.length > 100 ? rawLabel.substring(0, 97) + '...' : rawLabel;
    const value = el.value ? ` (${el.value.substring(0, 50)})` : '';
    // Use pre-computed region from OCR if available, otherwise calculate it
    const region = el.region || getSpatialRegion(el.bounds);
    const position = region ? ` [${region}]` : '';
    parts.push(`${idx + 1}. ${el.role}: ${label}${value}${position}`);
  });
  
  if (elements.length > limit) {
    parts.push(`... and ${elements.length - limit} more elements`);
  }
  
  return parts.join('\n');
}

/**
 * Determine if overlay highlighting should be shown for this query
 * Only show for spatial/location queries to avoid distraction
 */
function shouldShowOverlay(query) {
  const q = query.toLowerCase();
  
  // Spatial/location keywords
  const spatialKeywords = [
    'lower right', 'upper left', 'lower left', 'upper right',
    'top left', 'top right', 'bottom left', 'bottom right',
    'middle', 'center', 'top', 'bottom', 'left', 'right',
    'upper', 'lower'
  ];
  
  // Debug/show keywords
  const debugKeywords = [
    'show me', 'highlight', 'where is', 'find the',
    'point to', 'locate'
  ];
  
  // Action keywords (for confirmation before action)
  const actionKeywords = [
    'click', 'select', 'choose', 'tap'
  ];
  
  // Check if query contains any trigger keywords
  return spatialKeywords.some(kw => q.includes(kw)) ||
         debugKeywords.some(kw => q.includes(kw)) ||
         actionKeywords.some(kw => q.includes(kw));
}

/**
 * Get filtered elements for overlay display
 * Matches the same filtering logic as buildScreenContext
 */
function getFilteredElementsForOverlay(data, query) {
  const queryLower = query.toLowerCase();
  const queryIntent = detectQueryIntent(queryLower);
  const elementsByType = categorizeElements(data.elements || []);
  
  let elementsToShow = [];
  
  // Match the same intent-based filtering
  if (queryIntent.type === 'desktop_files') {
    elementsToShow = elementsByType.files;
  } else if (queryIntent.type === 'browser_content' || queryIntent.type === 'email' || queryIntent.type === 'webpage') {
    // Show browser windows (but not page_content text, just the window bounds)
    elementsToShow = data.windowsAnalyzed
      ?.filter(w => isBrowser(w.app))
      .map(w => ({
        role: 'window',
        label: `${w.app} - ${w.title}`,
        bounds: w.bounds,
        confidence: 0.95
      })) || [];
  } else if (queryIntent.type === 'windows') {
    // Show all windows
    elementsToShow = data.windowsAnalyzed
      ?.map(w => ({
        role: 'window',
        label: `${w.app} - ${w.title}`,
        bounds: w.bounds,
        confidence: 0.95
      })) || [];
  } else if (queryIntent.type === 'ui_elements') {
    // Show interactive elements (browser) or text lines (non-browser)
    const interactiveElements = [...elementsByType.buttons, ...elementsByType.textareas];
    const textElements = elementsByType.textLines || [];
    
    // Prioritize interactive elements, but show text lines if no interactive elements
    elementsToShow = interactiveElements.length > 0 
      ? interactiveElements.slice(0, 10)
      : textElements.slice(0, 20); // Show more text lines for code/terminal
  } else {
    // General - show everything (windows + desktop items)
    const windows = data.windowsAnalyzed
      ?.map(w => ({
        role: 'window',
        label: `${w.app} - ${w.title}`,
        bounds: w.bounds,
        confidence: 0.95
      })) || [];
    elementsToShow = [...windows, ...elementsByType.files];
  }
  
  return elementsToShow;
}

/**
 * Check if app name is a browser
 */
function isBrowser(appName) {
  const browsers = ['chrome', 'safari', 'firefox', 'edge', 'brave', 'arc', 'vivaldi', 'opera'];
  return browsers.some(b => appName.toLowerCase().includes(b));
}
