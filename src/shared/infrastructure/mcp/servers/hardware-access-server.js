#!/usr/bin/env node

/**
 * MCP Server for Hardware and Device Access
 * Provides access to system hardware information and device control
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

class HardwareAccessServer {
  constructor() {
    this.server = new Server(
      {
        name: 'hardware-access-server',
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
          name: 'hardware_info',
          description: 'Get comprehensive hardware information (CPU, RAM, GPU, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              component: {
                type: 'string',
                description: 'Specific component: cpu, memory, gpu, storage, all',
                default: 'all'
              }
            }
          }
        },
        {
          name: 'device_list',
          description: 'List all connected devices and hardware',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Device type: usb, pci, network, audio, all',
                default: 'all'
              }
            }
          }
        },
        {
          name: 'disk_info',
          description: 'Get detailed disk and storage information',
          inputSchema: {
            type: 'object',
            properties: {
              detailed: {
                type: 'boolean',
                description: 'Include detailed disk health and SMART data',
                default: false
              }
            }
          }
        },
        {
          name: 'network_adapters',
          description: 'List network adapters and their configurations',
          inputSchema: {
            type: 'object',
            properties: {
              includeStats: {
                type: 'boolean',
                description: 'Include network statistics',
                default: false
              }
            }
          }
        },
        {
          name: 'temperature_sensors',
          description: 'Get system temperature readings',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'power_info',
          description: 'Get power and battery information',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'monitor_info',
          description: 'Get display/monitor information',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'audio_devices',
          description: 'List audio input/output devices',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'bluetooth_devices',
          description: 'List and manage Bluetooth devices',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                description: 'Action: list, scan, pair, unpair',
                default: 'list'
              },
              device: {
                type: 'string',
                description: 'Device address for pair/unpair operations'
              }
            }
          }
        },
        {
          name: 'driver_info',
          description: 'Get information about installed drivers',
          inputSchema: {
            type: 'object',
            properties: {
              device: {
                type: 'string',
                description: 'Specific device to check drivers for'
              }
            }
          }
        },
        {
          name: 'performance_counters',
          description: 'Get real-time performance counters',
          inputSchema: {
            type: 'object',
            properties: {
              duration: {
                type: 'number',
                description: 'Monitoring duration in seconds',
                default: 10
              }
            }
          }
        },
        {
          name: 'system_events',
          description: 'Get recent system events and logs',
          inputSchema: {
            type: 'object',
            properties: {
              level: {
                type: 'string',
                description: 'Event level: error, warning, info, all',
                default: 'error'
              },
              count: {
                type: 'number',
                description: 'Number of recent events to retrieve',
                default: 50
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
          case 'hardware_info':
            return await this.getHardwareInfo(args.component);

          case 'device_list':
            return await this.listDevices(args.type);

          case 'disk_info':
            return await this.getDiskInfo(args.detailed);

          case 'network_adapters':
            return await this.getNetworkAdapters(args.includeStats);

          case 'temperature_sensors':
            return await this.getTemperatureSensors();

          case 'power_info':
            return await this.getPowerInfo();

          case 'monitor_info':
            return await this.getMonitorInfo();

          case 'audio_devices':
            return await this.getAudioDevices();

          case 'bluetooth_devices':
            return await this.manageBluetoothDevices(args.action, args.device);

          case 'driver_info':
            return await this.getDriverInfo(args.device);

          case 'performance_counters':
            return await this.getPerformanceCounters(args.duration);

          case 'system_events':
            return await this.getSystemEvents(args.level, args.count);

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

  async getHardwareInfo(component = 'all') {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        switch (component) {
          case 'cpu':
            commands.push('wmic cpu get name,manufacturer,maxclockspeed,numberofcores,numberoflogicalprocessors');
            break;
          case 'memory':
            commands.push('wmic memorychip get capacity,speed,manufacturer,partnumber');
            break;
          case 'gpu':
            commands.push('wmic path win32_videocontroller get name,adapterram,driverversion');
            break;
          case 'storage':
            commands.push('wmic diskdrive get model,size,interfacetype');
            break;
          default:
            commands = [
              'wmic cpu get name,manufacturer,maxclockspeed,numberofcores',
              'wmic memorychip get capacity,speed,manufacturer',
              'wmic path win32_videocontroller get name,adapterram',
              'wmic diskdrive get model,size,interfacetype',
              'wmic baseboard get manufacturer,product,serialnumber'
            ];
        }
      } else {
        switch (component) {
          case 'cpu':
            commands.push('lscpu');
            break;
          case 'memory':
            commands.push('free -h && dmidecode -t memory 2>/dev/null | head -50');
            break;
          case 'gpu':
            commands.push('lspci | grep -i vga && lspci | grep -i 3d');
            break;
          case 'storage':
            commands.push('lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,MODEL');
            break;
          default:
            commands = [
              'lscpu',
              'free -h',
              'lspci | grep -i vga',
              'lsblk -o NAME,SIZE,TYPE,MODEL',
              'dmidecode -t system 2>/dev/null | head -20'
            ];
        }
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Hardware Information (${component}):\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get hardware info: ${error.message}`);
    }
  }

  async listDevices(type = 'all') {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        switch (type) {
          case 'usb':
            commands.push('wmic path Win32_USBControllerDevice get dependent');
            break;
          case 'pci':
            commands.push('wmic path Win32_PnPEntity where "DeviceID like \'PCI%\'" get name,deviceid');
            break;
          case 'network':
            commands.push('wmic path Win32_NetworkAdapter get name,adaptertype,macaddress');
            break;
          case 'audio':
            commands.push('wmic sounddev get name,manufacturer');
            break;
          default:
            commands = [
              'wmic path Win32_PnPEntity get name,deviceid',
              'wmic path Win32_USBControllerDevice get dependent',
              'wmic path Win32_NetworkAdapter get name,macaddress'
            ];
        }
      } else {
        switch (type) {
          case 'usb':
            commands.push('lsusb');
            break;
          case 'pci':
            commands.push('lspci');
            break;
          case 'network':
            commands.push('ip link show');
            break;
          case 'audio':
            commands.push('aplay -l && arecord -l');
            break;
          default:
            commands = [
              'lspci',
              'lsusb',
              'ip link show',
              'lsblk'
            ];
        }
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Device List (${type}):\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to list devices: ${error.message}`);
    }
  }

  async getDiskInfo(detailed = false) {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        commands.push('wmic diskdrive get model,size,status,interfacetype');
        commands.push('wmic logicaldisk get size,freespace,caption,filesystem');
        if (detailed) {
          commands.push('wmic diskdrive get smartstatus');
        }
      } else {
        commands.push('lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,MODEL,FSTYPE');
        commands.push('df -h');
        if (detailed) {
          commands.push('sudo smartctl -a /dev/sda 2>/dev/null || echo "SMART data requires sudo"');
        }
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Disk Information:\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get disk info: ${error.message}`);
    }
  }

  async getNetworkAdapters(includeStats = false) {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        commands.push('ipconfig /all');
        if (includeStats) {
          commands.push('netstat -e');
        }
      } else {
        commands.push('ip addr show');
        commands.push('iwconfig 2>/dev/null || echo "No wireless interfaces"');
        if (includeStats) {
          commands.push('cat /proc/net/dev');
        }
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Network Adapters:\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get network adapters: ${error.message}`);
    }
  }

  async getTemperatureSensors() {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        commands.push('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature');
      } else {
        commands.push('sensors 2>/dev/null || echo "sensors not available - install lm-sensors"');
        commands.push('cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null || echo "No thermal zones found"');
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Temperature Sensors:\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get temperature sensors: ${error.message}`);
    }
  }

  async getPowerInfo() {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        commands.push('powercfg /batteryreport /output CON 2>nul || echo "No battery found"');
        commands.push('wmic path Win32_Battery get EstimatedChargeRemaining,BatteryStatus');
      } else {
        commands.push('upower -i $(upower -e | grep BAT) 2>/dev/null || echo "No battery found"');
        commands.push('cat /sys/class/power_supply/BAT*/capacity 2>/dev/null || echo "No battery info"');
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Power Information:\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get power info: ${error.message}`);
    }
  }

  async getMonitorInfo() {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        commands.push('wmic desktopmonitor get screenheight,screenwidth,name');
        commands.push('wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution');
      } else {
        commands.push('xrandr 2>/dev/null || echo "No display server or xrandr not available"');
        commands.push('ls /sys/class/drm/card*/status 2>/dev/null || echo "No DRM info available"');
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Monitor Information:\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get monitor info: ${error.message}`);
    }
  }

  async getAudioDevices() {
    try {
      const isWindows = os.platform() === 'win32';
      let commands = [];

      if (isWindows) {
        commands.push('wmic sounddev get name,manufacturer,status');
      } else {
        commands.push('aplay -l 2>/dev/null || echo "No playback devices"');
        commands.push('arecord -l 2>/dev/null || echo "No recording devices"');
        commands.push('pulseaudio --dump-conf 2>/dev/null | head -20 || echo "PulseAudio not available"');
      }

      let results = [];
      for (const command of commands) {
        try {
          const { stdout } = await execAsync(command);
          results.push(stdout);
        } catch (error) {
          results.push(`Command failed: ${command}\nError: ${error.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Audio Devices:\n\n${results.join('\n\n---\n\n')}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get audio devices: ${error.message}`);
    }
  }

  async manageBluetoothDevices(action = 'list', device) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        switch (action) {
          case 'list':
            command = 'powershell "Get-PnpDevice | Where-Object {$_.Class -eq \"Bluetooth\"}"';
            break;
          case 'scan':
            command = 'echo "Bluetooth scan not implemented for Windows via command line"';
            break;
          default:
            throw new Error(`Bluetooth action ${action} not implemented for Windows`);
        }
      } else {
        switch (action) {
          case 'list':
            command = 'bluetoothctl devices 2>/dev/null || echo "Bluetooth not available"';
            break;
          case 'scan':
            command = 'timeout 10 bluetoothctl scan on 2>/dev/null || echo "Bluetooth scan failed"';
            break;
          case 'pair':
            command = `bluetoothctl pair ${device} 2>/dev/null || echo "Pairing failed"`;
            break;
          case 'unpair':
            command = `bluetoothctl remove ${device} 2>/dev/null || echo "Unpairing failed"`;
            break;
          default:
            throw new Error(`Invalid Bluetooth action: ${action}`);
        }
      }

      const { stdout, stderr } = await execAsync(command);

      return {
        content: [
          {
            type: 'text',
            text: `Bluetooth ${action}:\n\n${stdout}${stderr ? `\nErrors: ${stderr}` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to manage Bluetooth devices: ${error.message}`);
    }
  }

  async getDriverInfo(device) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        if (device) {
          command = `wmic path Win32_PnPSignedDriver where "DeviceName like '%${device}%'" get DeviceName,DriverVersion,DriverDate`;
        } else {
          command = 'wmic path Win32_PnPSignedDriver get DeviceName,DriverVersion,DriverDate';
        }
      } else {
        if (device) {
          command = `lsmod | grep -i ${device} || echo "Driver for ${device} not found"`;
        } else {
          command = 'lsmod';
        }
      }

      const { stdout } = await execAsync(command);

      return {
        content: [
          {
            type: 'text',
            text: `Driver Information${device ? ` for ${device}` : ''}:\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get driver info: ${error.message}`);
    }
  }

  async getPerformanceCounters(duration = 10) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        command = `powershell "Get-Counter '\\Processor(_Total)\\% Processor Time','\\Memory\\Available MBytes','\\PhysicalDisk(_Total)\\Disk Reads/sec','\\PhysicalDisk(_Total)\\Disk Writes/sec' -SampleInterval 1 -MaxSamples ${duration}"`;
      } else {
        command = `iostat -x 1 ${duration} 2>/dev/null || vmstat 1 ${duration}`;
      }

      const { stdout } = await execAsync(command);

      return {
        content: [
          {
            type: 'text',
            text: `Performance Counters (${duration}s):\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get performance counters: ${error.message}`);
    }
  }

  async getSystemEvents(level = 'error', count = 50) {
    try {
      const isWindows = os.platform() === 'win32';
      let command;

      if (isWindows) {
        const levelMap = {
          error: 1,
          warning: 2,
          info: 4,
          all: ''
        };
        const levelFilter = levelMap[level] ? `Level=${levelMap[level]} and` : '';
        command = `powershell "Get-WinEvent -FilterHashtable @{LogName='System'; ${levelFilter} MaxEvents=${count}} | Select-Object TimeCreated,LevelDisplayName,Id,Message | Format-Table -Wrap"`;
      } else {
        const levelFilter = level === 'all' ? '' : `--priority=${level}`;
        command = `journalctl ${levelFilter} -n ${count} --no-pager 2>/dev/null || tail -${count} /var/log/syslog 2>/dev/null || echo "No system logs accessible"`;
      }

      const { stdout } = await execAsync(command);

      return {
        content: [
          {
            type: 'text',
            text: `System Events (${level}, last ${count}):\n\n${stdout}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Failed to get system events: ${error.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Hardware Access MCP Server running on stdio');
  }
}

const server = new HardwareAccessServer();
server.run().catch(console.error);
