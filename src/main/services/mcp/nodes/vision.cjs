/**
 * Vision Node - Process screen content with vision service
 * 
 * Captures screenshots and extracts visual information using:
 * - Online mode: Google Vision API (fast, 200-500ms)
 * - Privacy mode: Local Qwen2-VL (slower, 1-2s, private)
 * 
 * Adds visual context to state for LLM processing
 */

module.exports = async function vision(state) {
  const { mcpClient, userPreferences = {}, useOnlineMode, visionTask, visionRegion } = state;
  
  console.log('👁️  [NODE:VISION] Processing screen content');
  
  try {
    // Determine mode from user preferences
    // useOnlineMode: true → 'online' (Google Vision API)
    // useOnlineMode: false → 'privacy' (Local Qwen2-VL)
    const mode = useOnlineMode ? 'online' : 'privacy';
    console.log(`🔒 [NODE:VISION] Mode: ${mode} (useOnlineMode: ${useOnlineMode})`);
    
    // Build vision options
    const options = {
      mode: mode,
      task: visionTask || 'Describe what you see on the screen',
      store_to_memory: true
    };
    
    // Add region if specified
    if (visionRegion) {
      options.region = visionRegion;
    }
    
    // Call vision service (API key automatically retrieved from database)
    console.log('📸 [NODE:VISION] Capturing and analyzing screen...');
    const visionResult = await mcpClient.describeScreen(options);
    
    // Extract data from MCP response
    const data = visionResult.data || visionResult;
    
    console.log('✅ [NODE:VISION] Vision processing complete', {
      mode: data.mode,
      latency_ms: data.latency_ms,
      cached: data.cached,
      hasText: !!data.text,
      hasDescription: !!data.description,
      labels: data.labels?.length || 0,
      objects: data.objects?.length || 0
    });
    
    // Build visual context for LLM
    const visualContext = buildVisualContext(data);
    
    // Update state with vision results
    state.visionResult = data;
    state.visualContext = visualContext;
    
    // Add visual tokens if in privacy mode (for direct LLM integration)
    if (mode === 'privacy' && data.visual_tokens) {
      state.visualTokens = data.visual_tokens;
      console.log('🎯 [NODE:VISION] Visual tokens extracted for LLM');
    }
    
    // Add to context for answer node
    if (state.context) {
      state.context += `\n\n## Visual Context\n${visualContext}`;
    } else {
      state.context = `## Visual Context\n${visualContext}`;
    }
    
    console.log('📝 [NODE:VISION] Visual context added to state');
    console.log('=' .repeat(80));
    console.log('📊 VISUAL CONTEXT BEING PASSED TO ANSWER NODE:');
    console.log(visualContext);
    console.log('=' .repeat(80));
    
    return state;
    
  } catch (error) {
    console.error('❌ [NODE:VISION] Vision processing failed:', error);
    
    // Add error to state but don't fail the entire flow
    state.visionError = error.message;
    state.visualContext = '[Vision processing unavailable]';
    
    return state;
  }
};

/**
 * Build natural language visual context from vision results
 */
function buildVisualContext(data) {
  const parts = [];
  
  // Start with clear header
  parts.push('=== SCREEN ANALYSIS ===');
  parts.push('I analyzed your screen and found the following:');
  parts.push('');
  
  // Add description
  if (data.description) {
    parts.push(`📝 Content: ${data.description}`);
  }
  
  // Add extracted text
  if (data.text && data.text.trim()) {
    parts.push(`\n📄 Text on screen:\n${data.text.trim()}`);
  }
  
  // Add labels
  if (data.labels && data.labels.length > 0) {
    parts.push(`\n🏷️  Elements detected: ${data.labels.slice(0, 10).join(', ')}`);
  }
  
  // Add objects
  if (data.objects && data.objects.length > 0) {
    parts.push(`\n🎯 Objects found: ${data.objects.slice(0, 10).join(', ')}`);
  }
  
  parts.push('\n=== END SCREEN ANALYSIS ===');
  
  return parts.join('\n');
}
