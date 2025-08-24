import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { McpManager } from '../shared/infrastructure/mcp/McpManager';
import { mcpSecretStore } from './mcp-secrets';
import ToolConfigManager from './tool-config';
import { ExternalModelManager } from './external-models';
import dotenv from 'dotenv';

// Load environment variables from .env (if present) BEFORE anything else uses process.env
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const result = dotenv.config({ path: envPath });
    if (result.error) {
      console.warn('⚠️ No se pudo cargar .env:', result.error.message);
    } else {
      console.log('✅ Archivo .env cargado');
    }
  } else {
    console.log('ℹ️ No se encontró archivo .env en', envPath);
  }
} catch (e) {
  console.warn('⚠️ Error al intentar cargar .env:', e instanceof Error ? e.message : e);
}
// Simple debug (sin exponer valor completo) para BRAVE_API_KEY
if (process.env.BRAVE_API_KEY) {
  console.log('🔐 BRAVE_API_KEY detectada (longitud:', process.env.BRAVE_API_KEY.length, ')');
} else {
  console.log('🔎 BRAVE_API_KEY no definida en entorno');
}

console.log('🚀 Electron main process starting...');
console.log('📂 Process working directory:', process.cwd());
console.log('📂 __dirname:', __dirname);

// Dynamic resolution of OllamaClient considering different build structures
let OllamaClientMod: any;
const candidatePaths = [
  // Running from project root after build (electron .)
  path.join(process.cwd(), 'dist/shared/infrastructure/ollama/OllamaClient.js'),
  // Relative to compiled file (dist/main/main/electron-main.js -> ../../shared/...)
  path.join(__dirname, '../../shared/infrastructure/ollama/OllamaClient.js'),
  // Fallback to source code (dev)
  path.join(process.cwd(), 'src/shared/infrastructure/ollama/OllamaClient.ts')
];

console.log('🔍 Searching for OllamaClient module...');
for (const p of candidatePaths) {
  try {
    console.log('📝 Trying path:', p);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    OllamaClientMod = require(p);
    console.log('✅ Found OllamaClient at:', p);
    break;
  } catch (error) {
    console.log('❌ Module not found at:', p);
  }
}

if (!OllamaClientMod) {
  console.error('💥 Critical Error: OllamaClient module not found in any of the candidate paths');
  process.exit(1);
}

const { OllamaClient } = OllamaClientMod;
console.log('🎯 OllamaClient successfully imported');

// Simple in-memory log ring buffer for viewer
interface LogEntry { ts: number; level: string; msg: string; }
const LOG_BUFFER_MAX = 2000;
const logBuffer: LogEntry[] = [];
const pushLog = (level: string, ...parts: any[]) => {
  try {
    const msg = parts.map(p => typeof p === 'string' ? p : (() => { try { return JSON.stringify(p); } catch { return String(p); } })()).join(' ');
    logBuffer.push({ ts: Date.now(), level, msg });
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
  } catch { /* ignore */ }
};
// Patch console methods to also feed buffer (non-destructive)
(['log','info','warn','error'] as const).forEach(l => {
  const orig = (console as any)[l];
  (console as any)[l] = (...args: any[]) => { pushLog(l, ...args); orig.apply(console, args); };
});

// Global instances
let mainWindow: BrowserWindow | null = null;
const ollamaClient = new OllamaClient();
const mcpManager = new McpManager();
const toolConfigManager = new ToolConfigManager();
const externalModelManager = new ExternalModelManager();

// Track last exported listing path for quick open
let lastExportedListingPath: string | null = null;

console.log('🏗️ Creating global instances completed');

// Bridge MCP manager events to renderer for real-time tool/server updates
function setupMcpEventBridges() {
  const forwardTools = (reason: string) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const tools = mcpManager.getAllTools();
        mainWindow.webContents.send('mcp:tools-updated', { reason, toolsCount: tools.length, tools });
      }
    } catch (e) {
      console.warn('⚠️ Failed forwarding tools update', e);
    }
  };
  mcpManager.on('tools-updated', () => forwardTools('tools-updated'));
  mcpManager.on('server-ready', () => forwardTools('server-ready'));
  mcpManager.on('server-stopped', () => forwardTools('server-stopped'));
  mcpManager.on('server-error', () => forwardTools('server-error'));
}
setupMcpEventBridges();

function createWindow(): void {
  console.log('🪟 Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload/preload/preload.js'),
    },
  });

  console.log('📱 Main window created with dimensions: 1200x800');

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    console.log('🔧 Development mode detected, loading from Vite dev server');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    console.log('🏭 Production mode, loading from built files');
    const rendererPath = path.join(__dirname, '../../renderer/index.html');
    console.log('📂 Loading renderer from:', rendererPath);
    mainWindow.loadFile(rendererPath);
  }

  console.log('✅ Window content loaded successfully');

  mainWindow.on('closed', () => {
    console.log('❌ Main window closed');
    mainWindow = null;
  });
}

// IPC Handlers with comprehensive logging
console.log('📡 Setting up IPC handlers...');

// Chat request handler
ipcMain.handle('chat', async (event, request) => {
  console.log('📨 Main: Received chat request from renderer');
  console.log('🤖 Main: Request model:', request.model);
  console.log('💬 Main: Request messages count:', request.messages?.length || 0);
  
  try {
    // Quick intent intercept: open last exported file
    const lastUserMsg = [...(request.messages||[])].reverse().find(m => m.role === 'user');
    const userText = (lastUserMsg?.content || '').trim().toLowerCase();
    if (lastExportedListingPath && userText && (/^abrir archivo$/.test(userText) || /^open file$/.test(userText))) {
      console.log('⚡ Intercept: open last exported listing file:', lastExportedListingPath);
      const result = await shell.openPath(lastExportedListingPath);
      if (result) {
        // Non-empty string = error per Electron docs
        return `❌ No se pudo abrir el archivo: ${result}`;
      }
      return `Abierto: ${lastExportedListingPath}`;
    }
    // Get all available tools
    const allTools = mcpManager.getAllTools();
    console.log('🛠️ Main: All available tools:', allTools.length);
    
    // Get tool names for filtering
    const toolNames = allTools.map(tool => tool.name);
    
    // Filter tools by model config
    const enabledToolNames = toolConfigManager.getEnabledToolsForModel(request.model, toolNames);
    const enabledTools = allTools.filter(tool => enabledToolNames.includes(tool.name));
    console.log('✅ Main: Enabled tools for model:', enabledTools.length);
    console.log('🎯 Main: Terminal tools prioritized and filtered by model configuration');

    // Add tools to request
    console.log('🎯 Tools available:', allTools.length, 'sending to Ollama:', enabledTools.length, '(max: 25)');

    // Generate response (may include direct tool call shortcut)
    const result = await ollamaClient.generate(request, enabledTools);
    console.log('📈 Main: Generated result:', {
      needsToolExecution: result.needsToolExecution,
      toolCalls: result.toolCalls?.length || 0,
      content: result.content?.substring(0, 100) + (result.content?.length > 100 ? '...' : '')
    });

    // Execute tool calls if needed (including direct auto-detected export call where content may be empty)
    if (result.needsToolExecution && result.toolCalls) {
      console.log('🔧 Main: Executing tool calls:', result.toolCalls.length);
      
      const toolResults = [];
      for (const toolCall of result.toolCalls) {
        try {
          console.log('🛠️ Main: Executing tool', toolCall.function.name, 'with args:', JSON.stringify(toolCall.function.arguments));
          if (toolCall.function.name === 'system_export_directory_listing') {
            const outPath = toolCall.function.arguments.output_path || toolCall.function.arguments.output_file_path || toolCall.function.arguments.destination_path || toolCall.function.arguments.dest_path || toolCall.function.arguments.target_path;
            if (outPath) {
              lastExportedListingPath = outPath;
              console.log('💾 Stored lastExportedListingPath =', lastExportedListingPath);
            }
          }
          const toolResult = await mcpManager.callTool({
            tool: toolCall.function.name,
            args: toolCall.function.arguments,
            serverId: undefined // Let MCP manager find the appropriate server
          });
          toolResults.push({
            role: 'tool',
            content: JSON.stringify(toolResult)
          });
          console.log('✅ Main: Tool', toolCall.function.name, 'executed successfully');
        } catch (error) {
          console.error('❌ Main: Error executing tool', toolCall.function.name, ':', error);
          toolResults.push({
            role: 'tool',
            content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
          });
        }
      }

      // If original content is empty (direct tool call optimization), just return a concise success message from first tool
      if (!result.content && toolResults.length === 1) {
        try {
          const parsed = JSON.parse(toolResults[0].content);
          // Attempt to extract text from MCP content structure
          const innerText = parsed?.result?.content?.[0]?.text || parsed?.content?.[0]?.text || JSON.stringify(parsed).slice(0,200);
          return innerText || 'Tool executed.';
        } catch {
          return 'Tool executed.';
        }
      }

      // Otherwise continue conversation: add tool results then re-query model
      const newMessages = [...request.messages, { role: 'assistant', content: result.content || '' }, ...toolResults];
      console.log('📨 Main: Sending follow-up request with tool results');
      const finalRequest = { ...request, messages: newMessages };
      const finalResult = await ollamaClient.generate(finalRequest, enabledTools);
      console.log('🎉 Main: Final response generated successfully');
      return finalResult.content || '';
    }
    // If no tool execution and content empty, create explicit placeholder to avoid UI generic empty warning
    if (!result.content || !result.content.trim()) {
      return '⚠️ (Modelo devolvió contenido vacío tras generación sin tools)';
    }
    return result.content;
  } catch (error) {
    console.error('💥 Main: Error executing tools:', error);
    throw error;
  }
});

