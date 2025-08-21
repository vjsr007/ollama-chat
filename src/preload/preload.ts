import { contextBridge, ipcRenderer } from 'electron';
import { ChatRequest } from '../shared/domain/chat';

export const api = {
  listModels: () => ipcRenderer.invoke('models:list') as Promise<string[]>,
  sendChat: (req: ChatRequest) => ipcRenderer.invoke('chat:send', req) as Promise<string>,
  openImage: () => ipcRenderer.invoke('dialog:openImage') as Promise<string | null>
};

contextBridge.exposeInMainWorld('ollama', api);

declare global {
  interface Window {
    ollama: typeof api;
  }
}
