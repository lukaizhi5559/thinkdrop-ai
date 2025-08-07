/**
 * ConversationSessionAgent - Manages multi-chat conversation sessions
 * Handles session creation, hibernation, resumption, and context awareness
 */

const path = require('path');
const fs = require('fs').promises;

class ConversationSessionAgent {
  constructor() {
    this.name = 'ConversationSessionAgent';
    this.description = 'Manages multi-chat conversation sessions with context awareness and auto-initiation';
    this.database = null;
    this.initialized = false;
  }

  async initialize(context = {}) {
    try {
      this.database = context.database;
      if (!this.database) {
        throw new Error('Database connection required for ConversationSessionAgent');
      }

      // Create conversation sessions table
      await this.createTables();
      this.initialized = true;
      
      console.log('✅ ConversationSessionAgent initialized successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ ConversationSessionAgent initialization failed:', error);
      return { success: false, error: error.message };
    }
  }

  async createTables() {
    try {
      // Create conversation_sessions table
      await this.database.exec(`
        CREATE TABLE IF NOT EXISTS conversation_sessions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN ('user-initiated', 'ai-initiated')),
          title TEXT NOT NULL,
          trigger_reason TEXT NOT NULL CHECK (trigger_reason IN ('manual', 'context-similarity', 'time-pattern', 'activity-change', 'idle-return')),
          trigger_confidence REAL DEFAULT 0.0,
          context_data TEXT DEFAULT '{}',
          related_memories TEXT DEFAULT '[]',
          current_activity TEXT DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          is_hibernated BOOLEAN DEFAULT false,
          hibernation_data TEXT DEFAULT '{}',
          message_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create session_context table for embeddings and context data
      await this.database.exec(`
        CREATE TABLE IF NOT EXISTS session_context (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          context_type TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding BLOB,
          metadata TEXT DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
        )
      `);

      console.log('✅ ConversationSessionAgent tables created successfully');
    } catch (error) {
      console.error('❌ Failed to create ConversationSessionAgent tables:', error);
      throw error;
    }
  }

  async execute(params, context = {}) {
    if (!this.initialized) {
      await this.initialize(context);
    }

    const { action, options = {} } = params;

    try {
      switch (action) {
        case 'session-create':
          return await this.createSession(options, context);
        case 'session-list':
          return await this.listSessions(options, context);
        case 'session-get':
          return await this.getSession(options, context);
        case 'session-update':
          return await this.updateSession(options, context);
        case 'session-delete':
          return await this.deleteSession(options, context);
        case 'session-hibernate':
          return await this.hibernateSession(options, context);
        case 'session-resume':
          return await this.resumeSession(options, context);
        case 'context-similarity':
          return await this.checkContextSimilarity(options, context);
        case 'auto-trigger-evaluate':
          return await this.evaluateAutoTrigger(options, context);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            availableActions: [
              'session-create', 'session-list', 'session-get', 'session-update', 
              'session-delete', 'session-hibernate', 'session-resume', 
              'context-similarity', 'auto-trigger-evaluate'
            ]
          };
      }
    } catch (error) {
      console.error(`❌ ConversationSessionAgent action '${action}' failed:`, error);
      return {
        success: false,
        error: error.message,
        action,
        timestamp: new Date().toISOString()
      };
    }
  }

  async createSession(options, context) {
    const {
      sessionType,
      title,
      triggerReason = 'manual',
      triggerConfidence = 0.0,
      contextData = {},
      relatedMemories = [],
      currentActivity = {}
    } = options;

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const stmt = this.database.prepare(`
        INSERT INTO conversation_sessions (
          id, type, title, trigger_reason, trigger_confidence,
          context_data, related_memories, current_activity,
          is_active, is_hibernated, message_count,
          created_at, updated_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();
      stmt.run(
        sessionId,
        sessionType,
        title,
        triggerReason,
        triggerConfidence,
        JSON.stringify(contextData),
        JSON.stringify(relatedMemories),
        JSON.stringify(currentActivity),
        true,
        false,
        0,
        now,
        now,
        now
      );

      console.log(`✅ Created conversation session: ${sessionId}`);
      
      return {
        success: true,
        sessionId,
        data: {
          id: sessionId,
          type: sessionType,
          title,
          triggerReason,
          triggerConfidence,
          contextData,
          relatedMemories,
          currentActivity,
          isActive: true,
          isHibernated: false,
          messageCount: 0,
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now
        }
      };
    } catch (error) {
      console.error('❌ Failed to create session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async listSessions(options, context) {
    const {
      includeHibernated = false,
      limit = 50,
      orderBy = 'last_activity_at',
      orderDirection = 'DESC'
    } = options;

    try {
      let query = `
        SELECT * FROM conversation_sessions
        WHERE 1=1
      `;
      const params = [];

      if (!includeHibernated) {
        query += ` AND is_hibernated = ?`;
        params.push(false);
      }

      query += ` ORDER BY ${orderBy} ${orderDirection} LIMIT ?`;
      params.push(limit);

      const stmt = this.database.prepare(query);
      const rows = stmt.all(...params);

      const sessions = rows.map(row => ({
        id: row.id,
        type: row.type,
        title: row.title,
        triggerReason: row.trigger_reason,
        triggerConfidence: row.trigger_confidence,
        contextData: JSON.parse(row.context_data || '{}'),
        relatedMemories: JSON.parse(row.related_memories || '[]'),
        currentActivity: JSON.parse(row.current_activity || '{}'),
        isActive: Boolean(row.is_active),
        isHibernated: Boolean(row.is_hibernated),
        hibernationData: JSON.parse(row.hibernation_data || '{}'),
        messageCount: row.message_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastActivityAt: row.last_activity_at
      }));

      return {
        success: true,
        data: {
          sessions,
          total: sessions.length
        }
      };
    } catch (error) {
      console.error('❌ Failed to list sessions:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getSession(options, context) {
    const { sessionId } = options;

    try {
      const stmt = this.database.prepare(`
        SELECT * FROM conversation_sessions WHERE id = ?
      `);
      const row = stmt.get(sessionId);

      if (!row) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      const session = {
        id: row.id,
        type: row.type,
        title: row.title,
        triggerReason: row.trigger_reason,
        triggerConfidence: row.trigger_confidence,
        contextData: JSON.parse(row.context_data || '{}'),
        relatedMemories: JSON.parse(row.related_memories || '[]'),
        currentActivity: JSON.parse(row.current_activity || '{}'),
        isActive: Boolean(row.is_active),
        isHibernated: Boolean(row.is_hibernated),
        hibernationData: JSON.parse(row.hibernation_data || '{}'),
        messageCount: row.message_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastActivityAt: row.last_activity_at
      };

      return {
        success: true,
        data: { session }
      };
    } catch (error) {
      console.error('❌ Failed to get session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateSession(options, context) {
    const { sessionId, updates } = options;

    try {
      const allowedFields = [
        'title', 'trigger_reason', 'trigger_confidence', 'context_data',
        'related_memories', 'current_activity', 'is_active', 'message_count'
      ];

      const setClause = [];
      const params = [];

      Object.keys(updates).forEach(key => {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbKey)) {
          setClause.push(`${dbKey} = ?`);
          if (typeof updates[key] === 'object') {
            params.push(JSON.stringify(updates[key]));
          } else {
            params.push(updates[key]);
          }
        }
      });

      if (setClause.length === 0) {
        return {
          success: false,
          error: 'No valid fields to update'
        };
      }

      setClause.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(sessionId);

      const stmt = this.database.prepare(`
        UPDATE conversation_sessions 
        SET ${setClause.join(', ')}
        WHERE id = ?
      `);

      const result = stmt.run(...params);

      if (result.changes === 0) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      return {
        success: true,
        data: { updated: true, changes: result.changes }
      };
    } catch (error) {
      console.error('❌ Failed to update session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async deleteSession(options, context) {
    const { sessionId } = options;

    try {
      const stmt = this.database.prepare(`
        DELETE FROM conversation_sessions WHERE id = ?
      `);
      const result = stmt.run(sessionId);

      if (result.changes === 0) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      return {
        success: true,
        data: { deleted: true, sessionId }
      };
    } catch (error) {
      console.error('❌ Failed to delete session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async hibernateSession(options, context) {
    const { sessionId, hibernationData = {} } = options;

    try {
      const stmt = this.database.prepare(`
        UPDATE conversation_sessions 
        SET is_hibernated = ?, hibernation_data = ?, updated_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        true,
        JSON.stringify(hibernationData),
        new Date().toISOString(),
        sessionId
      );

      if (result.changes === 0) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      return {
        success: true,
        data: { hibernated: true, sessionId }
      };
    } catch (error) {
      console.error('❌ Failed to hibernate session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async resumeSession(options, context) {
    const { sessionId } = options;

    try {
      const stmt = this.database.prepare(`
        UPDATE conversation_sessions 
        SET is_hibernated = ?, is_active = ?, updated_at = ?, last_activity_at = ?
        WHERE id = ?
      `);

      const now = new Date().toISOString();
      const result = stmt.run(false, true, now, now, sessionId);

      if (result.changes === 0) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      return {
        success: true,
        data: { 
          resumed: true, 
          sessionId,
          resumptionMessage: "Welcome back! Continuing our conversation...",
          suggestedActions: ["Continue previous topic", "Start new topic", "Review context"]
        }
      };
    } catch (error) {
      console.error('❌ Failed to resume session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async checkContextSimilarity(options, context) {
    const { sessionId, currentContext } = options;

    try {
      // This is a simplified similarity check
      // In a real implementation, you'd use embeddings and vector similarity
      const similarity = Math.random() * 0.5 + 0.3; // Mock similarity between 0.3-0.8
      const shouldTrigger = similarity > 0.6;

      return {
        success: true,
        data: {
          similarity,
          shouldTrigger,
          relatedSessions: shouldTrigger ? [`related_${sessionId}`] : []
        }
      };
    } catch (error) {
      console.error('❌ Failed to check context similarity:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async evaluateAutoTrigger(options, context) {
    const { 
      currentContext, 
      userActivity, 
      triggerType = 'context-similarity',
      confidence = 0.8 
    } = options;

    try {
      // Mock auto-trigger evaluation
      const triggered = Math.random() > 0.7; // 30% chance to trigger

      if (triggered) {
        // Create a new AI-initiated session
        const sessionResult = await this.createSession({
          sessionType: 'ai-initiated',
          title: 'AI Suggested Conversation',
          triggerReason: triggerType,
          triggerConfidence: confidence,
          contextData: currentContext,
          currentActivity: userActivity
        }, context);

        if (sessionResult.success) {
          return {
            success: true,
            data: {
              triggered: true,
              sessionId: sessionResult.sessionId,
              autoMessage: "I noticed you might want to discuss something related to your current activity. Shall we chat about it?"
            }
          };
        }
      }

      return {
        success: true,
        data: {
          triggered: false,
          reason: 'No suitable trigger conditions met'
        }
      };
    } catch (error) {
      console.error('❌ Failed to evaluate auto trigger:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ConversationSessionAgent;
