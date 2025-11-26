#!/usr/bin/env node

/**
 * Script to replace console.log/error/warn/info/debug with logger calls in src/main
 */

const fs = require('fs');
const path = require('path');

const srcMainDir = path.join(__dirname, '../src/main');
const loggerPath = './logger.cjs';

// Files to process
const filesToProcess = [];

// Recursively find all .cjs and .js files in src/main
function findFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findFiles(filePath, fileList);
    } else if (file.endsWith('.cjs') || file.endsWith('.js')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Process a single file
function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  // Check if file already has logger imported
  const hasLoggerImport = content.includes("require('./logger.cjs')") || 
                          content.includes('require("./logger.cjs")') ||
                          content.includes("require('../logger.cjs')") ||
                          content.includes('require("../logger.cjs")') ||
                          content.includes("require('../../logger.cjs')") ||
                          content.includes('require("../../logger.cjs")');
  
  // Check if file has any console statements
  const hasConsoleStatements = /console\.(log|error|warn|info|debug)\s*\(/.test(content);
  
  if (!hasConsoleStatements) {
    return { processed: false, reason: 'no console statements' };
  }
  
  // Calculate relative path to logger
  const fileDir = path.dirname(filePath);
  const relativePath = path.relative(fileDir, path.join(srcMainDir, 'logger.cjs'));
  const loggerRequire = `./${relativePath.replace(/\\/g, '/')}`;
  
  // Add logger import if not present
  if (!hasLoggerImport) {
    // Find the last require statement or the beginning of the file
    const requireRegex = /^const .+ = require\(.+\);?\s*$/gm;
    const matches = [...content.matchAll(requireRegex)];
    
    if (matches.length > 0) {
      // Add after the last require
      const lastMatch = matches[matches.length - 1];
      const insertPos = lastMatch.index + lastMatch[0].length;
      content = content.slice(0, insertPos) + 
                `\nconst logger = require('${loggerRequire}');` +
                content.slice(insertPos);
    } else {
      // Add at the beginning after any comments
      const lines = content.split('\n');
      let insertIndex = 0;
      
      // Skip initial comments
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          insertIndex = i + 1;
        } else {
          break;
        }
      }
      
      lines.splice(insertIndex, 0, `const logger = require('${loggerRequire}');`);
      content = lines.join('\n');
    }
  }
  
  // Replace console statements
  // Handle console.log -> logger.debug
  content = content.replace(/console\.log\s*\(/g, 'logger.debug(');
  
  // Handle console.error -> logger.error
  content = content.replace(/console\.error\s*\(/g, 'logger.error(');
  
  // Handle console.warn -> logger.warn
  content = content.replace(/console\.warn\s*\(/g, 'logger.warn(');
  
  // Handle console.info -> logger.info
  content = content.replace(/console\.info\s*\(/g, 'logger.info(');
  
  // Handle console.debug -> logger.debug
  content = content.replace(/console\.debug\s*\(/g, 'logger.debug(');
  
  // Only write if content changed
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    return { processed: true, reason: 'replaced console statements' };
  }
  
  return { processed: false, reason: 'no changes needed' };
}

// Main execution
console.log('🔍 Finding files in src/main...');
const files = findFiles(srcMainDir);
console.log(`📁 Found ${files.length} files to check\n`);

let processedCount = 0;
let skippedCount = 0;

files.forEach(file => {
  const relativePath = path.relative(srcMainDir, file);
  const result = processFile(file);
  
  if (result.processed) {
    console.log(`✅ ${relativePath} - ${result.reason}`);
    processedCount++;
  } else {
    skippedCount++;
  }
});

console.log(`\n📊 Summary:`);
console.log(`   Processed: ${processedCount} files`);
console.log(`   Skipped: ${skippedCount} files`);
console.log(`   Total: ${files.length} files`);
console.log(`\n✨ Done! All console statements have been replaced with logger calls.`);
console.log(`💡 Set DEBUG_MODE=true in your .env file to enable console output.`);
