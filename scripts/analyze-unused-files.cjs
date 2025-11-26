#!/usr/bin/env node

/**
 * Analyze unused files in src/main directory
 * Finds files that are never imported/required by other files
 */

const fs = require('fs');
const path = require('path');

const srcMainDir = path.join(__dirname, '../src/main');

// Files to process
const allFiles = [];
const importedFiles = new Set();
const fileImports = new Map(); // Track what each file imports

// Recursively find all .cjs and .js files
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

// Extract all require/import statements from a file
function extractImports(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const imports = [];
    
    // Match require statements: require('./path') or require("./path")
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    
    while ((match = requireRegex.exec(content)) !== null) {
      const importPath = match[1];
      
      // Skip node_modules
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        continue;
      }
      
      // Resolve relative path
      const fileDir = path.dirname(filePath);
      let resolvedPath = path.resolve(fileDir, importPath);
      
      // Add .cjs or .js extension if missing
      if (!fs.existsSync(resolvedPath)) {
        if (fs.existsSync(resolvedPath + '.cjs')) {
          resolvedPath = resolvedPath + '.cjs';
        } else if (fs.existsSync(resolvedPath + '.js')) {
          resolvedPath = resolvedPath + '.js';
        }
      }
      
      if (fs.existsSync(resolvedPath)) {
        imports.push(resolvedPath);
        importedFiles.add(resolvedPath);
      }
    }
    
    // Match dynamic imports: import('./path')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      const importPath = match[1];
      
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        continue;
      }
      
      const fileDir = path.dirname(filePath);
      let resolvedPath = path.resolve(fileDir, importPath);
      
      if (!fs.existsSync(resolvedPath)) {
        if (fs.existsSync(resolvedPath + '.cjs')) {
          resolvedPath = resolvedPath + '.cjs';
        } else if (fs.existsSync(resolvedPath + '.js')) {
          resolvedPath = resolvedPath + '.js';
        }
      }
      
      if (fs.existsSync(resolvedPath)) {
        imports.push(resolvedPath);
        importedFiles.add(resolvedPath);
      }
    }
    
    return imports;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

// Main execution
console.log('🔍 Analyzing file usage in src/main...\n');

// Find all files
const files = findFiles(srcMainDir);
console.log(`📁 Found ${files.length} files\n`);

// Build import graph
files.forEach(file => {
  const imports = extractImports(file);
  fileImports.set(file, imports);
});

// Find unused files
const unusedFiles = [];
const entryPoint = path.join(srcMainDir, 'main.cjs');

files.forEach(file => {
  // Skip entry point
  if (file === entryPoint) {
    return;
  }
  
  // Check if file is imported by anyone
  if (!importedFiles.has(file)) {
    unusedFiles.push(file);
  }
});

// Categorize unused files
const categories = {
  handlers: [],
  services: [],
  windows: [],
  workers: [],
  utils: [],
  mcp: [],
  other: []
};

unusedFiles.forEach(file => {
  const relativePath = path.relative(srcMainDir, file);
  
  if (relativePath.startsWith('handlers/')) {
    categories.handlers.push(relativePath);
  } else if (relativePath.startsWith('services/mcp/')) {
    categories.mcp.push(relativePath);
  } else if (relativePath.startsWith('services/')) {
    categories.services.push(relativePath);
  } else if (relativePath.startsWith('windows/')) {
    categories.windows.push(relativePath);
  } else if (relativePath.startsWith('workers/')) {
    categories.workers.push(relativePath);
  } else if (relativePath.includes('utils')) {
    categories.utils.push(relativePath);
  } else {
    categories.other.push(relativePath);
  }
});

// Print results
console.log('📊 UNUSED FILES ANALYSIS\n');
console.log('=' .repeat(60));

let totalUnused = 0;

Object.entries(categories).forEach(([category, fileList]) => {
  if (fileList.length > 0) {
    console.log(`\n${category.toUpperCase()} (${fileList.length} files):`);
    console.log('-'.repeat(60));
    fileList.forEach(file => {
      console.log(`  ❌ ${file}`);
    });
    totalUnused += fileList.length;
  }
});

console.log('\n' + '='.repeat(60));
console.log(`\n📈 SUMMARY:`);
console.log(`   Total files: ${files.length}`);
console.log(`   Used files: ${files.length - totalUnused}`);
console.log(`   Unused files: ${totalUnused}`);
console.log(`   Usage rate: ${((files.length - totalUnused) / files.length * 100).toFixed(1)}%`);

// Save to file
const outputPath = path.join(__dirname, '../UNUSED_FILES.txt');
const output = unusedFiles.map(f => path.relative(srcMainDir, f)).join('\n');
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`\n💾 Unused files list saved to: UNUSED_FILES.txt`);
