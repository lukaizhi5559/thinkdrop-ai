#!/bin/bash

# ThinkDrop AI - Start All MCP Services (Optimized)
# This script starts all services with memory optimizations and staggered startup

set -e  # Exit on error

# Get the project root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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
    
cd "$service_path"
    
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

# Function to start a Python service
start_python_service() {
    local service_name=$1
    local service_path=$2
    
    echo "🐍 Starting $service_name (Python)..."
    echo "   Path: $service_path"
    
    cd "$service_path"
    
    # Check if virtual environment exists
    if [ ! -d "venv" ]; then
        echo "   ⚠️  Virtual environment not found. Run setup first:"
        echo "      cd $service_path && ./setup.sh"
        echo ""
        cd "$PROJECT_ROOT"
        return 1
    fi
    
    # Activate virtual environment and start service
    source venv/bin/activate
    python server.py > "$PROJECT_ROOT/logs/$service_name.log" 2>&1 &
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
        cd "$PROJECT_ROOT"
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

# 4. Coreference Service (Python - lightweight NLP)
start_python_service "coreference" "$PROJECT_ROOT/mcp-services/coreference-service"
sleep 2

# 5. Vision Service (Python - OCR/VLM)
start_python_service "vision" "$PROJECT_ROOT/mcp-services/vision-service"
sleep 2

# 6. Phi4 Service (heavy - load last)
start_service "phi4" "$PROJECT_ROOT/mcp-services/thinkdrop-phi4-service" 768
sleep 3

# 7. Command Service (lightweight - uses Ollama)
echo "⚡ Starting command (Node.js)..."
echo "   Path: $PROJECT_ROOT/mcp-services/command-service"
echo "   Memory Limit: 256MB"
cd "$PROJECT_ROOT/mcp-services/command-service"
export NODE_OPTIONS="--max-old-space-size=256"
npm run dev > "$PROJECT_ROOT/logs/command.log" 2>&1 &
command_pid=$!
echo "   PID: $command_pid"
echo "command:$command_pid" >> "$PIDS_FILE"
sleep 1
if kill -0 $command_pid 2>/dev/null; then
    echo "   ✅ Started successfully"
else
    echo "   ❌ Failed to start (check logs/command.log)"
fi
echo ""
cd "$PROJECT_ROOT"
sleep 2

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All services started!"
echo ""
echo "📊 Service Status:"
echo "   • User Memory:   http://localhost:3001/service.health"
echo "   • Web Search:    http://localhost:3002/service.health"
echo "   • Phi4:          http://localhost:3003/service.health"
echo "   • Conversation:  http://localhost:3004/service.health"
echo "   • Coreference:   http://localhost:3005/health"
echo "   • Vision:        http://localhost:3006/health"
echo "   • Command:       http://localhost:3007/health"
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
echo "      • POST /message.search        - Semantic search"
echo "      • POST /context.get           - Get context"
echo "      • POST /entity.add            - Add entity"
echo "      • GET  /service.health        - Health check"
echo ""
echo "   🔗 Coreference (Port 3005):"
echo "      • POST /resolve               - Resolve references"
echo "      • GET  /health                - Health check"
echo ""
echo "   👁️  Vision (Port 3006):"
echo "      • POST /vision/capture        - Capture screenshot"
echo "      • POST /vision/ocr            - Extract text"
echo "      • POST /vision/describe       - Describe scene"
echo "      • POST /vision/watch/start    - Start monitoring"
echo "      • POST /vision/watch/stop     - Stop monitoring"
echo "      • GET  /vision/watch/status   - Watch status"
echo "      • GET  /health                - Health check"
echo ""
echo "   ⚡ Command (Port 3007):"
echo "      • POST /command.execute       - Execute command"
echo "      • POST /command.interpret     - Interpret command"
echo "      • POST /system.query          - System query"
echo "      • GET  /health                - Health check"
echo ""
echo "📝 Logs:"
echo "   • View all:          tail -f logs/*.log"
echo "   • View user-memory:  tail -f logs/user-memory.log"
echo "   • View web-search:   tail -f logs/web-search.log"
echo "   • View phi4:         tail -f logs/phi4.log"
echo "   • View conversation: tail -f logs/conversation.log"
echo "   • View coreference:  tail -f logs/coreference.log"
echo "   • View vision:       tail -f logs/vision.log"
echo "   • View command:      tail -f logs/command.log"
echo ""
echo "🛑 To stop all services:"
echo "   yarn stop:services"
echo ""
echo "💡 Tip: Wait 5-10 seconds for all services to fully initialize"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
