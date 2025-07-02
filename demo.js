#!/usr/bin/env node

/**
 * Thinkdrop AI Demo Launcher
 * Quick test script to launch the overlay and test functionality
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧠 Thinkdrop AI - Demo Launcher');
console.log('==============================\n');

console.log('🚀 Starting development servers...\n');

// Start Vite dev server
console.log('📦 Starting React frontend...');
const viteProcess = spawn('npm', ['run', 'dev:renderer'], {
  stdio: 'pipe',
  cwd: __dirname
});

viteProcess.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes('ready in')) {
    console.log('✅ Frontend ready at http://localhost:5173');
    
    // Wait a moment then start Electron
    setTimeout(() => {
      console.log('\n🖥️  Starting Electron overlay...');
      const electronProcess = spawn('npm', ['run', 'dev:main'], {
        stdio: 'inherit',
        cwd: __dirname
      });
      
      electronProcess.on('close', (code) => {
        console.log(`\n🛑 Electron process exited with code ${code}`);
        viteProcess.kill();
        process.exit(code);
      });
      
    }, 2000);
  }
});

viteProcess.stderr.on('data', (data) => {
  console.log('Frontend:', data.toString());
});

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  viteProcess.kill();
  process.exit(0);
});

console.log('\n💡 Instructions:');
console.log('   • Press Cmd+Shift+Space to toggle overlay');
console.log('   • Click "Start" in overlay to begin listening');
console.log('   • Press Ctrl+C to quit\n');
