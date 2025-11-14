/**
 * Check Screen Cache Node - Semantic search over cached screen data
 * 
 * This node runs BEFORE parseIntent to check if:
 * 1. We have recent cached screen data (< 5 minutes)
 * 2. The query is about screen content
 * 3. The cached OCR text can answer the query (semantic similarity)
 * 
 * If all conditions are met, skip directly to answer node with cached context.
 * This avoids unnecessary re-analysis and speeds up follow-up questions.
 */

/**
 * Chunk text into smaller pieces for embedding
 * @param {string} text - Text to chunk
 * @param {number} maxChars - Maximum characters per chunk
 * @returns {string[]} Array of text chunks
 */
function chunkText(text, maxChars = 1000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.substring(i, i + maxChars));
  }
  return chunks;
}

/**
 * Clean OCR text to improve semantic search quality
 * Removes noise, UI chrome, and formatting artifacts while preserving meaningful content
 * @param {string} text - Raw OCR text
 * @returns {string} Cleaned text
 */
function cleanOCRText(text) {
  if (!text) return '';
  
  let cleaned = text;
  
  // 1. Remove common UI chrome patterns
  // Remove single-character lines (often OCR artifacts)
  cleaned = cleaned.replace(/^[^a-zA-Z0-9\s]{1,2}$/gm, '');
  
  // Remove lines with only symbols/punctuation
  cleaned = cleaned.replace(/^[^\w\s]+$/gm, '');
  
  // 2. Remove common browser UI elements
  const uiPatterns = [
    /\b(http[s]?:\/\/[^\s]+)/gi, // URLs (keep domain but remove full URLs)
    /\b(chrome:\/\/[^\s]+)/gi, // Chrome internal URLs
    /\b(file:\/\/[^\s]+)/gi, // File paths
    /\b(Search mail|Compose|Primary|Promotions|Social|Updates|Forums)\b/gi, // Gmail UI
    /\b(New Tab|Bookmarks|History|Downloads|Extensions)\b/gi, // Browser UI
    /\b(Cmd\+[A-Z]|Ctrl\+[A-Z]|Alt\+[A-Z])\b/gi, // Keyboard shortcuts
  ];
  
  uiPatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // 3. Normalize whitespace
  // Replace multiple spaces with single space
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  
  // Replace multiple newlines with double newline (preserve paragraph breaks)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 4. Remove very short lines (< 3 chars) that are likely noise
  // BUT preserve lines that are just numbers (important for counts)
  cleaned = cleaned.split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // Keep if >= 3 chars OR if it's a number (even single digit)
      return trimmed.length >= 3 || /^\d+$/.test(trimmed);
    })
    .join('\n');
  
  // 5. Remove duplicate lines (common in OCR)
  // BUT preserve important numeric lines (like email counts)
  const lines = cleaned.split('\n');
  const seenLines = new Set();
  const uniqueLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Always keep lines with "Inbox" followed by numbers
    if (/inbox\s*\d/i.test(trimmed) || !seenLines.has(trimmed)) {
      uniqueLines.push(line);
      seenLines.add(trimmed);
    }
  }
  
  cleaned = uniqueLines.join('\n');
  
  // 6. Fix common OCR mistakes
  // Fix spacing around punctuation
  cleaned = cleaned.replace(/\s+([.,!?;:])/g, '$1');
  cleaned = cleaned.replace(/([.,!?;:])\s*([a-zA-Z])/g, '$1 $2');
  
  // Remove standalone punctuation
  cleaned = cleaned.replace(/\s+[.,!?;:]\s+/g, ' ');
  
  // 7. Preserve important patterns (emails, numbers, dates)
  // These are already in the text, just ensure they're not damaged
  
  // 8. Final cleanup
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Similarity score (0-1)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  
  if (magA === 0 || magB === 0) return 0;
  
  return dotProduct / (magA * magB);
}

/**
 * Build screen context from cached analysis data
 * (Imported from screenIntelligence.cjs to maintain consistency)
 */
