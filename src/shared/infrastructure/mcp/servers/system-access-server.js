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
          description: 'List contents of any directory in the system (no restrictions)',
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
              }
            },
            required: ['path']
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
                description: 'Timeout in milliseconds (default: 30000)',
                default: 30000
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
            return await this.listDirectory(args.path, args.recursive);

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

  async listDirectory(dirPath, recursive = false) {
    try {
      const listRecursive = async (dir, level = 0) => {
        const items = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const indent = '  '.repeat(level);
          
          if (entry.isDirectory()) {
            items.push(`${indent}📁 ${entry.name}/`);
            if (recursive && level < 3) { // Limit recursion depth
              const subItems = await listRecursive(fullPath, level + 1);
              items.push(...subItems);
            }
          } else {
            const stats = await fs.stat(fullPath);
            items.push(`${indent}📄 ${entry.name} (${(stats.size / 1024).toFixed(1)} KB)`);
          }
        }
        return items;
      };

      const items = await listRecursive(dirPath);
      return {
        content: [
          {
            type: 'text',
            text: `Directory: ${dirPath}\n\n${items.join('\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  }

  async executeCommand(command, cwd, timeout = 30000) {
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('System Access MCP Server running on stdio');
  }
}

const server = new SystemAccessServer();
server.run().catch(console.error);
