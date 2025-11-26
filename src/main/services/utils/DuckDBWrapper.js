/**
 * DuckDB Wrapper for Promise-based operations
 * Provides a consistent interface for database operations that matches the expected API
 */

const logger = require('./../../logger.cjs');
class DuckDBWrapper {
  constructor(duckdbConnection) {
    if (!duckdbConnection) {
      throw new Error('DuckDB connection is required');
    }
    this.connection = duckdbConnection;
  }
  
  /**
   * Validate connection is still active and has required methods
   */
  _validateConnection() {
    if (!this.connection) {
      throw new Error('Database connection is not available');
    }
    
    // Check what methods are actually available on the connection object
    const allMethods = Object.getOwnPropertyNames(this.connection);
    const allPrototypeMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(this.connection));
     
    // Check if connection has required DuckDB methods (DuckDB doesn't have 'get', we'll implement it using 'all')
    const requiredMethods = ['all', 'run', 'exec'];
    const missingMethods = [];
    
    for (const method of requiredMethods) {
      if (typeof this.connection[method] !== 'function') {
        missingMethods.push(method);
      }
    }
    
    if (missingMethods.length > 0) {
      logger.error(`❌ Missing methods: ${missingMethods.join(', ')}`);
      logger.error(`❌ Available methods: ${allMethods.concat(allPrototypeMethods).filter(m => typeof this.connection[m] === 'function').join(', ')}`);
      throw new Error(`Database connection missing required methods: ${missingMethods.join(', ')}`);
    }
  }

  /**
   * Execute a query with parameters (INSERT, UPDATE, DELETE)
   * @param {string} query - SQL query with $1, $2, etc. placeholders
   * @param {Array} params - Parameters to bind
   * @returns {Promise<Object>} - Result object with changes info
   */
  async run(query, params = []) {
    return new Promise((resolve, reject) => {
      try {
        this._validateConnection();
        this.connection.run(query, ...params, function(err) {
          if (err) {
            logger.error('❌ DuckDB run error:', err.message);
            reject(new Error(`DuckDB run failed: ${err.message}`));
            return;
          }
          
          // DuckDB doesn't provide changes count like SQLite, so we return a success indicator
          resolve({ 
            changes: 1, // Assume success means 1 row affected
            lastID: null // DuckDB doesn't provide lastID in run callback
          });
        });
      } catch (error) {
        logger.error('❌ DuckDB run exception:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Execute a query and return all results (SELECT)
   * @param {string} query - SQL query with $1, $2, etc. placeholders
   * @param {Array} params - Parameters to bind
   * @returns {Promise<Array>} - Array of result rows
   */
  async all(query, params = []) {
    return new Promise((resolve, reject) => {
      try {
        this._validateConnection();
        this.connection.all(query, ...params, (err, rows) => {
          if (err) {
            logger.error('❌ DuckDB all error:', err.message);
            reject(new Error(`DuckDB all failed: ${err.message}`));
            return;
          }
          
          resolve(rows || []);
        });
      } catch (error) {
        logger.error('❌ DuckDB all exception:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Execute a query and return first result (SELECT with LIMIT 1)
   * DuckDB doesn't have a native 'get' method, so we implement it using 'all' and return the first row
   * @param {string} query - SQL query with $1, $2, etc. placeholders
   * @param {Array} params - Parameters to bind
   * @returns {Promise<Object|null>} - First result row or null
   */
  async get(query, params = []) {
    try {
      this._validateConnection();
      
      // Use 'all' method and return the first row
      const rows = await this.all(query, params);
      return rows && rows.length > 0 ? rows[0] : null;
      
    } catch (error) {
      logger.error('❌ DuckDB get exception:', error.message);
      throw error;
    }
  }

  /**
   * Execute multiple SQL statements (DDL operations)
   * @param {string} sql - SQL statements separated by semicolons
   * @returns {Promise<void>}
   */
  async exec(sql) {
    return new Promise((resolve, reject) => {
      try {
        this._validateConnection();
        logger.debug('🔧 DuckDBWrapper.exec:', sql.substring(0, 100) + '...');
        
        this.connection.exec(sql, (err) => {
          if (err) {
            logger.error('❌ DuckDB exec error:', err.message);
            reject(new Error(`DuckDB exec failed: ${err.message}`));
            return;
          }
          
          logger.debug('✅ DuckDB exec completed successfully');
          resolve();
        });
      } catch (error) {
        logger.error('❌ DuckDB exec exception:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Begin a transaction
   * @returns {Promise<void>}
   */
  async beginTransaction() {
    return this.exec('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   * @returns {Promise<void>}
   */
  async commit() {
    return this.exec('COMMIT');
  }

  /**
   * Rollback a transaction
   * @returns {Promise<void>}
   */
  async rollback() {
    return this.exec('ROLLBACK');
  }

  /**
   * Close the database connection
   * @returns {Promise<void>}
   */
  async close() {
    return new Promise((resolve, reject) => {
      try {
        this.connection.close((err) => {
          if (err) {
            logger.error('❌ DuckDB close error:', err.message);
            reject(err);
            return;
          }
          logger.debug('✅ DuckDB connection closed');
          resolve();
        });
      } catch (error) {
        logger.error('❌ DuckDB close exception:', error.message);
        reject(error);
      }
    });
  }
}

export default DuckDBWrapper;