function buildScreenContext(data, query, selectedText = null) {
  // Import the actual function from screenIntelligence
  // For now, use a simplified version
  const parts = [];
  
  if (selectedText) {
    parts.push('=== SELECTED TEXT ===');
    parts.push(selectedText.substring(0, 3000));
    parts.push('');
  }
  
  parts.push('=== CACHED SCREEN ANALYSIS ===');
  parts.push(`Strategy: ${data.strategy}`);
  parts.push(`Windows: ${data.windowsAnalyzed?.length || 0}`);
  parts.push(`Elements: ${data.elementCount || 0}`);
  parts.push('');
  
  // Use vision text (pure vision approach)
  if (data.visionText) {
    parts.push('🔍 VISION ANALYSIS (GPT-4o):');
    parts.push(data.visionText.substring(0, 5000));
    parts.push('');
  } else {
    // Fallback to elements if visionText not available (backward compatibility)
    const fullTextElement = data.elements?.find(el => el.role === 'full_text_content');
    if (fullTextElement?.value) {
      parts.push('📝 SCREEN CONTENT:');
      parts.push(fullTextElement.value.substring(0, 5000));
      parts.push('');
    }
  }
  
  return parts.join('\n');
}

module.exports = async function checkScreenCache(state) {
  const { message, mcpClient } = state;
  
  console.log('🔍 [NODE:CHECK_SCREEN_CACHE] Checking if cached screen data can answer query...');
  console.log(`📊 [NODE:CHECK_SCREEN_CACHE] Cache status: exists=${!!global.screenWorkerCache}, size=${global.screenWorkerCache?.size || 0}`);
  if (global.screenWorkerCache && global.screenWorkerCache.size > 0) {
    console.log(`📋 [NODE:CHECK_SCREEN_CACHE] Cached windows: ${Array.from(global.screenWorkerCache.keys()).join(', ')}`);
  }
  
  // 1. Check if we have recent cached screen data
  if (!global.screenWorkerCache || global.screenWorkerCache.size === 0) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] No cached data, proceeding to parseIntent');
    return state;
  }
  
  // 2. Get cache for CURRENT ACTIVE WINDOW (not just any recent cache)
  const activeWindowId = global.activeWindowId;
  if (!activeWindowId) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] No active window tracked, proceeding to parseIntent');
    return state;
  }
  
  const recentCache = global.screenWorkerCache.get(activeWindowId);
  if (!recentCache) {
    console.log(`⏭️  [NODE:CHECK_SCREEN_CACHE] No cache for active window (${activeWindowId}), proceeding to parseIntent`);
    return state;
  }
  
  // Check if cache is still fresh (5 minutes)
  if (Date.now() - recentCache.timestamp > 300000) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] Cache expired, proceeding to parseIntent');
    return state;
  }
  
  const cacheAge = Math.round((Date.now() - recentCache.timestamp) / 1000);
  console.log(`📦 [NODE:CHECK_SCREEN_CACHE] Found cached data for active window: ${activeWindowId} (${cacheAge}s old)`);
  
  // 3. Extract vision text from cached data
  const data = recentCache.data;
  const visionText = data.visionText || '';
  const fullTextElement = data.elements?.find(el => el.role === 'full_text_content');
  const screenText = visionText || fullTextElement?.value || '';
  
  if (!screenText || screenText.length < 50) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] No screen text in cache, proceeding to parseIntent');
    return state;
  }
  
  console.log(`📝 [NODE:CHECK_SCREEN_CACHE] Screen text available (${screenText.length} chars, source: ${visionText ? 'vision' : 'fallback'})`);
  
  // 4. Check if query is about screen content (quick keyword check)
  const queryLower = message.toLowerCase();
  const screenKeywords = [
    // Direct screen references
    'screen', 'see', 'visible', 'showing', 'display', 'shown', 'viewing',
    
    // Demonstrative pronouns (common in screen queries)
    'this', 'that', 'these', 'those', 'here', 'there',
    
    // Spatial/positional terms
    'above', 'below', 'top', 'bottom', 'upper', 'lower',
    'right', 'left', 'center', 'middle', 'side',
    'corner', 'edge', 'next to', 'beside', 'near',
    'upper left', 'upper right', 'lower left', 'lower right',
    'top left', 'top right', 'bottom left', 'bottom right',
    
    // UI elements
    'code', 'text', 'page', 'window', 'tab', 'console', 'terminal',
    'button', 'link', 'menu', 'panel', 'sidebar', 'toolbar',
    'dialog', 'popup', 'modal', 'notification', 'alert',
    
    // Content types
    'email', 'message', 'document', 'file', 'folder',
    'image', 'video', 'form', 'field', 'input',
    
    // Action verbs (screen-related)
    'what do', 'what does', 'what is', 'tell me', 'show me',
    'read', 'extract', 'find', 'locate', 'where',
    'highlight', 'select', 'click', 'open', 'close'
  ];
  
  const isScreenQuery = screenKeywords.some(kw => queryLower.includes(kw));
  
  if (!isScreenQuery) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] Not a screen query, proceeding to parseIntent');
    return state;
  }
  
  console.log('🎯 [NODE:CHECK_SCREEN_CACHE] Screen query detected');
  
  // ⏸️  DISABLED: Tier 3 predictive cache (phi4 performance issues)
  // TODO: Re-enable when phi4 LLM is faster and returns valid JSON
  // if (global.predictiveCache && global.predictiveCache.size > 0) {
  //   console.log('🔮 [NODE:CHECK_SCREEN_CACHE] Checking Tier 3 predictive cache...');
  //   ...
  // }
  console.log('⏸️  [NODE:CHECK_SCREEN_CACHE] Predictive cache disabled (phi4 performance issues)');
  
  // 5. Perform semantic search using phi4 embeddings (Tier 2 fallback)
  console.log('🔍 [NODE:CHECK_SCREEN_CACHE] Performing Tier 2 semantic search...');
  
  try {
    const startTime = Date.now();
    
    // Use screen text directly (vision text is already clean)
    const cleanedText = visionText ? screenText : screenText;
    console.log(`🧹 [NODE:CHECK_SCREEN_CACHE] Using vision text: ${screenText.length} chars`);
    
    // Generate embedding for query
    const queryEmbedResult = await mcpClient.callService('phi4', 'embedding.generate', {
      text: cleanedText.substring(0, 2000) // Limit to 2000 chars for embedding
    });
    
    const queryEmbedding = queryEmbedResult.data?.embedding || queryEmbedResult.embedding;
    
    if (!queryEmbedding) {
      console.warn('⚠️  [NODE:CHECK_SCREEN_CACHE] Failed to generate query embedding');
      return state;
    }
    
    // Generate embedding for cleaned OCR text (chunked if too long)
    const ocrChunks = chunkText(cleanedOcrText, 1000); // 1000 char chunks
    console.log(`📊 [NODE:CHECK_SCREEN_CACHE] Generating embeddings for ${ocrChunks.length} chunks...`);
    
    const chunkEmbeddings = await Promise.all(
      ocrChunks.slice(0, 10).map(async (chunk) => { // Limit to 10 chunks for performance
        const result = await mcpClient.callService('phi4', 'embedding.generate', { text: chunk });
        return result.data?.embedding || result.embedding;
      })
    );
    
    // Calculate cosine similarity for each chunk
    const similarities = chunkEmbeddings.map((chunkEmb, idx) => ({
      chunk: ocrChunks[idx],
      similarity: cosineSimilarity(queryEmbedding, chunkEmb)
    }));
    
    // Sort by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    const topSimilarity = similarities[0].similarity;
    // Configurable threshold via environment variable (default: 0.45 for noisy OCR)
    // Lower = more cache hits but higher false positive risk
    // Higher = fewer cache hits but lower false positive risk
    const relevanceThreshold = parseFloat(process.env.SCREEN_CACHE_THRESHOLD || '0.45');
    
    const searchTime = Date.now() - startTime;
    console.log(`🔍 [NODE:CHECK_SCREEN_CACHE] Semantic search complete (${searchTime}ms)`);
    console.log(`📊 [NODE:CHECK_SCREEN_CACHE] Top similarity: ${topSimilarity.toFixed(3)}, Threshold: ${relevanceThreshold}`);
    
    // Log top 3 matches for debugging
    console.log('🔍 [NODE:CHECK_SCREEN_CACHE] Top 3 matches:');
    similarities.slice(0, 3).forEach((s, i) => {
      console.log(`   ${i + 1}. Similarity: ${s.similarity.toFixed(3)} | Chunk: "${s.chunk.substring(0, 80)}..."`);
    });
    
    // 🔧 KEYWORD BOOST: Check for specific email/inbox patterns
    // If query mentions "email" or "inbox" and OCR contains "Inbox" with a number, boost similarity
    const emailKeywords = ['email', 'inbox', 'unread', 'message'];
    const hasEmailKeyword = emailKeywords.some(kw => queryLower.includes(kw));
    
    // More flexible inbox pattern - handles various formats:
    // "Inbox 2641", "Inbox (2,641)", "Inbox 2,641", "& Inbox 2641", etc.
    // Match: optional "&", "inbox", optional parens/spaces, then ALL digits (with optional commas)
    const inboxPattern = /(?:&\s+)?inbox\s*\(?\s*(\d+(?:[,\s]\d+)*)\s*\)?/i;
    const inboxMatch = ocrText.match(inboxPattern);
    
    let boostedSimilarity = topSimilarity;
    if (hasEmailKeyword && inboxMatch) {
      boostedSimilarity = Math.max(topSimilarity, 0.70); // Boost to pass threshold
      console.log(`🚀 [NODE:CHECK_SCREEN_CACHE] Keyword boost applied! Found "${inboxMatch[0]}" (similarity: ${topSimilarity.toFixed(3)} → ${boostedSimilarity.toFixed(3)})`);
    }
    
    if (boostedSimilarity >= relevanceThreshold) {
      console.log(`🎯 [NODE:CHECK_SCREEN_CACHE] Cache HIT! (similarity: ${boostedSimilarity.toFixed(3)})`);
      console.log(`   Matched chunk: "${similarities[0].chunk.substring(0, 200)}..."`);
      
      // Build context from cached screen data
      // Use CLEANED text and prioritize important information
      let contextText = cleanedOcrText;
      
      // If email query, extract and highlight inbox count at the top
      if (hasEmailKeyword && inboxMatch) {
        const inboxInfo = inboxMatch[0]; // e.g., "Inbox 2641" or "& Inbox 2,641"
        // Extract just the number for explicit display
        const numberMatch = inboxInfo.match(/(\d[\d,\s]*\d|\d)/);
        const emailCount = numberMatch ? numberMatch[0].replace(/[\s,]/g, '') : 'unknown';
        
        contextText = `📧 IMPORTANT: Total emails in inbox = ${emailCount}\n📧 Raw text: ${inboxInfo}\n\n${contextText}`;
        console.log(`📧 [NODE:CHECK_SCREEN_CACHE] Prioritized inbox info: "${inboxInfo}" → count: ${emailCount}`);
      }
      
      const screenContext = `## Screen Content (from cache)

${contextText.substring(0, 2000)}${contextText.length > 2000 ? '...' : ''}`;
      
      state.screenContext = screenContext;
      state.fromScreenCache = true;
      state.skipToAnswer = true;
      state.cacheSimilarity = boostedSimilarity;
      
      // Add intent for answer node
      state.intent = {
        type: 'screen_intelligence',
        confidence: boostedSimilarity
      };
      
      console.log('⚡ [NODE:CHECK_SCREEN_CACHE] Skipping to answer with cached screen data');
      return state;
    } else {
      console.log(`⏭️  [NODE:CHECK_SCREEN_CACHE] Low similarity (${topSimilarity.toFixed(3)} < ${relevanceThreshold}), proceeding to parseIntent`);
      return state;
    }
    
  } catch (error) {
    console.warn('⚠️  [NODE:CHECK_SCREEN_CACHE] Semantic search failed:', error.message);
    return state;
  }
};
