#!/usr/bin/env node

/**
 * Safe cleanup of unused files in src/renderer
 */

const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '../src/renderer');

// Files that are safe to delete (confirmed unused)
const safeToDelete = [
  // Unused React components
  'src/components/FABButton.tsx', // Replaced by fab.html
  'src/components/AgentWindow.tsx', // Old agent system
  'src/components/Markdown.tsx', // Duplicate of MarkdownRenderer
  'src/components/PipelineToggle.tsx', // Old orchestration UI
  'src/components/PrimaryControlBar.tsx', // Old UI component
  'src/components/TranscriptDisplay.tsx', // Old transcript UI
  
  // Unused rich content renderer (individual components are used)
  'src/components/rich-content/RichContentRenderer.tsx',
  
  // Unused services
  'src/services/config.ts', // Not used
  'src/services/websocketIntegration.ts', // Not used
  'src/services/youtubeService.ts', // Not used
  
  // Unused types
  'src/types/view.ts', // ViewType is imported but file may have other unused exports
  
  // Unused UI components (shadcn/ui components not being used)
  'src/components/ui/avatar.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/card.tsx',
  'src/components/ui/dialog.tsx',
  'src/components/ui/progress.tsx',
  'src/components/ui/separator.tsx',
];

// Potentially deprecated files (need manual review)
const potentiallyDeprecated = [
  'src/components/AgentStatusPanel.tsx', // May be used in non-MCP mode
  'src/components/InsightWindow.tsx', // May be used in legacy mode
  'src/components/OrchestrationDashboard.tsx', // May be used in non-MCP mode
  'src/components/WorkflowTraceViewer.tsx', // May be used for debugging
  'src/contexts/LocalLLMContext.tsx', // May be used in non-MCP mode
  'src/components/MarkdownRenderer.tsx', // Check if this is actually used vs Markdown.tsx
];

// Backup directory
const backupDir = path.join(__dirname, '../.cleanup-backup-renderer');

console.log('🧹 Renderer Cleanup Tool\n');
console.log('This will move unused files to .cleanup-backup-renderer/\n');

// Create backup directory
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`📁 Created backup directory: ${backupDir}\n`);
}

let movedCount = 0;
let skippedCount = 0;

console.log('📦 MOVING UNUSED FILES:\n');
console.log('='.repeat(80));

safeToDelete.forEach(relativePath => {
  const filePath = path.join(rendererDir, relativePath);
  
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

console.log('\n' + '='.repeat(80));
console.log(`\n📊 CLEANUP SUMMARY:`);
console.log(`   Files moved to backup: ${movedCount}`);
console.log(`   Files skipped: ${skippedCount}`);

console.log('\n\n⚠️  POTENTIALLY DEPRECATED FILES (NOT MOVED):\n');
console.log('='.repeat(80));
console.log('These files may still be used in non-MCP mode or for debugging.');
console.log('Review manually before deleting:\n');

potentiallyDeprecated.forEach(file => {
  const filePath = path.join(rendererDir, file);
  if (fs.existsSync(filePath)) {
    console.log(`   📋 ${file}`);
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n💡 To restore files, copy them back from .cleanup-backup-renderer/`);
console.log(`💡 To permanently delete, run: rm -rf .cleanup-backup-renderer/`);
