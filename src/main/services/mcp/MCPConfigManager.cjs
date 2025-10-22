/**
 * MCP Configuration Manager
 * Manages dynamic service registry loaded from DuckDB
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Core services that are protected (cannot be deleted/disabled)
const CORE_SERVICES = ['user-memory', 'phi4', 'web-search'];

// Sensitive actions that require user confirmation for untrusted services
const SENSITIVE_ACTIONS = [
  'memory.store',
  'memory.delete',
  'memory.update',
  'file.read',
  'file.write',
  'file.delete',
  'system.execute',
  'database.query',
  'database.update'
];

class MCPConfigManager {
  constructor() {
    this.services = new Map();
    this.db = null;
    this.initialized = false;
    this.encryptionKey = process.env.MCP_ENCRYPTION_KEY || this.generateEncryptionKey();
  }

  /**
   * Initialize database connection and load services
   */
  async initialize(database) {
    if (this.initialized) return;

    if (!database) {
      throw new Error('Database parameter is required for MCPConfigManager initialization');
    }

    console.log('🔍 MCPConfigManager: Received database:', typeof database);
    this.db = database;
    
    // Create tables if they don't exist
    await this.createTables();
    
    // Load services from database
    await this.loadFromDatabase();
    
    this.initialized = true;
    console.log('✅ MCPConfigManager initialized');
  }

  /**
   * Create database tables
   */
  async createTables() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Remove comments
    const cleanSchema = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    
    // Split by semicolon and execute each statement
    const statements = cleanSchema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    const quietMode = process.env.DB_QUIET_MODE === 'true';
    
    if (!quietMode) {
      console.log(`Executing ${statements.length} SQL statements...`);
    }
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        if (!quietMode) {
          console.log(`  [${i+1}/${statements.length}] ${statement.substring(0, 50)}...`);
        }
        
        if (!this.db || !this.db.run) {
          throw new Error(`Database or run method not available. db type: ${typeof this.db}`);
        }
        
        await this.db.run(statement, []);
      } catch (error) {
        console.error(`Failed to execute statement ${i+1}:`, statement.substring(0, 200));
        throw error;
      }
    }
    
    if (!quietMode) {
      console.log('✅ MCP database tables created');
    }
  }

  /**
   * Load services from database
   */
  async loadFromDatabase() {
    console.log('Loading services from database...');
    
    try {
      // DatabaseManager uses query() instead of all()
      const services = await this.db.query(`
        SELECT * FROM mcp_services WHERE enabled = 1
      `, []);
      
      console.log(`Found ${services.length} services in database`);
      
      this.services.clear();
      
      for (const service of services) {
      const decryptedKey = this.decryptApiKey(service.api_key);
      console.log(`🔑 Service ${service.name}: API key ${service.api_key} || ${decryptedKey ? 'present (' + decryptedKey.substring(0, 10) + '...)' : 'MISSING'}`);
      
      this.services.set(service.name, {
        id: service.id,
        name: service.name,
        displayName: service.display_name,
        description: service.description,
        endpoint: service.endpoint,
        apiKey: decryptedKey,
        enabled: service.enabled,
        capabilities: JSON.parse(service.capabilities || '{}'),
        actions: JSON.parse(service.actions || '[]'),
        version: service.version,
        trusted: service.trusted,
        trustLevel: service.trust_level,
        allowedActions: JSON.parse(service.allowed_actions || 'null'),
        rateLimit: service.rate_limit,
        healthStatus: service.health_status,
        lastHealthCheck: service.last_health_check,
        consecutiveFailures: service.consecutive_failures,
        createdBy: service.created_by,
        stats: {
          totalRequests: service.total_requests,
          totalErrors: service.total_errors,
          avgLatencyMs: service.avg_latency_ms,
          lastRequestAt: service.last_request_at
        }
      });
    }
    
    console.log(`✅ Loaded ${services.length} MCP services from database`);
    } catch (error) {
      console.error('Failed to load services from database:', error);
      throw error;
    }
  }

  /**
   * Get service by name
   */
  getService(name) {
    return this.services.get(name);
  }

  /**
   * Get all services
   */
  getAllServices() {
    return Array.from(this.services.values());
  }

  /**
   * Get enabled services
   */
  getEnabledServices() {
    return this.getAllServices().filter(s => s.enabled);
  }

  /**
   * Get core services
   */
  getCoreServices() {
    return this.getAllServices().filter(s => CORE_SERVICES.includes(s.name));
  }

  /**
   * Get external services (user-added)
   */
  getExternalServices() {
    return this.getAllServices().filter(s => !CORE_SERVICES.includes(s.name));
  }

  /**
   * Check if service exists
   */
  hasService(name) {
    return this.services.has(name);
  }

  /**
   * Check if service is core service
   */
  isCoreService(name) {
    return CORE_SERVICES.includes(name);
  }

  /**
   * Check if action is sensitive
   */
  isSensitiveAction(action) {
    return SENSITIVE_ACTIONS.includes(action);
  }

  /**
   * Add new service
   */
  async addService(serviceConfig) {
    const {
      name,
      displayName,
      description,
      endpoint,
      apiKey,
      capabilities,
      actions,
      version,
      trusted = false,
      trustLevel = 'ask_always',
      allowedActions = null,
      rateLimit = 100
    } = serviceConfig;

    // Validate
    if (this.hasService(name)) {
      throw new Error(`Service ${name} already exists`);
    }

    // Generate ID
    const id = this.generateId();

    // Encrypt API key
    const encryptedApiKey = this.encryptApiKey(apiKey);

    // Insert into database
    await this.db.run(`
      INSERT INTO mcp_services (
        id, name, display_name, description, endpoint, api_key,
        capabilities, actions, version, trusted, trust_level,
        allowed_actions, rate_limit, enabled, created_by, health_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      name,
      displayName,
      description,
      endpoint,
      encryptedApiKey,
      JSON.stringify(capabilities || {}),
      JSON.stringify(actions || []),
      version,
      trusted ? 1 : 0,
      trustLevel,
      allowedActions ? JSON.stringify(allowedActions) : null,
      rateLimit,
      1, // enabled
      'user',
      'unknown'
    ]);

    // Reload from database
    await this.loadFromDatabase();

    console.log(`✅ Added service: ${name}`);
    return this.getService(name);
  }

  /**
   * Update service
   */
  async updateService(name, updates) {
    if (!this.hasService(name)) {
      throw new Error(`Service ${name} not found`);
    }

    const allowedUpdates = [
      'display_name',
      'description',
      'endpoint',
      'api_key',
      'trust_level',
      'allowed_actions',
      'rate_limit',
      'enabled'
    ];

    const setClauses = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      
      if (allowedUpdates.includes(dbKey)) {
        setClauses.push(`${dbKey} = ?`);
        
        // Handle special cases
        if (dbKey === 'api_key') {
          values.push(this.encryptApiKey(value));
        } else if (typeof value === 'object') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (setClauses.length === 0) {
      throw new Error('No valid updates provided');
    }

    // Add updated_at
    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    // Update database
    await this.db.run(`
      UPDATE mcp_services
      SET ${setClauses.join(', ')}
      WHERE name = ?
    `, [...values, name]);

    // Reload from database
    await this.loadFromDatabase();

    console.log(`✅ Updated service: ${name}`);
    return this.getService(name);
  }

  /**
   * Remove service
   */
  async removeService(name) {
    if (!this.hasService(name)) {
      throw new Error(`Service ${name} not found`);
    }

    // Prevent removing core services
    if (this.isCoreService(name)) {
      throw new Error(`Cannot remove core service: ${name}`);
    }

    // Delete from database
    await this.db.run('DELETE FROM mcp_services WHERE name = ?', [name]);

    // Remove from memory
    this.services.delete(name);

    console.log(`✅ Removed service: ${name}`);
  }

  /**
   * Enable service
   */
  async enableService(name) {
    return this.updateService(name, { enabled: true });
  }

  /**
   * Disable service
   */
  async disableService(name) {
    // Prevent disabling core services
    if (this.isCoreService(name)) {
      throw new Error(`Cannot disable core service: ${name}`);
    }

    return this.updateService(name, { enabled: false });
  }

  /**
   * Update service health
   */
  async updateServiceHealth(name, status, responseTimeMs = null, errorMessage = null) {
    const service = this.getService(name);
    if (!service) return;

    const consecutiveFailures = status === 'healthy' ? 0 : service.consecutiveFailures + 1;

    await this.db.run(`
      UPDATE mcp_services
      SET health_status = ?,
          last_health_check = CURRENT_TIMESTAMP,
          consecutive_failures = ?
      WHERE name = ?
    `, [status, consecutiveFailures, name]);

    // Record in history
    await this.db.run(`
      INSERT INTO service_health_history (
        id, service_name, status, response_time_ms, error_message
      ) VALUES (?, ?, ?, ?, ?)
    `, [this.generateId(), name, status, responseTimeMs, errorMessage]);

    // Reload
    await this.loadFromDatabase();
  }

  /**
   * Update service stats
   */
  async updateServiceStats(name, success, latencyMs) {
    const service = this.getService(name);
    if (!service) return;

    const totalRequests = service.stats.totalRequests + 1;
    const totalErrors = success ? service.stats.totalErrors : service.stats.totalErrors + 1;
    const avgLatencyMs = Math.round(
      (service.stats.avgLatencyMs * service.stats.totalRequests + latencyMs) / totalRequests
    );

    await this.db.run(`
      UPDATE mcp_services
      SET total_requests = ?,
          total_errors = ?,
          avg_latency_ms = ?,
          last_request_at = CURRENT_TIMESTAMP
      WHERE name = ?
    `, [totalRequests, totalErrors, avgLatencyMs, name]);

    // Reload
    await this.loadFromDatabase();
  }

  /**
   * Encrypt API key
   */
  encryptApiKey(apiKey) {
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, Buffer.alloc(16, 0));
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  /**
   * Decrypt API key
   */
  decryptApiKey(encrypted) {
    // Check if already decrypted (plain text from migration)
    // Encrypted keys are hex strings (even length, only 0-9a-f)
    if (!encrypted || typeof encrypted !== 'string') {
      return encrypted;
    }
    
    // If it doesn't look like hex, it's probably plain text
    if (!/^[0-9a-f]+$/i.test(encrypted) || encrypted.length % 2 !== 0) {
      return encrypted;
    }
    
    // Try to decrypt
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, Buffer.alloc(16, 0));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      // If decryption fails, it's probably plain text that happens to look like hex
      return encrypted;
    }
  }

  /**
   * Generate encryption key
   */
  generateEncryptionKey() {
    return crypto.randomBytes(32);
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get service registry for external services
   * (Used by services that need to call other services)
   */
  getServiceRegistry() {
    const registry = {};
    
    for (const [name, service] of this.services) {
      registry[name] = {
        endpoint: service.endpoint,
        apiKey: service.apiKey,
        actions: service.actions,
        trusted: service.trusted
      };
    }
    
    return registry;
  }
}

// Export singleton instance
module.exports = new MCPConfigManager();
