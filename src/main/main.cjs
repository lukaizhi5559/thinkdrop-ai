// Entry point for Thinkdrop AI Electron overlay app
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Load environment variables FIRST before any other setup
require('dotenv').config(); // Load .env variables

// Force WASM-only execution for all transformers to prevent ONNX runtime issues
process.env.ONNXJS_LOG_LEVEL = 'error';
process.env.TRANSFORMERS_CACHE = path.join(__dirname, '../../models');
process.env.HF_HUB_DISABLE_TELEMETRY = '1';
// Disable ONNX runtime entirely
process.env.ONNXRUNTIME_DISABLE = '1';

// Handle EPIPE errors gracefully to prevent process crashes
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors - they happen when output pipe is broken
    return;
  }
  console.error('stdout error:', err);
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors - they happen when output pipe is broken
    return;
  }
  console.error('stderr error:', err);
});

// Handle uncaught exceptions that might be related to logging
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors
    return;
  }
  console.error('Uncaught Exception:', err);
  // Don't exit the process for EPIPE errors
  if (err.code !== 'EPIPE') {
    process.exit(1);
  }
});

// Import modularized IPC handlers
const { initializeIPCHandlers } = require('./handlers/ipc-handlers.cjs');
// DEPRECATED - Only used in non-MCP mode (commented out to prevent import errors from deleted files)
// const { setupMemoryHandlers } = require('./handlers/ipc-handlers-memory.cjs');
// const { initializeHandlers: initializeHandlersPart3 } = require('./handlers/ipc-handlers-screenshot.cjs');
// const { setupOrchestrationWorkflowHandlers } = require('./handlers/ipc-handlers-orchestration.cjs');
// const { initializeLocalLLMHandlers } = require('./handlers/ipc-handlers-local-llm.cjs');
const { setupConversationHandlers } = require('./handlers/ipc-handlers-conversation.cjs');
const { setupDatabaseNotificationHandlers } = require('./handlers/ipc-handlers-database-notifications.cjs');
const { registerMCPHandlers } = require('./handlers/ipc-handlers-mcp.cjs');
const { registerPrivateModeHandlers } = require('./handlers/ipc-handlers-private-mode.cjs');
const { setupMCPMemoryHandlers } = require('./handlers/ipc-handlers-mcp-memory.cjs');
const { setupGeminiOAuthHandlers } = require('./handlers/ipc-handlers-gemini-oauth.cjs');
const { setupVisionOAuthHandlers } = require('./handlers/ipc-handlers-vision-oauth.cjs');
const { registerScreenIntelligenceHandlers } = require('./handlers/ipc-handlers-screen-intelligence.cjs');

// CoreAgent (AgentOrchestrator) will be imported dynamically due to ES module

let overlayWindow = null;
// Unified window approach - removed separate window variables
// let chatWindow = null;
// let chatMessagesWindow = null;
// let insightWindow = null;
// let memoryDebuggerWindow = null;
let isGloballyVisible = true;
let isOverlayVisible = true;
// Window visibility states now managed by React state in unified interface
let isOrchestrationActive = false; // Prevent window hiding during orchestration
let visibleWindows = [];

