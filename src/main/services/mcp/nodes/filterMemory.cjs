/**
 * Filter Memory Node
 * Filters out low-similarity memories to prevent hallucinations
 */

const SIMILARITY_THRESHOLD = 0.7; // Only use memories with >70% similarity

module.exports = async function filterMemory(state) {
  const { memories = [] } = state;

  console.log(`🔍 [NODE:FILTER_MEMORY] Filtering ${memories.length} memories (threshold: ${SIMILARITY_THRESHOLD})`);

  // Filter by similarity threshold
  const filteredMemories = memories.filter(mem => mem.similarity >= SIMILARITY_THRESHOLD);

  const filtered = memories.length - filteredMemories.length;
  if (filtered > 0) {
    console.log(`⚠️ [NODE:FILTER_MEMORY] Filtered out ${filtered} low-similarity memories`);
    console.log(`📊 [NODE:FILTER_MEMORY] Filtered memories:`, 
      memories
        .filter(m => m.similarity < SIMILARITY_THRESHOLD)
        .map(m => `"${m.text.substring(0, 50)}..." (${(m.similarity * 100).toFixed(1)}%)`)
    );
  }

  console.log(`✅ [NODE:FILTER_MEMORY] Using ${filteredMemories.length} high-quality memories`);

  return {
    ...state,
    filteredMemories,
    memoriesFiltered: filtered
  };
};
