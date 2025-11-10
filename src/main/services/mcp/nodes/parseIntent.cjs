/**
 * Parse Intent Node
 * Extracts intent and entities from user message via phi4 service
 */

module.exports = async function parseIntent(state) {
  const { mcpClient, message, resolvedMessage, context, conversationMessages } = state;

  // Use resolved message if available (after coreference resolution), otherwise use original
  const messageToClassify = resolvedMessage || message;
  
  console.log(' [NODE:PARSE_INTENT] Parsing intent...');
  if (resolvedMessage && resolvedMessage !== message) {
    console.log(`📝 [NODE:PARSE_INTENT] Using resolved message: "${message}" → "${resolvedMessage}"`);
  }

  // Fetch recent conversation messages for context-aware intent classification
  let recentMessages = [];
  try {
    const messagesResult = await mcpClient.callService('conversation', 'message.list', {
      sessionId: context.sessionId,
      limit: 5,
      direction: 'DESC'
    });
    
    const messagesData = messagesResult.data || messagesResult;
    const messages = messagesData.messages || [];
    
    // Convert to format expected by phi4 (chronological order)
    recentMessages = messages.reverse().map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text,
      timestamp: msg.created_at || msg.timestamp
    }));
    
    console.log(`📚 [NODE:PARSE_INTENT] Including ${recentMessages.length} recent messages for context`);
  } catch (error) {
    console.warn('⚠️ [NODE:PARSE_INTENT] Failed to fetch conversation history:', error.message);
    // Continue without conversation history
  }

  try {
    // ── PRE-CHECK: Catch obvious intents before phi4 classification ──────────────
    const lowerMsg = messageToClassify.toLowerCase().trim();
    
    // Check for screen analysis queries (unified: vision + screen intelligence)
    // All screen-related queries now route to screen intelligence (with vision fallback)
    const screenAnalysisPatterns = [
      // General screen queries (previously "vision")
      /what (do you|can you) see (on|in) (my|the) screen/i,
      /what'?s? (on|in) (my|the) screen/i,
      /describe (my|the) screen/i,
      /analyze (my|the) screen/i,
      /look at (my|the) screen/i,
      /read (my|the) screen/i,
      /what'?s? (visible|showing|displayed) (on|in) (my|the) screen/i,
      /tell me what'?s? (on|in) (my|the) screen/i,
      /what am i looking at/i,
      /what'?s? in (this|the) (image|screenshot|picture)/i,
      /extract text from (my|the) screen/i,
      /ocr (my|the) screen/i,
      /read text from (my|the) screen/i,
      // Specific screen intelligence queries
      /how many (files?|folders?|items?) (are |is )?(on|in) (my|the) desktop/i,
      /what (files?|folders?|items?) (are|do i have) (on|in) (my|the) desktop/i,
      /list (my|the) desktop (files?|folders?|items?)/i,
      /count (my|the) desktop (files?|folders?|items?)/i,
      /what (windows?|apps?) (are|do i have) open/i,
      /what'?s? (in|on) (my|the) (browser|chrome|safari|firefox|edge)/i,
      /what (email|message|page|website) (am i|is) (looking at|viewing|reading)/i,
      /what (does|is) (this|the) (email|page|website) (say|about)/i,
      /what'?s? (this|the|my)? ?(email|message|page|website|document|form|article) (say|about)/i,
      /what (does|is) (this|the) (section|clause|paragraph|disclaimer|warning|notification|error|popup|dialog) (say|mean|about)/i,
      /what'?s? (this|the)? ?(section|clause|paragraph|disclaimer|warning|notification|error|popup|dialog|button|icon|menu|field|label|image|chart|graph|table|list|text|heading|title|link|option) (say|mean|about|for|do|showing)/i,
      /who (is|sent|'?s?) (this|the)? ?(person|email|message)/i,
      /who (is|are) (in|at) (this|the) (photo|image|picture|bottom|top|left|right|corner)/i,
      /read (my|the) (email|browser|webpage)/i,
      /what (buttons?|elements?) (are|can i) (see|click)/i,
      /find (the|a) (button|element|link) (to|for|that)/i,
      // Action-oriented screen queries
      /translate (this|the|that) .* on (my|the) screen/i,
      /(polish|fix|correct|improve|rewrite|proofread|check) (this|the|that) .* on (my|the) screen/i,
      /respond to (this|the|that) .* on (my|the) screen/i
    ];
    
    // Check for follow-up screen queries (when previous message was a screen query)
    let isFollowUpScreenQuery = false;
    if (recentMessages.length >= 2 && /^(what about now|how about now|and now)$/i.test(lowerMsg)) {
      const prevUserMsg = recentMessages[recentMessages.length - 2];
      if (prevUserMsg && prevUserMsg.role === 'user') {
        isFollowUpScreenQuery = screenAnalysisPatterns.some(pattern => pattern.test(prevUserMsg.content));
      }
    }
    
    const isScreenAnalysisQuery = screenAnalysisPatterns.some(pattern => pattern.test(lowerMsg)) || isFollowUpScreenQuery;
    
    if (isScreenAnalysisQuery) {
      console.log('🎯 [NODE:PARSE_INTENT] Pre-check: Detected screen analysis query, routing to screen_intelligence (vision fallback)');
      return {
        ...state,
        intent: {
          type: 'screen_intelligence',
          confidence: 0.95,
          entities: [],
          requiresMemoryAccess: false
        }
      };
    }
    
    // Strong command indicators (open, close, launch, quit, exit, etc.)
    // BUT: Exclude questions, conditionals, and statements
    const isQuestion = /^(can|could|would|should|will|do|does|is|are|what|when|where|why|how|who)\s+/i.test(lowerMsg);
    const isStatement = /^(i want|i need|i'd like|i would like|i'm going to|let me)\s+/i.test(lowerMsg);
    
    if (!isQuestion && !isStatement && /^(open|launch|start|run|close|quit|exit|kill|stop)\s+/i.test(lowerMsg)) {
      console.log('🔄 [NODE:PARSE_INTENT] Pre-check: Detected imperative command verb, forcing command intent');
      return {
        ...state,
        intent: {
          type: 'command',
          confidence: 0.95,
          entities: [],
          requiresMemoryAccess: false
        }
      };
    }
    
    // 🎯 CONTEXT-AWARE INTENT: Include previous exchange for better classification
    // This helps with elliptical messages like "nothing next week" after "do I have any appts"
    let enhancedMessage = messageToClassify;
    
    // Only enhance for very short, ambiguous messages (≤3 words)
    // Don't enhance clear action phrases like "open slack" or "check my memory"
    if (recentMessages.length >= 2) {
      const lastUserMsg = recentMessages[recentMessages.length - 3];
      const lastAiMsg = recentMessages[recentMessages.length - 2];
      
      // Only enhance if message is ≤3 words (very short and potentially ambiguous)
      const wordCount = messageToClassify.split(/\s+/).length;
      if (wordCount <= 3 && lastUserMsg && lastAiMsg) {
        enhancedMessage = `[Previous question: "${lastUserMsg.content}"] [AI response: "${lastAiMsg.content.substring(0, 100)}..."] [Current: "${messageToClassify}"]`;
        console.log(`🔗 [NODE:PARSE_INTENT] Enhanced short message (${wordCount} words) with context for better classification`);
      }
    }
    
    const result = await mcpClient.callService('phi4', 'intent.parse', {
      message: enhancedMessage,
      context: {
        sessionId: context.sessionId,
        userId: context.userId,
        conversationHistory: recentMessages // Add conversation history for context-aware classification
      }
    });

    // MCP protocol wraps response in 'data' field
    const intentData = result.data || result;
    
    let finalIntent = intentData.intent || 'general_query';
    let finalConfidence = intentData.confidence || 0.5;
    
    // ── SMART FALLBACK: Check if "question" or "web_search" is actually a "command" ──
    // System queries like "what apps do I have open" or "how much memory do I have"
    // are often misclassified as questions or web searches when they should be commands
    // Also catches "open slack app" misclassified as web_search due to conversation context
    if ((finalIntent === 'question' && finalConfidence < 0.7) || 
        (finalIntent === 'web_search' && finalConfidence < 0.9)) {
      const lowerMessage = message.toLowerCase();
      
      // Command indicators: system resource queries
      const commandPatterns = [
        // ── SYSTEM RESOURCE & STATUS ─────────────────────────────────────
        /what (apps?|applications?|programs?|processes?).*(open|running|active|launched)/i,
        /show.*(apps?|applications?|programs?|processes?).*(open|running|active)/i,
        /list.*(apps?|applications?|programs?|processes?).*(open|running|active)/i,
        /how much (memory|ram|disk|storage|space|cpu|battery|power)/i,
        /what['s]? my (memory|ram|disk|cpu|battery|system|ip|mac address)/i,
        /check (memory|ram|disk|cpu|battery|system|performance|health|status)/i,
        /current (cpu|memory|disk|battery|ram) (usage|load|level)/i,
        /system (info|status|health|specs|uptime)/i,
        /is my (computer|system|laptop|mac|pc) (on|off|sleeping|locked)/i,
        /what'?s? the (temperature|temp) of my (cpu|gpu)/i,
                                                                   
        // ── VERSION & INSTALLATION QUERIES ────────────────────────────────
        /what version.*(installed|have|running|using)/i,
        /which version.*(installed|have|running|using)/i,
        /check.*(version|installed)/i,
        /(do i|did i) (have|install).*(installed|on my)/i,
        /is.*(installed|available)/i,
        
        // ── DOCKER & CONTAINER QUERIES ────────────────────────────────────
        /how many.*(docker|container|pod|image)/i,
        /list.*(docker|container|pod|image)/i,
        /show.*(docker|container|pod|image)/i,
        /what.*(docker|container|pod).*(running|have|in)/i,

        // ── FILE & FOLDER LISTING QUERIES ─────────────────────────────────
        /list.*(files?|folders?|directories|items?).*(on|in) (my )?(desktop|documents|downloads|home)/i,
        /show.*(files?|folders?|directories|items?).*(on|in) (my )?(desktop|documents|downloads|home)/i,
        /what.*(files?|folders?|directories|items?).*(on|in) (my )?(desktop|documents|downloads|home)/i,
        /list all.*(files?|folders?|on my)/i,
        /show all.*(files?|folders?|on my)/i,
        
        // ── FILE COUNTING QUERIES ─────────────────────────────────────────
        /how many (files?|folders?|items?).*(on|in) (my )?(desktop|documents|downloads|home|that folder|this (folder|directory))/i,
        /count.*(files?|folders?|items?).*(on|in) (my )?(desktop|documents|downloads|home)/i,
        /how many (files?|folders?).*(do|are) (I|there)/i,

        // ── FILE & FOLDER MANIPULATION ────────────────────────────────────
        /create.*(file|folder|directory).*(on|in|at) (my )?(desktop|documents|downloads|home)/i,
        /make.*(file|folder|directory).*(on|in|at) (my )?(desktop|documents|downloads|home)/i,
        /delete.*(file|folder|directory).*(on|in|from) (my )?(desktop|documents|downloads|home)/i,
        /remove.*(file|folder|directory).*(on|in|from) (my )?(desktop|documents|downloads|home)/i,
        /move.*(file|folder|directory).*(to|from) (my )?(desktop|documents|downloads|home)/i,
        /copy.*(file|folder|directory).*(to|from) (my )?(desktop|documents|downloads|home)/i,
        /rename.*(file|folder|directory)/i,
        /create.*(file|folder).*(called|named)/i,
        /make.*(file|folder).*(called|named)/i,

        // ── APP CONTROL (Open / Close / Switch) ──────────────────────────
        /(open|launch|start|run)\s+(.+)/i,
        /(close|quit|kill|stop|terminate|force quit)\s+(.+)/i,
        /switch to\s+(.+)/i,
        /focus\s+(.+)/i,
        /(hide|show) (desktop|all windows)/i,
        /minimize all/i,
        /bring (chrome|safari|finder|terminal|vscode|code|slack|discord|zoom|spotify|notion|figma|postman).*(front|forward)/i,

        // ── APP QUERIES (Check / List / Info) ────────────────────────────
        /do (i|we) have.*(app|application|program)/i,
        /is (there|the).*(app|application|program).*(installed|available|on|in)/i,
        /what (does|do|is).*(app|application|program).*(have|contain|show)/i,
        /show me.*(app|application|program)/i,
        /list.*(apps?|applications?|programs?)/i,
        /what apps?.*(installed|available|running)/i,

        // ── COMMON APPS (no need to list all — dynamic in scoring) ───────
        // But keep a few for high confidence
        /(open|close) (slack|discord|zoom|teams|chrome|safari|firefox|edge|vscode|code|terminal|finder|iterm|warp|postman|figma|notion|spotify|music|photos|camera|mail|calendar|notes|reminders|messages|facetime)/i,

        // ── SCREEN & MEDIA CONTROL ───────────────────────────────────────
        /take a (screenshot|screen shot|screen capture)/i,
        /(start|stop|begin|end) (screen recording|screen record)/i,
        /record my screen/i,
        /pause|play|next|previous|skip|volume (up|down)|mute|unmute/i,
        /turn (up|down) the volume/i,
        /play.*(music|song|playlist|podcast)/i,
        /pause.*(music|song|video)/i,
        /open (youtube|netflix|spotify|apple music)/i,

        // ── TIMERS & ALARMS ─────────────────────────────────────────────
        /set (a )?timer for (\d+ )?(minutes?|hours?|seconds?)/i,
        /start a (\d+ )?(minute|hour) timer/i,
        /set (an )?alarm for (morning|evening|\d+ ?(am|pm))/i,
        /wake me (up )?at \d+ ?(am|pm)/i,
        /remind me in (\d+ )?(minutes?|hours?)/i,

        // ── SYSTEM ACTIONS ───────────────────────────────────────────────
        /(lock|sleep|restart|shutdown|power off|log out) (computer|system|mac|pc|laptop)/i,
        /empty (trash|recycle bin)/i,
        /clear (cache|downloads|desktop|clipboard)/i,
        /turn (on|off) (wifi|bluetooth|dark mode|night shift|do not disturb|focus mode)/i,
        /enable|disable (dark mode|night shift|dnd|focus)/i,
        /open (settings|preferences|system preferences|control panel)/i,
        /show (hidden files|file extensions)/i,

        // ── FILE & NAVIGATION ───────────────────────────────────────────
        /go to (downloads|desktop|documents|pictures|home)/i,
        /open (folder|directory) (.+)/i,
        /find file (.+)/i,
        /search for (.+)/i,
        /create (new )?(file|folder|note|document)/i,
        /do i have.*(file|folder|directory)/i,
        /is there.*(file|folder|directory)/i,
        /find.*(folder|directory|file).*called/i,

        // ── NETWORK & CONNECTIVITY ───────────────────────────────────────
        /what'?s? my (ip|public ip|local ip|mac address)/i,
        /connect to (wifi|vpn)/i,
        /disconnect from (wifi|vpn)/i,
        /show (available )?wifi networks/i,
        /restart (wifi|router|modem)/i,

        // ── BATTERY & POWER ─────────────────────────────────────────────
        /how much battery (left|do I have)/i,
        /is my (laptop|mac) charging/i,
        /battery (percentage|percent|level)/i,
        /switch to (battery|power saver|performance) mode/i,

        // ── VOICE & INPUT ───────────────────────────────────────────────
        /type (.+)/i,
        /paste (.+)/i,
        /copy (this|that|selection)/i,
        /select all/i,
        /undo|redo/i,
        /scroll (up|down)/i,

        // ── BROWSER-SPECIFIC ───────────────────────────────────────────
        /open (new tab|new window|incognito|private window)/i,
        /go to (url|site|website) (.+)/i,
        /bookmark this/i,
        /clear (browser history|cache|cookies)/i,

        // ── MISC USER COMMANDS ──────────────────────────────────────────
        /what time is it/i,
        /what'?s? the (date|day|weather)/i,
        /tell me a joke/i,
        /flip a coin/i,
        /roll a dice/i,
        /show me the (clipboard|last screenshot)/i,
        /print this/i,
        /save (this|page|file)/i
      ];
      
      const isLikelyCommand = commandPatterns.some(pattern => pattern.test(lowerMessage));
      
      if (isLikelyCommand) {
        console.log(`🔄 [NODE:PARSE_INTENT] Smart fallback: "${finalIntent}" (${finalConfidence.toFixed(2)}) → "command" (system query detected)`);
        finalIntent = 'command';
        finalConfidence = 0.75; // Boost confidence for command
      }
    }

    return {
      ...state,
      intent: {
        type: finalIntent,
        confidence: finalConfidence,
        entities: intentData.entities || [],
        requiresMemory: intentData.requiresMemory || false,
        suggestedResponse: intentData.suggestedResponse // Pass through for memory_store
      }
    };
  } catch (error) {
    console.error(' [NODE:PARSE_INTENT] Failed:', error.message);
    throw error;
  }
};
