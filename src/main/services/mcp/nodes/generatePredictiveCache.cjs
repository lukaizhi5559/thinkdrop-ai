/**
 * Generate Predictive Cache Node - Anticipate follow-up questions
 * 
 * Runs AFTER screen analysis to generate predicted Q&A pairs
 * Uses local LLM (phi4) to extract topics and generate related questions
 * 
 * This enables instant answers for common follow-up questions without web searches
 */

const crypto = require('crypto');

const logger = require('./../../../logger.cjs');
/**
 * Hash screen content for cache key
 * @param {string} text - Screen content text
 * @returns {string} MD5 hash
 */
function hashScreenContent(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

module.exports = async function generatePredictiveCache(state) {
  const { screenIntelligenceResult, mcpClient, message } = state;
  
  logger.debug('🔮 [NODE:PREDICTIVE_CACHE] Starting predictive Q&A generation...');
  
  // Extract OCR text from screen analysis
  const fullTextElement = screenIntelligenceResult?.elements?.find(
    el => el.role === 'full_text_content'
  );
  const ocrText = fullTextElement?.value || '';
  
  if (!ocrText || ocrText.length < 100) {
    logger.debug('⏭️  [NODE:PREDICTIVE_CACHE] Insufficient text for prediction (need 100+ chars)');
    logger.debug(`   OCR text length: ${ocrText.length} chars`);
    return state;
  }
  
  logger.debug(`📝 [NODE:PREDICTIVE_CACHE] OCR text available: ${ocrText.length} chars`);
  
  // Check if we already have predictions for this screen content
  const screenHash = hashScreenContent(ocrText);
  
  if (!global.predictiveCache) {
    global.predictiveCache = new Map();
    logger.debug('🆕 [NODE:PREDICTIVE_CACHE] Initialized global predictive cache');
  }
  
  // Check if we already have fresh predictions
  const existingCache = global.predictiveCache.get(screenHash);
  if (existingCache && Date.now() - existingCache.timestamp < 300000) {
    const age = Math.round((Date.now() - existingCache.timestamp) / 1000);
    logger.debug(`✅ [NODE:PREDICTIVE_CACHE] Using existing predictions (${age}s old)`);
    logger.debug(`   Cached questions: ${existingCache.predictions.predictedQuestions.length}`);
    return state;
  }
  
  try {
    const startTime = Date.now();
    
    // Prepare prompt for LLM
    const prompt = `Analyze this screen content and generate 5-7 likely follow-up questions a user might ask, along with answers from your knowledge.

Screen Content:
${ocrText.substring(0, 2000)}

For each question:
1. Identify the category (e.g., "AI:History", "Technology:Comparison", "Programming:Concepts")
2. Generate a natural question a user might ask
3. Provide a concise answer (2-3 sentences) from your training knowledge
4. Indicate if the answer relates to the screen content or is general knowledge
5. Provide a confidence score (0.0-1.0)

IMPORTANT: Return ONLY valid JSON, no markdown formatting or code blocks.

Format:
{
  "mainTopic": "Brief description of screen content topic",
  "predictedQuestions": [
    {
      "category": "Topic:Subcategory",
      "question": "Natural question text",
      "answer": "Concise 2-3 sentence answer",
      "relatedToScreen": true,
      "confidence": 0.9
    }
  ]
}`;

    logger.debug('🤖 [NODE:PREDICTIVE_CACHE] Calling phi4 for prediction generation...');
    logger.debug(`   Prompt length: ${prompt.length} chars`);
    
    const result = await mcpClient.callService('phi4', 'chat.completions', {
      messages: [
        { 
          role: 'system', 
          content: 'You are a predictive assistant that anticipates user questions. Always respond with valid JSON only, no markdown formatting.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3, // Lower temperature for more focused predictions
      max_tokens: 2000
    });
    
    const generationTime = Date.now() - startTime;
    logger.debug(`⏱️  [NODE:PREDICTIVE_CACHE] LLM generation complete (${generationTime}ms)`);
    
    // Extract response
    const responseText = result.data?.choices?.[0]?.message?.content || 
                        result.choices?.[0]?.message?.content || '';
    
    logger.debug('📄 [NODE:PREDICTIVE_CACHE] Raw LLM response:');
    logger.debug('=' .repeat(80));
    logger.debug(responseText);
    logger.debug('=' .repeat(80));
    
    // Parse JSON response (handle markdown code blocks if present)
    let predictions;
    try {
      // Remove markdown code blocks if present
      const cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      predictions = JSON.parse(cleanedResponse);
      logger.debug('✅ [NODE:PREDICTIVE_CACHE] Successfully parsed predictions');
    } catch (parseError) {
      logger.error('❌ [NODE:PREDICTIVE_CACHE] Failed to parse JSON:', parseError.message);
      logger.debug('   Attempted to parse:', responseText.substring(0, 200));
      return state;
    }
    
    // Validate predictions structure
    if (!predictions.predictedQuestions || !Array.isArray(predictions.predictedQuestions)) {
      logger.warn('⚠️  [NODE:PREDICTIVE_CACHE] Invalid predictions structure');
      return state;
    }
    
    // Store in global cache
    global.predictiveCache.set(screenHash, {
      predictions,
      timestamp: Date.now(),
      screenContentHash: screenHash,
      ocrTextLength: ocrText.length
    });
    
    logger.debug('✅ [NODE:PREDICTIVE_CACHE] Predictions cached successfully');
    logger.debug(`   Main topic: "${predictions.mainTopic}"`);
    logger.debug(`   Generated ${predictions.predictedQuestions.length} predicted Q&A pairs:`);
    
    // Log each predicted question for debugging
    predictions.predictedQuestions.forEach((pred, idx) => {
      logger.debug(`   ${idx + 1}. [${pred.category}] "${pred.question}"`);
      logger.debug(`      Answer: "${pred.answer.substring(0, 80)}..."`);
      logger.debug(`      Confidence: ${pred.confidence}, Related to screen: ${pred.relatedToScreen}`);
    });
    
    // Add to state for potential immediate use
    state.predictiveCache = {
      predictions,
      screenHash
    };
    
    return state;
    
  } catch (error) {
    logger.error('❌ [NODE:PREDICTIVE_CACHE] Failed to generate predictions:', error.message);
    logger.error('   Stack:', error.stack);
    return state;
  }
};
