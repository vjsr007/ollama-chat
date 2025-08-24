export {};

declare global {
  interface Window {
    ollama: {
      listModels: () => Promise<string[]>;
      sendChat: (req: import('../shared/domain/chat').ChatRequest) => Promise<string>;
      openImage: () => Promise<string | null>;
    };
    mcp: {
      getTools: () => Promise<import('../shared/domain/mcp').McpTool[]>;
      callTool: (call: import('../shared/domain/mcp').McpToolCall) => Promise<import('../shared/domain/mcp').McpToolResult>;
      getServers: () => Promise<import('../shared/domain/mcp').McpServer[]>;
      addServer: (config: Omit<import('../shared/domain/mcp').McpServer, 'id'>) => Promise<string>;
      startServer: (id: string) => Promise<void>;
      stopServer: (id: string) => Promise<void>;
      removeServer: (id: string) => Promise<void>;
      getServerTools: (serverId: string) => Promise<import('../shared/domain/mcp').McpTool[]>;
    };
    electronAPI: {
      openFile: () => Promise<string | null>;
      openImage: () => Promise<string | null>;
      onProgress?: (callback: (event: any, data: any) => void) => void;
    };
    externalModels: {
      sendMessage: (message: string, modelId: string, images?: string[]) => Promise<{
        content: string;
        simulationDetected?: boolean;
        simulationIndicators?: string[];
      }>;
      onProgress: (callback: (data: any) => void) => void;
    };
    logs: {
      getRecent: (limit?: number) => Promise<Array<{timestamp: string, level: string, message: string}>>;
      clear: () => Promise<void>;
    };
    whisper: {
      transcribe: (
        audioData: Buffer | ArrayBuffer | Uint8Array | number[],
        endpoint: string,
        language?: string
      ) => Promise<{
        success: boolean;
        text?: string;
        error?: string;
      }>;
    };
    nodeAPI: {
      Buffer: typeof Buffer;
    };
  }
}
