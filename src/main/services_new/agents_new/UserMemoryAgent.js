/**
 * UserMemoryAgent - Object-based approach
 * No string parsing, no template literal issues
 */

export const AGENT_FORMAT = {
  name: 'UserMemoryAgent',
  description: 'Manages persistent user context and memories with DuckDB storage',
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Memory operation to perform',
        enum: [
          'memory-store',
          'memory-retrieve', 
          'memory-search',
          'memory-delete',
          'memory-update',
          'memory-list',
          'screenshot-store'
        ]
      },
      key: { type: 'string', description: 'Memory key for store/retrieve operations' },
      value: { type: 'string', description: 'Memory value or ID for operations' },
      memoryId: { type: 'string', description: 'Specific memory ID for retrieve/delete operations' },
      query: { type: 'string', description: 'Search query for memory-search operations' },
      limit: { type: 'integer', description: 'Maximum number of results to return', default: 25 },
      offset: { type: 'integer', description: 'Offset for pagination', default: 0 },
      metadata: { type: 'object', description: 'Additional metadata for memory operations' },
      updates: { type: 'object', description: 'Fields to update for memory-update operations' }
    },
    required: ['action']
  },
  dependencies: ['duckdb', 'path', 'fs', 'url'],
  execution_target: 'frontend',
  requires_database: true,
  database_type: 'duckdb',

  // Object-based bootstrap method - no string parsing needed
  async bootstrap(config, context) {
    try {
      console.log('[INFO] UserMemoryAgent: Setting up DuckDB connection...');
      
      // Import path module - needed for all path operations
      const { duckdb, path, fs, url } = context;
      
      // Calculate database path from config or default location
      let dbPath;
      if (config.dbPath) {
        dbPath = config.dbPath;
      } else {
        const { fileURLToPath } = url;
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const projectRoot = path.dirname(path.dirname(path.dirname(path.dirname(__dirname))));
        dbPath = path.join(projectRoot, 'data', 'agent_memory.duckdb');
      }
      this.dbPath = dbPath;
      
      console.log('UserMemoryAgent: Database path: ' + this.dbPath);
      
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      
      if (!fs.existsSync(dataDir)) {
        console.log('Creating data directory: ' + dataDir);
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      // PRIORITY 1: Use connection from context if available
      if (context.connection && context.db) {
        console.log('[INFO] Using existing DuckDB connection from context');
        this.connection = context.connection;
        this.db = context.db;
        
        // Test the provided connection
        try {
          const result = await new Promise((resolve, reject) => {
            this.connection.all('SELECT 1 as test', (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          console.log('[SUCCESS] Context connection test passed');
        } catch (err) {
          console.warn('[WARN] Context connection test failed, will create new connection:', err.message);
          // Connection from context is invalid, will create a new one below
          this.connection = null;
          this.db = null;
        }
      }
      
      // PRIORITY 2: Create new connection if needed
      if (!this.connection || !this.db) {
        // Import DuckDB and set up connection
        console.log('[INFO] Importing DuckDB module...');
        console.log('[SUCCESS] DuckDB module imported');
        
        if (!duckdb.Database) {
          throw new Error('DuckDB Database constructor not found. Available properties: ' + Object.keys(duckdb).join(', '));
        }
        
        // Create database connection with retry logic
        console.log('[INFO] Creating new DuckDB database instance...');
        const MAX_RETRIES = 3;
        let retries = 0;
        let lastError = null;
        
        while (retries < MAX_RETRIES) {
          try {
            this.db = new duckdb.Database(this.dbPath);
            console.log('[SUCCESS] DuckDB database instance created');
            
            this.connection = this.db.connect();
            console.log('[SUCCESS] DuckDB connection established');
            
            // Test the connection
            const result = await new Promise((resolve, reject) => {
              this.connection.all('SELECT 1 as test', (err, result) => {
                if (err) {
                  console.error('[ERROR] Connection test query failed:', err.message);
                  reject(err);
                } else {
                  console.log('[SUCCESS] Connection test passed');
                  resolve(result);
                }
              });
            });
            
            console.log('[DEBUG] Connection test result:', result);
            break;
            
          } catch (err) {
            lastError = err;
            retries++;
            console.error('DuckDB connection attempt ' + retries + ' failed: ' + err.message);
            
            if (retries < MAX_RETRIES) {
              console.log('Retrying in 1 second... (Attempt ' + (retries + 1) + '/' + MAX_RETRIES + ')');
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        
        if (!this.connection) {
          throw new Error('Database connection failed after ' + MAX_RETRIES + ' attempts: ' + (lastError ? lastError.message : 'Unknown error'));
        }
      }
      
      // Create memory table if it doesn't exist
      await this.ensureMemoryTable();
      
      console.log('[SUCCESS] UserMemoryAgent bootstrap completed');
      return { success: true, dbPath: this.dbPath };
      
    } catch (error) {
      console.error('[ERROR] UserMemoryAgent bootstrap failed:', error);
      throw error;
    }
  },

  // Object-based execute method - no string parsing needed
  async execute(params, context) {
    try {
      const { action } = params;
      
      // Use connection from context if available
      if (context.connection) {
        console.log('[INFO] Using connection from context');
        this.connection = context.connection;
      }
      if (context.db) {
        console.log('[INFO] Using db from context');
        this.db = context.db;
      }
      
      // Validate connection before proceeding
      await this.validateConnection();
      console.log(`[INFO] Connection validated, executing ${action}`);
      
      switch (action) {
        case 'memory-store':
          return await this.storeMemory(params, context);
        case 'memory-retrieve':
          return await this.retrieveMemory(params, context);
        case 'memory-search':
          return await this.searchMemories(params, context);
        case 'memory-delete':
          return await this.deleteMemory(params, context);
        case 'memory-update':
          return await this.updateMemory(params, context);
        case 'memory-list':
          return await this.listMemories(params, context);
        case 'screenshot-store':
          return await this.storeScreenshot(params, context);
        default:
          throw new Error('Unknown action: ' + action);
      }
    } catch (error) {
      console.error('[ERROR] UserMemoryAgent execution failed:', error);
      throw error;
    }
  },

  // Validate database connection
  async validateConnection(context) {
    try {
      // Use connection from context if available, otherwise use this.connection
      const connection = context?.connection || this.connection;
      const db = context?.db || this.db;
      
      if (!connection || !db) {
        throw new Error('Database connection not available');
      }
      
      // Test the connection with a simple query
      await new Promise((resolve, reject) => {
        connection.all('SELECT 1 as test', (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      
      return true;
    } catch (error) {
      console.error('[ERROR] Database connection validation failed:', error);
      throw new Error('Database connection validation failed: ' + error.message);
    }
  },

  // Helper methods as object properties
  async ensureMemoryTable() {
    try {
      // Check if memory table exists
      const tables = await new Promise((resolve, reject) => {
        this.connection.all(
          "SELECT table_name as name FROM information_schema.tables WHERE table_schema='main'", 
          (err, rows) => {
            if (err) {
              // Fallback to SHOW TABLES if information_schema fails
              this.connection.all("SHOW TABLES", (err2, rows2) => {
                if (err2) reject(err2);
                else resolve(rows2 || []);
              });
            } else {
              resolve(rows || []);
            }
          }
        );
      });
      
      console.log('UserMemoryAgent: Available tables:', tables?.map(t => t.name) || []);
      
      const memoryTableExists = tables?.some(t => t.name === 'memory');
      
      if (!memoryTableExists) {
        console.log('Memory table does not exist, creating...');
        await this.createMemoryTable();
      } else {
        console.log('Memory table exists, verifying schema...');
        await this.verifyTableSchema();
      }
      
    } catch (error) {
      console.error('[ERROR] Failed to ensure memory table:', error);
      throw error;
    }
  },

  async createMemoryTable() {
    const createTableSQL = `
      CREATE TABLE memory (
        id INTEGER PRIMARY KEY,
        backend_memory_id TEXT UNIQUE,
        source_text TEXT,
        suggested_response TEXT,
        intent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        screenshot_path TEXT,
        ocr_text TEXT,
        metadata TEXT
      )
    `;
    
    await new Promise((resolve, reject) => {
      // For DDL statements like CREATE TABLE, exec is appropriate
      this.connection.exec(createTableSQL, (err) => {
        if (err) {
          console.error('[ERROR] Failed to create memory table:', err);
          reject(err);
        } else {
          console.log('[SUCCESS] Memory table created successfully');
          resolve();
        }
      });
    });
    
    console.log('[SUCCESS] Memory table created');
  },

  async verifyTableSchema(context) {
    try {
      // Test if all required columns exist by running a sample query
      const testQuery = "SELECT id, backend_memory_id, source_text, suggested_response, intent, created_at, updated_at, screenshot_path, ocr_text, metadata FROM memory LIMIT 1";
      
      await new Promise((resolve, reject) => {
        this.connection.all(testQuery, (err, rows) => {
          if (err) {
            console.log('Schema verification failed, will recreate table:', err.message);
            reject(err);
          } else {
            console.log('[SUCCESS] Memory table schema is correct');
            resolve(rows);
          }
        });
      });
      
      return true;
      
    } catch (schemaError) {
      console.log('Recreating memory table due to schema mismatch...');
      
      try {
        // Drop and recreate the table
        await new Promise((resolve, reject) => {
          this.connection.exec('DROP TABLE IF EXISTS memory', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        
        if (!this.connection || !this.db) {
          console.log('[INFO] Connection not initialized, bootstrapping again...');
          await this.bootstrap({}, context || {});
          return true;
        }
        
        // Test the connection
        try {
          const result = await new Promise((resolve, reject) => {
            this.connection.all('SELECT 1 as test', (err, result) => {
              if (err) {
                console.error('[ERROR] Connection validation failed:', err.message);
                reject(err);
              } else {
                resolve(result);
              }
            });
          });
          console.log('[DEBUG] Connection validated successfully');
          return true;
        } catch (error) {
          console.log('[WARN] Connection invalid, attempting to reconnect...');
          
          // PRIORITY 3: If our connection is invalid but context has a valid connection, use that
          if (context && context.connection && context.db) {
            try {
              // Test the context connection
              await new Promise((resolve, reject) => {
                context.connection.all('SELECT 1 as test', (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                });
              });
              
              // Context connection is valid, use it
              console.log('[INFO] Using valid connection from context');
              this.connection = context.connection;
              this.db = context.db;
              return true;
            } catch (contextError) {
              console.warn('[WARN] Context connection also invalid:', contextError.message);
              // Will fall through to reconnection logic below
            }
          }
          
          // PRIORITY 4: Create a new connection
          try {
            // Close existing connection if possible
            try { this.connection.close(); } catch (e) { /* Ignore */ }
            try { this.db.close(); } catch (e) { /* Ignore */ }
            
            // Re-import DuckDB
            const duckdbModule = await import('duckdb');
            const duckdb = duckdbModule.default || duckdbModule;
            
            // Recreate connection
            this.db = new duckdb.Database(this.dbPath);
            this.connection = this.db.connect();
            
            // Test new connection
            await new Promise((resolve, reject) => {
              this.connection.all('SELECT 1 as test', (err, result) => {
                if (err) reject(err);
                else resolve(result);
              });
            });
            
            console.log('[SUCCESS] Connection re-established successfully');
            return true;
          } catch (reconnectError) {
            console.error('[ERROR] Failed to reconnect:', reconnectError);
            throw new Error('Connection Error: Failed to reconnect to database');
          }
        }
      } catch (error) {
        console.error('[ERROR] Connection validation failed:', error);
        throw new Error('Connection Error: ' + error.message);
      }
    }
  },
  
  async storeMemory(params, context) {
    try {
      // Validate connection before proceeding
      await this.validateConnection(context);
      
      const { key, value, screenshot, metadata = {} } = params;
      
      console.log('[UserMemoryAgent] storeMemory called with key:', key, 'value:', value);
      
      if (!key || !value) {
        return { success: false, error: 'Both key and value are required for memory storage' };
      }
      
      // Use connection from context if available, otherwise use this.db
      const db = context?.db || this.db;
      const connection = context?.connection || this.connection;
      
      // Validate connection
      const isValid = await this.validateConnection(context);
      if (!isValid) {
        console.error('[UserMemoryAgent] Database connection is invalid');
        return { success: false, error: 'Database connection is invalid' };
      }
      
      const memoryId = 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const now = new Date().toISOString();
      
      // Prepare screenshot data
      let screenshotPath = null;
      let ocrText = null;
      
      if (screenshot) {
        screenshotPath = screenshot.path || null;
        ocrText = screenshot.ocrText || null;
      }
      
      const insertSQL = `INSERT INTO memory (backend_memory_id, source_text, suggested_response, intent, created_at, updated_at, screenshot_path, ocr_text, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      const values = [
        memoryId,
        key,
        value,
        'memory_store',
        now,
        now,
        screenshotPath,
        ocrText,
        JSON.stringify(metadata)
      ];
      
      console.log('[DEBUG] Executing SQL:', insertSQL);
      console.log('[DEBUG] With values:', values);
      console.log('[DEBUG] Values count:', values.length);
      console.log('[DEBUG] Connection type:', typeof connection);
      console.log('[DEBUG] Connection methods:', Object.getOwnPropertyNames(connection));
      
      await new Promise((resolve, reject) => {
        // Try different DuckDB parameter binding approaches
        if (connection.run) {
          // Method 1: Standard run with callback
          connection.run(insertSQL, values, function(err) {
            if (err) {
              console.error('[ERROR] Method 1 failed:', err);
              // Try method 2: run without callback
              try {
                connection.run(insertSQL, ...values);
                console.log('[SUCCESS] Method 2 worked');
                resolve();
              } catch (err2) {
                console.error('[ERROR] Method 2 failed:', err2);
                reject(err);
              }
            } else {
              console.log('[SUCCESS] Method 1 worked');
              resolve();
            }
          });
        } else if (connection.exec) {
          // Method 3: Use exec with prepared statement
          try {
            const stmt = connection.prepare(insertSQL);
            stmt.run(values);
            stmt.finalize();
            console.log('[SUCCESS] Method 3 worked');
            resolve();
          } catch (err3) {
            console.error('[ERROR] Method 3 failed:', err3);
            reject(err3);
          }
        } else {
          reject(new Error('No suitable method found on connection object'));
        }
      });

      console.log('[SUCCESS] Memory stored successfully: ' + key);
      
      return {
        success: true,
        memoryId: memoryId,
        key: key,
        value: value,
        timestamp: now
      };
    } catch (error) {
      console.error('[ERROR] Memory storage failed:', error);
      return { success: false, error: error.message };
    }
  },

  async retrieveMemory(params, context) {
    try {
      // Validate connection before proceeding
      await this.validateConnection(context);
      
      const { key, memoryId } = params;
      
      if (!key && !memoryId) {
        return { success: false, error: 'Either key or memoryId is required for memory retrieval' };
      }

      console.log('Retrieving memory for: ' + (key || memoryId));
      
      let query, queryParams;
      
      if (memoryId) {
        query = "SELECT * FROM memory WHERE backend_memory_id = ? LIMIT 1";
        queryParams = [memoryId];
      } else {
        query = "SELECT * FROM memory WHERE source_text = ? ORDER BY created_at DESC LIMIT 1";
        queryParams = [key];
      }
      
      // Use connection from context if available, otherwise use this.db
      const db = context?.db || this.db;
      const connection = context?.connection || this.connection;
      
      const result = await new Promise((resolve, reject) => {
        connection.get(query, queryParams, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!result) {
        console.log('Memory not found for: ' + (key || memoryId));
        return {
          success: false,
          error: 'Memory not found',
          key: key,
          memoryId: memoryId
        };
      }
      
      console.log('[SUCCESS] Memory retrieved: ' + result.backend_memory_id);
      
      return {
        success: true,
        memoryId: result.backend_memory_id,
        key: result.source_text,
        value: result.suggested_response,
        intent: result.intent,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
        screenshotPath: result.screenshot_path,
        ocrText: result.ocr_text,
        metadata: result.metadata ? JSON.parse(result.metadata) : {}
      };
      
    } catch (error) {
      console.error('[ERROR] Memory retrieval failed:', error);
      return { success: false, error: error.message };
    }
  },

  async searchMemories(params, context) {
    try {
      // Validate connection before proceeding
      await this.validateConnection(context);
      
      const { query, limit = 25, offset = 0 } = params;
      
      if (!query) {
        return { success: false, error: 'Search query is required' };
      }

      console.log('Searching memories for: "' + query + '"');
      
      const searchQuery = "SELECT * FROM memory WHERE source_text LIKE ? OR suggested_response LIKE ? OR ocr_text LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?";
      const searchParams = [`%${query}%`, `%${query}%`, `%${query}%`, limit, offset];
      
      // Use connection from context if available, otherwise use this.db
      const db = context?.db || this.db;
      const connection = context?.connection || this.connection;
      
      const results = await new Promise((resolve, reject) => {
        connection.all(searchQuery, searchParams, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      const memories = results.map(row => ({
        id: row.backend_memory_id,
        sourceText: row.source_text,
        suggestedResponse: row.suggested_response,
        intent: row.intent,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        screenshotPath: row.screenshot_path,
        ocrText: row.ocr_text,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));

      console.log('Found ' + memories.length + ' memories matching "' + query + '"');
      
      return {
        query: query,
        results: memories,
        count: memories.length,
        limit: limit,
        offset: offset
      };
      
    } catch (error) {
      console.error('[ERROR] Memory search failed:', error);
      return { success: false, error: error.message };
    }
  },

  async deleteMemory(params, context) {
    try {
      // Validate connection before proceeding
      await this.validateConnection(context);
      
      const { memoryId, value } = params;
      const targetId = memoryId || value;
      
      if (!targetId) {
        return { success: false, error: 'Memory ID is required for deletion' };
      }

      console.log('Deleting memory: ' + targetId);
      
      // First verify the record exists
      // Use connection from context if available, otherwise use this.db
      const db = context?.db || this.db;
      const connection = context?.connection || this.connection;
      
      const checkQuery = "SELECT backend_memory_id FROM memory WHERE backend_memory_id = ? LIMIT 1";
      const existingRecord = await new Promise((resolve, reject) => {
        connection.get(checkQuery, [targetId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!existingRecord) {
        console.log('Memory not found: ' + targetId);
        return { success: false, error: 'Memory not found', memoryId: targetId };
      }

      // Delete the record
      const deleteQuery = "DELETE FROM memory WHERE backend_memory_id = ?";
      await new Promise((resolve, reject) => {
        connection.run(deleteQuery, [targetId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log('Memory deleted successfully: ' + targetId);
      
      return {
        success: true,
        memoryId: targetId,
        deleted: true,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('[ERROR] Memory deletion failed:', error);
      return {
        success: false,
        error: error.message,
        memoryId: params.memoryId || params.value
      };
    }
  },

  async listMemories(params, context) {
    try {
      // Validate connection before proceeding
      await this.validateConnection(context);
      
      const { limit = 25, offset = 0 } = params;
      
      console.log('Listing memories (limit: ' + limit + ', offset: ' + offset + ')');
      
      const listQuery = 'SELECT * FROM memory ORDER BY created_at DESC LIMIT ? OFFSET ?';
      
      // Use connection from context if available, otherwise use this.db
      const db = context?.db || this.db;
      const connection = context?.connection || this.connection;
      
      const results = await new Promise((resolve, reject) => {
        connection.all(listQuery, [limit, offset], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      const memories = results.map(row => ({
        id: row.backend_memory_id,
        sourceText: row.source_text,
        suggestedResponse: row.suggested_response,
        intent: row.intent,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        screenshotPath: row.screenshot_path,
        ocrText: row.ocr_text,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));

      // Get total count
      const countQuery = "SELECT COUNT(*) as total FROM memory";
      const countResult = await new Promise((resolve, reject) => {
        connection.get(countQuery, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      const total = countResult.total || 0;
      
      console.log('Listed ' + memories.length + ' memories (' + total + ' total)');
      
      return {
        memories,
        count: memories.length,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
      
    } catch (error) {
      console.error('[ERROR] Memory listing failed:', error);
      return { success: false, error: error.message };
    }
  },

  async storeScreenshot(params, context) {
    try {
      const { screenshotData, ocrText, metadata = {} } = params;
      
      if (!screenshotData) {
        throw new Error('Screenshot data is required');
      }

      console.log('Storing screenshot with memory...');
      
      return this.storeMemory({
        key: 'screenshot',
        value: 'Screenshot captured',
        metadata: {
          ...metadata,
          hasScreenshot: true,
          ocrText,
          captureTime: new Date().toISOString()
        },
        screenshot: {
          path: screenshotData.path,
          ocrText
        }
      }, context);
      
    } catch (error) {
      console.error('[ERROR] Screenshot storage failed:', error);
      throw error;
    }
  }
};

export default AGENT_FORMAT;
