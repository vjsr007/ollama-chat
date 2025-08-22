#!/usr/bin/env ts-node
/**
 * Full Environment Setup for Ollama Chat
 *
 * What it does:
 *  1. Detects platform & installs Ollama if missing
 *  2. Ensures Ollama service is running
 *  3. Pulls at least the base model: llama3.1:8b (skips if already present)
 *  4. Installs common MCP server packages globally (same list as mcp-setup)
 *  5. Generates / refreshes mcp-servers.json & .env.example if missing
 *  6. Prints concise next steps
 *
 * Cross‑platform notes:
 *  - Windows: uses winget (requires it to be available). If not present, instructs manual install.
 *  - macOS: uses brew if available, else curl installer.
 *  - Linux: uses curl installer.
 *  - Global npm installs may need elevated privileges depending on user setup (nvm recommended).
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

interface McpServerConfigEntry {
  type: 'stdio' | 'ws' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  description: string;
  category: string;
  enabled: boolean;
}

const mcpPackages = [
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-sqlite',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-docker',
  '@modelcontextprotocol/server-fetch',
  '@modelcontextprotocol/server-git'
];

const mcpServers: Record<string, McpServerConfigEntry> = {
  filesystem: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
    description: 'Secure file system access',
    category: 'core',
    enabled: false
  },
  'brave-search': {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-brave-search'],
  description: 'Web search using Brave Search API',
    category: 'search',
    enabled: false
  },
  github: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
  description: 'GitHub integration (repos, issues, PRs)',
    category: 'development',
    enabled: false
  },
  postgres: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
  description: 'PostgreSQL database connection',
    category: 'database',
    enabled: false
  },
  sqlite: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-sqlite'],
  description: 'SQLite database management',
    category: 'database',
    enabled: false
  },
  puppeteer: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer'],
  description: 'Web automation with Puppeteer',
    category: 'automation',
    enabled: false
  },
  memory: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-memory'],
  description: 'Persistent memory system',
    category: 'core',
    enabled: false
  },
  docker: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-docker'],
  description: 'Docker container management',
    category: 'infrastructure',
    enabled: false
  },
  fetch: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-fetch'],
  description: 'HTTP client for external APIs',
    category: 'network',
    enabled: false
  },
  git: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-git'],
  description: 'Git operations (status, commit, push)',
    category: 'development',
    enabled: false
  }
};

function commandExists(cmd: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore' });
    } else {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function installOllamaIfNeeded() {
  process.stdout.write('🔍 Checking Ollama installation... ');
  if (commandExists('ollama')) {
  console.log('already installed');
    return;
  }
  console.log('not found, installing...');

  try {
    if (process.platform === 'win32') {
      if (!commandExists('winget')) {
  console.error('❌ winget is not available. Install Ollama manually from https://ollama.com/download and re-run this script.');
        return;
      }
  console.log('⬇️ Installing Ollama with winget...');
      execSync('winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements', { stdio: 'inherit' });
    } else if (process.platform === 'darwin') {
      if (commandExists('brew')) {
  console.log('⬇️ Installing Ollama with Homebrew...');
        execSync('brew install ollama', { stdio: 'inherit' });
      } else {
  console.log('⬇️ Installing Ollama using official script (curl)...');
        execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit', shell: '/bin/bash' });
      }
    } else {
  console.log('⬇️ Installing Ollama (Linux) using official script...');
      execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit', shell: '/bin/bash' });
    }
  } catch (e) {
  console.error('❌ Error installing Ollama automatically. Install it manually and retry.', e);
  }
}

function ensureOllamaRunning() {
  try {
    execSync('ollama list', { stdio: 'ignore' });
    return; // Works
  } catch {
  console.log('💡 Starting Ollama service (background)...');
    try {
      if (process.platform === 'win32') {
  // Attempt to start Ollama service (no detached in spawnSync)
        spawnSync('ollama', ['serve'], { stdio: 'ignore' });
      } else {
        spawnSync('ollama', ['serve'], { stdio: 'ignore' });
      }
      // Small wait
      setTimeout(() => {/* no-op wait */}, 2000);
    } catch (e) {
  console.warn('⚠️ Could not start Ollama automatically. Ensure it is running.');
    }
  }
}

