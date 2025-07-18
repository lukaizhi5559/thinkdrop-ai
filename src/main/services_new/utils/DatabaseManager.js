/**
 * DatabaseManager - Singleton pattern for centralized DuckDB connection management
 * Uses CommonJS wrapper for ES module compatibility
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dbWrapper = require('./duckdb-wrapper.cjs');

class DatabaseManager {
  constructor() {
    this.isInitialized = false;
  }

  /**
   * Initialize database connection via CommonJS wrapper
   * @param {string} dbPath - Path to the database file (optional, wrapper uses default)
   * @returns {Promise<Object>} - Wrapper object with query/run methods
   */
  async initialize(dbPath) {
    return new Promise((resolve, reject) => {
      console.log('🔧 DatabaseManager: Initializing via CommonJS wrapper...');
      
      dbWrapper.connect(dbPath, (err, result) => {
        if (err) {
          console.error('❌ DatabaseManager: Wrapper connection failed:', err);
          reject(err);
          return;
        }
        
        this.isInitialized = true;
        console.log('✅ DatabaseManager: Wrapper connection established');
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
   * Execute query via wrapper
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} - Query results
   */
  async query(sql, params = []) {
    const connection = await this.ensureConnection();
    
    return new Promise((resolve, reject) => {
      connection.query(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Execute statement via wrapper
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @returns {Promise<void>}
   */
  async run(sql, params = []) {
    const connection = await this.ensureConnection();
    
    return new Promise((resolve, reject) => {
      connection.run(sql, params, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

// Export singleton instance
const databaseManager = new DatabaseManager();
export default databaseManager;
