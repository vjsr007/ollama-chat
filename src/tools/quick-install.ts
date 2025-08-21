#!/usr/bin/env ts-node

/**
 * Script de instalación rápida para MCP
 * Instala solo los servidores MCP que funcionan correctamente
 */

import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

// Solo los servidores que sabemos que funcionan
const workingMcpServers = [
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-memory'
];

async function quickInstall() {
  console.log('🚀 Instalación rápida MCP para Ollama Chat\n');
  
  // 1. Instalar solo servidores que funcionan
  console.log('📦 Instalando servidores MCP verificados...\n');
  
  for (const pkg of workingMcpServers) {
    try {
      console.log(`⬇️ Instalando ${pkg}...`);
      execSync(`npm install -g ${pkg}`, { stdio: 'inherit' });
      console.log(`✅ ${pkg} instalado\n`);
    } catch (error) {
      console.error(`❌ Error instalando ${pkg}`);
    }
  }
  
  // 2. Crear configuración simplificada
  const quickConfig = {
    version: '1.0.0',
    description: 'Configuración MCP rápida y funcional',
    builtin_tools: {
      filesystem: {
        enabled: true,
        description: 'Herramientas de archivos integradas',
        tools: ['list_dir', 'read_file', 'write_file', 'path_info']
      }
    },
    working_servers: {
      'filesystem-external': {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
        description: 'Servidor de archivos externo',
        category: 'core',
        enabled: false,
        status: 'Requiere npx configurado'
      },
      'memory': {
        type: 'stdio', 
        command: 'npx',
        args: ['@modelcontextprotocol/server-memory'],
        description: 'Sistema de memoria persistente',
        category: 'core',
        enabled: false,
        status: 'Requiere npx configurado'
      }
    },
    setup_complete: true
  };
  
  await fs.writeFile(
    path.join(process.cwd(), 'mcp-quick-config.json'),
    JSON.stringify(quickConfig, null, 2)
  );
  
  // 3. Crear archivo .env si no existe
  const envPath = path.join(process.cwd(), '.env');
  try {
    await fs.access(envPath);
    console.log('📋 Archivo .env ya existe');
  } catch {
    await fs.copyFile('.env.example', '.env');
    console.log('📋 Archivo .env creado desde plantilla');
  }
  
  console.log('\n✨ Instalación rápida completada!');
  console.log('\n📋 Resumen:');
  console.log('✅ Herramientas integradas: Filesystem (list_dir, read_file, write_file, path_info)');
  console.log('✅ Servidores globales: filesystem, memory');
  console.log('✅ Configuración: mcp-quick-config.json');
  console.log('✅ Variables de entorno: .env');
  
  console.log('\n🎯 Próximos pasos:');
  console.log('1. npm start - Iniciar la aplicación');
  console.log('2. Ir a la pestaña "Tools" en la aplicación');
  console.log('3. Usar las herramientas integradas (no requieren configuración)');
  console.log('4. Opcionalmente, agregar servidores externos desde la UI');
  
  console.log('\n💡 Tip: Las herramientas integradas funcionan inmediatamente,');
  console.log('    los servidores externos requieren configuración adicional.');
}

if (require.main === module) {
  quickInstall().catch(console.error);
}
