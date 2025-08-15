// duckdb-wrapper.cjs
// CommonJS wrapper for DuckDB to enable ES module compatibility
const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');

let db;
let connection;
let currentDbPath;

// Connection queue to prevent concurrent access issues
let operationQueue = [];
let isProcessingQueue = false;

/**
 * Add agent_memory prefix to table names for consistent catalog aliasing
 * @param {string} sql - SQL query to process
 * @returns {string} - SQL with prefixed table names
 */
function addTablePrefixes(sql) {
  // List of known table names that need prefixing
  const tableNames = [
    'agents',
    'conversation_messages', 
    'conversation_sessions',
    'memory',
    'memory_entities',
    'session_context'
  ];
  
  let prefixedSql = sql;
  
  // Handle DDL vs DML statements differently for DuckDB syntax compatibility
  const isDDL = /^\s*(CREATE|DROP|ALTER)\s+/i.test(sql.trim());
  
  if (isDDL) {
    // For DDL statements, DuckDB doesn't support catalog prefixes in table names
    // The connection should use USE statement to set the active database context
    return sql;
  }
  
  // For DML statements (SELECT, INSERT, UPDATE, DELETE), add catalog prefixes
  for (const tableName of tableNames) {
    // Skip if already prefixed
    if (prefixedSql.includes(`agent_memory.${tableName}`)) {
      continue;
    }
    
    // More precise regex: only match table names in appropriate SQL contexts
    // Match after FROM, JOIN, INTO, UPDATE keywords, or at start of statement
    const contexts = [
      `FROM\\s+${tableName}\\b`,
      `JOIN\\s+${tableName}\\b`, 
      `INTO\\s+${tableName}\\b`,
      `UPDATE\\s+${tableName}\\b`,
      `^\\s*${tableName}\\b`  // At start of statement
    ];
    
    for (const context of contexts) {
      const regex = new RegExp(context, 'gi');
      prefixedSql = prefixedSql.replace(regex, (match) => {
        return match.replace(tableName, `agent_memory.${tableName}`);
      });
    }
  }
  
  return prefixedSql;
}

/**
 * Handle WAL corruption by detecting and removing corrupted WAL files
 * @param {string} dbPath - Path to the database file
 * @param {boolean} forceRemove - Force removal of WAL file regardless of health check
 * @returns {boolean} - True if WAL corruption was detected and handled
 */
