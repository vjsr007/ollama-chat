import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
// Resolución dinámica de OllamaClient considerando distintas estructuras de build
let OllamaClientMod: any;
const candidatePaths = [
  // Ejecutando desde raíz del proyecto tras build (electron .)
  path.join(process.cwd(), 'dist/shared/infrastructure/ollama/OllamaClient.js'),
  // Relativo al archivo compilado (dist/main/main/electron-main.js -> ../../shared/...)
  path.join(__dirname, '../../shared/infrastructure/ollama/OllamaClient.js'),
  // Fallback a código fuente (dev)
  path.join(process.cwd(), 'src/shared/infrastructure/ollama/OllamaClient.ts')
];
for (const p of candidatePaths) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    OllamaClientMod = require(p);
    break;
  } catch { /* continuar */ }
}
if (!OllamaClientMod) {
  throw new Error('No se pudo cargar el módulo OllamaClient en ninguna de las rutas esperadas');
}
const { OllamaClient } = OllamaClientMod;
// Types
import type { ChatRequest } from '../shared/domain/chat';

let mainWindow: BrowserWindow | null = null;
const ollama = new OllamaClient();

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

app.whenReady().then(() => {
  createWindow();
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
  return await ollama.generate(req);
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
