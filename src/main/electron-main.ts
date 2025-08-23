import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
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
          if (code === 0) resolve({ id: s.id, package: pkg, status: 'found', version: out.trim() });
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
    // Insert system prompt if provided by first message role detection (renderer already may include it)
    const output = await externalModelManager.generateChatCompletion(modelId, messages);
    console.log('✅ Main: External model generation success, length:', output.length);
    return { success: true, content: output };
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