function ensureBaseModel() {
  const model = 'llama3.1:8b';
  process.stdout.write(`🔍 Checking base model ${model}... `);
  let listOutput = '';
  try {
    listOutput = execSync('ollama list').toString();
  } catch (e) {
  console.warn('\n⚠️ Could not run "ollama list". Is Ollama running?');
    return;
  }
  if (listOutput.includes('llama3.1') || listOutput.includes('llama3.1:8b')) {
  console.log('already present');
    return;
  }
  console.log('not found, pulling...');
  try {
    execSync(`ollama pull ${model}`, { stdio: 'inherit' });
  } catch (e) {
  console.error(`❌ Error pulling model ${model}. You can try manually: ollama pull ${model}`);
  }
}

function installMcpPackages() {
  console.log('\n🔧 Installing global MCP packages (if missing)...');
  for (const pkg of mcpPackages) {
    try {
      process.stdout.write(`  • ${pkg} ... `);
      // Quick presence check: npm list -g --depth=0 pkg
      let already = false;
      try {
        execSync(`npm list -g --depth=0 ${pkg}`, { stdio: 'ignore' });
        already = true;
      } catch { /* not installed */ }
      if (already) {
  console.log('already installed');
        continue;
      }
      execSync(`npm install -g ${pkg}`, { stdio: 'ignore' });
      console.log('OK');
    } catch (e) {
  console.log('FAILED');
    }
  }
}

async function writeMcpConfig() {
  const configPath = path.join(process.cwd(), 'mcp-servers.json');
  const config = {
    version: '1.0.0',
  description: 'MCP server configuration for Ollama Chat (generated by full-setup)',
    servers: mcpServers
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(`\n📄 MCP configuration written: ${configPath}`);
}

async function ensureEnvExample() {
  const envExample = path.join(process.cwd(), '.env.example');
  try {
    await fs.access(envExample);
  } catch {
  const template = `# Environment variables for Ollama Chat\nOLLAMA_BASE_URL=http://localhost:11434\nBRAVE_API_KEY=your_brave_search_api_key\nGITHUB_TOKEN=your_github_token\nPOSTGRES_CONNECTION_STRING=postgresql://user:password@localhost:5432/database\nMCP_LOG_LEVEL=info\nMCP_TIMEOUT=300000\nMCP_MAX_CONCURRENT_TOOLS=5\n`;
    await fs.writeFile(envExample, template);
  console.log('🔐 .env.example created');
  }
}

async function main() {
  console.log('🚀 Full Setup: Ollama + Base Model + MCP Servers\n');
  installOllamaIfNeeded();
  ensureOllamaRunning();
  ensureBaseModel();
  installMcpPackages();
  await writeMcpConfig();
  await ensureEnvExample();

  console.log('\n✅ Setup completed');
  console.log('\n📌 Suggested next steps:');
  console.log('  1. Copy .env.example to .env and fill in required tokens');
  console.log('  2. Run: npm run dev   (development mode)');
  console.log('     or : npm start     (after build)');
  console.log('  3. Enable the MCP servers you want from the Tools UI');
  console.log('  4. Send a message to the model to test tools with llama3.1:8b');
  console.log('\n🔍 Quick manual verification (optional):');
  console.log('   ollama list            # Should show llama3.1:8b');
  console.log('   npm list -g | findstr "@modelcontextprotocol/server-filesystem"');
  console.log('\n✨ Done!');
}

if (require.main === module) {
  main().catch(e => {
  console.error('❌ Error in full-setup:', e);
    process.exit(1);
  });
}
