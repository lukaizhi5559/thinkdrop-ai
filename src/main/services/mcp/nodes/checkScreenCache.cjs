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
  
  // Add OCR text
  const fullTextElement = data.elements?.find(el => el.role === 'full_text_content');
  if (fullTextElement?.value) {
    parts.push('📝 FULL SCREEN TEXT (OCR):');
    parts.push(fullTextElement.value.substring(0, 5000)); // Limit to 5000 chars
    parts.push('');
  }
  
  return parts.join('\n');
}

module.exports = async function checkScreenCache(state) {
  const { message, mcpClient } = state;
  
  console.log('🔍 [NODE:CHECK_SCREEN_CACHE] Checking if cached screen data can answer query...');
  
  // 1. Check if we have recent cached screen data
  if (!global.screenWorkerCache || global.screenWorkerCache.size === 0) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] No cached data, proceeding to parseIntent');
    return state;
  }
  
  // 2. Get most recent cache entry
  const cacheEntries = Array.from(global.screenWorkerCache.values());
  const recentCache = cacheEntries.find(entry => 
    Date.now() - entry.timestamp < 300000 // 5 minutes
  );
  
  if (!recentCache) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] Cache expired, proceeding to parseIntent');
    return state;
  }
  
  const cacheAge = Math.round((Date.now() - recentCache.timestamp) / 1000);
  console.log(`📦 [NODE:CHECK_SCREEN_CACHE] Found cached data (${cacheAge}s old)`);
  
  // 3. Extract OCR text from cached data
  const data = recentCache.data;
  const fullTextElement = data.elements?.find(el => el.role === 'full_text_content');
  const ocrText = fullTextElement?.value || '';
  
  if (!ocrText || ocrText.length < 50) {
    console.log('⏭️  [NODE:CHECK_SCREEN_CACHE] No OCR text in cache, proceeding to parseIntent');
    return state;
  }
  
  console.log(`📝 [NODE:CHECK_SCREEN_CACHE] OCR text available (${ocrText.length} chars)`);
  
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
    
    // Generate embedding for query
    const queryEmbedResult = await mcpClient.callService('phi4', 'embedding.generate', {
      text: message
    });
    
    const queryEmbedding = queryEmbedResult.data?.embedding || queryEmbedResult.embedding;
    
    if (!queryEmbedding) {
      console.warn('⚠️  [NODE:CHECK_SCREEN_CACHE] Failed to generate query embedding');
      return state;
    }
    
    // Generate embedding for OCR text (chunked if too long)
    const ocrChunks = chunkText(ocrText, 1000); // 1000 char chunks
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
    const inboxPattern = /inbox\s*\(?\s*(\d{1,3}(?:,\d{3})*|\d+)\s*\)?/i;
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
      const screenContext = `## Screen Content (from cache)

${ocrText.substring(0, 2000)}${ocrText.length > 2000 ? '...' : ''}`;
      
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
