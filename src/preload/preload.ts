import { contextBridge, ipcRenderer } from 'electron';
import { ChatRequest } from '../shared/domain/chat';
import type { McpToolCall, McpServer } from '../shared/domain/mcp';

export const api = {
  listModels: () => ipcRenderer.invoke('models:list') as Promise<string[]>,
  sendChat: (req: ChatRequest) => ipcRenderer.invoke('chat', req) as Promise<string>,
  openImage: () => ipcRenderer.invoke('dialog:openImage') as Promise<string | null>
};

export const mcpApi = {
  getTools: () => ipcRenderer.invoke('mcp:get-tools'),
  callTool: (call: McpToolCall) => ipcRenderer.invoke('mcp:call-tool', call),
  getServers: () => ipcRenderer.invoke('mcp:get-servers'),
  addServer: (config: Omit<McpServer, 'id'>) => ipcRenderer.invoke('mcp:add-server', config),
  startServer: (id: string) => ipcRenderer.invoke('mcp:start-server', id),
  stopServer: (id: string) => ipcRenderer.invoke('mcp:stop-server', id),
  removeServer: (id: string) => ipcRenderer.invoke('mcp:remove-server', id),
  getServerTools: (serverId: string) => ipcRenderer.invoke('mcp:get-server-tools', serverId),
  reloadConfig: () => ipcRenderer.invoke('mcp:reload-config'),
  getConfigPath: () => ipcRenderer.invoke('mcp:get-config-path')
};

export const electronApi = {
  getAvailableTools: () => ipcRenderer.invoke('tools:get-available'),
  updateToolStatus: (toolName: string, enabled: boolean) => ipcRenderer.invoke('tools:update-status', toolName, enabled),
  getModelLimits: () => ipcRenderer.invoke('tools:get-model-limits'),
  setModelLimit: (modelName: string, limit: number) => ipcRenderer.invoke('tools:set-model-limit', modelName, limit),
  getEnabledToolsForModel: (modelName: string) => ipcRenderer.invoke('tools:get-enabled-for-model', modelName)
};

export const externalModelsApi = {
  getAll: () => ipcRenderer.invoke('external-models:get-all'),
  add: (model: any) => ipcRenderer.invoke('external-models:add', model),
  update: (id: string, updates: any) => ipcRenderer.invoke('external-models:update', id, updates),
  remove: (id: string) => ipcRenderer.invoke('external-models:remove', id),
  toggle: (id: string, enabled: boolean) => ipcRenderer.invoke('external-models:toggle', id, enabled),
  validateKey: (provider: string, apiKey: string, endpoint?: string) => ipcRenderer.invoke('external-models:validate-key', provider, apiKey, endpoint),
  validateModel: (id: string) => ipcRenderer.invoke('external-models:validate-model', id),
  generate: (id: string, messages: any[]) => ipcRenderer.invoke('external-models:generate', id, messages)
};

contextBridge.exposeInMainWorld('ollama', api);
contextBridge.exposeInMainWorld('mcp', mcpApi);
contextBridge.exposeInMainWorld('electronAPI', electronApi);
contextBridge.exposeInMainWorld('externalModels', externalModelsApi);

declare global {
  interface Window {
    ollama: typeof api;
    mcp: typeof mcpApi;
    electronAPI: typeof electronApi;
    externalModels: typeof externalModelsApi;
  }
}
