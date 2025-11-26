#!/usr/bin/env node

/**
 * Safe cleanup of unused files in src/main
 * Identifies files that are truly unused and safe to delete
 */

const fs = require('fs');
const path = require('path');

const srcMainDir = path.join(__dirname, '../src/main');

// Files that are used but not via require() - DO NOT DELETE
const specialFiles = new Set([
  'preload.cjs', // Used by Electron BrowserWindow
  'workers/window-tracker-worker.cjs', // Used by Worker threads
  'workers/screen-intelligence-worker.cjs', // May be used by Worker threads
  'workers/screen-intelligence-worker.js', // May be used by Worker threads
]);

// Files that are safe to delete (confirmed unused)
const safeToDelete = [
  // Old/deprecated selection detector implementations
  'services/selection-detector-clipboard.cjs',
  'services/selection-detector-hybrid.cjs',
  'services/selection-detector-new.cjs',
  'services/selection-detector-old.cjs',
  
  // Unused utilities
  'services/utils/DuckDBWrapper.js', // Replaced by duckdb-wrapper.cjs
  'services/utils/MathUtils.cjs',
  'services/utils/ScreenshotStorage.js',
  'services/utils/transformers-config.cjs',
  'services/utils/utils.cjs',
  
  // Unused sandbox files
  'services/AgentSandbox.js',
  'services/sandbox-worker.js',
  
  // Deprecated agent files
  'services/agents/Agent.js',
  'services/agents/ConversationSessionAgent.cjs', // Now in MCP mode
  
  // Unused MCP files
  'services/mcp/MCPConfigManager.js', // .cjs version is used
  'services/mcp/MCPServiceDiscovery.cjs',
  'services/mcp/index.js',
  
  // Deprecated migrations
  'services/mcp/migrations/004_fix_web_search_actions.cjs',
  'services/mcp/migrations/005_add_knowledge_action.cjs',
  'services/mcp/migrations/011_remove_oauth_from_services.cjs',
  
  // Unused MCP nodes (deprecated cache system)
  'services/mcp/nodes/checkCacheReadiness.cjs',
  'services/mcp/nodes/checkScreenCache.cjs',
  'services/mcp/nodes/generatePredictiveCache.cjs',
  
  // Deprecated handler
  'handlers/ipc-handlers-mcp-updated.cjs',
];

// Backup directory
const backupDir = path.join(__dirname, '../.cleanup-backup');

console.log('🧹 Safe Cleanup Tool\n');
console.log('This will move unused files to .cleanup-backup/\n');

// Create backup directory
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`📁 Created backup directory: ${backupDir}\n`);
}

let movedCount = 0;
let skippedCount = 0;

safeToDelete.forEach(relativePath => {
  const filePath = path.join(srcMainDir, relativePath);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⏭️  Skipped (not found): ${relativePath}`);
    skippedCount++;
    return;
  }
  
  // Create backup subdirectory structure
  const backupPath = path.join(backupDir, relativePath);
  const backupSubdir = path.dirname(backupPath);
  
  if (!fs.existsSync(backupSubdir)) {
    fs.mkdirSync(backupSubdir, { recursive: true });
  }
  
  // Move file to backup
  try {
    fs.renameSync(filePath, backupPath);
    console.log(`✅ Moved: ${relativePath}`);
    movedCount++;
  } catch (error) {
    console.log(`❌ Failed to move ${relativePath}: ${error.message}`);
    skippedCount++;
  }
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 CLEANUP SUMMARY:`);
console.log(`   Files moved to backup: ${movedCount}`);
console.log(`   Files skipped: ${skippedCount}`);
console.log(`\n💡 To restore files, copy them back from .cleanup-backup/`);
console.log(`💡 To permanently delete, run: rm -rf .cleanup-backup/`);
