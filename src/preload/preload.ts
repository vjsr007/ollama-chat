import { contextBridge, ipcRenderer } from 'electron';
import { ChatRequest } from '../shared/domain/chat';
import type { McpToolCall, McpServer } from '../shared/domain/mcp';

export const api = {
  listModels: () => ipcRenderer.invoke('models:list') as Promise<string[]>,
  sendChat: (req: ChatRequest) => ipcRenderer.invoke('chat', req) as Promise<string>,
  openImage: () => ipcRenderer.invoke('dialog:openImage') as Promise<string | null>,
  saveTempImage: (bytes: number[]) => ipcRenderer.invoke('image:save-temp', bytes) as Promise<string | null>
};

export const mcpApi = {
  getTools: () => ipcRenderer.invoke('mcp:get-tools'),
  onToolsUpdated: (cb: (payload: any) => void) => {
    ipcRenderer.removeAllListeners('mcp:tools-updated');
    ipcRenderer.on('mcp:tools-updated', (_e, data) => cb(data));
  },
  callTool: (call: McpToolCall) => ipcRenderer.invoke('mcp:call-tool', call),
  getServers: () => ipcRenderer.invoke('mcp:get-servers'),
  addServer: (config: Omit<McpServer, 'id'>) => ipcRenderer.invoke('mcp:add-server', config),
  startServer: (id: string) => ipcRenderer.invoke('mcp:start-server', id),
  stopServer: (id: string) => ipcRenderer.invoke('mcp:stop-server', id),
  removeServer: (id: string) => ipcRenderer.invoke('mcp:remove-server', id),
  getServerTools: (serverId: string) => ipcRenderer.invoke('mcp:get-server-tools', serverId),
  reloadConfig: () => ipcRenderer.invoke('mcp:reload-config'),
  getConfigPath: () => ipcRenderer.invoke('mcp:get-config-path'),
  updateServerConfig: (id: string, updates: any) => ipcRenderer.invoke('mcp:update-server-config', id, updates),
  setServerSecret: (id: string, key: string, value: string) => ipcRenderer.invoke('mcp:set-server-secret', id, key, value),
  getServerConfig: (id: string) => ipcRenderer.invoke('mcp:get-server-config', id),
  checkPackages: () => ipcRenderer.invoke('mcp:check-packages'),
  installPackages: (packages?: string[]) => ipcRenderer.invoke('mcp:install-packages', packages),
  getServerMetadata: (id: string) => ipcRenderer.invoke('mcp:get-server-metadata', id),
  checkServerDeps: (id: string) => ipcRenderer.invoke('mcp:check-server-deps', id),
  installServerDeps: (id: string) => ipcRenderer.invoke('mcp:install-server-deps', id),
  directorySearch: (term: string) => ipcRenderer.invoke('mcp:directory-search', term),
  directorySearchOnline: (term: string) => ipcRenderer.invoke('mcp:directory-search-online', term),
  directoryGet: (id: string) => ipcRenderer.invoke('mcp:directory-get', id),
  directoryReadme: (pkg: string) => ipcRenderer.invoke('mcp:directory-readme', pkg)
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
  generate: (id: string, messages: any[]) => ipcRenderer.invoke('external-models:generate', id, messages),
  onProgress: (cb: (payload: any) => void) => {
    ipcRenderer.on('external-models:progress', (_e, data) => cb(data));
  }
};

export const logsApi = {
  getRecent: (limit = 500) => ipcRenderer.invoke('logs:get-recent', limit),
  clear: () => ipcRenderer.invoke('logs:clear')
};

// Whisper IPC helper: accept ArrayBuffer/Uint8Array/number[] and convert safely to Buffer here (Node context)
export const whisperApi = {
  transcribe: (audioData: Buffer | ArrayBuffer | Uint8Array | number[], endpoint: string, language?: string) => {
    let buf: Buffer;
    try {
      if (Buffer.isBuffer(audioData)) buf = audioData as Buffer;
      else if (audioData instanceof Uint8Array) buf = Buffer.from(audioData);
      else if (audioData instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(audioData));
      else if (Array.isArray(audioData)) buf = Buffer.from(audioData);
      else throw new Error('Unsupported audio data type');
    } catch (e) {
      console.warn('whisperApi.transcribe: failed to build Buffer', e);
      throw e;
    }
    return ipcRenderer.invoke('whisper:transcribe', { audioData: buf, endpoint, language });
  }
};

// (Legacy) node API exposure retained for backward compatibility (not needed for STT now)
export const nodeApi = {
  Buffer: Buffer
};

contextBridge.exposeInMainWorld('ollama', api);
contextBridge.exposeInMainWorld('mcp', mcpApi);
contextBridge.exposeInMainWorld('electronAPI', electronApi);
contextBridge.exposeInMainWorld('externalModels', externalModelsApi);
contextBridge.exposeInMainWorld('logs', logsApi);
contextBridge.exposeInMainWorld('whisper', whisperApi);
contextBridge.exposeInMainWorld('nodeAPI', nodeApi);

declare global {
  interface Window {
    ollama: typeof api;
    mcp: typeof mcpApi;
    electronAPI: typeof electronApi;
    externalModels: typeof externalModelsApi;
    logs: typeof logsApi;
  }
}
