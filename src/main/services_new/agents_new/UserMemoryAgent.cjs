/**
 * UserMemoryAgent - Object-based approach
 * No string parsing, no template literal issues
 * CommonJS format for VM compatibility
 */

const AGENT_FORMAT = {
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
            'memory-semantic-search',
            'memory-delete',
            'memory-update',
            'memory-list',
            'screenshot-store',
            'migrate-embedding-column'
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
        
        const { duckdb } = context;

        // Use connection from coreAgent.context.database if available
        if (context?.database) {
          console.log('[INFO] Using database from coreAgent.context.database');
          this.connection = context.database;
          this.db = context.database; // Store database instance
          
          // Test the connection to make sure it's working
          try {
            let testResult;
            if (typeof this.connection.query === 'function') {
              testResult = await new Promise((resolve, reject) => {
                this.connection.query('SELECT 1 as test', [], (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                });
              });
            } else if (typeof this.connection.all === 'function') {
              testResult = await new Promise((resolve, reject) => {
                this.connection.all('SELECT 1 as test', (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                });
              });
            } else {
              throw new Error('Unsupported database connection interface');
            }
            
            console.log('[SUCCESS] Database connection from context tested successfully');
            
            // Define ensureMemoryTable locally to avoid this binding issues
            const ensureMemoryTable = async () => {
              try {
                // Check if memory table exists
                const tables = await new Promise((resolve, reject) => {
                  // Check if it's a DatabaseManager-style connection (has .query method)
                  if (typeof this.connection.query === 'function') {
                    this.connection.query(
                      "SELECT table_name as name FROM information_schema.tables WHERE table_schema='main'", 
                      [],
                      (err, rows) => {
                        if (err) {
                          // Fallback to SHOW TABLES if information_schema fails
                          this.connection.query("SHOW TABLES", [], (err2, rows2) => {
                            if (err2) reject(err2);
                            else resolve(rows2 || []);
                          });
                        } else {
                          resolve(rows || []);
                        }
                      }
                    );
                  }
                  // Check if it's a direct DuckDB connection (has .all method)
                  else if (typeof this.connection.all === 'function') {
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
                  }
                  else {
                    reject(new Error('Unsupported database connection interface'));
                  }
                });
                
                console.log('UserMemoryAgent: Available tables:', tables?.map(t => t.name) || []);
                
                const memoryTableExists = tables?.some(t => t.name === 'memory');
                
                if (!memoryTableExists) {
                  console.log('Memory table does not exist, creating...');
                  await createMemoryTable();
                } else {
                  console.log('Memory table exists, verifying schema...');
                  // For now, skip schema verification to avoid more this binding issues
                  console.log('Schema verification skipped for bootstrap');
                }
                
              } catch (error) {
                console.error('[ERROR] Failed to ensure memory table:', error);
                throw error;
              }
            };
            
            const createMemoryTable = async () => {
              const createTableSQL = `
                CREATE TABLE IF NOT EXISTS memory (
                  id TEXT PRIMARY KEY,
                  user_id TEXT,
                  type TEXT DEFAULT 'user_memory',
                  primary_intent TEXT,
                  requires_memory_access BOOLEAN DEFAULT false,
                  suggested_response TEXT,
                  source_text TEXT,
                  metadata TEXT,
                  screenshot TEXT,
                  extracted_text TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  synced_to_backend BOOLEAN DEFAULT false,
                  backend_memory_id TEXT,
                  sync_attempts INTEGER DEFAULT 0,
                  last_sync_attempt TIMESTAMP
                )
              `;
              
              // Also create memory_entities table for normalized entity storage
              const createEntitiesTableSQL = `
                CREATE TABLE IF NOT EXISTS memory_entities (
                  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
                  memory_id TEXT NOT NULL,
                  entity TEXT NOT NULL,
                  entity_type TEXT,
                  normalized_value TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (memory_id) REFERENCES memory(id)
                )
              `;
              
              // Create index for better query performance
              const createEntitiesIndexSQL = `
                CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id 
                ON memory_entities(memory_id)
              `;
              
              await new Promise((resolve, reject) => {
                // Check if it's a DatabaseManager-style connection (has .run method)
                if (typeof this.connection.run === 'function') {
                  this.connection.run(createTableSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                }
                // Check if it's a direct DuckDB connection (has .run method)
                else if (typeof this.connection.run === 'function') {
                  this.connection.run(createTableSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                }
                else {
                  reject(new Error('Unsupported database connection interface for table creation'));
                }
              });
              
              // Create memory_entities table
              await new Promise((resolve, reject) => {
                if (typeof this.connection.run === 'function') {
                  this.connection.run(createEntitiesTableSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                }
                else {
                  reject(new Error('Unsupported database connection interface for entities table creation'));
                }
              });
              
              // Create index for memory_entities
              await new Promise((resolve, reject) => {
                if (typeof this.connection.run === 'function') {
                  this.connection.run(createEntitiesIndexSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                }
                else {
                  reject(new Error('Unsupported database connection interface for index creation'));
                }
              });
              
              console.log('[SUCCESS] Memory table created successfully');
            };
            
            // Add migration function to ensure memory_entities table exists
            const ensureMemoryEntitiesTable = async () => {
              try {
                console.log('[INFO] Checking if memory_entities table exists...');
                
                // Check if memory_entities table exists
                let tableExists = false;
                try {
                  if (typeof this.connection.query === 'function') {
                    await new Promise((resolve, reject) => {
                      this.connection.query('SELECT 1 FROM memory_entities LIMIT 1', [], (err, result) => {
                        if (err) {
                          tableExists = false;
                          resolve();
                        } else {
                          tableExists = true;
                          resolve();
                        }
                      });
                    });
                  } else if (typeof this.connection.all === 'function') {
                    await new Promise((resolve, reject) => {
                      this.connection.all('SELECT 1 FROM memory_entities LIMIT 1', (err, result) => {
                        if (err) {
                          tableExists = false;
                          resolve();
                        } else {
                          tableExists = true;
                          resolve();
                        }
                      });
                    });
                  }
                } catch (err) {
                  tableExists = false;
                }
                
                if (!tableExists) {
                  console.log('[INFO] memory_entities table does not exist, creating it...');
                  
                  // Create memory_entities table
                  const createEntitiesTableSQL = `
                    CREATE TABLE IF NOT EXISTS memory_entities (
                      id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
                      memory_id TEXT NOT NULL,
                      entity TEXT NOT NULL,
                      entity_type TEXT,
                      normalized_value TEXT,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                      FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE
                    )
                  `;
                  
                  await new Promise((resolve, reject) => {
                    if (typeof this.connection.run === 'function') {
                      this.connection.run(createEntitiesTableSQL, (err) => {
                        if (err) reject(err);
                        else resolve();
                      });
                    } else if (typeof this.connection.exec === 'function') {
                      this.connection.exec(createEntitiesTableSQL, (err) => {
                        if (err) reject(err);
                        else resolve();
                      });
                    } else {
                      reject(new Error('Unsupported database connection interface for table creation'));
                    }
                  });
                  
                  // Create index for better query performance
                  const createEntitiesIndexSQL = `
                    CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id 
                    ON memory_entities(memory_id)
                  `;
                  
                  await new Promise((resolve, reject) => {
                    if (typeof this.connection.run === 'function') {
                      this.connection.run(createEntitiesIndexSQL, (err) => {
                        if (err) reject(err);
                        else resolve();
                      });
                    } else if (typeof this.connection.exec === 'function') {
                      this.connection.exec(createEntitiesIndexSQL, (err) => {
                        if (err) reject(err);
                        else resolve();
                      });
                    } else {
                      reject(new Error('Unsupported database connection interface for index creation'));
                    }
                  });
                  
                  console.log('[SUCCESS] memory_entities table and index created successfully');
                } else {
                  console.log('[INFO] memory_entities table already exists');
                }
              } catch (err) {
                console.error('[ERROR] Failed to ensure memory_entities table:', err);
                throw err;
              }
            };
            
            // Skip the rest of the bootstrap and just ensure memory table exists
            await ensureMemoryTable();
            await ensureMemoryEntitiesTable();
            console.log('[SUCCESS] UserMemoryAgent bootstrap completed using context database');
            return { success: true, source: 'context_database' };
          } catch (err) {
            console.warn('[WARN] Context database connection test failed:', err.message);
            // Continue with fallback connection setup below
            this.connection = null;
            this.db = null;
          }
        }

        // If no connection from context, establish a new one
        const { path, fs, url } = context;

        // Calculate database path from config or default location
        let dbPath;
        if (config.dbPath) {
          dbPath = config.dbPath;
        } else {
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
              
              this.connection = this.db.connect();
              
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
        // Define helper functions locally to avoid this binding issues
        const ensureMemoryTable = async () => {
          try {
            // Check if memory table exists
            const tables = await new Promise((resolve, reject) => {
              // Check if it's a DatabaseManager-style connection (has .query method)
              if (typeof this.connection.query === 'function') {
                this.connection.query(
                  "SELECT table_name as name FROM information_schema.tables WHERE table_schema='main'", 
                  [],
                  (err, rows) => {
                    if (err) {
                      // Fallback to SHOW TABLES if information_schema fails
                      this.connection.query("SHOW TABLES", [], (err2, rows2) => {
                        if (err2) reject(err2);
                        else resolve(rows2 || []);
                      });
                    } else {
                      resolve(rows || []);
                    }
                  }
                );
              }
              // Check if it's a direct DuckDB connection (has .all method)
              else if (typeof this.connection.all === 'function') {
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
              }
              else {
                reject(new Error('Unsupported database connection interface'));
              }
            });
            
            console.log('UserMemoryAgent: Available tables:', tables?.map(t => t.name) || []);
            
            const memoryTableExists = tables?.some(t => t.name === 'memory');
            
            if (!memoryTableExists) {
              console.log('Memory table does not exist, creating...');
              await createMemoryTable();
            } else {
              console.log('Memory table exists, verifying schema...');
              // For now, skip schema verification to avoid more this binding issues
              console.log('Schema verification skipped for bootstrap');
            }
            
          } catch (error) {
            console.error('[ERROR] Failed to ensure memory table:', error);
            throw error;
          }
        };

        const ensureMemoryEntitiesTableExists = async () => {
          try {
            console.log('[INFO] Checking if memory_entities table exists...');
            
            // Check if memory_entities table exists
            let tableExists = false;
            try {
              if (typeof this.connection.query === 'function') {
                await new Promise((resolve, reject) => {
                  this.connection.query('SELECT 1 FROM memory_entities LIMIT 1', [], (err, result) => {
                    if (err) {
                      tableExists = false;
                      resolve();
                    } else {
                      tableExists = true;
                      resolve();
                    }
                  });
                });
              } else if (typeof this.connection.all === 'function') {
                await new Promise((resolve, reject) => {
                  this.connection.all('SELECT 1 FROM memory_entities LIMIT 1', (err, result) => {
                    if (err) {
                      tableExists = false;
                      resolve();
                    } else {
                      tableExists = true;
                      resolve();
                    }
                  });
                });
              }
            } catch (err) {
              tableExists = false;
            }
            
            if (!tableExists) {
              console.log('[INFO] memory_entities table does not exist, creating it...');
              
              // Create memory_entities table (removed FOREIGN KEY for DuckDB compatibility)
              const createEntitiesTableSQL = `
                CREATE TABLE IF NOT EXISTS memory_entities (
                  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
                  memory_id TEXT NOT NULL,
                  entity TEXT NOT NULL,
                  entity_type TEXT,
                  normalized_value TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
              `;
              
              await new Promise((resolve, reject) => {
                if (typeof this.connection.run === 'function') {
                  this.connection.run(createEntitiesTableSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                } else if (typeof this.connection.exec === 'function') {
                  this.connection.exec(createEntitiesTableSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                } else {
                  reject(new Error('Unsupported database connection interface for table creation'));
                }
              });
              
              // Create index for better query performance
              const createEntitiesIndexSQL = `
                CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id 
                ON memory_entities(memory_id)
              `;
              
              await new Promise((resolve, reject) => {
                if (typeof this.connection.run === 'function') {
                  this.connection.run(createEntitiesIndexSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                } else if (typeof this.connection.exec === 'function') {
                  this.connection.exec(createEntitiesIndexSQL, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                } else {
                  reject(new Error('Unsupported database connection interface for index creation'));
                }
              });
              
              console.log('[SUCCESS] memory_entities table and index created successfully');
            } else {
              console.log('[INFO] memory_entities table already exists');
            }
          } catch (err) {
            console.error('[ERROR] Failed to ensure memory_entities table:', err);
            throw err;
          }
        };
        
        const createMemoryTable = async () => {
          const createTableSQL = `
            CREATE TABLE IF NOT EXISTS memory (
              id TEXT PRIMARY KEY,
              user_id TEXT,
              type TEXT DEFAULT 'user_memory',
              primary_intent TEXT,
              requires_memory_access BOOLEAN DEFAULT false,
              suggested_response TEXT,
              source_text TEXT,
              metadata TEXT,
              screenshot TEXT,
              extracted_text TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              synced_to_backend BOOLEAN DEFAULT false,
              backend_memory_id TEXT,
              sync_attempts INTEGER DEFAULT 0,
              last_sync_attempt TIMESTAMP
            )
          `;
          
          // Also create memory_entities table for normalized entity storage
          const createEntitiesTableSQL = `
            CREATE TABLE IF NOT EXISTS memory_entities (
              id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
              memory_id TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_type TEXT,
              normalized_value TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (memory_id) REFERENCES memory(id)
            )
          `;
          
          // Create index for better query performance
          const createEntitiesIndexSQL = `
            CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id 
            ON memory_entities(memory_id)
          `;
          
          await new Promise((resolve, reject) => {
            // Check if it's a direct DuckDB connection (has .run method)
            if (typeof this.connection.run === 'function') {
              this.connection.run(createTableSQL, (err) => {
                if (err) reject(err);
                else resolve();
              });
            }
            else {
              reject(new Error('Unsupported database connection interface for table creation'));
            }
          });
          
          // Create memory_entities table
          await new Promise((resolve, reject) => {
            if (typeof this.connection.run === 'function') {
              this.connection.run(createEntitiesTableSQL, (err) => {
                if (err) reject(err);
                else resolve();
              });
            }
            else {
              reject(new Error('Unsupported database connection interface for entities table creation'));
            }
          });
          
          // Create index for memory_entities
          await new Promise((resolve, reject) => {
            if (typeof this.connection.run === 'function') {
              this.connection.run(createEntitiesIndexSQL, (err) => {
                if (err) reject(err);
                else resolve();
              });
            }
            else {
              reject(new Error('Unsupported database connection interface for index creation'));
            }
          });
          
          console.log('[SUCCESS] Memory and memory_entities tables created successfully');
        };
        
        await ensureMemoryTable();
        
        // Create memory_entities table directly in bootstrap
        console.log('[INFO] Creating memory_entities table in bootstrap...');
        try {
          const createEntitiesTableSQL = `
            CREATE TABLE IF NOT EXISTS memory_entities (
              id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
              memory_id TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_type TEXT,
              normalized_value TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `;
          
          await new Promise((resolve, reject) => {
            if (typeof this.connection.run === 'function') {
              this.connection.run(createEntitiesTableSQL, (err) => {
                if (err) reject(err);
                else resolve();
              });
            } else if (typeof this.connection.exec === 'function') {
              this.connection.exec(createEntitiesTableSQL, (err) => {
                if (err) reject(err);
                else resolve();
              });
            } else {
              reject(new Error('Unsupported database connection interface for table creation'));
            }
          });
          
          // Create index
          const createEntitiesIndexSQL = `
            CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id 
            ON memory_entities(memory_id)
          `;
          
          await new Promise((resolve, reject) => {
            if (typeof this.connection.run === 'function') {
              this.connection.run(createEntitiesIndexSQL, (err) => {
                if (err) reject(err);
                else resolve();
              });
            } else if (typeof this.connection.exec === 'function') {
              this.connection.exec(createEntitiesIndexSQL, (err) => {
                if (err) reject(err);
                else resolve();
              });
            } else {
              reject(new Error('Unsupported database connection interface for index creation'));
            }
          });
          
          console.log('[SUCCESS] memory_entities table and index created in bootstrap');
        } catch (entitiesError) {
          console.error('[ERROR] Failed to create memory_entities table in bootstrap:', entitiesError.message);
          // Don't throw - continue with bootstrap even if entities table fails
        }
        
        console.log('[SUCCESS] UserMemoryAgent bootstrap completed');
        return { success: true, dbPath: this.dbPath };
        
      } catch (error) {
        console.error('[ERROR] UserMemoryAgent bootstrap failed:', error);
        throw error;
      }
    },
  
    // Migration function to ensure memory_entities table exists
    

    // Object-based execute method - no string parsing needed
    safeJsonStringify(obj, space = null) {
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      }, space);
    },

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
        // Define validateConnection locally to avoid this binding issues
        const validateConnection = async () => {
          if (!this.connection) {
            throw new Error('Database connection not available');
          }
          
          try {
            // Test the connection with a simple query
            await new Promise((resolve, reject) => {
              if (typeof this.connection.all === 'function') {
                this.connection.all('SELECT 1 as test', (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                });
              } else if (typeof this.connection.query === 'function') {
                this.connection.query('SELECT 1 as test', [], (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                });
              } else {
                reject(new Error('Unsupported database connection interface'));
              }
            });
            
            console.log('[SUCCESS] Database connection validated');
          } catch (error) {
            console.error('[ERROR] Database connection validation failed:', error);
            throw new Error('Database connection validation failed: ' + error.message);
          }
        };
        
        await validateConnection();
        console.log(`[INFO] Connection validated, executing ${action}`);
        
        // Ensure memory_entities table exists before any operations
        // const ensureMemoryEntitiesTableExists = async () => {
        //   try {
        //     console.log('[INFO] Checking if memory_entities table exists...');
        //     console.log('[DEBUG] Using database interface for table operations');
            
        //     // Check if memory_entities table exists using the database interface
        //     let tableExists = false;
            
        //     try {
        //       // Try to query the table - if it exists, this will succeed
        //       const testQuery = 'SELECT COUNT(*) as count FROM memory_entities LIMIT 1';
        //       await database.query(testQuery, []);
        //       tableExists = true;
        //       console.log('[INFO] memory_entities table exists');
        //     } catch (err) {
        //       if (err.message && err.message.includes('does not exist')) {
        //         console.log('[INFO] memory_entities table does not exist, will create it');
        //         tableExists = false;
        //       } else {
        //         console.error('[ERROR] Unexpected error checking table existence:', err.message);
        //         throw err;
        //       }
        //     }
            
        //     if (!tableExists) {
        //       console.log('[INFO] memory_entities table does not exist, creating it...');
              
        //       // Create memory_entities table using database interface
        //       const createEntitiesTableSQL = `
        //         CREATE TABLE memory_entities (
        //           id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        //           memory_id TEXT NOT NULL,
        //           entity TEXT NOT NULL,
        //           entity_type TEXT,
        //           normalized_value TEXT,
        //           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        //           FOREIGN KEY (memory_id) REFERENCES memory(id)
        //         )
        //       `;
              
        //       await database.query(createEntitiesTableSQL, []);
        //       console.log('[SUCCESS] memory_entities table created');
              
        //       // Create index for better query performance
        //       const createEntitiesIndexSQL = `
        //         CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id 
        //         ON memory_entities(memory_id)
        //       `;
              
        //       await database.query(createEntitiesIndexSQL, []);
        //       console.log('[SUCCESS] memory_entities index created');
              
        //       // Verify table was actually created by querying it
        //       console.log('[INFO] Verifying memory_entities table creation...');
        //       try {
        //         const verifyQuery = 'SELECT COUNT(*) as count FROM memory_entities';
        //         await database.query(verifyQuery, []);
        //         console.log('[SUCCESS] memory_entities table verified and accessible');
        //       } catch (verifyErr) {
        //         console.error('[ERROR] Table verification failed:', verifyErr.message);
        //         throw new Error('Table creation verification failed: ' + verifyErr.message);
        //       }
        //     } else {
        //       console.log('[INFO] memory_entities table already exists');
        //     }
        //   } catch (err) {
        //     console.error('[ERROR] Failed to ensure memory_entities table:', err);
        //     throw err;
        //   }
        // };
         
        switch (action) {
          case 'memory-store':
          case 'store_context':
          case 'store_intent_classification':
            // Use direct connection for queries
            const directDbConnection = context?.connection || this.connection;
            if (!directDbConnection) {
              throw new Error('No direct database connection available');
            }
            // Implement memory storage directly to avoid this binding issues
            const storeData = params.data || params;
            const memoryId = 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const now = new Date().toISOString();
            console.log('SUGGESTED RESPONSE:', storeData, params)
            
            // Extract data from the intent classification payload
            let sourceText = storeData.sourceText || params.key || 'Unknown';
            
            // Validation: Check if sourceText is a stringified object and reject it
            if (typeof sourceText === 'string' && sourceText.startsWith('{') && sourceText.includes('"message"')) {
              try {
                const parsed = JSON.parse(sourceText);
                if (typeof parsed === 'object' && parsed !== null) {
                  console.log('[SKIP] Rejecting stringified object sourceText:', sourceText.substring(0, 100) + '...');
                  return {
                    success: false,
                    error: 'Rejected stringified object as sourceText',
                    skipped: true,
                    reason: 'sourceText appears to be a stringified JSON object'
                  };
                }
              } catch (e) {
                // If it's not valid JSON, continue with storage
              }
            }
            
            // Additional check for system-generated sourceText
            if (sourceText && sourceText.startsWith('[System Generated]')) {
              console.log('[SKIP] Rejecting system-generated sourceText:', sourceText.substring(0, 100) + '...');
              return {
                success: false,
                error: 'Rejected system-generated sourceText',
                skipped: true,
                reason: 'sourceText is system-generated and not user content'
              };
            }
            
            // Fix: Properly extract suggested response without hardcoded fallback
            let suggestedResponse = storeData.suggestedResponse || params.suggestedResponse || params.value || null;
            
            let primaryIntent = storeData.primaryIntent || 'memory_store';
            let entities = storeData.entities ? JSON.stringify(storeData.entities) : null;
            let metadata = storeData.metadata || {};
            
            // Add additional metadata
            metadata.requiresMemoryAccess = storeData.requiresMemoryAccess || false;
            metadata.captureScreen = storeData.captureScreen || false;
            metadata.timestamp = storeData.timestamp || now;
            
            // Extract screenshot and extracted_text from various sources
            let screenshot = null;
            let extractedText = null;
            
            console.log('[DEBUG] Available context keys:', Object.keys(context));
            
            // Check storeData first
            if (storeData.screenshot) {
              screenshot = storeData.screenshot;
              console.log('[DEBUG] Found screenshot in storeData');
            }
            if (storeData.extracted_text || storeData.extractedText) {
              extractedText = storeData.extracted_text || storeData.extractedText;
              console.log('[DEBUG] Found extracted text in storeData');
            }
            
            // Check workflow context for ScreenCaptureAgent results (agent_result pattern)
            if (context.ScreenCaptureAgent_result && !screenshot) {
              const screenResult = context.ScreenCaptureAgent_result;
            
              if (screenResult.result && screenResult.result.screenshot) {
                const screenshotData = screenResult.result.screenshot;
                // Handle different screenshot data formats
                if (typeof screenshotData === 'string') {
                  screenshot = screenshotData;
                  console.log('[DEBUG] Using screenshot as string directly');
                } else if (typeof screenshotData === 'object' && screenshotData !== null) {
                  // Check for common screenshot object properties
                  if (screenshotData.data) {
                    screenshot = screenshotData.data;
                    console.log('[DEBUG] Extracted screenshot from .data property');
                  } else if (screenshotData.base64) {
                    screenshot = screenshotData.base64;
                    console.log('[DEBUG] Extracted screenshot from .base64 property');
                  } else if (screenshotData.image) {
                    screenshot = screenshotData.image;
                    console.log('[DEBUG] Extracted screenshot from .image property');
                  } else if (screenshotData.buffer) {
                    screenshot = screenshotData.buffer;
                    console.log('[DEBUG] Extracted screenshot from .buffer property');
                  } else {
                    // Try to stringify properly or get first property
                    const keys = Object.keys(screenshotData);
                    if (keys.length > 0) {
                      screenshot = screenshotData[keys[0]];
                      console.log(`[DEBUG] Using first property '${keys[0]}' as screenshot data`);
                    } else {
                      console.log('[DEBUG] Screenshot object is empty, skipping');
                    }
                  }
                } else {
                  console.log('[DEBUG] Screenshot data is not string or object, skipping');
                }
              }
              if (screenResult.result && (screenResult.result.extracted_text || screenResult.result.extractedText)) {
                extractedText = screenResult.result.extracted_text || screenResult.result.extractedText;
                console.log('[DEBUG] Extracted text from ScreenCaptureAgent_result');
              }
            }
            
            // Check step results (step_X_result pattern)
            for (let i = 0; i < 10; i++) { // Check first 10 steps
              const stepKey = `step_${i}_result`;
              if (context[stepKey] && context[stepKey].result) {
                const stepResult = context[stepKey].result;
                
                if (stepResult.screenshot && !screenshot) {
                  screenshot = stepResult.screenshot;
                  console.log(`[DEBUG] Found screenshot in ${stepKey}`);
                }
                if ((stepResult.extracted_text || stepResult.extractedText) && !extractedText) {
                  extractedText = stepResult.extracted_text || stepResult.extractedText;
                  console.log(`[DEBUG] Found extracted text in ${stepKey}`);
                }
              }
            }
            
            // Check previousResults array
            if (context.previousResults && Array.isArray(context.previousResults)) {
              for (const prevResult of context.previousResults) {
                if (prevResult.result) {
                  if (prevResult.result.screenshot && !screenshot) {
                    screenshot = prevResult.result.screenshot;
                    console.log('[DEBUG] Found screenshot in previousResults');
                  }
                  if ((prevResult.result.extracted_text || prevResult.result.extractedText) && !extractedText) {
                    extractedText = prevResult.result.extracted_text || prevResult.result.extractedText;
                    console.log('[DEBUG] Found extracted text in previousResults');
                  }
                }
              }
            }
            
            // Check context for workflow results
            if (context.workflowResults && Array.isArray(context.workflowResults)) {
              for (const result of context.workflowResults) {
                if (result.screenshot && !screenshot) {
                  screenshot = result.screenshot;
                }
                if ((result.extracted_text || result.extractedText) && !extractedText) {
                  extractedText = result.extracted_text || result.extractedText;
                }
              }
            }
            
            // Check context.extractedData (from AgentOrchestrator workflow extraction)
            if (context.extractedData) {
              if (context.extractedData.screenshot && !screenshot) {
                screenshot = context.extractedData.screenshot;
              }
              if (context.extractedData.extractedText && !extractedText) {
                extractedText = context.extractedData.extractedText;
              }
            }
            
            // Check if context has direct screenshot/extracted_text fields
            if (context.screenshot && !screenshot) {
              screenshot = context.screenshot;
            }
            if ((context.extracted_text || context.extractedText) && !extractedText) {
              extractedText = context.extracted_text || context.extractedText;
            }
            
            if (screenshot) {
              console.log('[DEBUG] Screenshot length:', screenshot.length);
            }
            if (extractedText) {
              console.log('[DEBUG] Extracted text preview:', extractedText.substring(0, 100) + '...');
            }
            
            const insertSQL = `INSERT INTO memory (
              id, user_id, type, primary_intent, requires_memory_access, 
              suggested_response, source_text, metadata, screenshot, extracted_text,
              created_at, updated_at, synced_to_backend, backend_memory_id, 
              sync_attempts, last_sync_attempt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
            const values = [
              memoryId,
              'default_user', // TODO: Get actual user ID from context
              'intent_classification',
              primaryIntent,
              metadata.requiresMemoryAccess,
              suggestedResponse,
              sourceText,
              JSON.stringify(metadata),
              screenshot, // Now properly extracted from context/storeData
              extractedText, // Now properly extracted from context/storeData
              now,
              now,
              false, // synced_to_backend
              null, // backend_memory_id
              0, // sync_attempts
              null // last_sync_attempt
            ];
            
            try {
              // Get the database manager from context
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available in context');
              }
              
              const insertResult = await database.run(insertSQL, values);
              
              // Store entities in memory_entities table if they exist
              if (storeData.entities && Array.isArray(storeData.entities) && storeData.entities.length > 0) {
                console.log(`[INFO] Storing ${storeData.entities.length} entities for memory ${memoryId}`);
                
                for (const entity of storeData.entities) {
                  let entityText, entityType;
                  
                  if (typeof entity === 'string') {
                    entityText = entity;
                    entityType = 'general';
                  } else if (typeof entity === 'object' && entity !== null) {
                    entityText = entity.entity || entity.value || entity.text || JSON.stringify(entity);
                    entityType = entity.type || entity.entity_type || 'general';
                  } else {
                    entityText = String(entity);
                    entityType = 'general';
                  }
                  
                  const entityInsertSQL = `INSERT INTO memory_entities (
                    memory_id, entity, entity_type, normalized_value, created_at
                  ) VALUES (?, ?, ?, ?, ?)`;
                  
                  // Extract normalized_value if available
                  let normalizedValue = null;
                  if (typeof entity === 'object' && entity.normalized_value) {
                    normalizedValue = entity.normalized_value;
                  }
                  
                  const entityValues = [memoryId, entityText, entityType, normalizedValue, now];
                  
                  try {
                    await database.run(entityInsertSQL, entityValues);
                    console.log(`[SUCCESS] Stored entity: ${entityText} (${entityType})`);
                  } catch (entityError) {
                    console.error(`[ERROR] Failed to store entity ${entityText}:`, entityError);
                    // Continue with other entities even if one fails
                  }
                }
              }

              // Add a small delay to ensure any async operations complete
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Try to get a fresh connection and verify the memory was actually stored
              // try {
              //   console.log('[VERIFY] Attempting to verify memory storage...');
                
              //   // First, let's check if the table exists and has any data
              //   const tableCheckQuery = 'SELECT COUNT(*) as total FROM memory';
              //   const tableCheckResult = await database.query(tableCheckQuery, []);
              //   // console.log(`[VERIFY] Total memories in table:`, tableCheckResult);
                
              //   // Now check for our specific memory
              //   const verifyQuery = 'SELECT * FROM memory WHERE id = ?';
              //   const verifyResult = await database.query(verifyQuery, [memoryId]);
              //   // console.log(`[VERIFY] Memory verification query result:`, safeJsonStringify(verifyResult));
                
              //   if (verifyResult && verifyResult.length > 0) {
              //     console.log(`[VERIFY] ✅ Memory ${memoryId} confirmed in database`);
              //   } else {
              //     console.log(`[VERIFY] ❌ Memory ${memoryId} NOT found in database after storage!`);
                  
              //     // Try a broader query to see if any memories exist
              //     const allMemoriesQuery = 'SELECT id, created_at FROM memory ORDER BY created_at DESC LIMIT 5';
              //     const allMemoriesResult = await database.query(allMemoriesQuery, []);
              //     console.log(`[VERIFY] Recent memories in database:`, allMemoriesResult);
              //   }
              // } catch (verifyError) {
              //   console.error('[VERIFY] Error verifying memory storage:', verifyError);
              // }
              
              return {
                success: true,
                message: 'Memory stored successfully',
                memoryId: memoryId,
                sourceText: sourceText,
                suggestedResponse: suggestedResponse
              };
            } catch (error) {
              console.error('[ERROR] Memory storage failed:', error);
              throw new Error('Memory storage failed: ' + error.message);
            }
            
          case 'query_memories':
          case 'memory-retrieve':
            // Retrieve memories with pagination support
            try {
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available');
              }
              
              // Extract parameters from the intent payload
              const searchQuery = params.searchQuery || null;
              const limit = params.pagination?.limit || params.limit || 50;
              const offset = params.pagination?.offset || params.offset || 0;
              
              console.log(`[INFO] Memory retrieve - searchQuery: ${searchQuery}, limit: ${limit}, offset: ${offset}`);
              
              let sql, queryParams, countSql, countParams;
              
              if (searchQuery) {
                // Search with query - join with entities table
                sql = `SELECT m.*, 
                       GROUP_CONCAT(e.entity) as entity_list,
                       GROUP_CONCAT(e.entity_type) as entity_type_list
                       FROM memory m 
                       LEFT JOIN memory_entities e ON m.id = e.memory_id 
                       WHERE (m.source_text LIKE ? OR m.suggested_response LIKE ? OR m.id LIKE ? OR e.entity LIKE ?) 
                       GROUP BY m.id, m.user_id, m.type, m.primary_intent, m.source_text, m.suggested_response, m.metadata, m.screenshot, m.extracted_text, m.created_at, m.updated_at, m.synced_to_backend, m.backend_memory_id, m.sync_attempts, m.last_sync_attempt, m.requires_memory_access 
                       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
                queryParams = [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, limit, offset];
                countSql = `SELECT COUNT(DISTINCT m.id) as total FROM memory m 
                           LEFT JOIN memory_entities e ON m.id = e.memory_id 
                           WHERE (m.source_text LIKE ? OR m.suggested_response LIKE ? OR m.id LIKE ? OR e.entity LIKE ?)`;
                countParams = [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`];
              } else {
                // Retrieve all memories with pagination - join with entities table
                sql = `SELECT m.*, 
                       GROUP_CONCAT(e.entity) as entity_list,
                       GROUP_CONCAT(e.entity_type) as entity_type_list
                       FROM memory m 
                       LEFT JOIN memory_entities e ON m.id = e.memory_id 
                       GROUP BY m.id, m.user_id, m.type, m.primary_intent, m.source_text, m.suggested_response, m.metadata, m.screenshot, m.extracted_text, m.created_at, m.updated_at, m.synced_to_backend, m.backend_memory_id, m.sync_attempts, m.last_sync_attempt, m.requires_memory_access 
                       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
                queryParams = [limit, offset];
                countSql = `SELECT COUNT(*) as total FROM memory`;
                countParams = [];
              }
              
              // Execute queries
              const memories = await database.query(sql, queryParams);
              const countResult = await database.query(countSql, countParams);
              
              const totalCount = countResult && countResult[0] ? countResult[0].total : memories.length;
              
              console.log(`[SUCCESS] Retrieved ${memories.length} memories (${offset}-${offset + memories.length} of ${totalCount})`);
              
              // Process memories to ensure screenshot and extracted_text are properly handled
              const processedMemories = memories.map(memory => {
                // Parse metadata if it's a string
                let metadata = memory.metadata;
                if (typeof metadata === 'string') {
                  try {
                    metadata = JSON.parse(metadata);
                  } catch (e) {
                    metadata = {};
                  }
                }
                
                // Process entities from the joined query
                let entities = [];
                if (memory.entity_list && memory.entity_list.trim()) {
                  // Split the concatenated entities and filter out empty strings
                  entities = memory.entity_list.split(',').filter(entity => entity && entity.trim()).map(entity => entity.trim());
                }
                
                return {
                  ...memory,
                  metadata: metadata,
                  entities: entities, // Add entities array for frontend
                  // Ensure screenshot and extracted_text are included
                  screenshot: memory.screenshot || null,
                  extracted_text: memory.extracted_text || null,
                  // Add computed fields for frontend compatibility
                  hasScreenshot: !!memory.screenshot,
                  hasExtractedText: !!memory.extracted_text,
                  // Remove the concatenated fields as they're not needed by frontend
                  entity_list: undefined,
                  entity_type_list: undefined
                };
              });
              
              return {
                success: true,
                action: 'memory-retrieve',
                data: {
                  memories: processedMemories,
                  pagination: {
                    total: totalCount,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + memories.length < totalCount
                  }
                },
                searchQuery: searchQuery,
                count: memories.length,
                totalCount: totalCount
              };
            } catch (error) {
              console.error('[ERROR] Memory retrieve failed:', error);
              throw new Error('Memory retrieve failed: ' + error.message);
            }
            
          case 'memory-search':
            // Search memories with advanced filtering
            const searchQuery = params.query || params.searchText;
            const searchType = params.type || 'all';
            const limit = params.limit || 20;
            
            if (!searchQuery) {
              throw new Error('Memory search requires query parameter');
            }
            
            try {
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available');
              }
              
              let sql = `
                SELECT m.*, 
                       GROUP_CONCAT(e.entity) as entity_list,
                       GROUP_CONCAT(e.entity_type) as entity_type_list
                FROM memory m 
                LEFT JOIN memory_entities e ON m.id = e.memory_id 
                WHERE (m.source_text LIKE ? OR m.suggested_response LIKE ? OR m.metadata LIKE ? OR e.entity LIKE ?)
              `;
              let queryParams = [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`];
              
              if (searchType !== 'all') {
                sql += ' AND m.type = ?';
                queryParams.push(searchType);
              }
              
              sql += ' GROUP BY m.id, m.user_id, m.type, m.primary_intent, m.source_text, m.suggested_response, m.metadata, m.screenshot, m.extracted_text, m.created_at, m.updated_at, m.synced_to_backend, m.backend_memory_id, m.sync_attempts, m.last_sync_attempt, m.requires_memory_access ORDER BY m.created_at DESC LIMIT ?';
              queryParams.push(limit);
              
              const results = await database.query(sql, queryParams);
              
              // Process search results to include entities
              const processedResults = results.map(memory => {
                // Parse metadata if it's a string
                let metadata = memory.metadata;
                if (typeof metadata === 'string') {
                  try {
                    metadata = JSON.parse(metadata);
                  } catch (e) {
                    metadata = {};
                  }
                }
                
                // Process entities from the joined query
                let entities = [];
                if (memory.entity_list && memory.entity_list.trim()) {
                  entities = memory.entity_list.split(',').filter(entity => entity && entity.trim()).map(entity => entity.trim());
                }
                
                return {
                  ...memory,
                  metadata: metadata,
                  entities: entities,
                  // Remove the concatenated fields
                  entity_list: undefined,
                  entity_type_list: undefined
                };
              });
              
              console.log(`[SUCCESS] Found ${processedResults.length} memories matching search`);
              return {
                success: true,
                action: 'memory-search',
                query: searchQuery,
                type: searchType,
                results: processedResults,
                count: processedResults.length
              };
            } catch (error) {
              console.error('[ERROR] Memory search failed:', error);
              throw new Error('Memory search failed: ' + error.message);
            }
            
          case 'memory-semantic-search':
            // Semantic search memories using embeddings
            const semanticQuery = params.query || params.searchText;
            const semanticLimit = params.limit || 3;
            const timeWindow = params.timeWindow || null; // e.g., '7 days', '1 month'
            const minSimilarity = params.minSimilarity || 0.3;
            
            if (!semanticQuery) {
              throw new Error('Semantic search requires query parameter');
            }
            
            try {
              console.log(`[INFO] Performing semantic search for: "${semanticQuery}"`);
              
              // Generate embedding for the search query
              let queryEmbedding = null;
              if (context?.coreAgent) {
                const embeddingResult = await context.coreAgent.ask({
                  agent: 'SemanticEmbeddingAgent',
                  action: 'generate-embedding',
                  text: semanticQuery
                });
                
                if (embeddingResult.success && embeddingResult.embedding) {
                  queryEmbedding = embeddingResult.embedding;
                  console.log(`[SUCCESS] Generated query embedding with ${queryEmbedding.length} dimensions`);
                } else {
                  throw new Error('Failed to generate query embedding: ' + embeddingResult.error);
                }
              } else {
                throw new Error('CoreAgent not available for embedding generation');
              }
              
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available');
              }
              
              // Build SQL query with optional time filtering
              let sql = `
                SELECT id, backend_memory_id, source_text, suggested_response, intent, 
                       created_at, updated_at, screenshot_path, ocr_text, metadata, embedding
                FROM memory 
                WHERE embedding IS NOT NULL
              `;
              let queryParams = [];
              
              if (timeWindow) {
                sql += ` AND created_at > datetime('now', '-${timeWindow}')`;
              }
              
              sql += ` ORDER BY created_at DESC`;
              
              const memories = await database.all(sql, queryParams);
              console.log(`[INFO] Found ${memories.length} memories with embeddings`);
              
              if (memories.length === 0) {
                return {
                  success: true,
                  action: 'memory-semantic-search',
                  query: semanticQuery,
                  results: [],
                  count: 0,
                  message: 'No memories with embeddings found'
                };
              }
              
              // Calculate similarities and rank results
              const rankedResults = [];
              
              for (const memory of memories) {
                try {
                  const memoryEmbedding = JSON.parse(memory.embedding);
                  
                  // Calculate cosine similarity using SemanticEmbeddingAgent
                  const similarityResult = await context.coreAgent.ask({
                    agent: 'SemanticEmbeddingAgent',
                    action: 'calculate-similarity',
                    embedding1: queryEmbedding,
                    embedding2: memoryEmbedding
                  });
                  
                  if (similarityResult.success && similarityResult.similarity >= minSimilarity) {
                    rankedResults.push({
                      ...memory,
                      similarity: similarityResult.similarity,
                      embedding: undefined // Remove embedding from response to save space
                    });
                  }
                } catch (error) {
                  console.warn(`[WARN] Failed to calculate similarity for memory ${memory.id}:`, error.message);
                }
              }
              
              // Sort by similarity (highest first) and limit results
              rankedResults.sort((a, b) => b.similarity - a.similarity);
              const topResults = rankedResults.slice(0, semanticLimit);
              
              console.log(`[SUCCESS] Found ${topResults.length} semantically similar memories`);
              
              return {
                success: true,
                action: 'memory-semantic-search',
                query: semanticQuery,
                results: topResults,
                count: topResults.length,
                totalMemories: memories.length,
                minSimilarity: minSimilarity,
                timeWindow: timeWindow
              };
              
            } catch (error) {
              console.error('[ERROR] Semantic search failed:', error);
              throw new Error('Semantic search failed: ' + error.message);
            }
            
          case 'memory-delete':
            // Delete memory by ID
            const deleteId = params.memoryId || params.id;
            if (!deleteId) {
              throw new Error('Memory delete requires memoryId parameter');
            }
            
            try {
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available');
              }
              
              const deleteSQL = 'DELETE FROM memory WHERE id = ?';
              await database.run(deleteSQL, [deleteId]);
              console.log(`[SUCCESS] Memory ${deleteId} deleted successfully`);
              
              return {
                success: true,
                action: 'memory-delete',
                memoryId: deleteId,
                message: 'Memory deleted successfully'
              };
            } catch (error) {
              console.error('[ERROR] Memory delete failed:', error);
              throw new Error('Memory delete failed: ' + error.message);
            }
            
          case 'memory-update':
            // Update existing memory
            const updateId = params.memoryId || params.id;
            const updateData = params.data || {};
            
            if (!updateId) {
              throw new Error('Memory update requires memoryId parameter');
            }
            
            try {
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available');
              }
              
              const now = new Date().toISOString();
              const updateFields = [];
              const updateValues = [];
              
              // Build dynamic update query based on provided data
              if (updateData.sourceText) {
                updateFields.push('source_text = ?');
                updateValues.push(updateData.sourceText);
              }
              if (updateData.suggestedResponse) {
                updateFields.push('suggested_response = ?');
                updateValues.push(updateData.suggestedResponse);
              }
              if (updateData.metadata) {
                updateFields.push('metadata = ?');
                updateValues.push(JSON.stringify(updateData.metadata));
              }
              if (updateData.type) {
                updateFields.push('type = ?');
                updateValues.push(updateData.type);
              }
              
              if (updateFields.length === 0) {
                throw new Error('No update fields provided');
              }
              
              updateFields.push('updated_at = ?');
              updateValues.push(now);
              updateValues.push(updateId);
              
              const updateSQL = `UPDATE memory SET ${updateFields.join(', ')} WHERE id = ?`;
              
              await database.run(updateSQL, updateValues);
              console.log(`[SUCCESS] Memory ${updateId} updated successfully`);
              
              return {
                success: true,
                action: 'memory-update',
                memoryId: updateId,
                updatedFields: updateFields.length - 1, // Exclude updated_at
                message: 'Memory updated successfully'
              };
            } catch (error) {
              console.error('[ERROR] Memory update failed:', error);
              throw new Error('Memory update failed: ' + error.message);
            }
            
          case 'memory-list':
            // List all memories with optional filtering
            const listType = params.type || 'all';
            const listLimit = params.limit || 50;
            const listOffset = params.offset || 0;
            
            try {
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available');
              }
              
              let listSQL = 'SELECT * FROM memory';
              let listParams = [];
              
              if (listType !== 'all') {
                listSQL += ' WHERE type = ?';
                listParams.push(listType);
              }
              
              listSQL += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
              listParams.push(listLimit, listOffset);
              
              const results = await database.query(listSQL, listParams);
              
              // Get total count
              let countSQL = 'SELECT COUNT(*) as total FROM memory';
              let countParams = [];
              
              if (listType !== 'all') {
                countSQL += ' WHERE type = ?';
                countParams.push(listType);
              }
              
              const countRows = await database.query(countSQL, countParams);
              const countResult = countRows[0]?.total || 0;
              
              console.log(`[SUCCESS] Listed ${results.length} memories (${countResult} total)`);
              return {
                success: true,
                action: 'memory-list',
                type: listType,
                results: results,
                count: results.length,
                total: countResult,
                limit: listLimit,
                offset: listOffset
              };
            } catch (error) {
              console.error('[ERROR] Memory list failed:', error);
              throw new Error('Memory list failed: ' + error.message);
            }
            
          case 'screenshot-store':
            // Store screenshot with memory
            const screenshotData = params.screenshot || params.data;
            const screenshotText = params.extractedText || params.text;
            const screenshotContext = params.context || {};
            
            if (!screenshotData) {
              throw new Error('Screenshot store requires screenshot data');
            }
            
            try {
              const database = context.database;
              if (!database) {
                throw new Error('No database connection available');
              }
              
              const memoryId = 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
              const now = new Date().toISOString();
              
              const insertSQL = `INSERT INTO memory (
                id, user_id, type, primary_intent, requires_memory_access, 
                suggested_response, source_text, metadata, screenshot, extracted_text,
                created_at, updated_at, synced_to_backend, backend_memory_id, 
                sync_attempts, last_sync_attempt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
              
              const values = [
                memoryId,
                'default_user',
                'screenshot',
                'screenshot_capture',
                false,
                'Screenshot captured and stored',
                screenshotContext.description || 'Screenshot captured',
                JSON.stringify(screenshotContext),
                screenshotData, // Store screenshot data
                screenshotText, // Store extracted text
                now,
                now,
                false,
                null,
                0,
                null
              ];
              
              await database.run(insertSQL, values);
              console.log('[SUCCESS] Screenshot stored successfully');
              
              return {
                success: true,
                action: 'screenshot-store',
                memoryId: memoryId,
                hasExtractedText: !!screenshotText,
                message: 'Screenshot stored successfully'
              };
            } catch (error) {
              console.error('[ERROR] Screenshot storage failed:', error);
              throw new Error('Screenshot storage failed: ' + error.message);
            }
            
          case 'migrate-embedding-column':
            // Migrate existing memory table to add embedding column
            try {
              console.log('[INFO] Starting embedding column migration...');
              
              const migrationResult = await this.migrateMemoryTableForEmbeddings(context);
              
              if (migrationResult.success) {
                console.log(`[SUCCESS] Migration completed: ${migrationResult.message}`);
                return {
                  success: true,
                  action: 'migrate-embedding-column',
                  migrated: migrationResult.migrated,
                  message: migrationResult.message
                };
              } else {
                throw new Error(migrationResult.error);
              }
              
            } catch (error) {
              console.error('[ERROR] Embedding column migration failed:', error);
              throw new Error('Migration failed: ' + error.message);
            }
            
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
        // Check if it's a DatabaseManager-style connection (has .query method)
        if (typeof connection.query === 'function') {
          await new Promise((resolve, reject) => {
            connection.query('SELECT 1 as test', [], (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
        }
        // Check if it's a direct DuckDB connection (has .all method)
        else if (typeof connection.all === 'function') {
          await new Promise((resolve, reject) => {
            connection.all('SELECT 1 as test', (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
        }
        else {
          throw new Error('Unsupported database connection interface');
        }
        
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
          // Check if it's a DatabaseManager-style connection (has .query method)
          if (typeof this.connection.query === 'function') {
            this.connection.query(
              "SELECT table_name as name FROM information_schema.tables WHERE table_schema='main'", 
              [],
              (err, rows) => {
                if (err) {
                  // Fallback to SHOW TABLES if information_schema fails
                  this.connection.query("SHOW TABLES", [], (err2, rows2) => {
                    if (err2) reject(err2);
                    else resolve(rows2 || []);
                  });
                } else {
                  resolve(rows || []);
                }
              }
            );
          }
          // Check if it's a direct DuckDB connection (has .all method)
          else if (typeof this.connection.all === 'function') {
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
          }
          else {
            reject(new Error('Unsupported database connection interface'));
          }
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
  
    // Migration function to add embedding column to existing memory tables
    async migrateMemoryTableForEmbeddings(context) {
      try {
        console.log('[INFO] Checking if memory table needs embedding column migration...');
        
        const connection = context?.connection || this.connection;
        const db = context?.db || this.db;
        
        if (!connection || !db) {
          throw new Error('Database connection not available for migration');
        }
        
        // Check if embedding column already exists
        const checkColumnSQL = `
          SELECT COUNT(*) as column_exists 
          FROM pragma_table_info('memory') 
          WHERE name = 'embedding'
        `;
        
        const columnCheck = await new Promise((resolve, reject) => {
          if (typeof connection.all === 'function') {
            connection.all(checkColumnSQL, (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          } else if (typeof connection.query === 'function') {
            connection.query(checkColumnSQL, [], (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          } else {
            reject(new Error('Unsupported database connection interface'));
          }
        });
        
        const columnExists = columnCheck[0]?.column_exists > 0;
        
        if (columnExists) {
          console.log('[INFO] Embedding column already exists, no migration needed');
          return { success: true, migrated: false, message: 'Column already exists' };
        }
        
        console.log('[INFO] Adding embedding column to memory table...');
        
        // Add the embedding column
        const addColumnSQL = `ALTER TABLE memory ADD COLUMN embedding FLOAT[384]`;
        
        await new Promise((resolve, reject) => {
          if (typeof connection.run === 'function') {
            connection.run(addColumnSQL, function(err) {
              if (err) reject(err);
              else resolve();
            });
          } else if (typeof connection.exec === 'function') {
            try {
              const stmt = connection.prepare(addColumnSQL);
              stmt.run();
              stmt.finalize();
              resolve();
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error('Unsupported database connection interface'));
          }
        });
        
        console.log('[SUCCESS] Embedding column added to memory table');
        
        return { 
          success: true, 
          migrated: true, 
          message: 'Embedding column added successfully' 
        };
        
      } catch (error) {
        console.error('[ERROR] Memory table migration failed:', error);
        return { 
          success: false, 
          error: error.message,
          message: 'Migration failed: ' + error.message
        };
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
          metadata TEXT,
          embedding FLOAT[384]
        )
      `;
      
      // Also create memory_entities table for normalized entity storage
      const createEntitiesTableSQL = `
        CREATE TABLE IF NOT EXISTS memory_entities (
          id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
          memory_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_type TEXT,
          normalized_value TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory(id)
        )
      `;
      
      // Create index for better query performance
      const createEntitiesIndexSQL = `
        CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id 
        ON memory_entities(memory_id)
      `;
      
      await new Promise((resolve, reject) => {
        // Check if it's a DatabaseManager-style connection (has .run method)
        if (typeof this.connection.run === 'function') {
          this.connection.run(createTableSQL, [], (err) => {
            if (err) {
              console.error('[ERROR] Failed to create memory table:', err);
              reject(err);
            } else {
              console.log('[SUCCESS] Memory table created successfully');
              resolve();
            }
          });
        }
        // Check if it's a direct DuckDB connection (has .exec method)
        else if (typeof this.connection.exec === 'function') {
          this.connection.exec(createTableSQL, (err) => {
            if (err) {
              console.error('[ERROR] Failed to create memory table:', err);
              reject(err);
            } else {
              console.log('[SUCCESS] Memory table created successfully');
              resolve();
            }
          });
        }
        else {
          reject(new Error('Unsupported database connection interface for table creation'));
        }
      });
      
      // Create memory_entities table
      await new Promise((resolve, reject) => {
        if (typeof this.connection.run === 'function') {
          this.connection.run(createEntitiesTableSQL, [], (err) => {
            if (err) {
              console.error('[ERROR] Failed to create memory_entities table:', err);
              reject(err);
            } else {
              console.log('[SUCCESS] Memory_entities table created successfully');
              resolve();
            }
          });
        }
        else if (typeof this.connection.exec === 'function') {
          this.connection.exec(createEntitiesTableSQL, (err) => {
            if (err) {
              console.error('[ERROR] Failed to create memory_entities table:', err);
              reject(err);
            } else {
              console.log('[SUCCESS] Memory_entities table created successfully');
              resolve();
            }
          });
        }
        else {
          reject(new Error('Unsupported database connection interface for entities table creation'));
        }
      });
      
      // Create index for memory_entities
      await new Promise((resolve, reject) => {
        if (typeof this.connection.run === 'function') {
          this.connection.run(createEntitiesIndexSQL, [], (err) => {
            if (err) {
              console.error('[ERROR] Failed to create memory_entities index:', err);
              reject(err);
            } else {
              console.log('[SUCCESS] Memory_entities index created successfully');
              resolve();
            }
          });
        }
        else if (typeof this.connection.exec === 'function') {
          this.connection.exec(createEntitiesIndexSQL, (err) => {
            if (err) {
              console.error('[ERROR] Failed to create memory_entities index:', err);
              reject(err);
            } else {
              console.log('[SUCCESS] Memory_entities index created successfully');
              resolve();
            }
          });
        }
        else {
          reject(new Error('Unsupported database connection interface for index creation'));
        }
      });
      
      console.log('[SUCCESS] Memory and memory_entities tables created');
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
        
        // Generate semantic embedding for the memory content
        let embedding = null;
        try {
          // Create text for embedding (combine key and value for better semantic representation)
          const embeddingText = `${key}: ${value}`;
          
          // Try to use SemanticEmbeddingAgent if available in context
          if (context?.coreAgent) {
            console.log('[INFO] Generating semantic embedding for memory...');
            const embeddingResult = await context.coreAgent.ask({
              agent: 'SemanticEmbeddingAgent',
              action: 'generate-embedding',
              text: embeddingText
            });
            
            if (embeddingResult.success && embeddingResult.embedding) {
              embedding = embeddingResult.embedding;
              console.log(`[SUCCESS] Generated embedding with ${embedding.length} dimensions`);
            } else {
              console.warn('[WARN] Failed to generate embedding:', embeddingResult.error);
            }
          } else {
            console.log('[INFO] CoreAgent not available, storing memory without embedding');
          }
        } catch (error) {
          console.warn('[WARN] Embedding generation failed, storing memory without embedding:', error.message);
        }
        
        const insertSQL = `INSERT INTO memory (backend_memory_id, source_text, suggested_response, intent, created_at, updated_at, screenshot_path, ocr_text, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        const values = [
          memoryId,
          key,
          value,
          'memory_store',
          now,
          now,
          screenshotPath,
          ocrText,
          JSON.stringify(metadata),
          embedding ? JSON.stringify(embedding) : null
        ];
        
        await new Promise((resolve, reject) => {
          // Check if it's a DatabaseManager-style connection (has .run method)
          if (typeof connection.run === 'function') {
            connection.run(insertSQL, values, function(err) {
              if (err) {
                console.error('[ERROR] DatabaseManager run failed:', err);
                reject(err);
              } else {
                console.log('[SUCCESS] DatabaseManager run worked');
                resolve();
              }
            });
          }
          // Check if it's a direct DuckDB connection (has .exec method)
          else if (typeof connection.exec === 'function') {
            try {
              const stmt = connection.prepare(insertSQL);
              stmt.run(values);
              stmt.finalize();
              console.log('[SUCCESS] Direct DuckDB exec worked');
              resolve();
            } catch (err) {
              console.error('[ERROR] Direct DuckDB exec failed:', err);
              reject(err);
            }
          }
          else {
            reject(new Error('Unsupported database connection interface for memory storage'));
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
          // Check if it's a DatabaseManager-style connection (has .query method)
          if (typeof connection.query === 'function') {
            connection.query(query, queryParams, (err, rows) => {
              if (err) reject(err);
              else resolve(rows && rows.length > 0 ? rows[0] : null);
            });
          }
          // Check if it's a direct DuckDB connection (has .get method)
          else if (typeof connection.get === 'function') {
            connection.get(query, queryParams, (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory retrieval'));
          }
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
          // Check if it's a DatabaseManager-style connection (has .query method)
          if (typeof connection.query === 'function') {
            connection.query(searchQuery, searchParams, (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          }
          // Check if it's a direct DuckDB connection (has .all method)
          else if (typeof connection.all === 'function') {
            connection.all(searchQuery, searchParams, (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory search'));
          }
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
        
        const checkQuery = "SELECT * FROM memory WHERE id = ? LIMIT 1";
        const existingRecord = await new Promise((resolve, reject) => {
          // Check if it's a DatabaseManager-style connection (has .query method)
          if (typeof connection.query === 'function') {
            connection.query(checkQuery, [targetId], (err, rows) => {
              if (err) reject(err);
              else resolve(rows && rows.length > 0 ? rows[0] : null);
            });
          }
          // Check if it's a direct DuckDB connection (has .get method)
          else if (typeof connection.get === 'function') {
            connection.get(checkQuery, [targetId], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory check'));
          }
        });
  
        if (!existingRecord) {
          console.log('Memory not found: ' + targetId);
          return { success: false, error: 'Memory not found', memoryId: targetId };
        }
  
        // Delete the record
        const deleteQuery = "DELETE FROM memory WHERE backend_memory_id = ?";
        await new Promise((resolve, reject) => {
          // Check if it's a DatabaseManager-style connection (has .run method)
          if (typeof connection.run === 'function') {
            connection.run(deleteQuery, [targetId], (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
          // Check if it's a direct DuckDB connection (has .run method)
          else if (typeof connection.run === 'function') {
            connection.run(deleteQuery, [targetId], (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory deletion'));
          }
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
          // Check if it's a DatabaseManager-style connection (has .query method)
          if (typeof connection.query === 'function') {
            connection.query(listQuery, [limit, offset], (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          }
          // Check if it's a direct DuckDB connection (has .all method)
          else if (typeof connection.all === 'function') {
            connection.all(listQuery, [limit, offset], (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory listing'));
          }
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
          // Check if it's a DatabaseManager-style connection (has .query method)
          if (typeof connection.query === 'function') {
            connection.query(countQuery, [], (err, rows) => {
              if (err) reject(err);
              else resolve(rows && rows.length > 0 ? rows[0] : { total: 0 });
            });
          }
          // Check if it's a direct DuckDB connection (has .get method)
          else if (typeof connection.get === 'function') {
            connection.get(countQuery, (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory count'));
          }
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
  
    async updateMemory(params, context) {
      try {
        // Validate connection before proceeding
        await this.validateConnection(context);
        
        const { memoryId, updates } = params;
        
        if (!memoryId || !updates) {
          return { success: false, error: 'Memory ID and updates are required for memory update' };
        }
  
        console.log('Updating memory: ' + memoryId);
        
        // Use connection from context if available, otherwise use this.db
        const db = context?.db || this.db;
        const connection = context?.connection || this.connection;
        
        // First verify the record exists
        const checkQuery = "SELECT backend_memory_id FROM memory WHERE backend_memory_id = ? LIMIT 1";
        const existingRecord = await new Promise((resolve, reject) => {
          // Check if it's a DatabaseManager-style connection (has .query method)
          if (typeof connection.query === 'function') {
            connection.query(checkQuery, [memoryId], (err, rows) => {
              if (err) reject(err);
              else resolve(rows && rows.length > 0 ? rows[0] : null);
            });
          }
          // Check if it's a direct DuckDB connection (has .get method)
          else if (typeof connection.get === 'function') {
            connection.get(checkQuery, [memoryId], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory check'));
          }
        });
  
        if (!existingRecord) {
          console.log('Memory not found: ' + memoryId);
          return { success: false, error: 'Memory not found', memoryId: memoryId };
        }
  
        // Build the update query dynamically
        const updateFields = [];
        const updateValues = [];
        
        if (updates.sourceText) {
          updateFields.push('source_text = ?');
          updateValues.push(updates.sourceText);
        }
        if (updates.suggestedResponse) {
          updateFields.push('suggested_response = ?');
          updateValues.push(updates.suggestedResponse);
        }
        if (updates.intent) {
          updateFields.push('intent = ?');
          updateValues.push(updates.intent);
        }
        if (updates.screenshotPath) {
          updateFields.push('screenshot_path = ?');
          updateValues.push(updates.screenshotPath);
        }
        if (updates.ocrText) {
          updateFields.push('ocr_text = ?');
          updateValues.push(updates.ocrText);
        }
        if (updates.metadata) {
          updateFields.push('metadata = ?');
          updateValues.push(JSON.stringify(updates.metadata));
        }
        
        // Always update the updated_at timestamp
        updateFields.push('updated_at = ?');
        updateValues.push(new Date().toISOString());
        
        if (updateFields.length === 1) { // Only updated_at field
          return { success: false, error: 'No fields to update' };
        }
        
        const updateQuery = `UPDATE memory SET ${updateFields.join(', ')} WHERE backend_memory_id = ?`;
        updateValues.push(memoryId);
        
        await new Promise((resolve, reject) => {
          // Check if it's a DatabaseManager-style connection (has .run method)
          if (typeof connection.run === 'function') {
            connection.run(updateQuery, updateValues, (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
          // Check if it's a direct DuckDB connection (has .run method)
          else if (typeof connection.run === 'function') {
            connection.run(updateQuery, updateValues, (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
          else {
            reject(new Error('Unsupported database connection interface for memory update'));
          }
        });
  
        console.log('Memory updated successfully: ' + memoryId);
        
        return {
          success: true,
          memoryId: memoryId,
          updated: true,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('[ERROR] Memory update failed:', error);
        return {
          success: false,
          error: error.message,
          memoryId: params.memoryId
        };
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
  
  // Export using CommonJS format
  module.exports = AGENT_FORMAT;