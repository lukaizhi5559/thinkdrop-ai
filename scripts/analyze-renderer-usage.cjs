#!/usr/bin/env node

/**
 * Analyze renderer file usage
 * Finds unused React components and other files
 */

const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '../src/renderer');
const allFiles = new Set();
const importedFiles = new Set();

// Recursively find all files
function findFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findFiles(filePath, fileList);
    } else if (file.match(/\.(tsx?|css|html)$/)) {
      fileList.push(filePath);
      allFiles.add(filePath);
    }
  });
  
  return fileList;
}

// Extract imports from a file
function extractImports(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const imports = [];
    
    // Match ES6 imports: import ... from './path'
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      
      // Skip node_modules and external packages
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        continue;
      }
      
      // Resolve relative path
      const fileDir = path.dirname(filePath);
      let resolvedPath = path.resolve(fileDir, importPath);
      
      // Try different extensions
      const extensions = ['.tsx', '.ts', '.css', '.html', ''];
      let found = false;
      
      for (const ext of extensions) {
        const testPath = resolvedPath + ext;
        if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
          imports.push(testPath);
          importedFiles.add(testPath);
          found = true;
          break;
        }
      }
      
      // Try index file
      if (!found) {
        const indexPath = path.join(resolvedPath, 'index.ts');
        if (fs.existsSync(indexPath)) {
          imports.push(indexPath);
          importedFiles.add(indexPath);
        }
      }
    }
    
    return imports;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

console.log('🔍 Analyzing renderer file usage...\n');

// Find all files
const files = findFiles(rendererDir);
console.log(`📁 Found ${files.length} files\n`);

// Build import graph
files.forEach(file => {
  extractImports(file);
});

// Entry points that are loaded directly
const entryPoints = [
  path.join(rendererDir, 'index.html'),
  path.join(rendererDir, 'fab.html'),
  path.join(rendererDir, 'src/main.tsx'),
  path.join(rendererDir, 'src/App.tsx'),
];

// Mark entry points as used
entryPoints.forEach(entry => {
  if (fs.existsSync(entry)) {
    importedFiles.add(entry);
  }
});

// Find unused files
const unusedFiles = [];
files.forEach(file => {
  if (!importedFiles.has(file)) {
    unusedFiles.push(file);
  }
});

// Categorize unused files
const categories = {
  components: [],
  richContent: [],
  contexts: [],
  hooks: [],
  services: [],
  types: [],
  ui: [],
  signals: [],
  other: []
};

unusedFiles.forEach(file => {
  const relativePath = path.relative(rendererDir, file);
  
  if (relativePath.includes('components/rich-content/')) {
    categories.richContent.push(relativePath);
  } else if (relativePath.includes('components/ui/')) {
    categories.ui.push(relativePath);
  } else if (relativePath.includes('components/')) {
    categories.components.push(relativePath);
  } else if (relativePath.includes('contexts/')) {
    categories.contexts.push(relativePath);
  } else if (relativePath.includes('hooks/')) {
    categories.hooks.push(relativePath);
  } else if (relativePath.includes('services/')) {
    categories.services.push(relativePath);
  } else if (relativePath.includes('types/')) {
    categories.types.push(relativePath);
  } else if (relativePath.includes('signals/')) {
    categories.signals.push(relativePath);
  } else {
    categories.other.push(relativePath);
  }
});

// Print results
console.log('📊 UNUSED FILES ANALYSIS\n');
console.log('='.repeat(80));

let totalUnused = 0;

Object.entries(categories).forEach(([category, fileList]) => {
  if (fileList.length > 0) {
    console.log(`\n${category.toUpperCase()} (${fileList.length} files):`);
    console.log('-'.repeat(80));
    fileList.forEach(file => {
      console.log(`  ❌ ${file}`);
    });
    totalUnused += fileList.length;
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📈 SUMMARY:`);
console.log(`   Total files: ${files.length}`);
console.log(`   Used files: ${files.length - totalUnused}`);
console.log(`   Unused files: ${totalUnused}`);
console.log(`   Usage rate: ${((files.length - totalUnused) / files.length * 100).toFixed(1)}%`);

// Save to file
const outputPath = path.join(__dirname, '../UNUSED_RENDERER_FILES.txt');
const output = unusedFiles.map(f => path.relative(rendererDir, f)).join('\n');
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`\n💾 Unused files list saved to: UNUSED_RENDERER_FILES.txt`);

// Also check for potentially deprecated components
console.log('\n\n🔍 POTENTIALLY DEPRECATED COMPONENTS:\n');
console.log('='.repeat(80));

const deprecatedPatterns = [
  'AgentWindow',
  'AgentStatusPanel',
  'OrchestrationDashboard',
  'WorkflowTraceViewer',
  'PipelineToggle',
  'LocalLLMContext',
  'InsightWindow'
];

const usedFiles = files.filter(f => importedFiles.has(f));
usedFiles.forEach(file => {
  const fileName = path.basename(file, path.extname(file));
  if (deprecatedPatterns.some(pattern => fileName.includes(pattern))) {
    const relativePath = path.relative(rendererDir, file);
    console.log(`⚠️  ${relativePath} - May be deprecated (check if MCP mode replaces this)`);
  }
});

console.log('\n' + '='.repeat(80));
