/**
 * Conversation Service - MCP Service for ThinkDrop AI
 * Manages conversation sessions and messages
 * Port: 3004
 */

const express = require('express');
const cors = require('cors');
const { initializeDatabase } = require('./database/connection.cjs');
const sessionRoutes = require('./routes/sessions.cjs');
const messageRoutes = require('./routes/messages.cjs');
const { authenticateRequest } = require('./middleware/auth.cjs');

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    service: 'conversation',
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Service info endpoint (no auth required)
app.get('/info', (req, res) => {
  res.json({
    service: 'conversation',
    version: '1.0.0',
    description: 'Conversation Management Service',
    actions: [
      'session.create',
      'session.list',
      'session.get',
      'session.update',
      'session.delete',
      'session.switch',
      'message.add',
      'message.list',
      'message.get',
      'message.update',
      'message.delete'
    ]
  });
});

// Apply authentication to all routes below
app.use(authenticateRequest);

// Mount routes
app.use('/', sessionRoutes);
app.use('/', messageRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ [CONVERSATION-SERVICE] Error:', err);
  res.status(500).json({
    version: 'mcp.v1',
    service: 'conversation',
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Initialize database and start server
async function start() {
  try {
    console.log('🚀 [CONVERSATION-SERVICE] Starting...');
    
    // Initialize database
    await initializeDatabase();
    console.log('✅ [CONVERSATION-SERVICE] Database initialized');
    
    // Start server
    app.listen(PORT, () => {
      console.log('\n╔═══════════════════════════════════════════════════════╗');
      console.log('║   ThinkDrop Conversation Service                      ║');
      console.log('║   Version: 1.0.0                                      ║');
      console.log(`║   Port: ${PORT}                                          ║`);
      console.log('║   Environment: development                            ║');
      console.log('║   MCP Protocol: v1                                    ║');
      console.log('╚═══════════════════════════════════════════════════════╝\n');
      
      console.log('Available endpoints:');
      console.log('  Session Management:');
      console.log('    - POST /session.create       (Create new session)');
      console.log('    - POST /session.list         (List all sessions)');
      console.log('    - POST /session.get          (Get session details)');
      console.log('    - POST /session.update       (Update session)');
      console.log('    - POST /session.delete       (Delete session)');
      console.log('    - POST /session.switch       (Switch active session)');
      console.log('  Message Management:');
      console.log('    - POST /message.add          (Add message to session)');
      console.log('    - POST /message.list         (List messages in session)');
      console.log('    - POST /message.get          (Get message details)');
      console.log('    - POST /message.update       (Update message)');
      console.log('    - POST /message.delete       (Delete message)');
      console.log('  Service Info:');
      console.log('    - GET  /health               (Health check)');
      console.log('    - GET  /info                 (Service capabilities)\n');
    });
  } catch (error) {
    console.error('❌ [CONVERSATION-SERVICE] Failed to start:', error);
    process.exit(1);
  }
}

start();
