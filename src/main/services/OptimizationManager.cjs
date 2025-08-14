/**
 * OptimizationManager - Coordinates all Phase 1 performance optimizations
 * Manages model caching, query caching, and performance monitoring
 */

const { modelCache } = require('./ModelCache.cjs');
const { queryCache } = require('./QueryCache.cjs');

class OptimizationManager {
  constructor() {
    this.initialized = false;
    this.startTime = Date.now();
    this.performanceMetrics = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      modelInitTime: 0
    };
  }

  /**
   * Initialize all optimization systems
   */
  async initialize() {
    if (this.initialized) {
      console.log('[OPT-MGR] Already initialized');
      return;
    }

    console.log('🚀 [OPT-MGR] Initializing performance optimizations...');
    const startTime = Date.now();

    try {
      // Warm up critical models in background
      console.log('[OPT-MGR] Starting model warmup...');
      await this.warmupModels();

      // Initialize performance monitoring
      this.startPerformanceMonitoring();

      this.initialized = true;
      const initTime = Date.now() - startTime;
      this.performanceMetrics.modelInitTime = initTime;
      
      console.log(`✅ [OPT-MGR] Optimization systems ready in ${initTime}ms`);
      
    } catch (error) {
      console.error('[OPT-MGR] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Warm up critical models to eliminate first-query delay
   */
  async warmupModels() {
    try {
      // Start warmup in background - don't block initialization
      modelCache.warmUpModels().catch(error => {
        console.warn('[OPT-MGR] Model warmup failed (non-critical):', error.message);
      });
      
      console.log('[OPT-MGR] Model warmup started in background');
      
    } catch (error) {
      console.warn('[OPT-MGR] Model warmup error (non-critical):', error.message);
    }
  }

  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    // Monitor cache performance every 30 seconds
    setInterval(() => {
      this.logPerformanceMetrics();
    }, 30000);

    console.log('[OPT-MGR] Performance monitoring started');
  }

  /**
   * Log current performance metrics
   */
  logPerformanceMetrics() {
    try {
      const modelStats = modelCache.getStats();
      const cacheStats = queryCache.getStats();
      
      console.log('📊 [PERFORMANCE-METRICS]', {
        uptime: `${Math.round((Date.now() - this.startTime) / 1000)}s`,
        modelCache: {
          hitRate: `${(modelStats.hitRate * 100).toFixed(1)}%`,
          modelsLoaded: Object.values(modelStats.modelsLoaded).filter(Boolean).length
        },
        queryCache: {
          hitRates: cacheStats.hitRates,
          totalSize: Object.values(cacheStats.sizes).reduce((a, b) => a + b, 0)
        }
      });
      
    } catch (error) {
      console.warn('[OPT-MGR] Metrics logging error:', error.message);
    }
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport() {
    const modelStats = modelCache.getStats();
    const cacheStats = queryCache.getStats();
    
    return {
      optimizationManager: {
        initialized: this.initialized,
        uptime: Date.now() - this.startTime,
        modelInitTime: this.performanceMetrics.modelInitTime
      },
      modelCache: modelStats,
      queryCache: cacheStats,
      recommendations: this.generateRecommendations(modelStats, cacheStats)
    };
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations(modelStats, cacheStats) {
    const recommendations = [];
    
    // Model cache recommendations
    if (modelStats.hitRate < 0.5) {
      recommendations.push('Consider pre-warming more models to improve hit rate');
    }
    
    // Query cache recommendations
    const avgHitRate = Object.values(cacheStats.hitRates)
      .map(rate => parseFloat(rate))
      .reduce((a, b) => a + b, 0) / Object.keys(cacheStats.hitRates).length;
    
    if (avgHitRate < 30) {
      recommendations.push('Query cache hit rate is low - consider increasing TTL');
    }
    
    if (avgHitRate > 80) {
      recommendations.push('Excellent cache performance! Consider expanding cache size');
    }
    
    return recommendations;
  }

  /**
   * Clear all caches (for testing/debugging)
   */
  clearAllCaches() {
    console.log('[OPT-MGR] Clearing all caches...');
    modelCache.clearCache();
    queryCache.clearAll();
    console.log('[OPT-MGR] All caches cleared');
  }

  /**
   * Shutdown optimization systems
   */
  shutdown() {
    console.log('[OPT-MGR] Shutting down optimization systems...');
    queryCache.destroy();
    this.initialized = false;
    console.log('[OPT-MGR] Shutdown complete');
  }
}

// Export singleton instance
const optimizationManager = new OptimizationManager();

module.exports = {
  OptimizationManager,
  optimizationManager
};
