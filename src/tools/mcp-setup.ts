#!/usr/bin/env ts-node

/**
 * MCP Setup Tool
 * Configures common MCP servers used by Copilot
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

interface McpServerConfig {
  name: string;
  type: 'stdio' | 'ws' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  description: string;
  category: string;
}

// Common MCP server configurations
const commonMcpServers: McpServerConfig[] = [
  {
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
    description: 'Secure file system access',
    category: 'core'
  },
  {
    name: 'brave-search',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-brave-search'],
  description: 'Web search using Brave Search API',
    category: 'search'
  },
  {
    name: 'github',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
  description: 'GitHub integration (repos, issues, PRs)',
    category: 'development'
  },
  {
    name: 'postgres',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
  description: 'PostgreSQL database connection',
    category: 'database'
  },
  {
    name: 'sqlite',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-sqlite'],
  description: 'SQLite database management',
    category: 'database'
  },
  {
    name: 'puppeteer',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer'],
  description: 'Web automation with Puppeteer',
    category: 'automation'
  },
  {
    name: 'memory',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-memory'],
  description: 'Persistent memory system',
    category: 'core'
  },
  {
    name: 'docker',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-docker'],
  description: 'Docker container management',
    category: 'infrastructure'
  },
  {
    name: 'fetch',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-fetch'],
  description: 'HTTP client for external APIs',
    category: 'network'
  },
  {
    name: 'git',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-git'],
  description: 'Git operations (status, commit, push)',
    category: 'development'
  }
];

// MCP npm packages to install globally
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

async function installMcpPackages() {
  console.log('🔧 Installing MCP packages globally...\n');
  
  for (const pkg of mcpPackages) {
    try {
  console.log(`📦 Installing ${pkg}...`);
      execSync(`npm install -g ${pkg}`, { stdio: 'inherit' });
  console.log(`✅ ${pkg} installed successfully\n`);
    } catch (error) {
  console.error(`❌ Error installing ${pkg}:`, error);
    }
  }
}

async function createMcpConfigFile() {
  const configPath = path.join(process.cwd(), 'mcp-servers.json');
  
  const config = {
    version: '1.0.0',
  description: 'MCP server configuration for Ollama Chat',
    servers: commonMcpServers.reduce((acc, server) => {
      acc[server.name] = {
        type: server.type,
        command: server.command,
        args: server.args,
        url: server.url,
        description: server.description,
        category: server.category,
  enabled: false // Disabled by default
      };
      return acc;
    }, {} as Record<string, any>)
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(`📄 Configuration file created: ${configPath}`);
}

async function createEnvTemplate() {
  const envPath = path.join(process.cwd(), '.env.example');
  
  const envTemplate = `# Configuration for MCP servers

# GitHub MCP Server
GITHUB_TOKEN=your_github_token_here

# Brave Search MCP Server  
BRAVE_API_KEY=your_brave_api_key_here

# PostgreSQL MCP Server
POSTGRES_CONNECTION_STRING=postgresql://user:password@localhost:5432/database

# General configuration
MCP_LOG_LEVEL=info
MCP_TIMEOUT=300000
MCP_MAX_CONCURRENT_TOOLS=5
`;

  await fs.writeFile(envPath, envTemplate);
  console.log(`🔐 Environment variables template created: ${envPath}`);
}

async function createMcpTestScript() {
  const testPath = path.join(__dirname, 'mcp-test.ts');
  
  const testScript = `#!/usr/bin/env ts-node

/**
 * MCP Test Tool
 * Tests connectivity with MCP servers
 */
   * Tests connectivity with MCP servers

import { spawn } from 'child_process';

async function testMcpServer(name: string, command: string, args: string[]) {
  console.log(\`🧪 Testing MCP server: \${name}\`);
  
  try {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
  // Send initialization request
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'ollama-chat-test',
          version: '0.1.0'
        }
      }
    };
    
    child.stdin.write(JSON.stringify(initRequest) + '\\n');
    
    return new Promise((resolve, reject) => {
      let output = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        console.error(\`Error from \${name}:\`, data.toString());
      });
      
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Timeout'));
      }, 300000);
      
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0 || output.includes('jsonrpc')) {
          console.log(\`✅ \${name} responds correctly\`);
          resolve(true);
        } else {
          console.log(\`❌ \${name} not responding (code: \${code})\`);
          resolve(false);
        }
      });
    });
    
  } catch (error) {
  console.error(\`❌ Error testing \${name}:\`, error);
    return false;
  }
}

async function main() {
  console.log('🔍 Testing available MCP servers...\\n');
  
  const servers = [
    { name: 'filesystem', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'] },
    { name: 'memory', command: 'npx', args: ['@modelcontextprotocol/server-memory'] },
    { name: 'fetch', command: 'npx', args: ['@modelcontextprotocol/server-fetch'] }
  ];
  
  for (const server of servers) {
    await testMcpServer(server.name, server.command, server.args);
    console.log();
  }
  
  console.log('✨ Tests completed');
}

if (require.main === module) {
  main().catch(console.error);
}
`;

  await fs.writeFile(testPath, testScript);
  console.log(`🧪 MCP test script created: ${testPath}`);
}

async function main() {
  console.log('🚀 Setting up full MCP environment for Ollama Chat\n');
  
  try {
  // 1. Install MCP packages
    await installMcpPackages();
    
  // 2. Create configuration file
    await createMcpConfigFile();
    
  // 3. Create environment variables template
    await createEnvTemplate();
    
  // 4. Create test script
    await createMcpTestScript();
    
  console.log('\n✨ MCP setup completed!');
  console.log('\n📋 Next steps:');
  console.log('1. Copy .env.example to .env and configure your tokens');
  console.log('2. Run "npm run mcp:test" to test connectivity');
  console.log('3. Use the mcp-servers.json file to configure servers');
  console.log('4. Start the app with "npm start" and open the Tools tab');
    
  } catch (error) {
  console.error('❌ Error during setup:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