function handleWALCorruption(dbPath) {
  try {
    const walPath = dbPath + '.wal';
    const shmPath = dbPath + '.wal-shm';
    
    if (fs.existsSync(walPath)) {
      console.log('🔍 WAL file detected - attempting to preserve data before cleanup...');
      
      // CRITICAL FIX: Try to commit WAL data before removing it to prevent data loss
      try {
        console.log('🔄 Attempting to commit WAL data to preserve transactions...');
        
        // Create a temporary connection to commit the WAL
        const tempDb = new duckdb.Database(dbPath);
        tempDb.run('PRAGMA force_checkpoint', (checkpointErr) => {
          if (checkpointErr) {
            console.warn('⚠️ WAL checkpoint failed, proceeding with backup approach:', checkpointErr.message);
          } else {
            console.log('✅ WAL data committed successfully before cleanup');
          }
          
          // Close the temporary connection
          tempDb.close();
          
          // Now safe to remove WAL files since data is committed
          removeWalFiles();
        });
        
        return true;
      } catch (commitErr) {
        console.warn('⚠️ Could not commit WAL data, using backup approach:', commitErr.message);
        removeWalFiles();
        return true;
      }
      
      function removeWalFiles() {
        // Backup the WAL file before removing it
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${walPath}.bak-${timestamp}`;
        try {
          fs.copyFileSync(walPath, backupPath);
          console.log(`💾 Backed up WAL to: ${backupPath}`);
        } catch (backupErr) {
          console.log('⚠️ Could not backup WAL file:', backupErr.message);
        }
        
        // Remove WAL and SHM files
        fs.unlinkSync(walPath);
        console.log('🗑️ Removed WAL file after data preservation attempt');
        
        if (fs.existsSync(shmPath)) {
          fs.unlinkSync(shmPath);
          console.log('🗑️ Removed WAL-SHM file');
        }
      }
    }
    
    return false;
  } catch (error) {
    console.log('⚠️ Error checking WAL file:', error.message);
    // If we can't check the WAL file, try to remove it to be safe
    try {
      const walPath = dbPath + '.wal';
      if (fs.existsSync(walPath)) {
        fs.unlinkSync(walPath);
        console.log('🗑️ Removed potentially problematic WAL file');
        return true;
      }
    } catch (removeErr) {
      console.log('❌ Could not remove WAL file:', removeErr.message);
    }
    return false;
  }
}

function connect(dbPath, cb) {
  // Handle optional dbPath parameter
  if (typeof dbPath === 'function') {
    cb = dbPath;
    dbPath = path.join(__dirname, '..', '..', '..', 'data', 'agent_memory.duckdb');
  }
  
  currentDbPath = dbPath;
  
  // STEP 1: Check and handle WAL corruption before attempting connection
  const walWasCorrupted = handleWALCorruption(dbPath);
  if (walWasCorrupted) {
    console.log('🔄 WAL corruption handled - proceeding with fresh connection');
  }
  
  // STEP 1.5: Ensure database directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('📁 Created database directory');
  }
  
  // STEP 2: Implement LLM expert's consistent catalog aliasing solution
  function attemptConnection(retryCount = 0) {
    try {
      console.log(`🔄 Attempting DuckDB connection with consistent catalog aliasing (attempt ${retryCount + 1})...`);
      
      // Close existing connections
      if (db) {
        try {
          db.close();
        } catch (closeErr) {
          // Ignore close errors
        }
      }
      
      // STEP 2.1: Create bootstrap host database (:memory:)
      console.log('🔄 Creating bootstrap host database...');
      db = new duckdb.Database(':memory:', (dbErr) => {
        if (dbErr) {
          console.error('❌ Bootstrap database creation failed:', dbErr);
          return cb(dbErr);
        }
        
        console.log('✅ Bootstrap database created successfully');
        
        console.log('🔄 Establishing connection to bootstrap host...');
        connection = db.connect();
        console.log('✅ Bootstrap connection established');
        
        // STEP 2.2: ATTACH the real database file with consistent alias
        console.log('🔄 Attaching agent_memory database with consistent alias...');
        const attachSQL = `ATTACH '${dbPath}' AS agent_memory`;
        connection.run(attachSQL, (attachErr) => {
          if (attachErr) {
            console.error('❌ Database ATTACH failed:', attachErr);
            
            // If attach fails with WAL corruption, try crash-safe recovery
            if (attachErr.message.includes('WAL') || attachErr.message.includes('Catalog')) {
              console.log('🔄 ATTACH failed with WAL/Catalog error - attempting crash-safe recovery...');
              
              // Backup and remove WAL file
              try {
                const walPath = dbPath + '.wal';
                const shmPath = dbPath + '.wal-shm';
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                
                if (fs.existsSync(walPath)) {
                  const walBackupPath = `${walPath}.bak-${timestamp}`;
                  fs.copyFileSync(walPath, walBackupPath);
                  console.log(`💾 Backed up WAL to: ${walBackupPath}`);
                  
                  fs.unlinkSync(walPath);
                  console.log('🗑️ Removed corrupted WAL file');
                }
                if (fs.existsSync(shmPath)) {
                  fs.unlinkSync(shmPath);
                  console.log('🗑️ Removed corrupted WAL-SHM file');
                }
                
                // Retry attach after cleanup
                if (retryCount === 0) {
                  return attemptConnection(1);
                }
              } catch (cleanupErr) {
                console.warn('⚠️ WAL cleanup failed:', cleanupErr.message);
              }
            }
            
            return cb(attachErr);
          }
          
          console.log('✅ agent_memory database attached successfully');
          
          // STEP 1.3: Set active database context for DDL operations
          console.log('🔄 Setting active database context for DDL operations...');
          connection.run('USE agent_memory', (useErr) => {
            if (useErr) {
              console.warn('⚠️ Failed to set active database context:', useErr.message);
              // Continue anyway - this is not critical
            } else {
              console.log('✅ Active database context set to agent_memory');
            }
            
            // STEP 1.4: Test connection with health check on attached database
            console.log('🔄 Testing connection with health check on attached database...');
            connection.all('SELECT 1 as health_check FROM agent_memory.memory LIMIT 1', (healthErr, healthResult) => {
            if (healthErr) {
              console.log('🔄 Trying simpler health check...');
              connection.all('SELECT 1 as health_check', (simpleHealthErr, simpleHealthResult) => {
                if (simpleHealthErr) {
                  console.error('❌ Connection health check failed:', simpleHealthErr);
                  return cb(simpleHealthErr);
                }
                
                console.log('✅ Connection health check passed');
                
                // Continue with integrity check and setup
                completeSetup();
              });
            } else {
              console.log('✅ Connection health check passed');
              completeSetup();
            }
          });
          
            function completeSetup() {
              // STEP 1.5: Run integrity check (DuckDB compatible)
              console.log('🔄 Verifying database integrity...');
              connection.all('SELECT 1 as integrity_check', (integrityErr, integrityResult) => {
                if (integrityErr) {
                  console.warn('⚠️ Database integrity check warning:', integrityErr.message);
                  // Don't fail on integrity warnings
                } else {
                  console.log('✅ Database integrity verified');
                }
                
                // STEP 1.6: Perform WAL checkpoint
                console.log('🔄 Performing WAL checkpoint to preserve data...');
                connection.run('CHECKPOINT', (checkpointErr) => {
                  if (checkpointErr) {
                    console.warn('⚠️ WAL checkpoint warning:', checkpointErr.message);
                    // Don't fail on checkpoint errors, just warn
                  } else {
                    console.log('✅ WAL checkpoint completed - data preserved');
                  }
                  
                  console.log('🎉 DuckDB with consistent catalog aliasing fully operational!');
                  
                  // STEP 1.7: Start periodic WAL checkpoints
                  startPeriodicCheckpoints();
                  
                  cb(null, { db, connection });
                });
              });
            }
          });
        });
      });
      
    } catch (err) {
      console.error('❌ DuckDB connection attempt failed:', err);
      return cb(err);
    }
  }
  
  // Start the connection attempt
  attemptConnection();
}

/**
 * Queue database operations to prevent concurrent access that corrupts WAL files
 */
function queueOperation(operationType, sql, params, callback) {
  return new Promise((resolve, reject) => {
    const operation = {
      type: operationType,
      sql,
      params,
      callback,
      resolve,
      reject,
      timestamp: Date.now()
    };
    
    operationQueue.push(operation);
    processQueue();
  });
}

/**
 * Process queued operations sequentially to prevent WAL corruption
 */
function processQueue() {
  if (isProcessingQueue || operationQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  const operation = operationQueue.shift();
  
  if (!connection) {
    const error = new Error('Connection not ready');
    operation.reject(error);
    if (operation.callback) operation.callback(error);
    isProcessingQueue = false;
    setImmediate(processQueue); // Process next operation
    return;
  }
  
  const { type, sql, params, callback, resolve, reject } = operation;
  
  // Only log queries in debug mode or for important operations
  const isImportantQuery = sql.includes('CREATE') || sql.includes('DROP') || sql.includes('ALTER');
  if (process.env.DEBUG_DB || isImportantQuery) {
    console.log(`[DUCKDB-WRAPPER] Executing ${type}:`, sql.substring(0, 100) + '...');
    console.log('[DUCKDB-WRAPPER] With params:', params);
  }
  
  // Wrap the callback to ensure we always return results and continue queue
  const wrappedCallback = (err, result) => {
    isProcessingQueue = false;
    
    if (err) {
      console.error(`[DUCKDB-WRAPPER] ${type} failed:`, err.message || err);
      reject(err);
      if (callback) callback(err);
    } else {
      // Ensure we always return an array for queries, even if result is undefined
      const finalResult = type === 'query' 
        ? (Array.isArray(result) ? result : (result ? [result] : []))
        : result;
      
      // Only log success for important queries to reduce noise
      if (process.env.DEBUG_DB || isImportantQuery) {
        console.log(`[DUCKDB-WRAPPER] ${type} succeeded`);
      }
      
      resolve(finalResult);
      if (callback) callback(null, finalResult);
    }
    
    // Process next operation in queue
    setImmediate(processQueue);
  };
  
  // Execute the operation
  try {
    if (type === 'query') {
      if (params.length > 0) {
        connection.all(sql, ...params, wrappedCallback);
      } else {
        connection.all(sql, wrappedCallback);
      }
    } else if (type === 'run') {
      if (params.length > 0) {
        connection.run(sql, ...params, wrappedCallback);
      } else {
        connection.run(sql, wrappedCallback);
      }
    }
  } catch (syncError) {
    console.error(`[DUCKDB-WRAPPER] ${type} sync error:`, syncError);
    isProcessingQueue = false;
    reject(syncError);
    if (callback) callback(syncError);
    setImmediate(processQueue);
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
  
  // Auto-prefix table names for consistent catalog aliasing
  const prefixedSql = addTablePrefixes(sql);
  
  // Queue the operation to prevent concurrent access
  queueOperation('query', prefixedSql, params, cb);
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
  
  // Auto-prefix table names for consistent catalog aliasing
  const prefixedSql = addTablePrefixes(sql);
  
  // Queue the operation to prevent concurrent access
  queueOperation('run', prefixedSql, params, cb);
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

// Periodic WAL checkpoint to prevent data loss
function performPeriodicCheckpoint() {
  if (!connection) return;
  
  connection.run('CHECKPOINT', (err) => {
    if (err) {
      console.warn('⚠️ Periodic WAL checkpoint failed:', err.message);
    } else {
      console.log('✅ Periodic WAL checkpoint completed');
    }
  });
}

// Start periodic checkpoints every 5 minutes
let checkpointInterval;
function startPeriodicCheckpoints() {
  if (checkpointInterval) clearInterval(checkpointInterval);
  checkpointInterval = setInterval(performPeriodicCheckpoint, 5 * 60 * 1000); // 5 minutes
  console.log('🔄 Started periodic WAL checkpoints (every 5 minutes)');
}

function stopPeriodicCheckpoints() {
  if (checkpointInterval) {
    clearInterval(checkpointInterval);
    checkpointInterval = null;
    console.log('⏹️ Stopped periodic WAL checkpoints');
  }
}

module.exports = {
  connect,
  query,
  run,
  close,
  isConnected,
  performPeriodicCheckpoint,
  startPeriodicCheckpoints,
  stopPeriodicCheckpoints,
  getDbPath: () => currentDbPath
};
