#!/bin/bash

# Quick fix for semantic-ui.duckdb WAL issues
# Run this before opening the database in Database Explorer

DB_PATH="$HOME/.thinkdrop/semantic-ui.duckdb"
WAL_PATH="${DB_PATH}.wal"

echo "🔧 Fixing semantic-ui.duckdb WAL issue..."

# Check if WAL exists
if [ -f "$WAL_PATH" ]; then
  echo "📦 Found WAL file, backing it up..."
  BACKUP_PATH="${WAL_PATH}.backup_$(date +%Y%m%d_%H%M%S)"
  mv "$WAL_PATH" "$BACKUP_PATH"
  echo "✅ WAL backed up to: $BACKUP_PATH"
fi

# Checkpoint the database
echo "💾 Checkpointing database..."
duckdb "$DB_PATH" -c "CHECKPOINT;"

if [ $? -eq 0 ]; then
  echo "✅ Database ready! You can now open it in Database Explorer."
  echo ""
  echo "📊 Current data:"
  duckdb "$DB_PATH" -c "SELECT COUNT(*) as nodes FROM ui_nodes; SELECT COUNT(*) as screens FROM ui_screen_states;"
else
  echo "❌ Failed to checkpoint. Please check if any process is using the database."
  exit 1
fi
