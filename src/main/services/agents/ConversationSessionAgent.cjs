/**
 * ConversationSessionAgent - Manages multi-chat conversation sessions
 * Handles session creation, hibernation, resumption, and context awareness
 */

const path = require('path');
const logger = require('./../../logger.cjs');
const fs = require('fs').promises;

const AGENT_FORMAT = {
  name: 'ConversationSessionAgent',
  description: 'Manages multi-chat conversation sessions with context awareness and auto-initiation',
  initialized: false,
  bootstrapping: false,
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Conversation session operation to perform',
        enum: [
          'session-create', 'session-list', 'session-get', 'session-update',
          'session-delete', 'session-hibernate', 'session-resume',
          'context-similarity', 'auto-trigger-evaluate',
          'message-add', 'message-list', 'message-get', 'message-update', 'message-delete'
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
      // Prevent concurrent bootstrapping
      if (AGENT_FORMAT.initialized) {
        logger.debug('🔄 ConversationSessionAgent already initialized');
        return { success: true };
      }
      
      if (AGENT_FORMAT.bootstrapping) {
        logger.debug('⏳ ConversationSessionAgent bootstrap in progress, waiting...');
        // Wait for existing bootstrap to complete
        while (AGENT_FORMAT.bootstrapping && !AGENT_FORMAT.initialized) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return { success: true };
      }
      
      AGENT_FORMAT.bootstrapping = true;
      
      AGENT_FORMAT.database = context.database;
      if (!AGENT_FORMAT.database) {
        throw new Error('Database connection required for ConversationSessionAgent');
      }

      // Create conversation sessions table
      await AGENT_FORMAT.createTables();
      AGENT_FORMAT.initialized = true;
      AGENT_FORMAT.bootstrapping = false;
      
      logger.debug('✅ ConversationSessionAgent initialized successfully');
      return { success: true };
    } catch (error) {
      AGENT_FORMAT.bootstrapping = false;
      logger.error('❌ ConversationSessionAgent initialization failed:', error);
      return { success: false, error: error.message };
    }
  },

  async createTables() {
    try {
      // Create conversation_sessions table
      await AGENT_FORMAT.database.run(`
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
      await AGENT_FORMAT.database.run(`
        CREATE TABLE IF NOT EXISTS session_context (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          context_type TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding BLOB,
          metadata TEXT DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
        )
      `);



      // Create conversation_messages table for persistent message storage
      await AGENT_FORMAT.database.run(`
        CREATE TABLE IF NOT EXISTS conversation_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          text TEXT NOT NULL,
          sender TEXT NOT NULL CHECK (sender IN ('user', 'ai')),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          embedding TEXT DEFAULT NULL,
          FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
        )
      `);
      
      // Add embedding column if it doesn't exist (for existing tables)
      // Use PRAGMA table_info which works better with ATTACH
      try {
        const columnCheck = await AGENT_FORMAT.database.query(`
          PRAGMA table_info('conversation_messages')
        `);
        
        const hasEmbeddingColumn = columnCheck.some(col => col.name === 'embedding');
        
        if (!hasEmbeddingColumn) {
          logger.debug('🔄 Adding missing embedding column to conversation_messages table...');
          await AGENT_FORMAT.database.run(`
            ALTER TABLE conversation_messages ADD COLUMN embedding TEXT DEFAULT NULL
          `);
          logger.debug('✅ Added embedding column to conversation_messages table');
        } else {
          logger.debug('ℹ️ Embedding column already exists');
        }
      } catch (error) {
        // Try to add the column anyway - check for both DuckDB error messages
        if (error && error.message && (
          error.message.includes('duplicate column name') || 
          error.message.includes('Column with name embedding already exists') ||
          error.message.includes('already exists')
        )) {
          // Silently ignore - column already exists
          logger.debug('ℹ️ Embedding column already exists');
        } else {
          logger.warn('⚠️ Failed to add embedding column:', error?.message || error);
          // Don't throw - this is non-critical
        }
      }

      // Create session_message_chunks table for scalable conversation context
      // (Created after conversation_messages to avoid foreign key issues)
      await AGENT_FORMAT.database.run(`
        CREATE TABLE IF NOT EXISTS session_message_chunks (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          chunk_start_msg_id TEXT NOT NULL,
          chunk_end_msg_id TEXT NOT NULL,
          message_count INTEGER NOT NULL,
          chunk_content TEXT NOT NULL,
          chunk_embedding BLOB,
          chunk_index INTEGER NOT NULL,
          chunk_type TEXT DEFAULT 'sequential',
          metadata TEXT DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      logger.debug('✅ ConversationSessionAgent tables created successfully');
    } catch (error) {
      logger.error('❌ Failed to create ConversationSessionAgent tables:', error);
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
        case 'message-add':
          return await AGENT_FORMAT.addMessage(options, context);
        case 'message-list':
          return await AGENT_FORMAT.listMessages(options, context);
        case 'message-get':
          return await AGENT_FORMAT.getMessage(options, context);
        case 'message-update':
          return await AGENT_FORMAT.updateMessage(options, context);
        case 'message-delete':
          return await AGENT_FORMAT.deleteMessage(options, context);
        case 'get-conversation-messages-with-embeddings':
          return await AGENT_FORMAT.getConversationMessagesWithEmbeddings(options, context);
        case 'session-switch':
          return await AGENT_FORMAT.switchToSession(options, context);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            availableActions: [
              'session-create', 'session-list', 'session-get', 'session-update',
              'session-delete', 'session-hibernate', 'session-resume', 'session-switch',
              'context-similarity', 'auto-trigger-evaluate'
            ]
          };
      }
    } catch (error) {
      logger.error(`❌ ConversationSessionAgent action '${action}' failed:`, error);
      return {
        success: false,
        error: error.message,
        action,
        timestamp: new Date().toISOString()
      };
    }
  },

  async createSession(params, context) {
    logger.debug('createSession received params:', JSON.stringify(params, null, 2));
    
    // Extract the actual options from the nested structure
    const actualOptions = params.options || params;
    
    const {
      sessionType,
      title,
      triggerReason = 'manual',
      triggerConfidence = 0.0,
      contextData = {},
      relatedMemories = [],
      currentActivity = {}
    } = actualOptions;
    
    logger.debug('Destructured values:', { sessionType, title, triggerReason, triggerConfidence });

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // First, set all existing sessions to inactive
      await AGENT_FORMAT.database.run(`
        UPDATE conversation_sessions SET is_active = false WHERE is_active = true
      `);
      
      const now = new Date().toISOString();
      const params = [
        sessionId,
        sessionType || 'user-initiated',
        title || 'New Chat Session',
        triggerReason,
        triggerConfidence,
        JSON.stringify(contextData),
        JSON.stringify(relatedMemories),
        JSON.stringify(currentActivity),
        true, // is_active - only this new session is active
        false, // is_hibernated
        '{}', // hibernation_data
        0, // message_count
        now, // created_at
        now, // updated_at
        now // last_activity_at
      ];

      logger.debug('Inserting session with params:', params);

      await AGENT_FORMAT.database.run(`
        INSERT INTO conversation_sessions (
          id, type, title, trigger_reason, trigger_confidence,
          context_data, related_memories, current_activity,
          is_active, is_hibernated, hibernation_data, message_count,
          created_at, updated_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, params);

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
      logger.error('❌ Failed to create session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async listSessions(options, context) {
    const { limit = 50, offset = 0, includeHibernated = false, sortBy = 'last_activity_at', sortOrder = 'DESC' } = options;

    try {
      // Return ALL sessions, not just active ones - frontend will handle display logic
      let query = `
        SELECT * FROM conversation_sessions 
        WHERE 1=1
      `;

      if (!includeHibernated) {
        query += ` AND is_hibernated = false`;
      }

      query += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;

      const sessions = await AGENT_FORMAT.database.query(query, [limit, offset]);
      
      logger.debug('📋 Raw sessions from database:', sessions.length, 'sessions');
      // sessions.forEach((session, index) => {
      //   logger.debug(`Session ${index}:`, {
      //     id: session.id,
      //     title: session.title,
      //     type: session.type,
      //     created_at: session.created_at
      //   });
      // });

      // Parse JSON fields and populate additional data
      const parsedSessions = await Promise.all(sessions.map(async (session) => {
        try {
          // logger.debug(`🔍 Processing session ${session.id}...`);
          
          // Get message count for this session
          const countQuery = `
            SELECT COUNT(*) as count
            FROM conversation_messages 
            WHERE session_id = ?
          `;
          
          const countResult = await AGENT_FORMAT.database.query(countQuery, [session.id]);
          const messageCount = countResult[0]?.count || 0;
          
          // Get the actual last message text and timestamp
          let lastMessage = null;
          let lastMessageTime = null;
          if (messageCount > 0) {
            const lastMessageQuery = `
              SELECT text, created_at FROM conversation_messages 
              WHERE session_id = ? 
              ORDER BY created_at DESC 
              LIMIT 1
            `;
            const lastMessageResult = await AGENT_FORMAT.database.query(lastMessageQuery, [session.id]);
            if (lastMessageResult[0]) {
              lastMessage = lastMessageResult[0].text;
              lastMessageTime = lastMessageResult[0].created_at;
              logger.debug(`💬 Session ${session.id}: Last message: "${lastMessage?.substring(0, 50)}..."`);
            }
          }

          const processedSession = {
            id: session.id,
            type: session.type,
            title: session.title,
            triggerReason: session.trigger_reason,
            triggerConfidence: session.trigger_confidence,
            contextData: JSON.parse(session.context_data || '{}'),
            relatedMemories: JSON.parse(session.related_memories || '[]'),
            currentActivity: JSON.parse(session.current_activity || '{}'),
            hibernationData: JSON.parse(session.hibernation_data || '{}'),
            isActive: session.is_active,
            isHibernated: session.is_hibernated,
            messageCount: parseInt(messageCount) || 0,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
            lastActivityAt: lastMessageTime || session.last_activity_at || session.created_at,
            lastMessage: lastMessage,
            unreadCount: 0
          };
          
          // logger.debug(`✅ Processed session ${session.id}:`, {
          //   id: processedSession.id,
          //   title: processedSession.title,
          //   messageCount: processedSession.messageCount,
          //   lastMessage: processedSession.lastMessage?.substring(0, 30),
          //   isActive: processedSession.isActive
          // });
          
          return processedSession;
        } catch (error) {
          logger.error(`❌ Error processing session ${session.id}:`, error);
          // Return a basic session object if processing fails
          return {
            id: session.id,
            type: session.type,
            title: session.title,
            triggerReason: session.trigger_reason,
            triggerConfidence: session.trigger_confidence,
            contextData: JSON.parse(session.context_data || '{}'),
            relatedMemories: JSON.parse(session.related_memories || '[]'),
            currentActivity: JSON.parse(session.current_activity || '{}'),
            hibernationData: JSON.parse(session.hibernation_data || '{}'),
            isActive: session.is_active,
            isHibernated: session.is_hibernated,
            messageCount: 0,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
            lastActivityAt: session.last_activity_at || session.created_at,
            lastMessage: null,
            unreadCount: 0
          };
        }
      }));
      
      logger.debug('📋 Parsed sessions:', parsedSessions.length, 'sessions');
      // parsedSessions.forEach((session, index) => {
      //   logger.debug(`Parsed Session ${index}:`, {
      //     id: session.id,
      //     title: session.title,
      //     type: session.type,
      //     isActive: session.isActive,
      //     messageCount: session.messageCount,
      //     lastMessage: session.lastMessage?.substring(0, 30)
      //   });
      // });

      // If no active session exists and we have sessions, activate the most recent one with messages
      const hasActiveSession = parsedSessions.some(s => s.isActive);
      if (!hasActiveSession && parsedSessions.length > 0) {
        logger.debug('🔧 [ConversationSessionAgent] No active session found, activating most recent session with messages...');
        
        // Find the most recent session with messages, or just the most recent session
        const sessionWithMessages = parsedSessions
          .filter(s => s.messageCount > 0)
          .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())[0];
        
        const sessionToActivate = sessionWithMessages || parsedSessions[0];
        
        if (sessionToActivate) {
          logger.debug(`🎯 [ConversationSessionAgent] Auto-activating session: ${sessionToActivate.id} (${sessionToActivate.title})`);
          
          // Set this session as active in the database
          await AGENT_FORMAT.database.run(`
            UPDATE conversation_sessions 
            SET is_active = true, updated_at = ?
            WHERE id = ?
          `, [new Date().toISOString(), sessionToActivate.id]);
          
          // Update the session object to reflect the change
          sessionToActivate.isActive = true;
          
          logger.debug(`✅ [ConversationSessionAgent] Successfully activated session: ${sessionToActivate.id}`);
        }
      }

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total FROM conversation_sessions 
        WHERE is_active = true
        ${!includeHibernated ? 'AND is_hibernated = false' : ''}
      `;
      const countResult = await AGENT_FORMAT.database.query(countQuery);
      const total = countResult[0]?.total || 0;

      const returnData = {
        success: true,
        data: {
          sessions: parsedSessions,
          pagination: {
            total: total,
            limit,
            offset,
            hasMore: (offset + limit) < total
          }
        }
      };
      
      logger.debug('🔄 [ConversationSessionAgent] Returning session list result:', {
        success: returnData.success,
        sessionsCount: returnData.data.sessions.length,
        total: returnData.data.pagination.total
      });
      
      return returnData;
    } catch (error) {
      logger.error('❌ Failed to list sessions:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async getSession(options, context) {
    const { sessionId } = options;

    try {
      const sessions = await AGENT_FORMAT.database.query(`
        SELECT * FROM conversation_sessions WHERE id = ?
      `, [sessionId]);
      const session = sessions[0];

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
      logger.error('❌ Failed to get session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async updateSession(options, context) {
    logger.debug('🔧 [ConversationSessionAgent] Raw options received:', options);
    
    // Handle nested options structure
    const actualOptions = options.options || options;
    const { 
      sessionId, 
      title, 
      contextData, 
      relatedMemories, 
      currentActivity,
      messageCount 
    } = actualOptions;

    logger.debug('🔧 [ConversationSessionAgent] updateSession called with:', { sessionId, title, contextData, relatedMemories, currentActivity, messageCount });

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

      const sql = `UPDATE conversation_sessions SET ${updates.join(', ')} WHERE id = ?`;
      logger.debug('🔧 [ConversationSessionAgent] SQL query:', sql);
      logger.debug('🔧 [ConversationSessionAgent] Values array:', values);
      logger.debug('🔧 [ConversationSessionAgent] Updates array:', updates);

      await AGENT_FORMAT.database.run(sql, values);

      // Check if session exists by querying it
      const checkResult = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_sessions WHERE id = ?
      `, [sessionId]);

      if (checkResult.length === 0) {
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
      logger.error('❌ Failed to update session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async switchToSession(options, context) {
    const { sessionId } = options.options || options;

    // Validate sessionId
    if (!sessionId || sessionId === 'undefined') {
      logger.error('❌ switchToSession: Invalid sessionId:', sessionId);
      return {
        success: false,
        error: 'Invalid or missing sessionId'
      };
    }

    try {
      // First, set all sessions to inactive
      await AGENT_FORMAT.database.run(`
        UPDATE conversation_sessions SET is_active = false WHERE is_active = true
      `);

      // Then set the target session to active (without updating last_activity_at to preserve order)
      const now = new Date().toISOString();
      const params = [true, now, sessionId];
      
      await AGENT_FORMAT.database.run(`
        UPDATE conversation_sessions 
        SET is_active = ?, updated_at = ?
        WHERE id = ?
      `, params);

      // Check if session exists by querying it
      const checkResult = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_sessions WHERE id = ?
      `, [sessionId]);

      if (checkResult.length === 0) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`
        };
      }

      return {
        success: true,
        data: { 
          switched: true, 
          sessionId,
          message: `Switched to session: ${sessionId}`
        }
      };
    } catch (error) {
      logger.error('❌ Failed to switch session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async deleteSession(options, context) {
    const { sessionId } = options;

    try {
      await AGENT_FORMAT.database.run(`
        UPDATE conversation_sessions 
        SET is_active = ?, updated_at = ?
        WHERE id = ?
      `, [false, new Date().toISOString(), sessionId]);

      // Check if session exists by querying it
      const checkResult = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_sessions WHERE id = ?
      `, [sessionId]);

      if (checkResult.length === 0) {
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
      logger.error('❌ Failed to delete session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async hibernateSession(options, context) {
    const { sessionId, hibernationData = {} } = options;

    try {
      await AGENT_FORMAT.database.run(`
        UPDATE conversation_sessions 
        SET is_hibernated = ?, hibernation_data = ?, updated_at = ?
        WHERE id = ?
      `, [
        true,
        JSON.stringify(hibernationData),
        new Date().toISOString(),
        sessionId
      ]);

      // Check if session exists by querying it
      const checkResult = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_sessions WHERE id = ?
      `, [sessionId]);

      if (checkResult.length === 0) {
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
      logger.error('❌ Failed to hibernate session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async resumeSession(options, context) {
    const { sessionId } = options;

    try {
      const now = new Date().toISOString();
      await AGENT_FORMAT.database.run(`
        UPDATE conversation_sessions 
        SET is_hibernated = ?, is_active = ?, updated_at = ?, last_activity_at = ?
        WHERE id = ?
      `, [false, true, now, now, sessionId]);

      // Check if session exists by querying it
      const checkResult = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_sessions WHERE id = ?
      `, [sessionId]);

      if (checkResult.length === 0) {
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
      logger.error('❌ Failed to resume session:', error);
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
      logger.error('❌ Failed to check context similarity:', error);
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
      logger.error('❌ Failed to evaluate auto trigger:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Message Management Methods
  async addMessage(options, context) {
    // Handle both direct options and nested options structure
    const actualOptions = options.options || options;
    const { sessionId, text: rawText, sender, metadata = {} } = actualOptions;

    // Extract response text properly - handle both string and object formats
    let text = rawText;
    logger.debug('🔍 [CONVERSATION_ADD_MESSAGE] Raw text type:', typeof text);
    logger.debug('🔍 [CONVERSATION_ADD_MESSAGE] Raw text value:', text);
    
    while (typeof text === 'object' && text !== null) {
      if (text.response) {
        text = text.response;
        logger.debug('🔧 [CONVERSATION_ADD_MESSAGE] Extracted nested response:', text);
      } else if (text.data && text.data.response) {
        text = text.data.response;
        logger.debug('🔧 [CONVERSATION_ADD_MESSAGE] Extracted data.response:', text);
      } else {
        // If it's an object but no 'response' property, stringify it
        text = JSON.stringify(text);
        logger.debug('🔧 [CONVERSATION_ADD_MESSAGE] Stringified object response:', text);
        break;
      }
    }
    
    // Ensure we have a plain string
    text = typeof text === 'string' ? text : String(text);
    logger.debug('✅ [CONVERSATION_ADD_MESSAGE] Final extracted text:', text);

    logger.debug('🔍 [DEBUG] addMessage received:', { sessionId, text, sender, metadata });

    // Validate required parameters
    if (!sessionId || !text || !sender) {
      logger.error('❌ [DEBUG] Missing required parameters:', { sessionId, text, sender });
      return {
        success: false,
        error: 'Missing required parameters: sessionId, text, and sender are required'
      };
    }

    try {
      // Check for duplicate messages (same text, sender, session within last 5 seconds)
      const recentCutoff = new Date(Date.now() - 5000).toISOString();
      const duplicateCheck = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_messages 
        WHERE session_id = ? AND text = ? AND sender = ? AND timestamp > ?
        ORDER BY timestamp DESC LIMIT 1
      `, [sessionId, text, sender, recentCutoff]);

      if (duplicateCheck.length > 0) {
        logger.debug('⚠️ [DEBUG] Duplicate message detected, skipping insertion:', duplicateCheck[0].id);
        return {
          success: true,
          data: { messageId: duplicateCheck[0].id, isDuplicate: true }
        };
      }

      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = new Date().toISOString();

      logger.debug('🔍 [DEBUG] About to insert with parameters:', [messageId, sessionId, text, sender, timestamp, JSON.stringify(metadata)]);

      await AGENT_FORMAT.database.run(`
        INSERT INTO conversation_messages (id, session_id, text, sender, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [messageId, sessionId, text, sender, timestamp, JSON.stringify(metadata)]);

      // Update session message count and last activity
      await AGENT_FORMAT.database.run(`
        UPDATE conversation_sessions 
        SET message_count = message_count + 1, 
            updated_at = ?, 
            last_activity_at = ?
        WHERE id = ?
      `, [timestamp, timestamp, sessionId]);

      // Background embedding generation (non-blocking) - TWO-TIER APPROACH
      setImmediate(async () => {
        try {
          logger.debug('🔄 [BACKGROUND] Generating embeddings for message and session:', messageId);
          
          // Skip embedding generation for very short or system messages
          if (text.length < 10 || text.startsWith('[System') || text.match(/^(ok|thanks?|yes|no)$/i)) {
            logger.debug('⚠️ [BACKGROUND] Skipping embedding for short/system message');
            return;
          }
          
          if (context?.executeAgent) {
            // TIER 1: Generate message-level embedding
            const embeddingResult = await context.executeAgent('SemanticEmbeddingAgent', {
              action: 'generate-embedding',
              text: text
            }, context);
            
            if (embeddingResult.success && embeddingResult.result?.embedding) {
              // Store embedding in conversation_messages table
              await AGENT_FORMAT.database.run(`
                UPDATE conversation_messages 
                SET embedding = ? 
                WHERE id = ?
              `, [JSON.stringify(embeddingResult.result.embedding), messageId]);
              
              logger.debug('✅ [BACKGROUND] Tier 1 - Message embedding generated:', messageId);
            } else {
              logger.warn('⚠️ [BACKGROUND] Failed to generate message embedding:', embeddingResult.error);
            }

            // TIER 2: Generate/Update session-level embedding
            await AGENT_FORMAT.updateSessionEmbedding(sessionId, context);
            
            // TIER 3: Update session message chunks for scalable context
            await AGENT_FORMAT.updateSessionChunks(sessionId, context);
            
            // TIER 4: Create memory entry for meaningful user messages
            if (sender === 'user' && text.length > 20 && !text.match(/^(ok|thanks?|yes|no|hi|hello)$/i)) {
              await AGENT_FORMAT.createMemoryFromMessage(messageId, sessionId, text, sender, timestamp, context);
            }
            
          } else {
            logger.warn('⚠️ [BACKGROUND] executeAgent not available for embedding generation');
          }
        } catch (error) {
          logger.error('❌ [BACKGROUND] Embedding generation failed:', error);
        }
      });

      return {
        success: true,
        data: {
          messageId,
          sessionId,
          text,
          sender,
          timestamp,
          metadata
        }
      };
    } catch (error) {
      logger.error('❌ Failed to add message:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  // TIER 4: Create memory entry from meaningful user messages (Smart Storage)
  async createMemoryFromMessage(messageId, sessionId, text, sender, timestamp, context) {
    try {
      logger.debug('🧠 [BACKGROUND] Smart memory analysis for message:', messageId);
      
      // Only create memories for user messages with meaningful content
      if (sender !== 'user' || text.length < 15) {
        return;
      }
      
      // FAST CHECK 1: Skip obvious conversational queries (preserve existing conversation scope stages)
      const conversationalQueryPatterns = [
        /^(have i|did i|do i|what did i|when did i|where did i|how did i|why did i)/i,
        /^(what about|tell me about|explain|describe|show me)/i,
        /^(can you|could you|would you|will you|please|help me)/i,
        /^(what|how|when|where|why|who)(\s+\w+){0,3}\?/i
      ];
      
      for (const pattern of conversationalQueryPatterns) {
        if (pattern.test(text.trim())) {
          logger.debug('⚠️ [BACKGROUND] Skipping conversational query - preserving for context stages');
          return;
        }
      }
      
      // FAST CHECK 2: Skip basic conversational responses
      const basicResponsePatterns = [
        /^(ok|okay|thanks?|thank you|yes|no|hi|hello|bye|goodbye)$/i,
        /^(i don't know|i'm not sure|maybe|perhaps|probably)$/i,
        /^(sure|fine|alright|sounds good)$/i
      ];
      
      for (const pattern of basicResponsePatterns) {
        if (pattern.test(text.trim())) {
          logger.debug('⚠️ [BACKGROUND] Skipping basic conversational response');
          return;
        }
      }
      
      // FAST CHECK 3: Detect obvious learning goals (high-value storage patterns)
      const learningGoalPatterns = [
        /^(remember|note|save|store|keep in mind|don't forget)/i,
        /^(i have|i'm|i am|my|i like|i prefer|i need|i want)/i,
        /(appointment|meeting|schedule|deadline|reminder)/i,
        /(favorite|preference|important|address|phone|email)/i,
        /(birthday|anniversary|event|trip|vacation)/i
      ];
      
      let hasLearningGoal = false;
      for (const pattern of learningGoalPatterns) {
        if (pattern.test(text)) {
          hasLearningGoal = true;
          logger.debug('✅ [BACKGROUND] Detected learning goal pattern');
          break;
        }
      }
      
      // SMART CHECK 4: For ambiguous cases, use lightweight conversational classification
      if (!hasLearningGoal) {
        try {
          // Quick conversational query classification to prevent false positives
          const classificationResult = await context.executeAgent('UserMemoryAgent', {
            action: 'classify-conversational-query',
            query: text
          }, context);
          
          if (classificationResult.success && classificationResult.result?.result?.isConversational) {
            logger.debug('⚠️ [BACKGROUND] LLM classified as conversational query - preserving for context stages');
            return;
          }
          
          logger.debug('✅ [BACKGROUND] LLM approved for memory storage');
        } catch (error) {
          logger.warn('⚠️ [BACKGROUND] LLM classification failed, using pattern-based decision:', error.message);
          // Fall back to pattern-based decision
          if (text.length < 30 && !hasLearningGoal) {
            logger.debug('⚠️ [BACKGROUND] Short text without learning goal - skipping');
            return;
          }
        }
      }
      
      // Extract intent and entities before storing memory
      let extractedIntent = hasLearningGoal ? 'learning_goal' : 'conversation_memory';
      let entities = [];
      
      try {
        // Use Phi3Agent for intelligent intent classification instead of hardcoded patterns
        const intentResult = await context.executeAgent('Phi3Agent', {
          action: 'classify-intent',
          message: text
        }, context);
        
        if (intentResult.success && intentResult.intentData?.primaryIntent) {
          extractedIntent = intentResult.intentData.primaryIntent;
          entities = intentResult.intentData.entities || [];
          logger.debug('✅ [BACKGROUND] Extracted intent via Phi3:', extractedIntent, 'entities:', entities.length);
        }
      } catch (intentError) {
        logger.warn('⚠️ [BACKGROUND] Phi3 intent extraction failed, using basic intent:', intentError.message);
      }
      
      // Create memory entry using UserMemoryAgent with extracted intent
      const memoryResult = await context.executeAgent('UserMemoryAgent', {
        action: 'memory-store',
        sourceText: text,
        suggestedResponse: null,
        primaryIntent: extractedIntent,
        entities: entities,
        metadata: {
          messageId: messageId,
          sessionId: sessionId,
          sender: sender,
          timestamp: timestamp,
          source: 'conversation',
          hasLearningGoal: hasLearningGoal,
          intentExtracted: true
        }
      }, context);
      
      if (memoryResult.success) {
        logger.debug('✅ [BACKGROUND] Smart memory created from message:', messageId);
      } else {
        logger.warn('⚠️ [BACKGROUND] Failed to create memory from message:', memoryResult.error);
      }
      
    } catch (error) {
      logger.error('❌ [BACKGROUND] Smart memory creation failed:', error);
    }
  },

  // TIER 2: Session-level embedding generation for Two-Tier Semantic Search
  async updateSessionEmbedding(sessionId, context) {
    try {
      logger.debug('🔄 [BACKGROUND] Tier 2 - Generating session embedding for:', sessionId);
      
      // Get session details and recent messages to create session context
      const session = await AGENT_FORMAT.database.query(`
        SELECT title, type, trigger_reason, context_data FROM conversation_sessions WHERE id = ?
      `, [sessionId]);
      
      if (session.length === 0) {
        logger.warn('⚠️ [BACKGROUND] Session not found for embedding:', sessionId);
        return;
      }
      
      // Get first few and last few messages to represent session context
      const messages = await AGENT_FORMAT.database.query(`
        SELECT text, sender, timestamp FROM conversation_messages 
        WHERE session_id = ? 
        ORDER BY timestamp ASC
        LIMIT 10
      `, [sessionId]);
      
      if (messages.length === 0) {
        logger.debug('⚠️ [BACKGROUND] No messages found for session embedding');
        return;
      }
      
      // Create session summary for embedding
      const sessionData = session[0];
      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];
      
      // Build session context text
      let sessionContext = `Session: ${sessionData.title}\n`;
      sessionContext += `Type: ${sessionData.type}\n`;
      sessionContext += `Trigger: ${sessionData.trigger_reason}\n`;
      sessionContext += `First message: ${firstMessage.text}\n`;
      
      if (messages.length > 1) {
        sessionContext += `Recent messages: ${messages.slice(-3).map(m => `${m.sender}: ${m.text}`).join('; ')}\n`;
      }
      
      // Add context data if available
      try {
        const contextData = JSON.parse(sessionData.context_data || '{}');
        if (Object.keys(contextData).length > 0) {
          sessionContext += `Context: ${JSON.stringify(contextData)}\n`;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
      
      logger.debug('🔍 [BACKGROUND] Session context for embedding:', sessionContext.substring(0, 200) + '...');
      
      // Generate embedding for session context
      const embeddingResult = await context.executeAgent('SemanticEmbeddingAgent', {
        action: 'generate-embedding',
        text: sessionContext
      }, context);
      
      if (embeddingResult.success && embeddingResult.result?.embedding) {
        // Store/update session embedding in session_context table
        const contextId = `ctx_${sessionId}_${Date.now()}`;
        
        // First, remove any existing session context embeddings
        await AGENT_FORMAT.database.run(`
          DELETE FROM session_context WHERE session_id = ? AND context_type = 'session_summary'
        `, [sessionId]);
        
        // Insert new session context embedding
        await AGENT_FORMAT.database.run(`
          INSERT INTO session_context (id, session_id, context_type, content, embedding, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          contextId,
          sessionId,
          'session_summary',
          sessionContext,
          JSON.stringify(embeddingResult.result.embedding),
          JSON.stringify({ 
            messageCount: messages.length,
            firstMessageTime: firstMessage.timestamp,
            lastMessageTime: lastMessage.timestamp
          }),
          new Date().toISOString()
        ]);
        
        logger.debug('✅ [BACKGROUND] Tier 2 - Session embedding generated and stored:', sessionId);
      } else {
        logger.warn('⚠️ [BACKGROUND] Failed to generate session embedding:', embeddingResult.error);
      }
      
    } catch (error) {
      logger.error('❌ [BACKGROUND] Session embedding generation failed:', error);
    }
  },

  async updateSessionChunks(sessionId, context) {
    try {
      logger.debug('🔄 [BACKGROUND] Tier 3 - Updating session chunks for:', sessionId);
      
      // Get all messages for this session
      const messages = await AGENT_FORMAT.database.query(`
        SELECT id, text, sender, timestamp FROM conversation_messages 
        WHERE session_id = ? 
        ORDER BY timestamp ASC
      `, [sessionId]);
      
      if (messages.length === 0) {
        logger.debug('⚠️ [BACKGROUND] No messages found for chunk generation');
        return;
      }
      
      const CHUNK_SIZE = 20; // Messages per chunk
      const CHUNK_OVERLAP = 5; // Overlapping messages between chunks
      
      // Get existing chunks to see what needs updating
      const existingChunks = await AGENT_FORMAT.database.query(`
        SELECT chunk_index, chunk_end_msg_id FROM session_message_chunks 
        WHERE session_id = ? 
        ORDER BY chunk_index DESC 
        LIMIT 1
      `, [sessionId]);
      
      let startIndex = 0;
      let chunkIndex = 0;
      
      if (existingChunks.length > 0) {
        // Find where the last chunk ended
        const lastChunk = existingChunks[0];
        const lastMsgIndex = messages.findIndex(m => m.id === lastChunk.chunk_end_msg_id);
        
        if (lastMsgIndex >= 0) {
          // Start new chunk with overlap from previous chunk
          startIndex = Math.max(0, lastMsgIndex - CHUNK_OVERLAP + 1);
          chunkIndex = lastChunk.chunk_index + 1;
          
          // Remove the last chunk if we're updating it
          await AGENT_FORMAT.database.run(`
            DELETE FROM session_message_chunks 
            WHERE session_id = ? AND chunk_index = ?
          `, [sessionId, lastChunk.chunk_index]);
          
          chunkIndex = lastChunk.chunk_index; // Reuse the index
        }
      }
      
      // Create chunks from messages
      let chunksCreated = 0;
      
      while (startIndex < messages.length) {
        const endIndex = Math.min(startIndex + CHUNK_SIZE, messages.length);
        const chunkMessages = messages.slice(startIndex, endIndex);
        
        if (chunkMessages.length === 0) break;
        
        // Create chunk content
        const chunkContent = chunkMessages.map(m => 
          `${m.sender}: ${m.text} [${m.timestamp}]`
        ).join('\n');
        
        // Generate embedding for chunk
        const embeddingResult = await context.executeAgent('SemanticEmbeddingAgent', {
          action: 'generate-embedding',
          text: chunkContent
        }, context);
        
        if (embeddingResult.success && embeddingResult.result?.embedding) {
          const chunkId = `chunk_${sessionId}_${chunkIndex}_${Date.now()}`;
          
          // Store chunk
          await AGENT_FORMAT.database.run(`
            INSERT INTO session_message_chunks (
              id, session_id, chunk_start_msg_id, chunk_end_msg_id, 
              message_count, chunk_content, chunk_embedding, chunk_index, 
              chunk_type, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            chunkId,
            sessionId,
            chunkMessages[0].id,
            chunkMessages[chunkMessages.length - 1].id,
            chunkMessages.length,
            chunkContent,
            JSON.stringify(embeddingResult.result.embedding),
            chunkIndex,
            'sequential',
            JSON.stringify({
              startTimestamp: chunkMessages[0].timestamp,
              endTimestamp: chunkMessages[chunkMessages.length - 1].timestamp,
              messageRange: `${startIndex + 1}-${endIndex}`
            }),
            new Date().toISOString()
          ]);
          
          chunksCreated++;
          logger.debug(`✅ [BACKGROUND] Created chunk ${chunkIndex} (${chunkMessages.length} messages)`);
        }
        
        // Move to next chunk with overlap
        startIndex = endIndex - CHUNK_OVERLAP;
        chunkIndex++;
        
        // Prevent infinite loops
        if (startIndex >= endIndex - CHUNK_OVERLAP) break;
      }
      
      logger.debug(`✅ [BACKGROUND] Tier 3 - Created/updated ${chunksCreated} chunks for session:`, sessionId);
      
    } catch (error) {
      logger.error('❌ [BACKGROUND] Session chunk generation failed:', error);
    }
  },

  async listMessages(options, context) {
    const { sessionId, limit = 50, offset = 0, direction = 'ASC' } = options.options || options;

    // Validate sessionId
    if (!sessionId || sessionId === 'undefined') {
      logger.error('❌ listMessages: Invalid sessionId:', sessionId);
      return {
        success: false,
        error: 'Invalid or missing sessionId',
        data: {
          messages: [],
          sessionId: null,
          count: 0,
          limit,
          offset
        }
      };
    }

    try {
      // Get total count of messages for this session
      const totalCountResult = await AGENT_FORMAT.database.query(`
        SELECT COUNT(*) as total FROM conversation_messages 
        WHERE session_id = ?
      `, [sessionId]);
      
      const totalCount = totalCountResult[0]?.total || 0;
      
      // Support both ASC (oldest first) and DESC (newest first) ordering
      const orderBy = direction === 'DESC' ? 'timestamp DESC' : 'timestamp ASC';
      
      const messages = await AGENT_FORMAT.database.query(`
        SELECT * FROM conversation_messages 
        WHERE session_id = ? 
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `, [sessionId, limit, offset]);

      
      const result = {
        success: true,
        data: {
          messages: messages.map(msg => ({
            ...msg,
            metadata: JSON.parse(msg.metadata || '{}')
          })),
          sessionId,
          count: messages.length,
          totalCount: totalCount,
          limit,
          offset
        }
      };
      
      // logger.debug(`✅ [ConversationSessionAgent] Returning result:`, {
      //   success: result.success,
      //   messageCount: result.data.messages.length,
      //   sessionId: result.data.sessionId
      // });
      
      return result;
    } catch (error) {
      logger.error('❌ Failed to list messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async getMessage(options, context) {
    const { messageId } = options;

    try {
      const messages = await AGENT_FORMAT.database.query(`
        SELECT * FROM conversation_messages WHERE id = ?
      `, [messageId]);

      const message = messages[0];

      if (!message) {
        return {
          success: false,
          error: `Message not found: ${messageId}`
        };
      }

      return {
        success: true,
        data: {
          ...message,
          metadata: JSON.parse(message.metadata || '{}')
        }
      };
    } catch (error) {
      logger.error('❌ Failed to get message:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async updateMessage(options, context) {
    const { messageId, text, metadata } = options;

    try {
      const updates = [];
      const values = [];

      if (text !== undefined) {
        updates.push('text = ?');
        values.push(text);
      }

      if (metadata !== undefined) {
        updates.push('metadata = ?');
        values.push(JSON.stringify(metadata));
      }

      if (updates.length === 0) {
        return {
          success: false,
          error: 'No updates provided'
        };
      }

      values.push(messageId);

      await AGENT_FORMAT.database.run(`
        UPDATE conversation_messages 
        SET ${updates.join(', ')} 
        WHERE id = ?
      `, values);

      // Check if message exists by querying it
      const checkResult = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_messages WHERE id = ?
      `, [messageId]);

      if (checkResult.length === 0) {
        return {
          success: false,
          error: `Message not found: ${messageId}`
        };
      }

      return {
        success: true,
        data: { messageId, updated: true }
      };
    } catch (error) {
      logger.error('❌ Failed to update message:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async deleteMessage(options, context) {
    const { messageId } = options;

    try {
      await AGENT_FORMAT.database.run(`
        DELETE FROM conversation_messages WHERE id = ?
      `, [messageId]);

      // Check if message exists by querying it first
      const checkResult = await AGENT_FORMAT.database.query(`
        SELECT id FROM conversation_messages WHERE id = ?
      `, [messageId]);

      if (checkResult.length === 0) {
        return {
          success: false,
          error: `Message not found: ${messageId}`
        };
      }

      return {
        success: true,
        data: { messageId, deleted: true }
      };
    } catch (error) {
      logger.error('❌ Failed to delete message:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Get conversation messages with their stored embeddings for semantic similarity
   */
  async getConversationMessagesWithEmbeddings(options, context) {
    const { sessionId, limit = 20, includeSystemMessages = false } = options;
    
    if (!sessionId) {
      return { success: false, error: 'Session ID is required' };
    }

    try {
      // First try to get messages with embeddings, then fallback to all messages
      let sql = `
        SELECT id, session_id, text, sender, timestamp, metadata, embedding, created_at
        FROM conversation_messages 
        WHERE session_id = ? AND embedding IS NOT NULL AND embedding != 'NULL'
      `;
      
      const params = [sessionId];
      
      // Optionally exclude system messages
      if (!includeSystemMessages) {
        sql += ` AND sender != 'system'`;
      }
      
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      let messages = await AGENT_FORMAT.database.query(sql, params);
      
      // If no messages with embeddings found, get recent messages anyway for fallback
      if (messages.length === 0) {
        logger.debug(`⚠️ No messages with embeddings found, falling back to recent messages for session: ${sessionId}`);
        
        let fallbackSql = `
          SELECT id, session_id, text, sender, timestamp, metadata, embedding, created_at
          FROM conversation_messages 
          WHERE session_id = ?
        `;
        
        const fallbackParams = [sessionId];
        
        if (!includeSystemMessages) {
          fallbackSql += ` AND sender != 'system'`;
        }
        
        fallbackSql += ` ORDER BY created_at DESC LIMIT ?`;
        fallbackParams.push(limit);
        
        messages = await AGENT_FORMAT.database.query(fallbackSql, fallbackParams);
      }
      
      logger.debug(`✅ Retrieved ${messages.length} conversation messages for session: ${sessionId} (${messages.filter(m => m.embedding && m.embedding !== 'NULL').length} with embeddings)`);
      
      return {
        success: true,
        result: {
          messages,
          sessionId,
          count: messages.length,
          embeddedCount: messages.filter(m => m.embedding && m.embedding !== 'NULL').length
        }
      };
    } catch (error) {
      logger.error('❌ Failed to get conversation messages with embeddings:', error);
      return {
        success: false,
        error: error.message,
        sessionId
      };
    }
  }
};

module.exports = AGENT_FORMAT;