// Get available models handler
ipcMain.handle('get-models', async () => {
  console.log('📋 Main: Fetching available models...');
  try {
    const models = await ollamaClient.listModels();
    console.log('✅ Main: Retrieved', models.length, 'models successfully');
    return models;
  } catch (error) {
    console.error('❌ Main: Error fetching models:', error);
    throw error;
  }
});

// Additional handlers for preload compatibility
ipcMain.handle('models:list', async () => {
  console.log('📋 Main: Fetching models (compatibility handler)...');
  try {
    const models = await ollamaClient.listModels();
    console.log('✅ Main: Retrieved', models.length, 'models successfully');
    return models;
  } catch (error) {
    console.error('❌ Main: Error fetching models:', error);
    throw error;
  }
});

ipcMain.handle('chat:send', async (event, request) => {
  console.log('📨 Main: Chat send (compatibility handler)');
  console.log('🤖 Main: Request model:', request.model);
  console.log('💬 Main: Request messages count:', request.messages?.length || 0);
  
  try {
    // Get all available tools
    const allTools = mcpManager.getAllTools();
    console.log('🛠️ Main: All available tools:', allTools.length);
    
    // Get tool names for filtering
    const toolNames = allTools.map(tool => tool.name);
    
    // Filter tools by model config
    const enabledToolNames = toolConfigManager.getEnabledToolsForModel(request.model, toolNames);
    const enabledTools = allTools.filter(tool => enabledToolNames.includes(tool.name));
    console.log('✅ Main: Enabled tools for model:', enabledTools.length);

    // Generate response
    const result = await ollamaClient.generate(request, enabledTools);

    // Execute tool calls if needed
    if (result.needsToolExecution && result.toolCalls) {
      console.log('🔧 Main: Executing tool calls:', result.toolCalls.length);
      
      const toolResults = [];
      for (const toolCall of result.toolCalls) {
        try {
          const toolResult = await mcpManager.callTool({
            tool: toolCall.function.name,
            args: toolCall.function.arguments,
            serverId: undefined // Let MCP manager find the appropriate server
          });
          toolResults.push({
            role: 'tool',
            content: JSON.stringify(toolResult)
          });
        } catch (error) {
          toolResults.push({
            role: 'tool',
            content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
          });
        }
      }

      // Generate final response
      const newMessages = [...request.messages, { role: 'assistant', content: result.content }, ...toolResults];
      const finalRequest = { ...request, messages: newMessages };
      const finalResult = await ollamaClient.generate(finalRequest, enabledTools);
      return finalResult.content || '';
    }

    return result.content || '';
  } catch (error) {
    console.error('💥 Main: Error in chat:send handler:', error);
    throw error;
  }
});

// Get available tools handler
ipcMain.handle('get-tools', async () => {
  console.log('🛠️ Main: Fetching available tools...');
  try {
    const tools = await mcpManager.getAllTools();
    console.log('✅ Main: Retrieved', tools.length, 'tools successfully');
    return tools;
  } catch (error) {
    console.error('❌ Main: Error fetching tools:', error);
    throw error;
  }
});

// MCP compatibility handlers
ipcMain.handle('mcp:get-tools', async () => {
  console.log('🛠️ Main: Fetching MCP tools (compatibility)...');
  try {
    const tools = mcpManager.getAllTools();
    console.log('✅ Main: Retrieved', tools.length, 'MCP tools successfully');
    return tools;
  } catch (error) {
    console.error('❌ Main: Error fetching MCP tools:', error);
    throw error;
  }
});

// Utility to collect MCP package names from config (npx servers)
function gatherMcpPackages(): string[] {
  try {
    const cfgPath = path.join(process.cwd(), 'mcp-servers.json');
    if (!fs.existsSync(cfgPath)) return [];
    const raw = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
    const servers = raw.servers || {};
    const pkgs = new Set<string>();
    for (const key of Object.keys(servers)) {
      const s = servers[key];
      if (s?.command === 'npx' && Array.isArray(s.args) && s.args[0]?.startsWith('@modelcontextprotocol/')) {
        pkgs.add(s.args[0]);
      }
    }
    return Array.from(pkgs);
  } catch { return []; }
}

// Infer implicit dependencies for non-npx local integration servers.
// This lets the dependency checker show something meaningful for servers that
// run local scripts (e.g. Playwright) but still require certain npm packages.
function inferImplicitDeps(server: any): string[] {
  const out = new Set<string>();
  // 1. Explicit declarations in config (prefer explicit over heuristics)
  const explicitArrays = [server.dependencies, server.deps, server.requiredPackages];
  for (const arr of explicitArrays) {
    if (Array.isArray(arr)) arr.forEach((p: any) => { if (typeof p === 'string' && p.trim()) out.add(p.trim()); });
  }
  // 2. Heuristics (only add if not already declared)
  const id = (server.id || '').toLowerCase();
  const name = (server.name || '').toLowerCase();
  const cmd = (server.command || '').toLowerCase();
  const argsJoined = Array.isArray(server.args) ? server.args.join(' ').toLowerCase() : '';
  // Playwright
  if ([id,name,cmd,argsJoined].some(s => s.includes('playwright'))) out.add('playwright');
  // Puppeteer
  if ([id,name,cmd,argsJoined].some(s => s.includes('puppeteer'))) out.add('puppeteer');
  // Axios or node-fetch usage hints (very light heuristic)
  if (name.includes('fetch') || id.includes('fetch')) out.add('node-fetch');
  // Add more domain specific heuristics here if needed
  return Array.from(out);
}

