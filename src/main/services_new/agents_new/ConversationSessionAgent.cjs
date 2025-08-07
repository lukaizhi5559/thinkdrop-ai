/**
 * ConversationSessionAgent - Manages multi-chat conversation sessions
 * Handles session creation, hibernation, resumption, and context awareness
 */

const path = require('path');
const fs = require('fs').promises;

const AGENT_FORMAT = {
  name: 'ConversationSessionAgent',
  description: 'Manages multi-chat conversation sessions with context awareness and auto-initiation',
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Conversation session operation to perform',
        enum: [
          'session-create', 'session-list', 'session-get', 'session-update',
          'session-delete', 'session-hibernate', 'session-resume',
          'context-similarity', 'auto-trigger-evaluate'
        ]
      },
      sessionId: { type: 'string', description: 'Session ID for operations' },
      sessionType: { type: 'string', enum: ['user-initiated', 'ai-initiated'] },
      title: { type: 'string', description: 'Session title' },
      triggerReason: { type: 'string', enum: ['manual', 'context-similarity', 'time-pattern', 'activity-change', 'idle-return'] },
      triggerConfidence: { type: 'number', description: 'Confidence score for trigger' },
      contextData: { type: 'object', description: 'Session context data' },
      relatedMemories: { type: 'array', description: 'Related memory IDs' },
      currentActivity: { type: 'object', description: 'Current user activity context' }
    },
    required: ['action']
  },
  dependencies: [],
  execution_target: 'frontend',
  requires_database: true,
  database_type: 'duckdb',

  async bootstrap(config, context) {
    try {
      AGENT_FORMAT.database = context.database;
      if (!AGENT_FORMAT.database) {
        throw new Error('Database connection required for ConversationSessionAgent');
      }

      // Create conversation sessions table
      await AGENT_FORMAT.createTables();
      AGENT_FORMAT.initialized = true;
      
      console.log('✅ ConversationSessionAgent initialized successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ ConversationSessionAgent initialization failed:', error);
      return { success: false, error: error.message };
    }
  },

  async createTables() {
    try {
      // Create conversation_sessions table
      await AGENT_FORMAT.database.exec(`
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
      await AGENT_FORMAT.database.exec(`
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
  },

  async execute(params, context = {}) {
    if (!AGENT_FORMAT.initialized) {
      await AGENT_FORMAT.bootstrap({}, context);
    }

    const { action, ...options } = params;

    try {
      switch (action) {
        case 'session-create':
          return await AGENT_FORMAT.createSession(options, context);
        case 'session-list':
          return await AGENT_FORMAT.listSessions(options, context);
        case 'session-get':
          return await AGENT_FORMAT.getSession(options, context);
        case 'session-update':
          return await AGENT_FORMAT.updateSession(options, context);
        case 'session-delete':
          return await AGENT_FORMAT.deleteSession(options, context);
        case 'session-hibernate':
          return await AGENT_FORMAT.hibernateSession(options, context);
        case 'session-resume':
          return await AGENT_FORMAT.resumeSession(options, context);
        case 'context-similarity':
          return await AGENT_FORMAT.checkContextSimilarity(options, context);
        case 'auto-trigger-evaluate':
          return await AGENT_FORMAT.evaluateAutoTrigger(options, context);
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
  },

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
      const stmt = AGENT_FORMAT.database.prepare(`
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
  },

  async listSessions(options, context) {
    const { 
      includeHibernated = false, 
      limit = 50, 
      offset = 0,
      sortBy = 'last_activity_at',
      sortOrder = 'DESC'
    } = options;

    try {
      let query = `
        SELECT * FROM conversation_sessions 
        WHERE is_active = true
      `;

      if (!includeHibernated) {
        query += ` AND is_hibernated = false`;
      }

      query += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;

      const stmt = AGENT_FORMAT.database.prepare(query);
      const sessions = stmt.all(limit, offset);

      // Parse JSON fields
      const parsedSessions = sessions.map(session => ({
        ...session,
        contextData: JSON.parse(session.context_data || '{}'),
        relatedMemories: JSON.parse(session.related_memories || '[]'),
        currentActivity: JSON.parse(session.current_activity || '{}'),
        hibernationData: JSON.parse(session.hibernation_data || '{}')
      }));

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total FROM conversation_sessions 
        WHERE is_active = true
        ${!includeHibernated ? 'AND is_hibernated = false' : ''}
      `;
      const countResult = AGENT_FORMAT.database.prepare(countQuery).get();

      return {
        success: true,
        data: {
          sessions: parsedSessions,
          pagination: {
            total: countResult.total,
            limit,
            offset,
            hasMore: (offset + limit) < countResult.total
          }
        }
      };
    } catch (error) {
      console.error('❌ Failed to list sessions:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async getSession(options, context) {
    const { sessionId } = options;

    try {
      const stmt = AGENT_FORMAT.database.prepare(`
        SELECT * FROM conversation_sessions WHERE id = ?
      `);
      const session = stmt.get(sessionId);

      if (!session) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      // Parse JSON fields
      const parsedSession = {
        ...session,
        contextData: JSON.parse(session.context_data || '{}'),
        relatedMemories: JSON.parse(session.related_memories || '[]'),
        currentActivity: JSON.parse(session.current_activity || '{}'),
        hibernationData: JSON.parse(session.hibernation_data || '{}')
      };

      return {
        success: true,
        data: parsedSession
      };
    } catch (error) {
      console.error('❌ Failed to get session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async updateSession(options, context) {
    const { 
      sessionId, 
      title, 
      contextData, 
      relatedMemories, 
      currentActivity,
      messageCount 
    } = options;

    try {
      const updates = [];
      const values = [];

      if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
      }
      if (contextData !== undefined) {
        updates.push('context_data = ?');
        values.push(JSON.stringify(contextData));
      }
      if (relatedMemories !== undefined) {
        updates.push('related_memories = ?');
        values.push(JSON.stringify(relatedMemories));
      }
      if (currentActivity !== undefined) {
        updates.push('current_activity = ?');
        values.push(JSON.stringify(currentActivity));
      }
      if (messageCount !== undefined) {
        updates.push('message_count = ?');
        values.push(messageCount);
      }

      updates.push('updated_at = ?', 'last_activity_at = ?');
      const now = new Date().toISOString();
      values.push(now, now);

      values.push(sessionId);

      const stmt = AGENT_FORMAT.database.prepare(`
        UPDATE conversation_sessions 
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      const result = stmt.run(...values);

      if (result.changes === 0) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      return {
        success: true,
        data: { updated: true, sessionId }
      };
    } catch (error) {
      console.error('❌ Failed to update session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async deleteSession(options, context) {
    const { sessionId } = options;

    try {
      const stmt = AGENT_FORMAT.database.prepare(`
        UPDATE conversation_sessions 
        SET is_active = ?, updated_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(false, new Date().toISOString(), sessionId);

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
  },

  async hibernateSession(options, context) {
    const { sessionId, hibernationData = {} } = options;

    try {
      const stmt = AGENT_FORMAT.database.prepare(`
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
  },

  async resumeSession(options, context) {
    const { sessionId } = options;

    try {
      const stmt = AGENT_FORMAT.database.prepare(`
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
  },

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
  },

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
        const sessionResult = await AGENT_FORMAT.createSession({
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
};

module.exports = AGENT_FORMAT;
