#!/bin/bash
#
# ThinkDrop AI Storage Cleanup Script
# Cleans up accumulated data from semantic-ui database and temp screenshots
#

set -e

echo "🧹 ThinkDrop AI Storage Cleanup"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Paths
THINKDROP_DIR="$HOME/.thinkdrop"
SEMANTIC_DB="$THINKDROP_DIR/semantic-ui.duckdb"
SCREENSHOT_DIR="/var/folders/2r/962pnvf11_v2d27z74_0xdvw0000gn/T/thinkdrop-semantic-capture"

# Check current sizes
echo "📊 Current Storage Usage:"
echo "------------------------"
if [ -f "$SEMANTIC_DB" ]; then
    SEMANTIC_SIZE=$(du -sh "$SEMANTIC_DB" | cut -f1)
    echo "  semantic-ui.duckdb: $SEMANTIC_SIZE"
else
    echo "  semantic-ui.duckdb: Not found"
fi

if [ -d "$SCREENSHOT_DIR" ]; then
    SCREENSHOT_SIZE=$(du -sh "$SCREENSHOT_DIR" | cut -f1)
    SCREENSHOT_COUNT=$(find "$SCREENSHOT_DIR" -name "*.png" | wc -l | tr -d ' ')
    echo "  Screenshots: $SCREENSHOT_SIZE ($SCREENSHOT_COUNT files)"
else
    echo "  Screenshots: Directory not found"
fi
echo ""

# Ask for confirmation
echo -e "${YELLOW}⚠️  This will:${NC}"
echo "  1. Delete the semantic-ui.duckdb database (40GB)"
echo "  2. Delete all temp screenshots (219MB)"
echo "  3. Keep conversation history and user memories"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cleanup cancelled"
    exit 0
fi

echo ""
echo "🗑️  Starting cleanup..."
echo ""

# 1. Clean up semantic-ui database
if [ -f "$SEMANTIC_DB" ]; then
    echo "🗄️  Removing semantic-ui.duckdb..."
    rm -f "$SEMANTIC_DB"
    rm -f "$SEMANTIC_DB.wal"
    rm -f "$SEMANTIC_DB.wal.backup"
    rm -f "$SEMANTIC_DB.wal.backup2"
    echo -e "${GREEN}✅ Removed semantic-ui database${NC}"
else
    echo "⏭️  semantic-ui.duckdb not found, skipping"
fi

# 2. Clean up temp screenshots
if [ -d "$SCREENSHOT_DIR" ]; then
    echo "📸 Removing temp screenshots..."
    rm -rf "$SCREENSHOT_DIR"/*
    echo -e "${GREEN}✅ Removed temp screenshots${NC}"
else
    echo "⏭️  Screenshot directory not found, skipping"
fi

echo ""
echo "📊 New Storage Usage:"
echo "--------------------"
if [ -d "$THINKDROP_DIR" ]; then
    NEW_SIZE=$(du -sh "$THINKDROP_DIR" | cut -f1)
    echo "  ~/.thinkdrop: $NEW_SIZE"
else
    echo "  ~/.thinkdrop: Not found"
fi

if [ -d "$SCREENSHOT_DIR" ]; then
    NEW_SCREENSHOT_SIZE=$(du -sh "$SCREENSHOT_DIR" | cut -f1)
    echo "  Screenshots: $NEW_SCREENSHOT_SIZE"
else
    echo "  Screenshots: 0B (empty)"
fi

echo ""
echo -e "${GREEN}✅ Cleanup complete!${NC}"
echo ""
echo "📝 Note: The semantic-ui database will be recreated automatically"
echo "   when you use screen intelligence features again."
echo ""