// Get metadata about a specific MCP server (safe subset)
ipcMain.handle('mcp:get-server-metadata', async (_e, id: string) => {
  try {
    const internalMap: Map<string, any> = (mcpManager as any).servers;
    const state = internalMap.get(id);
    if (!state) return { success: false, error: 'Server not found' };
    const cfg = state.config;
    const server: any = {
      id: cfg.id,
      name: cfg.name,
      type: cfg.type,
      status: state.status,
      command: cfg.command,
      args: cfg.args,
      enabled: cfg.enabled,
      category: cfg.category,
      priority: cfg.priority,
      toolCount: (state.tools || []).length,
      tools: (state.tools || []).map((t: any) => t.name),
      envKeys: cfg.env ? Object.keys(cfg.env) : [],
      secretEnvKeys: cfg.secretEnvKeys || [],
      hasSecrets: (cfg.secretEnvKeys || []).length > 0,
      pid: state.process?.pid || null,
    };
    // Detect package if npx pattern
    let pkg: string | null = null;
    if (cfg.command === 'npx' && Array.isArray(cfg.args) && cfg.args[0]) pkg = cfg.args[0];
    if (pkg) {
      const pkgPath = path.join(process.cwd(), 'node_modules', pkg, 'package.json');
      server.package = pkg;
      server.packageInstalled = fs.existsSync(pkgPath);
      if (server.packageInstalled) {
        try { server.packageVersion = JSON.parse(fs.readFileSync(pkgPath,'utf8')).version; } catch {/* ignore */}
      }
    }
    // Include declared/implicit dependencies for local/integration servers
    const inferred = inferImplicitDeps(cfg);
    if (inferred.length) {
      server.dependencies = inferred.map(dep => {
        const depPath = path.join(process.cwd(), 'node_modules', dep, 'package.json');
        if (fs.existsSync(depPath)) {
          try {
            const v = JSON.parse(fs.readFileSync(depPath,'utf8')).version;
            return { name: dep, installed: true, version: v };
          } catch {
            return { name: dep, installed: true };
          }
        }
        return { name: dep, installed: false };
      });
      // Backward compatibility (old field name used previously in UI code before generalization)
      server.implicitDependencies = server.dependencies;
    }
    return { success: true, metadata: server };
  } catch (e:any) {
    return { success: false, error: e.message || String(e) };
  }
});

// Check dependencies (package) for a specific server
ipcMain.handle('mcp:check-server-deps', async (_e, id: string) => {
  try {
    const servers = mcpManager.getServers();
    const s = servers.find(sv => sv.id === id);
    if (!s) return { success: false, error: 'Server not found' };
    // Case 1: npx based official MCP package
    if (s.command === 'npx' && s.args && s.args[0] && s.args[0].startsWith('@modelcontextprotocol/')) {
      const pkg = s.args[0];
      const { spawn } = require('child_process');
      const result = await new Promise(resolve => {
        const child = spawn('npm', ['view', pkg, 'version'], { stdio: ['ignore','pipe','pipe'] });
        let out=''; let err='';
        child.stdout.on('data', (d:Buffer)=> out+=d.toString());
        child.stderr.on('data', (d:Buffer)=> err+=d.toString());
        child.on('exit', (code:number|null) => {
          if (code === 0) resolve({ id: s.id, package: pkg, status: 'installed', version: out.trim() });
          else resolve({ id: s.id, package: pkg, status: 'missing', error: err.trim() });
        });
        child.on('error', (e:Error) => resolve({ id: s.id, package: pkg, status: 'error', error: e.message }));
      });
      return { success: true, results: [result] };
    }
    // Case 2: declared/implicit local dependencies
    const declared = inferImplicitDeps(s);
    if (declared.length) {
      const results = declared.map(dep => {
        const depPath = path.join(process.cwd(), 'node_modules', dep, 'package.json');
        if (fs.existsSync(depPath)) {
          try {
            const v = JSON.parse(fs.readFileSync(depPath,'utf8')).version;
            return { id: s.id, package: dep, status: 'installed', version: v };
          } catch {
            return { id: s.id, package: dep, status: 'installed' };
          }
        }
        return { id: s.id, package: dep, status: 'missing' };
      });
      return { success: true, results };
    }
    // Case 3: no detectable package
    return { success: true, results: [{ id: s.id, package: null, status: 'no-package' }] };
  } catch (e:any) {
    return { success: false, error: e.message || String(e) };
  }
});

// Install dependency package for a specific server
ipcMain.handle('mcp:install-server-deps', async (_e, id: string) => {
  try {
    const servers = mcpManager.getServers();
    const s = servers.find(sv => sv.id === id);
    if (!s) return { success: false, error: 'Server not found' };
    // Official npx package path
    if (s.command === 'npx' && s.args && s.args[0] && s.args[0].startsWith('@modelcontextprotocol/')) {
      const pkg = s.args[0];
      const pkgPath = path.join(process.cwd(), 'node_modules', pkg, 'package.json');
      if (fs.existsSync(pkgPath)) return { success: true, installed: [], message: 'Already installed' };
      const cmd = `npm install ${pkg}`;
      return await new Promise(resolve => {
        exec(cmd, { cwd: process.cwd(), shell: process.platform === 'win32' ? true : '/bin/bash' as any }, (err: any, stdout: string, stderr: string) => {
          if (err) return resolve({ success: false, error: err.message, stdout, stderr });
          resolve({ success: true, installed: [pkg], stdout });
        });
      });
    }
  // Declared/implicit dependencies path
  const declared = inferImplicitDeps(s);
  if (!declared.length) return { success: false, error: 'Server has no associated npm package' };
  // Determine which declared deps are missing
  const missing = declared.filter(dep => !fs.existsSync(path.join(process.cwd(), 'node_modules', dep, 'package.json')));
    if (!missing.length) return { success: true, installed: [], message: 'Already installed' };
    const cmd = `npm install ${missing.join(' ')}`;
    return await new Promise(resolve => {
      exec(cmd, { cwd: process.cwd(), shell: process.platform === 'win32' ? true : '/bin/bash' as any }, (err: any, stdout: string, stderr: string) => {
        if (err) return resolve({ success: false, error: err.message, stdout, stderr });
        resolve({ success: true, installed: missing, stdout });
      });
    });
  } catch (e:any) {
    return { success: false, error: e.message || String(e) };
  }
});


// Install a specific MCP package (or all missing)
ipcMain.handle('mcp:install-packages', async (_e, payload: { names?: string[] } | string[] ) => {
  const all = gatherMcpPackages();
  const explicitNames = Array.isArray(payload) ? payload : payload?.names;
  const targets = (explicitNames && explicitNames.length) ? explicitNames : all.filter(p => !fs.existsSync(path.join(process.cwd(),'node_modules', p)));
  if (!targets.length) return { success: true, installed: [], message: 'No packages to install' };
  const cmd = `npm install ${targets.join(' ')}`;
  console.log('📦 Installing MCP packages:', targets.join(', '));
  return await new Promise(resolve => {
    exec(cmd, { cwd: process.cwd(), shell: process.platform === 'win32' ? true : '/bin/bash' as any }, (err: any, stdout: string, stderr: string) => {
      if (err) {
        console.error('❌ MCP install error', err);
        resolve({ success: false, error: err.message, stdout, stderr });
        return;
      }
      console.log('✅ MCP install completed');
      resolve({ success: true, installed: targets, stdout });
    });
  });
});

ipcMain.handle('mcp:call-tool', async (event, call) => {
  console.log('🔧 Main: Calling MCP tool:', call.tool);
  try {
    const result = await mcpManager.callTool(call);
    console.log('✅ Main: MCP tool call completed successfully');
    return result;
  } catch (error) {
    console.error('❌ Main: Error calling MCP tool:', error);
    throw error;
  }
});

ipcMain.handle('mcp:get-servers', async () => {
  console.log('🖥️ Main: Fetching MCP servers...');
  try {
    const servers = mcpManager.getServers();
    console.log('✅ Main: Retrieved', servers.length, 'MCP servers successfully');
    return servers;
  } catch (error) {
    console.error('❌ Main: Error fetching MCP servers:', error);
    throw error;
  }
});

ipcMain.handle('mcp:add-server', async (event, config) => {
  console.log('➕ Main: Adding MCP server:', config.name);
  try {
    const result = await mcpManager.addServer(config);
    console.log('✅ Main: MCP server added successfully');
    return result;
  } catch (error) {
    console.error('❌ Main: Error adding MCP server:', error);
    throw error;
  }
});

