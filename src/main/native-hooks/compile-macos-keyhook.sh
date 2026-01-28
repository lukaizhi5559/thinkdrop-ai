#!/bin/bash

# Compile the Swift keyhook helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/bin"
mkdir -p "$OUTPUT_DIR"

echo "Compiling macOS keyhook helper..."
swiftc -o "$OUTPUT_DIR/macos-keyhook" "$SCRIPT_DIR/macos-keyhook.swift" -framework Cocoa -framework Carbon

if [ $? -eq 0 ]; then
    echo "✅ Compiled successfully: $OUTPUT_DIR/macos-keyhook"
    chmod +x "$OUTPUT_DIR/macos-keyhook"
else
    echo "❌ Compilation failed"
    exit 1
fi
