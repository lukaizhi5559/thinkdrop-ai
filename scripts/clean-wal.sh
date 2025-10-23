#!/bin/bash
# Clean up corrupted WAL files before starting the app
echo "🧹 Cleaning up WAL files..."
rm -f data/*.wal*
echo "✅ WAL files cleaned"
