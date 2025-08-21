import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
// MCP Manager
import { McpManager } from '../shared/infrastructure/mcp/McpManager';
import ToolConfigManager from './tool-config';
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
for (const p of candidatePaths) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    OllamaClientMod = require(p);
    break;
  } catch { /* continue */ }
}
if (!OllamaClientMod) {
  throw new Error('Could not load OllamaClient module in any of the expected paths');
}
const { OllamaClient } = OllamaClientMod;
// Types
import type { ChatRequest } from '../shared/domain/chat';
import type { McpToolCall, McpServer } from '../shared/domain/mcp';

let mainWindow: BrowserWindow | null = null;
const ollama = new OllamaClient();
const mcpManager = new McpManager(process.cwd());
const toolConfigManager = new ToolConfigManager();

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      // __dirname = dist/main/main -> preload build = dist/preload/preload/preload.js
      preload: path.join(__dirname, '..', '..', 'preload', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // __dirname -> dist/main/main en build. Queremos llegar a dist/renderer/index.html
  const prodIndex = path.join(__dirname, '..', '..', 'renderer', 'index.html');
  const url = process.env.VITE_DEV_SERVER_URL || `file://${prodIndex.replace(/\\/g, '/')}`;
  await mainWindow.loadURL(url);
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    console.error('Fallo al cargar', { errorCode, errorDesc, validatedURL, tried: url });
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  createWindow();
  
  // Cargar configuración MCP por defecto
  try {
    // Usar el directorio del proyecto, no __dirname que apunta a dist/main
    // __dirname = dist/main, necesitamos subir 2 niveles para llegar al proyecto
    const projectRoot = path.join(__dirname, '..', '..', '..');
    console.log('🔍 Project root calculated:', projectRoot);
    await mcpManager.loadDefaultConfiguration(projectRoot);
    console.log('🔧 MCP Manager initialized');
    
    // Inicializar configuración de herramientas
    await toolConfigManager.loadConfig();
    console.log('⚙️ Tool Configuration Manager initialized');
  } catch (error) {
    console.error('⚠️ Error inicializando MCP Manager:', error);
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('models:list', async () => {
  return await ollama.listModels();
});

ipcMain.handle('chat:send', async (_e, req: ChatRequest) => {
  // Get available MCP tools with terminal tools prioritized
  console.log('🔄 Main: Received chat request from renderer');
  console.log('📝 Main: Request model:', req.model);
  console.log('📝 Main: Request messages count:', req.messages.length);
  
  // Obtener herramientas filtradas por modelo y configuración
  const allTools = mcpManager.getAllToolsPrioritized();
  const enabledToolNames = toolConfigManager.getEnabledToolsForModel(req.model, allTools.map(t => t.name));
  const filteredTools = allTools.filter(tool => enabledToolNames.includes(tool.name));
  
  console.log('🛠️ Main: All available tools:', allTools.length);
  console.log('✅ Main: Enabled tools for model:', filteredTools.length);
  console.log('🔧 Main: Terminal tools prioritized and filtered by model configuration');
  
  const result = await ollama.generate(req, filteredTools);
  console.log('📤 Main: Generated result:', result);
  
  // Check if the model wants to use tools
  if (result.needsToolExecution && result.toolCalls) {
    console.log('🔧 Main: Executing tool calls:', result.toolCalls.length);
    
    try {
      // Execute each tool call
      const toolResults = [];
      for (const toolCall of result.toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments;
        
        console.log(`�️ Main: Executing tool ${toolName} with args:`, toolArgs);
        
        // Execute the tool using MCP Manager
        const mcpToolCall: McpToolCall = {
          tool: toolName,
          args: toolArgs
        };
        const toolResult = await mcpManager.callTool(mcpToolCall);
        toolResults.push({
          role: 'tool',
          content: JSON.stringify(toolResult),
          tool_call_id: toolCall.id || toolName
        });
      }
      
      // Add tool results to conversation and get final response
      const updatedMessages = [
        ...req.messages,
        { role: 'assistant', content: result.content, tool_calls: result.toolCalls },
        ...toolResults
      ];
      
      console.log('🔄 Main: Sending follow-up request with tool results');
      const finalResult = await ollama.generate({ ...req, messages: updatedMessages }, filteredTools);
      console.log('📤 Main: Final result after tool execution:', finalResult.content);
      
      return finalResult.content;
    } catch (error) {
      console.error('❌ Main: Error executing tools:', error);
      return `❌ Error executing tools: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
  
  console.log('�📏 Main: Result length:', result.content?.length || 0);
  return result.content;
});

ipcMain.handle('dialog:openImage', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar imagen',
    properties: ['openFile'],
    filters: [ { name: 'Images', extensions: ['png','jpg','jpeg','webp'] } ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// MCP IPC Handlers
ipcMain.handle('mcp:get-tools', async () => {
  return mcpManager.getAllTools();
});

ipcMain.handle('mcp:call-tool', async (_e, call: McpToolCall) => {
  return await mcpManager.callTool(call);
});

ipcMain.handle('mcp:get-servers', async () => {
  return mcpManager.getServers();
});

ipcMain.handle('mcp:add-server', async (_e, config: Omit<McpServer, 'id'>) => {
  return await mcpManager.addServer(config);
});

ipcMain.handle('mcp:start-server', async (_e, id: string) => {
  await mcpManager.startServer(id);
});

ipcMain.handle('mcp:stop-server', async (_e, id: string) => {
  mcpManager.stopServer(id);
});

ipcMain.handle('mcp:remove-server', async (_e, id: string) => {
  mcpManager.removeServer(id);
});

ipcMain.handle('mcp:get-server-tools', async (_e, serverId: string) => {
  return mcpManager.getServerTools(serverId);
});

// Tool Management Handlers
ipcMain.handle('tools:get-available', async () => {
  try {
    const tools = mcpManager.getAllTools();
    const servers = mcpManager.getServers();
    
    const formattedTools = tools.map(tool => {
      // Try to find which server this tool belongs to
      let serverInfo = 'builtin';
      let category = 'general';
      
      if (tool.origin === 'builtin') {
        serverInfo = 'builtin';
        category = 'system';
      } else {
        // Find server that has this tool
        for (const server of servers) {
          const serverTools = mcpManager.getServerTools(server.id);
          if (serverTools.some(t => t.name === tool.name)) {
            serverInfo = server.name;
            category = server.category || 'mcp';
            break;
          }
        }
      }
      
      return {
        name: tool.name,
        description: tool.description || 'No description available',
        server: serverInfo,
        category: category,
        enabled: toolConfigManager.isToolEnabled(tool.name) // Usar estado real de configuración
      };
    });
    
    return { success: true, tools: formattedTools };
  } catch (error) {
    console.error('Error getting available tools:', error);
    return { success: false, tools: [] };
  }
});

ipcMain.handle('tools:update-status', async (_e, toolName: string, enabled: boolean) => {
  try {
    await toolConfigManager.setToolEnabled(toolName, enabled);
    console.log(`🔧 Tool ${toolName} ${enabled ? 'enabled' : 'disabled'}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating tool status:', error);
    return { success: false };
  }
});

// Handlers adicionales para gestión de modelos
ipcMain.handle('tools:get-model-limits', async () => {
  try {
    return { success: true, limits: toolConfigManager.getModelLimits() };
  } catch (error) {
    console.error('Error getting model limits:', error);
    return { success: false, limits: {} };
  }
});

ipcMain.handle('tools:set-model-limit', async (_e, modelName: string, limit: number) => {
  try {
    await toolConfigManager.setModelLimit(modelName, limit);
    return { success: true };
  } catch (error) {
    console.error('Error setting model limit:', error);
    return { success: false };
  }
});

ipcMain.handle('tools:get-enabled-for-model', async (_e, modelName: string) => {
  try {
    const allTools = mcpManager.getAllTools().map(tool => tool.name);
    const enabledTools = toolConfigManager.getEnabledToolsForModel(modelName, allTools);
    return { success: true, tools: enabledTools };
  } catch (error) {
    console.error('Error getting enabled tools for model:', error);
    return { success: false, tools: [] };
  }
});
