#!/usr/bin/env node

const { spawn } = require('child_process');
const { StdioServerTransport } = require('../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js');
const { McpServer } = require('../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('../../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/types.js');

/**
 * Copilot Terminal MCP Server
 * Provides AI-powered terminal assistance through copilot-terminal integration
 */

const server = new McpServer({
  name: 'copilot-terminal',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

const transport = new StdioServerTransport();

// Set up tool handlers
server.setToolRequestHandlers({
  suggest_command: async (request) => {
    const { query, context = '' } = request.params.arguments;
    const suggestions = generateCommandSuggestions(query, context);
    
    return {
      content: [{
        type: 'text',
        text: `AI Command Suggestions for: "${query}"\n\n${suggestions}`,
      }],
    };
  },

  execute_with_assistance: async (request) => {
    const { command, working_directory = process.cwd(), timeout = 30 } = request.params.arguments;
    
    return new Promise((resolve) => {
      const childProcess = spawn('powershell', ['-Command', command], {
        cwd: working_directory,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        childProcess.kill();
        resolve({
          content: [{
            type: 'text',
            text: `Command execution timed out after ${timeout} seconds`,
          }],
          isError: true,
        });
      }, timeout * 1000);

      childProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        
        resolve({
          content: [{
            type: 'text',
            text: `Command: ${command}\nExit Code: ${code}\n\n` +
                  `STDOUT:\n${stdout || '(no output)'}\n\n` +
                  `STDERR:\n${stderr || '(no errors)'}`,
          }],
        });
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          content: [{
            type: 'text',
            text: `Failed to execute command: ${error.message}`,
          }],
          isError: true,
        });
      });
    });
  },

  get_terminal_help: async (request) => {
    const { topic, shell = 'powershell' } = request.params.arguments;
    const helpContent = generateTerminalHelp(topic, shell);
    
    return {
      content: [{
        type: 'text',
        text: helpContent,
      }],
    };
  },
});

function generateCommandSuggestions(query, context) {
  const lowerQuery = query.toLowerCase();
  
  // Common command patterns
  const patterns = [
    {
      keywords: ['list', 'show', 'files', 'directory'],
      suggestions: [
        'Get-ChildItem -Recurse *.js',
        'ls -la',
        'dir /s *.txt',
        'Get-ChildItem | Format-Table Name, Length, LastWriteTime',
      ],
    },
    {
      keywords: ['find', 'search', 'locate'],
      suggestions: [
        'Get-ChildItem -Recurse | Where-Object {$_.Name -like "*pattern*"}',
        'Select-String -Pattern "text" -Path *.js',
        'findstr /s /i "pattern" *.txt',
      ],
    },
    {
      keywords: ['large', 'big', 'size'],
      suggestions: [
        'Get-ChildItem -Recurse | Sort-Object Length -Descending | Select-Object -First 10',
        'du -h --max-depth=1 | sort -hr',
      ],
    },
    {
      keywords: ['process', 'running', 'task'],
      suggestions: [
        'Get-Process',
        'tasklist',
        'Get-Process | Sort-Object CPU -Descending',
      ],
    },
    {
      keywords: ['network', 'connection', 'port'],
      suggestions: [
        'Get-NetTCPConnection',
        'netstat -an',
        'Test-NetConnection -ComputerName google.com -Port 80',
      ],
    },
  ];

  let suggestions = [];
  
  for (const pattern of patterns) {
    if (pattern.keywords.some(keyword => lowerQuery.includes(keyword))) {
      suggestions.push(...pattern.suggestions);
    }
  }

  if (suggestions.length === 0) {
    suggestions = [
      `# For "${query}", consider these approaches:`,
      '1. Break down the task into smaller steps',
      '2. Use Get-Help <command> for PowerShell help',
      '3. Try: Get-Command *keyword* to find related commands',
      '4. Use -WhatIf parameter to test commands safely',
    ];
  }

  return suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

function generateTerminalHelp(topic, shell) {
  const helpTopics = {
    'file operations': `
File Operations in ${shell}:
• List files: Get-ChildItem (ls, dir)
• Copy files: Copy-Item (cp, copy)
• Move files: Move-Item (mv, move)
• Delete files: Remove-Item (rm, del)
• Create directory: New-Item -ItemType Directory (mkdir)
• Find files: Get-ChildItem -Recurse -Name "pattern"
`,
    'permissions': `
File Permissions in ${shell}:
• View permissions: Get-Acl
• Set permissions: Set-Acl
• Take ownership: takeown /f filename
• Run as admin: Start-Process -Verb RunAs
`,
    'networking': `
Network Commands in ${shell}:
• Test connection: Test-NetConnection
• View connections: Get-NetTCPConnection
• DNS lookup: Resolve-DnsName
• Download file: Invoke-WebRequest
`,
    'process management': `
Process Management in ${shell}:
• List processes: Get-Process
• Kill process: Stop-Process -Name "name"
• Start process: Start-Process
• Monitor resources: Get-Counter
`,
  };

  const lowerTopic = topic.toLowerCase();
  for (const [key, content] of Object.entries(helpTopics)) {
    if (lowerTopic.includes(key) || key.includes(lowerTopic)) {
      return content.trim();
    }
  }

  return `
General Terminal Help for "${topic}":

Common PowerShell patterns:
• Get-Help <command> - Get help for any command
• Get-Command *pattern* - Find commands matching pattern
• <command> -WhatIf - Preview what a command would do
• <command> | Get-Member - See available properties/methods
• <command> | Format-Table - Format output as table
• <command> | Out-GridView - View output in GUI grid

Useful aliases:
• ls = Get-ChildItem
• cd = Set-Location
• pwd = Get-Location
• cat = Get-Content
• grep = Select-String
`;
}

// Start the server
async function main() {
  await server.connect(transport);
  console.error('Copilot Terminal MCP Server running on stdio');
}

main().catch(error => {
  console.error('Server error:', error);
  process.exit(1);
});