ipcMain.handle('mcp:start-server', async (event, id) => {
  console.log('▶️ Main: Starting MCP server:', id);
  try {
    // Inject secrets into env before starting
    const internalMap: Map<string, any> = (mcpManager as any).servers;
    const state = internalMap.get(id);
    if (state && state.config.secretEnvKeys && state.config.secretEnvKeys.length) {
      state.config.env = state.config.env || {};
      for (const key of state.config.secretEnvKeys) {
        const val = await mcpSecretStore.get(id, key);
        if (val) state.config.env[key] = val;
      }
    }
    // Specific auto-injection for brave-search if BRAVE_API_KEY is defined in process env
    if (state && id === 'brave-search') {
      state.config.env = state.config.env || {};
      if (!state.config.env.BRAVE_API_KEY && process.env.BRAVE_API_KEY) {
        state.config.env.BRAVE_API_KEY = process.env.BRAVE_API_KEY;
        console.log('🔐 Inyectado BRAVE_API_KEY al entorno de brave-search (longitud:', process.env.BRAVE_API_KEY.length, ')');
      } else if (!process.env.BRAVE_API_KEY) {
        console.warn('⚠️ BRAVE_API_KEY no está definida en process.env al intentar arrancar brave-search');
      }
    }
    await mcpManager.startServer(id);
    console.log('✅ Main: MCP server started successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error starting MCP server:', error);
    throw error;
  }
});

ipcMain.handle('mcp:stop-server', async (event, id) => {
  console.log('⏹️ Main: Stopping MCP server:', id);
  try {
    await mcpManager.stopServer(id);
    console.log('✅ Main: MCP server stopped successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error stopping MCP server:', error);
    throw error;
  }
});

ipcMain.handle('mcp:remove-server', async (event, id) => {
  console.log('🗑️ Main: Removing MCP server:', id);
  try {
    await mcpManager.removeServer(id);
    console.log('✅ Main: MCP server removed successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error removing MCP server:', error);
    throw error;
  }
});

ipcMain.handle('mcp:get-server-tools', async (event, serverId) => {
  console.log('🛠️ Main: Fetching tools for server:', serverId);
  try {
    const tools = mcpManager.getServerTools(serverId);
    console.log('✅ Main: Retrieved', tools.length, 'tools for server', serverId);
    return tools;
  } catch (error) {
    console.error('❌ Main: Error fetching server tools:', error);
    throw error;
  }
});

