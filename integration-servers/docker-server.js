#!/usr/bin/env node
// Minimal Docker MCP wrapper. Requires docker CLI in PATH.
const { exec } = require('child_process');
const { JsonRpcServer } = require('./base-jsonrpc-server.js');

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

const tools = () => [
  {
    name: 'docker_ps',
    description: 'List running containers (docker ps --format json)',
    inputSchema: { type: 'object', properties: {} },
    invoke: async () => {
      const out = await run('docker ps --format "{{json .}}"');
      const lines = out.split(/\r?\n/).filter(Boolean);
      const containers = lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      return { count: containers.length, containers };
    }
  },
  {
    name: 'docker_images',
    description: 'List images (docker images --format json)',
    inputSchema: { type: 'object', properties: {} },
    invoke: async () => {
      const out = await run('docker images --format "{{json .}}"');
      const lines = out.split(/\r?\n/).filter(Boolean);
      const images = lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      return { count: images.length, images };
    }
  }
];

new JsonRpcServer({ toolsProvider: tools, onInitialize: () => ({ name: 'docker-mcp' }) });
