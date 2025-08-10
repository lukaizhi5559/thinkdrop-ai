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
          FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
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
      console.error(`❌ ConversationSessionAgent action '${action}' failed:`, error);
      return {
        success: false,
        error: error.message,
        action,
        timestamp: new Date().toISOString()
      };
    }
  },

  async createSession(params, context) {
    console.log('createSession received params:', JSON.stringify(params, null, 2));
    
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
    
    console.log('Destructured values:', { sessionType, title, triggerReason, triggerConfidence });

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

      console.log('Inserting session with params:', params);

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
      console.error('❌ Failed to create session:', error);
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
      
      console.log('📋 Raw sessions from database:', sessions.length, 'sessions');
      // sessions.forEach((session, index) => {
      //   console.log(`Session ${index}:`, {
      //     id: session.id,
      //     title: session.title,
      //     type: session.type,
      //     created_at: session.created_at
      //   });
      // });

      // Parse JSON fields and populate additional data
      const parsedSessions = await Promise.all(sessions.map(async (session) => {
        try {
          // console.log(`🔍 Processing session ${session.id}...`);
          
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
              console.log(`💬 Session ${session.id}: Last message: "${lastMessage?.substring(0, 50)}..."`);
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
          
          // console.log(`✅ Processed session ${session.id}:`, {
          //   id: processedSession.id,
          //   title: processedSession.title,
          //   messageCount: processedSession.messageCount,
          //   lastMessage: processedSession.lastMessage?.substring(0, 30),
          //   isActive: processedSession.isActive
          // });
          
          return processedSession;
        } catch (error) {
          console.error(`❌ Error processing session ${session.id}:`, error);
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
      
      console.log('📋 Parsed sessions:', parsedSessions.length, 'sessions');
      // parsedSessions.forEach((session, index) => {
      //   console.log(`Parsed Session ${index}:`, {
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
        console.log('🔧 [ConversationSessionAgent] No active session found, activating most recent session with messages...');
        
        // Find the most recent session with messages, or just the most recent session
        const sessionWithMessages = parsedSessions
          .filter(s => s.messageCount > 0)
          .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())[0];
        
        const sessionToActivate = sessionWithMessages || parsedSessions[0];
        
        if (sessionToActivate) {
          console.log(`🎯 [ConversationSessionAgent] Auto-activating session: ${sessionToActivate.id} (${sessionToActivate.title})`);
          
          // Set this session as active in the database
          await AGENT_FORMAT.database.run(`
            UPDATE conversation_sessions 
            SET is_active = true, updated_at = ?
            WHERE id = ?
          `, [new Date().toISOString(), sessionToActivate.id]);
          
          // Update the session object to reflect the change
          sessionToActivate.isActive = true;
          
          console.log(`✅ [ConversationSessionAgent] Successfully activated session: ${sessionToActivate.id}`);
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
      
      console.log('🔄 [ConversationSessionAgent] Returning session list result:', {
        success: returnData.success,
        sessionsCount: returnData.data.sessions.length,
        total: returnData.data.pagination.total
      });
      
      return returnData;
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
      console.error('❌ Failed to get session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async updateSession(options, context) {
    console.log('🔧 [ConversationSessionAgent] Raw options received:', options);
    
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

    console.log('🔧 [ConversationSessionAgent] updateSession called with:', { sessionId, title, contextData, relatedMemories, currentActivity, messageCount });

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
      console.log('🔧 [ConversationSessionAgent] SQL query:', sql);
      console.log('🔧 [ConversationSessionAgent] Values array:', values);
      console.log('🔧 [ConversationSessionAgent] Updates array:', updates);

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
      console.error('❌ Failed to update session:', error);
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
      console.error('❌ switchToSession: Invalid sessionId:', sessionId);
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
      console.error('❌ Failed to switch session:', error);
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
  },

  // Message Management Methods
  async addMessage(options, context) {
    // Handle both direct options and nested options structure
    const actualOptions = options.options || options;
    const { sessionId, text, sender, metadata = {} } = actualOptions;

    console.log('🔍 [DEBUG] addMessage received:', { sessionId, text, sender, metadata });

    // Validate required parameters
    if (!sessionId || !text || !sender) {
      console.error('❌ [DEBUG] Missing required parameters:', { sessionId, text, sender });
      return {
        success: false,
        error: 'Missing required parameters: sessionId, text, and sender are required'
      };
    }

    try {
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = new Date().toISOString();

      console.log('🔍 [DEBUG] About to insert with parameters:', [messageId, sessionId, text, sender, timestamp, JSON.stringify(metadata)]);

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
      console.error('❌ Failed to add message:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async listMessages(options, context) {
    const { sessionId, limit = 50, offset = 0 } = options.options || options;

    console.log(`🔍 [ConversationSessionAgent] listMessages called with sessionId: ${sessionId}`);

    // Validate sessionId
    if (!sessionId || sessionId === 'undefined') {
      console.error('❌ listMessages: Invalid sessionId:', sessionId);
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
      const messages = await AGENT_FORMAT.database.query(`
        SELECT * FROM conversation_messages 
        WHERE session_id = ? 
        ORDER BY timestamp ASC 
        LIMIT ? OFFSET ?
      `, [sessionId, limit, offset]);

      console.log(`📋 [ConversationSessionAgent] Found ${messages.length} messages for session ${sessionId}`);
      
      const result = {
        success: true,
        data: {
          messages: messages.map(msg => ({
            ...msg,
            metadata: JSON.parse(msg.metadata || '{}')
          })),
          sessionId,
          count: messages.length,
          limit,
          offset
        }
      };
      
      // console.log(`✅ [ConversationSessionAgent] Returning result:`, {
      //   success: result.success,
      //   messageCount: result.data.messages.length,
      //   sessionId: result.data.sessionId
      // });
      
      return result;
    } catch (error) {
      console.error('❌ Failed to list messages:', error);
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
      console.error('❌ Failed to get message:', error);
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
      console.error('❌ Failed to update message:', error);
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
      console.error('❌ Failed to delete message:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

module.exports = AGENT_FORMAT;
