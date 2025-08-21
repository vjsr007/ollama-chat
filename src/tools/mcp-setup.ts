#!/usr/bin/env ts-node

/**
 * MCP Setup Tool
 * Configura servidores MCP comunes que usa Copilot
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

// Configuraciones de servidores MCP comunes
const commonMcpServers: McpServerConfig[] = [
  {
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
    description: 'Acceso seguro al sistema de archivos',
    category: 'core'
  },
  {
    name: 'brave-search',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-brave-search'],
    description: 'Búsqueda web con Brave Search API',
    category: 'search'
  },
  {
    name: 'github',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    description: 'Integración con GitHub (repos, issues, PRs)',
    category: 'development'
  },
  {
    name: 'postgres',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
    description: 'Conexión a bases de datos PostgreSQL',
    category: 'database'
  },
  {
    name: 'sqlite',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-sqlite'],
    description: 'Gestión de bases de datos SQLite',
    category: 'database'
  },
  {
    name: 'puppeteer',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer'],
    description: 'Automatización web con Puppeteer',
    category: 'automation'
  },
  {
    name: 'memory',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-memory'],
    description: 'Sistema de memoria persistente',
    category: 'core'
  },
  {
    name: 'docker',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-docker'],
    description: 'Gestión de contenedores Docker',
    category: 'infrastructure'
  },
  {
    name: 'fetch',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-fetch'],
    description: 'Cliente HTTP para APIs externas',
    category: 'network'
  },
  {
    name: 'git',
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-git'],
    description: 'Operaciones Git (status, commit, push)',
    category: 'development'
  }
];

// Paquetes npm MCP para instalar globalmente
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
  console.log('🔧 Instalando paquetes MCP globalmente...\n');
  
  for (const pkg of mcpPackages) {
    try {
      console.log(`📦 Instalando ${pkg}...`);
      execSync(`npm install -g ${pkg}`, { stdio: 'inherit' });
      console.log(`✅ ${pkg} instalado correctamente\n`);
    } catch (error) {
      console.error(`❌ Error instalando ${pkg}:`, error);
    }
  }
}

async function createMcpConfigFile() {
  const configPath = path.join(process.cwd(), 'mcp-servers.json');
  
  const config = {
    version: '1.0.0',
    description: 'Configuración de servidores MCP para Ollama Chat',
    servers: commonMcpServers.reduce((acc, server) => {
      acc[server.name] = {
        type: server.type,
        command: server.command,
        args: server.args,
        url: server.url,
        description: server.description,
        category: server.category,
        enabled: false // Por defecto deshabilitados
      };
      return acc;
    }, {} as Record<string, any>)
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(`📄 Archivo de configuración creado: ${configPath}`);
}

async function createEnvTemplate() {
  const envPath = path.join(process.cwd(), '.env.example');
  
  const envTemplate = `# Configuración para servidores MCP

# GitHub MCP Server
GITHUB_TOKEN=your_github_token_here

# Brave Search MCP Server  
BRAVE_API_KEY=your_brave_api_key_here

# PostgreSQL MCP Server
POSTGRES_CONNECTION_STRING=postgresql://user:password@localhost:5432/database

# Configuración general
MCP_LOG_LEVEL=info
MCP_TIMEOUT=30000
MCP_MAX_CONCURRENT_TOOLS=5
`;

  await fs.writeFile(envPath, envTemplate);
  console.log(`🔐 Plantilla de variables de entorno creada: ${envPath}`);
}

async function createMcpTestScript() {
  const testPath = path.join(__dirname, 'mcp-test.ts');
  
  const testScript = `#!/usr/bin/env ts-node

/**
 * MCP Test Tool
 * Prueba la conectividad con servidores MCP
 */

import { spawn } from 'child_process';

async function testMcpServer(name: string, command: string, args: string[]) {
  console.log(\`🧪 Probando servidor MCP: \${name}\`);
  
  try {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Enviar solicitud de inicialización
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
      }, 5000);
      
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0 || output.includes('jsonrpc')) {
          console.log(\`✅ \${name} responde correctamente\`);
          resolve(true);
        } else {
          console.log(\`❌ \${name} no responde (código: \${code})\`);
          resolve(false);
        }
      });
    });
    
  } catch (error) {
    console.error(\`❌ Error probando \${name}:\`, error);
    return false;
  }
}

async function main() {
  console.log('🔍 Probando servidores MCP disponibles...\\n');
  
  const servers = [
    { name: 'filesystem', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'] },
    { name: 'memory', command: 'npx', args: ['@modelcontextprotocol/server-memory'] },
    { name: 'fetch', command: 'npx', args: ['@modelcontextprotocol/server-fetch'] }
  ];
  
  for (const server of servers) {
    await testMcpServer(server.name, server.command, server.args);
    console.log();
  }
  
  console.log('✨ Pruebas completadas');
}

if (require.main === module) {
  main().catch(console.error);
}
`;

  await fs.writeFile(testPath, testScript);
  console.log(`🧪 Script de pruebas MCP creado: ${testPath}`);
}

async function main() {
  console.log('🚀 Configurando entorno MCP completo para Ollama Chat\n');
  
  try {
    // 1. Instalar paquetes MCP
    await installMcpPackages();
    
    // 2. Crear archivo de configuración
    await createMcpConfigFile();
    
    // 3. Crear plantilla de variables de entorno
    await createEnvTemplate();
    
    // 4. Crear script de pruebas
    await createMcpTestScript();
    
    console.log('\n✨ Configuración MCP completada!');
    console.log('\n📋 Próximos pasos:');
    console.log('1. Copia .env.example a .env y configura tus tokens');
    console.log('2. Ejecuta "npm run mcp:test" para probar la conectividad');
    console.log('3. Usa el archivo mcp-servers.json para configurar servidores');
    console.log('4. Inicia la aplicación con "npm start" y ve a la pestaña Tools');
    
  } catch (error) {
    console.error('❌ Error durante la configuración:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
