#!/usr/bin/env ts-node

/**
 * Quick installation script for MCP
 * Installs only the MCP servers we know work correctly
 */

import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

// Only the servers we know are stable
const workingMcpServers = [
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-memory'
];

async function quickInstall() {
  console.log('🚀 Quick MCP installation for Ollama Chat\n');
  
  // 1. Install only working servers
  console.log('📦 Installing verified MCP servers...\n');
  
  for (const pkg of workingMcpServers) {
    try {
  console.log(`⬇️ Installing ${pkg}...`);
      execSync(`npm install -g ${pkg}`, { stdio: 'inherit' });
  console.log(`✅ ${pkg} installed\n`);
    } catch (error) {
  console.error(`❌ Error installing ${pkg}`);
    }
  }
  
  // 2. Create simplified configuration
  const quickConfig = {
    version: '1.0.0',
  description: 'Quick and functional MCP configuration',
    builtin_tools: {
      filesystem: {
        enabled: true,
  description: 'Built-in filesystem tools',
        tools: ['list_dir', 'read_file', 'write_file', 'path_info']
      }
    },
    working_servers: {
      'filesystem-external': {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
  description: 'External filesystem server',
        category: 'core',
        enabled: false,
  status: 'Requires npx available'
      },
      'memory': {
        type: 'stdio', 
        command: 'npx',
        args: ['@modelcontextprotocol/server-memory'],
  description: 'Persistent memory system',
        category: 'core',
        enabled: false,
  status: 'Requires npx available'
      }
    },
    setup_complete: true
  };
  
  await fs.writeFile(
    path.join(process.cwd(), 'mcp-quick-config.json'),
    JSON.stringify(quickConfig, null, 2)
  );
  
  // 3. Create .env file if missing
  const envPath = path.join(process.cwd(), '.env');
  try {
    await fs.access(envPath);
  console.log('.env file already exists');
  } catch {
    await fs.copyFile('.env.example', '.env');
  console.log('.env file created from template');
  }
  
  console.log('\n✨ Quick installation completed!');
  console.log('\n📋 Summary:');
  console.log('✅ Built-in tools: Filesystem (list_dir, read_file, write_file, path_info)');
  console.log('✅ Global servers: filesystem, memory');
  console.log('✅ Configuration file: mcp-quick-config.json');
  console.log('✅ Environment variables: .env');
  
  console.log('\n🎯 Next steps:');
  console.log('1. npm start - Launch the application');
  console.log('2. Go to the "Tools" tab in the app');
  console.log('3. Use the built-in tools (no extra setup required)');
  console.log('4. Optionally add external servers from the UI');
  
  console.log('\n💡 Tip: Built-in tools work immediately,');
  console.log('    external servers may require additional configuration.');
}

if (require.main === module) {
  quickInstall().catch(console.error);
}
