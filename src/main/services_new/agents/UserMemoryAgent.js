/**
 * UserMemoryAgent - Manages user context and memories
 * Handles storage and retrieval of user information using DuckDB
 */

import DuckDBWrapper from '../utils/DuckDBWrapper.js';
// import { screenshotStorage } from '../utils/ScreenshotStorage.js';

const code = {
  async execute(input, context) {
    try {
      const { action, data, key, value, query } = input;
      
      console.log(`💾 UserMemoryAgent executing: ${action}`);
      
      let result;
      
      switch (action) {
        case 'store':
          result = await this.storeMemory(key, value, context);
          break;
          
        case 'retrieve':
          result = await this.retrieveMemory(key, context);
          break;
          
        case 'update':
          result = await this.updateMemory(key, value, context);
          break;
          
        case 'delete':
          result = await this.deleteMemory(key, context);
          break;
          
        case 'search':
          result = await this.searchMemories(query, context);
          break;
          
        case 'store_screenshot':
          result = await this.storeScreenshot(data, context);
          break;
          
        case 'store_intent_classification':
          result = await this.storeIntentClassification(data, context);
          break;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  
          
        case 'sync_to_backend':
          result = await this.syncMemoriesToBackend(data, context);
          break;
          
        case 'query_intent_memories':
        case 'intent_memories':
          result = await this.queryIntentMemories(context);
          break;
          
        case 'test_populate':
          console.log('🧪 TEST POPULATE was called');
          result = await this.populateTestData(context);
          break;
          
        default:
          throw new Error(`Unknown memory action: ${action}`);
      }
      
      return {
        success: true,
        result,
        metadata: {
          agent: 'UserMemoryAgent',
          action,
          timestamp: new Date().toISOString()
        }
      };
      
    } catch (error) {
      console.error(`❌ UserMemoryAgent error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        metadata: {
          agent: 'UserMemoryAgent',
          action: input.action,
          timestamp: new Date().toISOString()
        }
      };
    }
  },

  /**
   * Store intent classification data in DuckDB
   */
  async storeIntentClassification(data, context) {
    try {
      console.log('🔧 UserMemoryAgent.storeIntentClassification called');
      
      const rawDatabase = context.database || context.db;
      if (!rawDatabase) {
        throw new Error('Database connection not available');
      }

      const database = new DuckDBWrapper(rawDatabase);
      await this.ensureMemoryTables(database);
      
      const memoryId = this.generateMemoryId();
      const timestamp = new Date().toISOString();
      const userId = context.userId || 'default_user';
      
      // Extract data from intent classification payload
      const {
        intents = [],
        primaryIntent,
        entities = [],
        requiresMemoryAccess = false,
        requiresExternalData = false,
        suggestedResponse = '',
        sourceText = '',
        screenshot = null,
        extractedText = null,
        type = 'intent_classification'
      } = data;
      
      console.log('🔧 [DEBUG] Storing intent classification:', {
        intentsCount: intents.length,
        primaryIntent,
        entitiesCount: entities.length,
        userId,
        memoryId
      });
      
      await database.beginTransaction();
      
      try {
        // Store main memory record
        const memoryQuery = `
          INSERT INTO memory (
            id, timestamp, user_id, type, primary_intent, requires_memory_access, 
            requires_external_data, suggested_response, source_text, metadata,
            screenshot, extracted_text, synced_to_backend, backend_memory_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const metadata = JSON.stringify({
          intents_count: intents.length,
          entities_count: entities.length,
          confidence_scores: intents.map(i => ({ intent: i.intent, confidence: i.confidence })),
          workflow_context: context.source || 'unknown'
        });
        
        // Handle screenshot data - save to disk for efficient binary storage
        let screenshotFilename = null;
        if (screenshot) {
          let buffer = null;
          
          if (Buffer.isBuffer(screenshot)) {
            buffer = screenshot;
          } else if (screenshot instanceof Uint8Array) {
            buffer = Buffer.from(screenshot);
          } else if (typeof screenshot === 'string') {
            // If it's a base64 string, convert to buffer
            if (screenshot.startsWith('data:image')) {
              const base64Data = screenshot.split(',')[1];
              buffer = Buffer.from(base64Data, 'base64');
            } else {
              // Assume it's raw base64
              buffer = Buffer.from(screenshot, 'base64');
            }
          } else if (screenshot.buffer && screenshot.buffer instanceof ArrayBuffer) {
            // Handle typed arrays with underlying ArrayBuffer
            buffer = Buffer.from(screenshot.buffer);
          } else {
            console.warn('⚠️ Unknown screenshot data type:', typeof screenshot);
          }
          
          // Save buffer to disk and store filename in DB
          // if (buffer) {
          //   screenshotFilename = await screenshotStorage.saveScreenshot(buffer, memoryId);
          //   console.log('💾 Screenshot saved to disk:', screenshotFilename);
          // }
        }
        
        const params = [
          memoryId,
          timestamp,
          userId,
          type,
          primaryIntent,
          requiresMemoryAccess ? 1 : 0,  // Convert boolean to integer for DuckDB
          requiresExternalData ? 1 : 0,
          suggestedResponse,
          sourceText,
          metadata,
          screenshotFilename,  // Store filename reference instead of binary data
          extractedText,
          0, // synced_to_backend (false)
          null,  // backend_memory_id
          timestamp,
          timestamp
        ];
        
        console.log('🔧 [DEBUG] Memory insert params:', {
          paramCount: params.length,
          expectedCount: 16,
          memoryId: params[0],
          userId: params[2],
          primaryIntent: params[4],
          screenshotType: screenshotFilename ? 'file' : 'null',
          screenshotIsFile: screenshotFilename ? true : false,
          screenshotFilename: screenshotFilename || 'none'
        });
        
        await database.run(memoryQuery, params);
        console.log('✅ Memory record inserted successfully');
        
        // Debug: Verify what was stored
        const verifyQuery = `SELECT id, screenshot, primary_intent FROM memory WHERE id = ?`;
        const stored = await database.get(verifyQuery, [memoryId]);
        console.log('🔍 Stored memory verification:', {
          id: stored?.id,
          screenshot: stored?.screenshot,
          primary_intent: stored?.primary_intent
        });
        
        // Store intent candidates
        for (const intentData of intents) {
          const intentId = this.generateMemoryId();
          const intentQuery = `
            INSERT INTO intent_candidates (id, memory_id, intent, confidence, reasoning)
            VALUES (?, ?, ?, ?, ?)
          `;
          
          await database.run(intentQuery, [
            intentId,
            memoryId,
            intentData.intent,
            intentData.confidence || 0.5,
            intentData.reasoning || ''
          ]);
        }
        
        // Store entities
        for (const entity of entities) {
          const entityId = this.generateMemoryId();
          const entityQuery = `
            INSERT INTO memory_entities (id, memory_id, entity)
            VALUES (?, ?, ?)
          `;
          
          await database.run(entityQuery, [
            entityId,
            memoryId,
            entity
          ]);
        }
        
        await database.commit();
        console.log(`✅ Intent classification stored successfully: ${memoryId} (${primaryIntent})`);
        
        return {
          id: memoryId,
          type,
          primaryIntent,
          intentsStored: intents.length,
          entitiesStored: entities.length,
          timestamp,
          hasScreenshot: !!screenshot,
          requiresMemoryAccess
        };
        
      } catch (error) {
        await database.rollback();
        throw error;
      }
      
    } catch (error) {
      console.error('❌ Error in storeIntentClassification:', error.message);
      throw error;
    }
  },

  /**
   * Query intent memories from DuckDB
   */
  async queryIntentMemories(context) {
    try {
      console.log('🔧 UserMemoryAgent.queryIntentMemories called');
      
      const rawDatabase = context.database || context.db;
      if (!rawDatabase) {
        throw new Error('Database connection not available');
      }

      const database = new DuckDBWrapper(rawDatabase);
      await this.ensureMemoryTables(database);
      
      const userId = context.userId || 'default_user';
      
      // Query main memory records
      const memoryQuery = `
        SELECT 
          id, timestamp, user_id, type, primary_intent, requires_memory_access,
          requires_external_data, suggested_response, source_text, metadata,
          screenshot, extracted_text, synced_to_backend, backend_memory_id,
          created_at, updated_at
        FROM memory
        WHERE user_id = ?
        ORDER BY timestamp DESC
        LIMIT 50
      `;
      
      const memories = await database.all(memoryQuery, [userId]);
      console.log(`🔧 Found ${memories.length} memory records for userId: ${userId}`);
      
      // Debug: Log first memory if exists
      if (memories.length > 0) {
        console.log('📋 First memory record:', {
          id: memories[0].id,
          screenshot: memories[0].screenshot,
          primary_intent: memories[0].primary_intent,
          timestamp: memories[0].timestamp
        });
      }
      
      // Enrich memories with intent candidates and entities
      const enrichedMemories = [];
      
      for (const memory of memories) {
        // Get intent candidates
        const intents = await database.all(
          'SELECT intent, confidence, reasoning FROM intent_candidates WHERE memory_id = ? ORDER BY confidence DESC',
          [memory.id]
        );
        
        // Get entities
        const entityRows = await database.all(
          'SELECT entity FROM memory_entities WHERE memory_id = ?',
          [memory.id]
        );
        const entities = entityRows.map(row => row.entity);
        
        // Parse metadata if it's a string
        let metadata = memory.metadata;
        if (typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
          } catch (e) {
            console.warn('Failed to parse metadata JSON:', e.message);
            metadata = {};
          }
        }
        
        // Load screenshot from disk if filename is stored
        // let screenshotDataUrl = null;
        // if (memory.screenshot && memory.screenshot !== 'null') {
        //   screenshotDataUrl = await screenshotStorage.getScreenshotDataUrl(memory.screenshot);
        // }
        
        enrichedMemories.push({
          ...memory,
          sourceText: memory.source_text,
          metadata,
          screenshot: screenshotDataUrl,  // Use data URL for display instead of filename
          extractedText: memory.extracted_text,
          syncedToBackend: !!memory.synced_to_backend,
          backendMemoryId: memory.backend_memory_id,
          createdAt: memory.created_at,
          updatedAt: memory.updated_at,
          intents,
          entities
        });
      }
      
      console.log(`✅ Retrieved ${enrichedMemories.length} enriched memories`);
      
      return {
        memories: enrichedMemories,
        total: enrichedMemories.length,
        userId,
        retrievedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Error in queryIntentMemories:', error.message);
      throw error;
    }
  },

  /**
   * Populate test data for debugging
   */
  async populateTestData(context) {
    try {
      console.log('🧪 [TEST] Populating test intent classification data...');
      
      const rawDatabase = context.database || context.db;
      if (!rawDatabase) {
        throw new Error('Database connection not available');
      }

      const database = new DuckDBWrapper(rawDatabase);
      await this.ensureMemoryTables(database);
      
      await database.beginTransaction();
      
      try {
        // Clear existing test data - delete in proper order to respect foreign key constraints
        // 1. First delete related records from intent_candidates
        await database.run(
          `DELETE FROM intent_candidates 
           WHERE memory_id IN (SELECT id FROM memory WHERE user_id = ? AND source_text LIKE ?)`, 
          ['default_user', '%test message%']
        );
        console.log('🧪 [TEST] Cleared existing intent candidates');
        
        // 2. Delete related records from memory_entities
        await database.run(
          `DELETE FROM memory_entities 
           WHERE memory_id IN (SELECT id FROM memory WHERE user_id = ? AND source_text LIKE ?)`, 
          ['default_user', '%test message%']
        );
        console.log('🧪 [TEST] Cleared existing memory entities');
        
        // 3. Finally delete the memory records
        await database.run(
          "DELETE FROM memory WHERE user_id = ? AND source_text LIKE ?", 
          ['default_user', '%test message%']
        );
        console.log('🧪 [TEST] Cleared existing memory records');
        
        // Create test data
        const memoryId = this.generateMemoryId();
        const timestamp = new Date().toISOString();
        
        // Insert test memory
        const memoryQuery = `
          INSERT INTO memory (
            id, timestamp, user_id, type, primary_intent, requires_memory_access,
            requires_external_data, suggested_response, source_text, metadata,
            screenshot, extracted_text, synced_to_backend, backend_memory_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await database.run(memoryQuery, [
          memoryId,
          timestamp,
          'default_user',
          'intent_classification',
          'memory_store',
          1, // requires_memory_access
          0, // requires_external_data
          'Test memory has been stored successfully.',
          'This is a test message to verify memory storage and retrieval functionality.',
          JSON.stringify({
            intents_count: 2,
            entities_count: 3,
            confidence_scores: [
              { intent: 'memory_store', confidence: 0.95 },
              { intent: 'command', confidence: 0.8 }
            ]
          }),
          Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), // 1x1 pixel test screenshot as Buffer
          'Sample OCR extracted text for testing purposes.',
          0, // not synced
          null,  // no backend id
          timestamp,
          timestamp
        ]);
        
        console.log('🧪 [TEST] Inserted test memory:', memoryId);
        
        // Insert intent candidates
        const intents = [
          { intent: 'memory_store', confidence: 0.95, reasoning: 'Test memory storage intent' },
          { intent: 'command', confidence: 0.8, reasoning: 'Test command intent' }
        ];
        
        for (const intentData of intents) {
          const intentId = this.generateMemoryId();
          await database.run(
            'INSERT INTO intent_candidates (id, memory_id, intent, confidence, reasoning) VALUES (?, ?, ?, ?, ?)',
            [intentId, memoryId, intentData.intent, intentData.confidence, intentData.reasoning]
          );
        }
        
        // Insert entities
        const entities = ['test', 'sample', 'debug'];
        for (const entity of entities) {
          const entityId = this.generateMemoryId();
          await database.run(
            'INSERT INTO memory_entities (id, memory_id, entity) VALUES (?, ?, ?)',
            [entityId, memoryId, entity]
          );
        }
        
        await database.commit();
        console.log('✅ [TEST] Test data committed successfully');
        
        // Verify the data was stored
        const verifyResult = await database.get(
          'SELECT COUNT(*) as count FROM memory WHERE user_id = ? AND id = ?',
          ['default_user', memoryId]
        );
        
        console.log(`🧪 [TEST] Verification: ${verifyResult?.count || 0} memories found`);
        
        return {
          success: true,
          message: 'Test data populated successfully',
          testMemoryId: memoryId,
          timestamp: timestamp,
          recordsCreated: {
            memories: 1,
            intents: intents.length,
            entities: entities.length
          }
        };
        
      } catch (error) {
        await database.rollback();
        throw error;
      }
      
    } catch (error) {
      console.error('❌ [TEST] Failed to populate test data:', error.message);
      throw error;
    }
  },

  /**
   * Ensure memory tables exist with proper DuckDB schema
   */
  async ensureMemoryTables(database) {
    try {
      // Drop existing tables to ensure clean schema (BLOB -> TEXT migration)
      // This is safe since we're in development
      // COMMENTED OUT to allow table persistence between app restarts
      // await database.exec(`
      //   DROP TABLE IF EXISTS memory_entities;
      //   DROP TABLE IF EXISTS intent_candidates;
      //   DROP TABLE IF EXISTS memory;
      //   DROP TABLE IF EXISTS user_memories;
      // `).catch(err => {
      //   console.log('⚠️ Could not drop tables (might not exist):', err.message);
      // });
      
      // Main memory table
      const createMemoryTableQuery = `
        CREATE TABLE IF NOT EXISTS memory (
          id TEXT PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          user_id TEXT,
          type TEXT,
          primary_intent TEXT,
          requires_memory_access INTEGER DEFAULT 0,
          requires_external_data INTEGER DEFAULT 0,
          suggested_response TEXT,
          source_text TEXT,
          metadata TEXT,
          screenshot TEXT,
          extracted_text TEXT,
          synced_to_backend INTEGER DEFAULT 0,
          backend_memory_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      // Intent candidates table
      const createIntentCandidatesQuery = `
        CREATE TABLE IF NOT EXISTS intent_candidates (
          id TEXT PRIMARY KEY,
          memory_id TEXT REFERENCES memory(id),
          intent TEXT,
          confidence DOUBLE,
          reasoning TEXT
        )
      `;
      
      // Memory entities table
      const createMemoryEntitiesQuery = `
        CREATE TABLE IF NOT EXISTS memory_entities (
          id TEXT PRIMARY KEY,
          memory_id TEXT REFERENCES memory(id),
          entity TEXT
        )
      `;
      
      // Legacy user_memories table
      const createLegacyTableQuery = `
        CREATE TABLE IF NOT EXISTS user_memories (
          id TEXT PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          value TEXT,
          screenshot TEXT,
          extracted_text TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          tags TEXT DEFAULT '[]',
          category TEXT DEFAULT 'general',
          importance INTEGER DEFAULT 1
        )
      `;
      
      await database.exec(createMemoryTableQuery);
      await database.exec(createIntentCandidatesQuery);
      await database.exec(createMemoryEntitiesQuery);
      await database.exec(createLegacyTableQuery);
      
      // Create indexes
      const createIndexesQuery = `
        CREATE INDEX IF NOT EXISTS idx_memory_user_id ON memory(user_id);
        CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
        CREATE INDEX IF NOT EXISTS idx_memory_primary_intent ON memory(primary_intent);
        CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON memory(timestamp);
        CREATE INDEX IF NOT EXISTS idx_intent_candidates_memory_id ON intent_candidates(memory_id);
        CREATE INDEX IF NOT EXISTS idx_intent_candidates_intent ON intent_candidates(intent);
        CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id ON memory_entities(memory_id);
        CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity);
        CREATE INDEX IF NOT EXISTS idx_user_memories_key ON user_memories(key);
        CREATE INDEX IF NOT EXISTS idx_user_memories_created_at ON user_memories(created_at);
        CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category);
      `;
      
      await database.exec(createIndexesQuery);
      
    } catch (error) {
      console.error(`❌ Failed to ensure memory tables: ${error.message}`);
      throw error;
    }
  },

  /**
   * Generate unique memory ID
   */
  generateMemoryId() {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  // Placeholder methods for other operations
  async storeMemory(key, value, context) {
    return { stored: true, key, value };
  },

  async retrieveMemory(key, context) {
    return { key, value: null };
  },

  async updateMemory(key, value, context) {
    return { updated: true, key, value };
  },

  async deleteMemory(key, context) {
    return { deleted: true, key };
  },

  async searchMemories(query, context) {
    return { results: [], query };
  },

  async storeScreenshot(data, context) {
    return { stored: true, hasScreenshot: !!data };
  },

  async syncMemoriesToBackend(data, context) {
    return { synced: 0, message: 'Backend sync not implemented yet' };
  }
};

// Export the agent in LLM-compatible format
export default {
  name: 'UserMemoryAgent',
  description: 'Manages persistent user context and memories with DuckDB storage, supporting text and screenshot data with OCR extraction',
  code,
  dependencies: ['duckdb'],
  execution_target: 'frontend',
  requires_database: true,
  config: {
    maxMemories: 10000,
    screenshotFormat: 'base64',
    enableOCR: true,
    defaultCategory: 'general',
    autoCleanup: true,
    cleanupDays: 365
  },
  secrets: [],
  orchestrator_metadata: {
    chainOrder: 2,
    nextAgents: ['ChatMessage'],
    resourceRequirements: {
      memory: 'medium',
      storage: 'high',
      cpu: 'low'
    },
    timeout: 30000,
    retryCount: 2
  }
};
