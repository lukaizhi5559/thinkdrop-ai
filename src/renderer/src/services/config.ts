/**
 * Configuration Service for ThinkDrop AI
 * Manages API endpoints, settings, and environment configuration
 */

export interface APIConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  apiKey?: string;
  jwtToken?: string;
}

export interface LocalLLMConfig {
  enabled: boolean;
  ollamaUrl: string;
  preferredModel: string;
  fallbackModels: string[];
  timeout: number;
}

export interface MCPServiceConfig {
  endpoint: string;
  apiKey?: string;
  timeout: number;
  enabled: boolean;
}

export interface MCPConfig {
  enabled: boolean;
  routeMemoryToMCP: boolean;
  routeWebSearchToMCP: boolean;
  routePhi4ToMCP: boolean;
  services: {
    userMemory: MCPServiceConfig;
    webSearch: MCPServiceConfig;
    phi4: MCPServiceConfig;
  };
}

export interface AppConfig {
  api: APIConfig;
  localLLM: LocalLLMConfig;
  mcp: MCPConfig;
  features: {
    agentOrchestration: boolean;
    userMemory: boolean;
    voiceInput: boolean;
    insightWindow: boolean;
    agentDashboard: boolean;
  };
  ui: {
    theme: 'light' | 'dark' | 'auto';
    animations: boolean;
    notifications: boolean;
    debugMode: boolean;
  };
  privacy: {
    encryptMemories: boolean;
    autoExpireMemories: boolean;
    memoryRetentionDays: number;
    allowTelemetry: boolean;
  };
}

// Default configuration
const defaultConfig: AppConfig = {
  api: {
    baseUrl: process.env.BIBSCRIP_BASE_URL || '',
    timeout: 30000,
    retries: 3
  },
  localLLM: {
    enabled: true,
    ollamaUrl: 'http://localhost:11434',
    preferredModel: 'phi4-mini:latest',
    fallbackModels: ['qwen2:1.5b', 'llama3.2:latest', 'tinyllama'],
    timeout: 30000
  },
  mcp: {
    enabled: false,
    routeMemoryToMCP: false,
    routeWebSearchToMCP: false,
    routePhi4ToMCP: false,
    services: {
      userMemory: {
        endpoint: 'http://localhost:3001',
        apiKey: '',
        timeout: 5000,
        enabled: true
      },
      webSearch: {
        endpoint: 'http://localhost:3002',
        apiKey: '',
        timeout: 3000,
        enabled: true
      },
      phi4: {
        endpoint: 'http://localhost:3003',
        apiKey: '',
        timeout: 10000,
        enabled: true
      }
    }
  },
  features: {
    agentOrchestration: true,
    userMemory: true,
    voiceInput: true,
    insightWindow: true,
    agentDashboard: true
  },
  ui: {
    theme: 'auto',
    animations: true,
    notifications: true,
    debugMode: false
  },
  privacy: {
    encryptMemories: true,
    autoExpireMemories: true,
    memoryRetentionDays: 30,
    allowTelemetry: false
  }
};

class ConfigService {
  private config: AppConfig;
  private listeners: Set<(config: AppConfig) => void> = new Set();

  constructor() {
    this.config = this.loadConfig();
  }

  // Load configuration from localStorage or use defaults
  private loadConfig(): AppConfig {
    try {
      const stored = localStorage.getItem('thinkdrop-config');
      if (stored) {
        const parsedConfig = JSON.parse(stored);
        // Merge with defaults to ensure all properties exist
        return this.mergeConfig(defaultConfig, parsedConfig);
      }
    } catch (error) {
      console.warn('Failed to load config from localStorage:', error);
    }
    
    return { ...defaultConfig };
  }

