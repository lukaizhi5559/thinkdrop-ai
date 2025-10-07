# MCP (Microservices Context Protocol) Module

**Version**: 1.0.0  
**Status**: Phase 0 Complete ✅

---

## Overview

This module provides the infrastructure for communicating with MCP microservices. It includes:

- **MCPClient**: HTTP client with retries, timeouts, and error handling
- **MCPRegistry**: Service discovery and health check management
- **MCPCircuitBreaker**: Reliability patterns to prevent cascading failures
- **MCPMetrics**: Observability with structured logging and metrics
- **MCPOrchestrator**: High-level API for routing requests to services

---

## Quick Start

### 1. Initialize MCP System

```javascript
const { initializeMCP } = require('./services/mcp');

// Initialize on app startup
await initializeMCP();
```

This will:
- Generate API keys if not exist (saved to `.env`)
- Validate configuration
- Register all configured services
- Start periodic health checks

### 2. Route Requests to MCP Services

```javascript
const { getMCPOrchestrator } = require('./services/mcp');

const orchestrator = getMCPOrchestrator();

// Classify intent via Phi4 service
const result = await orchestrator.classifyIntent(
  'Remember I have an appointment tomorrow',
  { sessionId: 'session_xyz' },
  async () => {
    // Fallback to local parser if Phi4 unavailable
    const parser = await IntentParserFactory.getParser();
    return await parser.parse(message);
  }
);

// Store memory via UserMemory service
const stored = await orchestrator.executeMemoryOperation(
  'store',
  { text: 'Meeting with Dr. Smith', entities: [...] },
  { userId: 'user_abc' },
  async () => {
    // Fallback to local UserMemoryAgent
    return await localUserMemoryAgent.storeMemory(data);
  }
);

// Search web via WebSearch service
const results = await orchestrator.executeWebSearch(
  'latest AI news',
  { maxResults: 10 },
  { userId: 'user_abc' },
  async () => {
    // Fallback to local WebSearchAgent
    return await localWebSearchAgent.search(query);
  }
);
```

### 3. Check Service Health

```javascript
// Check all services
const health = await orchestrator.getServiceHealth();

// Check specific service
const userMemoryHealth = await orchestrator.getServiceHealth('user-memory');

// Get degradation mode
const mode = orchestrator.getDegradationMode();
// Returns: 'full', 'degraded', 'local-only', or 'offline'
```

### 4. Monitor Metrics

```javascript
// Get metrics summary
const summary = orchestrator.getMetricsSummary();
console.log(summary);
// {
//   totalRequests: 1523,
//   successRate: '98.50%',
//   errorRate: '1.50%',
//   avgLatency: '45ms',
//   p95Latency: '125ms',
//   totalErrors: 23,
//   circuitBreakerOpens: 0
// }

// Get detailed metrics
const metrics = orchestrator.getMetrics();

// Get circuit breaker stats
const cbStats = orchestrator.getCircuitBreakerStats();
```

---

## Configuration

### Backend Config (`src/main/services/mcp/config.cjs`)

Loaded from environment variables:

```bash
# Feature Flags
MCP_ENABLED=false
MCP_ROUTE_MEMORY=false
MCP_ROUTE_WEB_SEARCH=false
MCP_ROUTE_PHI4=false

# API Keys (auto-generated)
MCP_USER_MEMORY_API_KEY=abc123...
MCP_WEB_SEARCH_API_KEY=def456...
MCP_PHI4_API_KEY=ghi789...

# Service Endpoints
MCP_USER_MEMORY_ENDPOINT=http://localhost:3001
MCP_WEB_SEARCH_ENDPOINT=http://localhost:3002
MCP_PHI4_ENDPOINT=http://localhost:3003

# Timeouts
MCP_USER_MEMORY_TIMEOUT=5000
MCP_WEB_SEARCH_TIMEOUT=3000
MCP_PHI4_TIMEOUT=10000

# Circuit Breaker
MCP_CB_FAILURE_THRESHOLD=5
MCP_CB_SUCCESS_THRESHOLD=3
MCP_CB_TIMEOUT=30000

# Health Checks
MCP_HEALTH_CHECK_INTERVAL=30000
MCP_HEALTH_CACHE_TTL=15000
```

### Frontend Config (`src/renderer/src/services/config.ts`)

