// MCP Domain Models
export interface McpTool {
  name: string;
  description: string;
  schema: Record<string, {
    type: string;
    required?: boolean;
    description?: string;
  }>;
  origin?: string;
}

export interface McpServer {
  id: string;
  name: string;
  type: 'stdio' | 'ws' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  enabled: boolean;
  auto_restart?: boolean;
  status?: 'stopped' | 'starting' | 'ready' | 'error' | 'connecting' | 'closed';
}

export interface McpToolCall {
  tool: string;
  args: Record<string, any>;
  serverId?: string;
}

export interface McpToolResult {
  result?: any;
  error?: string;
  metadata?: {
    executionTime?: number;
    serverId?: string;
    cached?: boolean;
  };
}

export interface BuiltinToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    executionTime: number;
    tool: string;
  };
}
