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
    // Config from environment
    this.logLevel = (process.env.MCP_LOG_LEVEL || 'info').toLowerCase() as any;
  // Unified default timeout now aligned with .env.example (30s). Override via MCP_TIMEOUT env.
  const parsed = parseInt(process.env.MCP_TIMEOUT || '30000', 10);
  this.requestTimeoutMs = isNaN(parsed) ? 30000 : parsed;
    const conc = parseInt(process.env.MCP_MAX_CONCURRENT_TOOLS || '0', 10);
    this.maxConcurrentTools = isNaN(conc) ? 0 : conc; // 0 = unlimited
  }

  private logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  private requestTimeoutMs = 30000;
  private maxConcurrentTools = 0;
  private activeToolExecutions = 0;
  private toolQueue: Array<() => void> = [];

  private shouldLog(level: 'trace'|'debug'|'info'|'warn'|'error'): boolean {
    const order = ['trace','debug','info','warn','error'];
    return order.indexOf(level) >= order.indexOf(this.logLevel);
  }
  private log(level: 'trace'|'debug'|'info'|'warn'|'error', ...args: any[]) {
    if (!this.shouldLog(level)) return;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[MCP:${level}]`, ...args);
  }

  private runWithConcurrency<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.maxConcurrentTools || this.maxConcurrentTools <= 0) return fn();
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.activeToolExecutions++;
        fn().then(res => {
          this.activeToolExecutions--;
          this.nextFromQueue();
          resolve(res);
        }).catch(err => {
          this.activeToolExecutions--;
          this.nextFromQueue();
          reject(err);
        });
      };
      if (this.activeToolExecutions < this.maxConcurrentTools) {
        start();
      } else {
        this.toolQueue.push(start);
        this.log('trace', `Queued tool call. active=${this.activeToolExecutions} queue=${this.toolQueue.length}`);
      }
    });
  }

  private nextFromQueue() {
    if (this.toolQueue.length === 0) return;
    if (this.activeToolExecutions >= this.maxConcurrentTools) return;
    const fn = this.toolQueue.shift();
    if (fn) fn();
  }

  // Clear all registered external MCP servers (builtin tools remain)
  clearServers(): void {
    // Builtin tools are stored separately; just clear server map
    this.servers.clear();
  }

  // Reload configuration from disk (used by UI reload button)
  async reloadConfiguration(projectRoot: string = process.cwd()): Promise<void> {
    console.log('🔄 Reloading MCP configuration...');
    this.clearServers();
    await this.loadDefaultConfiguration(projectRoot);
    console.log('✅ Reload complete. Servers count:', this.servers.size);
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
    
    console.log(`🔧 Adding MCP server: ${server.name} (${id})`);
    
    const serverState = {
      config: server,
      status: 'stopped',
      tools: [],
      buffer: '',
      pending: new Map(),
      nextId: 0
    };
    
    this.servers.set(id, serverState);
    console.log(`✅ Server ${server.name} added to registry`);
    
    if (server.enabled) {
      console.log(`🚀 Auto-starting enabled server: ${server.name}`);
      await this.startServer(id);
    }
    
    return id;
  }

  async startServer(id: string): Promise<void> {
    const serverState = this.servers.get(id);
    if (!serverState) throw new Error(`Server ${id} not found`);
    
    const { config } = serverState;
    console.log(`🚀 Starting MCP server: ${config.name} (${id})`);
    console.log(`📋 Command: ${config.command} ${config.args?.join(' ') || ''}`);
    console.log(`📂 Working directory: ${config.cwd || this.projectRoot}`);
    
    if (config.type === 'stdio') {
      if (!config.command) throw new Error('Command required for stdio server');
      
      try {
        // Ensure npx is available by adding common Node.js paths to PATH
        const nodeJsPaths = [
          'C:\\Program Files\\nodejs',
          'C:\\Program Files (x86)\\nodejs',
          process.env.APPDATA ? `${process.env.APPDATA}\\npm` : '',
          process.env.USERPROFILE ? `${process.env.USERPROFILE}\\AppData\\Roaming\\npm` : ''
        ].filter(Boolean);
        
        const currentPath = process.env.PATH || '';
        const enhancedPath = [currentPath, ...nodeJsPaths].join(';');
        
        console.log(`🔧 Enhanced PATH to include Node.js directories`);
        console.log(`🌍 Environment variables:`, Object.keys(config.env || {}).join(', ') || 'none');
        
  // Allow secrets injection: if secretEnvKeys present, resolve from process env placeholder
  // The actual secret values should already be merged into config.env by the main process before calling startServer.
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
        
        console.log(`✅ Process created for ${config.name}, PID: ${proc.pid}`);
        
        serverState.process = proc;
        serverState.status = 'starting';
        
        proc.stdout?.on('data', (chunk) => {
          console.log(`📥 [${config.name} stdout]`, chunk.toString().trim().substring(0, 200));
          this.handleStdout(id, chunk);
        });
        
        proc.stderr?.on('data', (data) => {
          console.warn(`❌ [${config.name} stderr]`, data.toString().trim());
        });
        
        proc.on('error', (err) => {
          console.error(`💥 Error in server ${config.name} (${id}):`, err);
          serverState.status = 'error';
          this.emit('server-error', id, err);
        });
        
        proc.on('exit', (code, signal) => {
          console.log(`🔴 Server ${config.name} (${id}) terminated with code ${code}, signal ${signal}`);
          serverState.status = 'stopped';
          this.emit('server-stopped', id);
        });
        
        // Send initialize after a brief delay to let the process start
        console.log(`🔗 Sending initialization to ${config.name} (${id})`);
        setTimeout(async () => {
          try {
            console.log(`📤 Sending initialize message to ${config.name}`);
            await this.sendInitialize(id);
            // Send initialized notification to complete handshake
            console.log(`📤 Sending initialized notification to ${config.name}`);
            await this.sendInitialized(id);
            console.log(`✅ Server ${config.name} (${id}) initialized successfully`);
          } catch (error) {
            console.error(`❌ Error initializing ${config.name} (${id}):`, error);
            // Don't mark as error, just as stopped to allow retries
            serverState.status = 'stopped';
          }
        }, 1000); // Wait 1 second for the process to be ready
        
      } catch (error) {
        console.error(`❌ Error starting server ${config.name} (${id}):`, error);
        serverState.status = 'error';
        throw error;
      }
    }
    // TODO: Implement WebSocket and HTTP server types
  }

  private handleStdout(id: string, chunk: Buffer): void {
    const serverState = this.servers.get(id);
    if (!serverState) return;
    
    const chunkStr = chunk.toString();
    console.log(`📊 [${serverState.config.name}] Received ${chunkStr.length} bytes of data`);
    
    serverState.buffer += chunkStr;
    
    // Process line-delimited JSON messages
    const lines = serverState.buffer.split('\n');
    serverState.buffer = lines.pop() || '';
    
    console.log(`🔍 [${serverState.config.name}] Processing ${lines.length} lines`);
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      try {
        const message = JSON.parse(trimmed);
        console.log(`📨 [${serverState.config.name}] Parsed JSON-RPC message:`, message.method || 'response', message.id ? `(id: ${message.id})` : '');
        this.handleJsonRpcMessage(id, message);
      } catch (error) {
        console.warn(`⚠️ [${serverState.config.name}] Failed to parse JSON:`, trimmed.substring(0, 100));
      }
    }
  }

  private handleJsonRpcMessage(id: string, message: any): void {
    const serverState = this.servers.get(id);
    if (!serverState) return;
    
    console.log(`🔄 [${serverState.config.name}] Handling JSON-RPC message type:`, message.method || 'response');
    
    // Handle responses to our requests
    if (message.id && serverState.pending.has(message.id)) {
      const { resolve, reject, timeout } = serverState.pending.get(message.id)!;
      clearTimeout(timeout);
      serverState.pending.delete(message.id);
      
      console.log(`📬 [${serverState.config.name}] Received response for request ${message.id}`);
      
      if (message.error) {
        console.error(`❌ [${serverState.config.name}] Error response:`, message.error);
        reject(new Error(message.error.message || 'Unknown MCP error'));
      } else {
        console.log(`✅ [${serverState.config.name}] Successful response for ${message.id}`);
        resolve(message.result);
      }
      return;
    }
    
    // Handle notifications
    if (message.method === 'notifications/initialized') {
      console.log(`🎉 [${serverState.config.name}] Server initialized notification received`);
      serverState.status = 'ready';
      this.emit('server-ready', id);
      this.requestToolsList(id);
    }
  }

  private async sendInitialize(id: string): Promise<void> {
    console.log(`📤 [${id}] Preparing initialize message`);
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
    
    console.log(`🚀 [${id}] Sending initialize request with protocol version 2024-11-05`);
    await this.sendJsonRpcRequest(id, initMessage);
    console.log(`✅ [${id}] Initialize request sent successfully`);
  }

  private async sendInitialized(id: string): Promise<void> {
    const serverState = this.servers.get(id);
    if (!serverState?.process?.stdin) {
      throw new Error(`Server ${id} not available for communication`);
    }

    console.log(`📤 [${serverState.config.name}] Sending initialized notification`);
    const initializedMessage = {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    };
    
    try {
      serverState.process.stdin.write(JSON.stringify(initializedMessage) + '\n');
      console.log(`✅ [${serverState.config.name}] Initialized notification sent successfully`);
      
      // Mark server as ready and request tools list
      serverState.status = 'ready';
      console.log(`🔧 [${serverState.config.name}] Server status set to ready, requesting tools list`);
      await this.requestToolsList(id);
    } catch (error) {
      console.error(`❌ [${serverState.config.name}] Error sending initialized notification:`, error);
      throw error;
    }
  }

  private async requestToolsList(id: string): Promise<void> {
    const serverState = this.servers.get(id);
    if (!serverState) {
      console.error(`❌ Server ${id} not found when requesting tools list`);
      return;
    }

    console.log(`📋 [${serverState.config.name}] Requesting tools list`);
    try {
      const result = await this.sendJsonRpcRequest(id, {
        jsonrpc: '2.0',
        id: `tools-${Date.now()}`,
        method: 'tools/list'
      });
      
      if (serverState && result.tools) {
        serverState.tools = result.tools;
        console.log(`🔧 [${serverState.config.name}] Received ${result.tools.length} tools:`, 
          result.tools.map((t: any) => t.name).join(', '));
        this.emit('tools-updated', id, result.tools);
      } else {
        console.warn(`⚠️ [${serverState.config.name}] No tools received in response`);
      }
    } catch (error) {
      console.warn(`❌ [${serverState.config.name}] Failed to get tools list:`, error instanceof Error ? error.message : error);
    }
  }

  private async sendJsonRpcRequest(id: string, message: any, timeoutMs = this.requestTimeoutMs): Promise<any> {
    const serverState = this.servers.get(id);
    if (!serverState?.process?.stdin) {
      throw new Error(`Server ${id} not available for JSON-RPC communication`);
    }
    
  this.log('debug', `[${serverState.config.name}] -> ${message.method} (id ${message.id}) timeout=${timeoutMs}`);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (serverState.pending.has(message.id)) {
          serverState.pending.delete(message.id);
          console.error(`⏰ [${serverState.config.name}] Request ${message.id} timed out after ${timeoutMs}ms`);
          reject(new Error(`Request timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      
      serverState.pending.set(message.id, { resolve, reject, timeout });
  this.log('trace', `[${serverState.config.name}] pending=${serverState.pending.size}`);
      
      try {
        const messageStr = JSON.stringify(message);
  this.log('trace', `[${serverState.config.name}] write ${messageStr.length} chars`);
        serverState.process!.stdin!.write(messageStr + '\n');
  this.log('trace', `[${serverState.config.name}] message sent`);
      } catch (error) {
        clearTimeout(timeout);
        serverState.pending.delete(message.id);
        console.error(`❌ [${serverState.config.name}] Error sending message:`, error);
        reject(error);
      }
    });
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const { tool, args, serverId } = call;
    
    console.log(`🔧 Tool call requested: ${tool} with args:`, Object.keys(args).join(', '));
  this.log('info', `Tool call: ${tool}`);
    
    // Check if it's a builtin tool
    if (this.builtinTools.some(t => t.name === tool)) {
      console.log(`🏠 Using builtin tool: ${tool}`);
  this.log('debug', `Builtin tool ${tool}`);
      const result = await this.callBuiltinTool(tool, args);
      console.log(`✅ Builtin tool ${tool} completed in ${result.metadata?.executionTime}ms`);
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
      console.log(`🔍 Finding server for tool: ${tool}`);
  this.log('debug', `Finding server for tool ${tool}`);
      // Try to find which server provides this tool
      const foundServerId = this.findServerForTool(tool);
      if (!foundServerId) {
        console.error(`❌ Tool '${tool}' not found in any available server`);
        throw new Error(`Tool '${tool}' not found in any available server`);
      }
      targetServerId = foundServerId;
      console.log(`📍 Found tool ${tool} in server: ${targetServerId}`);
  this.log('trace', `Found tool ${tool} server=${targetServerId}`);
    }

    const serverState = this.servers.get(targetServerId);
    if (!serverState) {
      console.error(`❌ Server ${targetServerId} not found in registry`);
      throw new Error(`Server ${targetServerId} not found`);
    }
    
  console.log(`🔄 [${serverState.config.name}] Server status: ${serverState.status}`);
  this.log('trace', `[${serverState.config.name}] status=${serverState.status}`);
    if (serverState.status !== 'ready') {
      console.error(`❌ [${serverState.config.name}] Server not ready (status: ${serverState.status})`);
      throw new Error(`Server ${targetServerId} not ready (status: ${serverState.status})`);
    }
    
    const startTime = Date.now();
  console.log(`⚡ [${serverState.config.name}] Executing tool: ${tool}`);
  this.log('debug', `[${serverState.config.name}] exec tool ${tool}`);
    
    try {
      const execFn = async () => this.sendJsonRpcRequest(targetServerId, {
        jsonrpc: '2.0',
        id: `tool-${Date.now()}-${serverState.nextId++}`,
        method: 'tools/call',
        params: { name: tool, arguments: args }
      });
      const result = await this.runWithConcurrency(execFn);
      const executionTime = Date.now() - startTime;
      console.log(`✅ [${serverState.config.name}] Tool ${tool} completed successfully in ${executionTime}ms`);
      this.log('info', `[${serverState.config.name}] tool ${tool} ok ${executionTime}ms`);
      return {
        result: result.content || result,
        metadata: {
          serverId: targetServerId,
          cached: false,
          executionTime
        }
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`❌ [${serverState.config.name}] Tool ${tool} failed after ${executionTime}ms:`, error instanceof Error ? error.message : error);
      this.log('error', `[${serverState.config.name}] tool ${tool} failed`, error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          serverId: targetServerId,
          cached: false,
          executionTime
        }
      };
    }
  }

  stopServer(id: string): void {
    const serverState = this.servers.get(id);
    if (!serverState) {
      console.warn(`⚠️ Cannot stop server ${id}: not found in registry`);
      return;
    }
    
    console.log(`🛑 Stopping server: ${serverState.config.name} (${id})`);
    
    if (serverState.process) {
      console.log(`💀 Killing process PID: ${serverState.process.pid}`);
      serverState.process.kill();
    }
    
    // Clear any pending requests
    if (serverState.pending.size > 0) {
      console.log(`🧹 Clearing ${serverState.pending.size} pending requests`);
      for (const [requestId, { reject, timeout }] of serverState.pending) {
        clearTimeout(timeout);
        reject(new Error('Server stopped'));
      }
      serverState.pending.clear();
    }
    
    serverState.status = 'stopped';
    console.log(`✅ Server ${serverState.config.name} stopped successfully`);
    this.emit('server-stopped', id);
  }

  removeServer(id: string): void {
    const serverState = this.servers.get(id);
    console.log(`🗑️ Removing server: ${serverState?.config.name || id}`);
    this.stopServer(id);
    this.servers.delete(id);
    console.log(`✅ Server ${serverState?.config.name || id} removed from registry`);
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
    
    // Get all servers with their tools and sort by priority
    const serverEntries = Array.from(this.servers.entries())
      .filter(([_, serverState]) => serverState.status === 'ready')
      .sort((a, b) => {
        const priorityA = a[1].config.priority || 999;
        const priorityB = b[1].config.priority || 999;
        return priorityA - priorityB;
      });

    // Add tools in priority order
    for (const [_, serverState] of serverEntries) {
      allTools.push(...serverState.tools);
    }
    
    return allTools;
  }

  getAllToolsPrioritized(maxTools?: number): McpTool[] {
    const allTools = this.getAllTools(); // Already prioritized by server priority
    
    if (maxTools && allTools.length > maxTools) {
      // Additional terminal tool prioritization within the already sorted list
      const terminalToolNames = [
        'mcp_copilot-termi',
        'run_terminal_command',
        'get_terminal_output', 
        'create_terminal',
        'list_terminals',
        'kill_terminal',
        'send_command',
        'execute_command',
        'terminal',
        'command'
      ];
      
      const prioritizedTools: McpTool[] = [];
      const remainingTools: McpTool[] = [];
      
      allTools.forEach(tool => {
        if (terminalToolNames.some(name => 
          tool.name.toLowerCase().includes(name.toLowerCase()) || 
          tool.description?.toLowerCase().includes('terminal') ||
          tool.description?.toLowerCase().includes('command')
        )) {
          prioritizedTools.push(tool);
        } else {
          remainingTools.push(tool);
        }
      });
      
      // Return terminal tools first, then fill with others up to maxTools
      const result = [...prioritizedTools];
      const remainingSlots = maxTools - result.length;
      if (remainingSlots > 0) {
        result.push(...remainingTools.slice(0, remainingSlots));
      }
      
      return result.slice(0, maxTools);
    }
    
    return allTools;
  }

  // Get only terminal-focused tools for terminal-heavy workflows
  getTerminalTools(): McpTool[] {
    const allTools = this.getAllTools();
    
    return allTools.filter(tool => {
      const isTerminalTool = tool.name.toLowerCase().includes('terminal') ||
                           tool.name.toLowerCase().includes('command') ||
                           tool.name.toLowerCase().includes('mcp_copilot-termi') ||
                           tool.description?.toLowerCase().includes('terminal') ||
                           tool.description?.toLowerCase().includes('command');
      
      // Also include essential filesystem tools that work well with terminal workflows
      const isEssentialFileSystem = ['read_file', 'write_file', 'list_dir'].includes(tool.name);
      
      return isTerminalTool || isEssentialFileSystem;
    });
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
      
      // Search for configuration files in order of preference.
      // When packaged with electron-builder on Windows (MSI / NSIS), extraResources are placed under
      //   <installRoot>/resources/app/config
      // so we add those paths as fallbacks.
      const resourceRootCandidates: string[] = [];
      try {
        // __dirname resolution will differ between dev (src/...) and prod (dist/...)
        const possibleAppRoots = [
          projectRoot,
          path.join(process.cwd(), 'config'),
          path.join(process.cwd(), 'resources', 'app', 'config'),
          path.join(__dirname, '..', '..', '..', 'config'),
          // When packaged: resources/config (extraResources target) & resources/app/config (if ever used)
          (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'config') : undefined,
          (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'app', 'config') : undefined
        ];
        for (const p of possibleAppRoots) {
          if (p && !resourceRootCandidates.includes(p)) resourceRootCandidates.push(p);
        }
      } catch {
        // ignore
      }

      const configFiles = [
        'mcp-servers.json',
        'mcp-config-simple.json',
        'mcp-quick-config.json'
      ];
      
      let configLoaded = false;
      
      for (const configFile of configFiles) {
        for (const root of resourceRootCandidates) {
          try {
            const configPath = path.join(root, configFile);
            console.log('📂 Checking configuration file:', configPath);
            const configContent = await fs.readFile(configPath, 'utf-8');
            const config = JSON.parse(configContent);
            console.log('✅ Configuration file found and parsed:', configFile, 'at', root);
          
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
                enabled: false, // Don't auto-start by default
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
              
              console.log(`✅ MCP server "${id}" added (category: ${typedConfig.category})`);
            }
            
            configLoaded = true;
            console.log('✅ MCP configuration loaded successfully from', configPath);
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
                
                console.log(`✅ MCP server "${id}" added successfully`);
              }
            }
            
            configLoaded = true;
            console.log('✅ MCP configuration loaded successfully from', configPath);
            break;
          }
          
          } catch (error) {
            // File doesn't exist or parsing error, continue with next root
            console.log('❌ Could not load configuration file:', configFile, 'at', root, '-', error instanceof Error ? error.message : error);
            continue;
          }
        }
        if (configLoaded) break; // break outer loop if loaded
      }
      
      if (!configLoaded) {
        console.log('📝 No MCP configuration found, using built-in tools only');
      } else {
        console.log(`🎯 Total servers configured: ${this.servers.size}`);
      }
      
    } catch (error) {
      console.error('⚠️ Error loading MCP configuration:', error);
    }
  }

  // Utility method to check available servers
  async checkAvailableServers(): Promise<string[]> {
    console.log('🔍 Checking for available MCP servers');
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
    
    console.log(`🧪 Testing ${installedServers.length} known server packages`);
    
    for (const serverName of installedServers) {
      try {
        console.log(`🔎 Checking availability of server: ${serverName}`);
        // Try to verify if the package is available globally
        const { spawn } = require('child_process');
        const process = spawn('npm', ['list', '-g', `@modelcontextprotocol/server-${serverName}`], { 
          stdio: 'pipe' 
        });
        
        await new Promise((resolve) => {
          process.on('exit', (code: number) => {
            if (code === 0) {
              console.log(`✅ Server ${serverName} is available globally`);
              available.push(serverName);
            } else {
              console.log(`❌ Server ${serverName} not found globally`);
            }
            resolve(code);
          });
        });
      } catch (error) {
        console.warn(`⚠️ Error checking server ${serverName}:`, error instanceof Error ? error.message : error);
      }
    }
    
    console.log(`📊 Found ${available.length} available servers:`, available.join(', '));
    return available;
  }
}
