/**
 * UserMemoryAgent - Manages persistent user context and memories
 * Handles storage and retrieval of user information using DuckDB
 */

const code = {
  async execute(input, context) {
    try {
      const { action, data, key, value, query } = input;
      
      console.log(`💾 UserMemoryAgent executing: ${action}`);
      
      let result;
      
      switch (action) {
        case 'store':
        case 'store_interaction':
          result = await this.storeMemory(data || { key, value }, context);
          break;
          
        case 'retrieve':
          result = await this.retrieveMemory(key || query, context);
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
      console.error(`❌ UserMemoryAgent execution failed: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        result: null
      };
    }
  },

  async storeMemory(data, context) {
    try {
      const memoryId = this.generateMemoryId();
      const timestamp = new Date().toISOString();
      
      let key, value, screenshot = null, extractedText = null;
      
      if (typeof data === 'object' && data.key && data.value) {
        key = data.key;
        value = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
      } else if (data.userInput && data.result) {
        key = `interaction_${Date.now()}`;
        value = JSON.stringify({
          userInput: data.userInput,
          result: data.result,
          timestamp
        });
      } else if (data.screenshot) {
        key = data.key || `screenshot_${Date.now()}`;
        value = data.extractedText || 'Screenshot captured';
        screenshot = data.screenshot;
        extractedText = data.extractedText;
      } else {
        throw new Error('Invalid memory data format');
      }
      
      const database = context.database || context.db;
      if (!database) {
        throw new Error('Database connection not available');
      }
      
      await this.ensureMemoryTable(database);
      
      const query = `
        INSERT INTO user_memories (
          id, key, value, screenshot, extracted_text, 
          created_at, updated_at, tags, category, importance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await database.run(query, [
        memoryId,
        key,
        value,
        screenshot,
        extractedText,
        timestamp,
        timestamp,
        JSON.stringify([]),
        'general',
        1
      ]);
      
      console.log(`✅ Memory stored: ${key}`);
      
      return {
        id: memoryId,
        key,
        value,
        timestamp,
        hasScreenshot: !!screenshot
      };
      
    } catch (error) {
      console.error(`❌ Failed to store memory: ${error.message}`);
      throw error;
    }
  },

  async retrieveMemory(keyOrQuery, context) {
    try {
      const database = context.database || context.db;
      if (!database) {
        throw new Error('Database connection not available');
      }

      let query, params;
      
      if (keyOrQuery.includes('*') || keyOrQuery.includes('%')) {
        query = `SELECT * FROM user_memories WHERE key LIKE ? ORDER BY created_at DESC`;
        params = [keyOrQuery.replace('*', '%')];
      } else {
        query = `SELECT * FROM user_memories WHERE key = ? ORDER BY created_at DESC LIMIT 1`;
        params = [keyOrQuery];
      }
      
      const results = await database.all(query, params);
      
      if (results.length === 0) {
        return { found: false, message: `No memory found for: ${keyOrQuery}` };
      }
      
      const memories = results.map(row => ({
        id: row.id,
        key: row.key,
        value: row.value,
        hasScreenshot: !!row.screenshot,
        extractedText: row.extracted_text,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
      
      console.log(`✅ Retrieved ${memories.length} memories for: ${keyOrQuery}`);
      
      return {
        found: true,
        memories: memories.length === 1 ? memories[0] : memories,
        count: memories.length
      };
      
    } catch (error) {
      console.error(`❌ Failed to retrieve memory: ${error.message}`);
      throw error;
    }
  },

  async updateMemory(key, newValue, context) {
    try {
      const database = context.database || context.db;
      if (!database) {
        throw new Error('Database connection not available');
      }

      const timestamp = new Date().toISOString();
      const value = typeof newValue === 'string' ? newValue : JSON.stringify(newValue);
      
      const query = `UPDATE user_memories SET value = ?, updated_at = ? WHERE key = ?`;
      const result = await database.run(query, [value, timestamp, key]);
      
      if (result.changes === 0) {
        return { updated: false, message: `No memory found with key: ${key}` };
      }
      
      console.log(`✅ Memory updated: ${key}`);
      
      return {
        updated: true,
        key,
        newValue: value,
        timestamp
      };
      
    } catch (error) {
      console.error(`❌ Failed to update memory: ${error.message}`);
      throw error;
    }
  },

  async deleteMemory(key, context) {
    try {
      const database = context.database || context.db;
      if (!database) {
        throw new Error('Database connection not available');
      }

      const query = `DELETE FROM user_memories WHERE key = ?`;
      const result = await database.run(query, [key]);
      
      if (result.changes === 0) {
        return { deleted: false, message: `No memory found with key: ${key}` };
      }
      
      console.log(`✅ Memory deleted: ${key}`);
      
      return {
        deleted: true,
        key,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Failed to delete memory: ${error.message}`);
      throw error;
    }
  },

  async searchMemories(query, context) {
    try {
      const database = context.database || context.db;
      if (!database) {
        throw new Error('Database connection not available');
      }

      const searchQuery = `
        SELECT * FROM user_memories 
        WHERE key LIKE ? OR value LIKE ? OR extracted_text LIKE ?
        ORDER BY created_at DESC
        LIMIT 50
      `;
      
      const searchTerm = `%${query}%`;
      const results = await database.all(searchQuery, [searchTerm, searchTerm, searchTerm]);
      
      const memories = results.map(row => ({
        id: row.id,
        key: row.key,
        value: row.value,
        hasScreenshot: !!row.screenshot,
        extractedText: row.extracted_text,
        createdAt: row.created_at,
        relevanceScore: this.calculateRelevance(query, row)
      }));
      
      console.log(`✅ Found ${memories.length} memories matching: ${query}`);
      
      return {
        found: memories.length > 0,
        memories,
        count: memories.length,
        query
      };
      
    } catch (error) {
      console.error(`❌ Failed to search memories: ${error.message}`);
      throw error;
    }
  },

  async storeScreenshot(data, context) {
    try {
      const screenshotData = {
        key: data.key || `screenshot_${Date.now()}`,
        screenshot: data.screenshot,
        extractedText: data.extractedText,
        value: data.extractedText || 'Screenshot with OCR text'
      };
      
      return await this.storeMemory(screenshotData, context);
      
    } catch (error) {
      console.error(`❌ Failed to store screenshot: ${error.message}`);
      throw error;
    }
  },

  async ensureMemoryTable(database) {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS user_memories (
          id TEXT PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          value TEXT,
          screenshot BLOB,
          extracted_text TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          tags TEXT DEFAULT '[]',
          category TEXT DEFAULT 'general',
          importance INTEGER DEFAULT 1
        )
      `;
      
      await database.exec(createTableQuery);
      
      const createIndexQuery = `
        CREATE INDEX IF NOT EXISTS idx_user_memories_key ON user_memories(key);
        CREATE INDEX IF NOT EXISTS idx_user_memories_created_at ON user_memories(created_at);
        CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category);
      `;
      
      await database.exec(createIndexQuery);
      
    } catch (error) {
      console.error(`❌ Failed to ensure memory table: ${error.message}`);
      throw error;
    }
  },

  generateMemoryId() {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  calculateRelevance(query, memoryRow) {
    const queryLower = query.toLowerCase();
    let score = 0;
    
    if (memoryRow.key.toLowerCase().includes(queryLower)) score += 3;
    if (memoryRow.value.toLowerCase().includes(queryLower)) score += 2;
    if (memoryRow.extracted_text && memoryRow.extracted_text.toLowerCase().includes(queryLower)) score += 1;
    
    return score;
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