TypeScript configuration with UI controls:

```typescript
import configService from './services/config';

// Check if MCP enabled
if (configService.isMCPEnabled()) {
  // MCP is active
}

// Enable MCP
configService.enableMCP();

// Update service endpoint
configService.updateMCPServiceConfig('userMemory', {
  endpoint: 'http://localhost:3001',
  apiKey: 'new-key',
  timeout: 5000
});

// Get MCP config
const mcpConfig = configService.getMCPConfig();
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│           AgentOrchestrator                     │
│  (Main app orchestration logic)                 │
└─────────────────┬───────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────┐
│           MCPOrchestrator                       │
│  - Route requests to MCP services               │
│  - Automatic fallback to local agents           │
│  - Degradation mode detection                   │
└─────────────────┬───────────────────────────────┘
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
   ┌────────┐ ┌────────┐ ┌────────┐
   │Registry│ │Circuit │ │Metrics │
   │        │ │Breaker │ │        │
   └────┬───┘ └────┬───┘ └────┬───┘
        │          │          │
        └──────────┼──────────┘
                   ↓
            ┌──────────────┐
            │  MCPClient   │
            │  (HTTP)      │
            └──────┬───────┘
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
   ┌────────┐ ┌────────┐ ┌────────┐
   │UserMem │ │WebSrch │ │ Phi4   │
   │Service │ │Service │ │Service │
   │:3001   │ │:3002   │ │:3003   │
   └────────┘ └────────┘ └────────┘
```

---

## Module Structure

```
src/main/services/mcp/
├── index.js                    # Main entry point
├── config.cjs                  # Backend configuration
├── MCPClient.js                # HTTP client
├── MCPRegistry.js              # Service registry
├── MCPCircuitBreaker.js        # Circuit breaker
├── MCPMetrics.js               # Metrics collection
├── MCPOrchestrator.js          # High-level orchestration
├── schemas/
│   ├── envelope.cjs            # Request/response envelopes
│   └── intents.cjs             # Intent-to-service mapping
├── utils/
│   └── apiKeyGenerator.cjs     # API key generation
└── README.md                   # This file
```

---

## Usage Examples

### Example 1: Route Intent Classification

```javascript
const { getMCPOrchestrator } = require('./services/mcp');
const IntentParserFactory = require('./services/utils/IntentParserFactory.cjs');

async function classifyIntent(message, context) {
  const orchestrator = getMCPOrchestrator();
  
  // Try MCP first, fallback to local
  const result = await orchestrator.classifyIntent(
    message,
    context,
    async () => {
      // Local fallback
      const parser = await IntentParserFactory.getParser();
      return await parser.parse(message);
    }
  );
  
  return result;
}
```

### Example 2: Store Memory with Fallback

```javascript
async function storeMemory(data, context) {
  const orchestrator = getMCPOrchestrator();
  
  const result = await orchestrator.executeMemoryOperation(
    'store',
    data,
    context,
    async () => {
      // Local fallback
      const agent = this.getLoadedAgent('UserMemoryAgent');
      return await agent.storeMemory(data);
    }
  );
  
  return result;
}
```

### Example 3: Check System Health

```javascript
async function checkMCPHealth() {
  const orchestrator = getMCPOrchestrator();
  
  // Get all service health
  const health = await orchestrator.getServiceHealth();
  
  // Get degradation mode
  const mode = orchestrator.getDegradationMode();
  
  console.log('MCP Status:', {
    mode,
    services: health
  });
}
```

### Example 4: Monitor Performance

```javascript
function logMCPMetrics() {
  const orchestrator = getMCPOrchestrator();
  
  const summary = orchestrator.getMetricsSummary();
  console.log('MCP Metrics:', summary);
  // {
  //   totalRequests: 1523,
  //   successRate: '98.50%',
  //   errorRate: '1.50%',
  //   avgLatency: '45ms',
  //   p95Latency: '125ms'
  // }
}
```

---

## Feature Flags

### Enable/Disable MCP Globally

```javascript
// Backend (config.cjs)
process.env.MCP_ENABLED = 'true';

// Frontend (config.ts)
configService.enableMCP();
```

### Enable Specific Service Routing

