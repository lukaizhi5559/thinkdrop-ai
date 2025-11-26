#!/usr/bin/env node

/**
 * Analyze overlay file usage
 */

const fs = require('fs');
const path = require('path');

const overlayDir = path.join(__dirname, '../src/overlay');
const srcMainDir = path.join(__dirname, '../src/main');

console.log('🔍 Analyzing overlay file usage...\n');

// Overlay files to check
const overlayFiles = {
  'ai-viewing-indicator.html': {
    path: 'src/overlay/ai-viewing-indicator.html',
    usedBy: [],
    type: 'HTML'
  },
  'ai-viewing-indicator.tsx': {
    path: 'src/overlay/ai-viewing-indicator.tsx',
    usedBy: [],
    type: 'TSX'
  },
  'hotkey-toast.html': {
    path: 'src/overlay/hotkey-toast.html',
    usedBy: [],
    type: 'HTML'
  },
  'screen-intelligence.html': {
    path: 'src/overlay/screen-intelligence.html',
    usedBy: [],
    type: 'HTML'
  },
  'selection-overlay.html': {
    path: 'src/overlay/selection-overlay.html',
    usedBy: [],
    type: 'HTML'
  },
  'index.css': {
    path: 'src/overlay/index.css',
    usedBy: [],
    type: 'CSS'
  },
  'components/OverlayToast.tsx': {
    path: 'src/overlay/components/OverlayToast.tsx',
    usedBy: [],
    type: 'TSX'
  },
  'types/electronAPI.ts': {
    path: 'src/overlay/types/electronAPI.ts',
    usedBy: [],
    type: 'TS'
  }
};

// Search for usage in src/main
function searchForUsage(fileName) {
  const results = [];
  
  function searchDir(dir) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        searchDir(filePath);
      } else if (file.endsWith('.cjs') || file.endsWith('.js')) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check if file references the overlay file
        if (content.includes(fileName)) {
          const relativePath = path.relative(srcMainDir, filePath);
          results.push(relativePath);
        }
      }
    });
  }
  
  searchDir(srcMainDir);
  return results;
}

// Analyze each overlay file
Object.entries(overlayFiles).forEach(([fileName, info]) => {
  const usedBy = searchForUsage(fileName);
  info.usedBy = usedBy;
});

// Print results
console.log('📊 OVERLAY FILE USAGE ANALYSIS\n');
console.log('='.repeat(80));

let usedCount = 0;
let unusedCount = 0;

Object.entries(overlayFiles).forEach(([fileName, info]) => {
  const status = info.usedBy.length > 0 ? '✅ USED' : '❌ UNUSED';
  const isUsed = info.usedBy.length > 0;
  
  if (isUsed) usedCount++;
  else unusedCount++;
  
  console.log(`\n${status}: ${fileName} (${info.type})`);
  
  if (info.usedBy.length > 0) {
    console.log('  Used by:');
    info.usedBy.forEach(file => {
      console.log(`    - ${file}`);
    });
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📈 SUMMARY:`);
console.log(`   Total overlay files: ${Object.keys(overlayFiles).length}`);
console.log(`   Used: ${usedCount}`);
console.log(`   Unused: ${unusedCount}`);

// Check for window files that might be unused
console.log('\n\n🪟 WINDOW FILES ANALYSIS\n');
console.log('='.repeat(80));

const windowFiles = [
  'windows/ai-viewing-overlay.cjs',
  'windows/hotkey-toast-overlay.cjs',
  'windows/screen-intelligence-overlay.cjs',
  'windows/selection-overlay.cjs',
  'windows/guide-window.cjs',
  'windows/fab-window.cjs'
];

windowFiles.forEach(windowFile => {
  const filePath = path.join(srcMainDir, windowFile);
  
  if (!fs.existsSync(filePath)) {
    console.log(`\n⏭️  SKIPPED: ${windowFile} (not found)`);
    return;
  }
  
  const fileName = path.basename(windowFile);
  const usedBy = searchForUsage(fileName);
  
  const status = usedBy.length > 0 ? '✅ USED' : '❌ UNUSED';
  console.log(`\n${status}: ${windowFile}`);
  
  if (usedBy.length > 0) {
    console.log('  Used by:');
    usedBy.forEach(file => {
      console.log(`    - ${file}`);
    });
  }
});

console.log('\n' + '='.repeat(80));