// Update non-secret server config (e.g., env var names, description). Secrets handled separately.
ipcMain.handle('mcp:update-server-config', async (event, id, updates) => {
  try {
    const internalMap: Map<string, any> = (mcpManager as any).servers;
    const state = internalMap.get(id);
    if (!state) return { success: false, error: 'Server not found' };
    state.config = { ...state.config, ...updates };
    return { success: true, server: { ...state.config, status: state.status } };
  } catch (e:any) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('mcp:set-server-secret', async (event, id, key, value) => {
  try {
    await mcpSecretStore.set(id, key, value);
    return { success: true };
  } catch (e:any) {
    return { success: false, error: e.message || String(e) };
  }
});

ipcMain.handle('mcp:get-server-config', async (event, id) => {
  try {
    const servers = mcpManager.getServers();
    const server = servers.find(s => s.id === id);
    if (!server) return { success: false, error: 'Server not found' };
    const secretKeys = server.secretEnvKeys || [];
    const secretStatus: Record<string,string> = {};
    for (const k of secretKeys) secretStatus[k] = (await mcpSecretStore.has(id, k)) ? '__SECURE__' : '';
    return { success: true, server, secrets: secretStatus };
  } catch (e:any) {
    return { success: false, error: e.message || String(e) };
  }
});

// Check availability of MCP server npm packages referenced by current config
ipcMain.handle('mcp:check-packages', async () => {
  const { spawn } = require('child_process');
  const results: any[] = [];
  const servers = mcpManager.getServers();
  for (const s of servers) {
    if (s.command === 'npx' && s.args && s.args[0] && s.args[0].startsWith('@modelcontextprotocol/server-')) {
      const pkg = s.args[0];
      results.push(await new Promise(resolve => {
        const child = spawn('npm', ['view', pkg, 'version'], { stdio: ['ignore','pipe','pipe'] });
        let out = ''; let err = '';
        child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
        child.on('exit', (code: number | null) => {
          if (code === 0) resolve({ id: s.id, package: pkg, status: 'installed', version: out.trim() });
          else resolve({ id: s.id, package: pkg, status: 'missing', error: err.trim() });
        });
        child.on('error', (e: Error) => resolve({ id: s.id, package: pkg, status: 'error', error: e.message }));
      }));
    } else if ((s as any).missing || s.name.includes('missing')) {
      results.push({ id: s.id, package: null, status: 'placeholder' });
    }
  }
  return { success: true, results };
});

// Reload MCP configuration
ipcMain.handle('mcp:reload-config', async () => {
  console.log('🔄 Main: Reloading MCP configuration via IPC');
  try {
    const projectRoot = path.join(__dirname, '..', '..', '..');
    await mcpManager.reloadConfiguration(projectRoot);
    return { success: true, servers: mcpManager.getServers() };
  } catch (error) {
    console.error('❌ Main: Error reloading MCP configuration:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Open config folder path (returns path so renderer can show / copy)
ipcMain.handle('mcp:get-config-path', async () => {
  try {
    // Determine where config was packaged
    const candidates = [
      path.join(process.cwd(), 'config'),
      path.join(__dirname, '..', '..', '..', 'config'),
      (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'config') : undefined
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return { success: true, path: c };
      }
    }
    return { success: false, error: 'Config folder not found' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Logs viewer IPC
ipcMain.handle('logs:get-recent', async (event, limit = 500) => {
  const slice = logBuffer.slice(-Math.min(limit, logBuffer.length));
  return { success: true, logs: slice };
});
ipcMain.handle('logs:clear', async () => {
  logBuffer.length = 0; return { success: true };
});

// MCP directory (search & metadata) handlers
try {
  const { searchMcpDirectory, mcpDirectory } = require('../../shared/domain/mcpDirectory');
  ipcMain.handle('mcp:directory-search', async (_e, term: string) => {
    try {
      const results = searchMcpDirectory(term || '');
      // augment with install status
      const augmented = results.map((r: any) => {
        const pkgPath = path.join(process.cwd(), 'node_modules', r.package, 'package.json');
        let installed = false; let version: string | undefined;
        if (fs.existsSync(pkgPath)) {
          installed = true;
          try { version = JSON.parse(fs.readFileSync(pkgPath,'utf8')).version; } catch { /* ignore */ }
        }
        return { ...r, installed, version };
      });
      return { success: true, results: augmented };
    } catch (e:any) { return { success: false, error: e.message || String(e) }; }
  });
  // Online npm registry search (lightweight). Filters to packages mentioning MCP related terms.
  ipcMain.handle('mcp:directory-search-online', async (_e, query: string) => {
    try {
      const q = (query || '').trim();
      if (!q) return { success: true, results: [] };
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=30`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return { success: false, error: 'npm registry error ' + res.status };
      const data = await res.json();
      const objs = Array.isArray(data.objects) ? data.objects : [];
      const mapped = objs.map((o: any) => {
        const p = o.package || {};
        const name = p.name || '';
        const desc = p.description || '';
        const isOfficial = name.startsWith('@modelcontextprotocol/');
        const installed = fs.existsSync(path.join(process.cwd(),'node_modules', name, 'package.json'));
        let version: string | undefined = p.version;
        return {
          id: name,
          package: name,
          name,
          description: desc,
          website: (p.links && (p.links.homepage || p.links.npm)) || undefined,
          repo: p.links?.repository || undefined,
          reliability: isOfficial ? 4 : 2,
          tags: [isOfficial ? 'official':'community','online'],
          installed,
          version
        };
      }).filter((r: any) => /modelcontextprotocol|mcp|server/i.test(r.name + ' ' + r.description));
      return { success: true, results: mapped };
    } catch (e:any) {
      return { success: false, error: e.message || String(e) };
    }
  });
  ipcMain.handle('mcp:directory-get', async (_e, id: string) => {
    try {
      const entry = mcpDirectory.find((e: any) => e.id === id || e.package === id);
      if (!entry) return { success: false, error: 'Not found' };
      const pkgPath = path.join(process.cwd(), 'node_modules', entry.package, 'package.json');
      let installed = false; let version: string | undefined;
      if (fs.existsSync(pkgPath)) {
        installed = true; try { version = JSON.parse(fs.readFileSync(pkgPath,'utf8')).version; } catch { /* ignore */ }
      }
      return { success: true, entry: { ...entry, installed, version } };
    } catch (e:any) { return { success: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('mcp:directory-readme', async (_e, pkg: string) => {
    try {
      if (!pkg) return { success: false, error: 'Package required' };
      const base = path.join(process.cwd(), 'node_modules', pkg);
      if (!fs.existsSync(base)) return { success: false, error: 'Not installed' };
      // Try common README filenames
      const candidates = ['README.md','readme.md','README.MD','Readme.md'];
      let filePath: string | null = null;
      for (const c of candidates) { const p = path.join(base, c); if (fs.existsSync(p)) { filePath = p; break; } }
      if (!filePath) return { success: false, error: 'README not found' };
      let content = fs.readFileSync(filePath,'utf8');
      // Truncate large readme to avoid UI overload
      const MAX_LEN = 40_000; // ~40KB
      if (content.length > MAX_LEN) content = content.slice(0, MAX_LEN) + '\n\n...[truncated]';
      return { success: true, content };
    } catch (e:any) {
      return { success: false, error: e.message || String(e) };
    }
  });
} catch (e) {
  console.warn('MCP directory module load failed', e);
}

// Tool configuration handlers
ipcMain.handle('get-tool-config', () => {
  console.log('⚙️ Main: Fetching tool configuration...');
  const config = {
    tools: toolConfigManager.getToolConfig(),
    modelLimits: toolConfigManager.getModelLimits()
  };
  console.log('✅ Main: Tool configuration retrieved successfully');
  return config;
});

ipcMain.handle('update-tool-config', async (event, config) => {
  console.log('💾 Main: Updating tool configuration...');
  try {
    // Update individual tool settings
    if (config.tools) {
      for (const [toolName, toolConfig] of Object.entries(config.tools)) {
        await toolConfigManager.setToolEnabled(toolName, (toolConfig as any).enabled);
      }
    }
    
    // Update model limits
    if (config.modelLimits) {
      for (const [modelName, limit] of Object.entries(config.modelLimits)) {
        await toolConfigManager.setModelLimit(modelName, limit as number);
      }
    }
    
    console.log('✅ Main: Tool configuration updated successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error updating tool configuration:', error);
    throw error;
  }
});

// External models handlers
ipcMain.handle('get-external-models', async () => {
  console.log('🌐 Main: Fetching external models...');
  try {
    const models = await externalModelManager.getModels();
    console.log('✅ Main: Retrieved', models.length, 'external models successfully');
    return models;
  } catch (error) {
    console.error('❌ Main: Error fetching external models:', error);
    throw error;
  }
});

// Tool management handlers for electronAPI compatibility
ipcMain.handle('tools:get-available', async () => {
  console.log('🛠️ Main: Fetching available tools (electronAPI)...');
  try {
    const tools = mcpManager.getAllTools();
    console.log('✅ Main: Retrieved', tools.length, 'available tools successfully');
    
    // Transform tools to match the expected format for ToolManager
    const transformedTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description || 'No description available',
      server: tool.origin || 'MCP Server',
      category: 'MCP Tools',
      enabled: toolConfigManager.isToolEnabled(tool.name)
    }));
    
    return { success: true, tools: transformedTools };
  } catch (error) {
    console.error('❌ Main: Error fetching available tools:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, tools: [], error: errorMessage };
  }
});

ipcMain.handle('tools:update-status', async (event, toolName, enabled) => {
  console.log('🔧 Main: Updating tool status:', toolName, 'enabled:', enabled);
  try {
    await toolConfigManager.setToolEnabled(toolName, enabled);
    console.log('✅ Main: Tool status updated successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error updating tool status:', error);
    throw error;
  }
});

ipcMain.handle('tools:get-model-limits', async () => {
  console.log('📊 Main: Fetching model limits...');
  try {
    const limits = toolConfigManager.getModelLimits();
    console.log('✅ Main: Retrieved model limits successfully');
    return { success: true, limits };
  } catch (error) {
    console.error('❌ Main: Error fetching model limits:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, limits: {}, error: errorMessage };
  }
});

ipcMain.handle('tools:set-model-limit', async (event, modelName, limit) => {
  console.log('📊 Main: Setting model limit:', modelName, 'limit:', limit);
  try {
    await toolConfigManager.setModelLimit(modelName, limit);
    console.log('✅ Main: Model limit set successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error setting model limit:', error);
    throw error;
  }
});

ipcMain.handle('tools:get-enabled-for-model', async (event, modelName) => {
  console.log('🎯 Main: Fetching enabled tools for model:', modelName);
  try {
    const allTools = mcpManager.getAllTools();
    const toolNames = allTools.map(tool => tool.name);
    const enabledToolNames = toolConfigManager.getEnabledToolsForModel(modelName, toolNames);
    console.log('✅ Main: Retrieved', enabledToolNames.length, 'enabled tools for model');
    return { success: true, tools: enabledToolNames };
  } catch (error) {
    console.error('❌ Main: Error fetching enabled tools for model:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, tools: [], error: errorMessage };
  }
});

// External models API handlers
ipcMain.handle('external-models:get-all', async () => {
  console.log('🌐 Main: Fetching all external models (sanitized)...');
  try {
    const models = await externalModelManager.getModelsSanitized();
    console.log('✅ Main: Retrieved', models.length, 'external models successfully');
  return { success: true, models };
  } catch (error) {
    console.error('❌ Main: Error fetching external models:', error);
  return { success: false, models: [], error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('external-models:add', async (event, model) => {
  console.log('➕ Main: Adding external model:', model.name);
  try {
    // Guard: skip if an external model with same provider+model already exists
    const existing = externalModelManager.getModels().find(m => m.provider === model.provider && m.model === model.model && m.name === model.name);
    if (existing) {
      console.log('⚠️ Main: External model already exists, skipping add:', model.name);
      return { success: true, skipped: true, id: existing.id };
    }
    await externalModelManager.addModel(model);
    console.log('✅ Main: External model added successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error adding external model:', error);
    throw error;
  }
});

ipcMain.handle('external-models:update', async (event, id, updates) => {
  console.log('📝 Main: Updating external model:', id);
  try {
    const success = externalModelManager.updateModel(id, updates);
    if (success) {
      console.log('✅ Main: External model updated successfully');
      return { success: true };
    } else {
      throw new Error('Failed to update model');
    }
  } catch (error) {
    console.error('❌ Main: Error updating external model:', error);
    throw error;
  }
});

ipcMain.handle('external-models:remove', async (event, id) => {
  console.log('🗑️ Main: Removing external model:', id);
  try {
    await externalModelManager.removeModel(id);
    console.log('✅ Main: External model removed successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error removing external model:', error);
    throw error;
  }
});

ipcMain.handle('external-models:toggle', async (event, id, enabled) => {
  console.log('🔄 Main: Toggling external model:', id, 'enabled:', enabled);
  try {
    const success = externalModelManager.enableModel(id, enabled);
    if (success) {
      console.log('✅ Main: External model toggled successfully');
      return { success: true };
    } else {
      throw new Error('Failed to toggle model');
    }
  } catch (error) {
    console.error('❌ Main: Error toggling external model:', error);
    throw error;
  }
});

ipcMain.handle('external-models:validate-key', async (event, provider, apiKey, endpoint) => {
  console.log('🔑 Main: Validating API key for provider:', provider);
  try {
    const isValid = await externalModelManager.validateApiKey(provider, apiKey, endpoint);
    console.log('✅ Main: API key validation completed');
    return { valid: isValid };
  } catch (error) {
    console.error('❌ Main: Error validating API key:', error);
    throw error;
  }
});

ipcMain.handle('external-models:validate-model', async (event, id) => {
  console.log('🧪 Main: Validating external model by id:', id);
  try {
    const result = await externalModelManager.validateModel(id);
    console.log('✅ Main: Model validation result:', result.status);
    return { success: true, ...result };
  } catch (error) {
    console.error('❌ Main: Error validating model:', error);
    return { success: false, status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
});

// Generate completion with an external model
ipcMain.handle('external-models:generate', async (event, modelId: string, messages: any[]) => {
  console.log('💬 Main: External model generate request:', modelId, 'messages:', messages?.length || 0);
  try {
    if (Array.isArray(messages)) {
      const withImages = messages.filter(m => m && (m.images?.length || m.imagePath));
      console.log(`🖼️ Main: Messages containing images: ${withImages.length}`);
      withImages.forEach((m, idx) => {
        console.log(`   ↳ [${idx}] role=${m.role} images=${m.images?.length||0} imagePath=${m.imagePath||'none'}`);
      });
    }
  } catch (e) {
    console.warn('⚠️ Main: Failed logging image metadata', e);
  }
  try {
    // ---------------------------------------------------------------------
    // Timeout + logging utilities (5 minute cap per provider call)
    // ---------------------------------------------------------------------
    const MODEL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const ABSOLUTE_HANDLER_TIMEOUT_MS = 6 * 60 * 1000; // hard cap for entire handler
    const handlerStart = Date.now();
    const stageDurations: Record<string, number> = {};
    let absoluteTimeoutHit = false;
    const absoluteTimer = setTimeout(() => {
      absoluteTimeoutHit = true;
      console.warn(`🛑 Handler absolute timeout reached (${ABSOLUTE_HANDLER_TIMEOUT_MS}ms) model=${modelId}`);
    }, ABSOLUTE_HANDLER_TIMEOUT_MS);
  const callWithTimeout = async <T>(stage: string, fn: () => Promise<T>): Promise<T & { __timeout?: boolean }> => {
      const start = Date.now();
      console.log(`⏱️  Model call START stage=${stage} model=${modelId}`);
      let timer: NodeJS.Timeout | undefined = undefined;
      try {
        const result = await Promise.race<Promise<T | { __timeout: true }>>([
          fn(),
          new Promise(resolve => {
            timer = setTimeout(() => {
              console.warn(`⏳ Model call TIMEOUT stage=${stage} model=${modelId} after ${MODEL_TIMEOUT_MS}ms`);
              resolve({ __timeout: true });
            }, MODEL_TIMEOUT_MS);
          }) as any
        ]);
        const dur = Date.now() - start;
    stageDurations[stage] = dur;
        if ((result as any).__timeout) {
          console.warn(`🛑 Model call ABORTED (timeout) stage=${stage} duration=${dur}ms model=${modelId}`);
          return result as any;
        }
        console.log(`✅ Model call END stage=${stage} duration=${dur}ms model=${modelId}`);
        return result as any;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    // Insert system prompt if provided by first message role detection (renderer already may include it)
    const modelMeta = externalModelManager.getModel(modelId);
    let workingMessages = [...messages];
    if (modelMeta?.provider === 'anthropic') {
      // Build tool guide
      const allTools = mcpManager.getAllTools();
      const toolNames = allTools.map(t => t.name);
      const enabledToolNames = toolConfigManager.getEnabledToolsForModel(modelId, toolNames);
      const enabledTools = allTools.filter(t => enabledToolNames.includes(t.name));
      const maxTools = 20;
      const summarized = enabledTools.slice(0, maxTools).map(t => `${t.name}: ${(t.description||'').replace(/\s+/g,' ').slice(0,80)}`);
      const triggerKeywords = ['listar','list','leer','read','archivo','file','carpeta','dir','navegar','browser','web','screenshot','captura','process','proceso','service','servicio','port','puerto','network','export','guardar','save','txt','command','comando'];
      const lastUser = [...workingMessages].reverse().find(m => m.role==='user');
      const lower = (lastUser?.content||'').toLowerCase();
      const userLikelyNeedsTool = triggerKeywords.some(k=>lower.includes(k));
      const existingSystem = workingMessages.find(m=>m.role==='system');
      const toolGuide = [
        'You can invoke system / web / file tools. When an external action is needed (filesystem, listing, reading, exporting, running commands, browser automation, screenshot), DO NOT fabricate output. Instead emit JSON with a tool_calls array. Example:',
        '{"tool_calls":[{"name":"system_list_directory","arguments":{"path":"C:/"}}]}',
        'Only one most relevant tool first. After tool results are appended, continue reasoning. Tools available (name: purpose):',
        summarized.join('\n'),
        'If no tool is needed, answer normally. Responde en el idioma del usuario.'
      ].join('\n');
      if (!existingSystem || !/tool_calls/i.test(existingSystem.content)) {
        if (existingSystem) existingSystem.content += '\n' + toolGuide; else workingMessages.unshift({ role:'system', content: toolGuide });
      } else if (userLikelyNeedsTool) {
        // Add reinforcing system
        workingMessages.push({ role:'system', content:'REMINDER: Output JSON tool_calls for actions instead of textual assumptions.' });
      }
    }
    const result = await callWithTimeout('initial', () => externalModelManager.generateChatCompletion(modelId, workingMessages));
    if ((result as any).__timeout) {
      return { success: false, timeout: true, stage: 'initial', ms: MODEL_TIMEOUT_MS, error: `Model call timed out after ${MODEL_TIMEOUT_MS}ms` };
    }
    // JSON tool_calls fallback parsing for Anthropic if no structured toolCalls returned
    if (modelMeta?.provider==='anthropic' && !result.toolCalls && typeof result.content === 'string' && result.content.includes('"tool_calls"')) {
      try {
        const text = result.content.trim();
        // Attempt to extract JSON block containing tool_calls
        let jsonCandidate = text;
        if (!(jsonCandidate.startsWith('{') && jsonCandidate.endsWith('}'))) {
          const first = jsonCandidate.indexOf('{');
            const last = jsonCandidate.lastIndexOf('}');
          if (first>=0 && last>first) jsonCandidate = jsonCandidate.substring(first,last+1);
        }
        const parsed = JSON.parse(jsonCandidate);
        if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
          const toolCalls = parsed.tool_calls.map((c:any,i:number)=>({
            id: c.id || 'anthropic_json_tool_'+i,
            type:'function',
            function:{ name: c.name || c.function?.name, arguments: c.arguments || c.function?.arguments || {} }
          }));
          if (toolCalls.length) {
            console.log('🧪 Parsed JSON tool_calls from Anthropic content:', toolCalls.length);
            result.toolCalls = toolCalls;
            result.needsToolExecution = true;
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to parse JSON tool_calls from Anthropic content:', (e as any).message);
      }
    }
    // Heuristic enforcement: if Anthropic likely needed a tool (user intent) but produced a narrative claiming action without tool_calls, force a re-prompt.
    if (modelMeta?.provider==='anthropic' && !result.toolCalls) {
      const lastUser = [...workingMessages].reverse().find(m => m.role==='user');
      const userText = (lastUser?.content||'').toLowerCase();
      const triggerKeywords = ['listar','list','leer','read','archivo','file','carpeta','dir','navegar','browser','web','screenshot','captura','process','proceso','service','servicio','port','puerto','network','export','guardar','save','txt','command','comando','abrir','open'];
      const userLikelyNeedsTool = triggerKeywords.some(k=>userText.includes(k));
      const contentLower = (result.content||'').toLowerCase();
      // Phrases indicating the model is describing an action instead of calling a tool
      const hallucinationIndicators = [
        'he tomado','he capturado','i have captured','screenshot','listado de archivos','file listing','abrí','he abierto','i opened','navegué','i navigated','ejecuté','i executed','comando ejecutado','proceso iniciado','captura guardada','saved screenshot','guardado en','saved at'
      ];
      const seemsSimulated = hallucinationIndicators.some(p=>contentLower.includes(p));
      const alreadyForced = workingMessages.some(m=>m.role==='system' && /FORCE_TOOL_CALLS_ATTEMPT/.test(m.content));
      if (userLikelyNeedsTool && seemsSimulated && !alreadyForced) {
        console.log('⚠️ Anthropic response appears to simulate tool execution. Forcing tool_calls re-prompt.');
        const forceInstruction = [
          'FORCE_TOOL_CALLS_ATTEMPT: You described performing an external action but did not emit tool_calls.',
          'Respond NOW with ONLY valid JSON: {"tool_calls":[{"name":"<tool_name>","arguments":{...}}]}',
          'Choose exactly ONE most relevant tool from the provided list previously. No explanation, no natural language, JSON only.'
        ].join('\n');
        const forcedMessages = [...workingMessages, { role:'assistant', content: result.content||'' }, { role:'system', content: forceInstruction }, { role:'user', content:'Output ONLY JSON with tool_calls now.' }];
        const forcedResult = await callWithTimeout('forced-reprompt', () => externalModelManager.generateChatCompletion(modelId, forcedMessages));
        if ((forcedResult as any).__timeout) {
          console.warn('⚠️ Forced re-prompt timed out; proceeding with original content.');
        }
        // Attempt JSON parsing again
        if (!forcedResult.toolCalls && typeof forcedResult.content==='string' && forcedResult.content.includes('"tool_calls"')) {
          try {
            let jsonCandidate = forcedResult.content.trim();
            if (!(jsonCandidate.startsWith('{') && jsonCandidate.endsWith('}'))) {
              const first = jsonCandidate.indexOf('{');
              const last = jsonCandidate.lastIndexOf('}');
              if (first>=0 && last>first) jsonCandidate = jsonCandidate.substring(first,last+1);
            }
            const parsed = JSON.parse(jsonCandidate);
            if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
              forcedResult.toolCalls = parsed.tool_calls.map((c:any,i:number)=>({
                id: c.id || 'anthropic_forced_tool_'+i,
                type:'function',
                function:{ name: c.name || c.function?.name, arguments: c.arguments || c.function?.arguments || {} }
              }));
              if (forcedResult.toolCalls.length) forcedResult.needsToolExecution = true;
            }
          } catch (e) {
            console.warn('⚠️ Forced tool_calls JSON parse failed:', (e as any).message);
          }
        }
        // Replace original result with forcedResult if we obtained toolCalls
        if (forcedResult.toolCalls && forcedResult.toolCalls.length) {
          console.log('✅ Forced tool_calls acquired from Anthropic after re-prompt:', forcedResult.toolCalls.length);
          Object.assign(result, forcedResult); // mutate result to reuse downstream logic
        } else {
          console.log('⚠️ Re-prompt did not yield tool_calls; proceeding with original content.');
        }
      }
    }
    // ---------------- Multi-cycle tool execution loop ----------------
    if (result.needsToolExecution && result.toolCalls) {
  // Increased per user request (was 6). Allows longer multi-step automation chains.
  const MAX_CYCLES = 50;
      let cycle = 0;
      let currentResult: any = result;
      let lastToolSignature = '';
      let accumulatedToolExecutions: any[] = [];
      let working = [...workingMessages];
      while (currentResult.needsToolExecution && currentResult.toolCalls && cycle < MAX_CYCLES) {
        cycle++;
        console.log(`🔁 Tool cycle ${cycle} starting with ${currentResult.toolCalls.length} toolCalls`);
        const toolResults: any[] = [];
        // Execute each requested tool sequentially
        for (const toolCall of currentResult.toolCalls) {
          try {
            const sig = toolCall.function.name + ':' + JSON.stringify(toolCall.function.arguments||{});
            const toolResult = await mcpManager.callTool({
              tool: toolCall.function.name,
              args: toolCall.function.arguments,
              serverId: undefined
            });
            toolResults.push({ role: 'tool', name: toolCall.function.name, signature: sig, content: JSON.stringify(toolResult) });
            accumulatedToolExecutions.push({ cycle, name: toolCall.function.name, args: toolCall.function.arguments, ok: true });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            toolResults.push({ role: 'tool', name: toolCall.function.name, content: JSON.stringify({ error: errMsg }) });
            accumulatedToolExecutions.push({ cycle, name: toolCall.function.name, args: toolCall.function.arguments, ok: false, error: errMsg });
          }
        }
        // Detect repeated identical single-tool loop
        if (toolResults.length === 1) {
          const sig = toolResults[0].name + ':' + toolResults[0].content.slice(0,120);
          if (sig === lastToolSignature) {
            console.warn('⚠️ Repeated identical tool result detected; breaking loop to avoid infinite cycle.');
            break;
          }
          lastToolSignature = sig;
        }
        // Condense tool results for Anthropic
        let followUpMessages = [...working, { role: 'assistant', content: currentResult.content || '' }, ...toolResults];
        if (modelMeta?.provider === 'anthropic') {
          try {
            const sanitizeBase64 = (str: string) => str.replace(/"([a-zA-Z0-9_]*base64|image_base64|screenshot|data)"\s*:\s*"([A-Za-z0-9+/=]{120,})"/g, (_m, key, val) => `"${key}":"[BASE64_${val.length}_TRUNCATED]"`);
            const deepExtractInner = (parsed: any): string | null => {
              try {
                const innerText = parsed?.result?.content?.[0]?.text || parsed?.content?.[0]?.text;
                if (typeof innerText === 'string') {
                  let maybe = innerText.trim();
                  if (maybe.startsWith('{') && maybe.includes('base64')) {
                    try {
                      const innerObj = JSON.parse(maybe);
                      for (const k of Object.keys(innerObj)) {
                        if (/base64|screenshot|image/i.test(k) && typeof innerObj[k] === 'string') {
                          innerObj[k] = `[BASE64_${innerObj[k].length}_TRUNCATED]`;
                        }
                      }
                      return JSON.stringify(innerObj, null, 2);
                    } catch {}
                  }
                  return innerText;
                }
              } catch {}
              return null;
            };
            const condensed = toolResults.map((tr: any, idx: number) => {
              let raw = tr.content;
              try {
                raw = sanitizeBase64(raw);
                const parsed = JSON.parse(raw);
                const inner = deepExtractInner(parsed);
                const rawTrunc = raw.length > 1000 ? raw.slice(0,1000)+'...<truncated>' : raw;
                return `Cycle ${cycle} Tool #${idx+1} (${tr.name})\nRaw JSON (sanitized): ${rawTrunc}\nInner: ${(inner||'').slice(0,1200)}`;
              } catch {
                return `Cycle ${cycle} Tool #${idx+1} (${tr.name})\nRaw (sanitized): ${raw.slice(0,1000)}`;
              }
            }).join('\n\n');
            const anthroToolMsg = { role: 'user', content: [
              'RESULTADOS_DE_HERRAMIENTAS Ciclo '+cycle+'. Usa SOLO estos datos para el siguiente paso.',
              condensed,
              'Si todavía faltan pasos (navegar, buscar, screenshot, guardar archivos), pide / ejecuta la siguiente herramienta con JSON tool_calls. Si ya terminaste todo, entrega la explicación final y NO generes más tool_calls.'
            ].join('\n\n') };
            followUpMessages = [...working, { role: 'assistant', content: currentResult.content || '' }, anthroToolMsg];
          } catch (e) {
            console.warn('⚠️ Condense failure cycle', cycle, (e as any).message);
          }
        }
        console.log(`🔁 Calling model for next cycle (cycle=${cycle})`);
        const next = await callWithTimeout(`post-tools-cycle-${cycle}`, () => externalModelManager.generateChatCompletion(modelId, followUpMessages));
        if ((next as any).__timeout) {
          clearTimeout(absoluteTimer);
            return { success: false, timeout: true, stage: `post-tools-cycle-${cycle}`, ms: MODEL_TIMEOUT_MS, partial: true, accumulatedToolExecutions, stageDurations };
        }
        // Attempt to parse further tool calls if provider Anthropic and raw content contains JSON
        if (modelMeta?.provider==='anthropic' && !next.toolCalls && typeof next.content==='string' && next.content.includes('"tool_calls"')) {
          try {
            let jsonCandidate = next.content.trim();
            if (!(jsonCandidate.startsWith('{') && jsonCandidate.endsWith('}'))) {
              const first = jsonCandidate.indexOf('{');
              const last = jsonCandidate.lastIndexOf('}');
              if (first>=0 && last>first) jsonCandidate = jsonCandidate.substring(first,last+1);
            }
            const parsed = JSON.parse(jsonCandidate);
            if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
              next.toolCalls = parsed.tool_calls.map((c:any,i:number)=>({
                id: c.id || `anthropic_loop_tool_${cycle}_${i}`,
                type:'function',
                function:{ name: c.name || c.function?.name, arguments: c.arguments || c.function?.arguments || {} }
              }));
              if (next.toolCalls.length) next.needsToolExecution = true;
            }
          } catch (e) {
            console.warn('⚠️ Loop JSON parse failed cycle', cycle, (e as any).message);
          }
        }
        // Update working history (append assistant content to context for future reasoning)
        working = [...working, { role:'assistant', content: (next as any).content || '' }];
        currentResult = next;
        // Break condition: if model signals completion (no toolCalls or provides final answer markers)
        if (!currentResult.toolCalls || !currentResult.needsToolExecution) {
          console.log(`✅ Tool cycle loop completed at cycle ${cycle}`);
          clearTimeout(absoluteTimer);
          return { success: true, content: currentResult.content || currentResult, toolCycles: cycle, accumulatedToolExecutions, stageDurations, totalMs: Date.now()-handlerStart };
        }
        if (absoluteTimeoutHit) {
          console.warn('🛑 Absolute handler timeout hit during loop');
          clearTimeout(absoluteTimer);
          return { success:false, timeout:true, stage:'handler-absolute', partial:true, toolCycles: cycle, accumulatedToolExecutions, stageDurations };
        }
      }
      // If loop ended due to cycle limit
      clearTimeout(absoluteTimer);
      return { success: true, content: currentResult.content || currentResult, toolCycles: cycle, loopTerminated: true, reason: 'max_cycles_or_break', accumulatedToolExecutions, stageDurations, totalMs: Date.now()-handlerStart };
    }
    const content = result.content ?? result;
    console.log('✅ Main: External model generation success (no tools), length:', (content || '').length);
    clearTimeout(absoluteTimer);
    return { success: true, content, stageDurations, totalMs: Date.now() - handlerStart };
  } catch (error) {
    console.error('❌ Main: External model generation failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Dialog handlers
ipcMain.handle('dialog:openImage', async () => {
  console.log('🖼️ Main: Opening image dialog...');
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
      ]
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      console.log('📂 Main: Image dialog canceled');
      return null;
    }
    
    const imagePath = result.filePaths[0];
    console.log('✅ Main: Image selected:', imagePath);
    return imagePath;
  } catch (error) {
    console.error('❌ Main: Error opening image dialog:', error);
    throw error;
  }
});

// Save a temporary image coming from renderer (blob conversion)
ipcMain.handle('image:save-temp', async (_e, bytes: number[]) => {
  try {
    const buf = Buffer.from(bytes);
    const tmpDir = path.join(app.getPath('temp'), 'ollama-chat');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `img-${Date.now()}.png`);
    fs.writeFileSync(filePath, buf);
    console.log('🖼️ Main: Temp image saved', filePath, 'size', buf.length);
    return filePath;
  } catch (e:any) {
    console.error('❌ Main: Failed to save temp image', e.message || e);
    return null;
  }
});

ipcMain.handle('add-external-model', async (event, model) => {
  console.log('➕ Main: Adding external model:', model.name);
  try {
    const existing = externalModelManager.getModels().find(m => m.provider === model.provider && m.model === model.model && m.name === model.name);
    if (existing) {
      console.log('⚠️ Main: External model already exists, skipping add:', model.name);
      return { success: true, skipped: true, id: existing.id };
    }
    await externalModelManager.addModel(model);
    console.log('✅ Main: External model added successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error adding external model:', error);
    throw error;
  }
});

ipcMain.handle('remove-external-model', async (event, modelId) => {
  console.log('🗑️ Main: Removing external model:', modelId);
  try {
    await externalModelManager.removeModel(modelId);
    console.log('✅ Main: External model removed successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Main: Error removing external model:', error);
    throw error;
  }
});

// Dialog handlers
ipcMain.handle('show-open-dialog', async (event, options) => {
  console.log('📂 Main: Opening file dialog...');
  try {
    const result = await dialog.showOpenDialog(mainWindow!, options);
    console.log('✅ Main: File dialog result:', result.canceled ? 'canceled' : `${result.filePaths.length} files selected`);
    return result;
  } catch (error) {
    console.error('❌ Main: Error opening file dialog:', error);
    throw error;
  }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  console.log('💾 Main: Opening save dialog...');
  try {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    console.log('✅ Main: Save dialog result:', result.canceled ? 'canceled' : 'file path selected');
    return result;
  } catch (error) {
    console.error('❌ Main: Error opening save dialog:', error);
    throw error;
  }
});

console.log('✅ All IPC handlers registered successfully');

// App event handlers
app.whenReady().then(async () => {
  console.log('⚡ Electron app ready, initializing components...');
  
  try {
    // --- GPU & model preload setup -------------------------------------------------
    // Ensure Ollama uses available NVIDIA GPU(s). User can override via .env OLLAMA_NUM_GPU.
    if (!process.env.OLLAMA_NUM_GPU) {
      process.env.OLLAMA_NUM_GPU = '1';
      console.log('🟢 OLLAMA_NUM_GPU not set; defaulting to 1 to enable GPU usage.');
    } else {
      console.log('🟢 OLLAMA_NUM_GPU preset =', process.env.OLLAMA_NUM_GPU);
    }

    // Optionally allow user to skip automatic pulls
    const autoPreload = process.env.OLLAMA_AUTO_PRELOAD !== 'false';
    const preloadModels = ['qwen2.5:latest', 'llama3.1:8b'];
    if (autoPreload) {
      console.log('📦 Checking required models for GPU preload:', preloadModels.join(', '));
      try {
        const existing = await ollamaClient.listModels();
        for (const model of preloadModels) {
          if (!existing.includes(model)) {
            console.log(`⬇️ Pulling missing model: ${model}`);
            try {
              // Use child_process spawn to run 'ollama pull <model>' to ensure model is present.
              const { spawn } = require('child_process');
              await new Promise<void>((resolve, reject) => {
                const proc = spawn('ollama', ['pull', model], { stdio: 'inherit' });
                proc.on('error', reject);
                proc.on('exit', (code: number) => {
                  if (code === 0) resolve(); else reject(new Error(`ollama pull ${model} exited with code ${code}`));
                });
              });
              console.log(`✅ Model pulled: ${model}`);
            } catch (e) {
              console.warn(`⚠️ Could not pull model ${model}:`, e instanceof Error ? e.message : e);
            }
          } else {
            console.log(`✅ Model already present: ${model}`);
          }
        }
      } catch (e) {
        console.warn('⚠️ Could not verify/pull models (ollama may not be running yet):', e instanceof Error ? e.message : e);
      }
    } else {
      console.log('⏩ Skipping model preload (OLLAMA_AUTO_PRELOAD=false)');
    }
    // -------------------------------------------------------------------------------
    // Initialize MCP Manager
    const projectRoot = path.join(__dirname, '..', '..', '..');
    console.log('📂 Project root calculated:', projectRoot);
    
    await mcpManager.loadDefaultConfiguration(projectRoot);
    console.log('✅ MCP Manager initialized successfully');
    
    // Initialize tool configuration
    await toolConfigManager.loadConfig();
    console.log('✅ Tool Configuration Manager initialized successfully');
    
    console.log('🎉 All components initialized, application ready!');
  } catch (error) {
    console.error('⚠️ Error initializing application components:', error);
  }
  
  createWindow();
});

app.on('window-all-closed', () => {
  console.log('🚪 All windows closed');
  if (process.platform !== 'darwin') {
    console.log('🔚 Quitting application (non-macOS)');
    app.quit();
  }
});

app.on('activate', () => {
  console.log('🔄 App activated (macOS)');
  if (BrowserWindow.getAllWindows().length === 0) {
    console.log('📱 No windows open, creating new window');
    createWindow();
  }
});

console.log('🎯 Electron main process setup completed');
