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
    description: 'Búsqueda web con Brave Search API',
    category: 'search',
    enabled: false
  },
  github: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    description: 'Integración con GitHub (repos, issues, PRs)',
    category: 'development',
    enabled: false
  },
  postgres: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
    description: 'Conexión a bases de datos PostgreSQL',
    category: 'database',
    enabled: false
  },
  sqlite: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-sqlite'],
    description: 'Gestión de bases de datos SQLite',
    category: 'database',
    enabled: false
  },
  puppeteer: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-puppeteer'],
    description: 'Automatización web con Puppeteer',
    category: 'automation',
    enabled: false
  },
  memory: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-memory'],
    description: 'Sistema de memoria persistente',
    category: 'core',
    enabled: false
  },
  docker: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-docker'],
    description: 'Gestión de contenedores Docker',
    category: 'infrastructure',
    enabled: false
  },
  fetch: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-fetch'],
    description: 'Cliente HTTP para APIs externas',
    category: 'network',
    enabled: false
  },
  git: {
    type: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-git'],
    description: 'Operaciones Git (status, commit, push)',
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
  process.stdout.write('🔍 Verificando instalación de Ollama... ');
  if (commandExists('ollama')) {
    console.log('ya instalado');
    return;
  }
  console.log('no encontrado, instalando...');

  try {
    if (process.platform === 'win32') {
      if (!commandExists('winget')) {
        console.error('❌ winget no está disponible. Instala Ollama manualmente desde https://ollama.com/download y vuelve a ejecutar este script.');
        return;
      }
      console.log('⬇️ Instalando Ollama con winget...');
      execSync('winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements', { stdio: 'inherit' });
    } else if (process.platform === 'darwin') {
      if (commandExists('brew')) {
        console.log('⬇️ Instalando Ollama con Homebrew...');
        execSync('brew install ollama', { stdio: 'inherit' });
      } else {
        console.log('⬇️ Instalando Ollama con script oficial (curl)...');
        execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit', shell: '/bin/bash' });
      }
    } else {
      console.log('⬇️ Instalando Ollama (Linux) con script oficial...');
      execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit', shell: '/bin/bash' });
    }
  } catch (e) {
    console.error('❌ Error instalando Ollama automáticamente. Instálalo manualmente y reintenta.', e);
  }
}

function ensureOllamaRunning() {
  try {
    execSync('ollama list', { stdio: 'ignore' });
    return; // Works
  } catch {
    console.log('💡 Iniciando servicio Ollama (background)...');
    try {
      if (process.platform === 'win32') {
        // Intento iniciar servicio Ollama (sin detached en spawnSync)
        spawnSync('ollama', ['serve'], { stdio: 'ignore' });
      } else {
        spawnSync('ollama', ['serve'], { stdio: 'ignore' });
      }
      // Small wait
      setTimeout(() => {/* no-op wait */}, 2000);
    } catch (e) {
      console.warn('⚠️ No se pudo iniciar Ollama automáticamente. Asegúrate de que esté ejecutándose.');
    }
  }
}

function ensureBaseModel() {
  const model = 'llama3.1:8b';
  process.stdout.write(`🔍 Verificando modelo base ${model}... `);
  let listOutput = '';
  try {
    listOutput = execSync('ollama list').toString();
  } catch (e) {
    console.warn('\n⚠️ No se pudo ejecutar "ollama list". ¿Está corriendo Ollama?');
    return;
  }
  if (listOutput.includes('llama3.1') || listOutput.includes('llama3.1:8b')) {
    console.log('ya presente');
    return;
  }
  console.log('no encontrado, descargando...');
  try {
    execSync(`ollama pull ${model}`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`❌ Error descargando modelo ${model}. Puedes intentar manualmente: ollama pull ${model}`);
  }
}

function installMcpPackages() {
  console.log('\n🔧 Instalando paquetes MCP globales (si faltan)...');
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
        console.log('ya instalado');
        continue;
      }
      execSync(`npm install -g ${pkg}`, { stdio: 'ignore' });
      console.log('OK');
    } catch (e) {
      console.log('FALLO');
    }
  }
}

async function writeMcpConfig() {
  const configPath = path.join(process.cwd(), 'mcp-servers.json');
  const config = {
    version: '1.0.0',
    description: 'Configuración de servidores MCP para Ollama Chat (generado por full-setup)',
    servers: mcpServers
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(`\n📄 Configuración MCP escrita: ${configPath}`);
}

async function ensureEnvExample() {
  const envExample = path.join(process.cwd(), '.env.example');
  try {
    await fs.access(envExample);
  } catch {
    const template = `# Variables de entorno para Ollama Chat\nOLLAMA_BASE_URL=http://localhost:11434\nBRAVE_API_KEY=your_brave_search_api_key\nGITHUB_TOKEN=your_github_token\nPOSTGRES_CONNECTION_STRING=postgresql://user:password@localhost:5432/database\nMCP_LOG_LEVEL=info\nMCP_TIMEOUT=300000\nMCP_MAX_CONCURRENT_TOOLS=5\n`;
    await fs.writeFile(envExample, template);
    console.log('🔐 .env.example creado');
  }
}

async function main() {
  console.log('🚀 Full Setup: Ollama + Modelo Base + MCP Servers\n');
  installOllamaIfNeeded();
  ensureOllamaRunning();
  ensureBaseModel();
  installMcpPackages();
  await writeMcpConfig();
  await ensureEnvExample();

  console.log('\n✅ Setup completo finalizado');
  console.log('\n📌 Siguientes pasos sugeridos:');
  console.log('  1. Copia .env.example a .env y completa los tokens necesarios');
  console.log('  2. Ejecuta: npm run dev   (modo desarrollo)');
  console.log('     o      : npm start     (después de build)');
  console.log('  3. Activa/enabled los servidores MCP que quieras desde la UI Tools');
  console.log('  4. Envía un mensaje al modelo para probar tools con llama3.1:8b');
  console.log('\n🔍 Verificación manual rápida (opcional):');
  console.log('   ollama list            # Debe mostrar llama3.1:8b');
  console.log('   npm list -g | findstr "@modelcontextprotocol/server-filesystem"');
  console.log('\n✨ ¡Listo!');
}

if (require.main === module) {
  main().catch(e => {
    console.error('❌ Error en full-setup:', e);
    process.exit(1);
  });
}
