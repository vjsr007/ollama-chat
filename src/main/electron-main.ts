import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
// MCP Manager
import { McpManager } from '../shared/infrastructure/mcp/McpManager';
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
  // Get available MCP tools
  const tools = await mcpManager.getAllTools();
  return await ollama.generate(req, tools);
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
