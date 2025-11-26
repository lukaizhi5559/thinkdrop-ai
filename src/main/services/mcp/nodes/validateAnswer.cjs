/**
 * Validate Answer Node
 * Checks for hallucinations and other quality issues
 */

const logger = require('./../../../logger.cjs');
module.exports = async function validateAnswer(state) {
  const { answer, filteredMemories = [], conversationHistory = [], intent } = state;

  logger.debug('🔍 [NODE:VALIDATE_ANSWER] Validating answer quality...');

  const issues = [];

  // Check 1: Negative inference hallucination
  // Look for phrases like "don't", "doesn't", "not", "never" in answer
  const negativePatterns = /\b(don't|doesn't|do not|does not|not|never|no)\b/gi;
  const hasNegatives = negativePatterns.test(answer);

  if (hasNegatives) {
    // Check if these negatives are supported by memories or conversation
    const allContext = [
      ...filteredMemories.map(m => m.text),
      ...conversationHistory.map(m => m.content)
    ].join(' ');

    const negativeMatches = answer.match(negativePatterns) || [];
    const unsupportedNegatives = negativeMatches.filter(neg => {
      // Check if this negative appears in context
      return !allContext.toLowerCase().includes(neg.toLowerCase());
    });

    if (unsupportedNegatives.length > 0) {
      issues.push({
        type: 'unsupported_negative',
        severity: 'high',
        message: `Answer contains unsupported negative statements: ${unsupportedNegatives.join(', ')}`,
        suggestion: 'Regenerate without making negative inferences'
      });
      logger.warn(`⚠️ [NODE:VALIDATE_ANSWER] Unsupported negatives detected: ${unsupportedNegatives.join(', ')}`);
    }
  }

  // Check 2: Empty or very short answer
  if (!answer || answer.trim().length < 10) {
    issues.push({
      type: 'empty_answer',
      severity: 'high',
      message: 'Answer is empty or too short',
      suggestion: 'Regenerate with more context'
    });
    logger.warn('⚠️ [NODE:VALIDATE_ANSWER] Answer is too short');
  }

  // Check 3: Web search request detection
  // Only check if we don't already have web results (prevents duplicate search)
  const hasWebResults = state.contextDocs && state.contextDocs.length > 0;
  const webSearchTriggers = [
    /I need to search online/i,
    /I'll search online/i,
    /Let me search online/i,
    /I'll look that up/i,
    /Let me look that up/i
  ];
  const needsWebSearch = !hasWebResults && webSearchTriggers.some(pattern => pattern.test(answer));
  
  if (needsWebSearch) {
    issues.push({
      type: 'needs_web_search',
      severity: 'high',
      message: 'LLM requested web search for factual information',
      suggestion: 'Perform web search and retry with results'
    });
    logger.debug('🔍 [NODE:VALIDATE_ANSWER] LLM requested web search, will trigger webSearch node');
  }

  // Check 4: Generic fallback responses (might indicate confusion)
  const genericPatterns = [
    /^(I understand|I see|Okay|Alright|Sure)\./i,
    /^I apologize/i,
    /^I don't have that information/i
  ];

  const isGeneric = genericPatterns.some(pattern => pattern.test(answer.trim()));
  if (isGeneric && filteredMemories.length > 0) {
    issues.push({
      type: 'generic_response',
      severity: 'medium',
      message: 'Answer is generic despite having relevant memories',
      suggestion: 'Consider using more specific context'
    });
    logger.warn('⚠️ [NODE:VALIDATE_ANSWER] Generic response despite available context');
  }

  // Check 5: Fallback for general_knowledge intents with "I don't have that information"
  // This catches cases where the LLM should have used the web search trigger but didn't
  const isFactualQuery = intent?.type === 'general_knowledge';
  const saysNoInfo = /I don't have that information/i.test(answer);
  const noWebResults = !state.contextDocs || state.contextDocs.length === 0;
  
  if (isFactualQuery && saysNoInfo && noWebResults) {
    logger.debug('🔍 [NODE:VALIDATE_ANSWER] Detected "I don\'t have that information" for general_knowledge query - triggering web search');
    issues.push({
      type: 'needs_web_search',
      severity: 'high',
      message: 'LLM indicated no information for factual query - should search online',
      suggestion: 'Perform web search and retry with results'
    });
  }

  // Determine if retry is needed
  const needsRetry = issues.some(issue => issue.severity === 'high');
  const shouldPerformWebSearch = (needsWebSearch || (isFactualQuery && saysNoInfo)) && noWebResults;

  if (issues.length > 0) {
    logger.debug(`⚠️ [NODE:VALIDATE_ANSWER] Found ${issues.length} issues (retry: ${needsRetry})`);
    issues.forEach(issue => {
      logger.debug(`   - [${issue.severity.toUpperCase()}] ${issue.message}`);
    });
  } else {
    logger.debug('✅ [NODE:VALIDATE_ANSWER] Answer quality looks good');
  }

  // Increment retry count if we're going to retry OR perform web search
  // This prevents double streaming when we route back to answer node
  const willRetry = needsRetry || shouldPerformWebSearch;

  return {
    ...state,
    validationIssues: issues,
    needsRetry,
    shouldPerformWebSearch, // Flag to trigger web search before retry
    retryCount: (state.retryCount || 0) + (willRetry ? 1 : 0)
  };
};
