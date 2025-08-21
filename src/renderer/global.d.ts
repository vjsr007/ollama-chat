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
  }
}
