/**
 * MathUtils - Centralized mathematical utility functions
 * 
 * Provides shared mathematical operations used across the semantic search system
 * to eliminate code duplication and ensure consistency.
 */

class MathUtils {
  /**
   * Calculate cosine similarity between two vectors
   * @param {number[]} vecA - First vector
   * @param {number[]} vecB - Second vector
   * @returns {number} - Cosine similarity score between -1 and 1
   */
  static calculateCosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }
    
    if (vecA.length === 0) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Calculate dot product between two vectors
   * @param {number[]} vecA - First vector
   * @param {number[]} vecB - Second vector
   * @returns {number} - Dot product
   */
  static dotProduct(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }
    
    let result = 0;
    for (let i = 0; i < vecA.length; i++) {
      result += vecA[i] * vecB[i];
    }
    
    return result;
  }

  /**
   * Calculate vector magnitude (L2 norm)
   * @param {number[]} vec - Vector
   * @returns {number} - Magnitude
   */
  static magnitude(vec) {
    if (!vec || vec.length === 0) {
      return 0;
    }
    
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
      sum += vec[i] * vec[i];
    }
    
    return Math.sqrt(sum);
  }

  /**
   * Normalize a vector to unit length
   * @param {number[]} vec - Vector to normalize
   * @returns {number[]} - Normalized vector
   */
  static normalize(vec) {
    if (!vec || vec.length === 0) {
      return [];
    }
    
    const mag = this.magnitude(vec);
    if (mag === 0) {
      return vec.slice(); // Return copy of zero vector
    }
    
    return vec.map(val => val / mag);
  }

  /**
   * Calculate Euclidean distance between two vectors
   * @param {number[]} vecA - First vector
   * @param {number[]} vecB - Second vector
   * @returns {number} - Euclidean distance
   */
  static euclideanDistance(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return Infinity;
    }
    
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      const diff = vecA[i] - vecB[i];
      sum += diff * diff;
    }
    
    return Math.sqrt(sum);
  }

  /**
   * Calculate Manhattan distance between two vectors
   * @param {number[]} vecA - First vector
   * @param {number[]} vecB - Second vector
   * @returns {number} - Manhattan distance
   */
  static manhattanDistance(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return Infinity;
    }
    
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      sum += Math.abs(vecA[i] - vecB[i]);
    }
    
    return sum;
  }

  /**
   * Clamp a value between min and max
   * @param {number} value - Value to clamp
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number} - Clamped value
   */
  static clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Linear interpolation between two values
   * @param {number} a - Start value
   * @param {number} b - End value
   * @param {number} t - Interpolation factor (0-1)
   * @returns {number} - Interpolated value
   */
  static lerp(a, b, t) {
    return a + (b - a) * this.clamp(t, 0, 1);
  }

  /**
   * Calculate weighted average of similarity scores
   * @param {Array<{score: number, weight: number}>} scores - Array of score objects
   * @returns {number} - Weighted average
   */
  static weightedAverage(scores) {
    if (!scores || scores.length === 0) {
      return 0;
    }
    
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (const item of scores) {
      if (typeof item.score === 'number' && typeof item.weight === 'number') {
        weightedSum += item.score * item.weight;
        totalWeight += item.weight;
      }
    }
    
    return totalWeight === 0 ? 0 : weightedSum / totalWeight;
  }
}

module.exports = {
  MathUtils
};
