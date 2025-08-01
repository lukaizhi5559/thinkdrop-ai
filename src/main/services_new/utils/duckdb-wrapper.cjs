// duckdb-wrapper.cjs
// CommonJS wrapper for DuckDB to enable ES module compatibility
const duckdb = require('duckdb');
const path = require('path');

let db;
let connection;
let currentDbPath;

function connect(dbPath, cb) {
  // Handle optional dbPath parameter
  if (typeof dbPath === 'function') {
    cb = dbPath;
    dbPath = path.join(__dirname, '..', '..', '..', 'data', 'agent_memory.duckdb');
  }
  
  currentDbPath = dbPath;
  try {
    
    // Create database with callback to handle any initialization errors
    try {
      
      // Force synchronous database creation to avoid callback issues
      db = new duckdb.Database(dbPath);
      
      // Now connect to the database with explicit try/catch
      try {
        connection = db.connect();
        
        // Test the connection with a simple query
        connection.all('SELECT 1 as test', (testErr, testResult) => {
          if (testErr) {
            console.error('❌ DuckDB connection test failed:', testErr);
            return cb(testErr);
          }
          
          cb(null, { db, connection });
        });
      } catch (connErr) {
        console.error('❌ DuckDB connection failed (sync):', connErr);
        return cb(connErr);
      }
    } catch (error) {
      console.error('❌ DuckDB initialization nested failed:', error);
      cb(error);
    }
  } catch (error) {
    console.error('❌ DuckDB initialization failed:', error);
    cb(error);
  }
}

function query(sql, params = [], cb) {
  if (typeof params === 'function') {
    cb = params;
    params = [];
  }
  
  // Handle missing callback gracefully
  if (typeof cb !== 'function') {
    cb = (err, rows) => {
      if (err) {
        console.error('[DUCKDB-WRAPPER] Query failed with error:', err);
      }
    };
  }
  
  if (!connection) {
    return cb(new Error('Connection not ready'));
  }
  
  // Only log queries in debug mode or for important operations
  const isImportantQuery = sql.includes('CREATE') || sql.includes('DROP') || sql.includes('ALTER');
  if (process.env.DEBUG_DB || isImportantQuery) {
    console.log('[DUCKDB-WRAPPER] Executing query:', sql.substring(0, 100) + '...');
    console.log('[DUCKDB-WRAPPER] With params:', params);
  }
  
  // Wrap the callback to ensure we always return results
  const wrappedCallback = (err, rows) => {
    if (err) {
      console.error('[DUCKDB-WRAPPER] Query failed:', err.message || err);
      cb(err);
    } else {
      // Ensure we always return an array, even if rows is undefined
      const result = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      // Only log success for important queries to reduce EPIPE errors
      if (process.env.DEBUG_DB || isImportantQuery) {
        console.log('[DUCKDB-WRAPPER] Query succeeded, returning:', result.length, 'rows');
      }
      cb(null, result);
    }
  };
  
  if (params.length > 0) {
    connection.all(sql, ...params, wrappedCallback);
  } else {
    connection.all(sql, wrappedCallback);
  }
}

function run(sql, params = [], cb) {
  if (typeof params === 'function') {
    cb = params;
    params = [];
  }
  
  // Handle missing callback gracefully
  if (typeof cb !== 'function') {
    cb = (err) => {
      if (err) {
        console.error('[DUCKDB-WRAPPER] Run failed with error:', err);
      }
    };
  }
  
  if (!connection) {
    return cb(new Error('Connection not ready'));
  }
  
  const wrappedCallback = (err) => {
    if (err) {
      console.error('[DUCKDB-WRAPPER] Run failed with error:', err);
      cb(err);
    } else {
      cb();
    }
  };
  
  if (params.length > 0) {
    connection.run(sql, ...params, wrappedCallback);
  } else {
    connection.run(sql, wrappedCallback);
  }
}

function close(cb) {
  if (connection) {
    connection.close((err) => {
      if (err) console.error('❌ Error closing connection:', err);
      connection = null;
      
      if (db) {
        db.close((dbErr) => {
          if (dbErr) console.error('❌ Error closing database:', dbErr);
          db = null;
          cb && cb(dbErr || err);
        });
      } else {
        cb && cb(err);
      }
    });
  } else {
    cb && cb();
  }
}

function isConnected() {
  return !!connection;
}

module.exports = {
  connect,
  query,
  run,
  close,
  isConnected,
getDbPath: () => currentDbPath
};
