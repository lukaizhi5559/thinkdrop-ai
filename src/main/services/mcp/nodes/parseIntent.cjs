/**
 * Parse Intent Node
 * Extracts intent and entities from user message via phi4 service
 */

const logger = require('./../../../logger.cjs');
module.exports = async function parseIntent(state) {
  const { mcpClient, message, resolvedMessage, context, conversationMessages } = state;

  // CRITICAL: Use ORIGINAL message for intent parsing, not resolved
  // Coreference resolution can break screen intelligence detection by replacing "this" with wrong referents
  // Example: "summarize this bible chapter" → "summarize AI bible chapter" (wrong!)
  const messageToClassify = message;
  
  logger.debug(' [NODE:PARSE_INTENT] Parsing intent...');
  if (resolvedMessage && resolvedMessage !== message) {
    logger.debug(`📝 [NODE:PARSE_INTENT] Coreference resolved: "${message}" → "${resolvedMessage}" (using original for intent)`);
  }

  // Check if highlighted text is present (from metadata)
  const hasHighlightedText = context?.metadata?.hasHighlightedText === true;
  if (hasHighlightedText) {
    logger.debug('📎 [NODE:PARSE_INTENT] Highlighted text detected - will skip screen_intelligence classification');
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
    
    logger.debug(`📚 [NODE:PARSE_INTENT] Including ${recentMessages.length} recent messages for context`);
  } catch (error) {
    logger.warn('⚠️ [NODE:PARSE_INTENT] Failed to fetch conversation history:', error.message);
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
      /respond to (this|the|that) .* on (my|the) screen/i,
      // Vague "this/that" references that likely refer to screen content
      /^(summarize|explain|translate|analyze|describe|read|extract|what (is|does|'?s?)|tell me about) (this|that|the)/i,
      /(draft|write|compose|create|put together) (a |an )?(response|reply|answer|message) (to |for )?(this|that|the)/i,
      // Queries about specific visible items (code, snippets, functions, etc.)
      /what'?s? (the|that)? ?\w+ (code|snippet|function|method|class|variable|line|section)/i,
      /(show|find|get|read|explain) (the|that)? ?\w+ (code|snippet|function|method|class|variable)/i
    ];
    
    // Check for follow-up screen queries (when previous message was a screen query)
    let isFollowUpScreenQuery = false;
    if (recentMessages.length >= 2) {
      // Check if previous user message was a screen query
      const prevUserMsg = recentMessages[recentMessages.length - 2];
      if (prevUserMsg && prevUserMsg.role === 'user') {
        const wasPrevScreenQuery = screenAnalysisPatterns.some(pattern => pattern.test(prevUserMsg.content));
        
        if (wasPrevScreenQuery) {
          // Specific follow-up phrases
          if (/^(what about now|how about now|and now)$/i.test(lowerMsg)) {
            isFollowUpScreenQuery = true;
          }
          // Follow-up questions with "this/that" reference
          else if (/(this|that|the screen|my screen|it)\b/i.test(lowerMsg)) {
            // Phrases like "anything else about this", "more about that", "details on this"
            const isFollowUpPhrase = /^(anything|something|what|more|tell me|show me|explain|details|info|information).*(about|on|for|regarding|concerning).*(this|that|the|it)/i.test(lowerMsg);
            if (isFollowUpPhrase) {
              logger.debug(`🔗 [NODE:PARSE_INTENT] Detected follow-up with "this/that" reference after screen query: "${lowerMsg}"`);
              isFollowUpScreenQuery = true;
            }
          }
          // Vague follow-up questions that should maintain screen context
          if (!isFollowUpScreenQuery && /^(what|how|can you|could you|do you|did you|show|tell|explain|describe|read|extract|find|get|give|list|count)/i.test(lowerMsg)) {
            // Only if message is short (≤10 words) and doesn't explicitly request web search or memory
            const wordCount = messageToClassify.split(/\s+/).length;
            const isWebSearchRequest = /search|google|look up|find online|web/i.test(lowerMsg);
            const isMemoryRequest = /remember|memory|recall|stored|saved/i.test(lowerMsg);
            
            if (wordCount <= 10 && !isWebSearchRequest && !isMemoryRequest) {
              logger.debug(`🔗 [NODE:PARSE_INTENT] Detected vague follow-up after screen query: "${lowerMsg}" (${wordCount} words)`);
              isFollowUpScreenQuery = true;
            }
          }
        }
      }
    }
    
    // Pre-check for screen analysis queries (only if NO highlighted text)
    // If highlighted text is present, we'll use the marker to let phi4 handle it
    const isScreenAnalysisQuery = screenAnalysisPatterns.some(pattern => pattern.test(lowerMsg)) || isFollowUpScreenQuery;
    
    if (isScreenAnalysisQuery && !hasHighlightedText) {
      logger.debug('🎯 [NODE:PARSE_INTENT] Pre-check: Detected screen analysis query, routing to screen_intelligence (vision fallback)');
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
    
    // ═══════════════════════════════════════════════════════════
    // CRITICAL PRE-CHECKS (Only keep patterns that DistilBERT struggles with)
    // ═══════════════════════════════════════════════════════════
    
    // CRITICAL: Catch "goto X and do a Y search" patterns BEFORE DistilBERT
    // These contain "search" keywords that confuse the classifier
    // Match: "goto", "go to", "go online", "navigate to", etc.
    if (/^(goto|go\s+(to|online|on)|navigate to|visit|browse to|head to|open up)\s+/i.test(lowerMsg)) {
      logger.debug('🔄 [NODE:PARSE_INTENT] Pre-check: Detected GOTO/navigation command, forcing command_execute intent');
      return {
        ...state,
        intent: {
          type: 'command_execute',
          confidence: 0.95,
          entities: [],
          requiresMemoryAccess: false
        }
      };
    }
    
    // Imperative command verbs (open, close, etc.) - Keep for speed
    if (/^(open|launch|start|run|close|quit|exit|kill|stop)\s+/i.test(lowerMsg)) {
      logger.debug('🔄 [NODE:PARSE_INTENT] Pre-check: Detected imperative command verb, forcing command_execute intent');
      return {
        ...state,
        intent: {
          type: 'command_execute',
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
        logger.debug(`🔗 [NODE:PARSE_INTENT] Enhanced short message (${wordCount} words) with context for better classification`);
      }
    }
    
    // Add marker to message if highlighted text is present
    const messageWithMarker = hasHighlightedText 
      ? `[HIGHLIGHTED_TEXT] ${enhancedMessage}`
      : enhancedMessage;
    
    const result = await mcpClient.callService('phi4', 'intent.parse', {
      message: messageWithMarker,
      context: {
        sessionId: context.sessionId,
        userId: context.userId,
        conversationHistory: recentMessages // Add conversation history for context-aware classification
      }
    });

    // MCP protocol wraps response in 'data' field
    const intentData = result.data || result;
    
    const finalIntent = intentData.intent || 'general_query';
    const finalConfidence = intentData.confidence || 0.5;
    
    // ═══════════════════════════════════════════════════════════
    // TRUST DISTILBERT - No regex overrides
    // ═══════════════════════════════════════════════════════════
    // The ML model is trained on thousands of examples and should be trusted.
    // Regex patterns create false positives and prevent the model from learning.
    // If DistilBERT misclassifies, add more training examples instead of regex hacks.
    
    logger.debug(`✅ [NODE:PARSE_INTENT] DistilBERT classified as: ${finalIntent} (confidence: ${finalConfidence.toFixed(2)})`);
    
    // Remove old smart fallback logic - it was causing more problems than it solved
    // Example issues:
    // - "How do I install Node.js?" → Incorrectly forced to command_execute
    // - "What's my IP address?" → Correctly web_search, but fallback forced to command
    // 
    // If you see misclassifications, add them to DistilBERT training data instead:
    // File: mcp-services/thinkdrop-phi4-service/src/parsers/DistilBertIntentParser.cjs
    
    /* REMOVED: Smart fallback with 100+ regex patterns
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
        
        // ── GOTO and NAVIGATION (browser/app navigation) ─────────────────
        /^(goto|go to|navigate to|visit|browse to|head to|open up)\s+(google|amazon|youtube|facebook|twitter|linkedin|instagram|reddit|github|gmail|outlook|netflix|spotify|the website|the site)/i,
        /(goto|go to|navigate to|visit|browse to)\s+.+\s+and\s+(search|find|look|play|watch|check|browse|post|compose|create)/i,
        
        // ── SEARCH IN APP (app-specific searches) ────────────────────────
        /search (in |my |at my )?(gmail|outlook|slack|discord|notion|spotify|youtube|drive|dropbox|photos|calendar|email|inbox).*(for|about)/i,
        /(find|look for|search for).*(in|at) (gmail|outlook|slack|discord|notion|spotify|youtube|drive|dropbox|photos|calendar)/i,
        /do a search (in|at|on) (my )?(gmail|outlook|slack|discord|email|inbox)/i,
        
        // ── CALENDAR and REMINDER commands ───────────────────────────────
        /set (a )?reminder (in calendar |to |for )/i,
        /create (a )?reminder (in calendar |to |for )/i,
        /add (a )?reminder (in calendar |to |for )/i,
        /set (a )?calendar reminder/i,
        /create (a )?calendar event/i,
        /add (to |an? )?event (to |in )?calendar/i,
        /schedule (a )?(meeting|appointment|event) (in calendar |for )/i,
        /set up (a )?calendar invite/i,
        /add to calendar/i,
        
        // ── TERMINAL commands (check, see, run in terminal) ──────────────
        /(see|check|look) (in |at )?the terminal (for |how much )/i,
        /run .+ in terminal/i,
        /execute .+ in terminal/i,
        /open terminal and (run|execute|check)/i,
        /launch terminal and (run|execute|check)/i,
        
        // ── DOCKER and CONTAINER commands ────────────────────────────────
        /run (the )?(docker|dockerfile|docker-compose|container)/i,
        /execute (the )?(docker|dockerfile|docker-compose)/i,
        /start (the )?(docker|container)/i,
        /docker (compose|run|build|ps|images|logs|stop|rm|restart|inspect)/i,
        
        // ── FILE execution and script running ────────────────────────────
        /run (the )?(python|bash|shell|node|javascript|typescript|ruby|perl|go|rust|java) (script|file|program)/i,
        /execute (the )?(python|bash|shell|node|javascript|typescript|ruby|perl|go|rust|java) (script|file|program)/i,
        /run (the )?(script|file|program|executable|binary|application|jar|test suite|build script)/i,
        /execute (the )?(script|file|program|executable|binary|application|jar|test suite|build script)/i,
        
        // ── APP + ACTION (open app and do something) ─────────────────────
        /open (slack|discord|spotify|chrome|safari|vscode|terminal|finder|mail|calendar|notes|photos|messages|settings|system preferences) and (message|go to|join|check|play|search|run|create|compose|find|text|change|adjust)/i,
        
        // ── FIND/SEARCH commands (local file search) ─────────────────────
        /find (all )?(pdfs?|text files?|images?|videos?|files?|folders?|documents?)/i,
        /search for (pdfs?|text files?|images?|videos?|files?|folders?|documents?)/i,
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
      ... (100+ more patterns)
    */
    
    // REMOVED: Semantic context mismatch detector
    // This was also using regex heuristics instead of trusting the ML model
    // The screenIntelligence node already has proper context relevance scoring

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
    logger.error(' [NODE:PARSE_INTENT] Failed:', error.message);
    throw error;
  }
};