// CoreAgent instance for dynamic agent management
let coreAgent = null; // AgentOrchestrator instance
let localLLMAgent = null; // Local LLM agent instance
let conversationAgent = null; // ConversationSessionAgent instance (MCP mode)

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Create a unified window that can expand to show different content
  // Smaller width positioned to upper-right corner as requested
  const windowWidth = Math.min(350, width * 0.3); // 30% of screen width, max 400px (half the previous size)
  const windowHeight = Math.min(500, height * 0.7); // 70% of screen height, max 600px
  const x = width - windowWidth - 20; // Position to upper-right corner with 20px margin
  const y = 20; // Position near top with 20px margin

  overlayWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 350, // Minimum width for usability
    minHeight: 350, // Minimum height for usability
    maxWidth: 1200, // Maximum width
    maxHeight: 900, // Maximum height
    x: x,
    y: y,
    frame: false, // Remove window frame completely
    transparent: true, // Transparent background
    alwaysOnTop: true, // Always stay on top
    skipTaskbar: true, // Don't show in taskbar
    resizable: true, // Allow resizing for better UX
    movable: true, // Allow dragging
    minimizable: false,
    maximizable: false,
    closable: false, // Prevent close button
    focusable: true,
    hasShadow: true, // Add shadow for better visibility
    // CRITICAL: Prevent fullscreen exit when clicking this window
    fullscreenable: false, // This window cannot go fullscreen
    // CRITICAL: Use panel type which has proper collection behavior for overlays
    type: 'panel', // Panel windows can appear over fullscreen apps
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      backgroundThrottling: false // Keep overlay responsive
    }
  });

  // Explicitly disable shadow using setShadow
  overlayWindow.setHasShadow(false);

  // CRITICAL: Configure panel window to appear over fullscreen apps
  // Panel windows (NSPanel) automatically have the right collection behavior on macOS
  if (process.platform === 'darwin') {
    overlayWindow.setWindowButtonVisibility(false);
  }
  
  // Set window level - 'floating' is sufficient for panel windows
  // Panel type + floating level + visibleOnFullScreen = appears over fullscreen apps
  overlayWindow.setAlwaysOnTop(true, 'floating', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  overlayWindow.loadURL(
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:5173'
      : `file://${path.join(__dirname, '../../dist-renderer/index.html')}`
  );

  // Make overlay click-through when not in focus (like Cluely)
  overlayWindow.setIgnoreMouseEvents(false);
  
  // Hide window instead of closing
  overlayWindow.on('close', (event) => {
    if (overlayWindow && !app.isQuiting) {
      event.preventDefault();
      overlayWindow.hide();
      isOverlayVisible = false;
    }
  });

  // Development: Open DevTools
  if (process.env.NODE_ENV === 'development') {
    overlayWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// REMOVED: createChatMessagesWindow - now handled within unified overlayWindow
// Chat messages functionality is now integrated into the main overlay interface

// REMOVED: createMemoryDebuggerWindow - now handled within unified overlayWindow
// Memory debugger functionality is now integrated into the main overlay interface

// REMOVED: createInsightWindow - now handled within unified overlayWindow
// Insight functionality is now integrated into the main overlay interface

function toggleOverlay() {
  if (!overlayWindow) return;
  
  if (isGloballyVisible) {
    // Hide the unified overlay window
    overlayWindow.hide();
    isOverlayVisible = false;
    isChatVisible = false;
    isInsightVisible = false;
    isGloballyVisible = false;
  } else {
    // Show the unified overlay window
    overlayWindow.show();
    overlayWindow.focus();
    isOverlayVisible = true;
    isGloballyVisible = true;
  }
}

app.whenReady().then(async () => {
  console.log('🚀 App ready - starting initialization sequence...');
  
    // Step 1: Initialize core services FIRST
    console.log('🔧 Step 1: Initializing core services...');
    //await initializeServices();
    console.log('✅ Step 1: Core services initialized');
    
    // Step 2: Setup IPC handlers AFTER services are ready
    console.log('🔧 Step 2: Setting up IPC handlers...');

    createOverlayWindow();
    // console.log('✅ Step 3: Overlay window created');
  // Initialize core services including LocalLLMAgent
  let handlersSetup = false;
  initializeServices().then(() => {
    // Verify CoreAgent is properly initialized before setting up IPC handlers
    if (!coreAgent || !coreAgent.initialized) {
      // Add a small delay to ensure CoreAgent is ready
      return new Promise(resolve => setTimeout(() => {
        resolve();
      }, 1000));
    } else {
      return Promise.resolve();
    }
  }).then(async () => {
    // Setup IPC handlers after CoreAgent is initialized (only once)
    if (!handlersSetup) {
      handlersSetup = true;
      await setupIPCHandlers();
    }
  }).catch(async error => {
    console.error('❌ Error during initialization sequence:', error);
    // Setup IPC handlers anyway to allow basic functionality (only once)
    if (!handlersSetup) {
      handlersSetup = true;
      await setupIPCHandlers();
    }
  });
  
  console.log('🎉 Initialization sequence complete!');
  
  // Initialize Virtual Screen DOM for auto-caching
  console.log('👁️  Initializing Virtual Screen DOM...');
  const VirtualScreenDOM = require('./services/virtualScreenDOM.cjs');
  global.virtualScreenDOM = new VirtualScreenDOM();
  await global.virtualScreenDOM.start();
  console.log('✅ Virtual Screen DOM initialized');
  
  // Register global shortcut to show/hide overlay (like Cluely's Cmd+Shift+Space)
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    toggleOverlay();
  });

  globalShortcut.register('Control+Space', () => {
    toggleOverlay();
  });
  
  // Screen Intelligence shortcuts
  globalShortcut.register('CommandOrControl+Shift+I', async () => {
    console.log('🔍 Screen Intelligence: Discovery Mode triggered');
    const { createScreenIntelligenceOverlay, showDiscoveryMode, showToast } = require('./windows/screen-intelligence-overlay.cjs');
    
    try {
      // Initialize overlay if needed
      createScreenIntelligenceOverlay();
      
      // 1️⃣ Check cache first
      const virtualDOM = global.virtualScreenDOM;
      const cached = virtualDOM?.queryCached(null, 'all');
      
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        // Cache hit - instant response
        const age = Math.round((Date.now() - cached.timestamp) / 1000);
        showToast(`Using cached data (${age}s old)`, 'info', 2000);
        showDiscoveryMode(cached.elements);
        showToast(`Found ${cached.elementCount} elements`, 'success', 2000);
        return;
      }
      
      // 2️⃣ Cache miss - analyze screen
      showToast('Analyzing screen...', 'info', 4000);
      
      // Get screen-intelligence service info from MCP
      const MCPConfigManager = require('./services/mcp/MCPConfigManager.cjs');
      const serviceInfo = MCPConfigManager.getService('screen-intelligence');
      
      if (!serviceInfo || !serviceInfo.apiKey) {
        throw new Error('Screen Intelligence service not configured');
      }
      
      // Fetch elements from MCP service
      const startTime = Date.now();
      const response = await fetch(`${serviceInfo.endpoint}/screen/describe`, {
        method: 'POST',
        headers: {
          'x-api-key': serviceInfo.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          showOverlay: false,
          includeHidden: false
        })
      });
      
      if (!response.ok) {
        throw new Error(`MCP service returned ${response.status}`);
      }
      
      const data = await response.json();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (data.elements && data.elements.length > 0) {
        // 3️⃣ Cache the results
        if (virtualDOM) {
          await virtualDOM.cacheAnalysis(data);
          console.log('✅ Cached screen analysis');
        }
        
        // Show discovery mode with all elements
        showDiscoveryMode(data.elements);
        showToast(`Analysis complete! Found ${data.elements.length} elements (${duration}s)`, 'success', 3000);
      } else {
        showToast('No elements found', 'warning', 2000);
      }
      
    } catch (error) {
      console.error('Screen Intelligence error:', error);
      showToast(`Error: ${error.message}`, 'error', 3000);
    }
  });
  
  // Clear screen intelligence overlays
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    console.log('🧹 Screen Intelligence: Clearing overlays');
    const { clearOverlays, hideOverlay } = require('./windows/screen-intelligence-overlay.cjs');
    clearOverlays();
    hideOverlay();
  });
  
  // Register global shortcut to quit app
  // globalShortcut.register('CommandOrControl+Q', () => {
  //   app.isQuiting = true;
  //   app.quit();
  // });
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow();
    } else if (overlayWindow) {
      overlayWindow.show();
      isOverlayVisible = true;
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// Initialize new services architecture only

async function initializeServices() {
  // 🔒 MCP PRIVATE MODE: Skip heavy initialization if using MCP services
  const USE_MCP_PRIVATE_MODE = process.env.USE_MCP_PRIVATE_MODE === 'true';
  
  if (USE_MCP_PRIVATE_MODE) {
    console.log('🔒 [MCP-MODE] Private mode enabled - skipping local agent initialization');
    console.log('🔒 [MCP-MODE] Using MCP services for all AI operations');
    
    // Only initialize minimal database for conversation persistence
    try {
      const path = require('path');
      const fs = require('fs');
      const projectRoot = path.dirname(path.dirname(__dirname));
      const dataDir = path.join(projectRoot, 'data');
      const dbPath = path.join(dataDir, 'agent_memory.duckdb');
      
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      // Set quiet mode for DatabaseManager in MCP mode
      process.env.DB_QUIET_MODE = 'true';
      
      const { default: databaseManager } = await import('./services/utils/DatabaseManager.js');
      await databaseManager.initialize(dbPath);
      global.databaseManager = databaseManager;
      
      // In MCP mode, conversation persistence is handled by the MCP conversation service
      // No need to bootstrap ConversationSessionAgent here
      console.log('✅ [MCP-MODE] Database initialized for MCP services only');
      
      // Create minimal coreAgent stub (no conversation agent)
      global.coreAgent = {
        context: { database: databaseManager },
        executeAgent: async (agentName, params) => {
          throw new Error(`Agent ${agentName} not available in MCP mode - use MCP services instead`);
        }
      };
      
      console.log('✅ [MCP-MODE] Minimal stub ready - all operations via MCP services');
      
      // Register stub handlers EARLY to prevent frontend errors during initialization
      const { ipcMain } = require('electron');
      
      ipcMain.handle('agent-execute', async (event, params) => {
        return { success: false, error: 'agent-execute not available in MCP mode' };
      });
      
      ipcMain.handle('llm-get-health', async () => {
        return { success: true, mode: 'mcp', services: {} };
      });
      
      ipcMain.handle('llm-get-cached-agents', async () => {
        return { success: true, agents: [] };
      });
      
      ipcMain.handle('llm-get-communications', async () => {
        return { success: true, communications: [] };
      });
      
      console.log('✅ [MCP-MODE] Early stub handlers registered');
      
    } catch (error) {
      console.error('❌ [MCP-MODE] Database initialization failed:', error);
    }
    
    return; // Skip all agent bootstrapping
  }
  
  try {
    // Initialize CoreAgent (AgentOrchestrator) for dynamic agent management
    try {
      console.log('🔄 Step 1: Importing AgentOrchestrator...');
      // Dynamic import for ES module compatibility
      const { AgentOrchestrator } = await import('./services/agents/AgentOrchestrator.js');
      console.log('✅ Step 1: AgentOrchestrator imported successfully');
      
      console.log('🔄 Step 2: Setting up database paths...');
      // Initialize DuckDB for agent memory storage using DatabaseManager
      const path = require('path');
      const fs = require('fs');
      const projectRoot = path.dirname(path.dirname(__dirname)); // Go up from src/main to project root
      const dataDir = path.join(projectRoot, 'data');
      const dbPath = path.join(dataDir, 'agent_memory.duckdb');
      
      // Ensure data directory exists
      if (!fs.existsSync(dataDir)) {
        console.log(`📁 Creating data directory: ${dataDir}`);
        fs.mkdirSync(dataDir, { recursive: true });
      }
      console.log('✅ Step 2: Database paths configured');
      
      console.log('🔄 Step 3: Importing and initializing DatabaseManager...');
      // Import and initialize DatabaseManager
      const { default: databaseManager } = await import('./services/utils/DatabaseManager.js');
      await databaseManager.initialize(dbPath);
      console.log('✅ Step 3: DatabaseManager initialized successfully');
      
      console.log('🔄 Step 4: Creating AgentOrchestrator instance...');
      coreAgent = new AgentOrchestrator();
      console.log('✅ Step 4: AgentOrchestrator instance created');
      
      console.log('🔄 Step 5: Initializing CoreAgent...');
      // Initialize the CoreAgent
      const initResult = await coreAgent.initialize({
        llmClient: null, // Will be set when needed
        database: databaseManager, // Pass the DatabaseManager instance
        apiConfig: {
          baseURL: process.env.BIBSCRIP_BASE_URL || 'http://localhost:3001',
          apiKey: process.env.BIBSCRIP_API_KEY
        }
      });
      
      // Make CoreAgent available globally for IPC handlers AFTER initialization
      global.coreAgent = coreAgent;
      console.log('✅ Step 5: CoreAgent initialized successfully:', initResult);

      // Initialize performance optimizations
      console.log('🔄 Step 6: Initializing performance optimizations...');
      const { optimizationManager } = require('./services/cache/OptimizationManager.cjs');
      await optimizationManager.initialize();
      console.log('✅ Step 6: Performance optimizations ready');

      // Start the embedding daemon for automatic background embedding generation
      try {
        console.log('🤖 Starting embedding daemon for semantic search...');
        
        // Bootstrap SemanticEmbeddingAgent first
        await coreAgent.ask({
          agent: 'SemanticEmbeddingAgent',
          action: 'bootstrap'
        });
        
        // Bootstrap ConversationSessionAgent to create conversation database tables
        console.log('🗣️ Bootstrapping ConversationSessionAgent...');
        await coreAgent.ask({
          agent: 'ConversationSessionAgent',
          action: 'bootstrap'
        });
        
        // Bootstrap WebSearchAgent for hybrid query support
        console.log('🔍 Bootstrapping WebSearchAgent...');
        await coreAgent.ask({
          agent: 'WebSearchAgent',
          action: 'bootstrap'
        });
        
        // Start the embedding daemon with default 10-minute intervals
        const daemonResult = await coreAgent.ask({
          agent: 'EmbeddingDaemonAgent',
          action: 'start-daemon'
        });
        
        if (daemonResult.success) {
          console.log('✅ Embedding daemon started successfully:', daemonResult.message);
        } else {
          console.warn('⚠️ Embedding daemon failed to start:', daemonResult.error);
        }
        
      } catch (daemonError) {
        console.error('❌ Failed to start embedding daemon:', daemonError);
        // Continue without daemon - app should still work
      }

    } catch (error) {
      console.error('❌ Failed to initialize CoreAgent:', error);
      console.error('❌ CoreAgent error stack:', error.stack);
      console.error('❌ CoreAgent error details:', {
        message: error.message,
        name: error.name,
        code: error.code
      });
      // Set coreAgent to null to ensure handlers know it's not available
      coreAgent = null;
    }
    
    // Legacy event listeners removed - functionality will be re-implemented using new agent architecture as needed
    
  } catch (error) {
    console.error('❌ Service initialization error:', error);
    // Continue without services for demo mode
  }
}

// Setup IPC handlers using modularized files
async function setupIPCHandlers() {
  console.log('🔧 Setting up IPC handlers...');
  
  const USE_MCP_PRIVATE_MODE = process.env.USE_MCP_PRIVATE_MODE === 'true';
  
  // Unified window state - UI state now managed by React components
  const windowState = {
    isGloballyVisible,
    isOverlayVisible,
    isOrchestrationActive,
    visibleWindows
  };

  // Simplified window creators for unified approach
  const windowCreators = {
    toggleOverlay
    // Removed separate window creators - now handled by React state
  };
  
  // Unified windows object - only overlayWindow needed
  const windows = {
    overlayWindow
    // Removed separate window references
  };
  
  try {
    // Remove early stub handlers before initializing full handlers
    if (USE_MCP_PRIVATE_MODE) {
      ipcMain.removeHandler('agent-execute');
      ipcMain.removeHandler('llm-get-health');
      ipcMain.removeHandler('llm-get-cached-agents');
      ipcMain.removeHandler('llm-get-communications');
    }
    
    // Initialize all IPC handlers from modularized files
    const { broadcastOrchestrationUpdate: broadcastUpdate, sendClarificationRequest: sendClarification } = 
      initializeIPCHandlers({
        overlayWindow,
        coreAgent,
        localLLMAgent,
        windowState,
        windowCreators
      });
    console.log('✅ Main IPC handlers setup complete');
    
    if (!USE_MCP_PRIVATE_MODE) {
      // DEPRECATED - Setup memory handlers (skip in MCP mode - use MCP user-memory service)
      console.log('⏭️  [DEPRECATED] Skipping memory handlers - removed in Phase 1 cleanup');
      // setupMemoryHandlers(ipcMain, coreAgent);
    } else {
      console.log('⏭️  [MCP-MODE] Skipping memory handlers - using MCP user-memory service');
    }
    
    // DEPRECATED - Initialize screenshot, system health, and legacy LLM handlers
    if (!USE_MCP_PRIVATE_MODE) {
      console.log('⏭️  [DEPRECATED] Skipping screenshot handlers - removed in Phase 1 cleanup');
      // initializeHandlersPart3({ ipcMain, coreAgent, windowState, windows });
    }

    console.log('🔧 Setting up conversation persistence handlers...');
    // In MCP mode, pass conversationAgent directly instead of coreAgent
    const agentForConversation = USE_MCP_PRIVATE_MODE ? conversationAgent : coreAgent;
    setupConversationHandlers(ipcMain, agentForConversation);
    console.log('✅ Conversation persistence handlers setup complete');
    
    // Declare sendWorkflowClarification outside conditional to avoid undefined error
    let sendWorkflowClarification = null;
    
    if (!USE_MCP_PRIVATE_MODE) {
      // DEPRECATED - Skip Local LLM handlers (removed in Phase 1 cleanup)
      console.log('⏭️  [DEPRECATED] Skipping Local LLM handlers - removed in Phase 1 cleanup');
      // initializeLocalLLMHandlers({ ipcMain, coreAgent, windowState, windows });
      
      // DEPRECATED - Setup orchestration workflow handlers (removed in Phase 1 cleanup)
      console.log('⏭️  [DEPRECATED] Skipping orchestration handlers - removed in Phase 1 cleanup');
      // const result = setupOrchestrationWorkflowHandlers(ipcMain, localLLMAgent, windows);
      // sendWorkflowClarification = result.sendClarificationRequest;
    } else {
      console.log('⏭️  [MCP-MODE] Skipping Local LLM handlers - using MCP phi4 service');
      console.log('⏭️  [MCP-MODE] Skipping orchestration workflow handlers - using MCP orchestrator');
    }
    
    if (!USE_MCP_PRIVATE_MODE) {
      // Skip database notification handlers in MCP mode
      console.log('🔧 Setting up database notification handlers...');
      await setupDatabaseNotificationHandlers();
      console.log('✅ Database notification IPC handlers setup complete');
    } else {
      console.log('⏭️  [MCP-MODE] Skipping database notification handlers');
    }
    
    // Initialize MCP client and config manager (used by multiple handlers)
    const MCPClient = require('./services/mcp/MCPClient.cjs');
    const MCPConfigManager = require('./services/mcp/MCPConfigManager.cjs');
    const mcpClient = new MCPClient(MCPConfigManager);
    
    // Initialize MCP handlers (microservices)
    console.log('🔧 Setting up MCP handlers...');
    registerMCPHandlers();
    console.log('✅ MCP handlers setup complete');
    
    // Initialize Screen Intelligence handlers
    console.log('🎯 Setting up Screen Intelligence handlers...');
    registerScreenIntelligenceHandlers();
    console.log('✅ Screen Intelligence handlers setup complete');
    
    // Initialize MCP Private Mode handlers (NEW orchestrator)
    console.log('🔧 Setting up MCP Private Mode handlers...');
    registerPrivateModeHandlers();
    console.log('✅ MCP Private Mode handlers setup complete');
    
    // Initialize MCP Memory handlers (for Memory Debugger in private mode)
    if (USE_MCP_PRIVATE_MODE) {
      console.log('🔧 Setting up MCP Memory handlers...');
      setupMCPMemoryHandlers(mcpClient);
      console.log('✅ MCP Memory handlers setup complete');
    }
    
    // Initialize Gemini OAuth handlers
    console.log('🔧 Setting up Gemini OAuth handlers...');
    setupGeminiOAuthHandlers(MCPConfigManager.db);
    console.log('✅ Gemini OAuth handlers setup complete');
    
    // Initialize Vision OAuth handlers
    console.log('🔧 Setting up Vision OAuth handlers...');
    setupVisionOAuthHandlers(MCPConfigManager.db, MCPConfigManager);
    console.log('✅ Vision OAuth handlers setup complete');
    
    // Update stub handlers with full MCP service info (already registered early)
    if (USE_MCP_PRIVATE_MODE) {
      console.log('🔧 Updating MCP mode stub handlers with service info...');
      
      // Remove early stubs and replace with full versions
      ipcMain.removeHandler('agent-execute');
      ipcMain.removeHandler('llm-get-health');
      ipcMain.removeHandler('llm-get-cached-agents');
      ipcMain.removeHandler('llm-get-communications');
      
      // Partial stub for agent-execute - only ConversationSessionAgent works
      ipcMain.handle('agent-execute', async (event, params) => {
        // Allow ConversationSessionAgent to work for session management
        if (params.agentName === 'ConversationSessionAgent' && global.coreAgent) {
          try {
            const result = await global.coreAgent.executeAgent(params.agentName, params);
            return result;
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        }
        
        // Block all other agents
        return {
          success: false,
          error: 'agent-execute not available in MCP mode - use private-mode-process instead'
        };
      });
      
      // Full stub for llm-get-health with MCP service info
      ipcMain.handle('llm-get-health', async () => {
        return {
          success: true,
          mode: 'mcp',
          services: {
            'user-memory': { status: 'available', endpoint: 'http://localhost:3001' },
            'phi4': { status: 'available', endpoint: 'http://localhost:3003' },
            'web-search': { status: 'available', endpoint: 'http://localhost:3002' }
          }
        };
      });
      
      // Stub for cached agents
      ipcMain.handle('llm-get-cached-agents', async () => {
        return { success: true, agents: [] };
      });
      
      // Stub for communications
      ipcMain.handle('llm-get-communications', async () => {
        return { success: true, communications: [] };
      });
      
      console.log('✅ MCP mode stub handlers updated');
    }
    
    // Initialize main IPC handlers
    console.log('🔧 Setting up main IPC handlers...');
    console.log('✅ Screenshot and system handlers setup complete');
    
    
    // Store the broadcast and clarification functions for use elsewhere
    global.broadcastOrchestrationUpdate = broadcastUpdate;
    global.sendClarificationRequest = sendWorkflowClarification || sendClarification;
    
    console.log('✅ All IPC handlers registered successfully');
    
  } catch (error) {
    console.error('❌ Error setting up IPC handlers:', error);
    throw error;
  }
}

// Window control handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Window visibility handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Chat window control handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Insight window control handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Chat messages window handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Memory debugger window handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// Chat messaging system handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers

// ========================================
// AGENT ORCHESTRATION
// ========================================

// Agent orchestration handlers are now initialized in setupIPCHandlers() using initializeIPCHandlers
// The "Give me a response to this email" scenario is handled through:
// 1. User message → agent-orchestrate → CoreAgent.ask()
// 2. CoreAgent dynamically determines needed agents (ScreenCapture, Memory, etc.)
// 3. Results flow to WebSocket streaming for ChatMessage/InsightView display

// Legacy IPC handlers removed - functionality will be re-implemented using new agent architecture as needed

// Legacy screenshot IPC handlers removed - functionality available through agent-screenshot handler using new agent architecture

// Memory query handlers are now initialized in setupIPCHandlers() using initializeHandlersPart2

// Memory handlers are now initialized in setupIPCHandlers() using initializeHandlersPart2

// All legacy handlers are now initialized in setupIPCHandlers() using initializeHandlersPart3

// Orchestration workflow handlers are now in ipc-handlers-part4.cjs
