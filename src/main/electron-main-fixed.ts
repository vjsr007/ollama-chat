import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { McpManager } from '../shared/infrastructure/mcp/McpManager';
import ToolConfigManager from './tool-config';
import { ExternalModelManager } from './external-models';

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

// Global instances
let mainWindow: BrowserWindow | null = null;
const ollamaClient = new OllamaClient();
const mcpManager = new McpManager();
const toolConfigManager = new ToolConfigManager();
const externalModelManager = new ExternalModelManager();

console.log('🏗️ Creating global instances completed');

function createWindow(): void {
  console.log('🪟 Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js'),
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
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
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
    request.tools = enabledTools;
    console.log('🎯 Tools available:', allTools.length, 'sending to Ollama:', enabledTools.length, '(max: 25)');

    // Generate response
    const result = await ollamaClient.generate(request);
    console.log('📈 Main: Generated result:', {
      needsToolExecution: result.needsToolExecution,
      toolCalls: result.toolCalls?.length || 0,
      content: result.content?.substring(0, 100) + (result.content?.length > 100 ? '...' : '')
    });

    // Execute tool calls if needed
    if (result.needsToolExecution && result.toolCalls) {
      console.log('🔧 Main: Executing tool calls:', result.toolCalls.length);
      
      const toolResults = [];
      for (const toolCall of result.toolCalls) {
        try {
          console.log('🛠️ Main: Executing tool', toolCall.function.name, 'with args:', JSON.stringify(toolCall.function.arguments));
          const toolResult = await mcpManager.callTool({
            tool: toolCall.function.name,
            args: toolCall.function.arguments,
            serverId: 'auto' // Let MCP manager decide
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

      // Add tool results to messages and generate final response
      const newMessages = [...request.messages, { role: 'assistant', content: result.content }, ...toolResults];
      console.log('📨 Main: Sending follow-up request with tool results');
      
      const finalRequest = {
        ...request,
        messages: newMessages,
        tools: enabledTools
      };

      const finalResult = await ollamaClient.generate(finalRequest);
      console.log('🎉 Main: Final response generated successfully');
      return finalResult;
    }

    return result;
  } catch (error) {
    console.error('💥 Main: Error executing tools:', error);
    throw error;
  }
});

// Get available models handler
ipcMain.handle('get-models', async () => {
  console.log('📋 Main: Fetching available models...');
  try {
    const models = await ollamaClient.getModels();
    console.log('✅ Main: Retrieved', models.length, 'models successfully');
    return models;
  } catch (error) {
    console.error('❌ Main: Error fetching models:', error);
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

ipcMain.handle('add-external-model', async (event, model) => {
  console.log('➕ Main: Adding external model:', model.name);
  try {
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
