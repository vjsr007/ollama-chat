#!/usr/bin/env node

/**
 * MCP Server for Full System Access
 * Provides unrestricted access to the computer's resources
 * WARNING: This gives complete access to the system - use with caution
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

class SystemAccessServer {
  constructor() {
    this.server = new Server(
      {
        name: 'system-access-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  setupErrorHandling() {
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'system_read_file',
          description: 'Read any file from anywhere in the system (no restrictions)',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to the file (e.g., C:\\Users\\Desktop\\file.txt)'
              }
            },
            required: ['path']
          }
        },
        {
          name: 'system_write_file',
          description: 'Write to any file anywhere in the system (no restrictions)',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to the file'
              },
              content: {
                type: 'string',
                description: 'Content to write to the file'
              },
              encoding: {
                type: 'string',
                description: 'File encoding (default: utf8)',
                default: 'utf8'
              }
            },
            required: ['path', 'content']
          }
        },
        {
          name: 'system_list_directory',
          description: 'List contents of any directory (supports optional JSON output and truncation)',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to directory (e.g., C:\\Users\\Desktop)'
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to list recursively',
                default: false
              },
              maxDepth: {
                type: 'number',
                description: 'Maximum recursion depth (default 3)',
                default: 3
              },
              format: {
                type: 'string',
                description: 'Output format: text | json',
                default: 'text'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of entries returned (default 500)',
                default: 500
              }
            },
            required: ['path']
          }
        },
        {
          name: 'system_export_directory_listing',
          description: 'Create a text (or JSON) file with a directory listing in a single step (avoids huge chat payload)',
          inputSchema: {
            type: 'object',
            properties: {
              dir_path: { type: 'string', description: 'Directory to list' },
              output_path: { type: 'string', description: 'Output file absolute path (will overwrite)' },
              // Common alias names the model may hallucinate:
              directory_path: { type: 'string', description: '(alias for dir_path)' },
              output_file_path: { type: 'string', description: '(alias for output_path)' },
              source_path: { type: 'string', description: '(alias for dir_path)' },
              source: { type: 'string', description: '(alias for dir_path)' },
              folder_path: { type: 'string', description: '(alias for dir_path)' },
              path: { type: 'string', description: '(alias for dir_path)' },
              destination_path: { type: 'string', description: '(alias for output_path)' },
              dest_path: { type: 'string', description: '(alias for output_path)' },
              target_path: { type: 'string', description: '(alias for output_path)' },
              recursive: { type: 'boolean', description: 'List recursively', default: false },
              maxDepth: { type: 'number', description: 'Maximum recursion depth', default: 3 },
              format: { type: 'string', description: 'text | json', default: 'text' },
              limit: { type: 'number', description: 'Maximum entries (default 2000)', default: 2000 },
              quiet: { type: 'boolean', description: 'If true, return only confirmation (no extra wording)', default: false }
            },
            required: ['dir_path', 'output_path']
          }
        },
        {
          name: 'system_execute_command',
          description: 'Execute any system command with full privileges',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Command to execute (e.g., "dir C:\\", "ls -la /home", "ps aux")'
              },
              cwd: {
                type: 'string',
                description: 'Working directory for the command'
              },
              timeout: {
                type: 'number',
                description: 'Timeout in milliseconds (default: 300000)',
                default: 300000
              }
            },
            required: ['command']
          }
        },
        {
          name: 'system_create_directory',
          description: 'Create directories anywhere in the system',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to create'
              },
              recursive: {
                type: 'boolean',
                description: 'Create parent directories if needed',
                default: true
              }
            },
            required: ['path']
          }
        },
        {
          name: 'system_delete_file',
          description: 'Delete any file or directory in the system',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to delete'
              },
              recursive: {
                type: 'boolean',
                description: 'Delete recursively if directory',
                default: false
              }
            },
            required: ['path']
          }
        },
        {
          name: 'system_get_info',
          description: 'Get comprehensive system information',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'system_get_processes',
          description: 'List all running processes in the system',
          inputSchema: {
            type: 'object',
            properties: {
              detailed: {
                type: 'boolean',
                description: 'Get detailed process information',
                default: false
              }
            }
          }
        },
        {
          name: 'system_get_network_info',
          description: 'Get network interfaces and connections',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'system_get_drives',
          description: 'List all drives and their usage (Windows/Unix)',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'system_read_file_head',
          description: 'Read only the first N lines of a file (prevents huge payloads)',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute file path' },
              lines: { type: 'number', description: 'Number of lines to read (default 100)', default: 100 },
              encoding: { type: 'string', description: 'File encoding (default utf8)', default: 'utf8' }
            },
            required: ['path']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'system_read_file':
            return await this.readFile(args.path);

          case 'system_write_file':
            return await this.writeFile(args.path, args.content, args.encoding);

          case 'system_list_directory':
            return await this.listDirectory(args.path, args.recursive, args.maxDepth, args.format, args.limit);
          case 'system_export_directory_listing':
            return await this.exportDirectoryListing(
              args.dir_path || args.directory_path || args.source_path || args.source || args.folder_path || args.path || args.dir,
              args.output_path || args.output_file_path || args.destination_path || args.dest_path || args.target_path,
              args.recursive,
              args.maxDepth,
              args.format,
              args.limit,
              args.quiet
            );

          case 'system_execute_command':
            return await this.executeCommand(args.command, args.cwd, args.timeout);

          case 'system_create_directory':
            return await this.createDirectory(args.path, args.recursive);

          case 'system_delete_file':
            return await this.deleteFile(args.path, args.recursive);

          case 'system_get_info':
            return await this.getSystemInfo();

          case 'system_get_processes':
            return await this.getProcesses(args.detailed);

          case 'system_get_network_info':
            return await this.getNetworkInfo();

          case 'system_get_drives':
            return await this.getDrives();

          case 'system_read_file_head':
            return await this.readFileHead(args.path, args.lines, args.encoding);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async readFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return {
        content: [
          {
            type: 'text',
            text: `File: ${filePath}\n\nContent:\n${content}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  async writeFile(filePath, content, encoding = 'utf8') {
    try {
      await fs.writeFile(filePath, content, encoding);
      return {
        content: [
          {
            type: 'text',
            text: `Successfully wrote to: ${filePath}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to write file: ${error.message}`);
    }
  }

  async listDirectory(dirPath, recursive = false, maxDepth = 3, format = 'text', limit = 500) {
    try {
      const collected = [];
      const visit = async (dir, depth = 0) => {
        if (collected.length >= limit) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (collected.length >= limit) break;
            const fullPath = path.join(dir, entry.name);
            const rel = path.relative(dirPath, fullPath) || entry.name;
            if (entry.isDirectory()) {
              collected.push({ type: 'dir', name: entry.name, relative: rel + '/', path: fullPath });
              if (recursive && depth < maxDepth) {
                await visit(fullPath, depth + 1);
              }
            } else {
              const stats = await fs.stat(fullPath).catch(() => null);
              collected.push({ type: 'file', name: entry.name, relative: rel, path: fullPath, size: stats ? stats.size : null });
            }
        }
      };
      await visit(dirPath, 0);

      if (format === 'json') {
        const json = { directory: dirPath, total: collected.length, limited: collected.length >= limit, entries: collected };
        return { content: [{ type: 'text', text: JSON.stringify(json, null, 2) }] };
      }

      // text format
      const lines = collected.map(e => e.type === 'dir' ? `📁 ${e.relative}` : `📄 ${e.relative}${typeof e.size === 'number' ? ` (${(e.size/1024).toFixed(1)} KB)` : ''}`);
      const joined = lines.join('\n');
      const MAX_CHARS = 20000; // guard to avoid huge payload cascade
      let output = joined;
      if (output.length > MAX_CHARS) {
        output = output.slice(0, MAX_CHARS) + `\n...[TRUNCATED ${lines.length} entries; showing first ${(output.match(/\n/g)||[]).length}]`;
      }
      return { content: [{ type: 'text', text: `Directory: ${dirPath}\nTotal entries: ${collected.length}${collected.length>=limit? ' (LIMIT REACHED)': ''}\nFormat: text\n\n${output}` }] };
    } catch (error) {
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  }

  async exportDirectoryListing(dirPath, outputPath, recursive=false, maxDepth=3, format='text', limit=2000, quiet=false) {
    try {
      if (!dirPath) throw new Error('Missing dir_path (or alias)');
      if (!outputPath) throw new Error('Missing output_path (or alias)');
      const listingResult = await this.listDirectory(dirPath, recursive, maxDepth, format, limit);
      const textContent = listingResult.content[0].text;
      await fs.writeFile(outputPath, textContent, 'utf8');
      const msg = quiet ? `OK ${outputPath}` : `Exported directory listing to ${outputPath} (source: ${dirPath})`;
      return { content: [{ type: 'text', text: msg }] };
    } catch (error) {
      throw new Error(`Failed to export listing: ${error.message}`);
    }
  }

  async executeCommand(command, cwd, timeout = 300000) {
    try {
      const options = { timeout };
      if (cwd) options.cwd = cwd;

      const { stdout, stderr } = await execAsync(command, options);
      
      return {
        content: [
          {
            type: 'text',
            text: `Command: ${command}\nCWD: ${cwd || 'default'}\n\nOutput:\n${stdout}${stderr ? `\nErrors:\n${stderr}` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Command failed: ${error.message}`);
    }
  }

  async createDirectory(dirPath, recursive = true) {
    try {
      await fs.mkdir(dirPath, { recursive });
      return {
        content: [
          {
            type: 'text',
            text: `Successfully created directory: ${dirPath}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to create directory: ${error.message}`);
    }
  }

  async deleteFile(filePath, recursive = false) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        await fs.rmdir(filePath, { recursive });
      } else {
        await fs.unlink(filePath);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Successfully deleted: ${filePath}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to delete: ${error.message}`);
    }
  }

  async getSystemInfo() {
    try {
      const info = {
        platform: os.platform(),
        arch: os.arch(),
        type: os.type(),
        release: os.release(),
        hostname: os.hostname(),
        userInfo: os.userInfo(),
        cpus: os.cpus().length,
        totalMemory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        freeMemory: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        uptime: (os.uptime() / 3600).toFixed(2) + ' hours',
        loadAverage: os.loadavg(),
        networkInterfaces: Object.keys(os.networkInterfaces())
      };

      return {
        content: [
          {
            type: 'text',
            text: `System Information:\n${JSON.stringify(info, null, 2)}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get system info: ${error.message}`);
    }
  }

  async getProcesses(detailed = false) {
    try {
      const isWindows = os.platform() === 'win32';
      const command = isWindows 
        ? (detailed ? 'tasklist /FO CSV /V' : 'tasklist /FO CSV')
        : (detailed ? 'ps aux' : 'ps -e');

      const { stdout } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Running Processes:\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get processes: ${error.message}`);
    }
  }

  async getNetworkInfo() {
    try {
      const isWindows = os.platform() === 'win32';
      const command = isWindows ? 'ipconfig /all' : 'ifconfig -a';

      const { stdout } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Network Information:\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get network info: ${error.message}`);
    }
  }

  async getDrives() {
    try {
      const isWindows = os.platform() === 'win32';
      const command = isWindows ? 'wmic logicaldisk get size,freespace,caption' : 'df -h';

      const { stdout } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Drive Information:\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get drive info: ${error.message}`);
    }
  }

  async readFileHead(filePath, lines=100, encoding='utf8') {
    try {
      const content = await fs.readFile(filePath, encoding);
      const allLines = content.split(/\r?\n/);
      const slice = allLines.slice(0, lines);
      const truncated = slice.join('\n');
      return {
        content: [
          { type: 'text', text: `Head (${slice.length} lines of ${allLines.length}) for ${filePath}:\n\n${truncated}${allLines.length>slice.length?`\n... [TRUNCATED]`:''}` }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to read head: ${error.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('System Access MCP Server running on stdio');
  }
}

const server = new SystemAccessServer();
server.run().catch(console.error);
