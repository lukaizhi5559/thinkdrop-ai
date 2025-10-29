#!/bin/bash

# ThinkDrop AI - Start All MCP Services (Optimized)
# This script starts all services with memory optimizations and staggered startup

set -e  # Exit on error

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 ThinkDrop AI - Starting All Services (Optimized Mode)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create logs directory
mkdir -p logs

# Store PIDs for later
PIDS_FILE="$PROJECT_ROOT/.service-pids"
> "$PIDS_FILE"  # Clear file

# Function to start a service
start_service() {
    local service_name=$1
    local service_path=$2
    local memory_limit=$3
    
    echo "📦 Starting $service_name..."
    echo "   Path: $service_path"
    echo "   Memory Limit: ${memory_limit}MB"
    
    cd "$PROJECT_ROOT/$service_path"
    
    # Set memory limit
    export NODE_OPTIONS="--max-old-space-size=$memory_limit"
    
    # Start service in background
    yarn dev > "$PROJECT_ROOT/logs/$service_name.log" 2>&1 &
    local pid=$!
    
    echo "   PID: $pid"
    echo "$service_name:$pid" >> "$PIDS_FILE"
    
    # Wait a moment for service to start
    sleep 1
    
    # Check if still running
    if kill -0 $pid 2>/dev/null; then
        echo "   ✅ Started successfully"
    else
        echo "   ❌ Failed to start (check logs/$service_name.log)"
        return 1
    fi
    
    echo ""
    cd "$PROJECT_ROOT"
}

# Start services in order with staggered timing
echo "Starting services with optimized memory limits..."
echo ""

# 1. User Memory Service (lightweight)
start_service "user-memory" "$PROJECT_ROOT/mcp-services/thinkdrop-user-memory-service" 512
sleep 2

# 2. Web Search Service (lightweight)
start_service "web-search" "$PROJECT_ROOT/mcp-services/thinkdrop-web-search" 256
sleep 2

# 3. Conversation Service (medium)
start_service "conversation" "$PROJECT_ROOT/mcp-services/conversation-service" 512
sleep 2

# 4. Phi4 Service (heavy - load last)
start_service "phi4" "$PROJECT_ROOT/mcp-services/thinkdrop-phi4-service" 768
sleep 3

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All services started!"
echo ""
echo "📊 Service Status:"
echo "   • User Memory:   http://localhost:3001/service.health"
echo "   • Web Search:    http://localhost:3002/service.health"
echo "   • Phi4:          http://localhost:3003/service.health"
echo "   • Conversation:  http://localhost:3004/service.health"
echo ""
echo "🔌 Available API Endpoints:"
echo ""
echo "   📦 User Memory (Port 3001):"
echo "      • POST /memory.store          - Store memory"
echo "      • POST /memory.search         - Search memories"
echo "      • POST /memory.retrieve       - Retrieve memory"
echo "      • GET  /service.health        - Health check"
echo ""
echo "   🌐 Web Search (Port 3002):"
echo "      • POST /web.search            - General web search"
echo "      • POST /web.news              - News search"
echo "      • POST /content.extract       - Extract content"
echo "      • GET  /service.health        - Health check"
echo ""
echo "   🤖 Phi4 (Port 3003):"
echo "      • POST /intent.parse          - Parse intent"
echo "      • POST /general.answer        - Generate answer"
echo "      • POST /entity.extract        - Extract entities"
echo "      • POST /embedding.generate    - Generate embeddings"
echo "      • POST /parser.list           - List parsers"
echo "      • GET  /service.health        - Health check"
echo ""
echo "   💬 Conversation (Port 3004):"
echo "      • POST /session.create        - Create session"
echo "      • POST /session.list          - List sessions"
echo "      • POST /message.add           - Add message"
echo "      • POST /message.list          - List messages"
echo "      • POST /context.get           - Get context"
echo "      • POST /entity.add            - Add entity"
echo "      • GET  /service.health        - Health check"
echo ""
echo "📝 Logs:"
echo "   • View all:          tail -f logs/*.log"
echo "   • View user-memory:  tail -f logs/user-memory.log"
echo "   • View web-search:   tail -f logs/web-search.log"
echo "   • View phi4:         tail -f logs/phi4.log"
echo "   • View conversation: tail -f logs/conversation.log"
echo ""
echo "🛑 To stop all services:"
echo "   yarn stop:services"
echo ""
echo "💡 Tip: Wait 5-10 seconds for all services to fully initialize"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
