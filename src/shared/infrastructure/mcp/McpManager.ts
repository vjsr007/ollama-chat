import { McpTool, McpServer, McpToolCall, McpToolResult, BuiltinToolResult } from '../../domain/mcp';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class McpManager extends EventEmitter {
  private servers = new Map<string, {
    config: McpServer;
    process?: ChildProcess;
    status: string;
    tools: McpTool[];
    buffer: string;
    pending: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>;
    nextId: number;
  }>();

  private builtinTools: McpTool[] = [
    {
      name: 'list_dir',
      description: 'List directory contents relative to project root',
      schema: {
        path: { type: 'string', required: false, description: 'Relative path, default "."' }
      },
      origin: 'builtin'
    },
    {
      name: 'read_file',
      description: 'Read a text file (max 200KB)',
      schema: {
        path: { type: 'string', required: true, description: 'Relative path to file' }
      },
      origin: 'builtin'
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a text file (max 100KB)',
      schema: {
        path: { type: 'string', required: true, description: 'Relative path to file' },
        content: { type: 'string', required: true, description: 'File content' }
      },
      origin: 'builtin'
    },
    {
      name: 'path_info',
      description: 'Get information about a path',
      schema: {
        path: { type: 'string', required: true, description: 'Relative path to check' }
      },
      origin: 'builtin'
    }
  ];

  private projectRoot: string;

  constructor(projectRoot?: string) {
    super();
    this.projectRoot = projectRoot || process.cwd();
  }

  // Built-in tools implementation
  async callBuiltinTool(toolName: string, args: Record<string, any>): Promise<BuiltinToolResult> {
    const startTime = Date.now();
    
    try {
      switch (toolName) {
        case 'list_dir':
          return await this.listDirectory(args.path || '.');
        case 'read_file':
          return await this.readFile(args.path);
        case 'write_file':
          return await this.writeFile(args.path, args.content);
        case 'path_info':
          return await this.getPathInfo(args.path);
        default:
          throw new Error(`Unknown builtin tool: ${toolName}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          executionTime: Date.now() - startTime,
          tool: toolName
        }
      };
    }
  }

  private async listDirectory(relativePath: string): Promise<BuiltinToolResult> {
    const startTime = Date.now();
    const safePath = this.resolveSafePath(relativePath);
    
    try {
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const result = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : 'file'
      }));

      return {
        success: true,
        data: result,
        metadata: {
          executionTime: Date.now() - startTime,
          tool: 'list_dir'
        }
      };
    } catch (error) {
      throw new Error(`Failed to list directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async readFile(relativePath: string): Promise<BuiltinToolResult> {
    const startTime = Date.now();
    const safePath = this.resolveSafePath(relativePath);
    
    try {
      const stat = await fs.stat(safePath);
      if (stat.size > 200 * 1024) {
        throw new Error('File too large (limit 200KB)');
      }

      const content = await fs.readFile(safePath, 'utf8');
      
      return {
        success: true,
        data: {
          path: relativePath,
          size: stat.size,
          content
        },
        metadata: {
          executionTime: Date.now() - startTime,
          tool: 'read_file'
        }
      };
    } catch (error) {
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async writeFile(relativePath: string, content: string): Promise<BuiltinToolResult> {
    const startTime = Date.now();
    
    if (content.length > 100 * 1024) {
      throw new Error('Content too large (limit 100KB)');
    }

    const safePath = this.resolveSafePath(relativePath);
    
    try {
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, content, 'utf8');
      
      return {
        success: true,
        data: {
          written: true,
          path: relativePath,
          bytes: content.length
        },
        metadata: {
          executionTime: Date.now() - startTime,
          tool: 'write_file'
        }
      };
    } catch (error) {
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getPathInfo(relativePath: string): Promise<BuiltinToolResult> {
    const startTime = Date.now();
    const safePath = this.resolveSafePath(relativePath);
    
    try {
      let exists = true;
      let type = 'unknown';
      
      try {
        const stat = await fs.stat(safePath);
        type = stat.isDirectory() ? 'dir' : 'file';
      } catch {
        exists = false;
      }

      return {
        success: true,
        data: {
          input: relativePath,
          full: safePath,
          exists,
          type
        },
        metadata: {
          executionTime: Date.now() - startTime,
          tool: 'path_info'
        }
      };
    } catch (error) {
      throw new Error(`Failed to get path info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private resolveSafePath(relativePath: string): string {
    if (!relativePath || relativePath === '.') {
      return this.projectRoot;
    }
    
    // Reject attempts to traverse up
    if (relativePath.includes('..')) {
      throw new Error('Parent segments (..) not allowed');
    }
    
    // If absolute path provided
    if (path.isAbsolute(relativePath)) {
      const normalizedAbs = path.normalize(relativePath);
      // Allow only if inside project root
      if (normalizedAbs.toLowerCase().startsWith(this.projectRoot.toLowerCase())) {
        return normalizedAbs;
      }
      throw new Error('Absolute paths not allowed. Use relative path within project');
    }
    
    const target = path.normalize(path.join(this.projectRoot, relativePath));
    if (!target.toLowerCase().startsWith(this.projectRoot.toLowerCase())) {
      throw new Error('Path outside of project');
    }
    
    return target;
  }

  // Server management
  async addServer(config: Omit<McpServer, 'id'>): Promise<string> {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const server: McpServer = { ...config, id };
    
    const serverState = {
      config: server,
      status: 'stopped',
      tools: [],
      buffer: '',
      pending: new Map(),
      nextId: 0
    };
    
    this.servers.set(id, serverState);
    
    if (server.enabled) {
      await this.startServer(id);
    }
    
    return id;
  }

  async startServer(id: string): Promise<void> {
    const serverState = this.servers.get(id);
    if (!serverState) throw new Error(`Server ${id} not found`);
    
    const { config } = serverState;
    console.log(`🚀 Starting MCP server: ${id}`);
    console.log(`📋 Command: ${config.command} ${config.args?.join(' ') || ''}`);
    
    if (config.type === 'stdio') {
      if (!config.command) throw new Error('Command required for stdio server');
      
      try {
        // Asegurar que npx esté disponible agregando rutas comunes de Node.js al PATH
        const nodeJsPaths = [
          'C:\\Program Files\\nodejs',
          'C:\\Program Files (x86)\\nodejs',
          process.env.APPDATA ? `${process.env.APPDATA}\\npm` : '',
          process.env.USERPROFILE ? `${process.env.USERPROFILE}\\AppData\\Roaming\\npm` : ''
        ].filter(Boolean);
        
        const currentPath = process.env.PATH || '';
        const enhancedPath = [currentPath, ...nodeJsPaths].join(';');
        
        console.log(`🔧 Enhanced PATH to include Node.js`);
        
        const proc = spawn(config.command, config.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { 
            ...process.env, 
            ...config.env,
            PATH: enhancedPath
          },
          cwd: config.cwd || this.projectRoot,
          shell: true // Use shell for better Windows compatibility
        });
        
        console.log(`✅ Process created for ${id}, PID: ${proc.pid}`);
        
        serverState.process = proc;
        serverState.status = 'starting';
        
        proc.stdout?.on('data', (chunk) => this.handleStdout(id, chunk));
        proc.stderr?.on('data', (data) => {
          console.warn(`❌ [${config.name} stderr]`, data.toString().trim());
        });
        
        proc.on('error', (err) => {
          console.error(`💥 Error in server ${id}:`, err);
          serverState.status = 'error';
          this.emit('server-error', id, err);
        });
        
        proc.on('exit', (code, signal) => {
          console.log(`🔴 Server ${id} terminated with code ${code}, signal ${signal}`);
          serverState.status = 'stopped';
          this.emit('server-stopped', id);
        });
        
        // Send initialize after a brief delay to let the process start
        console.log(`🔗 Sending initialization to ${id}`);
        setTimeout(async () => {
          try {
            await this.sendInitialize(id);
            // Send initialized notification to complete handshake
            await this.sendInitialized(id);
            console.log(`✅ Server ${id} initialized correctly`);
          } catch (error) {
            console.error(`❌ Error initializing ${id}:`, error);
            // Don't mark as error, just as stopped to allow retries
            serverState.status = 'stopped';
          }
        }, 1000); // Wait 1 second for the process to be ready
        
      } catch (error) {
        console.error(`❌ Error starting server ${id}:`, error);
        serverState.status = 'error';
        throw error;
      }
    }
    // TODO: Implement WebSocket and HTTP server types
  }

  private handleStdout(id: string, chunk: Buffer): void {
    const serverState = this.servers.get(id);
    if (!serverState) return;
    
    serverState.buffer += chunk.toString();
    
    // Process line-delimited JSON messages
    const lines = serverState.buffer.split('\n');
    serverState.buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      try {
        const message = JSON.parse(trimmed);
        this.handleJsonRpcMessage(id, message);
      } catch (error) {
        console.warn(`Failed to parse JSON from ${serverState.config.name}:`, trimmed);
      }
    }
  }

  private handleJsonRpcMessage(id: string, message: any): void {
    const serverState = this.servers.get(id);
    if (!serverState) return;
    
    // Handle responses to our requests
    if (message.id && serverState.pending.has(message.id)) {
      const { resolve, reject, timeout } = serverState.pending.get(message.id)!;
      clearTimeout(timeout);
      serverState.pending.delete(message.id);
      
      if (message.error) {
        reject(new Error(message.error.message || 'Unknown MCP error'));
      } else {
        resolve(message.result);
      }
      return;
    }
    
    // Handle notifications
    if (message.method === 'notifications/initialized') {
      serverState.status = 'ready';
      this.emit('server-ready', id);
      this.requestToolsList(id);
    }
  }

  private async sendInitialize(id: string): Promise<void> {
    const initMessage = {
      jsonrpc: '2.0',
      id: `init-${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'ollama-chat', version: '0.1.0' },
        capabilities: {}
      }
    };
    
    await this.sendJsonRpcRequest(id, initMessage);
  }

  private async sendInitialized(id: string): Promise<void> {
    const serverState = this.servers.get(id);
    if (!serverState?.process?.stdin) {
      throw new Error(`Server ${id} not available`);
    }

    const initializedMessage = {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    };
    
    try {
      serverState.process.stdin.write(JSON.stringify(initializedMessage) + '\n');
      console.log(`📡 Sent initialized message to ${id}`);
      
      // Mark server as ready and request tools list
      serverState.status = 'ready';
      await this.requestToolsList(id);
    } catch (error) {
      console.error(`❌ Error enviando initialized a ${id}:`, error);
      throw error;
    }
  }

  private async requestToolsList(id: string): Promise<void> {
    try {
      const result = await this.sendJsonRpcRequest(id, {
        jsonrpc: '2.0',
        id: `tools-${Date.now()}`,
        method: 'tools/list'
      });
      
      const serverState = this.servers.get(id);
      if (serverState && result.tools) {
        serverState.tools = result.tools;
        this.emit('tools-updated', id, result.tools);
      }
    } catch (error) {
      console.warn(`Failed to get tools list from server ${id}:`, error);
    }
  }

  private async sendJsonRpcRequest(id: string, message: any, timeoutMs = 5000): Promise<any> {
    const serverState = this.servers.get(id);
    if (!serverState?.process?.stdin) {
      throw new Error(`Server ${id} not available`);
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (serverState.pending.has(message.id)) {
          serverState.pending.delete(message.id);
          reject(new Error('Request timeout'));
        }
      }, timeoutMs);
      
      serverState.pending.set(message.id, { resolve, reject, timeout });
      
      try {
        serverState.process!.stdin!.write(JSON.stringify(message) + '\n');
      } catch (error) {
        clearTimeout(timeout);
        serverState.pending.delete(message.id);
        reject(error);
      }
    });
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const { tool, args, serverId } = call;
    
    // Check if it's a builtin tool
    if (this.builtinTools.some(t => t.name === tool)) {
      const result = await this.callBuiltinTool(tool, args);
      return {
        result: result.data,
        error: result.error,
        metadata: {
          executionTime: result.metadata?.executionTime,
          serverId: 'builtin',
          cached: false
        }
      };
    }
    
    // Call external server tool
    let targetServerId = serverId;
    if (!targetServerId) {
      // Try to find which server provides this tool
      const foundServerId = this.findServerForTool(tool);
      if (!foundServerId) {
        throw new Error(`Tool '${tool}' not found in any available server`);
      }
      targetServerId = foundServerId;
    }

    const serverState = this.servers.get(targetServerId);
    if (!serverState) {
      throw new Error(`Server ${targetServerId} not found`);
    }
    
    if (serverState.status !== 'ready') {
      throw new Error(`Server ${targetServerId} not ready (status: ${serverState.status})`);
    }
    
    try {
      const result = await this.sendJsonRpcRequest(targetServerId, {
        jsonrpc: '2.0',
        id: `tool-${Date.now()}-${serverState.nextId++}`,
        method: 'tools/call',
        params: { name: tool, arguments: args }
      });
      
      return {
        result: result.content || result,
        metadata: {
          serverId: targetServerId,
          cached: false
        }
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          serverId,
          cached: false
        }
      };
    }
  }

  stopServer(id: string): void {
    const serverState = this.servers.get(id);
    if (!serverState) return;
    
    if (serverState.process) {
      serverState.process.kill();
    }
    
    serverState.status = 'stopped';
    this.emit('server-stopped', id);
  }

  removeServer(id: string): void {
    this.stopServer(id);
    this.servers.delete(id);
  }

  getServers(): McpServer[] {
    return Array.from(this.servers.values()).map(state => ({
      ...state.config,
      status: state.status as McpServer['status']
    }));
  }

  getServerTools(serverId: string): McpTool[] {
    const serverState = this.servers.get(serverId);
    return serverState ? serverState.tools : [];
  }

  getAllTools(): McpTool[] {
    const allTools = [...this.builtinTools];
    
    for (const serverState of this.servers.values()) {
      if (serverState.status === 'ready') {
        allTools.push(...serverState.tools);
      }
    }
    
    return allTools;
  }

  findServerForTool(toolName: string): string | null {
    // Check if it's a builtin tool first
    const builtinTool = this.builtinTools.find(tool => tool.name === toolName);
    if (builtinTool) {
      return null; // builtin tools don't need a server ID
    }

    // Search through all servers for the tool
    for (const [serverId, serverState] of this.servers.entries()) {
      if (serverState.status === 'ready') {
        const tool = serverState.tools.find(t => t.name === toolName);
        if (tool) {
          return serverId;
        }
      }
    }

    return null; // tool not found
  }

  // Auto-configuration for development environment
  async loadDefaultConfiguration(projectRoot: string = process.cwd()): Promise<void> {
    try {
      console.log('🔍 Searching for MCP configuration in:', projectRoot);
      
      // Buscar archivos de configuración en orden de preferencia
      const configFiles = [
        'mcp-servers.json',
        'mcp-config-simple.json',
        'mcp-quick-config.json'
      ];
      
      let configLoaded = false;
      
      for (const configFile of configFiles) {
        try {
          const configPath = path.join(projectRoot, configFile);
          console.log('📂 Checking file:', configPath);
          
          const configContent = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(configContent);
          console.log('✅ File found and parsed:', configFile);
          
          // Load servers from mcp-servers.json file
          if (config.servers) {
            console.log(`📋 Loading ${Object.keys(config.servers).length} MCP servers from ${configFile}`);
            
            for (const [id, serverConfig] of Object.entries(config.servers)) {
              const typedConfig = serverConfig as any;
              
              // Create MCP server but mark as available (don't auto-start)
              const mcpServer: McpServer = {
                id,
                name: typedConfig.description || id,
                type: typedConfig.type || 'stdio',
                command: typedConfig.command,
                args: typedConfig.args,
                status: 'stopped',
                enabled: false, // No auto-iniciar por defecto
                description: typedConfig.description,
                category: typedConfig.category
              };
              
              // Add server without starting it automatically
              this.servers.set(id, {
                config: mcpServer,
                status: 'stopped',
                tools: [],
                buffer: '',
                pending: new Map(),
                nextId: 1
              });
              
              console.log(`✅ MCP server "${id}" added (${typedConfig.category})`);
            }
            
            configLoaded = true;
            console.log('✅ MCP configuration loaded from', configPath);
            break;
          }
          
          // Load servers from other configuration formats
          if (config.external_servers || config.working_servers) {
            const servers = config.external_servers || config.working_servers;
            console.log(`📋 Loading ${Object.keys(servers).length} MCP servers from ${configFile}`);
            
            for (const [id, serverConfig] of Object.entries(servers)) {
              const typedConfig = serverConfig as any;
              if (typedConfig.command) {
                const mcpServer: McpServer = {
                  id,
                  name: id,
                  type: typedConfig.type || 'stdio',
                  command: typedConfig.command,
                  args: typedConfig.args,
                  status: 'stopped',
                  enabled: typedConfig.enabled || false,
                  description: typedConfig.description,
                  category: typedConfig.category
                };
                
                this.servers.set(id, {
                  config: mcpServer,
                  status: 'stopped',
                  tools: [],
                  buffer: '',
                  pending: new Map(),
                  nextId: 1
                });
                
                console.log(`✅ MCP server "${id}" added`);
              }
            }
            
            configLoaded = true;
            console.log('✅ MCP configuration loaded from', configPath);
            break;
          }
          
        } catch (error) {
          // File doesn't exist or parsing error, continue with next
          console.log('❌ Could not load configuration file:', configFile, error instanceof Error ? error.message : error);
          continue;
        }
      }
      
      if (!configLoaded) {
        console.log('📝 No MCP configuration found, using built-in tools only');
      }
      
    } catch (error) {
      console.error('⚠️ Error loading MCP configuration:', error);
    }
  }

  // Utility method to check available servers
  async checkAvailableServers(): Promise<string[]> {
    const available: string[] = [];
    
    // Servers we know are installed
    const installedServers = [
      'filesystem',
      'brave-search', 
      'github',
      'postgres',
      'puppeteer',
      'memory'
    ];
    
    for (const serverName of installedServers) {
      try {
        // Intentar verificar si el paquete está disponible globalmente
        const { spawn } = require('child_process');
        const process = spawn('npm', ['list', '-g', `@modelcontextprotocol/server-${serverName}`], { 
          stdio: 'pipe' 
        });
        
        await new Promise((resolve) => {
          process.on('exit', (code: number) => {
            if (code === 0) {
              available.push(serverName);
            }
            resolve(code);
          });
        });
      } catch (error) {
        // Server not available
      }
    }
    
    return available;
  }
}
