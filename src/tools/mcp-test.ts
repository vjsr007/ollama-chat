#!/usr/bin/env ts-node

/**
 * MCP Test Tool
 * Prueba la conectividad con servidores MCP
 */

import { spawn } from 'child_process';

async function testMcpServer(name: string, command: string, args: string[]) {
  console.log(`🧪 Probando servidor MCP: ${name}`);
  
  try {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Enviar solicitud de inicialización
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'ollama-chat-test',
          version: '0.1.0'
        }
      }
    };
    
    child.stdin.write(JSON.stringify(initRequest) + '\n');
    
    return new Promise((resolve, reject) => {
      let output = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        console.error(`Error from ${name}:`, data.toString());
      });
      
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Timeout'));
      }, 300000);
      
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0 || output.includes('jsonrpc')) {
          console.log(`✅ ${name} responde correctamente`);
          resolve(true);
        } else {
          console.log(`❌ ${name} no responde (código: ${code})`);
          resolve(false);
        }
      });
    });
    
  } catch (error) {
    console.error(`❌ Error probando ${name}:`, error);
    return false;
  }
}

async function main() {
  console.log('🔍 Probando servidores MCP disponibles...\n');
  
  const servers = [
    { name: 'filesystem', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '.'] },
    { name: 'memory', command: 'npx', args: ['@modelcontextprotocol/server-memory'] },
    { name: 'fetch', command: 'npx', args: ['@modelcontextprotocol/server-fetch'] }
  ];
  
  for (const server of servers) {
    await testMcpServer(server.name, server.command, server.args);
    console.log();
  }
  
  console.log('✨ Pruebas completadas');
}

if (require.main === module) {
  main().catch(console.error);
}
