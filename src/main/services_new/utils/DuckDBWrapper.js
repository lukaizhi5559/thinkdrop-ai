/**
 * DuckDB Wrapper for Promise-based operations
 * Provides a consistent interface for database operations that matches the expected API
 */

class DuckDBWrapper {
  constructor(duckdbConnection) {
    this.connection = duckdbConnection;
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
        console.log('🔧 DuckDBWrapper.run:', { query: query.substring(0, 100) + '...', paramCount: params.length });
        
        this.connection.run(query, ...params, function(err) {
          if (err) {
            console.error('❌ DuckDB run error:', err.message);
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
        console.error('❌ DuckDB run exception:', error.message);
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
        console.log('🔧 DuckDBWrapper.all:', { query: query.substring(0, 100) + '...', paramCount: params.length });
        
        this.connection.all(query, ...params, (err, rows) => {
          if (err) {
            console.error('❌ DuckDB all error:', err.message);
            reject(new Error(`DuckDB all failed: ${err.message}`));
            return;
          }
          
          console.log(`✅ DuckDB all returned ${rows ? JSON.stringify(rows, null, 2) : 0} rows`);
          resolve(rows || []);
        });
      } catch (error) {
        console.error('❌ DuckDB all exception:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Execute a query and return first result (SELECT with LIMIT 1)
   * @param {string} query - SQL query with $1, $2, etc. placeholders
   * @param {Array} params - Parameters to bind
   * @returns {Promise<Object|null>} - First result row or null
   */
  async get(query, params = []) {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔧 DuckDBWrapper.get:', { query: query.substring(0, 100) + '...', paramCount: params.length });
        
        this.connection.get(query, ...params, (err, row) => {
          if (err) {
            console.error('❌ DuckDB get error:', err.message);
            reject(new Error(`DuckDB get failed: ${err.message}`));
            return;
          }
          
          console.log('✅ DuckDB get returned:', row ? 'row found' : 'no row');
          resolve(row || null);
        });
      } catch (error) {
        console.error('❌ DuckDB get exception:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Execute multiple SQL statements (DDL operations)
   * @param {string} sql - SQL statements separated by semicolons
   * @returns {Promise<void>}
   */
  async exec(sql) {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔧 DuckDBWrapper.exec:', sql.substring(0, 100) + '...');
        
        this.connection.exec(sql, (err) => {
          if (err) {
            console.error('❌ DuckDB exec error:', err.message);
            reject(new Error(`DuckDB exec failed: ${err.message}`));
            return;
          }
          
          console.log('✅ DuckDB exec completed successfully');
          resolve();
        });
      } catch (error) {
        console.error('❌ DuckDB exec exception:', error.message);
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
            console.error('❌ DuckDB close error:', err.message);
            reject(err);
            return;
          }
          console.log('✅ DuckDB connection closed');
          resolve();
        });
      } catch (error) {
        console.error('❌ DuckDB close exception:', error.message);
        reject(error);
      }
    });
  }
}

export default DuckDBWrapper;
