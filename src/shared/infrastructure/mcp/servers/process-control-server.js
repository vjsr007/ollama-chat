#!/usr/bin/env node

/**
 * MCP Server for Process and Service Control
 * Provides full control over system processes and services
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec, spawn } from 'child_process';
import process from 'process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

class ProcessControlServer {
  constructor() {
    this.server = new Server(
      {
        name: 'process-control-server',
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
          name: 'process_list',
          description: 'List all running processes with detailed information',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                description: 'Filter processes by name or PID'
              },
              sortBy: {
                type: 'string',
                description: 'Sort by: name, pid, cpu, memory',
                default: 'name'
              }
            }
          }
        },
        {
          name: 'process_kill',
          description: 'Terminate a process by PID or name',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'Process ID to kill'
              },
              name: {
                type: 'string',
                description: 'Process name to kill (all instances)'
              },
              force: {
                type: 'boolean',
                description: 'Force kill (SIGKILL)',
                default: false
              }
            }
          }
        },
        {
          name: 'process_start',
          description: 'Start a new process',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Command to execute'
              },
              args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Command arguments'
              },
              cwd: {
                type: 'string',
                description: 'Working directory'
              },
              detached: {
                type: 'boolean',
                description: 'Run detached from parent',
                default: false
              }
            },
            required: ['command']
          }
        },
        {
          name: 'service_list',
          description: 'List system services (Windows/Linux)',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                description: 'Filter by status: running, stopped, all',
                default: 'all'
              }
            }
          }
        },
        {
          name: 'service_control',
          description: 'Control system services (start/stop/restart)',
          inputSchema: {
            type: 'object',
            properties: {
              serviceName: {
                type: 'string',
                description: 'Name of the service'
              },
              action: {
                type: 'string',
                description: 'Action: start, stop, restart, status',
                enum: ['start', 'stop', 'restart', 'status']
              }
            },
            required: ['serviceName', 'action']
          }
        },
        {
          name: 'process_monitor',
          description: 'Monitor resource usage (CPU, Memory, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              duration: {
                type: 'number',
                description: 'Monitor duration in seconds',
                default: 10
              },
              interval: {
                type: 'number',
                description: 'Sample interval in seconds',
                default: 1
              }
            }
          }
        },
        {
          name: 'process_tree',
          description: 'Show process tree/hierarchy',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'Root process PID (optional)'
              }
            }
          }
        },
        {
          name: 'port_usage',
          description: 'Show processes using specific ports',
          inputSchema: {
            type: 'object',
            properties: {
              port: {
                type: 'number',
                description: 'Specific port to check'
              },
              protocol: {
                type: 'string',
                description: 'Protocol: tcp, udp, all',
                default: 'all'
              }
            }
          }
        },
        {
          name: 'startup_programs',
          description: 'List and manage startup programs',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                description: 'Action: list, enable, disable',
                default: 'list'
              },
              program: {
                type: 'string',
                description: 'Program name for enable/disable'
              }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'process_list':
            return await this.listProcesses(args.filter, args.sortBy);

          case 'process_kill':
            return await this.killProcess(args.pid, args.name, args.force);

          case 'process_start':
            return await this.startProcess(args.command, args.args, args.cwd, args.detached);

          case 'service_list':
            return await this.listServices(args.status);

          case 'service_control':
            return await this.controlService(args.serviceName, args.action);

          case 'process_monitor':
            return await this.monitorResources(args.duration, args.interval);

          case 'process_tree':
            return await this.showProcessTree(args.pid);

          case 'port_usage':
            return await this.showPortUsage(args.port, args.protocol);

          case 'startup_programs':
            return await this.manageStartupPrograms(args.action, args.program);

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

  async listProcesses(filter, sortBy = 'name') {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        command = 'tasklist /FO CSV /V';
      } else {
        command = 'ps aux --sort=-%cpu';
      }

      if (filter) {
        if (isWindows) {
          command += ` | findstr "${filter}"`;
        } else {
          command += ` | grep "${filter}"`;
        }
      }

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
      throw new Error(`Failed to list processes: ${error.message}`);
    }
  }

  async killProcess(pid, name, force = false) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (pid) {
        if (isWindows) {
          command = force ? `taskkill /F /PID ${pid}` : `taskkill /PID ${pid}`;
        } else {
          command = force ? `kill -9 ${pid}` : `kill ${pid}`;
        }
      } else if (name) {
        if (isWindows) {
          command = force ? `taskkill /F /IM "${name}"` : `taskkill /IM "${name}"`;
        } else {
          command = force ? `pkill -9 "${name}"` : `pkill "${name}"`;
        }
      } else {
        throw new Error('Either PID or name must be provided');
      }

      const { stdout, stderr } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Process termination result:\n${stdout}${stderr ? `\nErrors: ${stderr}` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to kill process: ${error.message}`);
    }
  }

  async startProcess(command, args = [], cwd, detached = false) {
    try {
      const options = {};
      if (cwd) options.cwd = cwd;
      if (detached) options.detached = true;

      const child = spawn(command, args, options);
      
      return {
        content: [
          {
            type: 'text',
            text: `Process started: ${command} ${args.join(' ')}\nPID: ${child.pid}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to start process: ${error.message}`);
    }
  }

  async listServices(status = 'all') {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        switch (status) {
          case 'running':
            command = 'sc query state= running';
            break;
          case 'stopped':
            command = 'sc query state= stopped';
            break;
          default:
            command = 'sc query';
        }
      } else {
        switch (status) {
          case 'running':
            command = 'systemctl list-units --type=service --state=running';
            break;
          case 'stopped':
            command = 'systemctl list-units --type=service --state=failed,dead';
            break;
          default:
            command = 'systemctl list-units --type=service --all';
        }
      }

      const { stdout } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `System Services (${status}):\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to list services: ${error.message}`);
    }
  }

  async controlService(serviceName, action) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        switch (action) {
          case 'start':
            command = `sc start "${serviceName}"`;
            break;
          case 'stop':
            command = `sc stop "${serviceName}"`;
            break;
          case 'restart':
            command = `sc stop "${serviceName}" && sc start "${serviceName}"`;
            break;
          case 'status':
            command = `sc query "${serviceName}"`;
            break;
          default:
            throw new Error(`Invalid action: ${action}`);
        }
      } else {
        switch (action) {
          case 'start':
            command = `sudo systemctl start "${serviceName}"`;
            break;
          case 'stop':
            command = `sudo systemctl stop "${serviceName}"`;
            break;
          case 'restart':
            command = `sudo systemctl restart "${serviceName}"`;
            break;
          case 'status':
            command = `systemctl status "${serviceName}"`;
            break;
          default:
            throw new Error(`Invalid action: ${action}`);
        }
      }

      const { stdout, stderr } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Service ${action} result for "${serviceName}":\n${stdout}${stderr ? `\nErrors: ${stderr}` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to ${action} service: ${error.message}`);
    }
  }

  async monitorResources(duration = 10, interval = 1) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        command = `powershell "for($i=0; $i -lt ${duration}; $i++) { Get-Counter '\\Processor(_Total)\\% Processor Time','\\Memory\\Available MBytes' -SampleInterval ${interval} -MaxSamples 1 | Format-Table -AutoSize; Start-Sleep ${interval} }"`;
      } else {
        command = `top -n ${duration} -d ${interval} -b | head -20`;
      }

      const { stdout } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Resource Monitor (${duration}s):\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to monitor resources: ${error.message}`);
    }
  }

  async showProcessTree(pid) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        command = pid ? `wmic process where (parentprocessid=${pid}) get processid,parentprocessid,name` : 'tasklist /fo tree';
      } else {
        command = pid ? `pstree -p ${pid}` : 'pstree -p';
      }

      const { stdout } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Process Tree:\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to show process tree: ${error.message}`);
    }
  }

  async showPortUsage(port, protocol = 'all') {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        if (port) {
          command = `netstat -ano | findstr ":${port}"`;
        } else {
          command = protocol === 'all' ? 'netstat -ano' : `netstat -ano -p ${protocol}`;
        }
      } else {
        if (port) {
          command = `netstat -tulpn | grep ":${port}"`;
        } else {
          command = protocol === 'all' ? 'netstat -tulpn' : `netstat -${protocol[0]}lpn`;
        }
      }

      const { stdout } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Port Usage${port ? ` for port ${port}` : ''}:\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to show port usage: ${error.message}`);
    }
  }

  async manageStartupPrograms(action = 'list', program) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        switch (action) {
          case 'list':
            command = 'wmic startup get caption,command,location';
            break;
          case 'enable':
            command = `reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${program}" /t REG_SZ /d "${program}"`;
            break;
          case 'disable':
            command = `reg delete "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${program}" /f`;
            break;
          default:
            throw new Error(`Invalid action: ${action}`);
        }
      } else {
        switch (action) {
          case 'list':
            command = 'ls -la ~/.config/autostart/ /etc/xdg/autostart/ 2>/dev/null || echo "No autostart directories found"';
            break;
          case 'enable':
            throw new Error('Enable not implemented for Linux - requires manual desktop file creation');
          case 'disable':
            throw new Error('Disable not implemented for Linux - requires manual file removal');
          default:
            throw new Error(`Invalid action: ${action}`);
        }
      }

      const { stdout, stderr } = await execAsync(command);
      
      return {
        content: [
          {
            type: 'text',
            text: `Startup Programs (${action}):\n\n${stdout}${stderr ? `\nErrors: ${stderr}` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to manage startup programs: ${error.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Process Control MCP Server running on stdio');
  }
}

const server = new ProcessControlServer();
server.run().catch(console.error);