```javascript
// Route memory operations to MCP
process.env.MCP_ROUTE_MEMORY = 'true';

// Route web search to MCP
process.env.MCP_ROUTE_WEB_SEARCH = 'true';

// Route intent parsing to MCP
process.env.MCP_ROUTE_PHI4 = 'true';
```

### Gradual Rollout Strategy

```javascript
// Week 1: Enable MCP but don't route anything
MCP_ENABLED=true
MCP_ROUTE_MEMORY=false
MCP_ROUTE_WEB_SEARCH=false
MCP_ROUTE_PHI4=false

// Week 2: Route 10% of memory operations (implement percentage logic)
MCP_ROUTE_MEMORY=true
// Add percentage routing in orchestrator

// Week 3: Route 50% of memory operations
// Increase percentage

// Week 4: Route 100% of memory operations
// Full migration
```

---

## Error Handling

### Circuit Breaker States

- **CLOSED**: Normal operation, all requests go through
- **OPEN**: Service failing, reject requests immediately (use fallback)
- **HALF_OPEN**: Testing recovery, allow limited requests

### Error Codes

- `INVALID_REQUEST`: Client error, fix request
- `UNAUTHORIZED`: API key invalid
- `SERVICE_UNAVAILABLE`: Service down, use fallback
- `TIMEOUT`: Request timeout, retry or fallback
- `INTERNAL_ERROR`: Server error, retry if retryable

### Fallback Strategy

```javascript
async function executeWithFallback(mcpFn, localFn) {
  try {
    // Try MCP first
    const result = await mcpFn();
    if (result !== null) {
      return result;
    }
  } catch (error) {
    console.warn('MCP failed, using local fallback:', error.message);
  }
  
  // Fallback to local
  return await localFn();
}
```

---

## Testing

### Unit Tests

```bash
npm test src/main/services/mcp/
```

### Integration Tests

```bash
# Start services
docker-compose up -d

# Run integration tests
npm run test:integration:mcp
```

### Manual Testing

```bash
# Check health
curl http://localhost:3001/service.health
curl http://localhost:3002/service.health
curl http://localhost:3003/service.health

# Test intent parsing
curl -X POST http://localhost:3003/intent.parse \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "mcp.v1",
    "service": "phi4",
    "action": "intent.parse",
    "requestId": "test-123",
    "payload": {
      "message": "Remember I have an appointment tomorrow"
    }
  }'
```

---

## Troubleshooting

### Issue: Services not starting

**Check**:
1. API keys generated: `cat .env | grep MCP_`
2. Ports available: `lsof -i :3001 -i :3002 -i :3003`
3. Services running: `docker ps` or `pm2 list`

### Issue: Circuit breaker always open

**Check**:
1. Service health: `curl http://localhost:3001/service.health`
2. Circuit breaker stats: Call `orchestrator.getCircuitBreakerStats()`
3. Logs for repeated failures

**Solution**: Reset circuit breaker manually:
```javascript
const cbManager = getCircuitBreakerManager();
const breaker = cbManager.getBreaker('user-memory');
breaker.forceClose();
```

### Issue: High latency

**Check**:
1. Metrics: `orchestrator.getMetricsSummary()`
2. Service health: Check p95 latency per service
3. Network: Test localhost connectivity

**Solution**: Adjust timeouts in config or optimize service

---

## Next Steps (Phase 1)

1. ✅ Phase 0 Complete: Infrastructure ready
2. ⏳ Phase 1: Create `ipc-handlers-mcp.cjs` for frontend integration
3. ⏳ Phase 2: Build UserMemory microservice
4. ⏳ Phase 3: Build WebSearch microservice
5. ⏳ Phase 4: Build Phi4 microservice
6. ⏳ Phase 5: Enable feature flags and test
7. ⏳ Phase 6: Gradual rollout and deprecation

---

## Documentation

- **MCP_ARCHITECTURE_PLAN.md**: Complete architecture plan
- **AGENT_SPEC_UserMemory.md**: UserMemory service specification
- **AGENT_SPEC_WebSearch.md**: WebSearch service specification
- **AGENT_SPEC_Phi4.md**: Phi4 service specification
- **PHI4_SERVICE_ANALYSIS.md**: Feasibility analysis for Phi4 migration

---

**Last Updated**: 2025-10-02  
**Maintainer**: Thinkdrop AI Team
