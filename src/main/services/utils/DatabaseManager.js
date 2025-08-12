/**
 * DatabaseManager - Singleton pattern for centralized DuckDB connection management
 * Uses CommonJS wrapper for ES module compatibility
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const dbWrapper = require('./duckdb-wrapper.cjs');

class DatabaseManager {
  constructor() {
    this.isInitialized = false;
    this.dbPath = null;
    this.backupInterval = null;
    this.healthCheckInterval = null;
    this.walCheckpointInterval = null;
    this.metricsInterval = null;
    this.lastBackupTime = null;
    this.corruptionDetected = false;
    
    // Connection pooling
    this.connectionPool = [];
    this.maxConnections = 5;
    this.activeConnections = 0;
    this.connectionQueue = [];
    
    // Metrics collection
    this.metrics = {
      totalQueries: 0,
      totalErrors: 0,
      avgQueryTime: 0,
      lastQueryTime: null,
      connectionFailures: 0,
      recoveryAttempts: 0,
      backupCount: 0,
      corruptionEvents: 0,
      queryTimes: [],
      startTime: new Date()
    };
    
    // User notification callbacks
    this.notificationCallbacks = [];
  }

  /**
   * Initialize database connection via CommonJS wrapper
   * @param {string} dbPath - Path to the database file (optional, wrapper uses default)
   * @returns {Promise<Object>} - Wrapper object with query/run methods
   */
  async initialize(dbPath) {
    this.dbPath = dbPath;
    
    // Check for corruption before connecting
    const corruptionCheck = await this.detectCorruption(dbPath);
    if (corruptionCheck.isCorrupted) {
      console.warn('⚠️ DatabaseManager: Corruption detected, attempting recovery...');
      await this.handleCorruption(dbPath, corruptionCheck);
    }
    
    return new Promise((resolve, reject) => {
      dbWrapper.connect(dbPath, async (err, result) => {
        if (err) {
          console.error('❌ DatabaseManager: Wrapper connection failed:', err);
          
          // Attempt recovery if connection fails
          const recoveryResult = await this.attemptRecovery(dbPath, err);
          if (recoveryResult.success) {
            // Retry connection after recovery
            dbWrapper.connect(dbPath, (retryErr, retryResult) => {
              if (retryErr) {
                reject(retryErr);
                return;
              }
              this.isInitialized = true;
              this.initializeConnectionPool();
              this.startHealthMonitoring();
              this.startWALCheckpoints();
              this.startMetricsCollection();
              resolve(dbWrapper);
            });
          } else {
            reject(err);
          }
          return;
        }
        
        this.isInitialized = true;
        this.initializeConnectionPool();
        this.startHealthMonitoring();
        this.startWALCheckpoints();
        this.startMetricsCollection();
        resolve(dbWrapper); // Return the wrapper itself
      });
    });
  }

  /**
   * Get the wrapper object for database operations
   * @returns {Object} - dbWrapper with query/run methods
   */
  getConnection() {
    if (!this.isInitialized) {
      throw new Error('DatabaseManager not initialized. Call initialize() first.');
    }
    return dbWrapper;
  }

  /**
   * Check if connection is valid via wrapper
   * @returns {Promise<boolean>}
   */
  async isConnectionValid() {
    if (!this.isInitialized) {
      return false;
    }
    
    return dbWrapper.isConnected();
  }

  /**
   * Reconnect via wrapper
   * @returns {Promise<Object>}
   */
  async reconnect() {
    console.log('🔄 DatabaseManager: Reconnecting via wrapper...');
    
    // Close existing connection
    await this.cleanup();
    
    // Reinitialize
    return await this.initialize();
  }

  /**
   * Ensure connection is valid, reconnect if needed
   * @returns {Promise<Object>}
   */
  async ensureConnection() {
    if (!this.isInitialized) {
      return await this.initialize();
    }

    const isValid = await this.isConnectionValid();
    if (!isValid) {
      return await this.reconnect();
    }

    return dbWrapper;
  }

  /**
   * Clean up connections via wrapper
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Stop all monitoring services
    this.stopHealthMonitoring();
    this.stopWALCheckpoints();
    this.stopMetricsCollection();
    
    // Clean up connection pool
    this.connectionPool = [];
    this.activeConnections = 0;
    this.connectionQueue = [];
    
    return new Promise((resolve) => {
      if (this.isInitialized) {
        dbWrapper.close((err) => {
          if (err) {
            console.error('❌ DatabaseManager: Wrapper cleanup error:', err);
          } else {
            console.log('✅ DatabaseManager: Wrapper cleanup completed');
          }
          this.isInitialized = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Initialize connection pooling
   * @returns {void}
   */
  initializeConnectionPool() {
    console.log(`🔗 DatabaseManager: Initializing connection pool (max: ${this.maxConnections})`);
    // Connection pool is managed dynamically - no pre-allocation needed for DuckDB
  }

  /**
   * Get connection from pool or create new one
   * @returns {Promise<Object>} - Database connection
   */
  async getPooledConnection() {
    return new Promise((resolve, reject) => {
      // If we have available connections, use them
      if (this.activeConnections < this.maxConnections) {
        this.activeConnections++;
        resolve(dbWrapper);
        return;
      }

      // Queue the request if pool is full
      this.connectionQueue.push({ resolve, reject, timestamp: Date.now() });
      
      // Set timeout for queued requests
      setTimeout(() => {
        const queueIndex = this.connectionQueue.findIndex(req => req.resolve === resolve);
        if (queueIndex !== -1) {
          this.connectionQueue.splice(queueIndex, 1);
          reject(new Error('Connection pool timeout - too many concurrent operations'));
        }
      }, 10000); // 10 second timeout
    });
  }

  /**
   * Release connection back to pool
   * @returns {void}
   */
  releaseConnection() {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    
    // Process queued requests
    if (this.connectionQueue.length > 0 && this.activeConnections < this.maxConnections) {
      const nextRequest = this.connectionQueue.shift();
      this.activeConnections++;
      nextRequest.resolve(dbWrapper);
    }
  }

  /**
   * Add user notification callback
   * @param {Function} callback - Notification callback function
   * @returns {void}
   */
  addNotificationCallback(callback) {
    if (typeof callback === 'function') {
      this.notificationCallbacks.push(callback);
    }
  }

  /**
   * Remove user notification callback
   * @param {Function} callback - Callback to remove
   * @returns {void}
   */
  removeNotificationCallback(callback) {
    const index = this.notificationCallbacks.indexOf(callback);
    if (index > -1) {
      this.notificationCallbacks.splice(index, 1);
    }
  }

  /**
   * Send notification to users
   * @param {string} type - Notification type (info, warning, error, success)
   * @param {string} message - Notification message
   * @param {Object} details - Additional details
   * @returns {void}
   */
  notifyUsers(type, message, details = {}) {
    const notification = {
      type,
      message,
      details,
      timestamp: new Date().toISOString(),
      source: 'DatabaseManager'
    };

    console.log(`📢 DatabaseManager: ${type.toUpperCase()} - ${message}`);
    
    // Send to all registered callbacks
    this.notificationCallbacks.forEach(callback => {
      try {
        callback(notification);
      } catch (error) {
        console.error('❌ DatabaseManager: Notification callback failed:', error);
      }
    });
  }

  /**
   * Detect database corruption
   * @param {string} dbPath - Path to database file
   * @returns {Promise<Object>} - Corruption check result
   */
  async detectCorruption(dbPath) {
    if (!dbPath || !fs.existsSync(dbPath)) {
      return { isCorrupted: false, reason: 'file_not_exists' };
    }

    try {
      const stats = fs.statSync(dbPath);
      
      // Check for zero-byte file
      if (stats.size === 0) {
        return { isCorrupted: true, reason: 'zero_byte_file', severity: 'high' };
      }

      // Check for abnormally small file (less than 1KB for DuckDB)
      if (stats.size < 1024) {
        return { isCorrupted: true, reason: 'file_too_small', severity: 'medium' };
      }

      // Check for WAL file corruption indicators
      const walPath = `${dbPath}.wal`;
      if (fs.existsSync(walPath)) {
        const walStats = fs.statSync(walPath);
        // WAL file much larger than main file could indicate corruption
        if (walStats.size > stats.size * 2) {
          return { isCorrupted: true, reason: 'wal_size_anomaly', severity: 'medium' };
        }
      }

      return { isCorrupted: false, reason: 'healthy' };
    } catch (error) {
      console.error('🔍 DatabaseManager: Corruption detection error:', error);
      return { isCorrupted: true, reason: 'detection_error', severity: 'unknown', error };
    }
  }

  /**
   * Handle detected corruption
   * @param {string} dbPath - Path to database file
   * @param {Object} corruptionInfo - Corruption details
   * @returns {Promise<Object>} - Recovery result
   */
  async handleCorruption(dbPath, corruptionInfo) {
    console.log(`🚨 DatabaseManager: Handling corruption - ${corruptionInfo.reason}`);
    this.metrics.corruptionEvents++;
    this.metrics.recoveryAttempts++;
    
    // Notify users of corruption detection
    this.notifyUsers('warning', 'Database corruption detected, attempting automatic recovery...', {
      reason: corruptionInfo.reason,
      severity: corruptionInfo.severity
    });
    
    try {
      // Create backup of corrupted file for forensics
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const corruptedBackupPath = `${dbPath}.corrupted-${timestamp}`;
      
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, corruptedBackupPath);
        console.log(`📁 DatabaseManager: Corrupted file backed up to ${corruptedBackupPath}`);
      }

      // Attempt to restore from recent backup
      const restoreResult = await this.restoreFromBackup(dbPath);
      if (restoreResult.success) {
        console.log('✅ DatabaseManager: Successfully restored from backup');
        this.notifyUsers('success', 'Database successfully restored from backup', {
          backupFile: restoreResult.backupFile
        });
        return { success: true, method: 'backup_restore' };
      }

      // If no backup available, create fresh database
      console.log('🔄 DatabaseManager: No backup available, creating fresh database');
      await this.createFreshDatabase(dbPath);
      
      this.notifyUsers('info', 'Created fresh database - previous data may be lost', {
        corruptedBackup: corruptedBackupPath
      });
      
      return { success: true, method: 'fresh_database' };
    } catch (error) {
      console.error('❌ DatabaseManager: Corruption handling failed:', error);
      this.notifyUsers('error', 'Database recovery failed - manual intervention required', {
        error: error.message
      });
      return { success: false, error };
    }
  }

  /**
   * Attempt database recovery
   * @param {string} dbPath - Path to database file
   * @param {Error} originalError - Original connection error
   * @returns {Promise<Object>} - Recovery result
   */
  async attemptRecovery(dbPath, originalError) {
    console.log('🔧 DatabaseManager: Attempting database recovery...');
    
    try {
      // Check if error indicates corruption
      const errorMessage = originalError.message || '';
      const isCorruptionError = errorMessage.includes('FATAL') || 
                               errorMessage.includes('IO Error') ||
                               errorMessage.includes('Failed to rollback');

      if (isCorruptionError) {
        // Handle as corruption
        const corruptionInfo = { 
          isCorrupted: true, 
          reason: 'connection_error', 
          severity: 'high',
          originalError: errorMessage 
        };
        
        const recoveryResult = await this.handleCorruption(dbPath, corruptionInfo);
        return recoveryResult;
      }

      // For non-corruption errors, try simple reconnection
      console.log('🔄 DatabaseManager: Attempting simple reconnection...');
      return { success: false, reason: 'non_corruption_error' };
      
    } catch (error) {
      console.error('❌ DatabaseManager: Recovery attempt failed:', error);
      return { success: false, error };
    }
  }

  /**
   * Create fresh database
   * @param {string} dbPath - Path to database file
   * @returns {Promise<void>}
   */
  async createFreshDatabase(dbPath) {
    try {
      // Remove corrupted files
      const filesToRemove = [
        dbPath,
        `${dbPath}.wal`,
        `${dbPath}.tmp`
      ];

      for (const file of filesToRemove) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`🗑️ DatabaseManager: Removed ${file}`);
        }
      }

      console.log('✅ DatabaseManager: Fresh database environment prepared');
    } catch (error) {
      console.error('❌ DatabaseManager: Fresh database creation failed:', error);
      throw error;
    }
  }

  /**
   * Create database backup
   * @returns {Promise<Object>} - Backup result
   */
  async createBackup() {
    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      return { success: false, reason: 'no_database_file' };
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(path.dirname(this.dbPath), 'backups');
      
      // Ensure backup directory exists
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const backupPath = path.join(backupDir, `${path.basename(this.dbPath)}.backup-${timestamp}`);
      
      // Perform WAL checkpoint before backup
      try {
        await this.query('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (checkpointError) {
        console.warn('⚠️ DatabaseManager: WAL checkpoint failed before backup:', checkpointError.message);
      }

      // Copy database file
      fs.copyFileSync(this.dbPath, backupPath);
      
      this.lastBackupTime = new Date();
      this.metrics.backupCount++;
      console.log(`💾 DatabaseManager: Backup created at ${backupPath}`);
      
      // Notify users of successful backup
      this.notifyUsers('info', 'Database backup completed successfully', {
        backupPath,
        backupNumber: this.metrics.backupCount
      });
      
      // Clean up old backups (keep last 5)
      await this.cleanupOldBackups(backupDir, 5);
      
      return { success: true, backupPath, timestamp };
    } catch (error) {
      console.error('❌ DatabaseManager: Backup creation failed:', error);
      this.notifyUsers('warning', 'Database backup failed', {
        error: error.message
      });
      return { success: false, error };
    }
  }

  /**
   * Restore from most recent backup
   * @param {string} dbPath - Target database path
   * @returns {Promise<Object>} - Restore result
   */
  async restoreFromBackup(dbPath) {
    try {
      const backupDir = path.join(path.dirname(dbPath), 'backups');
      
      if (!fs.existsSync(backupDir)) {
        return { success: false, reason: 'no_backup_directory' };
      }

      // Find most recent backup
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.startsWith(path.basename(dbPath)) && file.includes('.backup-'))
        .sort()
        .reverse();

      if (backupFiles.length === 0) {
        return { success: false, reason: 'no_backups_found' };
      }

      const mostRecentBackup = path.join(backupDir, backupFiles[0]);
      
      // Remove corrupted database
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }

      // Restore from backup
      fs.copyFileSync(mostRecentBackup, dbPath);
      
      console.log(`🔄 DatabaseManager: Restored from backup ${mostRecentBackup}`);
      return { success: true, backupFile: mostRecentBackup };
    } catch (error) {
      console.error('❌ DatabaseManager: Backup restore failed:', error);
      return { success: false, error };
    }
  }

  /**
   * Clean up old backup files
   * @param {string} backupDir - Backup directory path
   * @param {number} keepCount - Number of backups to keep
   * @returns {Promise<void>}
   */
  async cleanupOldBackups(backupDir, keepCount = 5) {
    try {
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.includes('.backup-'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          mtime: fs.statSync(path.join(backupDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // Remove old backups beyond keepCount
      const filesToDelete = backupFiles.slice(keepCount);
      
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
        console.log(`🗑️ DatabaseManager: Removed old backup ${file.name}`);
      }
    } catch (error) {
      console.error('❌ DatabaseManager: Backup cleanup failed:', error);
    }
  }

  /**
   * Start health monitoring
   * @returns {void}
   */
  startHealthMonitoring() {
    // Health check every 5 minutes
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 5 * 60 * 1000);

    // Backup every 30 minutes
    this.backupInterval = setInterval(async () => {
      await this.createBackup();
    }, 30 * 60 * 1000);

    console.log('🔍 DatabaseManager: Health monitoring started');
  }

  /**
   * Stop health monitoring
   * @returns {void}
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }

    console.log('🛑 DatabaseManager: Health monitoring stopped');
  }

  /**
   * Start WAL checkpoint management (every 1-2 minutes)
   * @returns {void}
   */
  startWALCheckpoints() {
    // WAL checkpoint every 90 seconds (1.5 minutes)
    this.walCheckpointInterval = setInterval(async () => {
      await this.performWALCheckpoint();
    }, 90 * 1000);

    console.log('📝 DatabaseManager: WAL checkpoint management started (every 90 seconds)');
  }

  /**
   * Stop WAL checkpoint management
   * @returns {void}
   */
  stopWALCheckpoints() {
    if (this.walCheckpointInterval) {
      clearInterval(this.walCheckpointInterval);
      this.walCheckpointInterval = null;
    }

    console.log('🛑 DatabaseManager: WAL checkpoint management stopped');
  }

  /**
   * Perform WAL checkpoint
   * @returns {Promise<Object>} - Checkpoint result
   */
  async performWALCheckpoint() {
    try {
      const startTime = Date.now();
      await this.query('PRAGMA wal_checkpoint(PASSIVE)');
      const duration = Date.now() - startTime;
      
      console.log(`📝 DatabaseManager: WAL checkpoint completed in ${duration}ms`);
      
      // Update metrics
      this.updateMetrics('wal_checkpoint', duration);
      
      return { success: true, duration };
    } catch (error) {
      console.warn('⚠️ DatabaseManager: WAL checkpoint failed:', error.message);
      this.metrics.totalErrors++;
      return { success: false, error };
    }
  }

  /**
   * Start metrics collection
   * @returns {void}
   */
  startMetricsCollection() {
    // Collect and log metrics every 10 minutes
    this.metricsInterval = setInterval(() => {
      this.logMetrics();
    }, 10 * 60 * 1000);

    console.log('📊 DatabaseManager: Metrics collection started');
  }

  /**
   * Stop metrics collection
   * @returns {void}
   */
  stopMetricsCollection() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    console.log('🛑 DatabaseManager: Metrics collection stopped');
  }

  /**
   * Update metrics
   * @param {string} operation - Operation type
   * @param {number} duration - Operation duration in ms
   * @param {boolean} isError - Whether operation failed
   * @returns {void}
   */
  updateMetrics(operation, duration, isError = false) {
    this.metrics.totalQueries++;
    this.metrics.lastQueryTime = new Date();
    
    if (isError) {
      this.metrics.totalErrors++;
    }
    
    // Track query times for average calculation
    this.metrics.queryTimes.push(duration);
    
    // Keep only last 100 query times to prevent memory bloat
    if (this.metrics.queryTimes.length > 100) {
      this.metrics.queryTimes = this.metrics.queryTimes.slice(-100);
    }
    
    // Calculate rolling average
    this.metrics.avgQueryTime = this.metrics.queryTimes.reduce((a, b) => a + b, 0) / this.metrics.queryTimes.length;
  }

  /**
   * Get current metrics
   * @returns {Object} - Current metrics snapshot
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime.getTime();
    const queriesPerMinute = this.metrics.totalQueries / (uptime / 60000);
    const errorRate = this.metrics.totalQueries > 0 ? (this.metrics.totalErrors / this.metrics.totalQueries) * 100 : 0;
    
    return {
      ...this.metrics,
      uptime: Math.round(uptime / 1000), // seconds
      queriesPerMinute: Math.round(queriesPerMinute * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      activeConnections: this.activeConnections,
      queuedConnections: this.connectionQueue.length,
      avgQueryTime: Math.round(this.metrics.avgQueryTime * 100) / 100
    };
  }

  /**
   * Log current metrics
   * @returns {void}
   */
  logMetrics() {
    const metrics = this.getMetrics();
    
    console.log('📊 DatabaseManager Metrics:');
    console.log(`   Uptime: ${Math.floor(metrics.uptime / 3600)}h ${Math.floor((metrics.uptime % 3600) / 60)}m`);
    console.log(`   Total Queries: ${metrics.totalQueries}`);
    console.log(`   Queries/min: ${metrics.queriesPerMinute}`);
    console.log(`   Error Rate: ${metrics.errorRate}%`);
    console.log(`   Avg Query Time: ${metrics.avgQueryTime}ms`);
    console.log(`   Active Connections: ${metrics.activeConnections}/${this.maxConnections}`);
    console.log(`   Queued Connections: ${metrics.queuedConnections}`);
    console.log(`   Backups Created: ${metrics.backupCount}`);
    console.log(`   Recovery Attempts: ${metrics.recoveryAttempts}`);
    console.log(`   Corruption Events: ${metrics.corruptionEvents}`);
    
    // Send metrics notification if error rate is high
    if (metrics.errorRate > 10) {
      this.notifyUsers('warning', `High database error rate detected: ${metrics.errorRate}%`, {
        metrics: {
          errorRate: metrics.errorRate,
          totalErrors: metrics.totalErrors,
          totalQueries: metrics.totalQueries
        }
      });
    }
  }

  /**
   * Perform health check
   * @returns {Promise<Object>} - Health check result
   */
  async performHealthCheck() {
    try {
      // Test basic connectivity
      const isValid = await this.isConnectionValid();
      if (!isValid) {
        console.warn('⚠️ DatabaseManager: Health check failed - connection invalid');
        return { healthy: false, reason: 'connection_invalid' };
      }

      // Test simple query
      await this.query('SELECT 1 as health_check');
      
      // Check file integrity
      if (this.dbPath && fs.existsSync(this.dbPath)) {
        const corruptionCheck = await this.detectCorruption(this.dbPath);
        if (corruptionCheck.isCorrupted) {
          console.warn('⚠️ DatabaseManager: Health check detected corruption');
          this.corruptionDetected = true;
          return { healthy: false, reason: 'corruption_detected', details: corruptionCheck };
        }
      }

      // Reset corruption flag if healthy
      this.corruptionDetected = false;
      return { healthy: true };
    } catch (error) {
      console.error('❌ DatabaseManager: Health check failed:', error);
      return { healthy: false, reason: 'health_check_error', error };
    }
  }

  /**
   * Execute query via wrapper with retry logic, connection pooling, and metrics
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @param {Function} callback - Optional callback function
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<Array>} - Query results (if no callback) or void (if callback)
   */
  async query(sql, params = [], callback = null, retryCount = 0) {
    // Handle callback-style calls
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
    const startTime = Date.now();
    
    let connection = null;
    
    try {
      // Get connection from pool
      connection = await this.getPooledConnection();
      
      if (callback) {
        connection.query(sql, params, async (err, rows) => {
          const duration = Date.now() - startTime;
          this.releaseConnection();
          
          if (err && retryCount < maxRetries && this.shouldRetry(err)) {
            console.warn(`⚠️ DatabaseManager: Query failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            this.updateMetrics('query', duration, true);
            setTimeout(async () => {
              await this.query(sql, params, callback, retryCount + 1);
            }, retryDelay);
            return;
          }
          
          this.updateMetrics('query', duration, !!err);
          callback(err, rows);
        });
      } else {
        // Promise-style call
        return new Promise((resolve, reject) => {
          connection.query(sql, params, async (err, rows) => {
            const duration = Date.now() - startTime;
            this.releaseConnection();
            
            if (err) {
              if (retryCount < maxRetries && this.shouldRetry(err)) {
                console.warn(`⚠️ DatabaseManager: Query failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
                this.updateMetrics('query', duration, true);
                setTimeout(async () => {
                  try {
                    const result = await this.query(sql, params, null, retryCount + 1);
                    resolve(result);
                  } catch (retryError) {
                    reject(retryError);
                  }
                }, retryDelay);
                return;
              }
              this.updateMetrics('query', duration, true);
              reject(err);
            } else {
              this.updateMetrics('query', duration, false);
              resolve(rows);
            }
          });
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (connection) {
        this.releaseConnection();
      }
      
      if (retryCount < maxRetries && this.shouldRetry(error)) {
        console.warn(`⚠️ DatabaseManager: Connection failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        this.updateMetrics('query', duration, true);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return await this.query(sql, params, callback, retryCount + 1);
      }
      
      this.updateMetrics('query', duration, true);
      this.metrics.connectionFailures++;
      
      if (callback) {
        callback(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute statement via wrapper with retry logic, connection pooling, and metrics
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @param {Function} callback - Optional callback function
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<void>} - (if no callback) or void (if callback)
   */
  async run(sql, params = [], callback = null, retryCount = 0) {
    // Handle callback-style calls
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
    const startTime = Date.now();
    
    let connection = null;
    
    try {
      // Get connection from pool
      connection = await this.getPooledConnection();
      
      if (callback) {
        // Callback-style call
        connection.run(sql, params, async (err) => {
          const duration = Date.now() - startTime;
          this.releaseConnection();
          
          if (err && retryCount < maxRetries && this.shouldRetry(err)) {
            console.warn(`⚠️ DatabaseManager: Run failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            this.updateMetrics('run', duration, true);
            setTimeout(async () => {
              await this.run(sql, params, callback, retryCount + 1);
            }, retryDelay);
            return;
          }
          
          this.updateMetrics('run', duration, !!err);
          callback(err);
        });
      } else {
        // Promise-style call
        return new Promise((resolve, reject) => {
          connection.run(sql, params, async (err) => {
            const duration = Date.now() - startTime;
            this.releaseConnection();
            
            if (err) {
              if (retryCount < maxRetries && this.shouldRetry(err)) {
                console.warn(`⚠️ DatabaseManager: Run failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
                this.updateMetrics('run', duration, true);
                setTimeout(async () => {
                  try {
                    await this.run(sql, params, null, retryCount + 1);
                    resolve();
                  } catch (retryError) {
                    reject(retryError);
                  }
                }, retryDelay);
                return;
              }
              this.updateMetrics('run', duration, true);
              reject(err);
            } else {
              this.updateMetrics('run', duration, false);
              resolve();
            }
          });
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (connection) {
        this.releaseConnection();
      }
      
      if (retryCount < maxRetries && this.shouldRetry(error)) {
        console.warn(`⚠️ DatabaseManager: Connection failed, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        this.updateMetrics('run', duration, true);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return await this.run(sql, params, callback, retryCount + 1);
      }
      
      this.updateMetrics('run', duration, true);
      this.metrics.connectionFailures++;
      
      if (callback) {
        callback(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Determine if an error should trigger a retry
   * @param {Error} error - The error to evaluate
   * @returns {boolean} - Whether to retry the operation
   */
  shouldRetry(error) {
    if (!error) return false;
    
    const errorMessage = error.message || '';
    const errorCode = error.code || '';
    
    // Retry on connection issues
    const connectionErrors = [
      'Connection Error',
      'database has been invalidated',
      'Connection was never established',
      'SQLITE_BUSY',
      'SQLITE_LOCKED'
    ];
    
    // Don't retry on corruption or fatal errors
    const fatalErrors = [
      'FATAL Error',
      'Failed to rollback transaction',
      'IO Error: Could not read enough bytes'
    ];
    
    // Check for fatal errors first (no retry)
    for (const fatalError of fatalErrors) {
      if (errorMessage.includes(fatalError)) {
        return false;
      }
    }
    
    // Check for retryable errors
    for (const connectionError of connectionErrors) {
      if (errorMessage.includes(connectionError) || errorCode.includes(connectionError)) {
        return true;
      }
    }
    
    // Retry on temporary network/file system issues
    if (errorMessage.includes('EBUSY') || 
        errorMessage.includes('EAGAIN') ||
        errorMessage.includes('ENOENT')) {
      return true;
    }
    
    return false;
  }
}

// Export singleton instance
const databaseManager = new DatabaseManager();
export default databaseManager;