  // Deep merge configuration objects
  private mergeConfig(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeConfig(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  // Save configuration to localStorage
  private saveConfig(): void {
    try {
      localStorage.setItem('thinkdrop-config', JSON.stringify(this.config));
    } catch (error) {
      console.error('Failed to save config to localStorage:', error);
    }
  }

  // Get current configuration
  getConfig(): AppConfig {
    return { ...this.config };
  }

  // Update configuration
  updateConfig(updates: Partial<AppConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
    this.saveConfig();
    this.notifyListeners();
  }

  // Get specific config sections
  getAPIConfig(): APIConfig {
    return { ...this.config.api };
  }

  getLocalLLMConfig(): LocalLLMConfig {
    return { ...this.config.localLLM };
  }

  // Update specific config sections
  updateAPIConfig(updates: Partial<APIConfig>): void {
    this.updateConfig({ api: { ...this.config.api, ...updates } });
  }

  updateLocalLLMConfig(updates: Partial<LocalLLMConfig>): void {
    this.updateConfig({ localLLM: { ...this.config.localLLM, ...updates } });
  }

  // Feature flags
  isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
    return this.config.features[feature];
  }

  enableFeature(feature: keyof AppConfig['features']): void {
    this.updateConfig({
      features: { ...this.config.features, [feature]: true }
    });
  }

  disableFeature(feature: keyof AppConfig['features']): void {
    this.updateConfig({
      features: { ...this.config.features, [feature]: false }
    });
  }

  // MCP configuration
  getMCPConfig(): MCPConfig {
    return { ...this.config.mcp };
  }

  updateMCPConfig(updates: Partial<MCPConfig>): void {
    this.updateConfig({ mcp: { ...this.config.mcp, ...updates } });
  }

  isMCPEnabled(): boolean {
    return this.config.mcp.enabled;
  }

  enableMCP(): void {
    this.updateConfig({
      mcp: { ...this.config.mcp, enabled: true }
    });
  }

  disableMCP(): void {
    this.updateConfig({
      mcp: { ...this.config.mcp, enabled: false }
    });
  }

  isMCPServiceEnabled(service: 'userMemory' | 'webSearch' | 'phi4'): boolean {
    return this.config.mcp.services[service].enabled;
  }

  updateMCPServiceConfig(service: 'userMemory' | 'webSearch' | 'phi4', updates: Partial<MCPServiceConfig>): void {
    this.updateConfig({
      mcp: {
        ...this.config.mcp,
        services: {
          ...this.config.mcp.services,
          [service]: { ...this.config.mcp.services[service], ...updates }
        }
      }
    });
  }

  // Environment detection
  isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  // Debug mode
  isDebugMode(): boolean {
    return this.config.ui.debugMode || this.isDevelopment();
  }

  // Configuration validation
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate API URL
    try {
      new URL(this.config.api.baseUrl);
    } catch {
      errors.push('Invalid API base URL');
    }

    // Validate Ollama URL
    try {
      new URL(this.config.localLLM.ollamaUrl);
    } catch {
      errors.push('Invalid Ollama URL');
    }

    // Validate timeouts
    if (this.config.api.timeout <= 0) {
      errors.push('API timeout must be positive');
    }

    if (this.config.localLLM.timeout <= 0) {
      errors.push('Local LLM timeout must be positive');
    }

    // Validate memory retention
    if (this.config.privacy.memoryRetentionDays <= 0) {
      errors.push('Memory retention days must be positive');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Reset to defaults
  resetToDefaults(): void {
    this.config = { ...defaultConfig };
    this.saveConfig();
    this.notifyListeners();
  }

  // Configuration listeners for React components
  addListener(listener: (config: AppConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.config));
  }

  // Export/Import configuration
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  importConfig(configJson: string): boolean {
    try {
      const importedConfig = JSON.parse(configJson);
      const validation = this.validateConfig();
      
      if (validation.valid) {
        this.config = this.mergeConfig(defaultConfig, importedConfig);
        this.saveConfig();
        this.notifyListeners();
        return true;
      } else {
        console.error('Invalid configuration:', validation.errors);
        return false;
      }
    } catch (error) {
      console.error('Failed to import configuration:', error);
      return false;
    }
  }
}

// Singleton instance
const configService = new ConfigService();

export default configService;
export { ConfigService };
