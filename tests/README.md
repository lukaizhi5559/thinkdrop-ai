# StateGraph Performance Tests

End-to-end performance testing for the AgentOrchestrator StateGraph workflow.

## Quick Start

### 1. Start MCP Services
```bash
npm run start:services
```

### 2. Run Tests
```bash
# Quick test (single query)
npm run test:quick

# Quick test with custom query
npm run test:quick "What is the capital of France?"

# Full test suite (5 scenarios)
npm run test:perf

# Full test suite with debug logging
npm run test:perf:debug
```

## What Gets Tested

### Test Scenarios
1. **Simple Question** - General query without memory
2. **Memory Retrieval** - Semantic search for past conversations
3. **Web Search** - Online search with result processing
4. **Memory Storage** - Entity extraction and storage
5. **Conversational Query** - Context-aware history search

### Performance Metrics
- ⏱️ Total execution time
- 📊 Per-node timing breakdown
- 🕐 Timeline visualization
- ⚠️ Bottleneck identification (>20% of total time)
- 💾 Cache hit indicators
- 🔄 Iteration count (retries)

## Output Example

```
🚀 Quick Performance Test
📝 Message: "What is the capital of France?"

⚙️  Initializing database...
✅ Database initialized
⚙️  Initializing MCP system...
✅ MCP system initialized
⚙️  Creating AgentOrchestrator...
✅ AgentOrchestrator ready

✅ Success in 1.85s
🎯 Intent: general_query
💬 Response: The capital of France is Paris...

📊 Node Timings:
──────────────────────────────────────────────────────────────────────
✅ parseIntent              350ms    18.9% ███████████████████
✅ retrieveMemory           200ms    10.8% ██████████
✅ filterMemory             50ms      2.7% ██
✅ answer                   1200ms   64.9% ████████████████████████████████████████████████
✅ storeConversation        50ms      2.7% ██
──────────────────────────────────────────────────────────────────────
TOTAL: 1.85s

🐌 Slowest: answer (1200ms)
```

## Files

- **`quick-performance-test.cjs`** - Fast single-query test
- **`test-stategraph-performance.cjs`** - Comprehensive test suite
- **`PERFORMANCE_TESTING.md`** - Detailed documentation
- **`EXAMPLE_OUTPUT.md`** - Example test outputs

## Requirements

### MCP Services Must Be Running
The tests connect to these services:
- `user-memory` (port 3100)
- `conversation` (port 3102)
- `coreference` (port 3103)
- `phi4` (port 3104)
- `web-search` (port 3105)
- `command` (port 3106)
- `vision` (port 3107)
- `screen-intelligence` (port 3108)

Start all services:
```bash
npm run start:services
```

Stop all services:
```bash
npm run stop:services
```

### Database Initialization
Tests automatically:
- Create `~/.thinkdrop/thinkdrop.duckdb`
- Run database migrations
- Initialize MCPConfigManager
- Set up service registry

## Troubleshooting

### "Config manager not initialized" Error
**Cause:** MCP services not running  
**Fix:** Run `npm run start:services`

### "Service not found in registry" Error
**Cause:** Database migrations not run  
**Fix:** Delete `~/.thinkdrop/thinkdrop.duckdb` and re-run test

### "Connection refused" Error
**Cause:** Specific MCP service not running  
**Fix:** Check service logs in `mcp-services/*/logs/`

### Slow Performance
**Cause:** First run downloads ML models  
**Fix:** Subsequent runs will be faster (models cached)

## Performance Targets

- Simple queries: **<500ms**
- Memory retrieval: **<1s**
- Web search: **<2s**
- Complex workflows: **<3s**

## Documentation

- **[STATEGRAPH_PERFORMANCE_TEST.md](../STATEGRAPH_PERFORMANCE_TEST.md)** - Quick start guide
- **[PERFORMANCE_TESTING.md](PERFORMANCE_TESTING.md)** - Detailed documentation
- **[EXAMPLE_OUTPUT.md](EXAMPLE_OUTPUT.md)** - Example outputs

## Integration with UI

View live performance data in the app:
1. Open Memory Debugger (Ctrl/Cmd+Shift+M)
2. Switch to "Workflow Performance" tab
3. See real-time trace data with visual timeline
