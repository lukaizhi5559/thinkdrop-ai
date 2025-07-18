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
    console.log('🔗 Creating DuckDB database and connection...');
    console.log('DATABASE PATH:', dbPath);
    
    // Create database with callback to handle any initialization errors
    try {
      console.log('Creating DuckDB database at:', dbPath);
      
      // Force synchronous database creation to avoid callback issues
      db = new duckdb.Database(dbPath);
      console.log('✅ DuckDB database created successfully');
      
      // Now connect to the database with explicit try/catch
      try {
        console.log('Attempting to connect to database...');
        connection = db.connect();
        console.log('✅ DuckDB connection established via CommonJS wrapper');
        
        // Test the connection with a simple query
        connection.all('SELECT 1 as test', (testErr, testResult) => {
          if (testErr) {
            console.error('❌ DuckDB connection test failed:', testErr);
            return cb(testErr);
          }
          
          console.log('Connection test successful:', testResult);
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
  
  if (params.length > 0) {
    connection.all(sql, ...params, cb);
  } else {
    connection.all(sql, cb);
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
  getDbPath: () => dbPath
};
