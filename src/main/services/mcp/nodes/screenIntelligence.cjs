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

// Element color mapping by type
const ELEMENT_COLORS = {
  file: '#10b981',        // Green - Desktop files/folders
  window: '#3b82f6',      // Blue - Windows
  page_content: '#8b5cf6', // Purple - Browser content
  button: '#f59e0b',      // Orange - Interactive buttons
  textarea: '#f59e0b',    // Orange - Text inputs
  default: '#6b7280'      // Gray - Other elements
};

module.exports = async function screenIntelligence(state) {
  const { mcpClient, message, context } = state;
  
  console.log('🎯 [NODE:SCREEN_INTELLIGENCE] Analyzing screen context');
  
  // Fetch conversation history for context (needed for follow-up questions)
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
    console.log(`📚 [NODE:SCREEN_INTELLIGENCE] Loaded ${conversationHistory.length} messages for context`);
  } catch (error) {
    console.warn('⚠️ [NODE:SCREEN_INTELLIGENCE] Failed to fetch conversation history:', error.message);
    state.conversationHistory = [];
  }
  
  try {
    // 1️⃣ Check Virtual Screen DOM cache first
    const virtualDOM = global.virtualScreenDOM;
    const cached = virtualDOM?.queryCached(null, message);
    
    let data;
    
    if (cached && Date.now() - cached.timestamp < 300000) {
      // Cache hit - use cached data (within 5 minutes = 300 seconds)
      const age = Math.round((Date.now() - cached.timestamp) / 1000);
      console.log(`⚡ [NODE:SCREEN_INTELLIGENCE] Using cached data (${age}s old)`);
      
      // Build data structure from cache
      data = {
        strategy: 'cached',
        windowsAnalyzed: [cached.windowInfo],
        elements: cached.elements,
        elementCount: cached.elementCount,
        selectedText: null
      };
    } else {
      // 2️⃣ Cache miss or stale - call screen-intelligence service
      console.log('📊 [NODE:SCREEN_INTELLIGENCE] Calling screen/analyze...');
      // Screen analysis can take 30-60s when analyzing multiple browser windows with Playwright
      // Use environment variable or default to 60 seconds
      const screenTimeout = parseInt(process.env.MCP_SCREEN_TIMEOUT || '60000');
      const result = await mcpClient.callService('screen-intelligence', 'screen.analyze', {
        query: message,
        includeScreenshot: false // We don't need screenshots for text queries
      }, { timeout: screenTimeout });
      
      // Extract data from response
      data = result.data || result;
      
      // 3️⃣ Cache the fresh results
      if (virtualDOM && data.elements) {
        await virtualDOM.cacheAnalysis(data);
        console.log('✅ [NODE:SCREEN_INTELLIGENCE] Cached fresh analysis');
      }
    }
    
    console.log('✅ [NODE:SCREEN_INTELLIGENCE] Screen analysis complete', {
      strategy: data.strategy,
      windowsAnalyzed: data.windowsAnalyzed?.length || 0,
      elementCount: data.elementCount || 0,
      hasSelectedText: !!data.selectedText
    });
    
    // Log selected text if found
    if (data.selectedText) {
      console.log('📝 [NODE:SCREEN_INTELLIGENCE] Found selected text:', {
        length: data.selectedText.length,
        preview: data.selectedText.substring(0, 100) + '...'
      });
    }
    
    // Filter and format the payload intelligently based on query
    const screenContext = buildScreenContext(data, message, data.selectedText);
    
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
 * Build intelligent screen context from analysis results
 * Filters and formats based on query keywords
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
    // Include buttons, links, images, and textareas for comprehensive coverage
    const interactiveElements = [
      ...elementsByType.buttons, 
      ...elementsByType.links,
      ...elementsByType.images,
      ...elementsByType.textareas
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
    buttons: elements.filter(el => el.role === 'button' && el.label),
    links: elements.filter(el => el.role === 'link'),
    images: elements.filter(el => el.role === 'image' || el.role === 'img'),
    textareas: elements.filter(el => el.role === 'textarea'),
    // OCR text elements (from non-browser apps like code editors, terminals)
    textLines: elements.filter(el => el.role === 'text_line'),
    textWords: elements.filter(el => el.role === 'text'),
    other: elements.filter(el => !['file', 'page_content', 'full_text_content', 'window', 'button', 'link', 'image', 'img', 'textarea', 'text_line', 'text'].includes(el.role))
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
