#!/bin/bash
# Backup conversation.duckdb to prevent data loss
# This script should be run periodically (e.g., every 5 minutes via cron or on app shutdown)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/data"
BACKUP_DIR="$DATA_DIR/backups"
DB_FILE="$DATA_DIR/conversation.duckdb"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
  echo "⚠️  No conversation database found at $DB_FILE"
  exit 0
fi

# Generate timestamp for backup filename
TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S-%3NZ")
BACKUP_FILE="$BACKUP_DIR/conversation.duckdb.backup-$TIMESTAMP"

# Checkpoint WAL to ensure all data is in the main database
echo "💾 Checkpointing conversation database..."
duckdb "$DB_FILE" "PRAGMA wal_checkpoint(PASSIVE);" 2>/dev/null || {
  echo "⚠️  Could not checkpoint database, backing up anyway..."
}

# Create backup using cp (preserves file attributes)
echo "📦 Creating backup: $BACKUP_FILE"
cp "$DB_FILE" "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "✅ Backup created successfully"
  
  # Keep only the last 10 backups to save disk space
  echo "🧹 Cleaning up old backups (keeping last 10)..."
  ls -t "$BACKUP_DIR"/conversation.duckdb.backup-* 2>/dev/null | tail -n +11 | xargs -r rm -f
  
  # Show backup size
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "📊 Backup size: $BACKUP_SIZE"
  
  # Count total backups
  BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/conversation.duckdb.backup-* 2>/dev/null | wc -l)
  echo "📚 Total backups: $BACKUP_COUNT"
else
  echo "❌ Backup failed!"
  exit 1
fi
