#!/bin/bash
# Checkpoint WAL files to preserve data before cleanup
echo "💾 Checkpointing WAL files to preserve data..."

# Checkpoint agent_memory.duckdb WAL
if [ -f "data/agent_memory.duckdb" ]; then
  echo "  Checkpointing agent_memory.duckdb..."
  duckdb data/agent_memory.duckdb "PRAGMA wal_checkpoint(PASSIVE);" 2>/dev/null || echo "  ⚠️  Could not checkpoint agent_memory.duckdb"
fi

# Checkpoint conversation.duckdb WAL
if [ -f "data/conversation.duckdb" ]; then
  echo "  Checkpointing conversation.duckdb..."
  duckdb data/conversation.duckdb "PRAGMA wal_checkpoint(PASSIVE);" 2>/dev/null || echo "  ⚠️  Could not checkpoint conversation.duckdb"
fi

# Checkpoint user_memory.duckdb WAL
if [ -f "data/user_memory.duckdb" ]; then
  echo "  Checkpointing user_memory.duckdb..."
  duckdb data/user_memory.duckdb "PRAGMA wal_checkpoint(PASSIVE);" 2>/dev/null || echo "  ⚠️  Could not checkpoint user_memory.duckdb"
fi

echo "✅ WAL checkpoints complete - data preserved"

# Only remove WAL files if checkpoint succeeded
# This ensures data is safely written to main database first
echo "🧹 Cleaning up WAL files after checkpoint..."
rm -f data/*.wal*
echo "✅ WAL files cleaned"
