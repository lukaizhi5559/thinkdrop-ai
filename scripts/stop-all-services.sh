#!/bin/bash

# ThinkDrop AI - Stop All MCP Services

set -e

# Get the project root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🛑 ThinkDrop AI - Stopping All Services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PIDS_FILE="$PROJECT_ROOT/.service-pids"

if [ ! -f "$PIDS_FILE" ]; then
    echo "⚠️  No running services found (PID file missing)"
    echo ""
    echo "Attempting to kill all processes running MCP services..."
    pkill -f "thinkdrop-user-memory-service" || true
    pkill -f "thinkdrop-phi4-service" || true
    pkill -f "thinkdrop-web-search" || true
    pkill -f "conversation-service" || true
    pkill -f "coreference-service.*server.py" || true
    pkill -f "command-service.*http-server" || true
    pkill -f "screen-intelligence-service" || true
    
    # Also kill by port to catch orphaned processes
    lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    lsof -ti:3002 | xargs kill -9 2>/dev/null || true
    lsof -ti:3003 | xargs kill -9 2>/dev/null || true
    lsof -ti:3004 | xargs kill -9 2>/dev/null || true
    lsof -ti:3005 | xargs kill -9 2>/dev/null || true
    lsof -ti:3007 | xargs kill -9 2>/dev/null || true
    lsof -ti:3008 | xargs kill -9 2>/dev/null || true
    
    echo "✅ Done"
    exit 0
fi

# Read PIDs and stop services
while IFS=: read -r service_name pid; do
    echo "🛑 Stopping $service_name (PID: $pid)..."
    
    if kill -0 $pid 2>/dev/null; then
        kill $pid
        
        # Wait for graceful shutdown
        sleep 1
        
        # Force kill if still running
        if kill -0 $pid 2>/dev/null; then
            echo "   ⚠️  Forcing shutdown..."
            kill -9 $pid 2>/dev/null || true
        fi
        
        echo "   ✅ Stopped"
    else
        echo "   ⚠️  Already stopped"
    fi
done < "$PIDS_FILE"

# Clean up PID file
rm -f "$PIDS_FILE"

# Final cleanup: kill any orphaned processes by port
echo ""
echo "🧹 Cleaning up orphaned processes..."
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
lsof -ti:3003 | xargs kill -9 2>/dev/null || true
lsof -ti:3004 | xargs kill -9 2>/dev/null || true
lsof -ti:3005 | xargs kill -9 2>/dev/null || true
lsof -ti:3007 | xargs kill -9 2>/dev/null || true
lsof -ti:3008 | xargs kill -9 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All services stopped"
echo ""
echo "📝 Logs preserved in ./logs/"
echo "🚀 To restart: yarn restart:services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
